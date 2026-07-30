-- Public professional profiles are intentionally separate from people.display_name.
-- The latter remains an authority input for learning evidence, Zoom, and certificate
-- snapshots; a learner-editable nickname must never alter those records.

alter table public.upload_quarantine
  drop constraint if exists upload_quarantine_purpose_check;

alter table public.upload_quarantine
  add constraint upload_quarantine_purpose_check check (purpose in (
    'payment_proof', 'identity_correction', 'course_material',
    'organization_roster', 'bank_statement',
    'profile_avatar', 'profile_cover'
  )),
  add column if not exists promoted_sha256 text,
  add constraint upload_quarantine_promoted_sha256_check check (
    promoted_sha256 is null
    or promoted_sha256 ~ '^[a-f0-9]{64}$'
  ),
  add constraint promoted_upload_requires_hash check (
    status <> 'promoted'
    or (
      promoted_object_path is not null
      and promoted_sha256 is not null
      and promoted_sha256 ~ '^[a-f0-9]{64}$'
    )
  );

alter table public.upload_quarantine
  drop constraint if exists upload_quarantine_status_check;

alter table public.upload_quarantine
  add constraint upload_quarantine_status_check check (status in (
    'quarantined', 'scanning', 'safe', 'rejected', 'failed',
    'promoted', 'purging'
  ));

create table public.professional_profiles (
  person_id uuid primary key
    references public.people(id) on delete cascade,
  public_slug text not null unique
    check (
      char_length(public_slug) between 8 and 80
      and public_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    ),
  public_name text not null
    check (char_length(public_name) between 2 and 80),
  headline text not null default ''
    check (char_length(headline) <= 120),
  website_url text
    check (
      website_url is null
      or (
        char_length(website_url) <= 500
        and website_url ~* '^https?://'
        and website_url !~ '[[:space:]<>"]'
      )
    ),
  biography text not null default ''
    check (char_length(biography) <= 1000),
  expertise text[] not null default '{}'::text[]
    check (cardinality(expertise) <= 12),
  interests text[] not null default '{}'::text[]
    check (cardinality(interests) <= 12),
  avatar_upload_id uuid
    references public.upload_quarantine(id),
  cover_upload_id uuid
    references public.upload_quarantine(id),
  is_public boolean not null default false,
  show_about boolean not null default false,
  show_completed_courses boolean not null default false,
  show_teaching_courses boolean not null default false,
  version bigint not null default 1 check (version > 0),
  published_at timestamptz,
  moderation_hidden_at timestamptz,
  moderation_reason text
    check (
      moderation_reason is null
      or char_length(moderation_reason) between 3 and 500
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (moderation_hidden_at is null and moderation_reason is null)
    or (moderation_hidden_at is not null and moderation_reason is not null)
  )
);

create index professional_profiles_avatar_upload_idx
  on public.professional_profiles(avatar_upload_id)
  where avatar_upload_id is not null;

create index professional_profiles_cover_upload_idx
  on public.professional_profiles(cover_upload_id)
  where cover_upload_id is not null;

create index upload_quarantine_promoted_path_idx
  on public.upload_quarantine(promoted_object_path)
  where status = 'promoted' and promoted_object_path is not null;

create index upload_quarantine_profile_purge_idx
  on public.upload_quarantine(purge_after, id)
  where purpose in ('profile_avatar', 'profile_cover')
    and purge_after is not null;

create index if not exists course_instructors_instructor_version_idx
  on public.course_instructors(instructor_id, course_version_id);

alter table public.professional_profiles enable row level security;
alter table public.professional_profiles force row level security;

revoke all on table public.professional_profiles
  from public, anon, authenticated, service_role;

grant select on table public.professional_profiles to authenticated;
grant select on table public.professional_profiles to service_role;

create policy professional_profiles_owner_read
on public.professional_profiles
for select
to authenticated
using (person_id = internal.request_person_id());

-- Keep the learner dashboard available after a purchased course stops selling.
-- This only exposes the course shell to the learner who still owns the active
-- entitlement; it does not relax the anonymous catalog policy.
create policy learner_owned_courses_read
on public.courses
for select
to authenticated
using (
  exists (
    select 1
    from public.course_versions version
    join public.enrollments enrollment
      on enrollment.course_version_id = version.id
    join public.entitlements entitlement
      on entitlement.id = enrollment.entitlement_id
    where version.course_id = courses.id
      and enrollment.person_id = internal.request_person_id()
      and enrollment.status not in ('rejected', 'revoked', 'refunded')
      and entitlement.person_id = enrollment.person_id
      and entitlement.status = 'active'
  )
);

create or replace function internal.upsert_own_professional_profile(
  submitted_public_name text,
  submitted_headline text,
  submitted_website_url text,
  submitted_biography text,
  submitted_expertise text[],
  submitted_interests text[],
  submitted_is_public boolean,
  submitted_show_about boolean,
  submitted_show_completed_courses boolean,
  submitted_show_teaching_courses boolean,
  expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  clean_name text := trim(coalesce(submitted_public_name, ''));
  clean_headline text := trim(coalesce(submitted_headline, ''));
  clean_website text := nullif(trim(coalesce(submitted_website_url, '')), '');
  clean_biography text := trim(coalesce(submitted_biography, ''));
  clean_expertise text[];
  clean_interests text[];
  profile_row public.professional_profiles%rowtype;
begin
  select coalesce(array_agg(value order by value), '{}'::text[])
    into clean_expertise
  from (
    select distinct trim(item) as value
    from unnest(coalesce(submitted_expertise, '{}'::text[])) item
    where trim(item) <> ''
  ) normalized;

  select coalesce(array_agg(value order by value), '{}'::text[])
    into clean_interests
  from (
    select distinct trim(item) as value
    from unnest(coalesce(submitted_interests, '{}'::text[])) item
    where trim(item) <> ''
  ) normalized;

  if char_length(clean_name) not between 2 and 80
     or char_length(clean_headline) > 120
     or char_length(clean_biography) > 1000
     or cardinality(clean_expertise) > 12
     or cardinality(clean_interests) > 12
     or exists (
       select 1 from unnest(clean_expertise) item
       where char_length(item) not between 2 and 40
     )
     or exists (
       select 1 from unnest(clean_interests) item
       where char_length(item) not between 2 and 40
     )
     or (
       clean_website is not null
       and (
         char_length(clean_website) > 500
         or clean_website !~* '^https?://'
         or clean_website ~ '[[:space:]<>"]'
         or clean_website like '%''%'
       )
     )
     or expected_version is null
     or expected_version < 0
  then
    raise exception 'PROFESSIONAL_PROFILE_INVALID';
  end if;

  select profile.* into profile_row
  from public.professional_profiles profile
  where profile.person_id = actor
  for update;

  if found then
    if profile_row.version <> expected_version then
      raise exception 'PROFESSIONAL_PROFILE_VERSION_CONFLICT';
    end if;
    update public.professional_profiles profile
    set public_name = clean_name,
        headline = clean_headline,
        website_url = clean_website,
        biography = clean_biography,
        expertise = clean_expertise,
        interests = clean_interests,
        is_public = submitted_is_public,
        show_about = submitted_show_about,
        show_completed_courses = submitted_show_completed_courses,
        show_teaching_courses = submitted_show_teaching_courses,
        published_at = case
          when submitted_is_public
            then coalesce(profile.published_at, now())
          else profile.published_at
        end,
        version = profile.version + 1,
        updated_at = now()
    where profile.person_id = actor
    returning profile.* into profile_row;
  else
    if expected_version <> 0 then
      raise exception 'PROFESSIONAL_PROFILE_VERSION_CONFLICT';
    end if;
    insert into public.professional_profiles (
      person_id, public_slug, public_name, headline, website_url,
      biography, expertise, interests, is_public, show_about,
      show_completed_courses, show_teaching_courses, published_at
    ) values (
      actor,
      'member-' || replace(gen_random_uuid()::text, '-', ''),
      clean_name,
      clean_headline,
      clean_website,
      clean_biography,
      clean_expertise,
      clean_interests,
      submitted_is_public,
      submitted_show_about,
      submitted_show_completed_courses,
      submitted_show_teaching_courses,
      case when submitted_is_public then now() else null end
    )
    returning * into profile_row;
  end if;

  perform internal.append_audit_event(
    actor,
    'professional_profile.updated',
    'professional_profile',
    actor::text,
    'learner updated public-safe professional profile fields',
    null,
    jsonb_build_object(
      'version', profile_row.version,
      'isPublic', profile_row.is_public,
      'showAbout', profile_row.show_about,
      'showCompletedCourses', profile_row.show_completed_courses,
      'showTeachingCourses', profile_row.show_teaching_courses
    )
  );

  return jsonb_build_object(
    'slug', profile_row.public_slug,
    'version', profile_row.version,
    'updatedAt', profile_row.updated_at
  );
end
$$;

revoke all on function internal.upsert_own_professional_profile(
  text, text, text, text, text[], text[],
  boolean, boolean, boolean, boolean, bigint
) from public, anon, authenticated, service_role;

create or replace function public.upsert_own_professional_profile(
  p_public_name text,
  p_headline text,
  p_website_url text,
  p_biography text,
  p_expertise text[],
  p_interests text[],
  p_is_public boolean,
  p_show_about boolean,
  p_show_completed_courses boolean,
  p_show_teaching_courses boolean,
  p_expected_version bigint
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.upsert_own_professional_profile(
    p_public_name,
    p_headline,
    p_website_url,
    p_biography,
    p_expertise,
    p_interests,
    p_is_public,
    p_show_about,
    p_show_completed_courses,
    p_show_teaching_courses,
    p_expected_version
  )
$$;

revoke all on function public.upsert_own_professional_profile(
  text, text, text, text, text[], text[],
  boolean, boolean, boolean, boolean, bigint
) from public, anon, authenticated, service_role;

create or replace function internal.schedule_profile_media_purge(
  target_upload uuid,
  scheduled_for timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if target_upload is null
     or scheduled_for is null
     or scheduled_for <= now()
  then
    raise exception 'PROFILE_MEDIA_PURGE_SCHEDULE_INVALID';
  end if;

  update public.upload_quarantine upload
  set purge_after = scheduled_for
  where upload.id = target_upload
    and upload.purpose in ('profile_avatar', 'profile_cover');

  if found then
    insert into public.durable_jobs (
      job_type, business_key, payload, available_at
    ) values (
      'profile_media_purge',
      'profile-media-purge:' || target_upload::text || ':' ||
        replace(gen_random_uuid()::text, '-', ''),
      jsonb_build_object('uploadId', target_upload),
      scheduled_for
    );
  end if;
end
$$;

revoke all on function internal.schedule_profile_media_purge(
  uuid, timestamptz
) from public, anon, authenticated, service_role;

create or replace function internal.bind_own_professional_profile_media(
  submitted_kind text,
  submitted_upload_id uuid,
  expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  required_purpose text;
  profile_row public.professional_profiles%rowtype;
  upload_row public.upload_quarantine%rowtype;
  previous_upload_id uuid;
begin
  if submitted_kind is null
     or submitted_kind not in ('avatar', 'cover')
     or expected_version is null
     or expected_version < 0
  then
    raise exception 'PROFESSIONAL_PROFILE_MEDIA_INVALID';
  end if;
  required_purpose := case
    when submitted_kind = 'avatar' then 'profile_avatar'
    else 'profile_cover'
  end;

  select profile.* into profile_row
  from public.professional_profiles profile
  where profile.person_id = actor
  for update;

  if not found then
    if expected_version <> 0 then
      raise exception 'PROFESSIONAL_PROFILE_VERSION_CONFLICT';
    end if;
    insert into public.professional_profiles (
      person_id, public_slug, public_name
    ) values (
      actor,
      'member-' || replace(gen_random_uuid()::text, '-', ''),
      '歲悅學員'
    )
    returning * into profile_row;
  elsif profile_row.version <> expected_version then
    raise exception 'PROFESSIONAL_PROFILE_VERSION_CONFLICT';
  end if;

  if submitted_upload_id is not null then
    select upload.* into upload_row
    from public.upload_quarantine upload
    where upload.id = submitted_upload_id
      and upload.owner_person_id = actor
      and upload.purpose = required_purpose
      and upload.status = 'promoted'
      and upload.detected_mime in ('image/jpeg', 'image/png')
      and upload.metadata_stripped
      and upload.promoted_object_path is not null
      and upload.promoted_sha256 ~ '^[a-f0-9]{64}$'
    for update;
    if not found then
      raise exception 'SAFE_PROFILE_MEDIA_REQUIRED';
    end if;
  end if;

  previous_upload_id := case
    when submitted_kind = 'avatar' then profile_row.avatar_upload_id
    else profile_row.cover_upload_id
  end;

  if submitted_kind = 'avatar' then
    update public.professional_profiles profile
    set avatar_upload_id = submitted_upload_id,
        version = profile.version + 1,
        updated_at = now()
    where profile.person_id = actor
    returning profile.* into profile_row;
  else
    update public.professional_profiles profile
    set cover_upload_id = submitted_upload_id,
        version = profile.version + 1,
        updated_at = now()
    where profile.person_id = actor
    returning profile.* into profile_row;
  end if;

  if submitted_upload_id is not null then
    update public.upload_quarantine
    set purge_after = null
    where id = submitted_upload_id;
  end if;

  if previous_upload_id is not null
     and previous_upload_id is distinct from submitted_upload_id
     and previous_upload_id is distinct from profile_row.avatar_upload_id
     and previous_upload_id is distinct from profile_row.cover_upload_id
  then
    perform internal.schedule_profile_media_purge(
      previous_upload_id,
      now() + interval '7 days'
    );
  end if;

  perform internal.append_audit_event(
    actor,
    'professional_profile.media_bound',
    'professional_profile',
    actor::text,
    'learner changed a scanned professional profile image',
    null,
    jsonb_build_object(
      'kind', submitted_kind,
      'version', profile_row.version,
      'removed', submitted_upload_id is null
    )
  );

  return jsonb_build_object(
    'slug', profile_row.public_slug,
    'version', profile_row.version,
    'updatedAt', profile_row.updated_at
  );
end
$$;

revoke all on function internal.bind_own_professional_profile_media(
  text, uuid, bigint
) from public, anon, authenticated, service_role;

create or replace function public.bind_own_professional_profile_media(
  p_kind text,
  p_upload_id uuid,
  p_expected_version bigint
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.bind_own_professional_profile_media(
    p_kind, p_upload_id, p_expected_version
  )
$$;

revoke all on function public.bind_own_professional_profile_media(
  text, uuid, bigint
) from public, anon, authenticated, service_role;

grant execute on function internal.upsert_own_professional_profile(
  text, text, text, text, text[], text[],
  boolean, boolean, boolean, boolean, bigint
) to authenticated;

grant execute on function public.upsert_own_professional_profile(
  text, text, text, text, text[], text[],
  boolean, boolean, boolean, boolean, bigint
) to authenticated;

grant execute on function internal.bind_own_professional_profile_media(
  text, uuid, bigint
) to authenticated;

grant execute on function public.bind_own_professional_profile_media(
  text, uuid, bigint
) to authenticated;

create or replace function internal.detach_anonymized_professional_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  prior_avatar uuid;
  prior_cover uuid;
begin
  if old.anonymized_at is null and new.anonymized_at is not null then
    select profile.avatar_upload_id, profile.cover_upload_id
      into prior_avatar, prior_cover
    from public.professional_profiles profile
    where profile.person_id = new.id
    for update;

    if found then
      update public.professional_profiles profile
      set public_name = '已刪除的學員',
          headline = '',
          website_url = null,
          biography = '',
          expertise = '{}'::text[],
          interests = '{}'::text[],
          avatar_upload_id = null,
          cover_upload_id = null,
          is_public = false,
          show_about = false,
          show_completed_courses = false,
          show_teaching_courses = false,
          version = profile.version + 1,
          updated_at = now()
      where profile.person_id = new.id;

      if prior_avatar is not null then
        perform internal.schedule_profile_media_purge(
          prior_avatar,
          now() + interval '7 days'
        );
      end if;
      if prior_cover is not null
         and prior_cover is distinct from prior_avatar
      then
        perform internal.schedule_profile_media_purge(
          prior_cover,
          now() + interval '7 days'
        );
      end if;
    end if;
  end if;
  return new;
end
$$;

revoke all on function internal.detach_anonymized_professional_profile()
  from public, anon, authenticated, service_role;

create trigger detach_anonymized_professional_profile
after update of anonymized_at on public.people
for each row
when (
  old.anonymized_at is null
  and new.anonymized_at is not null
)
execute function internal.detach_anonymized_professional_profile();

create or replace function internal.release_deleted_professional_profile_media()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.avatar_upload_id is not null then
    perform internal.schedule_profile_media_purge(
      old.avatar_upload_id,
      now() + interval '7 days'
    );
  end if;
  if old.cover_upload_id is not null
     and old.cover_upload_id is distinct from old.avatar_upload_id
  then
    perform internal.schedule_profile_media_purge(
      old.cover_upload_id,
      now() + interval '7 days'
    );
  end if;
  return old;
end
$$;

revoke all on function internal.release_deleted_professional_profile_media()
  from public, anon, authenticated, service_role;

create trigger release_deleted_professional_profile_media
after delete on public.professional_profiles
for each row
execute function internal.release_deleted_professional_profile_media();

create or replace function internal.claim_profile_media_purge(
  target_upload uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  upload_row public.upload_quarantine%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or target_upload is null
  then
    raise exception 'PROFILE_MEDIA_PURGE_SERVICE_REQUIRED';
  end if;

  select upload.* into upload_row
  from public.upload_quarantine upload
  where upload.id = target_upload
    and upload.purpose in ('profile_avatar', 'profile_cover')
    and upload.purge_after <= now()
    and upload.status in ('promoted', 'rejected', 'failed', 'purging')
    and not exists (
      select 1
      from public.professional_profiles profile
      where profile.avatar_upload_id = upload.id
         or profile.cover_upload_id = upload.id
    )
  for update;

  if not found then
    return jsonb_build_object('claimed', false);
  end if;

  update public.upload_quarantine
  set status = 'purging'
  where id = upload_row.id;

  return jsonb_build_object(
    'claimed', true,
    'quarantineObjectPath', upload_row.object_path,
    'promotedObjectPath', upload_row.promoted_object_path
  );
end
$$;

revoke all on function internal.claim_profile_media_purge(uuid)
  from public, anon, authenticated;

grant execute on function internal.claim_profile_media_purge(uuid)
  to service_role;

create or replace function internal.finalize_profile_media_purge(
  target_upload uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or target_upload is null
  then
    raise exception 'PROFILE_MEDIA_PURGE_SERVICE_REQUIRED';
  end if;

  delete from public.upload_quarantine upload
  where upload.id = target_upload
    and upload.status = 'purging'
    and upload.purpose in ('profile_avatar', 'profile_cover')
    and upload.purge_after <= now()
    and not exists (
      select 1
      from public.professional_profiles profile
      where profile.avatar_upload_id = upload.id
         or profile.cover_upload_id = upload.id
    );

  return found;
end
$$;

revoke all on function internal.finalize_profile_media_purge(uuid)
  from public, anon, authenticated;

grant execute on function internal.finalize_profile_media_purge(uuid)
  to service_role;

-- Extend the existing quarantine registrar without exposing the service key.
create or replace function internal.register_quarantine_upload(
  target_upload uuid,
  target_owner uuid,
  submitted_purpose text,
  submitted_object_path text,
  submitted_declared_mime text,
  submitted_byte_size bigint,
  submitted_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or submitted_purpose not in (
       'payment_proof', 'identity_correction', 'course_material',
       'organization_roster', 'bank_statement',
       'profile_avatar', 'profile_cover'
     )
     or submitted_object_path = ''
     or submitted_declared_mime not in (
       'image/jpeg', 'image/png', 'application/pdf',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'text/csv'
     )
     or (
       submitted_purpose in ('profile_avatar', 'profile_cover')
       and submitted_declared_mime not in ('image/jpeg', 'image/png')
     )
     or submitted_byte_size not between 1 and 10000000
     or (
       submitted_purpose in ('profile_avatar', 'profile_cover')
       and submitted_byte_size > 5000000
     )
     or submitted_sha256 !~ '^[a-f0-9]{64}$'
     or not exists (
       select 1 from public.people person where person.id = target_owner
     )
  then raise exception 'QUARANTINE_UPLOAD_REJECTED'; end if;
  insert into public.upload_quarantine (
    id, owner_person_id, purpose, object_path, declared_mime,
    byte_size, content_sha256
  ) values (
    target_upload, target_owner, submitted_purpose,
    submitted_object_path, submitted_declared_mime,
    submitted_byte_size, submitted_sha256
  );
  insert into public.durable_jobs (
    job_type, business_key, payload
  ) values (
    'quarantine_scan', 'quarantine-scan:' || target_upload::text,
    jsonb_build_object('uploadId', target_upload)
  );
  return target_upload;
end
$$;

revoke all on function internal.register_quarantine_upload(
  uuid, uuid, text, text, text, bigint, text
) from public, anon, authenticated;

grant execute on function internal.register_quarantine_upload(
  uuid, uuid, text, text, text, bigint, text
) to service_role;

-- Store the hash of the sanitized object, not only the original upload hash.
create or replace function internal.finish_quarantine_scan(
  target_upload uuid,
  is_safe boolean,
  submitted_detected_mime text,
  submitted_archive_entries integer,
  submitted_expanded_bytes bigint,
  submitted_metadata_stripped boolean,
  submitted_promoted_path text,
  submitted_result jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  next_status text;
  sanitized_sha256 text := submitted_result ->> 'sanitizedSha256';
  scanned_purpose text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or is_safe is null
     or submitted_detected_mime is null
     or submitted_detected_mime = ''
     or (
       is_safe
       and (
         submitted_promoted_path is null
         or sanitized_sha256 is null
         or sanitized_sha256 !~ '^[a-f0-9]{64}$'
       )
     )
  then raise exception 'QUARANTINE_SCAN_REJECTED'; end if;
  next_status := case when is_safe then 'promoted' else 'rejected' end;
  update public.upload_quarantine
  set status = next_status,
      detected_mime = submitted_detected_mime,
      archive_entry_count = submitted_archive_entries,
      expanded_byte_size = submitted_expanded_bytes,
      metadata_stripped = submitted_metadata_stripped,
      promoted_object_path = case when is_safe
        then submitted_promoted_path else null end,
      promoted_sha256 = case when is_safe
        then sanitized_sha256 else null end,
      scanner_result = submitted_result,
      scanned_at = now(),
      purge_after = case when is_safe
        then now() + interval '30 days' else now() + interval '7 days' end
  where id = target_upload
    and status in ('quarantined', 'scanning')
  returning purpose into scanned_purpose;
  if not found then raise exception 'QUARANTINE_STATE_MISMATCH'; end if;
  if scanned_purpose in ('profile_avatar', 'profile_cover') then
    perform internal.schedule_profile_media_purge(
      target_upload,
      now() + case
        when is_safe then interval '30 days'
        else interval '7 days'
      end
    );
  end if;
  update public.provider_health
  set status = 'healthy', checked_at = now(), last_success_at = now(),
      updated_at = now()
  where provider = 'malware_scanner';
  return next_status;
end
$$;

revoke all on function internal.finish_quarantine_scan(
  uuid, boolean, text, integer, bigint, boolean, text, jsonb
) from public, anon, authenticated;

grant execute on function internal.finish_quarantine_scan(
  uuid, boolean, text, integer, bigint, boolean, text, jsonb
) to service_role;

create or replace function internal.read_safe_quarantine_upload(
  target_upload uuid,
  target_owner uuid,
  required_purpose text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'QUARANTINE_SERVICE_REQUIRED';
  end if;
  select jsonb_build_object(
    'objectPath', upload.promoted_object_path,
    'contentSha256', upload.promoted_sha256,
    'detectedMime', upload.detected_mime
  ) into result
  from public.upload_quarantine upload
  where upload.id = target_upload
    and upload.owner_person_id = target_owner
    and upload.purpose = required_purpose
    and upload.status = 'promoted'
    and upload.promoted_sha256 ~ '^[a-f0-9]{64}$';
  if result is null then raise exception 'SAFE_UPLOAD_REQUIRED'; end if;
  return result;
end
$$;

revoke all on function internal.read_safe_quarantine_upload(
  uuid, uuid, text
) from public, anon, authenticated;

grant execute on function internal.read_safe_quarantine_upload(
  uuid, uuid, text
) to service_role;

-- Append safe course identifiers used by learner-facing profile cards. Existing
-- column order is preserved and the new fields are added only at the end.
create or replace view public.learner_dashboard
with (security_invoker = true)
as
select
  enrollment.id as enrollment_id,
  version.title as course_title,
  version.delivery_type,
  enrollment.status as enrollment_status,
  coalesce(progress.confirmed_valid_seconds, 0) as confirmed_valid_seconds,
  coalesce(requirement.required_watch_seconds, 0) as required_seconds,
  (
    select min(session.starts_at)
    from public.live_bookings booking
    join public.live_sessions session
      on session.id = booking.live_session_id
    where booking.enrollment_id = enrollment.id
      and (
        booking.status = 'confirmed'
        or (
          booking.status = 'held'
          and booking.hold_expires_at > clock_timestamp()
        )
      )
      and session.starts_at > now()
  ) as next_live_starts_at,
  case
    when exists (
      select 1
      from public.live_bookings booking
      join public.attendance_summaries attendance
        on attendance.live_booking_id = booking.id
      where booking.enrollment_id = enrollment.id
        and attendance.quarantined_at is not null
    ) then 'needs_correction'
    else certificate.current_status
  end as certificate_status,
  certificate.id as certificate_id,
  version.id as course_version_id,
  course.slug as course_slug,
  enrollment.completed_at,
  version.has_cover
from public.enrollments enrollment
join public.course_versions version
  on version.id = enrollment.course_version_id
join public.courses course
  on course.id = version.course_id
left join public.progress_summaries progress
  on progress.enrollment_id = enrollment.id
left join public.course_requirements requirement
  on requirement.course_version_id = version.id
left join public.certificates certificate
  on certificate.enrollment_id = enrollment.id;

grant select on public.learner_dashboard to authenticated;
