-- Teaching-quality staff author the course and registration page, while a
-- platform administrator (the executive approver) remains the only role that
-- can publish it. Email sign-in stays closed to the public: only server-created
-- accounts carrying protected app_metadata can pass the Auth hooks below.

alter table public.course_versions
  add column if not exists registration_mode text not null default 'internal',
  add column if not exists external_registration_url text,
  add column if not exists registration_cta_label text not null
    default '報名活動';

alter table public.course_versions
  drop constraint if exists course_versions_registration_mode_check,
  add constraint course_versions_registration_mode_check
    check (registration_mode in ('internal', 'google_form')),
  drop constraint if exists course_versions_registration_cta_check,
  add constraint course_versions_registration_cta_check
    check (length(trim(registration_cta_label)) between 2 and 20),
  drop constraint if exists course_versions_registration_target_check,
  add constraint course_versions_registration_target_check check (
    (
      registration_mode = 'internal'
      and external_registration_url is null
    )
    or (
      registration_mode = 'google_form'
      and external_registration_url is not null
      and external_registration_url = trim(external_registration_url)
      and (
        external_registration_url ~
          '^https://forms\.gle/[A-Za-z0-9_-]+(?:[?#][A-Za-z0-9._~!$&()*+,;=:@%/?-]*)?$'
        or external_registration_url ~
          '^https://docs\.google\.com/forms/d/(?:e/)?[A-Za-z0-9_-]+/viewform(?:[?#][A-Za-z0-9._~!$&()*+,;=:@%/?-]*)?$'
      )
    )
  );

comment on column public.course_versions.registration_mode is
  'internal uses the platform contract/cart; google_form redirects to an approved Google Form';
comment on column public.course_versions.external_registration_url is
  'Draft-owned Google Forms registration target; immutable after publication';

-- The security-invoker catalog view below needs explicit access to its newly
-- projected columns. RLS still limits direct browser reads to published rows.
grant select (
  registration_mode, external_registration_url, registration_cta_label
) on public.course_versions to anon, authenticated, service_role;

create or replace function internal.update_course_registration_settings(
  target_version uuid,
  submitted_mode text,
  submitted_url text,
  submitted_cta_label text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  prior public.idempotency_records%rowtype;
  normalized_url text := nullif(trim(submitted_url), '');
  normalized_label text := trim(coalesce(submitted_cta_label, ''));
  request_hash text;
  result jsonb;
begin
  if not internal.has_staff_role('course_admin')
     or target_version is null
     or idempotency is null
     or submitted_mode not in ('internal', 'google_form')
     or length(normalized_label) not between 2 and 20
     or (
       submitted_mode = 'internal'
       and normalized_url is not null
     )
     or (
       submitted_mode = 'google_form'
       and (
         normalized_url is null
         or not (
           normalized_url ~
             '^https://forms\.gle/[A-Za-z0-9_-]+(?:[?#][A-Za-z0-9._~!$&()*+,;=:@%/?-]*)?$'
           or normalized_url ~
             '^https://docs\.google\.com/forms/d/(?:e/)?[A-Za-z0-9_-]+/viewform(?:[?#][A-Za-z0-9._~!$&()*+,;=:@%/?-]*)?$'
         )
       )
     )
  then
    raise exception 'COURSE_REGISTRATION_SETTINGS_INVALID';
  end if;

  if not exists (
    select 1
    from public.course_versions version
    where version.id = target_version
      and version.status = 'draft'
      and (
        version.created_by = actor
        or internal.has_exact_staff_role('platform_admin')
      )
  ) then
    raise exception 'COURSE_REGISTRATION_SETTINGS_FORBIDDEN';
  end if;

  request_hash := internal.canonical_request_hash(jsonb_build_object(
    'courseVersionId', target_version,
    'registrationMode', submitted_mode,
    'externalRegistrationUrl', normalized_url,
    'registrationCtaLabel', normalized_label
  ));
  select record.* into prior
  from public.idempotency_records record
  where record.actor_id = actor
    and record.operation = 'course_registration_settings'
    and record.idempotency_key = idempotency
  for update;
  if found then
    if prior.request_hash <> request_hash
       or prior.completed_at is null
       or prior.response_body is null
    then
      raise exception 'IDEMPOTENCY_REQUEST_CONFLICT';
    end if;
    return prior.response_body;
  end if;

  insert into public.idempotency_records (
    actor_id, operation, idempotency_key, request_hash, locked_until
  ) values (
    actor, 'course_registration_settings', idempotency, request_hash,
    clock_timestamp() + interval '1 minute'
  )
  on conflict (actor_id, operation, idempotency_key) do nothing;
  if not found then
    raise exception 'IDEMPOTENCY_REQUEST_CONFLICT';
  end if;

  update public.course_versions version
  set registration_mode = submitted_mode,
      external_registration_url = case
        when submitted_mode = 'google_form' then normalized_url
        else null
      end,
      registration_cta_label = normalized_label
  where version.id = target_version
    and version.status = 'draft'
    and (
      version.created_by = actor
      or internal.has_exact_staff_role('platform_admin')
    );
  if not found then
    raise exception 'COURSE_REGISTRATION_SETTINGS_FORBIDDEN';
  end if;

  result := jsonb_build_object(
    'courseVersionId', target_version,
    'registrationMode', submitted_mode,
    'externalRegistrationUrl', case
      when submitted_mode = 'google_form' then normalized_url
      else null
    end,
    'registrationCtaLabel', normalized_label
  );
  update public.idempotency_records
  set response_status = 200,
      response_body = result,
      completed_at = clock_timestamp(),
      locked_until = null
  where actor_id = actor
    and operation = 'course_registration_settings'
    and idempotency_key = idempotency;
  perform internal.append_audit_event(
    actor,
    'course.registration_settings_updated',
    'course_version',
    target_version::text,
    'teaching-quality registration page update',
    null,
    jsonb_build_object(
      'registrationMode', submitted_mode,
      'hasExternalRegistrationUrl', normalized_url is not null,
      'registrationCtaLabel', normalized_label
    )
  );
  return result;
end
$$;

revoke all on function internal.update_course_registration_settings(
  uuid, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.update_course_registration_settings(
  uuid, text, text, text, uuid
) to authenticated;

create or replace function public.update_course_registration_settings(
  p_course_version_id uuid,
  p_registration_mode text,
  p_external_registration_url text,
  p_registration_cta_label text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.update_course_registration_settings(
    p_course_version_id,
    p_registration_mode,
    p_external_registration_url,
    p_registration_cta_label,
    p_idempotency_key
  )
$$;

revoke all on function public.update_course_registration_settings(
  uuid, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.update_course_registration_settings(
  uuid, text, text, text, uuid
) to authenticated;

create or replace function internal.read_education_quality_workspace()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  result jsonb;
begin
  if not internal.has_staff_role('course_admin') then
    raise exception 'COURSE_ADMIN_REQUIRED';
  end if;
  select jsonb_build_object(
    'courses', coalesce(jsonb_agg(jsonb_build_object(
      'courseVersionId', version.id,
      'slug', course.slug,
      'version', version.version,
      'title', version.title,
      'summary', version.summary,
      'deliveryType', version.delivery_type,
      'status', version.status,
      'registrationMode', version.registration_mode,
      'externalRegistrationUrl', version.external_registration_url,
      'registrationCtaLabel', version.registration_cta_label,
      'hasCover', version.has_cover,
      'canEdit', version.status = 'draft',
      'canSubmit', version.status = 'draft',
      'submittedAt', version.submitted_at,
      'publishedAt', version.published_at,
      'updatedAt', coalesce(
        version.published_at,
        version.submitted_at,
        version.created_at
      )
    ) order by
      case version.status
        when 'draft' then 0
        when 'in_review' then 1
        when 'published' then 2
        when 'suspended' then 3
        else 4
      end,
      coalesce(version.published_at, version.submitted_at, version.created_at)
        desc,
      version.id), '[]'::jsonb)
  ) into result
  from public.course_versions version
  join public.courses course on course.id = version.course_id
  where version.status <> 'archived'
    and course.archived_at is null
    and (
      version.created_by = actor
      or internal.has_exact_staff_role('platform_admin')
    );
  return result;
end
$$;

revoke all on function internal.read_education_quality_workspace()
  from public, anon, authenticated, service_role;
grant execute on function internal.read_education_quality_workspace()
  to authenticated;

create or replace function public.read_education_quality_workspace()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_education_quality_workspace()
$$;

revoke all on function public.read_education_quality_workspace()
  from public, anon, authenticated, service_role;
grant execute on function public.read_education_quality_workspace()
  to authenticated;

-- The previous migration granted the internal idempotent implementation to
-- authenticated callers. Revoke that bypass and expose one guarded internal
-- capability behind the public SECURITY INVOKER facade.
revoke all on function internal.publish_course_version_idempotent(
  uuid, text, text, uuid
) from public, anon, authenticated, service_role;

create or replace function internal.publish_course_version_as_platform_admin(
  target_version uuid,
  submitted_reason text,
  submitted_nonce_hash text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not internal.has_exact_staff_role('platform_admin') then
    raise exception 'EXECUTIVE_APPROVAL_REQUIRED';
  end if;
  return internal.publish_course_version_idempotent(
    target_version,
    submitted_reason,
    submitted_nonce_hash,
    idempotency
  );
end
$$;

revoke all on function internal.publish_course_version_as_platform_admin(
  uuid, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.publish_course_version_as_platform_admin(
  uuid, text, text, uuid
) to authenticated;

create or replace function public.publish_course_version(
  p_course_version_id uuid,
  p_reason text,
  p_nonce_hash text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.publish_course_version_as_platform_admin(
    p_course_version_id,
    p_reason,
    p_nonce_hash,
    p_idempotency_key
  )
$$;

revoke all on function public.publish_course_version(
  uuid, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.publish_course_version(
  uuid, text, text, uuid
) to authenticated;

-- Public staff-email signup remains unavailable. Only Auth Admin-created
-- accounts with protected app_metadata pass both the before-create hook and
-- the identity trigger. Browser users cannot set raw_app_meta_data.
create or replace function internal.before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  user_record jsonb := event -> 'user';
  app_metadata jsonb := coalesce(user_record -> 'app_metadata', '{}'::jsonb);
  phone_identity boolean :=
    coalesce(user_record ->> 'phone', '') <> ''
    and coalesce(app_metadata ->> 'provider', '') = 'phone';
  protected_staff_identity boolean :=
    lower(trim(coalesce(user_record ->> 'email', ''))) =
      'edu.control@suiyuecare.com'
    and coalesce(app_metadata ->> 'provider', '') = 'email'
    and coalesce(app_metadata ->> 'account_type', '') = 'staff'
    and coalesce(app_metadata ->> 'staff_login', '') = 'true'
    and coalesce(app_metadata ->> 'staff_role', '') = 'course_admin'
    and coalesce(app_metadata ->> 'must_change_password', '') = 'true';
begin
  if internal.setting_is_true('maintenance_mode') then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 503,
        'message', 'Registration is temporarily unavailable.'
      )
    );
  end if;
  if not phone_identity and not protected_staff_identity then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Phone authentication or a pre-approved staff account is required.'
      )
    );
  end if;
  return '{}'::jsonb;
end
$$;
revoke all on function internal.before_user_created(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function internal.before_user_created(jsonb)
  to supabase_auth_admin;

create or replace function internal.handle_new_phone_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_person_id uuid;
  protected_staff_identity boolean :=
    new.email is not null
    and lower(trim(new.email)) = 'edu.control@suiyuecare.com'
    and coalesce(new.raw_app_meta_data ->> 'provider', '') = 'email'
    and coalesce(new.raw_app_meta_data ->> 'account_type', '') = 'staff'
    and coalesce(new.raw_app_meta_data ->> 'staff_login', '') = 'true'
    and coalesce(new.raw_app_meta_data ->> 'staff_role', '') = 'course_admin'
    and coalesce(
      new.raw_app_meta_data ->> 'must_change_password', ''
    ) = 'true';
  display_label text;
begin
  if new.phone is null and not protected_staff_identity then
    raise exception 'PHONE_OR_PREAPPROVED_STAFF_AUTH_REQUIRED';
  end if;
  display_label := nullif(trim(coalesce(
    new.raw_user_meta_data ->> 'display_name',
    ''
  )), '');
  insert into public.people (
    display_name,
    verified_email,
    email_verified_at
  ) values (
    case
      when protected_staff_identity then coalesce(display_label, '教學品管')
      else null
    end,
    case when protected_staff_identity then lower(new.email) else null end,
    case
      when protected_staff_identity then coalesce(new.email_confirmed_at, now())
      else null
    end
  ) returning id into new_person_id;
  insert into public.auth_identities (
    person_id, auth_user_id, restricted, restriction_reason
  ) values (
    new_person_id, new.id, false, null
  );
  return new;
end
$$;
revoke all on function internal.handle_new_phone_identity()
  from public, anon, authenticated, service_role;

create or replace function internal.provision_education_quality_staff(
  target_auth_user uuid,
  expected_email text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_person uuid;
  normalized_email text := lower(trim(coalesce(expected_email, '')));
begin
  -- Caller authorization is enforced by the EXECUTE grants below. This also
  -- supports current sb_secret_* keys, which do not carry a JWT payload.
  if target_auth_user is null
     or normalized_email <> 'edu.control@suiyuecare.com'
     or expected_email <> normalized_email
  then
    raise exception 'STAFF_PROVISIONING_REJECTED';
  end if;
  select identity.person_id into target_person
  from auth.users account
  join public.auth_identities identity
    on identity.auth_user_id = account.id
   and identity.active
   and not identity.restricted
  where account.id = target_auth_user
    and lower(trim(account.email)) = normalized_email
    and account.email_confirmed_at is not null
    and account.raw_app_meta_data ->> 'account_type' = 'staff'
    and account.raw_app_meta_data ->> 'staff_login' = 'true'
    and account.raw_app_meta_data ->> 'staff_role' = 'course_admin'
    and account.raw_app_meta_data ->> 'must_change_password' = 'true';
  if target_person is null then
    raise exception 'PREAPPROVED_STAFF_IDENTITY_REQUIRED';
  end if;
  insert into public.staff_roles (
    person_id, role, active, revoked_at
  ) values (
    target_person, 'course_admin', true, null
  ) on conflict (person_id, role) do update
    set active = true, revoked_at = null;
  perform internal.append_audit_event(
    null,
    'staff.education_quality_provisioned',
    'person',
    target_person::text,
    'authorized teaching-quality staff account provisioning',
    null,
    jsonb_build_object(
      'role', 'course_admin',
      'emailDomain', 'suiyuecare.com',
      'serviceProvisioned', true
    )
  );
  return jsonb_build_object(
    'personId', target_person,
    'role', 'course_admin',
    'active', true
  );
end
$$;

revoke all on function internal.provision_education_quality_staff(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function internal.provision_education_quality_staff(uuid, text)
  to service_role;

create or replace function public.provision_education_quality_staff(
  p_auth_user_id uuid,
  p_expected_email text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.provision_education_quality_staff(
    p_auth_user_id,
    p_expected_email
  )
$$;

revoke all on function public.provision_education_quality_staff(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.provision_education_quality_staff(uuid, text)
  to service_role;

-- Recreate the security-invoker catalog view with the registration projection
-- appended. Draft and in-review URLs never enter this view.
create or replace view public.published_course_catalog
with (security_invoker = true)
as
select
  course.slug,
  version.id as course_version_id,
  version.title,
  version.summary,
  version.description,
  version.learning_objectives,
  version.delivery_type,
  version.price_twd,
  version.organization_point_price,
  version.recorded_refund_allocation_twd,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'componentId', allocation.component_id,
      'title', allocation.title,
      'amountTwd', allocation.amount_twd
    ) order by allocation.title, allocation.component_id)
    from (
      select
        component.id as component_id,
        component.title,
        component.refund_allocation_twd as amount_twd
      from public.hybrid_components component
      where component.course_version_id = version.id
        and component.component_type = 'live'
      union all
      select
        version.id,
        version.title || '（直播）',
        coalesce(
          (version.live_refund_allocations ->> version.id::text)::integer,
          0
        )
      where version.delivery_type = 'live'
    ) allocation
  ), '[]'::jsonb) as live_refund_allocations,
  accreditation.status as accreditation_status,
  accreditation.points as accreditation_points,
  version.has_cover,
  version.equipment_requirements,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', instructor.display_name,
      'biography', instructor.biography,
      'credentials', instructor.credentials
    ) order by course_instructor.sort_order, instructor.id)
    from public.course_instructors course_instructor
    join public.instructors instructor
      on instructor.id = course_instructor.instructor_id
    where course_instructor.course_version_id = version.id
      and instructor.active
  ), '[]'::jsonb) as instructors,
  legal.id as legal_document_id,
  legal.content_sha256 as legal_document_sha256,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', session.id,
      'componentId', session.hybrid_component_id,
      'title', session.title,
      'startsAt', session.starts_at,
      'endsAt', session.ends_at,
      'bookingCloseAt', session.booking_close_at
    ) order by session.starts_at, session.id)
    from public.live_sessions session
    where session.course_version_id = version.id
      and session.status in ('scheduled', 'open')
      and session.booking_close_at > clock_timestamp()
  ), '[]'::jsonb) as live_sessions,
  (
    select min(session.starts_at)
    from public.live_sessions session
    where session.course_version_id = version.id
      and session.status in ('scheduled', 'open')
  ) as first_live_starts_at,
  category.code as category_code,
  category.title as category_title,
  version.registration_mode,
  version.external_registration_url,
  version.registration_cta_label
from public.courses course
join lateral (
  select
    candidate.id,
    candidate.title,
    candidate.summary,
    candidate.description,
    candidate.learning_objectives,
    candidate.category_code,
    candidate.delivery_type,
    candidate.price_twd,
    candidate.organization_point_price,
    candidate.recorded_refund_allocation_twd,
    candidate.live_refund_allocations,
    candidate.has_cover,
    candidate.equipment_requirements,
    candidate.legal_document_id,
    candidate.commerce_close_at,
    candidate.minimum_completion_window,
    candidate.registration_mode,
    candidate.external_registration_url,
    candidate.registration_cta_label
  from public.course_versions candidate
  where candidate.course_id = course.id
    and candidate.status = 'published'
  order by
    candidate.published_at desc nulls last,
    candidate.version desc,
    candidate.id
  limit 1
) version on true
join public.course_categories category
  on category.code = version.category_code
  and category.active
join lateral (
  select
    decision.status,
    decision.points,
    decision.valid_from,
    decision.valid_until
  from public.course_version_accreditation link
  join public.accreditation_decision_revisions decision
    on decision.id = link.accreditation_revision_id
  where link.course_version_id = version.id
  order by decision.revision desc, decision.id
  limit 1
) accreditation on true
join public.legal_documents legal
  on legal.id = version.legal_document_id
where course.archived_at is null
  and version.commerce_close_at > clock_timestamp()
  and accreditation.status in ('applying', 'approved')
  and accreditation.valid_from <= clock_timestamp()
  and accreditation.valid_until >
    clock_timestamp() + version.minimum_completion_window
  and legal.approved_by_legal
  and legal.effective_at <= clock_timestamp()
  and (
    legal.superseded_at is null
    or legal.superseded_at > clock_timestamp()
  );

revoke all on public.published_course_catalog
  from public, anon, authenticated, service_role;
grant select on public.published_course_catalog
  to anon, authenticated, service_role;
