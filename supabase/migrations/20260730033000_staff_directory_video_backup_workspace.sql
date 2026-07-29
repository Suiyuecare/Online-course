create or replace function internal.read_staff_role_candidates(
  search_text text,
  requested_limit integer
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
declare
  normalized_search text := nullif(trim(search_text), '');
  normalized_phone text := regexp_replace(
    coalesce(search_text, ''), '[^0-9]', '', 'g'
  );
  effective_limit integer := least(greatest(
    coalesce(requested_limit, 25), 1
  ), 50);
  result jsonb;
begin
  if not internal.has_staff_role('platform_admin') then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'personId', candidate.id,
      'displayName', coalesce(
        nullif(trim(candidate.display_name), ''), '尚未設定姓名'
      ),
      'maskedPhone', case
        when candidate.phone is null or candidate.phone = ''
          then '未提供手機'
        when length(candidate.phone) <= 6
          then repeat('•', length(candidate.phone))
        else left(candidate.phone, 3)
          || repeat('•', greatest(length(candidate.phone) - 6, 3))
          || right(candidate.phone, 3)
      end,
      'maskedEmail', case
        when candidate.verified_email is null then null
        else left(split_part(candidate.verified_email, '@', 1), 1)
          || '•••@' || split_part(candidate.verified_email, '@', 2)
      end,
      'currentRoles', coalesce((
        select jsonb_agg(role.role order by role.role)
        from public.staff_roles role
        where role.person_id = candidate.id and role.active
      ), '[]'::jsonb),
      'pendingRoles', coalesce((
        select jsonb_agg(
          request.requested_role order by request.requested_role
        )
        from public.role_approval_requests request
        where request.subject_person_id = candidate.id
          and request.requested_action = 'grant'
          and request.status = 'pending'
      ), '[]'::jsonb),
      'registeredAt', candidate.created_at
    )
    order by candidate.created_at desc, candidate.id
  ), '[]'::jsonb)
  into result
  from (
    select
      person.id,
      person.display_name,
      person.verified_email,
      person.created_at,
      account.phone
    from public.people person
    join public.auth_identities identity
      on identity.person_id = person.id
      and identity.active
      and not identity.restricted
    join auth.users account on account.id = identity.auth_user_id
    where person.anonymized_at is null
      and (
        normalized_search is null
        or person.display_name ilike '%' || normalized_search || '%'
        or person.verified_email ilike '%' || normalized_search || '%'
        or (
          length(normalized_phone) >= 3
          and (
            regexp_replace(
              coalesce(account.phone, ''), '[^0-9]', '', 'g'
            ) like '%' || normalized_phone || '%'
            or (
              normalized_phone like '0%'
              and regexp_replace(
                coalesce(account.phone, ''), '[^0-9]', '', 'g'
              ) like '%886' || substring(normalized_phone from 2)
            )
          )
        )
      )
    order by person.created_at desc, person.id
    limit effective_limit
  ) candidate;

  return result;
end
$$;

revoke all on function internal.read_staff_role_candidates(
  text, integer
) from public, anon, authenticated, service_role;

create or replace function public.read_staff_role_candidates(
  p_search text default null,
  p_limit integer default 25
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_staff_role_candidates(p_search, p_limit)
$$;

revoke all on function public.read_staff_role_candidates(
  text, integer
) from public, anon, authenticated, service_role;

grant execute on function internal.read_staff_role_candidates(
  text, integer
) to authenticated;
grant execute on function public.read_staff_role_candidates(
  text, integer
) to authenticated;

create or replace function internal.read_video_master_backup_worklist(
  target_course_version uuid
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
  if not internal.has_staff_role('course_admin') then
    raise exception 'COURSE_ADMIN_REQUIRED';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'videoAssetId', candidate.video_asset_id,
      'courseVersionId', candidate.course_version_id,
      'courseTitle', candidate.course_title,
      'lessonTitle', candidate.lesson_title,
      'status', candidate.status,
      'providerReady', candidate.provider_ready,
      'masterBackupVerified', candidate.master_backup_verified,
      'backupVerifiedAt', candidate.backup_verified_at,
      'createdAt', candidate.created_at
    )
    order by candidate.created_at desc, candidate.video_asset_id
  ), '[]'::jsonb)
  into result
  from (
    select distinct on (asset.id)
      asset.id as video_asset_id,
      version.id as course_version_id,
      version.title as course_title,
      lesson.title as lesson_title,
      asset.status,
      coalesce(
        asset.provider_payload ->> 'providerReady' = 'true', false
      ) as provider_ready,
      asset.master_backup_reference is not null
        as master_backup_verified,
      nullif(
        asset.provider_payload ->> 'masterBackupVerifiedAt', ''
      ) as backup_verified_at,
      asset.created_at
    from public.video_assets asset
    join public.lesson_video_versions video
      on video.video_asset_id = asset.id and video.active
    join public.lessons lesson on lesson.id = video.lesson_id
    join public.modules module on module.id = lesson.module_id
    join public.course_versions version
      on version.id = module.course_version_id
    where version.status = 'draft'
      and asset.status in ('uploading', 'processing', 'ready', 'failed')
      and (
        target_course_version is null
        or version.id = target_course_version
      )
    order by asset.id, video.version desc
  ) candidate;

  return result;
end
$$;

revoke all on function internal.read_video_master_backup_worklist(
  uuid
) from public, anon, authenticated, service_role;

create or replace function public.read_video_master_backup_worklist(
  p_course_version_id uuid default null
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_video_master_backup_worklist(p_course_version_id)
$$;

revoke all on function public.read_video_master_backup_worklist(
  uuid
) from public, anon, authenticated, service_role;

grant execute on function internal.read_video_master_backup_worklist(
  uuid
) to authenticated;
grant execute on function public.read_video_master_backup_worklist(
  uuid
) to authenticated;
