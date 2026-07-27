-- Default-deny every application table, including future tables created earlier
-- in this transaction. Grants below are the complete browser permission matrix.
do $security$
declare
  relation record;
begin
  for relation in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private')
      and c.relkind in ('r', 'p')
  loop
    execute format(
      'alter table %I.%I enable row level security',
      relation.schema_name, relation.table_name
    );
    execute format(
      'alter table %I.%I force row level security',
      relation.schema_name, relation.table_name
    );
    execute format(
      'revoke all on table %I.%I from public, anon, authenticated',
      relation.schema_name, relation.table_name
    );
  end loop;
end
$security$;

-- Application-owned Storage buckets are private and intentionally have no
-- browser-facing storage.objects policies. All uploads and downloads pass
-- through authenticated server routes using the service role.
insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values
  (
    'quarantine', 'quarantine', false, 10000000,
    array['application/octet-stream']::text[]
  ),
  (
    'safe-uploads', 'safe-uploads', false, 10000000,
    array[
      'image/jpeg',
      'image/png',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv'
    ]::text[]
  ),
  (
    'certificates', 'certificates', false, 20000000,
    array['application/pdf']::text[]
  ),
  (
    'legal-documents', 'legal-documents', false, 20000000,
    array['application/pdf']::text[]
  ),
  (
    'accreditation-exports', 'accreditation-exports', false, 50000000,
    array['application/json']::text[]
  )
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema internal from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

alter table private.refund_account_access_grants
  alter column refund_case_id drop not null,
  add column point_refund_case_id uuid
    references public.point_refund_cases(id),
  add constraint refund_account_access_exact_target check (
    (refund_case_id is null) <> (point_refund_case_id is null)
  );

create or replace function internal.request_person_id()
returns uuid
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select ai.person_id
  from public.auth_identities ai
  join public.people p on p.id = ai.person_id
  where ai.auth_user_id = auth.uid()
    and ai.active
    and not ai.restricted
    and ai.identity_epoch = p.identity_epoch
    and coalesce(auth.jwt() ->> 'iat', '') ~ '^[0-9]+$'
    and to_timestamp((auth.jwt() ->> 'iat')::double precision)
      >= ai.session_valid_after
  limit 1
$$;
revoke all on function internal.request_person_id() from public;

create or replace function internal.has_staff_role(required_role text)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.staff_roles sr
    where sr.person_id = internal.request_person_id()
      and sr.active
      and (
        sr.role = required_role
        or sr.role = 'platform_admin'
        or (required_role = 'support' and sr.role in (
          'course_admin', 'accreditation_reviewer', 'finance'
        ))
      )
  )
  and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;
revoke all on function internal.has_staff_role(text) from public;

create or replace function internal.has_organization_role(
  target_organization uuid,
  allowed_roles text[]
)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id
    where membership.organization_id = target_organization
      and membership.person_id = internal.request_person_id()
      and membership.active
      and membership.role = any(allowed_roles)
      and organization.status = 'approved'
  )
$$;
revoke all on function internal.has_organization_role(uuid, text[]) from public;

-- Public catalog policies. No sellable course is seeded.
create policy catalog_courses_read on public.courses
for select to anon, authenticated
using (
  exists (
    select 1 from public.course_versions cv
    where cv.course_id = courses.id
      and cv.status = 'published'
      and cv.commerce_close_at > now()
  )
);

create policy catalog_versions_read on public.course_versions
for select to anon, authenticated
using (status = 'published' and commerce_close_at > now());

create policy catalog_accreditation_links_read
on public.course_version_accreditation
for select to anon, authenticated
using (
  exists (
    select 1 from public.course_versions cv
    where cv.id = course_version_id
      and cv.status = 'published'
      and cv.commerce_close_at > now()
  )
);

create policy catalog_accreditation_read
on public.accreditation_decision_revisions
for select to anon, authenticated
using (
  status in ('applying', 'approved')
  and exists (
    select 1
    from public.course_version_accreditation cva
    join public.course_versions cv on cv.id = cva.course_version_id
    where cva.accreditation_revision_id = accreditation_decision_revisions.id
      and cv.status = 'published'
      and cv.commerce_close_at > now()
  )
);

create policy catalog_live_sessions_read on public.live_sessions
for select to anon, authenticated
using (
  status in ('scheduled', 'open')
  and exists (
    select 1 from public.course_versions cv
    where cv.id = course_version_id
      and cv.status = 'published'
      and cv.commerce_close_at > now()
  )
);

create policy catalog_course_instructors_read on public.course_instructors
for select to anon, authenticated
using (
  exists (
    select 1 from public.course_versions version
    where version.id = course_version_id
      and version.status = 'published'
      and version.commerce_close_at > now()
  )
);

create policy catalog_instructors_read on public.instructors
for select to anon, authenticated
using (
  active and exists (
    select 1
    from public.course_instructors course_instructor
    join public.course_versions version
      on version.id = course_instructor.course_version_id
    where course_instructor.instructor_id = instructors.id
      and version.status = 'published'
      and version.commerce_close_at > now()
  )
);

create policy catalog_legal_documents_read on public.legal_documents
for select to anon, authenticated
using (
  approved_by_legal
  and effective_at <= now()
  and (superseded_at is null or superseded_at > now())
  and exists (
    select 1
    from public.course_versions version
    where version.legal_document_id = legal_documents.id
      and version.status = 'published'
      and version.commerce_close_at > now()
  )
);

create policy own_notifications_read on public.notifications
for select to authenticated
using (person_id = internal.request_person_id());
create policy own_notifications_mark_read on public.notifications
for update to authenticated
using (person_id = internal.request_person_id())
with check (person_id = internal.request_person_id());

create policy own_enrollments_read on public.enrollments
for select to authenticated
using (person_id = internal.request_person_id());
create policy own_entitlements_read on public.entitlements
for select to authenticated
using (person_id = internal.request_person_id());
create policy own_progress_read on public.progress_summaries
for select to authenticated
using (
  exists (
    select 1 from public.enrollments e
    where e.id = enrollment_id
      and e.person_id = internal.request_person_id()
  )
);
create policy own_certificates_read on public.certificates
for select to authenticated
using (
  exists (
    select 1 from public.enrollments e
    where e.id = enrollment_id
      and e.person_id = internal.request_person_id()
  )
);
create policy own_bookings_read on public.live_bookings
for select to authenticated
using (person_id = internal.request_person_id());

create policy organization_memberships_scoped
on public.organization_memberships
for select to authenticated
using (
  person_id = internal.request_person_id()
  or internal.has_organization_role(
    organization_id, array['owner', 'training_manager']
  )
);
create policy organizations_scoped on public.organizations
for select to authenticated
using (
  internal.has_organization_role(
    id, array['owner', 'training_manager', 'finance', 'member']
  )
);
create policy organization_wallets_scoped on public.organization_wallets
for select to authenticated
using (
  internal.has_organization_role(
    organization_id, array['owner', 'training_manager', 'finance']
  )
);

grant select on public.courses to anon, authenticated;
grant select (
  id, course_id, version, title, summary, description, learning_objectives,
  delivery_type, status, price_twd, organization_point_price,
  recorded_refund_allocation_twd, live_refund_allocations, has_cover,
  equipment_requirements, commerce_close_at, published_at
) on public.course_versions to anon, authenticated;
grant select on public.course_version_accreditation to anon, authenticated;
grant select (
  id, course_id, status, points, valid_from, valid_until, effective_at
) on public.accreditation_decision_revisions to anon, authenticated;
grant select (
  id, course_version_id, hybrid_component_id, title, status,
  starts_at, ends_at, learner_capacity, booking_close_at
) on public.live_sessions to anon, authenticated;
grant select on public.course_instructors to anon, authenticated;
grant select (
  id, display_name, biography, credentials, active
) on public.instructors to anon, authenticated;
grant select (
  id, kind, revision, content_sha256, approved_by_legal, effective_at
) on public.legal_documents to anon, authenticated;
grant select, update (read_at) on public.notifications to authenticated;
grant select (
  id, person_id, course_version_id, status, completed_at, submitted_at,
  credited_at, created_at
) on public.enrollments to authenticated;
grant select (
  id, person_id, course_version_id, status, starts_at, ends_at
) on public.entitlements to authenticated;
grant select on public.progress_summaries to authenticated;
grant select on public.certificates to authenticated;
grant select (
  id, person_id, enrollment_id, course_version_id, live_component_id,
  live_session_id, status, change_locked_at
) on public.live_bookings to authenticated;
grant select on public.organization_memberships to authenticated;
grant select on public.organizations to authenticated;
grant select on public.organization_wallets to authenticated;

create or replace view public.published_course_catalog
with (security_invoker = true)
as
select
  c.slug,
  cv.id as course_version_id,
  cv.title,
  cv.summary,
  cv.description,
  cv.learning_objectives,
  cv.delivery_type,
  cv.price_twd,
  cv.organization_point_price,
  cv.recorded_refund_allocation_twd,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'componentId', allocation.component_id,
      'title', allocation.title,
      'amountTwd', allocation.amount_twd
    ) order by allocation.title, allocation.component_id)
    from (
      select component.id as component_id,
        component.title,
        component.refund_allocation_twd as amount_twd
      from public.hybrid_components component
      where component.course_version_id = cv.id
        and component.component_type = 'live'
      union all
      select cv.id, cv.title || '（直播）',
        coalesce(
          (cv.live_refund_allocations ->> cv.id::text)::integer, 0
        )
      where cv.delivery_type = 'live'
    ) allocation
  ), '[]'::jsonb) as live_refund_allocations,
  adr.status as accreditation_status,
  adr.points as accreditation_points,
  cv.has_cover,
  cv.equipment_requirements,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', instructor.display_name,
      'biography', instructor.biography,
      'credentials', instructor.credentials
    ) order by course_instructor.sort_order)
    from public.course_instructors course_instructor
    join public.instructors instructor
      on instructor.id = course_instructor.instructor_id
    where course_instructor.course_version_id = cv.id
      and instructor.active
  ), '[]'::jsonb) as instructors,
  legal.id as legal_document_id,
  legal.content_sha256 as legal_document_sha256,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', session.id,
        'componentId', session.hybrid_component_id,
        'title', session.title,
        'startsAt', session.starts_at,
        'endsAt', session.ends_at,
        'bookingCloseAt', session.booking_close_at
      )
      order by session.starts_at
    )
    from public.live_sessions session
    where session.course_version_id = cv.id
      and session.status in ('scheduled', 'open')
      and session.booking_close_at > now()
  ), '[]'::jsonb) as live_sessions,
  (
    select min(ls.starts_at)
    from public.live_sessions ls
    where ls.course_version_id = cv.id
      and ls.status in ('scheduled', 'open')
  ) as first_live_starts_at
from public.courses c
join public.course_versions cv on cv.course_id = c.id
join public.course_version_accreditation cva
  on cva.course_version_id = cv.id
join public.accreditation_decision_revisions adr
  on adr.id = cva.accreditation_revision_id
join public.legal_documents legal on legal.id = cv.legal_document_id
where cv.status = 'published'
  and cv.commerce_close_at > now()
  and adr.status in ('applying', 'approved')
  and legal.approved_by_legal
  and legal.effective_at <= now()
  and (legal.superseded_at is null or legal.superseded_at > now());

grant select on public.published_course_catalog to anon, authenticated;

create or replace view public.learner_dashboard
with (security_invoker = true)
as
select
  e.id as enrollment_id,
  cv.title as course_title,
  cv.delivery_type,
  e.status as enrollment_status,
  coalesce(ps.confirmed_valid_seconds, 0) as confirmed_valid_seconds,
  coalesce(cr.required_watch_seconds, 0) as required_seconds,
  (
    select min(ls.starts_at)
    from public.live_bookings lb
    join public.live_sessions ls on ls.id = lb.live_session_id
    where lb.enrollment_id = e.id
      and (
        lb.status = 'confirmed'
        or (
          lb.status = 'held'
          and lb.hold_expires_at > clock_timestamp()
        )
      )
      and ls.starts_at > now()
  ) as next_live_starts_at,
  case
    when exists (
      select 1
      from public.live_bookings booking
      join public.attendance_summaries attendance
        on attendance.live_booking_id = booking.id
      where booking.enrollment_id = e.id
        and attendance.quarantined_at is not null
    ) then 'needs_correction'
    else certificate.current_status
  end as certificate_status,
  certificate.id as certificate_id
from public.enrollments e
join public.course_versions cv on cv.id = e.course_version_id
left join public.progress_summaries ps on ps.enrollment_id = e.id
left join public.course_requirements cr on cr.course_version_id = cv.id
left join public.certificates certificate on certificate.enrollment_id = e.id;

create policy course_requirements_catalog_read on public.course_requirements
for select to authenticated
using (
  exists (
    select 1 from public.enrollments e
    where e.course_version_id = course_requirements.course_version_id
      and e.person_id = internal.request_person_id()
  )
);
grant select on public.course_requirements to authenticated;
grant select on public.learner_dashboard to authenticated;

create or replace view public.learner_course_access
with (security_invoker = true)
as
select
  e.id as enrollment_id,
  cv.title as course_title,
  cv.delivery_type,
  (
    select lvv.id
    from public.modules module
    join public.lessons lesson on lesson.module_id = module.id
    join public.lesson_video_versions lvv on lvv.lesson_id = lesson.id
    where module.course_version_id = cv.id
      and lvv.active
    order by module.sort_order, lesson.sort_order
    limit 1
  ) as first_lesson_video_version_id,
  e.status as enrollment_status
from public.enrollments e
join public.course_versions cv on cv.id = e.course_version_id
join public.entitlements entitlement on entitlement.id = e.entitlement_id
where entitlement.status = 'active';

create policy learner_modules_read on public.modules
for select to authenticated
using (
  exists (
    select 1 from public.enrollments e
    where e.course_version_id = modules.course_version_id
      and e.person_id = internal.request_person_id()
  )
);
create policy learner_lessons_read on public.lessons
for select to authenticated
using (
  exists (
    select 1
    from public.modules module
    join public.enrollments e on e.course_version_id = module.course_version_id
    where module.id = lessons.module_id
      and e.person_id = internal.request_person_id()
  )
);
create policy learner_lvv_read on public.lesson_video_versions
for select to authenticated
using (
  exists (
    select 1
    from public.lessons lesson
    join public.modules module on module.id = lesson.module_id
    join public.enrollments e on e.course_version_id = module.course_version_id
    where lesson.id = lesson_video_versions.lesson_id
      and e.person_id = internal.request_person_id()
  )
);
grant select on public.modules, public.lessons, public.lesson_video_versions
  to authenticated;
grant select on public.learner_course_access to authenticated;

create or replace view public.organization_workspace
with (security_invoker = true)
as
select
  organization.id as organization_id,
  organization.legal_name as organization_name,
  membership.role,
  wallet.available_points,
  wallet.reserved_points,
  wallet.refund_reserved_points,
  wallet.consumed_points,
  wallet.refunded_points,
  (
    select count(*)
    from public.organization_memberships member
    where member.organization_id = organization.id and member.active
  ) as member_count
from public.organization_memberships membership
join public.organizations organization
  on organization.id = membership.organization_id
left join public.organization_wallets wallet
  on wallet.organization_id = organization.id
where membership.person_id = internal.request_person_id()
  and membership.active
  and organization.status = 'approved';
grant select on public.organization_workspace to authenticated;

create or replace view public.certificate_verification_projection
with (security_invoker = true)
as
select
  revision.verification_token_hash,
  revision.masked_name_snapshot,
  revision.course_title_snapshot,
  revision.completed_on,
  certificate.certificate_kind,
  certificate.current_status = 'credited'
    and not exists (
      select 1
      from public.live_bookings booking
      join public.attendance_summaries attendance
        on attendance.live_booking_id = booking.id
      where booking.enrollment_id = certificate.enrollment_id
        and attendance.quarantined_at is not null
    )
    as official_accreditation_credited,
  case
    when certificate.current_status = 'credited'
      and not exists (
        select 1
        from public.live_bookings booking
        join public.attendance_summaries attendance
          on attendance.live_booking_id = booking.id
        where booking.enrollment_id = certificate.enrollment_id
          and attendance.quarantined_at is not null
      )
      then revision.accreditation_points_snapshot
    else null
  end as points,
  case
    when exists (
      select 1
      from public.live_bookings booking
      join public.attendance_summaries attendance
        on attendance.live_booking_id = booking.id
      where booking.enrollment_id = certificate.enrollment_id
        and attendance.quarantined_at is not null
    ) then 'needs_correction'
    else certificate.current_status
  end as status
from public.certificate_revisions revision
join public.certificates certificate
  on certificate.id = revision.certificate_id;
-- This projection is intentionally server-only; anon/authenticated get no grant.

create or replace function internal.setting_is_true(setting_name text)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select coalesce((
    select (setting.value ->> 'enabled')::boolean
    from public.operating_setting_revisions setting
    where setting.setting_key = setting_name
      and setting.effective_at <= now()
      and (setting.superseded_at is null or setting.superseded_at > now())
    order by setting.revision desc
    limit 1
  ), false)
$$;
revoke all on function internal.setting_is_true(text) from public;

create or replace function internal.feature_is_open(feature_name text)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.feature_switches feature
    where feature.name = feature_name
      and feature.enabled
      and feature.approved_at is not null
      and feature.approved_at <= now()
      and feature.suspended_at is null
  )
  and not internal.setting_is_true('maintenance_mode')
  and internal.setting_is_true('legal_approved')
  and internal.setting_is_true('finance_configured')
  and internal.setting_is_true('incident_owner_configured')
$$;
revoke all on function internal.feature_is_open(text) from public;

create or replace function internal.append_audit_event(
  actor uuid,
  event_action text,
  target_kind text,
  target_identifier text,
  event_reason text,
  organization uuid,
  details jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  prior_hash text;
  next_hash text;
  next_sequence bigint;
begin
  -- Lock a stable advisory key before reading the tail. Row locking alone does
  -- not serialize the empty-chain case, where two transactions could otherwise
  -- both create a root event with previous_hash = null.
  perform pg_advisory_xact_lock(
    hashtextextended('suiyue:audit-chain:v1', 0)
  );
  select event_hash into prior_hash
  from public.audit_events
  order by sequence desc
  limit 1
  for update;

  next_hash := encode(extensions.digest(
    coalesce(prior_hash, '') || '|' ||
    coalesce(actor::text, '') || '|' || event_action || '|' ||
    target_kind || '|' || target_identifier || '|' ||
    coalesce(event_reason, '') || '|' || details::text,
    'sha256'
  ), 'hex');

  insert into public.audit_events (
    actor_id, action, target_type, target_id, organization_id,
    reason, event_data, previous_hash, event_hash
  ) values (
    actor, event_action, target_kind, target_identifier, organization,
    event_reason, details, prior_hash, next_hash
  )
  returning sequence into next_sequence;
  return next_sequence;
end
$$;
alter function internal.append_audit_event(
  uuid, text, text, text, text, uuid, jsonb
) owner to suiyue_audit_owner;
revoke all on function internal.append_audit_event(
  uuid, text, text, text, text, uuid, jsonb
) from public;

create or replace function internal.authorize_staff_action(
  required_role text,
  requested_action text,
  requested_target text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not internal.has_staff_role(required_role) then
    return false;
  end if;
  if requested_action = '' or requested_target = '' then
    return false;
  end if;
  return true;
end
$$;
revoke all on function internal.authorize_staff_action(text, text, text)
  from public;

create or replace function public.authorize_staff_action(
  p_required_role text,
  p_action text,
  p_target text
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.authorize_staff_action(
    p_required_role, p_action, p_target
  )
$$;

create or replace function internal.ingest_provider_event(
  provider_name text,
  provider_event_type text,
  provider_native_id text,
  event_fingerprint text,
  occurred_at timestamptz,
  event_payload jsonb,
  event_environment text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  event_id uuid;
begin
  -- Runtime emergency mode must preserve signed provider evidence. This RPC
  -- is service-role only; destructive reset fences are enforced separately.
  if auth.role() <> 'service_role'
     or event_environment not in (
       'development', 'test', 'preview', 'production'
     )
  then
    raise exception 'PROVIDER_ENVIRONMENT_REJECTED';
  end if;
  insert into public.provider_events (
    provider, event_type, native_event_id, canonical_fingerprint,
    provider_occurred_at, payload, environment
  ) values (
    provider_name, provider_event_type, provider_native_id, event_fingerprint,
    occurred_at, event_payload, event_environment
  )
  on conflict (provider, canonical_fingerprint)
  do nothing
  returning id into event_id;
  if event_id is null then
    select id into event_id
    from public.provider_events
    where provider = provider_name
      and canonical_fingerprint = event_fingerprint;
  end if;
  insert into public.durable_jobs (job_type, business_key, payload)
  values (
    'provider_event_process',
    'provider-event:' || event_id::text,
    jsonb_build_object('providerEventId', event_id)
  )
  on conflict (business_key) do nothing;
  return event_id;
end
$$;
revoke all on function internal.ingest_provider_event(
  text, text, text, text, timestamptz, jsonb, text
) from public;

create or replace function public.ingest_provider_event(
  p_provider text,
  p_event_type text,
  p_native_event_id text,
  p_fingerprint text,
  p_occurred_at timestamptz,
  p_payload jsonb,
  p_environment text
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.ingest_provider_event(
    p_provider, p_event_type, p_native_event_id, p_fingerprint,
    p_occurred_at, p_payload, p_environment
  )
$$;

create or replace function internal.lease_due_jobs(
  worker_id text,
  job_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  leased jsonb;
begin
  if auth.role() <> 'service_role'
     or worker_id = ''
     or job_limit not between 1 and 100
  then
    raise exception 'WORKER_SERVICE_AUTHORITY_REQUIRED';
  end if;
  with candidates as (
    select id
    from public.durable_jobs
    where status in ('pending', 'retry')
      and available_at <= now()
      and (lease_expires_at is null or lease_expires_at < now())
      and (
        not internal.setting_is_true('maintenance_mode')
        or job_type in (
          'provider_event_process',
          'live_join_lease_expiry',
          'quarantine_scan'
        )
      )
    order by available_at, created_at
    for update skip locked
    limit least(greatest(job_limit, 1), 100)
  ),
  updated as (
    update public.durable_jobs job
    set status = 'leased',
        lease_owner = worker_id,
        lease_expires_at = now() + interval '5 minutes',
        attempt_count = attempt_count + 1
    from candidates
    where job.id = candidates.id
    returning job.id, job.job_type, job.payload
  )
  select coalesce(jsonb_agg(to_jsonb(updated)), '[]'::jsonb)
    into leased from updated;
  return leased;
end
$$;
revoke all on function internal.lease_due_jobs(text, integer) from public;

create or replace function public.lease_due_jobs(
  p_worker_id text,
  p_limit integer
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.lease_due_jobs(p_worker_id, p_limit)
$$;

create or replace function internal.finish_durable_job(
  target_job uuid,
  worker_id text,
  succeeded boolean,
  failure_message text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  job public.durable_jobs%rowtype;
  next_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'WORKER_SERVICE_AUTHORITY_REQUIRED';
  end if;
  select * into job from public.durable_jobs
  where id = target_job and status = 'leased' and lease_owner = worker_id
  for update;
  if not found then raise exception 'JOB_LEASE_MISMATCH'; end if;
  if succeeded then
    next_status := 'completed';
    update public.durable_jobs
    set status = next_status, completed_at = now(),
        lease_owner = null, lease_expires_at = null, last_error = null
    where id = job.id;
  else
    next_status := case
      when job.attempt_count >= 5 then 'dead_letter' else 'retry'
    end;
    update public.durable_jobs
    set status = next_status,
        available_at = case when next_status = 'retry'
          then now() + make_interval(
            secs => least(3600, (2 ^ job.attempt_count)::integer * 15)
          )
          else available_at end,
        lease_owner = null,
        lease_expires_at = null,
        last_error = left(coalesce(failure_message, 'worker failure'), 1000)
    where id = job.id;
  end if;
  insert into public.worker_heartbeats (
    worker_name, last_started_at, last_success_at, dead_letter_count
  ) values (
    worker_id, job.created_at,
    case when succeeded then now() end,
    case when next_status = 'dead_letter' then 1 else 0 end
  )
  on conflict (worker_name) do update
  set last_started_at = excluded.last_started_at,
      last_success_at = coalesce(
        excluded.last_success_at,
        public.worker_heartbeats.last_success_at
      ),
      dead_letter_count = public.worker_heartbeats.dead_letter_count
        + excluded.dead_letter_count,
      updated_at = now();
  return next_status;
end
$$;
revoke all on function internal.finish_durable_job(
  uuid, text, boolean, text
) from public;

create or replace function public.finish_durable_job(
  p_job_id uuid,
  p_worker_id text,
  p_succeeded boolean,
  p_failure_message text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.finish_durable_job(
    p_job_id, p_worker_id, p_succeeded, p_failure_message
  )
$$;

create or replace function internal.lease_notification_outbox(
  worker_id text,
  lease_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  leased jsonb;
begin
  if auth.role() <> 'service_role'
     or lease_limit not between 1 and 100
     or worker_id = ''
  then raise exception 'WORKER_SERVICE_AUTHORITY_REQUIRED'; end if;
  with candidates as (
    select id from public.notification_outbox
    where status in ('pending', 'retry')
      and available_at <= now()
      and (lease_expires_at is null or lease_expires_at < now())
    order by available_at, created_at
    for update skip locked
    limit lease_limit
  ), updated as (
    update public.notification_outbox outbox
    set status = 'leased', lease_owner = worker_id,
        lease_expires_at = now() + interval '2 minutes',
        attempt_count = attempt_count + 1
    from candidates
    where outbox.id = candidates.id
    returning outbox.id, outbox.notification_id, outbox.channel,
      outbox.template_key, outbox.template_data,
      outbox.business_idempotency_key
  )
  select coalesce(jsonb_agg(to_jsonb(updated)), '[]'::jsonb)
    into leased from updated;
  return leased;
end
$$;
revoke all on function internal.lease_notification_outbox(text, integer)
  from public;

create or replace function public.lease_notification_outbox(
  p_worker_id text,
  p_limit integer
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.lease_notification_outbox(p_worker_id, p_limit)
$$;

create or replace function internal.finish_notification_outbox(
  target_outbox uuid,
  worker_id text,
  succeeded boolean,
  provider_message text,
  failure_message text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  outbox public.notification_outbox%rowtype;
  next_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'WORKER_SERVICE_AUTHORITY_REQUIRED';
  end if;
  select * into outbox from public.notification_outbox
  where id = target_outbox and status = 'leased'
    and lease_owner = worker_id
  for update;
  if not found then raise exception 'NOTIFICATION_LEASE_MISMATCH'; end if;
  if succeeded then
    next_status := 'delivered';
    update public.notification_outbox
    set status = next_status, delivered_at = now(),
        lease_owner = null, lease_expires_at = null, last_error = null
    where id = target_outbox;
    insert into public.notification_delivery_events (
      outbox_id, provider_message_id, status, occurred_at
    ) values (
      target_outbox, provider_message, 'accepted', now()
    );
  else
    next_status := case when outbox.attempt_count >= 5
      then 'dead_letter' else 'retry' end;
    update public.notification_outbox
    set status = next_status,
        available_at = case when next_status = 'retry'
          then now() + make_interval(
            secs => least(3600, (2 ^ outbox.attempt_count)::integer * 15)
          )
          else available_at end,
        lease_owner = null, lease_expires_at = null,
        last_error = left(coalesce(failure_message, 'delivery failed'), 1000)
    where id = target_outbox;
    insert into public.notification_delivery_events (
      outbox_id, status, occurred_at
    ) values (target_outbox, 'failed', now());
  end if;
  return next_status;
end
$$;
revoke all on function internal.finish_notification_outbox(
  uuid, text, boolean, text, text
) from public;

create or replace function public.finish_notification_outbox(
  p_outbox_id uuid,
  p_worker_id text,
  p_succeeded boolean,
  p_provider_message_id text,
  p_failure_message text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.finish_notification_outbox(
    p_outbox_id, p_worker_id, p_succeeded,
    p_provider_message_id, p_failure_message
  )
$$;

create or replace function internal.read_notification_destination(
  target_outbox uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'NOTIFICATION_SERVICE_REQUIRED';
  end if;
  select case outbox.channel
    when 'email' then jsonb_build_object(
      'channel', 'email',
      'destination', person.verified_email,
      'title', notification.title,
      'body', notification.body
    )
    when 'sms' then jsonb_build_object(
      'channel', 'sms',
      'destination', auth_user.phone,
      'title', notification.title,
      'body', notification.body
    )
  end into result
  from public.notification_outbox outbox
  join public.notifications notification
    on notification.id = outbox.notification_id
  join public.people person on person.id = notification.person_id
  left join public.auth_identities identity
    on identity.person_id = person.id and identity.active
  left join auth.users auth_user on auth_user.id = identity.auth_user_id
  where outbox.id = target_outbox
    and outbox.status = 'leased'
    and (
      (
        outbox.channel = 'email'
        and person.email_verified_at is not null
        and person.verified_email is not null
      )
      or (
        outbox.channel = 'sms'
        and auth_user.phone is not null
      )
    );
  if result is null then
    raise exception 'NOTIFICATION_DESTINATION_UNAVAILABLE';
  end if;
  return result;
end
$$;
revoke all on function internal.read_notification_destination(uuid)
  from public;

create or replace function public.read_notification_destination(
  p_outbox_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_notification_destination(p_outbox_id)
$$;

create or replace function internal.enqueue_due_live_reminders()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  inserted_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'REMINDER_SERVICE_REQUIRED';
  end if;
  with due as (
    select
      booking.enrollment_id,
      enrollment.person_id,
      session.id as session_id,
      session.title,
      session.starts_at,
      case
        when session.starts_at between now() + interval '23 hours 55 minutes'
          and now() + interval '24 hours 5 minutes' then '24h'
        when session.starts_at between now() + interval '55 minutes'
          and now() + interval '65 minutes' then '1h'
      end as reminder_window
    from public.live_bookings booking
    join public.enrollments enrollment on enrollment.id = booking.enrollment_id
    join public.live_sessions session on session.id = booking.live_session_id
    join public.entitlements entitlement
      on entitlement.id = enrollment.entitlement_id
    where booking.status = 'confirmed'
      and entitlement.status = 'active'
      and session.status = 'scheduled'
      and (
        session.starts_at between now() + interval '23 hours 55 minutes'
          and now() + interval '24 hours 5 minutes'
        or session.starts_at between now() + interval '55 minutes'
          and now() + interval '65 minutes'
      )
  ), created as (
    insert into public.notifications (
      person_id, category, title, body, business_key
    )
    select
      due.person_id, 'live_reminder',
      case due.reminder_window
        when '24h' then '直播課程將於 24 小時後開始'
        else '直播課程將於 1 小時後開始'
      end,
      due.title || '；請提早完成設備測試並從歲悅學苑入場。',
      'live-reminder:' || due.session_id::text || ':'
        || due.person_id::text || ':' || due.reminder_window
    from due
    where due.reminder_window is not null
    on conflict (person_id, business_key) do nothing
    returning id, person_id, business_key
  ), sms as (
    insert into public.notification_outbox (
      notification_id, channel, destination_ciphertext,
      template_key, template_data, business_idempotency_key
    )
    select
      created.id, 'sms', '{}'::jsonb, 'live_reminder',
      jsonb_build_object('businessKey', created.business_key),
      'sms:' || created.business_key
    from created
    on conflict (business_idempotency_key) do nothing
    returning id
  )
  select count(*) into inserted_count from sms;
  return inserted_count;
end
$$;
revoke all on function internal.enqueue_due_live_reminders() from public;

create or replace function public.enqueue_due_live_reminders()
returns integer
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.enqueue_due_live_reminders()
$$;

create or replace function internal.process_provider_event(
  target_event uuid,
  expected_environment text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  event public.provider_events%rowtype;
  provider_object jsonb;
  participant jsonb;
  provider_meeting_uuid text;
  participant_occurrence_at timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'WORKER_SERVICE_AUTHORITY_REQUIRED';
  end if;
  select * into event from public.provider_events
  where id = target_event
  for update;
  if not found then raise exception 'PROVIDER_EVENT_NOT_FOUND'; end if;
  if expected_environment not in (
    'development', 'test', 'preview', 'production'
  ) or event.environment <> expected_environment then
    raise exception 'PROVIDER_ENVIRONMENT_REJECTED';
  end if;
  if event.processed_at is not null
     and event.processing_error is null
  then
    return true;
  end if;
  if event.provider = 'cloudflare_stream' then
    update public.video_assets
    set status = case
      when event.event_type = 'ready'
        and master_backup_reference is not null then 'ready'
      when event.event_type in ('error', 'failed') then 'failed'
      else 'processing'
    end,
    ready_at = case when event.event_type = 'ready' then now() else ready_at end,
    provider_payload = provider_payload || jsonb_build_object(
      'providerReady', event.event_type = 'ready',
      'lastProviderEvent', event.payload
    ),
    failure_reason = case
      when event.event_type in ('error', 'failed')
      then coalesce(event.payload -> 'status' ->> 'errorReasonCode', 'provider failed')
      else failure_reason end
    where provider_uid = event.payload ->> 'uid'
      and status <> 'archived';
  elsif event.provider = 'zoom' then
    provider_object := event.payload -> 'payload' -> 'object';
    participant := provider_object -> 'participant';
    provider_meeting_uuid := provider_object ->> 'uuid';
    -- Serialize provider-ledger materialization against the 24-hour
    -- settlement transaction. Without this shared session lock, a webhook
    -- worker and settlement could each observe the other as not-yet-committed
    -- and produce a summary whose manifest omitted the event.
    perform session.id
    from public.live_sessions session
    join private.zoom_meetings meeting
      on meeting.live_session_id = session.id
    where meeting.meeting_uuid = provider_meeting_uuid
       or meeting.meeting_number = provider_object ->> 'id'
    for update of session;
    if event.event_type in ('meeting.started', 'meeting.ended') then
      insert into public.live_evidence_events (
        live_session_id, event_type, occurred_at, evidence
      )
      select
        meeting.live_session_id,
        case event.event_type
          when 'meeting.started' then 'actual_started'
          else 'actual_ended'
        end,
        coalesce(event.provider_occurred_at, event.received_at),
        jsonb_build_object(
          'providerEventId', event.id,
          'canonicalFingerprint', event.canonical_fingerprint
        )
      from private.zoom_meetings meeting
      where meeting.meeting_uuid = provider_meeting_uuid
         or meeting.meeting_number = provider_object ->> 'id';
      update public.live_sessions session
      set status = case event.event_type
        when 'meeting.started' then 'in_progress'
        else 'ended'
      end
      from private.zoom_meetings meeting
      where meeting.live_session_id = session.id
        and (
          meeting.meeting_uuid = provider_meeting_uuid
          or meeting.meeting_number = provider_object ->> 'id'
        )
        and (
          (
            event.event_type = 'meeting.started'
            and session.status in ('scheduled', 'open')
          )
          or (
            event.event_type = 'meeting.ended'
            and session.status in ('scheduled', 'open', 'in_progress')
          )
        );
      if event.event_type = 'meeting.ended' then
        -- A signed meeting-ended event is authoritative evidence that every
        -- participant in this meeting has left. Credential expiry alone is
        -- deliberately not treated as equivalent evidence.
        update public.live_join_leases lease
        set old_participant_removed_at = coalesce(
          lease.old_participant_removed_at,
          event.provider_occurred_at,
          event.received_at
        )
        from public.live_bookings booking,
          private.zoom_meetings meeting
        where booking.id = lease.live_booking_id
          and meeting.live_session_id = booking.live_session_id
          and lease.zoom_participant_uuid is not null
          and (
            meeting.meeting_uuid = provider_meeting_uuid
            or meeting.meeting_number = provider_object ->> 'id'
          )
          and lease.old_participant_removed_at is null;
        insert into public.durable_jobs (
          job_type, business_key, payload, available_at
        )
        select
          'live_attendance_settle',
          'live-attendance-settle:' || meeting.live_session_id::text,
          jsonb_build_object('liveSessionId', meeting.live_session_id),
          session.evidence_settles_at
        from private.zoom_meetings meeting
        join public.live_sessions session
          on session.id = meeting.live_session_id
        where meeting.meeting_uuid = provider_meeting_uuid
           or meeting.meeting_number = provider_object ->> 'id'
        on conflict (business_key) do nothing;

        -- A delayed meeting-ended event can shorten every participant's
        -- authoritative presence window. If attendance was already settled,
        -- quarantine every affected booking until two distinct staff members
        -- accept/reject the late evidence; never rewrite a result in-place.
        update public.live_join_leases lease
        set duplicate_anomaly_at = coalesce(
          lease.duplicate_anomaly_at, event.received_at
        )
        from public.live_bookings booking,
          public.live_sessions session,
          private.zoom_meetings meeting
        where booking.id = lease.live_booking_id
          and session.id = booking.live_session_id
          and meeting.live_session_id = session.id
          and (
            meeting.meeting_uuid = provider_meeting_uuid
            or meeting.meeting_number = provider_object ->> 'id'
          )
          and exists (
            select 1
            from public.attendance_summaries summary
            where summary.live_booking_id = booking.id
          );
        update public.attendance_summaries summary
        set quarantined_at = coalesce(
              summary.quarantined_at, event.received_at
            ),
            quarantine_reason =
              'late_provider_event_after_settlement'
        from public.live_bookings booking,
          private.zoom_meetings meeting
        where summary.live_booking_id = booking.id
          and meeting.live_session_id = booking.live_session_id
          and (
            meeting.meeting_uuid = provider_meeting_uuid
            or meeting.meeting_number = provider_object ->> 'id'
          );
        insert into public.live_evidence_events (
          live_session_id, event_type, occurred_at, evidence
        )
        select
          session.id, 'provider_anomaly', event.received_at,
          jsonb_build_object(
            'reason', 'late_provider_event_after_settlement',
            'providerEventId', event.id,
            'providerEventType', event.event_type,
            'providerOccurredAt',
              coalesce(event.provider_occurred_at, event.received_at),
            'receivedAt', event.received_at,
            'evidenceSettledAt', session.evidence_settles_at,
            'receivedAfterEvidenceCutoff',
              event.received_at > session.evidence_settles_at,
            'requiresDualControl', true
          )
        from public.live_sessions session
        join private.zoom_meetings meeting
          on meeting.live_session_id = session.id
        where (
            meeting.meeting_uuid = provider_meeting_uuid
            or meeting.meeting_number = provider_object ->> 'id'
          )
          and exists (
            select 1
            from public.live_bookings booking
            join public.attendance_summaries summary
              on summary.live_booking_id = booking.id
            where booking.live_session_id = session.id
          )
          and not exists (
            select 1
            from public.live_evidence_events prior
            where prior.live_session_id = session.id
              and prior.event_type = 'provider_anomaly'
              and prior.evidence ->> 'providerEventId' = event.id::text
          );
        update public.live_sessions session
        set status = 'reconciling'
        from private.zoom_meetings meeting
        where meeting.live_session_id = session.id
          and session.status = 'ended'
          and (
            meeting.meeting_uuid = provider_meeting_uuid
            or meeting.meeting_number = provider_object ->> 'id'
          )
          and exists (
            select 1
            from public.live_bookings booking
            join public.attendance_summaries summary
              on summary.live_booking_id = booking.id
            join public.live_join_leases lease
              on lease.live_booking_id = booking.id
            where booking.live_session_id = session.id
              and lease.duplicate_anomaly_at is not null
          );
      end if;
    end if;
    if event.event_type in (
      'meeting.participant_joined', 'meeting.participant_left'
    ) and participant is not null and provider_meeting_uuid is not null then
      participant_occurrence_at := case event.event_type
        when 'meeting.participant_joined' then coalesce(
          nullif(participant ->> 'join_time', '')::timestamptz,
          event.provider_occurred_at,
          event.received_at
        )
        else coalesce(
          nullif(participant ->> 'leave_time', '')::timestamptz,
          event.provider_occurred_at,
          event.received_at
        )
      end;
      insert into public.zoom_participant_events (
        live_session_id, provider_event_type, meeting_uuid,
        participant_uuid, customer_key, provider_occurrence_at,
        canonical_fingerprint, payload
      )
      select
        meeting.live_session_id, event.event_type, provider_meeting_uuid,
        participant ->> 'participant_uuid',
        participant ->> 'customer_key',
        participant_occurrence_at,
        event.canonical_fingerprint,
        event.payload
      from private.zoom_meetings meeting
      where meeting.meeting_uuid = provider_meeting_uuid
         or meeting.meeting_number = provider_object ->> 'id';
      if event.event_type = 'meeting.participant_joined'
         and nullif(participant ->> 'participant_uuid', '') is not null
         and nullif(participant ->> 'customer_key', '') is not null
      then
        -- customer_key is generated per lease (not per booking), so an old
        -- participant event can never bind or release a replacement lease.
        update public.live_join_leases lease
        set zoom_participant_uuid = participant ->> 'participant_uuid'
        from public.live_bookings booking,
          private.zoom_meetings meeting
        where booking.id = lease.live_booking_id
          and meeting.live_session_id = booking.live_session_id
          and lease.provider_customer_key = participant ->> 'customer_key'
          and lease.zoom_participant_uuid is null
          and (
            meeting.meeting_uuid = provider_meeting_uuid
            or meeting.meeting_number = provider_object ->> 'id'
          );

        -- Zoom assigns a new participant UUID after a legitimate rejoin.
        -- Rebind only when the prior bound UUID already has authoritative
        -- left evidence whose provider time is not later than this join.
        update public.live_join_leases lease
        set zoom_participant_uuid = participant ->> 'participant_uuid',
            old_participant_removed_at = null,
            duplicate_anomaly_at = null
        from public.live_bookings booking,
          private.zoom_meetings meeting
        where booking.id = lease.live_booking_id
          and meeting.live_session_id = booking.live_session_id
          and lease.provider_customer_key = participant ->> 'customer_key'
          and lease.zoom_participant_uuid is not null
          and lease.zoom_participant_uuid is distinct from
            participant ->> 'participant_uuid'
          and lease.old_participant_removed_at is not null
          and (
            meeting.meeting_uuid = provider_meeting_uuid
            or meeting.meeting_number = provider_object ->> 'id'
          )
          and exists (
            select 1
            from public.zoom_participant_events departed
            where departed.live_session_id = booking.live_session_id
              and departed.customer_key = lease.provider_customer_key
              and departed.participant_uuid =
                lease.zoom_participant_uuid
              and departed.provider_event_type like
                '%participant_left'
              and departed.provider_occurrence_at <=
                participant_occurrence_at
          );

        -- A second UUID using the same lease credential is an anomaly. Keep
        -- the original binding and make replacement fail closed until a
        -- matching, time-ordered left event resolves the rejoin.
        update public.live_join_leases lease
        set duplicate_anomaly_at = coalesce(
          lease.duplicate_anomaly_at, event.received_at
        )
        from public.live_bookings booking,
          private.zoom_meetings meeting
        where booking.id = lease.live_booking_id
          and meeting.live_session_id = booking.live_session_id
          and lease.provider_customer_key = participant ->> 'customer_key'
          and lease.zoom_participant_uuid is distinct from
            participant ->> 'participant_uuid'
          and lease.zoom_participant_uuid is not null
          and (
            meeting.meeting_uuid = provider_meeting_uuid
            or meeting.meeting_number = provider_object ->> 'id'
          );

        -- Delivery order is not provider order. If the matching left webhook
        -- was persisted before this joined webhook, bind the participant and
        -- immediately materialize the already-authoritative removal time.
        update public.live_join_leases lease
        set old_participant_removed_at = (
          select min(departed.provider_occurrence_at)
          from public.zoom_participant_events departed
          where departed.live_session_id = booking.live_session_id
            and departed.customer_key = lease.provider_customer_key
            and departed.participant_uuid = lease.zoom_participant_uuid
            and departed.provider_event_type like
              '%participant_left'
            and departed.provider_occurrence_at >=
              participant_occurrence_at
        )
        from public.live_bookings booking,
          private.zoom_meetings meeting
        where booking.id = lease.live_booking_id
          and meeting.live_session_id = booking.live_session_id
          and lease.provider_customer_key =
            participant ->> 'customer_key'
          and lease.zoom_participant_uuid =
            participant ->> 'participant_uuid'
          and lease.old_participant_removed_at is null
          and (
            meeting.meeting_uuid = provider_meeting_uuid
            or meeting.meeting_number = provider_object ->> 'id'
          )
          and exists (
            select 1
            from public.zoom_participant_events departed
            where departed.live_session_id = booking.live_session_id
              and departed.customer_key =
                lease.provider_customer_key
              and departed.participant_uuid =
                lease.zoom_participant_uuid
              and departed.provider_event_type like
                '%participant_left'
              and departed.provider_occurrence_at >=
                participant_occurrence_at
          );
      elsif event.event_type = 'meeting.participant_left'
         and nullif(participant ->> 'participant_uuid', '') is not null
         and nullif(participant ->> 'customer_key', '') is not null
      then
        update public.live_join_leases lease
        set old_participant_removed_at = coalesce(
          lease.old_participant_removed_at,
          participant_occurrence_at
        )
        from public.live_bookings booking,
          private.zoom_meetings meeting
        where booking.id = lease.live_booking_id
          and lease.provider_customer_key = participant ->> 'customer_key'
          and lease.zoom_participant_uuid =
            participant ->> 'participant_uuid'
          and meeting.live_session_id = booking.live_session_id
          and (
            meeting.meeting_uuid = provider_meeting_uuid
            or meeting.meeting_number = provider_object ->> 'id'
          )
          and lease.old_participant_removed_at is null
          and exists (
            select 1
            from public.zoom_participant_events joined
            where joined.live_session_id = booking.live_session_id
              and joined.customer_key = lease.provider_customer_key
              and joined.participant_uuid = lease.zoom_participant_uuid
              and joined.provider_event_type like
                '%participant_joined'
              and joined.provider_occurrence_at <=
                participant_occurrence_at
          );

        -- Webhooks can arrive as new-joined before old-left. Once the old-left
        -- event arrives, rebind to the earliest later joined interval. The
        -- stable per-lease customer key preserves all historical intervals.
        update public.live_join_leases lease
        set zoom_participant_uuid = (
              select joined.participant_uuid
              from public.zoom_participant_events joined
              where joined.live_session_id = booking.live_session_id
                and joined.customer_key = lease.provider_customer_key
                and joined.provider_event_type like
                  '%participant_joined'
                and joined.participant_uuid is not null
                and joined.participant_uuid is distinct from
                  lease.zoom_participant_uuid
                and joined.provider_occurrence_at >=
                  participant_occurrence_at
              order by joined.provider_occurrence_at,
                joined.ingest_sequence
              limit 1
            ),
            old_participant_removed_at = null,
            duplicate_anomaly_at = null
        from public.live_bookings booking,
          private.zoom_meetings meeting
        where booking.id = lease.live_booking_id
          and meeting.live_session_id = booking.live_session_id
          and lease.provider_customer_key = participant ->> 'customer_key'
          and lease.zoom_participant_uuid =
            participant ->> 'participant_uuid'
          and lease.old_participant_removed_at is not null
          and (
            meeting.meeting_uuid = provider_meeting_uuid
            or meeting.meeting_number = provider_object ->> 'id'
          )
          and exists (
            select 1
            from public.zoom_participant_events joined
            where joined.live_session_id = booking.live_session_id
              and joined.customer_key = lease.provider_customer_key
              and joined.provider_event_type like
                '%participant_joined'
              and joined.participant_uuid is not null
              and joined.participant_uuid is distinct from
                lease.zoom_participant_uuid
              and joined.provider_occurrence_at >=
                participant_occurrence_at
          );
      end if;

      -- Rebuild the mutable lease projection from the complete append-only
      -- provider ledger after every joined/left event. This makes the result
      -- independent of webhook delivery order (including new-join arriving
      -- before old-join, and left arriving before its join).
      with target_leases as (
        select
          lease.id as lease_id,
          booking.live_session_id,
          lease.provider_customer_key,
          lease.duplicate_anomaly_at
        from public.live_join_leases lease
        join public.live_bookings booking
          on booking.id = lease.live_booking_id
        join private.zoom_meetings meeting
          on meeting.live_session_id = booking.live_session_id
        where lease.provider_customer_key =
            participant ->> 'customer_key'
          and (
            meeting.meeting_uuid = provider_meeting_uuid
            or meeting.meeting_number = provider_object ->> 'id'
          )
      ),
      active_state as (
        select
          target.lease_id,
          count(distinct joined.participant_uuid)::integer
            as active_count,
          (array_agg(
            joined.participant_uuid
            order by joined.provider_occurrence_at,
              joined.ingest_sequence
          ))[1] as earliest_active_uuid
        from target_leases target
        join public.zoom_participant_events joined
          on joined.live_session_id = target.live_session_id
         and joined.customer_key = target.provider_customer_key
         and joined.provider_event_type like
           '%participant_joined'
         and joined.participant_uuid is not null
        where not exists (
          select 1
          from public.zoom_participant_events departed
          where departed.live_session_id = target.live_session_id
            and departed.customer_key =
              target.provider_customer_key
            and departed.participant_uuid =
              joined.participant_uuid
            and departed.provider_event_type like
              '%participant_left'
            and departed.provider_occurrence_at >=
              joined.provider_occurrence_at
        )
        group by target.lease_id
      ),
      latest_join as (
        select
          target.lease_id,
          latest.participant_uuid,
          latest.removed_at
        from target_leases target
        cross join lateral (
          select
            joined.participant_uuid,
            (
              select min(departed.provider_occurrence_at)
              from public.zoom_participant_events departed
              where departed.live_session_id =
                  target.live_session_id
                and departed.customer_key =
                  target.provider_customer_key
                and departed.participant_uuid =
                  joined.participant_uuid
                and departed.provider_event_type like
                  '%participant_left'
                and departed.provider_occurrence_at >=
                  joined.provider_occurrence_at
            ) as removed_at
          from public.zoom_participant_events joined
          where joined.live_session_id = target.live_session_id
            and joined.customer_key =
              target.provider_customer_key
            and joined.provider_event_type like
              '%participant_joined'
            and joined.participant_uuid is not null
          order by joined.provider_occurrence_at desc,
            joined.ingest_sequence desc
          limit 1
        ) latest
      ),
      rebuilt as (
        select
          target.lease_id,
          coalesce(active.active_count, 0) as active_count,
          case
            when coalesce(active.active_count, 0) > 0
              then active.earliest_active_uuid
            else latest.participant_uuid
          end as bound_uuid,
          case
            when coalesce(active.active_count, 0) = 0
              then latest.removed_at
            else null
          end as removed_at,
          target.duplicate_anomaly_at
        from target_leases target
        left join active_state active
          on active.lease_id = target.lease_id
        left join latest_join latest
          on latest.lease_id = target.lease_id
      )
      update public.live_join_leases lease
      set zoom_participant_uuid = rebuilt.bound_uuid,
          old_participant_removed_at = rebuilt.removed_at,
          duplicate_anomaly_at = case
            when rebuilt.active_count > 1 then coalesce(
              rebuilt.duplicate_anomaly_at, event.received_at
            )
            else null
          end
      from rebuilt
      where lease.id = rebuilt.lease_id
        and rebuilt.bound_uuid is not null;

      -- A provider event first processed after an attendance projection
      -- exists was not part of that immutable settlement manifest, even if
      -- the webhook was received before the cutoff and worker processing
      -- raced settlement. Preserve the event, mark the lease/session for
      -- two-person reconciliation, and let an approved resolution enqueue
      -- a new append-only attendance revision.
      update public.live_join_leases lease
      set duplicate_anomaly_at = coalesce(
        lease.duplicate_anomaly_at, event.received_at
      )
      from public.live_bookings booking,
        public.live_sessions session,
        private.zoom_meetings meeting
      where booking.id = lease.live_booking_id
        and session.id = booking.live_session_id
        and meeting.live_session_id = session.id
        and lease.provider_customer_key =
          participant ->> 'customer_key'
        and (
          meeting.meeting_uuid = provider_meeting_uuid
          or meeting.meeting_number = provider_object ->> 'id'
        )
        and exists (
          select 1
          from public.attendance_summaries summary
          where summary.live_booking_id = booking.id
        );
      update public.attendance_summaries summary
      set quarantined_at = coalesce(
            summary.quarantined_at, event.received_at
          ),
          quarantine_reason = 'late_provider_event_after_settlement'
      from public.live_bookings booking
      join public.live_join_leases lease
        on lease.live_booking_id = booking.id
      join private.zoom_meetings meeting
        on meeting.live_session_id = booking.live_session_id
      where summary.live_booking_id = booking.id
        and lease.provider_customer_key =
          participant ->> 'customer_key'
        and (
          meeting.meeting_uuid = provider_meeting_uuid
          or meeting.meeting_number = provider_object ->> 'id'
        );
      insert into public.live_evidence_events (
        live_session_id, event_type, occurred_at, evidence
      )
      select
        session.id, 'provider_anomaly', event.received_at,
        jsonb_build_object(
          'reason', 'late_provider_event_after_settlement',
          'providerEventId', event.id,
          'providerEventType', event.event_type,
          'providerOccurredAt', participant_occurrence_at,
          'receivedAt', event.received_at,
          'evidenceSettledAt', session.evidence_settles_at,
          'receivedAfterEvidenceCutoff',
            event.received_at > session.evidence_settles_at,
          'requiresDualControl', true
        )
      from public.live_sessions session
      join private.zoom_meetings meeting
        on meeting.live_session_id = session.id
      join public.live_bookings booking
        on booking.live_session_id = session.id
      join public.live_join_leases lease
        on lease.live_booking_id = booking.id
      where lease.provider_customer_key =
          participant ->> 'customer_key'
        and (
          meeting.meeting_uuid = provider_meeting_uuid
          or meeting.meeting_number = provider_object ->> 'id'
        )
        and exists (
          select 1
          from public.attendance_summaries summary
          where summary.live_booking_id = booking.id
        )
        and not exists (
          select 1
          from public.live_evidence_events prior
          where prior.live_session_id = session.id
            and prior.event_type = 'provider_anomaly'
            and prior.evidence ->> 'providerEventId' = event.id::text
        );
      update public.live_sessions session
      set status = 'reconciling'
      from private.zoom_meetings meeting
      where meeting.live_session_id = session.id
        and session.status = 'ended'
        and (
          meeting.meeting_uuid = provider_meeting_uuid
          or meeting.meeting_number = provider_object ->> 'id'
        )
        and exists (
          select 1
          from public.live_bookings booking
          join public.live_join_leases lease
            on lease.live_booking_id = booking.id
          where booking.live_session_id = session.id
            and lease.provider_customer_key =
              participant ->> 'customer_key'
            and lease.duplicate_anomaly_at is not null
            and exists (
              select 1
              from public.attendance_summaries summary
              where summary.live_booking_id = booking.id
            )
        );
    end if;
    with resolved as (
      update public.live_sessions session
      set status = 'ended'
      from private.zoom_meetings meeting
      where meeting.live_session_id = session.id
        and session.status = 'reconciling'
        and (
          meeting.meeting_uuid = provider_meeting_uuid
          or meeting.meeting_number = provider_object ->> 'id'
        )
        and exists (
          select 1
          from public.live_evidence_events evidence
          where evidence.live_session_id = session.id
            and evidence.event_type = 'actual_ended'
        )
        and not exists (
          select 1
          from public.live_bookings booking
          join public.live_join_leases lease
            on lease.live_booking_id = booking.id
          where booking.live_session_id = session.id
            and lease.duplicate_anomaly_at is not null
        )
      returning session.id, session.evidence_settles_at
    )
    insert into public.durable_jobs (
      job_type, business_key, payload, available_at
    )
    select
      'live_attendance_settle',
      'live-attendance-settle:' || resolved.id::text,
      jsonb_build_object('liveSessionId', resolved.id),
      greatest(resolved.evidence_settles_at, now())
    from resolved
    on conflict (business_key) do update
    set status = 'pending',
        available_at = excluded.available_at,
        attempt_count = 0,
        last_error = null,
        completed_at = null;
  elsif event.provider = 'resend' then
    insert into public.notification_delivery_events (
      outbox_id, provider_event_id, provider_message_id,
      status, occurred_at
    )
    select
      accepted.outbox_id,
      event.id,
      event.payload -> 'data' ->> 'email_id',
      case event.event_type
        when 'email.delivered' then 'delivered'
        when 'email.bounced' then 'bounced'
        when 'email.complained' then 'complained'
        when 'email.suppressed' then 'suppressed'
        else 'accepted'
      end,
      coalesce(event.provider_occurred_at, event.received_at)
    from public.notification_delivery_events accepted
    where accepted.provider_message_id =
      event.payload -> 'data' ->> 'email_id'
    order by accepted.created_at
    limit 1;
    if event.event_type in (
      'email.bounced', 'email.complained', 'email.suppressed'
    ) then
      update public.notification_outbox outbox
      set status = 'suppressed',
          last_error = event.event_type
      where outbox.id in (
        select delivery.outbox_id
        from public.notification_delivery_events delivery
        where delivery.provider_message_id =
          event.payload -> 'data' ->> 'email_id'
      );
    end if;
  end if;
  update public.provider_health
  set status = 'healthy', last_event_at = event.received_at,
      last_success_at = now(), checked_at = now(), updated_at = now()
  where provider = case event.provider
    when 'cloudflare_stream' then 'cloudflare_stream'
    when 'zoom' then 'zoom_meeting_sdk'
    else 'resend'
  end;
  update public.provider_events
  set processed_at = now(),
      processing_error = null
  where id = event.id;
  return true;
end
$$;
revoke all on function internal.process_provider_event(uuid, text) from public;

create or replace function public.process_provider_event(
  p_provider_event_id uuid,
  p_expected_environment text
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.process_provider_event(
    p_provider_event_id, p_expected_environment
  )
$$;

create policy audit_owner_insert on public.audit_events
for insert to suiyue_audit_owner
with check (true);
create policy audit_owner_read_last on public.audit_events
for select to suiyue_audit_owner
using (true);

create or replace function internal.business_days_between(
  start_time timestamptz,
  end_time timestamptz
)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select count(*)::integer
  from generate_series(
    start_time::date,
    end_time::date - 1,
    interval '1 day'
  ) day
  where extract(isodow from day) between 1 and 5
$$;

create or replace function internal.add_business_days(
  start_time timestamptz,
  business_days integer
)
returns timestamptz
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  candidate timestamptz := start_time;
  remaining integer := business_days;
begin
  if remaining < 0 then
    raise exception 'BUSINESS_DAYS_MUST_BE_NONNEGATIVE';
  end if;
  while remaining > 0 loop
    candidate := candidate + interval '1 day';
    if extract(isodow from candidate) between 1 and 5 then
      remaining := remaining - 1;
    end if;
  end loop;
  return candidate;
end
$$;

create or replace function internal.release_expired_live_holds(
  target_session uuid default null,
  row_limit integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  released record;
  released_count integer := 0;
  released_for_order integer;
begin
  if row_limit not between 1 and 5000 then
    raise exception 'LIVE_HOLD_RELEASE_LIMIT_INVALID';
  end if;
  for released in
    select booking.id, booking.payer_type, booking.payer_source_id
    from public.live_bookings booking
    where booking.status = 'held'
      and booking.hold_expires_at <= clock_timestamp()
      and (
        target_session is null
        or booking.live_session_id = target_session
      )
    order by booking.hold_expires_at, booking.id
    limit row_limit
    for update skip locked
  loop
    update public.live_bookings
    set status = 'released'
    where id = released.id
      and status = 'held'
      and hold_expires_at <= clock_timestamp();
    if found then
      released_for_order := 1;
      if released.payer_type = 'b2c' then
        -- A hybrid order is one indivisible payment promise. Once any
        -- required component loses its hold, release all sibling holds in
        -- the same transaction so no orphan capacity remains occupied.
        with sibling_release as (
          update public.live_bookings sibling
          set status = 'released'
          where sibling.payer_type = 'b2c'
            and sibling.payer_source_id = released.payer_source_id
            and sibling.status = 'held'
          returning 1
        )
        select count(*) + 1 into released_for_order
        from sibling_release;
        update public.orders
        set status = 'expired'
        where id = released.payer_source_id
          and status in (
            'pending_transfer', 'proof_submitted', 'payment_review'
          );
      end if;
      perform internal.append_audit_event(
        null, 'live_booking.hold_expired', 'live_booking',
        released.id::text, 'server receipt time exceeded held capacity',
        null, jsonb_build_object(
          'orderId', released.payer_source_id,
          'releasedBookingCount', released_for_order
        )
      );
      released_count := released_count + 1;
    end if;
  end loop;
  return released_count;
end
$$;
revoke all on function internal.release_expired_live_holds(uuid, integer)
  from public;

create or replace function internal.expire_due_live_booking_holds(
  row_limit integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'LIVE_HOLD_WORKER_AUTHORITY_REQUIRED';
  end if;
  return internal.release_expired_live_holds(null, row_limit);
end
$$;
revoke all on function internal.expire_due_live_booking_holds(integer)
  from public;

create or replace function public.expire_due_live_booking_holds(
  p_limit integer default 1000
)
returns integer
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.expire_due_live_booking_holds(p_limit)
$$;
revoke all on function public.expire_due_live_booking_holds(integer)
  from public;

create or replace function internal.create_b2c_order(
  course_version uuid,
  legal_acceptance uuid,
  live_selections jsonb,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  version_row public.course_versions%rowtype;
  decision_row public.accreditation_decision_revisions%rowtype;
  acceptance_row public.legal_acceptances%rowtype;
  existing_order public.orders%rowtype;
  order_id uuid;
  order_number text;
  transfer_due timestamptz;
  bank_setting jsonb;
  selected record;
  session_row public.live_sessions%rowtype;
  booking_count integer;
begin
  if not internal.feature_is_open('b2c_commerce') then
    raise exception 'B2C_COMMERCE_CLOSED';
  end if;

  select * into existing_order
  from public.orders
  where person_id = actor and idempotency_key = idempotency;
  if found then
    return jsonb_build_object(
      'orderId', existing_order.id,
      'orderNumber', existing_order.order_number,
      'expiresAt', existing_order.transfer_due_at
    );
  end if;

  select * into version_row
  from public.course_versions
  where id = course_version
  for share;
  if not found
     or version_row.status <> 'published'
     or version_row.commerce_close_at <= now()
     or version_row.price_twd is null
     or version_row.legal_document_id is null
     or version_row.retention_policy_revision_id is null
  then
    raise exception 'COURSE_NOT_SELLABLE';
  end if;

  select decision.* into decision_row
  from public.course_version_accreditation link
  join public.accreditation_decision_revisions decision
    on decision.id = link.accreditation_revision_id
  where link.course_version_id = version_row.id
  order by decision.revision desc
  limit 1;
  if not found or decision_row.status not in ('applying', 'approved') then
    raise exception 'ACCREDITATION_NOT_SELLABLE';
  end if;

  select * into acceptance_row
  from public.legal_acceptances
  where id = legal_acceptance
    and person_id = actor
    and legal_document_id = version_row.legal_document_id;
  if not found
     or acceptance_row.second_confirmed_at is null
     or acceptance_row.second_confirmed_at
       < acceptance_row.first_presented_at + interval '72 hours'
  then
    raise exception 'CONTRACT_SECOND_CONFIRMATION_REQUIRED';
  end if;

  select setting.value into bank_setting
  from public.operating_setting_revisions setting
  where setting.setting_key = 'bank_account'
    and setting.effective_at <= now()
    and (setting.superseded_at is null or setting.superseded_at > now())
  order by setting.revision desc
  limit 1;
  if bank_setting is null
     or bank_setting ->> 'bankName' is null
     or bank_setting ->> 'bankCode' is null
     or bank_setting ->> 'accountName' is null
     or bank_setting ->> 'accountNumber' is null
     or bank_setting ->> 'maskedAccount' is null
  then
    raise exception 'BANK_CONFIGURATION_MISSING';
  end if;

  if version_row.delivery_type in ('live', 'hybrid') then
    if jsonb_typeof(live_selections) <> 'object'
       or jsonb_object_length(live_selections) = 0
    then
      raise exception 'LIVE_SESSION_SELECTION_REQUIRED';
    end if;
    for selected in
      select key as component_id, value #>> '{}' as session_id
      from jsonb_each(live_selections)
      order by value #>> '{}'
    loop
      select * into session_row
      from public.live_sessions
      where id = selected.session_id::uuid
        and course_version_id = version_row.id
        and status in ('scheduled', 'open')
      for update;
      if not found
         or internal.business_days_between(now(), session_row.starts_at) < 3
         or session_row.booking_close_at <= now()
      then
        raise exception 'LIVE_SESSION_NOT_BOOKABLE';
      end if;
      perform internal.release_expired_live_holds(session_row.id, 1000);
      select count(*) into booking_count
      from public.live_bookings
      where live_session_id = session_row.id
        and (
          status in ('confirmed', 'attended')
          or (status = 'held' and hold_expires_at > clock_timestamp())
        );
      if booking_count >= session_row.learner_capacity then
        raise exception 'LIVE_SESSION_FULL';
      end if;
    end loop;
  end if;

  transfer_due := case
    when version_row.delivery_type = 'recorded'
      then now() + interval '72 hours'
    else now() + interval '24 hours'
  end;
  order_id := gen_random_uuid();
  order_number := 'SY' || to_char(now(), 'YYYYMMDD')
    || upper(substr(replace(order_id::text, '-', ''), 1, 10));

  insert into public.orders (
    id, order_number, person_id, legal_acceptance_id, status,
    amount_due_twd, accreditation_disclosure_snapshot, price_snapshot,
    transfer_due_at, idempotency_key
  ) values (
    order_id, order_number, actor, legal_acceptance, 'pending_transfer',
    version_row.price_twd,
    case when decision_row.status = 'applying'
      then '積分申請中、尚未核定、不保證取得點數'
      else '積分核定資訊以訂單快照為準'
    end,
    jsonb_build_object(
      'courseVersionId', version_row.id,
      'priceTwd', version_row.price_twd,
      'recordedAllocationTwd', version_row.recorded_refund_allocation_twd,
      'liveAllocations', version_row.live_refund_allocations,
      'accreditationRevisionId', decision_row.id,
      'relatedParty', false
    ),
    transfer_due, idempotency
  );

  insert into public.order_items (
    order_id, course_version_id, scope_type, title_snapshot,
    amount_twd, price_allocation_snapshot
  ) values (
    order_id, version_row.id, 'whole_course', version_row.title,
    version_row.price_twd,
    jsonb_build_object(
      'recorded', version_row.recorded_refund_allocation_twd,
      'live', version_row.live_refund_allocations
    )
  );

  insert into public.bank_payment_instructions (
    order_id, bank_name_snapshot, bank_code_snapshot, account_name_snapshot,
    account_number_snapshot, masked_account_snapshot, amount_twd, expires_at
  ) values (
    order_id, bank_setting ->> 'bankName', bank_setting ->> 'bankCode',
    bank_setting ->> 'accountName', bank_setting ->> 'accountNumber',
    bank_setting ->> 'maskedAccount',
    version_row.price_twd, transfer_due
  );

  if version_row.delivery_type in ('live', 'hybrid') then
    for selected in
      select key as component_id, value #>> '{}' as session_id
      from jsonb_each(live_selections)
      order by value #>> '{}'
    loop
      insert into public.live_bookings (
        person_id, course_version_id, live_component_id, live_session_id,
        payer_type, payer_source_id, status, customer_key, hold_expires_at,
        change_locked_at, idempotency_key
      ) values (
        actor, version_row.id,
        case when selected.component_id = 'course'
          then null else selected.component_id::uuid end,
        selected.session_id::uuid, 'b2c', order_id, 'held',
        rtrim(
          translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_'),
          '='
        ),
        now() + interval '24 hours',
        (
          select starts_at - interval '24 hours'
          from public.live_sessions where id = selected.session_id::uuid
        ),
        gen_random_uuid()
      );
    end loop;
  end if;

  perform internal.append_audit_event(
    actor, 'order.created', 'order', order_id::text,
    'B2C manual bank transfer order', null,
    jsonb_build_object('amountTwd', version_row.price_twd)
  );
  return jsonb_build_object(
    'orderId', order_id,
    'orderNumber', order_number,
    'expiresAt', transfer_due
  );
end
$$;
revoke all on function internal.create_b2c_order(
  uuid, uuid, jsonb, uuid
) from public;

create or replace function public.create_b2c_order(
  p_course_version_id uuid,
  p_legal_acceptance_id uuid,
  p_live_selections jsonb,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.create_b2c_order(
    p_course_version_id, p_legal_acceptance_id,
    p_live_selections, p_idempotency_key
  )
$$;

create or replace function internal.submit_payment_proof(
  order_identifier uuid,
  remitter text,
  bank text,
  last_five text,
  transferred timestamptz,
  amount integer,
  object_path text,
  content_hash text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  target_order public.orders%rowtype;
begin
  select * into target_order
  from public.orders
  where id = order_identifier and person_id = actor
  for update;
  if not found
     or target_order.status not in ('pending_transfer', 'proof_submitted')
     or target_order.transfer_due_at < clock_timestamp()
     or transferred > clock_timestamp() + interval '5 minutes'
  then
    raise exception 'PAYMENT_PROOF_REJECTED';
  end if;
  if exists (
    select 1
    from public.live_bookings booking
    join public.live_sessions session
      on session.id = booking.live_session_id
    where booking.payer_type = 'b2c'
      and booking.payer_source_id = target_order.id
      and (
        booking.status <> 'held'
        or booking.hold_expires_at <= clock_timestamp()
        or session.booking_close_at <= clock_timestamp()
      )
  ) then
    raise exception 'LIVE_HOLD_EXPIRED';
  end if;

  insert into public.payment_proofs (
    order_id, submitted_by, remitter_name, bank_name, account_last_five,
    transferred_at, amount_twd, promoted_object_path, content_sha256,
    scan_status, idempotency_key
  ) values (
    target_order.id, actor, remitter, bank, last_five, transferred, amount,
    object_path, content_hash,
    case when object_path is null then 'not_provided' else 'safe' end,
    idempotency
  )
  on conflict (submitted_by, idempotency_key) do nothing;

  update public.orders set status = 'proof_submitted'
    where id = target_order.id and status = 'pending_transfer';
  update public.live_bookings booking
  set hold_expires_at = least(
    internal.add_business_days(clock_timestamp(), 2),
    session.booking_close_at
  )
  from public.live_sessions session
  where session.id = booking.live_session_id
    and booking.payer_type = 'b2c'
    and booking.payer_source_id = target_order.id
    and booking.status = 'held'
    and booking.hold_expires_at > clock_timestamp();
  perform internal.append_audit_event(
    actor, 'payment_proof.submitted', 'order', target_order.id::text,
    'proof is evidence only and does not unlock access', null,
    jsonb_build_object('amountTwd', amount, 'hasObject', object_path is not null)
  );
  return jsonb_build_object('status', 'proof_submitted');
end
$$;
revoke all on function internal.submit_payment_proof(
  uuid, text, text, text, timestamptz, integer, text, text, uuid
) from public;

create or replace function public.submit_payment_proof(
  p_order_id uuid,
  p_remitter_name text,
  p_bank_name text,
  p_account_last_five text,
  p_transferred_at timestamptz,
  p_amount_twd integer,
  p_object_path text,
  p_content_hash text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.submit_payment_proof(
    p_order_id, p_remitter_name, p_bank_name, p_account_last_five,
    p_transferred_at, p_amount_twd, p_object_path, p_content_hash,
    p_idempotency_key
  )
$$;

create or replace function internal.authorize_recorded_playback(
  target_enrollment uuid,
  lesson_video_version uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  enrollment_row public.enrollments%rowtype;
  asset_uid text;
  asset_duration_seconds integer;
  session_id uuid;
  next_epoch bigint;
  nonce text;
  challenge_row public.presence_challenges%rowtype;
  candidate_source public.playback_sessions%rowtype;
  resume_source public.playback_sessions%rowtype;
  resumed_challenge_token text;
  resumed_candidate_seconds integer := 0;
  candidate_origin_video_version_id uuid;
  candidate_origin_position numeric;
  candidate_manifest jsonb := '[]'::jsonb;
  challenge_origin_lesson_id uuid;
  challenge_timed_out boolean := false;
  rewind_fence public.recorded_rewind_fences%rowtype;
  rewind_position numeric;
  resume_position numeric;
begin
  if not internal.feature_is_open('recorded_playback') then
    raise exception 'RECORDED_PLAYBACK_CLOSED';
  end if;
  select enrollment.* into enrollment_row
  from public.lesson_video_versions lvv
  join public.lessons lesson on lesson.id = lvv.lesson_id
  join public.modules module on module.id = lesson.module_id
  join public.enrollments enrollment
    on enrollment.course_version_id = module.course_version_id
  join public.entitlements entitlement
    on entitlement.id = enrollment.entitlement_id
  join public.course_version_accreditation cva
    on cva.course_version_id = module.course_version_id
  join public.accreditation_decision_revisions decision
    on decision.id = cva.accreditation_revision_id
  where lvv.id = lesson_video_version
    and lvv.active
    and enrollment.id = target_enrollment
    and enrollment.person_id = actor
    and enrollment.status = 'active'
    and entitlement.status = 'active'
    and not exists (
      select 1
      from public.refund_cases refund_case
      join public.refund_allocations allocation
        on allocation.refund_case_id = refund_case.id
      where refund_case.order_id = entitlement.source_id
        and entitlement.source_type = 'b2c_order'
        and refund_case.status not in ('rejected', 'failed')
        and allocation.scope_type in ('recorded', 'whole_order')
    )
    and exists (
      select 1
      from private.accreditation_identity_profiles profile
      where profile.person_id = actor
        and profile.status in ('submitted', 'verified', 'needs_correction')
        and enrollment.identity_profile_confirmed_at is not null
        and enrollment.identity_profile_revision_confirmed =
          profile.profile_revision
    )
    and decision.status = 'approved'
    and decision.valid_from <= now()
    and decision.valid_until > now()
  order by decision.revision desc
  limit 1;
  if not found then
    raise exception 'PLAYBACK_NOT_AUTHORIZED';
  end if;

  select asset.provider_uid, asset.duration_seconds
    into asset_uid, asset_duration_seconds
  from public.lesson_video_versions lvv
  join public.video_assets asset on asset.id = lvv.video_asset_id
  where lvv.id = lesson_video_version
    and asset.status = 'ready'
    and asset.require_signed_urls
    and asset.duration_seconds > 0;
  if asset_uid is null or asset_duration_seconds is null then
    raise exception 'VIDEO_NOT_READY';
  end if;

  -- Serialize device takeover with all other starts for the same enrollment.
  perform 1
  from public.enrollments
  where id = enrollment_row.id
  for update;

  select challenge.* into challenge_row
  from public.presence_challenges challenge
  where challenge.enrollment_id = enrollment_row.id
    and challenge.consumed_at is null
    and challenge.confirmed_at is null
    and challenge.timed_out_at is null
  order by challenge.issued_at
  limit 1
  for update;
  if found and clock_timestamp() >= challenge_row.expires_at then
    update public.presence_challenges
    set timed_out_at = clock_timestamp(),
        consumed_at = clock_timestamp()
    where id = challenge_row.id
      and consumed_at is null;
    challenge_timed_out := true;
    candidate_origin_video_version_id :=
      challenge_row.lesson_video_version_id;
    candidate_origin_position :=
      challenge_row.block_started_media_position_seconds;
    select lvv.lesson_id into challenge_origin_lesson_id
    from public.lesson_video_versions lvv
    where lvv.id = challenge_row.lesson_video_version_id;
    rewind_position := case
      when challenge_row.lesson_video_version_id = lesson_video_version
        then challenge_row.block_started_media_position_seconds
      else null
    end;
    insert into public.recorded_rewind_fences (
      enrollment_id, lesson_video_version_id,
      presence_challenge_id, rewind_position_seconds
    ) values (
      enrollment_row.id, challenge_row.lesson_video_version_id,
      challenge_row.id,
      challenge_row.block_started_media_position_seconds
    )
    on conflict (enrollment_id)
      where satisfied_at is null do nothing;
    challenge_row.id := null;
  end if;

  -- Candidate minutes are scoped to the enrollment, not the video. The latest
  -- source is moved to the newly issued lease so that several short lessons can
  -- together reach the ten-minute presence checkpoint.
  select session.* into candidate_source
  from public.playback_sessions session
  where session.enrollment_id = enrollment_row.id
    and session.candidate_unconfirmed_seconds > 0
  order by session.active desc, session.lease_epoch desc
  limit 1
  for update;
  if candidate_source.id is not null
     and challenge_row.id is null
     and not challenge_timed_out
  then
    resumed_candidate_seconds :=
      candidate_source.candidate_unconfirmed_seconds;
    candidate_origin_video_version_id :=
      candidate_source.candidate_origin_lesson_video_version_id;
    candidate_origin_position :=
      candidate_source.candidate_origin_media_position_seconds;
    candidate_manifest := candidate_source.candidate_event_manifest;
  end if;

  -- Resume media position is video-specific and deliberately independent of
  -- the enrollment-wide candidate-minute carry.
  select session.* into resume_source
  from public.playback_sessions session
  where session.enrollment_id = enrollment_row.id
    and session.lesson_video_version_id = lesson_video_version
    and session.last_media_position_seconds is not null
  order by session.last_received_at desc nulls last,
    session.lease_epoch desc
  limit 1;
  if resume_source.id is not null then
    resume_position := resume_source.last_media_position_seconds;
  end if;
  if challenge_timed_out
     and candidate_origin_video_version_id = lesson_video_version
  then
    resume_position := candidate_origin_position;
  end if;
  select fence.* into rewind_fence
  from public.recorded_rewind_fences fence
  where fence.enrollment_id = enrollment_row.id
    and fence.satisfied_at is null
  order by fence.created_at
  limit 1
  for update;
  if rewind_fence.id is not null then
    if rewind_fence.lesson_video_version_id <> lesson_video_version then
      select lvv.lesson_id into challenge_origin_lesson_id
      from public.lesson_video_versions lvv
      where lvv.id = rewind_fence.lesson_video_version_id;
      update public.playback_sessions
      set active = false,
          closed_at = coalesce(closed_at, clock_timestamp()),
          candidate_unconfirmed_seconds = 0,
          candidate_origin_lesson_video_version_id = null,
          candidate_origin_media_position_seconds = null,
          candidate_event_manifest = '[]'::jsonb
      where enrollment_id = enrollment_row.id;
      return jsonb_build_object(
        'rewind_origin_required', true,
        'enrollment_id', enrollment_row.id,
        'video_uid', null,
        'duration_seconds', null,
        'playback_session_id', null,
        'lease_epoch', null,
        'candidate_seconds', 0,
        'challenge_required', false,
        'challenge_token', null,
        'challenge_expires_at', null,
        'challenge_timed_out', challenge_timed_out,
        'challenge_origin_lesson_id', challenge_origin_lesson_id,
        'challenge_origin_video_version_id',
          rewind_fence.lesson_video_version_id,
        'challenge_origin_position_seconds',
          rewind_fence.rewind_position_seconds,
        'rewind_fence_active', true,
        'rewind_to_seconds', rewind_fence.rewind_position_seconds,
        'resume_at_seconds', null,
        'watermark_text', null
      );
    end if;
    resume_position := rewind_fence.rewind_position_seconds;
    rewind_position := rewind_fence.rewind_position_seconds;
  end if;

  select coalesce(max(lease_epoch), 0) + 1 into next_epoch
  from public.playback_sessions where person_id = actor;
  update public.playback_sessions
    set active = false, closed_at = now()
    where person_id = actor and active;
  nonce := rtrim(
    translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_'),
    '='
  );
  insert into public.playback_sessions (
    enrollment_id, person_id, lesson_video_version_id,
    session_nonce_hash, device_hash, lease_epoch,
    candidate_unconfirmed_seconds, last_media_position_seconds,
    candidate_origin_lesson_video_version_id,
    candidate_origin_media_position_seconds,
    candidate_event_manifest, rewind_fence_id
  ) values (
    enrollment_row.id, actor, lesson_video_version,
    encode(extensions.digest(nonce, 'sha256'), 'hex'),
    'server-issued', next_epoch,
    case when challenge_row.id is null
      then resumed_candidate_seconds
      else challenge_row.block_seconds
        + challenge_row.surplus_candidate_seconds end,
    resume_position,
    case
      when challenge_row.id is not null
        then challenge_row.lesson_video_version_id
      when resumed_candidate_seconds > 0
        then candidate_origin_video_version_id
      else null
    end,
    case
      when challenge_row.id is not null
        then challenge_row.block_started_media_position_seconds
      when resumed_candidate_seconds > 0
        then candidate_origin_position
      else null
    end,
    case when challenge_row.id is not null
      then challenge_row.event_manifest
        || challenge_row.surplus_event_manifest
      else candidate_manifest
    end,
    rewind_fence.id
  )
  returning id into session_id;
  if rewind_fence.id is not null then
    update public.recorded_rewind_fences
    set claimed_playback_session_id = session_id,
        claimed_after_sequence = 0,
        baseline_sequence = null,
        baseline_established_at = null
    where id = rewind_fence.id
      and satisfied_at is null;
  end if;

  if challenge_row.id is not null then
    resumed_challenge_token := rtrim(
      translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_'),
      '='
    );
    resumed_candidate_seconds := challenge_row.block_seconds
      + challenge_row.surplus_candidate_seconds;
    candidate_origin_video_version_id :=
      challenge_row.lesson_video_version_id;
    candidate_origin_position :=
      challenge_row.block_started_media_position_seconds;
    select lvv.lesson_id into challenge_origin_lesson_id
    from public.lesson_video_versions lvv
    where lvv.id = challenge_row.lesson_video_version_id;
    rewind_position := case
      when challenge_row.lesson_video_version_id = lesson_video_version
        then challenge_row.block_started_media_position_seconds
      else null
    end;
    update public.presence_challenges
    set token_hash = encode(
          extensions.digest(resumed_challenge_token, 'sha256'), 'hex'
        )
    where id = challenge_row.id
      and consumed_at is null
      and clock_timestamp() < expires_at;
  end if;
  update public.playback_sessions
  set candidate_unconfirmed_seconds = 0,
      candidate_origin_lesson_video_version_id = null,
      candidate_origin_media_position_seconds = null,
      candidate_event_manifest = '[]'::jsonb
  where enrollment_id = enrollment_row.id
    and id <> session_id;
  if challenge_origin_lesson_id is null
     and candidate_origin_video_version_id is not null
  then
    select lvv.lesson_id into challenge_origin_lesson_id
    from public.lesson_video_versions lvv
    where lvv.id = candidate_origin_video_version_id;
  end if;

  return jsonb_build_object(
    'rewind_origin_required', false,
    'enrollment_id', enrollment_row.id,
    'video_uid', asset_uid,
    'duration_seconds', asset_duration_seconds,
    'playback_session_id', session_id,
    'lease_epoch', next_epoch,
    'candidate_seconds', resumed_candidate_seconds,
    'challenge_required', challenge_row.id is not null,
    'challenge_token', resumed_challenge_token,
    'challenge_expires_at', case
      when challenge_row.id is not null then challenge_row.expires_at
      else null
    end,
    'challenge_timed_out', challenge_timed_out,
    'challenge_origin_lesson_id', challenge_origin_lesson_id,
    'challenge_origin_video_version_id',
      candidate_origin_video_version_id,
    'challenge_origin_position_seconds', candidate_origin_position,
    'rewind_fence_active', rewind_fence.id is not null,
    'rewind_to_seconds', rewind_position,
    'resume_at_seconds', resume_position,
    'watermark_text', coalesce(
      (select display_name from public.people where id = actor),
      '歲悅學員'
    )
  );
end
$$;
revoke all on function internal.authorize_recorded_playback(uuid, uuid)
  from public;

create or replace function public.authorize_recorded_playback(
  p_enrollment_id uuid,
  p_lesson_video_version_id uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.authorize_recorded_playback(
    p_enrollment_id, p_lesson_video_version_id
  )
$$;

create or replace function internal.split_candidate_manifest(
  candidate_manifest jsonb,
  target_seconds integer
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  entry jsonb;
  entry_seconds integer;
  block_entry_seconds integer;
  remaining integer := target_seconds;
  block_manifest jsonb := '[]'::jsonb;
  surplus_manifest jsonb := '[]'::jsonb;
begin
  if target_seconds <= 0
     or jsonb_typeof(candidate_manifest) <> 'array'
  then
    raise exception 'CANDIDATE_MANIFEST_SPLIT_INVALID';
  end if;
  for entry in
    select value from jsonb_array_elements(candidate_manifest)
  loop
    begin
      entry_seconds := (entry ->> 'creditedSeconds')::integer;
    exception when others then
      raise exception 'CANDIDATE_MANIFEST_ENTRY_INVALID';
    end;
    if entry_seconds <= 0 then
      raise exception 'CANDIDATE_MANIFEST_ENTRY_INVALID';
    end if;
    block_entry_seconds := least(entry_seconds, greatest(remaining, 0));
    if block_entry_seconds > 0 then
      block_manifest := block_manifest || jsonb_build_array(
        entry || jsonb_build_object(
          'creditedSeconds', block_entry_seconds
        )
      );
      remaining := remaining - block_entry_seconds;
    end if;
    if entry_seconds > block_entry_seconds then
      surplus_manifest := surplus_manifest || jsonb_build_array(
        entry || jsonb_build_object(
          'creditedSeconds', entry_seconds - block_entry_seconds
        )
      );
    end if;
  end loop;
  if remaining <> 0 then
    raise exception 'CANDIDATE_MANIFEST_TARGET_NOT_REACHED';
  end if;
  return jsonb_build_object(
    'blockManifest', block_manifest,
    'surplusManifest', surplus_manifest
  );
end
$$;
revoke all on function internal.split_candidate_manifest(jsonb, integer)
  from public;

create or replace function internal.record_playback_heartbeat(
  target_enrollment uuid,
  playback_session uuid,
  reported_lease_epoch bigint,
  reported_sequence bigint,
  media_position numeric,
  is_playing boolean,
  is_visible boolean,
  is_online boolean,
  challenge_token text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  session_row public.playback_sessions%rowtype;
  received_delta numeric;
  media_delta numeric;
  accepted_seconds integer := 0;
  confirmed_seconds integer := 0;
  required_seconds integer;
  block_target integer;
  total_candidate_seconds integer;
  surplus_candidate_seconds integer := 0;
  token text;
  challenge_id uuid;
  rewind_position numeric;
  pending_challenge public.presence_challenges%rowtype;
  origin_video_version_id uuid;
  origin_lesson_id uuid;
  origin_position numeric;
  previous_playing boolean := false;
  previous_visible boolean := false;
  previous_online boolean := false;
  challenge_expires_at timestamptz;
  rewind_fence public.recorded_rewind_fences%rowtype;
  playback_event_id uuid;
  playback_event_received_at timestamptz;
  accepted_event_entry jsonb;
  challenge_manifest jsonb;
  surplus_manifest jsonb := '[]'::jsonb;
  complete_candidate_manifest jsonb;
  manifest_split jsonb;
begin
  select * into session_row
  from public.playback_sessions
  where id = playback_session
    and enrollment_id = target_enrollment
  for update;
  if not found
     or session_row.person_id <> actor
     or not session_row.active
     or session_row.lease_epoch <> reported_lease_epoch
     or reported_sequence <> session_row.last_sequence + 1
  then
    raise exception 'PLAYBACK_LEASE_REJECTED';
  end if;
  if not internal.feature_is_open('recorded_playback')
     or not exists (
       select 1
       from public.enrollments enrollment
       join public.entitlements entitlement
         on entitlement.id = enrollment.entitlement_id
       join public.lesson_video_versions lvv
         on lvv.id = session_row.lesson_video_version_id
       join public.lessons lesson on lesson.id = lvv.lesson_id
       join public.modules module on module.id = lesson.module_id
       join public.course_version_accreditation cva
         on cva.course_version_id = module.course_version_id
       join public.accreditation_decision_revisions decision
         on decision.id = cva.accreditation_revision_id
       where enrollment.id = session_row.enrollment_id
         and enrollment.person_id = actor
         and enrollment.course_version_id = module.course_version_id
         and enrollment.status = 'active'
         and entitlement.status = 'active'
         and lvv.active
         and decision.status = 'approved'
         and decision.valid_from <= now()
         and decision.valid_until > now()
         and exists (
           select 1
           from private.accreditation_identity_profiles profile
           where profile.person_id = actor
             and profile.status in (
               'submitted', 'verified', 'needs_correction'
             )
             and enrollment.identity_profile_confirmed_at is not null
             and enrollment.identity_profile_revision_confirmed =
               profile.profile_revision
         )
         and not exists (
           select 1
           from public.refund_cases refund_case
           join public.refund_allocations allocation
             on allocation.refund_case_id = refund_case.id
           where refund_case.order_id = entitlement.source_id
             and entitlement.source_type = 'b2c_order'
             and refund_case.status not in ('rejected', 'failed')
             and allocation.scope_type in ('recorded', 'whole_order')
         )
     )
  then
    raise exception 'PLAYBACK_ENTITLEMENT_REVOKED';
  end if;
  if session_row.last_sequence > 0 then
    select event.playing, event.visible, event.online
      into previous_playing, previous_visible, previous_online
    from public.playback_events event
    where event.playback_session_id = session_row.id
      and event.sequence = session_row.last_sequence
      and event.lease_epoch = session_row.lease_epoch
    order by event.received_at desc
    limit 1;
  end if;
  if session_row.rewind_fence_id is not null then
    select fence.* into rewind_fence
    from public.recorded_rewind_fences fence
    where fence.id = session_row.rewind_fence_id
      and fence.enrollment_id = session_row.enrollment_id
      and fence.lesson_video_version_id =
        session_row.lesson_video_version_id
      and fence.claimed_playback_session_id = session_row.id
      and fence.satisfied_at is null
    for update;
    if rewind_fence.id is not null
       and rewind_fence.baseline_sequence is null
       and (
         media_position < rewind_fence.rewind_position_seconds
         or media_position > rewind_fence.rewind_position_seconds + 3
       )
    then
      raise exception 'REWIND_FENCE_POSITION_REQUIRED';
    end if;
  end if;

  select challenge.* into pending_challenge
  from public.presence_challenges challenge
  where challenge.enrollment_id = session_row.enrollment_id
    and challenge.consumed_at is null
    and challenge.confirmed_at is null
    and challenge.timed_out_at is null
  order by challenge.issued_at
  limit 1
  for update;
  if found and clock_timestamp() >= pending_challenge.expires_at then
    origin_video_version_id :=
      pending_challenge.lesson_video_version_id;
    origin_position :=
      pending_challenge.block_started_media_position_seconds;
    select lvv.lesson_id into origin_lesson_id
    from public.lesson_video_versions lvv
    where lvv.id = origin_video_version_id;
    rewind_position := case
      when origin_video_version_id = session_row.lesson_video_version_id
        then origin_position
      else null
    end;
    update public.presence_challenges
      set timed_out_at = clock_timestamp(),
          consumed_at = clock_timestamp()
      where id = pending_challenge.id
        and consumed_at is null;
    insert into public.recorded_rewind_fences (
      enrollment_id, lesson_video_version_id,
      presence_challenge_id, rewind_position_seconds
    ) values (
      session_row.enrollment_id,
      pending_challenge.lesson_video_version_id,
      pending_challenge.id,
      pending_challenge.block_started_media_position_seconds
    )
    on conflict (enrollment_id)
      where satisfied_at is null do nothing;
    if pending_challenge.lesson_video_version_id =
         session_row.lesson_video_version_id
    then
      select fence.* into rewind_fence
      from public.recorded_rewind_fences fence
      where fence.enrollment_id = session_row.enrollment_id
        and fence.lesson_video_version_id =
          session_row.lesson_video_version_id
        and fence.satisfied_at is null
      order by fence.created_at
      limit 1
      for update;
      update public.recorded_rewind_fences
      set claimed_playback_session_id = session_row.id,
          claimed_after_sequence = reported_sequence,
          baseline_sequence = null,
          baseline_established_at = null
      where id = rewind_fence.id;
    end if;
    insert into public.playback_events (
      playback_session_id, enrollment_id, sequence, lease_epoch,
      media_position_seconds, playing, visible, online, candidate_seconds
    ) values (
      session_row.id, session_row.enrollment_id, reported_sequence,
      reported_lease_epoch, coalesce(rewind_position, media_position), false,
      is_visible, is_online, 0
    );
    update public.playback_sessions
      set last_sequence = reported_sequence,
          last_media_position_seconds =
            coalesce(rewind_position, media_position),
          last_received_at = clock_timestamp(),
          candidate_unconfirmed_seconds = 0,
          candidate_origin_lesson_video_version_id = null,
          candidate_origin_media_position_seconds = null,
          candidate_event_manifest = '[]'::jsonb,
          rewind_fence_id = case
            when rewind_fence.id is not null
              then rewind_fence.id
            else rewind_fence_id
          end
      where id = session_row.id;
    update public.playback_sessions
      set candidate_unconfirmed_seconds = 0,
          candidate_origin_lesson_video_version_id = null,
          candidate_origin_media_position_seconds = null,
          candidate_event_manifest = '[]'::jsonb
      where enrollment_id = session_row.enrollment_id
        and id <> session_row.id;
    return jsonb_build_object(
      'candidateSeconds', 0,
      'confirmedSeconds', coalesce((
        select confirmed_valid_seconds
        from public.progress_summaries
        where enrollment_id = session_row.enrollment_id
      ), 0),
      'challengeRequired', false,
      'challengeToken', null,
      'challengeExpiresAt', pending_challenge.expires_at,
      'challengeTimedOut', true,
      'rewindToSeconds', rewind_position,
      'originLessonId', origin_lesson_id,
      'originVideoVersionId', origin_video_version_id,
      'originPositionSeconds', origin_position
    );
  end if;

  if pending_challenge.id is not null then
    if challenge_token is null
       or encode(
         extensions.digest(challenge_token, 'sha256'), 'hex'
       ) <> pending_challenge.token_hash
    then
      raise exception 'PRESENCE_CHALLENGE_TOKEN_REQUIRED';
    end if;
    insert into public.playback_events (
      playback_session_id, enrollment_id, sequence, lease_epoch,
      media_position_seconds, playing, visible, online,
      server_challenge_hash, candidate_seconds
    ) values (
      session_row.id, session_row.enrollment_id, reported_sequence,
      reported_lease_epoch, media_position, false, is_visible, is_online,
      pending_challenge.token_hash, 0
    );
    update public.playback_sessions
    set last_sequence = reported_sequence,
        last_media_position_seconds = media_position,
        last_received_at = clock_timestamp()
    where id = session_row.id;
    origin_video_version_id :=
      pending_challenge.lesson_video_version_id;
    origin_position :=
      pending_challenge.block_started_media_position_seconds;
    select lvv.lesson_id into origin_lesson_id
    from public.lesson_video_versions lvv
    where lvv.id = origin_video_version_id;
    return jsonb_build_object(
      'candidateSeconds', pending_challenge.block_seconds
        + pending_challenge.surplus_candidate_seconds,
      'confirmedSeconds', coalesce((
        select confirmed_valid_seconds
        from public.progress_summaries
        where enrollment_id = session_row.enrollment_id
      ), 0),
      'challengeRequired', true,
      'challengeToken', challenge_token,
      'challengeExpiresAt', pending_challenge.expires_at,
      'challengeTimedOut', false,
      'rewindToSeconds', case
        when origin_video_version_id =
          session_row.lesson_video_version_id
        then origin_position
        else null
      end,
      'originLessonId', origin_lesson_id,
      'originVideoVersionId', origin_video_version_id,
      'originPositionSeconds', origin_position
    );
  end if;

  if session_row.last_received_at is not null
     and previous_playing and previous_visible and previous_online
     and is_playing and is_visible and is_online
  then
    received_delta := extract(
      epoch from (clock_timestamp() - session_row.last_received_at)
    );
    media_delta := media_position - session_row.last_media_position_seconds;
    if received_delta > 0 and received_delta <= 45
       and media_delta >= 0
       and media_delta <= received_delta + 3
    then
      accepted_seconds := floor(least(received_delta, media_delta, 17));
    end if;
  end if;

  insert into public.playback_events (
    playback_session_id, enrollment_id, sequence, lease_epoch,
    media_position_seconds, playing, visible, online,
    server_challenge_hash, candidate_seconds
  ) values (
    session_row.id, session_row.enrollment_id, reported_sequence,
    reported_lease_epoch, media_position, is_playing, is_visible, is_online,
    case when challenge_token is null then null
      else encode(extensions.digest(challenge_token, 'sha256'), 'hex') end,
    accepted_seconds
  ) returning id, received_at
    into playback_event_id, playback_event_received_at;
  if accepted_seconds > 0 then
    accepted_event_entry := jsonb_build_object(
      'eventId', playback_event_id,
      'playbackSessionId', session_row.id,
      'sequence', reported_sequence,
      'leaseEpoch', reported_lease_epoch,
      'videoVersionId', session_row.lesson_video_version_id,
      'mediaPositionSeconds', media_position,
      'receivedAt', playback_event_received_at,
      'eventCandidateSeconds', accepted_seconds,
      'creditedSeconds', accepted_seconds
    );
  end if;
  if accepted_seconds > 0 then
    perform internal.consume_organization_assignment_for_enrollment(
      session_row.enrollment_id,
      'first_server_validated_recorded_segment'
    );
  end if;
  update public.playback_sessions
    set last_sequence = reported_sequence,
        last_media_position_seconds = media_position,
        last_received_at = clock_timestamp(),
        candidate_unconfirmed_seconds =
          candidate_unconfirmed_seconds + accepted_seconds,
        candidate_origin_lesson_video_version_id = case
          when candidate_unconfirmed_seconds = 0
               and accepted_seconds > 0
            then session_row.lesson_video_version_id
          else candidate_origin_lesson_video_version_id
        end,
        candidate_origin_media_position_seconds = case
          when candidate_unconfirmed_seconds = 0
               and accepted_seconds > 0
            then greatest(media_position - accepted_seconds, 0)
          else candidate_origin_media_position_seconds
        end,
        candidate_event_manifest = case
          when accepted_seconds > 0
            then candidate_event_manifest
              || jsonb_build_array(accepted_event_entry)
          else candidate_event_manifest
        end
    where id = session_row.id;
  if rewind_fence.id is not null
     and rewind_fence.baseline_sequence is null
  then
    update public.recorded_rewind_fences
    set baseline_sequence = reported_sequence,
        baseline_established_at = clock_timestamp()
    where id = rewind_fence.id
      and claimed_playback_session_id = session_row.id
      and claimed_after_sequence < reported_sequence
      and baseline_sequence is null
      and satisfied_at is null;
  end if;
  if accepted_seconds > 0
     and rewind_fence.id is not null
     and rewind_fence.baseline_sequence is not null
  then
    update public.recorded_rewind_fences
    set satisfied_at = clock_timestamp()
    where id = rewind_fence.id
      and claimed_playback_session_id = session_row.id
      and satisfied_at is null;
    update public.playback_sessions
    set rewind_fence_id = null
    where id = session_row.id
      and rewind_fence_id = rewind_fence.id;
  end if;

  select coalesce(summary.confirmed_valid_seconds, 0)
    into confirmed_seconds
  from public.progress_summaries summary
  where summary.enrollment_id = session_row.enrollment_id;
  if not found then confirmed_seconds := 0; end if;

  select requirement.required_watch_seconds into required_seconds
  from public.enrollments enrollment
  join public.course_requirements requirement
    on requirement.course_version_id = enrollment.course_version_id
  where enrollment.id = session_row.enrollment_id;

  block_target := least(600, greatest(required_seconds - confirmed_seconds, 0));
  total_candidate_seconds :=
    session_row.candidate_unconfirmed_seconds + accepted_seconds;
  if block_target > 0
     and total_candidate_seconds >= block_target
     and not exists (
       select 1 from public.presence_challenges challenge
       where challenge.enrollment_id = session_row.enrollment_id
         and challenge.consumed_at is null
         and challenge.timed_out_at is null
     )
  then
    surplus_candidate_seconds :=
      greatest(total_candidate_seconds - block_target, 0);
    complete_candidate_manifest := session_row.candidate_event_manifest;
    if accepted_seconds > 0 then
      complete_candidate_manifest :=
        complete_candidate_manifest || jsonb_build_array(
          accepted_event_entry
        );
    end if;
    manifest_split := internal.split_candidate_manifest(
      complete_candidate_manifest, block_target
    );
    challenge_manifest := manifest_split -> 'blockManifest';
    surplus_manifest := manifest_split -> 'surplusManifest';
    if coalesce((
         select sum((entry.value ->> 'creditedSeconds')::integer)
         from jsonb_array_elements(challenge_manifest) entry(value)
       ), 0) <> block_target
       or coalesce((
         select sum((entry.value ->> 'creditedSeconds')::integer)
         from jsonb_array_elements(surplus_manifest) entry(value)
       ), 0) <> surplus_candidate_seconds
    then
      raise exception 'CANDIDATE_MANIFEST_SPLIT_DRIFT';
    end if;
    origin_video_version_id := coalesce(
      session_row.candidate_origin_lesson_video_version_id,
      session_row.lesson_video_version_id
    );
    origin_position := coalesce(
      session_row.candidate_origin_media_position_seconds,
      greatest(media_position - accepted_seconds, 0)
    );
    select lvv.lesson_id into origin_lesson_id
    from public.lesson_video_versions lvv
    where lvv.id = origin_video_version_id;
    token := rtrim(
      translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_'),
      '='
    );
    insert into public.presence_challenges (
      enrollment_id, playback_session_id, lesson_video_version_id,
      token_hash,
      block_started_media_position_seconds, block_seconds,
      surplus_candidate_seconds,
      surplus_origin_lesson_video_version_id,
      surplus_origin_media_position_seconds,
      event_manifest, event_manifest_hash, surplus_event_manifest,
      issued_at, expires_at
    ) values (
      session_row.enrollment_id, session_row.id,
      origin_video_version_id,
      encode(extensions.digest(token, 'sha256'), 'hex'),
      origin_position, block_target,
      surplus_candidate_seconds,
      case when surplus_candidate_seconds > 0
        then (surplus_manifest -> 0 ->> 'videoVersionId')::uuid
        else null end,
      case when surplus_candidate_seconds > 0
        then greatest(
          (surplus_manifest -> 0 ->> 'mediaPositionSeconds')::numeric
            - (surplus_manifest -> 0 ->> 'creditedSeconds')::integer,
          0
        )
        else null end,
      challenge_manifest,
      encode(
        extensions.digest(challenge_manifest::text, 'sha256'),
        'hex'
      ),
      surplus_manifest,
      statement_timestamp(), statement_timestamp() + interval '90 seconds'
    ) returning id, expires_at
      into challenge_id, challenge_expires_at;
  end if;

  return jsonb_build_object(
    'candidateSeconds',
      total_candidate_seconds,
    'confirmedSeconds', confirmed_seconds,
    'challengeRequired', challenge_id is not null,
    'challengeToken', token,
    'challengeExpiresAt', challenge_expires_at,
    'challengeTimedOut', false,
    'originLessonId', origin_lesson_id,
    'originVideoVersionId', origin_video_version_id,
    'originPositionSeconds', origin_position
  );
end
$$;
revoke all on function internal.record_playback_heartbeat(
  uuid, uuid, bigint, bigint, numeric, boolean, boolean, boolean, text
) from public;

create or replace function public.record_playback_heartbeat(
  p_enrollment_id uuid,
  p_playback_session_id uuid,
  p_lease_epoch bigint,
  p_sequence bigint,
  p_media_position_seconds numeric,
  p_playing boolean,
  p_visible boolean,
  p_online boolean,
  p_challenge_token text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.record_playback_heartbeat(
    p_enrollment_id, p_playback_session_id, p_lease_epoch, p_sequence,
    p_media_position_seconds, p_playing, p_visible, p_online,
    p_challenge_token
  )
$$;

create or replace function internal.confirm_presence_challenge(
  target_enrollment uuid,
  plain_token text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  challenge_row public.presence_challenges%rowtype;
  new_total integer;
  candidate_target uuid;
  canonical_manifest_hash text;
begin
  select challenge.* into challenge_row
  from public.presence_challenges challenge
  join public.enrollments enrollment on enrollment.id = challenge.enrollment_id
  where challenge.token_hash =
      encode(extensions.digest(plain_token, 'sha256'), 'hex')
    and challenge.enrollment_id = target_enrollment
    and enrollment.person_id = actor
  for update of challenge;
  if found
     and challenge_row.confirmed_at is not null
     and challenge_row.consumed_at is not null
     and exists (
       select 1
       from public.confirmed_watch_blocks block
       where block.presence_challenge_id = challenge_row.id
         and block.confirmation_idempotency_key = idempotency
     )
  then
    return jsonb_build_object(
      'confirmedSeconds', coalesce((
        select summary.confirmed_valid_seconds
        from public.progress_summaries summary
        where summary.enrollment_id = challenge_row.enrollment_id
      ), 0),
      'candidateSeconds', coalesce((
        select summary.candidate_seconds
        from public.progress_summaries summary
        where summary.enrollment_id = challenge_row.enrollment_id
      ), 0),
      'replayed', true
    );
  end if;
  if not found
     or challenge_row.consumed_at is not null
     or challenge_row.confirmed_at is not null
     or challenge_row.timed_out_at is not null
     or clock_timestamp() >= challenge_row.expires_at
  then
    raise exception 'PRESENCE_CHALLENGE_REJECTED';
  end if;
  if not exists (
    select 1
    from public.enrollments enrollment
    join public.entitlements entitlement
      on entitlement.id = enrollment.entitlement_id
    where enrollment.id = challenge_row.enrollment_id
      and enrollment.person_id = actor
      and enrollment.status = 'active'
      and entitlement.status = 'active'
      and not exists (
        select 1
        from public.refund_cases refund_case
        join public.refund_allocations allocation
          on allocation.refund_case_id = refund_case.id
        where entitlement.source_type = 'b2c_order'
          and refund_case.order_id = entitlement.source_id
          and refund_case.status not in ('rejected', 'failed')
          and allocation.scope_type in ('recorded', 'whole_order')
      )
  ) then
    raise exception 'PRESENCE_CHALLENGE_ENTITLEMENT_REVOKED';
  end if;
  if encode(
       extensions.digest(challenge_row.event_manifest::text, 'sha256'),
       'hex'
     ) <> challenge_row.event_manifest_hash
  then
    raise exception 'PRESENCE_CHALLENGE_MANIFEST_DRIFT';
  end if;

  update public.presence_challenges
    set confirmed_at = clock_timestamp(), consumed_at = clock_timestamp()
    where id = challenge_row.id;
  insert into public.confirmed_watch_blocks (
    enrollment_id, presence_challenge_id,
    confirmation_idempotency_key, seconds, confirmed_at,
    event_manifest_hash
  ) values (
    challenge_row.enrollment_id, challenge_row.id, idempotency,
    challenge_row.block_seconds, clock_timestamp(),
    challenge_row.event_manifest_hash
  );
  insert into public.progress_summaries (
    enrollment_id, confirmed_valid_seconds, candidate_seconds,
    source_event_count, source_manifest_hash, updated_at
  ) values (
    challenge_row.enrollment_id, challenge_row.block_seconds,
    challenge_row.surplus_candidate_seconds,
    jsonb_array_length(challenge_row.event_manifest),
    challenge_row.event_manifest_hash, now()
  )
  on conflict (enrollment_id) do update
    set confirmed_valid_seconds =
          public.progress_summaries.confirmed_valid_seconds
          + excluded.confirmed_valid_seconds,
        candidate_seconds = excluded.candidate_seconds,
        source_event_count =
          public.progress_summaries.source_event_count
          + excluded.source_event_count,
        source_manifest_hash = encode(extensions.digest(
          coalesce(public.progress_summaries.source_manifest_hash, '')
          || ':' || excluded.source_manifest_hash,
          'sha256'
        ), 'hex'),
        updated_at = now()
  returning confirmed_valid_seconds into new_total;
  select encode(extensions.digest(
    string_agg(
      block.event_manifest_hash, ':'
      order by block.confirmed_at, block.id
    ),
    'sha256'
  ), 'hex')
  into canonical_manifest_hash
  from public.confirmed_watch_blocks block
  where block.enrollment_id = challenge_row.enrollment_id;
  update public.progress_summaries
  set source_manifest_hash = canonical_manifest_hash
  where enrollment_id = challenge_row.enrollment_id;
  update public.playback_sessions
    set candidate_unconfirmed_seconds = 0,
        candidate_origin_lesson_video_version_id = null,
        candidate_origin_media_position_seconds = null,
        candidate_event_manifest = '[]'::jsonb
    where enrollment_id = challenge_row.enrollment_id;
  if challenge_row.surplus_candidate_seconds > 0 then
    select session.id into candidate_target
    from public.playback_sessions session
    where session.enrollment_id = challenge_row.enrollment_id
    order by session.active desc, session.lease_epoch desc
    limit 1
    for update;
    update public.playback_sessions
    set candidate_unconfirmed_seconds =
          challenge_row.surplus_candidate_seconds,
        candidate_origin_lesson_video_version_id =
          challenge_row.surplus_origin_lesson_video_version_id,
        candidate_origin_media_position_seconds =
          challenge_row.surplus_origin_media_position_seconds,
        candidate_event_manifest =
          challenge_row.surplus_event_manifest
    where id = candidate_target;
  end if;
  insert into public.durable_jobs (
    job_type, business_key, payload
  ) values (
    'recorded_progress_recompute',
    'recorded-progress-recompute:'
      || challenge_row.enrollment_id::text,
    jsonb_build_object(
      'enrollmentId', challenge_row.enrollment_id
    )
  )
  on conflict (business_key) do update
  set status = 'pending',
      available_at = now(),
      last_error = null,
      attempt_count = 0,
      completed_at = null;
  perform internal.append_audit_event(
    actor, 'playback.presence_confirmed', 'enrollment',
    challenge_row.enrollment_id::text, 'candidate block confirmed',
    null, jsonb_build_object(
      'seconds', challenge_row.block_seconds,
      'surplusCandidateSeconds',
        challenge_row.surplus_candidate_seconds,
      'originVideoVersionId',
        challenge_row.lesson_video_version_id,
      'originPositionSeconds',
        challenge_row.block_started_media_position_seconds
    )
  );
  return jsonb_build_object(
    'confirmedSeconds', new_total,
    'candidateSeconds', challenge_row.surplus_candidate_seconds,
    'replayed', false
  );
end
$$;
revoke all on function internal.confirm_presence_challenge(
  uuid, text, uuid
) from public;

create or replace function public.confirm_presence_challenge(
  p_enrollment_id uuid,
  p_challenge_token text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.confirm_presence_challenge(
    p_enrollment_id, p_challenge_token, p_idempotency_key
  )
$$;

create or replace function internal.recompute_recorded_progress_unchecked(
  target_enrollment uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  block_row record;
  manifest_entry jsonb;
  manifest_seconds integer;
  confirmed_total integer := 0;
  candidate_total integer := 0;
  source_count bigint := 0;
  computed_hash text;
  evidence_valid boolean := true;
  previous_summary public.progress_summaries%rowtype;
  drifted boolean := false;
begin
  perform 1 from public.enrollments
  where id = target_enrollment for update;
  if not found then raise exception 'ENROLLMENT_NOT_FOUND'; end if;
  select * into previous_summary
  from public.progress_summaries
  where enrollment_id = target_enrollment
  for update;

  for block_row in
    select
      block.id as block_id,
      block.seconds,
      block.event_manifest_hash as block_manifest_hash,
      challenge.event_manifest,
      challenge.event_manifest_hash
    from public.confirmed_watch_blocks block
    join public.presence_challenges challenge
      on challenge.id = block.presence_challenge_id
    where block.enrollment_id = target_enrollment
    order by block.confirmed_at, block.id
  loop
    if block_row.block_manifest_hash
         <> block_row.event_manifest_hash
       or block_row.event_manifest_hash <> encode(
         extensions.digest(block_row.event_manifest::text, 'sha256'),
         'hex'
       )
    then
      evidence_valid := false;
      exit;
    end if;
    manifest_seconds := 0;
    for manifest_entry in
      select value
      from jsonb_array_elements(block_row.event_manifest)
    loop
      begin
        manifest_seconds := manifest_seconds
          + (manifest_entry ->> 'creditedSeconds')::integer;
        if (manifest_entry ->> 'creditedSeconds')::integer <= 0
           or not exists (
             select 1
             from public.playback_events event
             join public.playback_sessions source_session
               on source_session.id = event.playback_session_id
             where event.id =
                 (manifest_entry ->> 'eventId')::uuid
               and event.enrollment_id = target_enrollment
               and event.playback_session_id =
                 (manifest_entry ->> 'playbackSessionId')::uuid
               and event.sequence =
                 (manifest_entry ->> 'sequence')::bigint
               and event.lease_epoch =
                 (manifest_entry ->> 'leaseEpoch')::bigint
               and event.media_position_seconds =
                 (manifest_entry ->> 'mediaPositionSeconds')::numeric
               and event.received_at =
                 (manifest_entry ->> 'receivedAt')::timestamptz
               and event.candidate_seconds =
                 (manifest_entry ->> 'eventCandidateSeconds')::integer
               and event.candidate_seconds >=
                 (manifest_entry ->> 'creditedSeconds')::integer
               and source_session.lesson_video_version_id =
                 (manifest_entry ->> 'videoVersionId')::uuid
           )
        then
          evidence_valid := false;
          exit;
        end if;
      exception when others then
        evidence_valid := false;
        exit;
      end;
    end loop;
    if not evidence_valid or manifest_seconds <> block_row.seconds then
      evidence_valid := false;
      exit;
    end if;
    confirmed_total := confirmed_total + block_row.seconds;
    source_count := source_count
      + jsonb_array_length(block_row.event_manifest);
  end loop;

  -- A heartbeat event can be split between the confirmed block that triggered
  -- a challenge and its carried surplus. Validate credits globally, not only
  -- one manifest at a time, so replaying the same event in later blocks cannot
  -- manufacture additional watched seconds.
  if evidence_valid then
    begin
      with manifest_entries as (
        select
          (entry.value ->> 'eventId')::uuid as event_id,
          (entry.value ->> 'playbackSessionId')::uuid
            as playback_session_id,
          (entry.value ->> 'sequence')::bigint as sequence,
          (entry.value ->> 'leaseEpoch')::bigint as lease_epoch,
          (entry.value ->> 'videoVersionId')::uuid
            as lesson_video_version_id,
          (entry.value ->> 'mediaPositionSeconds')::numeric
            as media_position_seconds,
          (entry.value ->> 'receivedAt')::timestamptz as received_at,
          (entry.value ->> 'eventCandidateSeconds')::integer
            as event_candidate_seconds,
          sum((entry.value ->> 'creditedSeconds')::integer)::integer
            as credited_seconds
        from public.confirmed_watch_blocks block
        join public.presence_challenges challenge
          on challenge.id = block.presence_challenge_id
        cross join lateral jsonb_array_elements(
          challenge.event_manifest
        ) entry(value)
        where block.enrollment_id = target_enrollment
        group by
          (entry.value ->> 'eventId')::uuid,
          (entry.value ->> 'playbackSessionId')::uuid,
          (entry.value ->> 'sequence')::bigint,
          (entry.value ->> 'leaseEpoch')::bigint,
          (entry.value ->> 'videoVersionId')::uuid,
          (entry.value ->> 'mediaPositionSeconds')::numeric,
          (entry.value ->> 'receivedAt')::timestamptz,
          (entry.value ->> 'eventCandidateSeconds')::integer
      )
      select coalesce(bool_and(
        entry.credited_seconds > 0
        and event.id is not null
        and event.enrollment_id = target_enrollment
        and event.playback_session_id = entry.playback_session_id
        and event.sequence = entry.sequence
        and event.lease_epoch = entry.lease_epoch
        and event.media_position_seconds = entry.media_position_seconds
        and event.received_at = entry.received_at
        and event.candidate_seconds = entry.event_candidate_seconds
        and entry.credited_seconds <= event.candidate_seconds
        and source_session.lesson_video_version_id =
          entry.lesson_video_version_id
      ), true)
      into evidence_valid
      from manifest_entries entry
      left join public.playback_events event
        on event.id = entry.event_id
      left join public.playback_sessions source_session
        on source_session.id = event.playback_session_id;
    exception when others then
      evidence_valid := false;
    end;
  end if;

  if not evidence_valid then
    update public.progress_summaries
    set confirmed_valid_seconds = 0,
        candidate_seconds = 0,
        source_event_count = 0,
        source_manifest_hash = null,
        drift_detected_at = coalesce(drift_detected_at, now()),
        recomputed_at = now()
    where enrollment_id = target_enrollment;
    return jsonb_build_object(
      'valid', false,
      'driftDetected', true,
      'reason', 'event_manifest_invalid'
    );
  end if;
  select coalesce(sum(session.candidate_unconfirmed_seconds), 0)::integer
  into candidate_total
  from public.playback_sessions session
  where session.enrollment_id = target_enrollment;
  select encode(extensions.digest(
    coalesce(string_agg(
      block.event_manifest_hash, ':'
      order by block.confirmed_at, block.id
    ), ''),
    'sha256'
  ), 'hex')
  into computed_hash
  from public.confirmed_watch_blocks block
  where block.enrollment_id = target_enrollment;
  drifted := previous_summary.enrollment_id is null
    or previous_summary.confirmed_valid_seconds <> confirmed_total
    or previous_summary.candidate_seconds <> candidate_total
    or previous_summary.source_event_count <> source_count
    or previous_summary.source_manifest_hash is distinct from computed_hash;
  insert into public.progress_summaries (
    enrollment_id, confirmed_valid_seconds, candidate_seconds,
    source_event_count, source_manifest_hash, recomputed_at,
    drift_detected_at, updated_at
  ) values (
    target_enrollment, confirmed_total, candidate_total,
    source_count, computed_hash, now(),
    case when drifted then now() else null end, now()
  )
  on conflict (enrollment_id) do update
  set confirmed_valid_seconds = excluded.confirmed_valid_seconds,
      candidate_seconds = excluded.candidate_seconds,
      source_event_count = excluded.source_event_count,
      source_manifest_hash = excluded.source_manifest_hash,
      recomputed_at = excluded.recomputed_at,
      drift_detected_at = case
        when drifted then coalesce(
          public.progress_summaries.drift_detected_at, now()
        )
        else public.progress_summaries.drift_detected_at
      end,
      updated_at = now();
  return jsonb_build_object(
    'valid', true,
    'driftDetected', drifted,
    'confirmedSeconds', confirmed_total,
    'candidateSeconds', candidate_total,
    'sourceEventCount', source_count,
    'sourceManifestHash', computed_hash
  );
end
$$;
revoke all on function
  internal.recompute_recorded_progress_unchecked(uuid)
  from public;

create or replace function internal.recompute_recorded_progress(
  target_enrollment uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'RECORDED_RECOMPUTE_SERVICE_REQUIRED';
  end if;
  return internal.recompute_recorded_progress_unchecked(
    target_enrollment
  );
end
$$;
revoke all on function internal.recompute_recorded_progress(uuid)
  from public;

create or replace function public.recompute_recorded_progress(
  p_enrollment_id uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.recompute_recorded_progress(p_enrollment_id)
$$;

create or replace function internal.enqueue_completion_evaluation(
  target_enrollment uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  enrollment_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'COMPLETION_ENQUEUE_SERVICE_REQUIRED';
  end if;
  select enrollment.status into enrollment_status
  from public.enrollments enrollment
  where enrollment.id = target_enrollment;
  if not found then
    raise exception 'COMPLETION_ENQUEUE_ENROLLMENT_NOT_FOUND';
  end if;
  -- A stale recompute job can run after another prerequisite already issued
  -- the certificate, or after access was revoked/refunded. Both are expected
  -- terminal races and must not become worker dead letters.
  if enrollment_status <> 'active'
     or exists (
       select 1 from public.certificates certificate
       where certificate.enrollment_id = target_enrollment
     )
  then
    return false;
  end if;
  insert into public.durable_jobs (
    job_type, business_key, payload
  ) values (
    'completion_evaluate',
    'completion-evaluate:' || target_enrollment::text,
    jsonb_build_object('enrollmentId', target_enrollment)
  )
  on conflict (business_key) do update
  set status = 'pending',
      available_at = now(),
      last_error = null,
      attempt_count = 0,
      completed_at = null;
  return true;
end
$$;
revoke all on function internal.enqueue_completion_evaluation(uuid)
  from public;

create or replace function public.enqueue_completion_evaluation(
  p_enrollment_id uuid
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.enqueue_completion_evaluation(p_enrollment_id)
$$;
revoke all on function public.enqueue_completion_evaluation(uuid)
  from public;

create or replace function internal.recorded_requirement_met_at(
  target_enrollment uuid,
  required_seconds integer
)
returns timestamptz
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select min(progress.confirmed_at)
  from (
    select
      block.confirmed_at,
      sum(block.seconds) over (
        order by block.confirmed_at, block.id
        rows between unbounded preceding and current row
      ) as cumulative_seconds
    from public.confirmed_watch_blocks block
    where block.enrollment_id = target_enrollment
  ) progress
  where progress.cumulative_seconds >= greatest(required_seconds, 0)
$$;
revoke all on function
  internal.recorded_requirement_met_at(uuid, integer)
  from public;

create or replace function internal.start_quiz_attempt(
  target_enrollment uuid,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  bank_id uuid;
  bank_count integer;
  attempt_id uuid;
  attempt_number integer;
  attempt_expiry timestamptz;
  question record;
  display_order integer := 0;
  response_questions jsonb;
begin
  if not exists (
    select 1
    from public.enrollments enrollment
    join public.entitlements entitlement on entitlement.id = enrollment.entitlement_id
    where enrollment.id = target_enrollment
      and enrollment.person_id = actor
      and enrollment.status = 'active'
      and entitlement.status = 'active'
  ) then
    raise exception 'QUIZ_NOT_AUTHORIZED';
  end if;
  if exists (
    select 1 from public.quiz_attempts
    where enrollment_id = target_enrollment and status = 'passed'
  ) then
    raise exception 'QUIZ_ALREADY_PASSED';
  end if;

  select bank.id, count(question.id)
    into bank_id, bank_count
  from public.enrollments enrollment
  join public.question_banks bank
    on bank.course_version_id = enrollment.course_version_id
  left join public.question_versions question
    on question.question_bank_id = bank.id and question.active
  where enrollment.id = target_enrollment
  group by bank.id;
  if bank_count < 20 then
    raise exception 'QUESTION_BANK_TOO_SMALL';
  end if;

  select id, expires_at into attempt_id, attempt_expiry
  from public.quiz_attempts
  where enrollment_id = target_enrollment and idempotency_key = idempotency;
  if found then
    select coalesce(jsonb_agg(item.question_snapshot order by item.display_order), '[]'::jsonb)
      into response_questions
    from public.quiz_attempt_items item
    where item.quiz_attempt_id = attempt_id;
    return jsonb_build_object(
      'attemptId', attempt_id,
      'expiresAt', attempt_expiry,
      'questions', response_questions
    );
  end if;

  select coalesce(max(existing.attempt_number), 0) + 1
    into attempt_number
  from public.quiz_attempts existing
  where existing.enrollment_id = target_enrollment;
  attempt_expiry := statement_timestamp() + interval '30 minutes';
  insert into public.quiz_attempts (
    enrollment_id, question_bank_id, attempt_number, status,
    started_at, expires_at, idempotency_key
  ) values (
    target_enrollment, bank_id, attempt_number, 'active',
    statement_timestamp(), attempt_expiry, idempotency
  ) returning id into attempt_id;

  for question in
    select q.id, q.prompt, q.topic
    from public.question_versions q
    where q.question_bank_id = bank_id and q.active
    order by random()
    limit 10
  loop
    display_order := display_order + 1;
    insert into public.quiz_attempt_items (
      quiz_attempt_id, question_version_id, display_order,
      option_order_snapshot, question_snapshot
    )
    select
      attempt_id,
      question.id,
      display_order,
      jsonb_agg(option_data.id order by option_data.random_order),
      jsonb_build_object(
        'itemId', gen_random_uuid(),
        'prompt', question.prompt,
        'topic', question.topic,
        'options', jsonb_agg(
          jsonb_build_object(
            'id', option_data.id,
            'text', option_data.option_text
          ) order by option_data.random_order
        )
      )
    from (
      select option.id, option.option_text, random() as random_order
      from public.question_option_versions option
      where option.question_version_id = question.id
    ) option_data;
  end loop;

  -- Return the stored item ids while keeping answer keys in private schema.
  select jsonb_agg(
    item.question_snapshot
      || jsonb_build_object('itemId', item.id)
    order by item.display_order
  ) into response_questions
  from public.quiz_attempt_items item
  where item.quiz_attempt_id = attempt_id;
  return jsonb_build_object(
    'attemptId', attempt_id,
    'expiresAt', attempt_expiry,
    'questions', response_questions
  );
end
$$;
revoke all on function internal.start_quiz_attempt(uuid, uuid) from public;

create or replace function public.start_quiz_attempt(
  p_enrollment_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.start_quiz_attempt(p_enrollment_id, p_idempotency_key)
$$;

create or replace function internal.submit_quiz_attempt(
  target_attempt uuid,
  submitted_responses jsonb,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  attempt_row public.quiz_attempts%rowtype;
  response record;
  correct_count integer;
  final_score integer;
  final_passed boolean;
  weak_topics jsonb;
begin
  select attempt.* into attempt_row
  from public.quiz_attempts attempt
  join public.enrollments enrollment on enrollment.id = attempt.enrollment_id
  where attempt.id = target_attempt and enrollment.person_id = actor
  for update of attempt;
  if not found then raise exception 'QUIZ_NOT_AUTHORIZED'; end if;
  if attempt_row.status in ('passed', 'failed', 'submitted') then
    return jsonb_build_object(
      'score', attempt_row.score,
      'passed', attempt_row.passed,
      'topics', '[]'::jsonb
    );
  end if;
  if attempt_row.status <> 'active' or clock_timestamp() > attempt_row.expires_at then
    update public.quiz_attempts set status = 'expired'
      where id = attempt_row.id;
    raise exception 'QUIZ_TIMEOUT';
  end if;
  if jsonb_object_length(submitted_responses) <> 10 then
    raise exception 'TEN_RESPONSES_REQUIRED';
  end if;

  for response in
    select key::uuid as item_id, value #>> '{}' as option_id
    from jsonb_each(submitted_responses)
  loop
    insert into public.quiz_responses (
      quiz_attempt_item_id, selected_option_id
    )
    select item.id, response.option_id::uuid
    from public.quiz_attempt_items item
    join public.question_option_versions option
      on option.id = response.option_id::uuid
      and option.question_version_id = item.question_version_id
    where item.id = response.item_id
      and item.quiz_attempt_id = attempt_row.id;
    if not found then raise exception 'QUIZ_RESPONSE_REJECTED'; end if;
  end loop;

  select count(*) filter (
    where answer.correct_option_id = response.selected_option_id
  ) into correct_count
  from public.quiz_attempt_items item
  join public.quiz_responses response
    on response.quiz_attempt_item_id = item.id
  join private.question_answer_keys answer
    on answer.question_version_id = item.question_version_id
  where item.quiz_attempt_id = attempt_row.id;

  final_score := correct_count * 10;
  final_passed := final_score >= 80;
  update public.quiz_attempts
    set status = case when final_passed then 'passed' else 'failed' end,
        submitted_at = clock_timestamp(),
        score = final_score,
        passed = final_passed
    where id = attempt_row.id;

  select coalesce(jsonb_agg(distinct question.topic), '[]'::jsonb)
    into weak_topics
  from public.quiz_attempt_items item
  join public.quiz_responses response
    on response.quiz_attempt_item_id = item.id
  join public.question_versions question
    on question.id = item.question_version_id
  join private.question_answer_keys answer
    on answer.question_version_id = question.id
  where item.quiz_attempt_id = attempt_row.id
    and answer.correct_option_id <> response.selected_option_id;

  perform internal.append_audit_event(
    actor, 'quiz.submitted', 'quiz_attempt', attempt_row.id::text,
    'server-side grading', null,
    jsonb_build_object('score', final_score, 'passed', final_passed)
  );
  if final_passed then
    insert into public.durable_jobs (job_type, business_key, payload)
    values (
      'completion_evaluate',
      'completion-evaluate:' || attempt_row.enrollment_id::text,
      jsonb_build_object('enrollmentId', attempt_row.enrollment_id)
    )
    on conflict (business_key) do update
    set status = 'pending', available_at = now(), last_error = null,
        attempt_count = 0, completed_at = null;
  end if;
  return jsonb_build_object(
    'score', final_score,
    'passed', final_passed,
    'topics', weak_topics
  );
end
$$;
revoke all on function internal.submit_quiz_attempt(uuid, jsonb, uuid)
  from public;

create or replace function public.submit_quiz_attempt(
  p_attempt_id uuid,
  p_responses jsonb,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.submit_quiz_attempt(
    p_attempt_id, p_responses, p_idempotency_key
  )
$$;

create or replace function internal.submit_survey(
  target_enrollment uuid,
  submitted_ratings integer[],
  submitted_comment text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  form_id uuid;
  response_id uuid;
  edit_deadline timestamptz;
  next_revision integer;
begin
  if cardinality(submitted_ratings) <> 5
     or exists (
       select 1 from unnest(submitted_ratings) rating
       where rating not between 1 and 5
     )
  then
    raise exception 'INVALID_SURVEY_RATINGS';
  end if;
  select form.id into form_id
  from public.enrollments enrollment
  join public.survey_forms form
    on form.course_version_id = enrollment.course_version_id
  where enrollment.id = target_enrollment
    and enrollment.person_id = actor;
  if not found then raise exception 'SURVEY_NOT_AUTHORIZED'; end if;

  select response.id, response.editable_until
    into response_id, edit_deadline
  from public.survey_responses response
  where response.enrollment_id = target_enrollment
  for update;
  if not found then
    edit_deadline := statement_timestamp() + interval '24 hours';
    insert into public.survey_responses (
      enrollment_id, survey_form_id, submitted_at,
      editable_until, idempotency_key
    ) values (
      target_enrollment, form_id, statement_timestamp(),
      edit_deadline, idempotency
    ) returning id into response_id;
    next_revision := 1;
  else
    if clock_timestamp() > edit_deadline then
      raise exception 'SURVEY_EDIT_WINDOW_CLOSED';
    end if;
    select coalesce(max(revision), 0) + 1 into next_revision
    from public.survey_response_revisions
    where survey_response_id = response_id;
    if next_revision > 2 then
      raise exception 'SURVEY_ALREADY_EDITED';
    end if;
  end if;
  insert into public.survey_response_revisions (
    survey_response_id, revision, ratings, optional_comment
  ) values (
    response_id, next_revision, submitted_ratings::smallint[], submitted_comment
  );
  if next_revision = 2 then
    update public.survey_responses set locked_at = now()
      where id = response_id;
  end if;
  insert into public.durable_jobs (job_type, business_key, payload)
  values (
    'completion_evaluate',
    'completion-evaluate:' || target_enrollment::text,
    jsonb_build_object('enrollmentId', target_enrollment)
  )
  on conflict (business_key) do update
  set status = 'pending', available_at = now(), last_error = null,
      attempt_count = 0, completed_at = null;
  return jsonb_build_object(
    'responseId', response_id,
    'editableUntil', edit_deadline
  );
end
$$;
revoke all on function internal.submit_survey(
  uuid, integer[], text, uuid
) from public;

create or replace function public.submit_survey(
  p_enrollment_id uuid,
  p_ratings integer[],
  p_comment text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.submit_survey(
    p_enrollment_id, p_ratings, p_comment, p_idempotency_key
  )
$$;

alter table public.live_join_leases
  add column provider_status text not null default 'pending'
    check (provider_status in ('pending', 'registered', 'revoked', 'failed')),
  add column credential_expired_at timestamptz,
  add column credential_expiry_idempotency_key uuid;

create or replace function internal.required_live_assistants(learners integer)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when learners between 0 and 50 then 0
    when learners between 51 and 100 then 1
    when learners between 101 and 150 then 2
    when learners between 151 and 200 then 3
    else null
  end
$$;

create or replace function internal.issue_live_join_lease(
  target_session uuid,
  submitted_device_hash text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  booking_row public.live_bookings%rowtype;
  session_row public.live_sessions%rowtype;
  existing_lease public.live_join_leases%rowtype;
  meeting_row private.zoom_meetings%rowtype;
  lease_id uuid;
  next_epoch bigint;
  learner_count integer;
  assistant_count integer;
  synthetic_email text;
  provider_customer_key text;
  display_name text;
begin
  if submitted_device_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'DEVICE_HASH_REJECTED';
  end if;
  if not internal.feature_is_open('zoom_join') then
    raise exception 'ZOOM_JOIN_CLOSED';
  end if;
  if not exists (
    select 1 from public.provider_health health
    where health.provider in ('zoom_oauth', 'zoom_meeting_sdk')
      and health.status = 'healthy'
      and health.production_validated_at is not null
    having count(*) = 2
  ) then
    raise exception 'ZOOM_PROVIDER_UNHEALTHY';
  end if;

  select booking.* into booking_row
  from public.live_bookings booking
  where booking.live_session_id = target_session
    and booking.person_id = actor
    and booking.status = 'confirmed'
    and not exists (
      select 1
      from public.refund_cases refund_case
      join public.refund_allocations allocation
        on allocation.refund_case_id = refund_case.id
      where booking.payer_type = 'b2c'
        and refund_case.order_id = booking.payer_source_id
        and refund_case.status not in ('rejected', 'failed')
        and (
          allocation.scope_type = 'whole_order'
          or (
            allocation.scope_type = 'live_component'
            and allocation.scope_id =
              coalesce(booking.live_component_id, booking.course_version_id)
          )
        )
    )
  for update;
  if not found then raise exception 'LIVE_BOOKING_REQUIRED'; end if;
  if length(booking_row.customer_key) > 36
     or booking_row.customer_key !~ '^[A-Za-z0-9_-]+$'
  then
    raise exception 'ZOOM_CUSTOMER_KEY_INVALID';
  end if;
  if not exists (
    select 1
    from private.accreditation_identity_profiles profile
    join public.enrollments enrollment
      on enrollment.person_id = profile.person_id
    where enrollment.id = booking_row.enrollment_id
      and enrollment.person_id = actor
      and enrollment.identity_profile_confirmed_at is not null
      and enrollment.identity_profile_revision_confirmed =
        profile.profile_revision
      and profile.person_id = actor
      and profile.status in ('submitted', 'verified', 'needs_correction')
  ) then
    raise exception 'ACCREDITATION_IDENTITY_PROFILE_REQUIRED';
  end if;

  select * into session_row from public.live_sessions
  where id = target_session for update;
  if session_row.status not in ('open', 'in_progress')
     or now() < session_row.starts_at - interval '30 minutes'
     or now() > session_row.ends_at + interval '30 minutes'
  then
    raise exception 'LIVE_JOIN_WINDOW_CLOSED';
  end if;
  select * into meeting_row
  from private.zoom_meetings
  where live_session_id = target_session;
  if not found then raise exception 'ZOOM_MEETING_NOT_CONFIGURED'; end if;
  select coalesce(person.display_name, '歲悅學員') into display_name
  from public.people person
  where person.id = actor;

  -- A network retry with the same key returns the exact same provider saga.
  -- It never registers a second participant or rotates credentials.
  select * into existing_lease
  from public.live_join_leases lease
  where lease.live_booking_id = booking_row.id
    and lease.person_id = actor
    and lease.issuance_idempotency_key = idempotency
  for update;
  if found then
    if existing_lease.device_hash <> submitted_device_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if not existing_lease.active
       or existing_lease.credential_expires_at <= now()
    then
      raise exception 'JOIN_LEASE_EXPIRED_OR_ABORTED';
    end if;
    return jsonb_build_object(
      'leaseId', existing_lease.id,
      'meetingNumber', meeting_row.meeting_number,
      'encryptedPasscode', meeting_row.encrypted_passcode,
      'syntheticEmail', existing_lease.synthetic_email,
      'displayName', display_name,
      'customerKey', existing_lease.provider_customer_key,
      'expiresAt', existing_lease.credential_expires_at,
      'providerStatus', existing_lease.provider_status,
      'lastHeartbeatSequence', existing_lease.last_heartbeat_sequence,
      'replayed', true
    );
  end if;

  select count(*) into learner_count
  from public.live_bookings
  where live_session_id = target_session
    and status in ('confirmed', 'attended');
  select count(*) into assistant_count
  from public.live_session_assistants
  where live_session_id = target_session
    and role = 'assistant'
    and confirmed_present_at is not null;
  if assistant_count < internal.required_live_assistants(learner_count) then
    raise exception 'LIVE_ASSISTANTS_INSUFFICIENT';
  end if;
  if learner_count + session_row.host_seats + session_row.cohost_seats
       + assistant_count + session_row.reserved_support_seats
     > session_row.verified_zoom_total_capacity
  then
    raise exception 'ZOOM_TOTAL_CAPACITY_EXCEEDED';
  end if;

  select * into existing_lease
  from public.live_join_leases
  where live_booking_id = booking_row.id
    and active
  for update;
  if found then
    -- A replacement is safe only after the prior registrant is revoked and:
    -- (a) a bound participant has authoritative left/removed evidence, or
    -- (b) no participant ever joined and the credential has expired.
    if existing_lease.provider_status = 'pending'
       or existing_lease.created_at > now() - interval '30 seconds'
       or existing_lease.old_registrant_revoked_at is null
       or (
         existing_lease.zoom_participant_uuid is not null
         and existing_lease.old_participant_removed_at is null
       )
       or (
         existing_lease.zoom_participant_uuid is null
         and existing_lease.credential_expires_at > now()
       )
    then
      raise exception 'OLD_ZOOM_CREDENTIAL_NOT_REVOKED';
    end if;
  end if;
  select * into existing_lease
  from public.live_join_leases lease
  where lease.live_booking_id = booking_row.id
    and not lease.active
    and lease.provider_status in ('registered', 'revoked', 'failed')
    and (
      lease.old_registrant_revoked_at is null
      or (
        lease.zoom_participant_uuid is not null
        and lease.old_participant_removed_at is null
      )
      or (
        lease.zoom_participant_uuid is null
        and lease.credential_expires_at > now()
      )
    )
  order by lease.lease_epoch desc
  limit 1
  for update;
  if found then
    raise exception 'OLD_ZOOM_CREDENTIAL_NOT_REVOKED';
  end if;

  select coalesce(max(lease_epoch), 0) + 1 into next_epoch
  from public.live_join_leases where live_booking_id = booking_row.id;
  update public.live_join_leases
    set active = false
    where live_booking_id = booking_row.id and active;
  synthetic_email := encode(gen_random_bytes(16), 'hex')
    || '@zoom-id.suiyuecare.com';
  provider_customer_key := encode(gen_random_bytes(16), 'hex');
  insert into public.live_join_leases (
    live_booking_id, person_id, lease_epoch, issuance_idempotency_key,
    device_hash, provider_customer_key,
    synthetic_email, credential_expires_at, active, provider_status
  ) values (
    booking_row.id, actor, next_epoch, idempotency, submitted_device_hash,
    provider_customer_key, synthetic_email,
    now() + interval '30 minutes', true, 'pending'
  ) returning id into lease_id;

  insert into public.durable_jobs (
    job_type, business_key, payload, available_at
  ) values (
    'live_join_lease_expiry',
    'live-join-lease-expiry:' || lease_id::text,
    jsonb_build_object(
      'leaseId', lease_id,
      'personId', actor,
      'liveSessionId', target_session
    ),
    now() + interval '30 minutes'
  );
  return jsonb_build_object(
    'leaseId', lease_id,
    'meetingNumber', meeting_row.meeting_number,
    'encryptedPasscode', meeting_row.encrypted_passcode,
    'syntheticEmail', synthetic_email,
    'displayName', display_name,
    'customerKey', provider_customer_key,
    'expiresAt', now() + interval '30 minutes',
    'providerStatus', 'pending',
    'lastHeartbeatSequence', 0,
    'replayed', false
  );
end
$$;
revoke all on function internal.issue_live_join_lease(uuid, text, uuid)
  from public;

create or replace function public.issue_live_join_lease(
  p_live_session_id uuid,
  p_device_hash text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.issue_live_join_lease(
    p_live_session_id, p_device_hash, p_idempotency_key
  )
$$;

create or replace function internal.read_live_calendar_event(
  target_session uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  result jsonb;
begin
  select jsonb_build_object(
    'liveSessionId', session.id,
    'title', session.title,
    'startsAt', session.starts_at,
    'endsAt', session.ends_at,
    'status', session.status,
    'sequence', session.calendar_sequence
  ) into result
  from public.live_sessions session
  join public.live_bookings booking
    on booking.live_session_id = session.id
  join public.enrollments enrollment on enrollment.id = booking.enrollment_id
  join public.entitlements entitlement
    on entitlement.id = enrollment.entitlement_id
  where session.id = target_session
    and booking.person_id = actor
    and booking.status in ('confirmed', 'attended', 'cancelled')
    and entitlement.status in ('active', 'frozen');
  if result is null then raise exception 'CALENDAR_EVENT_NOT_AUTHORIZED'; end if;
  return result;
end
$$;
revoke all on function internal.read_live_calendar_event(uuid) from public;

create or replace function public.read_live_calendar_event(
  p_live_session_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_live_calendar_event(p_live_session_id)
$$;

create or replace function internal.finalize_live_join_lease(
  target_lease uuid,
  provider_registrant_id text,
  encrypted_registrant_token jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() <> 'service_role'
     or provider_registrant_id = ''
     or jsonb_typeof(encrypted_registrant_token) <> 'object'
  then
    raise exception 'JOIN_LEASE_FINALIZE_REJECTED';
  end if;
  if exists (
    select 1
    from public.live_join_leases lease
    where lease.id = target_lease
      and lease.active
      and lease.provider_status = 'registered'
      and lease.zoom_registrant_id = provider_registrant_id
      and lease.registrant_token_ciphertext = encrypted_registrant_token
      and lease.credential_expires_at > now()
  ) then
    return true;
  end if;
  update public.live_join_leases
    set zoom_registrant_id = provider_registrant_id,
        registrant_token_ciphertext = encrypted_registrant_token,
        provider_status = 'registered'
    where id = target_lease
      and active
      and provider_status = 'pending'
      and credential_expires_at > now();
  if not found then raise exception 'JOIN_LEASE_FINALIZE_REJECTED'; end if;
  return true;
end
$$;
revoke all on function internal.finalize_live_join_lease(uuid, text, jsonb)
  from public;

create or replace function public.finalize_live_join_lease(
  p_lease_id uuid,
  p_provider_registrant_id text,
  p_registrant_token_ciphertext jsonb
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.finalize_live_join_lease(
    p_lease_id, p_provider_registrant_id,
    p_registrant_token_ciphertext
  )
$$;

create or replace function internal.read_live_join_abort_context(
  target_lease uuid,
  target_auth_user uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, private
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'LIVE_JOIN_SERVICE_REQUIRED';
  end if;
  select jsonb_build_object(
    'leaseId', lease.id,
    'liveSessionId', booking.live_session_id,
    'meetingNumber', meeting.meeting_number,
    'registrantId', lease.zoom_registrant_id,
    'providerStatus', lease.provider_status,
    'active', lease.active,
    'credentialExpiresAt', lease.credential_expires_at
  ) into result
  from public.live_join_leases lease
  join public.live_bookings booking
    on booking.id = lease.live_booking_id
  join private.zoom_meetings meeting
    on meeting.live_session_id = booking.live_session_id
  join public.people person on person.id = lease.person_id
  join public.auth_identities identity
    on identity.person_id = person.id
  where lease.id = target_lease
    and identity.auth_user_id = target_auth_user
    and identity.active
    and not identity.restricted
    and identity.disabled_at is null
    and identity.identity_epoch = person.identity_epoch;
  if result is null then
    raise exception 'LIVE_JOIN_CONTEXT_NOT_AUTHORIZED';
  end if;
  return result;
end
$$;
revoke all on function internal.read_live_join_abort_context(uuid, uuid)
  from public;

create or replace function public.read_live_join_abort_context(
  p_lease_id uuid,
  p_auth_user_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, private, internal
as $$
  select internal.read_live_join_abort_context(
    p_lease_id, p_auth_user_id
  )
$$;

create or replace function internal.read_live_join_expiry_context(
  target_lease uuid,
  target_person uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, private
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'LIVE_JOIN_SERVICE_REQUIRED';
  end if;
  select jsonb_build_object(
    'leaseId', lease.id,
    'liveSessionId', booking.live_session_id,
    'meetingNumber', meeting.meeting_number,
    'registrantId', lease.zoom_registrant_id,
    'providerStatus', lease.provider_status,
    'active', lease.active,
    'credentialExpiresAt', lease.credential_expires_at
  ) into result
  from public.live_join_leases lease
  join public.live_bookings booking
    on booking.id = lease.live_booking_id
  join private.zoom_meetings meeting
    on meeting.live_session_id = booking.live_session_id
  where lease.id = target_lease
    and lease.person_id = target_person;
  if result is null then
    raise exception 'LIVE_JOIN_EXPIRY_CONTEXT_NOT_FOUND';
  end if;
  return result;
end
$$;
revoke all on function internal.read_live_join_expiry_context(uuid, uuid)
  from public;

create or replace function public.read_live_join_expiry_context(
  p_lease_id uuid,
  p_person_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, private, internal
as $$
  select internal.read_live_join_expiry_context(
    p_lease_id, p_person_id
  )
$$;

create or replace function internal.abort_live_join_lease(
  target_lease uuid,
  registrant_was_revoked boolean,
  participant_was_removed boolean,
  submitted_reason text,
  idempotency uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  lease_row public.live_join_leases%rowtype;
begin
  if auth.role() <> 'service_role'
     or length(trim(submitted_reason)) < 3
  then
    raise exception 'LIVE_JOIN_ABORT_REJECTED';
  end if;
  select * into lease_row
  from public.live_join_leases lease
  where lease.id = target_lease
  for update;
  if not found then raise exception 'LIVE_JOIN_LEASE_NOT_FOUND'; end if;
  if lease_row.abort_idempotency_key = idempotency then
    return true;
  end if;
  if lease_row.abort_idempotency_key is not null then
    raise exception 'LIVE_JOIN_ABORT_ALREADY_RECORDED';
  end if;
  if lease_row.provider_status = 'registered'
     and not registrant_was_revoked
  then
    raise exception 'ZOOM_REGISTRANT_REVOCATION_REQUIRED';
  end if;
  update public.live_join_leases
  set active = false,
      provider_status = case
        when provider_status = 'registered' then 'revoked'
        else 'failed'
      end,
      old_registrant_revoked_at = case
        when registrant_was_revoked then clock_timestamp()
        else old_registrant_revoked_at
      end,
      abort_idempotency_key = idempotency,
      abort_reason = trim(submitted_reason)
  where id = target_lease;
  update public.durable_jobs
  set status = 'completed',
      completed_at = clock_timestamp(),
      lease_owner = null,
      lease_expires_at = null
  where business_key = 'live-join-lease-expiry:' || target_lease::text
    and status in ('pending', 'retry', 'leased');
  perform internal.append_audit_event(
    null, 'live.join_lease_aborted', 'live_join_lease',
    target_lease::text, trim(submitted_reason), null,
    jsonb_build_object(
      'registrantRevoked', registrant_was_revoked,
      'participantRemoved', participant_was_removed
    )
  );
  return true;
end
$$;
revoke all on function internal.abort_live_join_lease(
  uuid, boolean, boolean, text, uuid
) from public;

create or replace function public.abort_live_join_lease(
  p_lease_id uuid,
  p_registrant_revoked boolean,
  p_participant_removed boolean,
  p_reason text,
  p_idempotency_key uuid
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.abort_live_join_lease(
    p_lease_id, p_registrant_revoked, p_participant_removed,
    p_reason, p_idempotency_key
  )
$$;

create or replace function internal.expire_live_join_credential(
  target_lease uuid,
  registrant_was_revoked boolean,
  submitted_reason text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  lease_row public.live_join_leases%rowtype;
  session_row public.live_sessions%rowtype;
  attendance_active boolean;
  first_expiry_processing boolean;
begin
  if auth.role() <> 'service_role'
     or length(trim(submitted_reason)) < 3
  then
    raise exception 'LIVE_CREDENTIAL_EXPIRY_REJECTED';
  end if;
  select lease.* into lease_row
  from public.live_join_leases lease
  where lease.id = target_lease
  for update;
  if not found then raise exception 'LIVE_JOIN_LEASE_NOT_FOUND'; end if;
  select session.* into session_row
  from public.live_bookings booking
  join public.live_sessions session
    on session.id = booking.live_session_id
  where booking.id = lease_row.live_booking_id
  for update of session;
  if not found or clock_timestamp() < lease_row.credential_expires_at then
    raise exception 'LIVE_CREDENTIAL_NOT_EXPIRED';
  end if;
  if lease_row.provider_status = 'registered'
     and not registrant_was_revoked
  then
    raise exception 'ZOOM_REGISTRANT_REVOCATION_REQUIRED';
  end if;

  first_expiry_processing :=
    lease_row.credential_expiry_idempotency_key is null;
  update public.live_join_leases
  set provider_status = case
        when provider_status in ('registered', 'revoked') then 'revoked'
        else 'failed'
      end,
      old_registrant_revoked_at = case
        when registrant_was_revoked or provider_status = 'revoked'
          then coalesce(old_registrant_revoked_at, clock_timestamp())
        else old_registrant_revoked_at
      end,
      credential_expired_at = coalesce(
        credential_expired_at, clock_timestamp()
      ),
      credential_expiry_idempotency_key = coalesce(
        credential_expiry_idempotency_key, idempotency
      )
  where id = target_lease
  returning * into lease_row;

  -- Credential expiry prevents a new join, but Zoom does not evict a person
  -- who is already in the meeting. Keep attendance heartbeats alive until an
  -- authoritative left/meeting-ended event or the checkout window closes.
  attendance_active :=
    lease_row.zoom_participant_uuid is not null
    and lease_row.old_participant_removed_at is null
    and clock_timestamp() <= session_row.ends_at + interval '30 minutes';
  update public.live_join_leases
  set active = attendance_active
  where id = target_lease;

  if attendance_active then
    insert into public.durable_jobs (
      job_type, business_key, payload, available_at
    ) values (
      'live_join_lease_expiry',
      'live-join-attendance-close:' || target_lease::text,
      jsonb_build_object(
        'leaseId', target_lease,
        'personId', lease_row.person_id,
        'liveSessionId', session_row.id
      ),
      session_row.ends_at + interval '30 minutes'
    )
    on conflict (business_key) do nothing;
  end if;

  update public.durable_jobs
  set status = 'completed',
      completed_at = coalesce(completed_at, clock_timestamp()),
      lease_owner = null,
      lease_expires_at = null
  where business_key in (
      'live-join-lease-expiry:' || target_lease::text,
      case when not attendance_active
        then 'live-join-attendance-close:' || target_lease::text
        else '' end
    )
    and status in ('pending', 'retry', 'leased');

  if first_expiry_processing or not attendance_active then
    perform internal.append_audit_event(
      null,
      case when attendance_active
        then 'live.join_credential_expired'
        else 'live.join_attendance_lease_closed'
      end,
      'live_join_lease', target_lease::text,
      trim(submitted_reason), null,
      jsonb_build_object(
        'registrantRevoked', registrant_was_revoked,
        'attendanceActive', attendance_active,
        'participantBound',
          lease_row.zoom_participant_uuid is not null,
        'sessionEndsAt', session_row.ends_at
      )
    );
  end if;
  return jsonb_build_object(
    'accepted', true,
    'attendanceActive', attendance_active,
    'providerStatus', lease_row.provider_status,
    'credentialExpiredAt', lease_row.credential_expired_at
  );
end
$$;
revoke all on function internal.expire_live_join_credential(
  uuid, boolean, text, uuid
) from public;

create or replace function public.expire_live_join_credential(
  p_lease_id uuid,
  p_registrant_revoked boolean,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.expire_live_join_credential(
    p_lease_id, p_registrant_revoked, p_reason, p_idempotency_key
  )
$$;

create or replace function internal.record_live_heartbeat(
  target_lease uuid,
  heartbeat_sequence bigint,
  camera_is_on boolean,
  device_checked boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  lease_row public.live_join_leases%rowtype;
  session_id uuid;
begin
  select lease.* into lease_row
  from public.live_join_leases lease
  where lease.id = target_lease
    and lease.person_id = actor
    and lease.active
    and lease.provider_status in ('registered', 'revoked')
  for update;
  if not found
     or heartbeat_sequence <> lease_row.last_heartbeat_sequence + 1
  then
    raise exception 'LIVE_LEASE_SEQUENCE_REJECTED';
  end if;
  if lease_row.last_heartbeat_at is not null
     and clock_timestamp() - lease_row.last_heartbeat_at
       < interval '8 seconds'
  then
    raise exception 'LIVE_HEARTBEAT_TOO_FAST';
  end if;
  select booking.live_session_id into session_id
  from public.live_bookings booking
  join public.live_sessions session
    on session.id = booking.live_session_id
  where booking.id = lease_row.live_booking_id;
  if not found or clock_timestamp() >
       (select ends_at + interval '30 minutes'
        from public.live_sessions where id = session_id)
  then
    raise exception 'LIVE_HEARTBEAT_WINDOW_CLOSED';
  end if;
  insert into public.live_client_heartbeats (
    live_session_id, join_lease_id, sequence,
    camera_on, device_test_passed
  ) values (
    session_id, lease_row.id, heartbeat_sequence,
    camera_is_on, device_checked
  );
  update public.live_join_leases
  set last_heartbeat_sequence = heartbeat_sequence,
      last_heartbeat_at = clock_timestamp()
  where id = lease_row.id
    and last_heartbeat_sequence = lease_row.last_heartbeat_sequence;
  if not found then raise exception 'LIVE_LEASE_SEQUENCE_REJECTED'; end if;
  return jsonb_build_object(
    'accepted', true,
    'sequence', heartbeat_sequence,
    'serverReceivedAt', clock_timestamp()
  );
end
$$;
revoke all on function internal.record_live_heartbeat(
  uuid, bigint, boolean, boolean
) from public;

create or replace function public.record_live_heartbeat(
  p_join_lease_id uuid,
  p_sequence bigint,
  p_camera_on boolean,
  p_checked_device boolean
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.record_live_heartbeat(
    p_join_lease_id, p_sequence, p_camera_on, p_checked_device
  )
$$;

create or replace function internal.record_live_check_event(
  target_session uuid,
  event_kind text,
  device_checked boolean,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  booking_row public.live_bookings%rowtype;
  session_row public.live_sessions%rowtype;
  existing_event public.check_events%rowtype;
  created_event_id uuid;
begin
  select booking.* into booking_row
  from public.live_bookings booking
  where booking.live_session_id = target_session
    and booking.person_id = actor
    and booking.status = 'confirmed'
  for update;
  if not found then raise exception 'LIVE_BOOKING_REQUIRED'; end if;
  if event_kind not in ('check_in', 'check_out') then
    raise exception 'LIVE_CHECK_EVENT_REJECTED';
  end if;

  -- The booking lock serializes reloads and concurrent tabs. Reusing an
  -- idempotency key for another event is a payload mismatch; using a fresh key
  -- for an already-recorded check-in/out is a safe replay.
  select event.* into existing_event
  from public.check_events event
  where event.live_booking_id = booking_row.id
    and event.idempotency_key = idempotency;
  if found then
    if existing_event.event_type <> event_kind
       or existing_event.device_test_passed <> device_checked
    then
      raise exception 'LIVE_CHECK_IDEMPOTENCY_MISMATCH';
    end if;
    return jsonb_build_object(
      'accepted', true,
      'event', existing_event.event_type,
      'eventId', existing_event.id,
      'replayed', true,
      'deviceTestPassed', existing_event.device_test_passed
    );
  end if;

  select event.* into existing_event
  from public.check_events event
  where event.live_booking_id = booking_row.id
    and event.event_type = event_kind;
  if found then
    return jsonb_build_object(
      'accepted', true,
      'event', existing_event.event_type,
      'eventId', existing_event.id,
      'replayed', true,
      'deviceTestPassed', existing_event.device_test_passed
    );
  end if;

  select * into session_row from public.live_sessions
    where id = target_session;
  if event_kind = 'check_in'
     and (now() < session_row.starts_at - interval '30 minutes'
          or now() > session_row.starts_at + interval '15 minutes')
  then
    raise exception 'CHECK_IN_WINDOW_CLOSED';
  end if;
  if event_kind = 'check_out'
     and (now() < session_row.ends_at - interval '15 minutes'
          or now() > session_row.ends_at + interval '30 minutes')
  then
    raise exception 'CHECK_OUT_WINDOW_CLOSED';
  end if;
  insert into public.check_events (
    live_booking_id, event_type, device_test_passed, idempotency_key
  ) values (
    booking_row.id, event_kind, device_checked, idempotency
  ) returning id into created_event_id;
  if event_kind = 'check_in' then
    perform internal.consume_organization_assignment_for_enrollment(
      booking_row.enrollment_id,
      'formal_live_check_in'
    );
  end if;
  return jsonb_build_object(
    'accepted', true,
    'event', event_kind,
    'eventId', created_event_id,
    'replayed', false,
    'deviceTestPassed', device_checked
  );
end
$$;
revoke all on function internal.record_live_check_event(
  uuid, text, boolean, uuid
) from public;

create or replace function public.record_live_check_event(
  p_live_session_id uuid,
  p_event_type text,
  p_device_test_passed boolean,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.record_live_check_event(
    p_live_session_id, p_event_type,
    p_device_test_passed, p_idempotency_key
  )
$$;

create or replace function internal.enrollment_live_requirements_met(
  target_enrollment uuid
)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select coalesce((
    select case version.delivery_type
      when 'recorded' then true
      when 'live' then exists (
        select 1
        from public.live_bookings booking
        join public.live_sessions session
          on session.id = booking.live_session_id
        join public.attendance_summaries attendance
          on attendance.live_booking_id = booking.id
        where booking.enrollment_id = enrollment.id
          and session.status = 'ended'
          and attendance.qualified
          and attendance.quarantined_at is null
      )
      else not exists (
        select 1
        from public.hybrid_components component
        where component.course_version_id = version.id
          and component.required
          and component.component_type = 'live'
          and not exists (
            select 1
            from public.live_bookings booking
            join public.live_sessions session
              on session.id = booking.live_session_id
            join public.attendance_summaries attendance
              on attendance.live_booking_id = booking.id
            where booking.enrollment_id = enrollment.id
              and booking.live_component_id = component.id
              and session.status = 'ended'
              and attendance.qualified
              and attendance.quarantined_at is null
          )
      )
    end
    from public.enrollments enrollment
    join public.course_versions version
      on version.id = enrollment.course_version_id
    where enrollment.id = target_enrollment
  ), false)
$$;
revoke all on function
  internal.enrollment_live_requirements_met(uuid)
  from public;

create or replace function internal.live_booking_is_required(
  target_booking uuid
)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select coalesce((
    select case version.delivery_type
      when 'live' then true
      when 'hybrid' then exists (
        select 1
        from public.hybrid_components component
        where component.id = booking.live_component_id
          and component.course_version_id = booking.course_version_id
          and component.component_type = 'live'
          and component.required
      )
      else false
    end
    from public.live_bookings booking
    join public.course_versions version
      on version.id = booking.course_version_id
    where booking.id = target_booking
  ), false)
$$;
revoke all on function internal.live_booking_is_required(uuid)
  from public;

create or replace function internal.settle_live_attendance(target_session uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  session_row public.live_sessions%rowtype;
  booking record;
  effective_seconds integer;
  camera_seconds integer;
  denominator integer;
  device_ok boolean;
  checked_in_ok boolean;
  checked_out_ok boolean;
  actual_locked_break_seconds integer;
  computed_qualified boolean;
  summary_manifest_hash text;
  attendance_summary_id uuid;
  next_revision integer;
  approved_presence_delta integer;
  approved_camera_delta integer;
  approved_correction_manifest jsonb;
  prior_booking_qualified boolean;
  settled integer := 0;
begin
  if auth.role() <> 'service_role'
     and not internal.has_staff_role('course_admin')
  then raise exception 'ATTENDANCE_SETTLEMENT_AUTHORITY_REQUIRED'; end if;
  select * into session_row from public.live_sessions
  where id = target_session for update;
  if not found
     or session_row.status <> 'ended'
     or now() < session_row.evidence_settles_at
  then
    raise exception 'EVIDENCE_SETTLEMENT_NOT_READY';
  end if;
  if exists (
    select 1
    from public.live_bookings live_booking
    join public.live_join_leases lease
      on lease.live_booking_id = live_booking.id
    where live_booking.live_session_id = target_session
      and lease.duplicate_anomaly_at is not null
  ) then
    insert into public.live_evidence_events (
      live_session_id, event_type, occurred_at, evidence
    )
    select
      target_session, 'provider_anomaly', now(),
      jsonb_build_object(
        'reason', 'unresolved_duplicate_participant',
        'settlementBlocked', true
      )
    where not exists (
      select 1
      from public.live_evidence_events evidence
      where evidence.live_session_id = target_session
        and evidence.event_type = 'provider_anomaly'
        and evidence.evidence ->> 'reason' =
          'unresolved_duplicate_participant'
    );
    update public.live_sessions
    set status = 'reconciling'
    where id = target_session;
    return 0;
  end if;
  select coalesce(sum(
    extract(epoch from (formal_break.ends_at - formal_break.starts_at))
  ), 0)::integer
  into actual_locked_break_seconds
  from public.live_breaks formal_break
  where formal_break.live_session_id = target_session
    and formal_break.locked_at is not null;
  if actual_locked_break_seconds <> session_row.locked_break_seconds then
    raise exception 'LOCKED_BREAK_MANIFEST_MISMATCH';
  end if;
  denominator := session_row.scheduled_teaching_seconds
    - actual_locked_break_seconds;

  for booking in
    select
      lb.id,
      lb.customer_key,
      lb.enrollment_id,
      (
        select request.id
        from public.live_join_leases lease
        join public.provider_anomaly_resolution_requests request
          on request.live_join_lease_id = lease.id
        join public.provider_anomaly_resolution_decisions decision
          on decision.resolution_request_id = request.id
         and decision.decision = 'approve'
        where lease.live_booking_id = lb.id
        order by decision.decided_at desc, request.id desc
        limit 1
      ) as provider_resolution_request_id,
      exists (
        select 1
        from public.live_join_leases lease
        join public.provider_anomaly_resolution_requests request
          on request.live_join_lease_id = lease.id
         and request.resolution_kind = 'disqualify_booking'
        join public.provider_anomaly_resolution_decisions decision
          on decision.resolution_request_id = request.id
         and decision.decision = 'approve'
        where lease.live_booking_id = lb.id
      ) as provider_disqualified
    from public.live_bookings lb
    where lb.live_session_id = target_session
      and lb.status in ('confirmed', 'attended')
    order by lb.id
  loop
    select coalesce((
      select summary.qualified
      from public.attendance_summaries summary
      where summary.live_booking_id = booking.id
    ), false) into prior_booking_qualified;
    with authoritative_bounds as (
      select least(
        session_row.ends_at,
        coalesce((
          select min(evidence.occurred_at)
          from public.live_evidence_events evidence
          where evidence.live_session_id = target_session
            and evidence.event_type = 'actual_ended'
        ), session_row.ends_at)
      ) as presence_ends_at
    ),
    ordered_heartbeats as (
      select
        heartbeat.join_lease_id,
        lease.provider_customer_key,
        heartbeat.received_at as segment_end,
        lag(heartbeat.received_at) over (
          partition by heartbeat.join_lease_id
          order by heartbeat.received_at, heartbeat.sequence
        ) as previous_received_at,
        heartbeat.camera_on,
        lag(heartbeat.camera_on) over (
          partition by heartbeat.join_lease_id
          order by heartbeat.received_at, heartbeat.sequence
        ) as previous_camera_on
      from public.live_client_heartbeats heartbeat
      join public.live_join_leases lease
        on lease.id = heartbeat.join_lease_id
      where heartbeat.live_session_id = target_session
        and lease.live_booking_id = booking.id
        and lease.duplicate_anomaly_at is null
        and heartbeat.received_at >= session_row.starts_at
        and heartbeat.received_at <= session_row.ends_at
    ),
    candidate_segments as (
      select
        join_lease_id,
        provider_customer_key,
        greatest(
          previous_received_at,
          segment_end - interval '15 seconds',
          session_row.starts_at
        ) as segment_start,
        least(segment_end, bounds.presence_ends_at) as segment_end,
        camera_on and coalesce(previous_camera_on, false) as camera_on
      from ordered_heartbeats
      cross join authoritative_bounds bounds
      where previous_received_at is not null
        and segment_end > previous_received_at
        and segment_end - previous_received_at <= interval '45 seconds'
        and greatest(
          previous_received_at,
          segment_end - interval '15 seconds',
          session_row.starts_at
        ) < least(segment_end, bounds.presence_ends_at)
    ),
    provider_evidenced_segments as (
      select
        segment.segment_start,
        segment.segment_end,
        segment.camera_on
      from candidate_segments segment
      where exists (
        select 1
        from public.zoom_participant_events joined
        where joined.live_session_id = target_session
          and joined.customer_key = segment.provider_customer_key
          and joined.participant_uuid is not null
          and joined.provider_event_type like '%participant_joined'
          and joined.provider_occurrence_at <= segment.segment_start
          and not exists (
            select 1
            from public.zoom_participant_events departed
            where departed.live_session_id = target_session
              and departed.customer_key = segment.provider_customer_key
              and departed.participant_uuid = joined.participant_uuid
              and departed.provider_event_type like '%participant_left'
              and departed.provider_occurrence_at
                between joined.provider_occurrence_at
                  and segment.segment_end
          )
          and 1 = (
            select count(distinct active_join.participant_uuid)
            from public.zoom_participant_events active_join
            where active_join.live_session_id = target_session
              and active_join.customer_key =
                segment.provider_customer_key
              and active_join.participant_uuid is not null
              and active_join.provider_event_type like
                '%participant_joined'
              and active_join.provider_occurrence_at
                <= segment.segment_start
              and not exists (
                select 1
                from public.zoom_participant_events active_left
                where active_left.live_session_id = target_session
                  and active_left.customer_key =
                    segment.provider_customer_key
                  and active_left.participant_uuid =
                    active_join.participant_uuid
                  and active_left.provider_event_type like
                    '%participant_left'
                  and active_left.provider_occurrence_at
                    between active_join.provider_occurrence_at
                      and segment.segment_start
              )
          )
      )
    ),
    -- PostgreSQL multiranges merge overlapping reconnect/takeover segments in
    -- one pass. This has the same no-double-count and conservative camera-off
    -- semantics as per-second expansion without generating millions of rows.
    provider_range_sets as (
      select
        coalesce(
          range_agg(tstzrange(
            segment_start, segment_end, '[)'
          )),
          '{}'::tstzmultirange
        ) as presence_ranges,
        coalesce(
          range_agg(tstzrange(
            segment_start, segment_end, '[)'
          )) filter (where not camera_on),
          '{}'::tstzmultirange
        ) as camera_off_ranges
      from provider_evidenced_segments
    ),
    break_range_set as (
      select coalesce(
        range_agg(tstzrange(
          formal_break.starts_at, formal_break.ends_at, '[)'
        )),
        '{}'::tstzmultirange
      ) as break_ranges
      from public.live_breaks formal_break
      where formal_break.live_session_id = target_session
        and formal_break.locked_at is not null
    ),
    final_ranges as (
      select
        provider.presence_ranges
          * (
            tstzmultirange(tstzrange(
              session_row.starts_at, session_row.ends_at, '[)'
            )) - breaks.break_ranges
          ) as effective_ranges,
        (
          provider.presence_ranges - provider.camera_off_ranges
        ) * (
          tstzmultirange(tstzrange(
            session_row.starts_at, session_row.ends_at, '[)'
          )) - breaks.break_ranges
        ) as camera_ranges
      from provider_range_sets provider
      cross join break_range_set breaks
    )
    select
      least(coalesce((
        select sum(extract(epoch from (
          upper(range_item.value) - lower(range_item.value)
        )))::integer
        from final_ranges,
          unnest(final_ranges.effective_ranges) as range_item(value)
      ), 0), denominator),
      least(coalesce((
        select sum(extract(epoch from (
          upper(range_item.value) - lower(range_item.value)
        )))::integer
        from final_ranges,
          unnest(final_ranges.camera_ranges) as range_item(value)
      ), 0), denominator)
      into effective_seconds, camera_seconds
    ;
    effective_seconds := coalesce(effective_seconds, 0);
    camera_seconds := least(coalesce(camera_seconds, 0), effective_seconds);
    if booking.provider_disqualified then
      effective_seconds := 0;
      camera_seconds := 0;
    end if;
    select
      coalesce(sum(correction.presence_seconds_delta), 0)::integer,
      coalesce(sum(correction.camera_seconds_delta), 0)::integer,
      coalesce(jsonb_agg(jsonb_build_object(
        'correctionId', correction.id,
        'decisionId', decision.id,
        'presenceSecondsDelta', correction.presence_seconds_delta,
        'cameraSecondsDelta', correction.camera_seconds_delta,
        'proposedBy', correction.proposed_by,
        'decidedBy', decision.decided_by,
        'decision', decision.decision,
        'decidedAt', decision.decided_at
      ) order by decision.decided_at, correction.id), '[]'::jsonb)
    into approved_presence_delta, approved_camera_delta,
      approved_correction_manifest
    from public.attendance_summaries prior_summary
    join public.attendance_corrections correction
      on correction.attendance_summary_id = prior_summary.id
    join public.attendance_correction_decisions decision
      on decision.attendance_correction_id = correction.id
     and decision.decision = 'approve'
    where prior_summary.live_booking_id = booking.id;
    if not booking.provider_disqualified then
      effective_seconds := greatest(
        0,
        least(
          denominator,
          effective_seconds + approved_presence_delta
        )
      );
      camera_seconds := greatest(
        0,
        least(
          effective_seconds,
          camera_seconds + approved_camera_delta
        )
      );
    end if;

    select
      exists (
        select 1 from public.check_events check_event
        where check_event.live_booking_id = booking.id
          and check_event.event_type = 'check_in'
      ),
      exists (
        select 1 from public.check_events check_event
        where check_event.live_booking_id = booking.id
          and check_event.event_type = 'check_out'
      ),
      exists (
        select 1 from public.check_events check_event
        where check_event.live_booking_id = booking.id
          and check_event.event_type = 'check_in'
          and check_event.device_test_passed
      )
      into checked_in_ok, checked_out_ok, device_ok;

    computed_qualified :=
      not booking.provider_disqualified
      and device_ok and checked_in_ok and checked_out_ok
      and effective_seconds::numeric * 100 / denominator
        >= session_row.presence_threshold
      and camera_seconds::numeric * 100 / denominator
        >= session_row.camera_threshold;
    select encode(extensions.digest(
      booking.id::text || ':' || effective_seconds::text || ':'
      || camera_seconds::text || ':' || denominator::text || ':'
      || device_ok::text || ':' || checked_in_ok::text || ':'
      || checked_out_ok::text || ':' || computed_qualified::text || ':'
      || booking.provider_disqualified::text || ':'
      || coalesce(
        booking.provider_resolution_request_id::text, 'initial'
      ) || ':approved-corrections:'
      || approved_correction_manifest::text || ':provider:'
      || coalesce((
        select string_agg(
          provider_event.canonical_fingerprint || ':'
            || extract(
              epoch from provider_event.provider_occurrence_at
            )::text,
          '|' order by provider_event.provider_occurrence_at,
            provider_event.ingest_sequence
        )
        from public.zoom_participant_events provider_event
        where provider_event.live_session_id = target_session
          and provider_event.customer_key = booking.customer_key
      ), '') || ':heartbeat:'
      || coalesce((
        select string_agg(
          heartbeat.id::text || ':' || heartbeat.sequence::text || ':'
            || extract(epoch from heartbeat.received_at)::text || ':'
            || heartbeat.camera_on::text || ':'
            || heartbeat.device_test_passed::text,
          '|' order by heartbeat.received_at, heartbeat.sequence,
            heartbeat.id
        )
        from public.live_client_heartbeats heartbeat
        join public.live_join_leases lease
          on lease.id = heartbeat.join_lease_id
        where lease.live_booking_id = booking.id
      ), '') || ':checks:'
      || coalesce((
        select string_agg(
          check_event.id::text || ':' || check_event.event_type || ':'
            || extract(epoch from check_event.occurred_at)::text || ':'
            || check_event.device_test_passed::text,
          '|' order by check_event.occurred_at, check_event.id
        )
        from public.check_events check_event
        where check_event.live_booking_id = booking.id
      ), '') || ':session-evidence:'
      || coalesce((
        select string_agg(
          evidence.id::text || ':' || evidence.event_type || ':'
            || extract(epoch from evidence.occurred_at)::text || ':'
            || evidence.evidence::text,
          '|' order by evidence.occurred_at, evidence.id
        )
        from public.live_evidence_events evidence
        where evidence.live_session_id = target_session
      ), ''),
      'sha256'
    ), 'hex') into summary_manifest_hash;

    insert into public.attendance_summaries (
      live_booking_id, denominator_seconds, effective_presence_seconds,
      camera_seconds, presence_percent, camera_percent,
      device_check_passed, checked_in, checked_out, qualified,
      source_manifest_hash, settled_at
    ) values (
      booking.id, denominator, effective_seconds, camera_seconds,
      round(effective_seconds::numeric * 100 / denominator, 3),
      round(camera_seconds::numeric * 100 / denominator, 3),
      device_ok, checked_in_ok, checked_out_ok,
      computed_qualified, summary_manifest_hash,
      now()
    ) on conflict (live_booking_id) do update
    set denominator_seconds = excluded.denominator_seconds,
        effective_presence_seconds =
          excluded.effective_presence_seconds,
        camera_seconds = excluded.camera_seconds,
        presence_percent = excluded.presence_percent,
        camera_percent = excluded.camera_percent,
        device_check_passed = excluded.device_check_passed,
        checked_in = excluded.checked_in,
        checked_out = excluded.checked_out,
        qualified = excluded.qualified,
        source_manifest_hash = excluded.source_manifest_hash,
        settled_at = excluded.settled_at,
        quarantined_at = null,
        quarantine_reason = null,
        corrected_at = case
          when public.attendance_summaries.source_manifest_hash
            is distinct from excluded.source_manifest_hash
          then clock_timestamp()
          else public.attendance_summaries.corrected_at
        end
    returning id into attendance_summary_id;
    select coalesce(max(revision.revision), 0) + 1
    into next_revision
    from public.attendance_summary_revisions revision
    where revision.attendance_summary_id = attendance_summary_id;
    insert into public.attendance_summary_revisions (
      attendance_summary_id, revision, denominator_seconds,
      effective_presence_seconds, camera_seconds, presence_percent,
      camera_percent, device_check_passed, checked_in, checked_out,
      qualified, source_manifest_hash, source_kind,
      provider_anomaly_resolution_request_id
    ) values (
      attendance_summary_id, next_revision, denominator,
      effective_seconds, camera_seconds,
      round(effective_seconds::numeric * 100 / denominator, 3),
      round(camera_seconds::numeric * 100 / denominator, 3),
      device_ok, checked_in_ok, checked_out_ok, computed_qualified,
      summary_manifest_hash,
      case
        when booking.provider_resolution_request_id is null
          then 'initial_settlement'
        else 'provider_anomaly_recompute'
      end,
      booking.provider_resolution_request_id
    )
    on conflict (attendance_summary_id, source_manifest_hash)
      do nothing;
    if booking.provider_resolution_request_id is not null
       and booking.enrollment_id is not null
       and prior_booking_qualified
       and not computed_qualified
       and internal.live_booking_is_required(booking.id)
       and not internal.enrollment_live_requirements_met(
         booking.enrollment_id
       )
    then
      perform internal.revoke_certificate_for_provider_anomaly(
        booking.enrollment_id,
        booking.provider_resolution_request_id
      );
    end if;
    update public.live_bookings set status = 'attended'
    where id = booking.id and status = 'confirmed';
    insert into public.durable_jobs (
      job_type, business_key, payload
    )
    select
      'completion_evaluate',
      'completion-evaluate:' || live_booking.enrollment_id::text,
      jsonb_build_object('enrollmentId', live_booking.enrollment_id)
    from public.live_bookings live_booking
    join public.enrollments enrollment
      on enrollment.id = live_booking.enrollment_id
    where live_booking.id = booking.id
      and live_booking.enrollment_id is not null
      and enrollment.status = 'active'
      and internal.enrollment_live_requirements_met(enrollment.id)
      and not exists (
        select 1
        from public.certificates certificate
        where certificate.enrollment_id = enrollment.id
      )
    on conflict (business_key) do update
    set status = 'pending', available_at = now(), last_error = null,
        attempt_count = 0, completed_at = null;
    settled := settled + 1;
  end loop;
  return settled;
end
$$;
revoke all on function internal.settle_live_attendance(uuid) from public;

create or replace function public.settle_live_attendance(
  p_live_session_id uuid
)
returns integer
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.settle_live_attendance(p_live_session_id)
$$;

create or replace function internal.propose_attendance_correction(
  target_summary uuid,
  submitted_presence_delta integer,
  submitted_camera_delta integer,
  submitted_reason text,
  submitted_evidence_reference text,
  submitted_nonce_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  summary public.attendance_summaries%rowtype;
  correction_id uuid;
begin
  perform internal.consume_step_up_grant(
    'attendance_override', target_summary::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('course_admin')
     or length(trim(submitted_reason)) < 10
     or length(trim(submitted_evidence_reference)) < 3
  then raise exception 'ATTENDANCE_CORRECTION_REJECTED'; end if;
  select * into summary from public.attendance_summaries
  where id = target_summary for update;
  if not found
     or summary.quarantined_at is not null
     or summary.effective_presence_seconds + submitted_presence_delta
       not between 0 and summary.denominator_seconds
     or summary.camera_seconds + submitted_camera_delta
       not between 0 and summary.denominator_seconds
     or summary.camera_seconds + submitted_camera_delta
       > summary.effective_presence_seconds + submitted_presence_delta
  then raise exception 'ATTENDANCE_CORRECTION_OUT_OF_RANGE'; end if;
  insert into public.attendance_corrections (
    attendance_summary_id, proposed_by, presence_seconds_delta,
    camera_seconds_delta, reason, evidence_reference
  ) values (
    target_summary, actor, submitted_presence_delta,
    submitted_camera_delta, trim(submitted_reason),
    trim(submitted_evidence_reference)
  ) returning id into correction_id;
  perform internal.append_audit_event(
    actor, 'attendance.correction_proposed', 'attendance_correction',
    correction_id::text, trim(submitted_reason), null,
    jsonb_build_object(
      'presenceDelta', submitted_presence_delta,
      'cameraDelta', submitted_camera_delta
    )
  );
  return correction_id;
end
$$;
revoke all on function internal.propose_attendance_correction(
  uuid, integer, integer, text, text, text
) from public;

create or replace function public.propose_attendance_correction(
  p_attendance_summary_id uuid,
  p_presence_seconds_delta integer,
  p_camera_seconds_delta integer,
  p_reason text,
  p_evidence_reference text,
  p_nonce_hash text
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.propose_attendance_correction(
    p_attendance_summary_id, p_presence_seconds_delta,
    p_camera_seconds_delta, p_reason, p_evidence_reference,
    p_nonce_hash
  )
$$;

create or replace function
  internal.revoke_certificate_for_attendance_correction(
    target_enrollment uuid,
    target_correction uuid
  )
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  correction_row public.attendance_corrections%rowtype;
  decision_row public.attendance_correction_decisions%rowtype;
  certificate_row public.certificates%rowtype;
  revision_row public.certificate_revisions%rowtype;
  next_revision_id uuid;
begin
  select correction.* into correction_row
  from public.attendance_corrections correction
  join public.attendance_summaries summary
    on summary.id = correction.attendance_summary_id
  join public.live_bookings booking
    on booking.id = summary.live_booking_id
  where correction.id = target_correction
    and booking.enrollment_id = target_enrollment;
  select decision.* into decision_row
  from public.attendance_correction_decisions decision
  where decision.attendance_correction_id = target_correction
    and decision.decision = 'approve';
  if correction_row.id is null
     or decision_row.id is null
     or correction_row.proposed_by = decision_row.decided_by
  then
    raise exception 'ATTENDANCE_CORRECTION_REVOCATION_AUTHORITY_INVALID';
  end if;
  select certificate.* into certificate_row
  from public.certificates certificate
  where certificate.enrollment_id = target_enrollment
  for update;
  if not found or certificate_row.current_status = 'revoked' then
    return false;
  end if;
  select revision.* into revision_row
  from public.certificate_revisions revision
  where revision.id = certificate_row.current_revision_id;
  if not found then
    raise exception 'ATTENDANCE_CORRECTION_CERTIFICATE_REVISION_MISSING';
  end if;
  insert into public.certificate_revisions (
    certificate_id, revision, status, masked_name_snapshot,
    course_title_snapshot, course_version_snapshot, completed_on,
    accreditation_reference_snapshot, accreditation_points_snapshot,
    accreditation_authority_snapshot, live_session_snapshot,
    evidence_manifest_hash, pdf_object_path, pdf_sha256,
    verification_token_hash, issued_by, approved_by,
    revoked_at, revocation_reason
  ) values (
    certificate_row.id, revision_row.revision + 1, 'revoked',
    revision_row.masked_name_snapshot, revision_row.course_title_snapshot,
    revision_row.course_version_snapshot, revision_row.completed_on,
    revision_row.accreditation_reference_snapshot,
    revision_row.accreditation_points_snapshot,
    revision_row.accreditation_authority_snapshot,
    revision_row.live_session_snapshot,
    encode(extensions.digest(
      revision_row.evidence_manifest_hash || ':attendance-correction:'
        || target_correction::text,
      'sha256'
    ), 'hex'),
    revision_row.pdf_object_path, revision_row.pdf_sha256,
    encode(extensions.digest(
      gen_random_uuid()::text || clock_timestamp()::text,
      'sha256'
    ), 'hex'),
    correction_row.proposed_by, decision_row.decided_by, now(),
    '雙人核准的出席更正使直播出席資格失效：'
      || correction_row.reason
  ) returning id into next_revision_id;
  update public.certificates
  set current_revision_id = next_revision_id,
      current_status = 'revoked'
  where id = certificate_row.id;
  update public.enrollments
  set status = 'revoked'
  where id = target_enrollment
    and status in ('completed', 'submitted', 'credited', 'needs_correction');
  insert into public.notifications (
    person_id, category, title, body, business_key
  )
  select
    enrollment.person_id, 'certificate', '證明狀態已撤銷',
    '雙人核准的直播出席更正已改變資格；原始證據與歷史證明仍保留。',
    'attendance-correction-certificate-revoked:'
      || target_correction::text
  from public.enrollments enrollment
  where enrollment.id = target_enrollment
  on conflict (person_id, business_key) do nothing;
  perform internal.append_audit_event(
    decision_row.decided_by,
    'attendance_correction.certificate_revoked',
    'attendance_correction', target_correction::text,
    decision_row.reason, null,
    jsonb_build_object(
      'certificateId', certificate_row.id,
      'revisionId', next_revision_id,
      'enrollmentId', target_enrollment
    )
  );
  return true;
end
$$;
revoke all on function
  internal.revoke_certificate_for_attendance_correction(uuid, uuid)
  from public;

create or replace function internal.decide_attendance_correction(
  target_correction uuid,
  submitted_decision text,
  submitted_reason text,
  submitted_nonce_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  correction public.attendance_corrections%rowtype;
  summary public.attendance_summaries%rowtype;
  next_presence integer;
  next_camera integer;
  target_enrollment_id uuid;
  session_row public.live_sessions%rowtype;
  corrected_qualified boolean;
begin
  perform internal.consume_step_up_grant(
    'attendance_override', target_correction::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('accreditation_reviewer')
     or submitted_decision not in ('approve', 'reject')
     or length(trim(submitted_reason)) < 10
  then raise exception 'ATTENDANCE_DECISION_REJECTED'; end if;
  select * into correction from public.attendance_corrections
  where id = target_correction;
  if not found or correction.proposed_by = actor
     or exists (
       select 1 from public.attendance_correction_decisions decision
       where decision.attendance_correction_id = target_correction
     )
  then raise exception 'DISTINCT_ATTENDANCE_REVIEWER_REQUIRED'; end if;
  insert into public.attendance_correction_decisions (
    attendance_correction_id, decided_by, decision, reason
  ) values (
    target_correction, actor, submitted_decision, trim(submitted_reason)
  );
  if submitted_decision = 'reject' then return 'rejected'; end if;
  select * into summary from public.attendance_summaries
  where id = correction.attendance_summary_id for update;
  if not found or summary.quarantined_at is not null then
    raise exception 'ATTENDANCE_SUMMARY_PROVIDER_RECONCILIATION_REQUIRED';
  end if;
  next_presence := summary.effective_presence_seconds
    + correction.presence_seconds_delta;
  next_camera := summary.camera_seconds + correction.camera_seconds_delta;
  if next_presence not between 0 and summary.denominator_seconds
     or next_camera not between 0 and next_presence
  then
    raise exception 'ATTENDANCE_CORRECTION_OUT_OF_RANGE';
  end if;
  select session.* into session_row
  from public.live_bookings booking
  join public.live_sessions session on session.id = booking.live_session_id
  where booking.id = summary.live_booking_id;
  select booking.enrollment_id into target_enrollment_id
  from public.live_bookings booking
  where booking.id = summary.live_booking_id;
  corrected_qualified :=
    summary.device_check_passed
    and summary.checked_in
    and summary.checked_out
    and next_presence::numeric * 100 / summary.denominator_seconds
      >= session_row.presence_threshold
    and next_camera::numeric * 100 / summary.denominator_seconds
      >= session_row.camera_threshold;
  update public.attendance_summaries
  set effective_presence_seconds = next_presence,
      camera_seconds = next_camera,
      presence_percent = round(
        next_presence::numeric * 100 / denominator_seconds, 3
      ),
      camera_percent = round(
        next_camera::numeric * 100 / denominator_seconds, 3
      ),
      qualified = corrected_qualified,
      source_manifest_hash = encode(extensions.digest(
        source_manifest_hash || ':' || target_correction::text
          || ':' || submitted_decision,
        'sha256'
      ), 'hex'),
      corrected_at = now()
  where id = summary.id;
  if target_enrollment_id is not null
     and summary.qualified
     and not corrected_qualified
     and internal.live_booking_is_required(summary.live_booking_id)
     and not internal.enrollment_live_requirements_met(
       target_enrollment_id
     )
  then
    perform internal.revoke_certificate_for_attendance_correction(
      target_enrollment_id, target_correction
    );
  end if;
  if target_enrollment_id is not null
     and internal.enrollment_live_requirements_met(
       target_enrollment_id
     )
     and exists (
       select 1
       from public.enrollments enrollment
       where enrollment.id = target_enrollment_id
         and enrollment.status = 'active'
     )
     and not exists (
       select 1
       from public.certificates certificate
       where certificate.enrollment_id = target_enrollment_id
     )
  then
    insert into public.durable_jobs (job_type, business_key, payload)
    values (
      'completion_evaluate',
      'completion-evaluate:' || target_enrollment_id::text,
      jsonb_build_object('enrollmentId', target_enrollment_id)
    )
    on conflict (business_key) do update
    set status = 'pending', available_at = now(), last_error = null,
        attempt_count = 0, completed_at = null;
  end if;
  perform internal.append_audit_event(
    actor, 'attendance.correction_approved', 'attendance_correction',
    target_correction::text, trim(submitted_reason), null,
    jsonb_build_object('summaryId', summary.id)
  );
  return 'approved';
end
$$;
revoke all on function internal.decide_attendance_correction(
  uuid, text, text, text
) from public;

create or replace function public.decide_attendance_correction(
  p_correction_id uuid,
  p_decision text,
  p_reason text,
  p_nonce_hash text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.decide_attendance_correction(
    p_correction_id, p_decision, p_reason, p_nonce_hash
  )
$$;

create or replace function
  internal.revoke_certificate_for_provider_anomaly(
    target_enrollment uuid,
    target_resolution_request uuid
  )
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_row public.provider_anomaly_resolution_requests%rowtype;
  decision_row public.provider_anomaly_resolution_decisions%rowtype;
  certificate_row public.certificates%rowtype;
  revision_row public.certificate_revisions%rowtype;
  next_revision_id uuid;
begin
  select request.* into request_row
  from public.provider_anomaly_resolution_requests request
  join public.live_join_leases lease
    on lease.id = request.live_join_lease_id
  join public.live_bookings booking
    on booking.id = lease.live_booking_id
  where request.id = target_resolution_request
    and booking.enrollment_id = target_enrollment;
  select decision.* into decision_row
  from public.provider_anomaly_resolution_decisions decision
  where decision.resolution_request_id = target_resolution_request
    and decision.decision = 'approve';
  if request_row.id is null
     or decision_row.id is null
     or request_row.proposed_by = decision_row.decided_by
  then
    raise exception 'PROVIDER_ANOMALY_REVOCATION_AUTHORITY_INVALID';
  end if;
  select certificate.* into certificate_row
  from public.certificates certificate
  where certificate.enrollment_id = target_enrollment
  for update;
  if not found or certificate_row.current_status = 'revoked' then
    return false;
  end if;
  select revision.* into revision_row
  from public.certificate_revisions revision
  where revision.id = certificate_row.current_revision_id;
  if not found then
    raise exception 'PROVIDER_ANOMALY_CERTIFICATE_REVISION_MISSING';
  end if;
  insert into public.certificate_revisions (
    certificate_id, revision, status, masked_name_snapshot,
    course_title_snapshot, course_version_snapshot, completed_on,
    accreditation_reference_snapshot, accreditation_points_snapshot,
    accreditation_authority_snapshot, live_session_snapshot,
    evidence_manifest_hash, pdf_object_path, pdf_sha256,
    verification_token_hash, issued_by, approved_by,
    revoked_at, revocation_reason
  ) values (
    certificate_row.id, revision_row.revision + 1, 'revoked',
    revision_row.masked_name_snapshot, revision_row.course_title_snapshot,
    revision_row.course_version_snapshot, revision_row.completed_on,
    revision_row.accreditation_reference_snapshot,
    revision_row.accreditation_points_snapshot,
    revision_row.accreditation_authority_snapshot,
    revision_row.live_session_snapshot,
    encode(extensions.digest(
      revision_row.evidence_manifest_hash || ':provider-anomaly:'
        || target_resolution_request::text,
      'sha256'
    ), 'hex'),
    revision_row.pdf_object_path, revision_row.pdf_sha256,
    encode(extensions.digest(
      gen_random_uuid()::text || clock_timestamp()::text,
      'sha256'
    ), 'hex'),
    request_row.proposed_by, decision_row.decided_by, now(),
    '晚到 Provider 證據使直播出席資格失效：'
      || request_row.reason
  ) returning id into next_revision_id;
  update public.certificates
  set current_revision_id = next_revision_id,
      current_status = 'revoked'
  where id = certificate_row.id;
  update public.enrollments
  set status = 'revoked'
  where id = target_enrollment
    and status in ('completed', 'submitted', 'credited', 'needs_correction');
  insert into public.notifications (
    person_id, category, title, body, business_key
  )
  select
    enrollment.person_id, 'certificate', '證明狀態已撤銷',
    '晚到的直播出席證據經兩人覆核後改變資格；原始證據與歷史證明仍保留。',
    'provider-anomaly-certificate-revoked:'
      || target_resolution_request::text
  from public.enrollments enrollment
  where enrollment.id = target_enrollment
  on conflict (person_id, business_key) do nothing;
  perform internal.append_audit_event(
    decision_row.decided_by,
    'provider_anomaly.certificate_revoked',
    'provider_anomaly_resolution_request',
    target_resolution_request::text,
    decision_row.reason, null,
    jsonb_build_object(
      'certificateId', certificate_row.id,
      'revisionId', next_revision_id,
      'enrollmentId', target_enrollment
    )
  );
  return true;
end
$$;
revoke all on function
  internal.revoke_certificate_for_provider_anomaly(uuid, uuid)
  from public;

create or replace function internal.propose_provider_anomaly_resolution(
  target_lease uuid,
  submitted_resolution_kind text,
  submitted_participant_uuid text,
  submitted_assumed_left_at timestamptz,
  submitted_reason text,
  submitted_evidence_reference text,
  idempotency uuid,
  submitted_nonce_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  lease_row public.live_join_leases%rowtype;
  existing_request public.provider_anomaly_resolution_requests%rowtype;
  request_id uuid;
  target_session uuid;
begin
  select request.* into existing_request
  from public.provider_anomaly_resolution_requests request
  where request.idempotency_key = idempotency;
  if found then
    if existing_request.proposed_by <> actor
       or existing_request.live_join_lease_id <> target_lease
       or existing_request.resolution_kind <> submitted_resolution_kind
       or existing_request.participant_uuid is distinct from
         nullif(trim(submitted_participant_uuid), '')
       or existing_request.assumed_left_at is distinct from
         submitted_assumed_left_at
       or existing_request.reason is distinct from trim(submitted_reason)
       or existing_request.evidence_reference is distinct from
         trim(submitted_evidence_reference)
    then
      raise exception 'PROVIDER_ANOMALY_IDEMPOTENCY_MISMATCH';
    end if;
    return existing_request.id;
  end if;
  perform internal.consume_step_up_grant(
    'attendance_override', target_lease::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('course_admin')
     or submitted_resolution_kind not in (
       'synthesize_left', 'accept_provider_evidence',
       'disqualify_booking'
     )
     or length(trim(submitted_reason)) < 10
     or length(trim(submitted_evidence_reference)) < 3
  then
    raise exception 'PROVIDER_ANOMALY_PROPOSAL_REJECTED';
  end if;
  select lease.* into lease_row
  from public.live_join_leases lease
  where lease.id = target_lease
  for update;
  select booking.live_session_id into target_session
  from public.live_bookings booking
  join public.live_sessions session
    on session.id = booking.live_session_id
  where booking.id = lease_row.live_booking_id
    and session.status in ('ended', 'reconciling');
  if lease_row.id is null
     or lease_row.duplicate_anomaly_at is null
     or target_session is null
     or exists (
       select 1
       from public.provider_anomaly_resolution_requests request
       left join public.provider_anomaly_resolution_decisions decision
         on decision.resolution_request_id = request.id
       where request.live_join_lease_id = target_lease
         and decision.id is null
     )
  then
    raise exception 'PROVIDER_ANOMALY_NOT_PROPOSABLE';
  end if;
  if submitted_resolution_kind = 'synthesize_left' then
    if nullif(trim(submitted_participant_uuid), '') is null
       or submitted_assumed_left_at is null
       or not exists (
         select 1
         from public.live_sessions session
         where session.id = target_session
           and submitted_assumed_left_at between
             session.starts_at - interval '30 minutes'
             and session.ends_at + interval '30 minutes'
       )
       or not exists (
         select 1
         from public.zoom_participant_events joined
         where joined.live_session_id = target_session
           and joined.customer_key = lease_row.provider_customer_key
           and joined.participant_uuid =
             trim(submitted_participant_uuid)
           and joined.provider_event_type like '%participant_joined'
           and joined.provider_occurrence_at <=
             submitted_assumed_left_at
           and (
             not exists (
               select 1
               from public.zoom_participant_events departed
               where departed.live_session_id = target_session
                 and departed.customer_key =
                   lease_row.provider_customer_key
                 and departed.participant_uuid =
                   joined.participant_uuid
                 and departed.provider_event_type like
                   '%participant_left'
                 and departed.provider_occurrence_at >=
                   joined.provider_occurrence_at
             )
             or exists (
               select 1
               from public.zoom_participant_events departed
               where departed.live_session_id = target_session
                 and departed.customer_key =
                   lease_row.provider_customer_key
                 and departed.participant_uuid =
                   joined.participant_uuid
                 and departed.provider_event_type =
                   'meeting.participant_left'
                 and departed.provider_occurrence_at =
                   submitted_assumed_left_at
             )
           )
       )
    then
      raise exception 'PROVIDER_ANOMALY_LEFT_EVIDENCE_INVALID';
    end if;
  elsif submitted_resolution_kind = 'accept_provider_evidence' then
    if nullif(trim(submitted_participant_uuid), '') is not null
       or submitted_assumed_left_at is not null
       or not exists (
         select 1
         from public.live_evidence_events evidence
         where evidence.live_session_id = target_session
           and evidence.event_type = 'provider_anomaly'
           and evidence.evidence ->> 'reason' =
             'late_provider_event_after_settlement'
           and coalesce(
             (evidence.evidence ->> 'requiresDualControl')::boolean,
             false
           )
       )
    then
      raise exception 'PROVIDER_ANOMALY_ACCEPTANCE_PAYLOAD_INVALID';
    end if;
  elsif nullif(trim(submitted_participant_uuid), '') is not null
        or submitted_assumed_left_at is not null
  then
    raise exception 'PROVIDER_ANOMALY_DISQUALIFICATION_PAYLOAD_INVALID';
  end if;
  insert into public.provider_anomaly_resolution_requests (
    live_join_lease_id, proposed_by, resolution_kind,
    participant_uuid, assumed_left_at, reason, evidence_reference,
    idempotency_key
  ) values (
    target_lease, actor, submitted_resolution_kind,
    case when submitted_resolution_kind = 'synthesize_left'
      then trim(submitted_participant_uuid) else null end,
    submitted_assumed_left_at, trim(submitted_reason),
    trim(submitted_evidence_reference), idempotency
  ) returning id into request_id;
  perform internal.append_audit_event(
    actor, 'provider_anomaly.resolution_proposed',
    'provider_anomaly_resolution_request', request_id::text,
    trim(submitted_reason), null,
    jsonb_build_object(
      'leaseId', target_lease,
      'resolutionKind', submitted_resolution_kind,
      'evidenceReference', trim(submitted_evidence_reference)
    )
  );
  return request_id;
end
$$;
revoke all on function
  internal.propose_provider_anomaly_resolution(
    uuid, text, text, timestamptz, text, text, uuid, text
  ) from public;

create or replace function public.propose_provider_anomaly_resolution(
  p_live_join_lease_id uuid,
  p_resolution_kind text,
  p_participant_uuid text,
  p_assumed_left_at timestamptz,
  p_reason text,
  p_evidence_reference text,
  p_idempotency_key uuid,
  p_nonce_hash text
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.propose_provider_anomaly_resolution(
    p_live_join_lease_id, p_resolution_kind, p_participant_uuid,
    p_assumed_left_at, p_reason, p_evidence_reference,
    p_idempotency_key, p_nonce_hash
  )
$$;
revoke all on function public.propose_provider_anomaly_resolution(
  uuid, text, text, timestamptz, text, text, uuid, text
) from public;

create or replace function internal.decide_provider_anomaly_resolution(
  target_request uuid,
  submitted_decision text,
  submitted_reason text,
  submitted_nonce_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  request_row public.provider_anomaly_resolution_requests%rowtype;
  existing_decision public.provider_anomaly_resolution_decisions%rowtype;
  lease_row public.live_join_leases%rowtype;
  target_session uuid;
  provider_meeting_uuid text;
  active_participant_count integer;
  next_participant_uuid text;
  next_removed_at timestamptz;
  settlement_available_at timestamptz;
begin
  select decision.* into existing_decision
  from public.provider_anomaly_resolution_decisions decision
  where decision.resolution_request_id = target_request;
  if found then
    if existing_decision.decided_by <> actor
       or existing_decision.decision <> submitted_decision
       or existing_decision.reason is distinct from trim(submitted_reason)
    then
      raise exception 'PROVIDER_ANOMALY_DECISION_REPLAY_MISMATCH';
    end if;
    return case existing_decision.decision
      when 'approve' then 'approved'
      else 'rejected'
    end;
  end if;
  perform internal.consume_step_up_grant(
    'attendance_override', target_request::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('accreditation_reviewer')
     or submitted_decision not in ('approve', 'reject')
     or length(trim(submitted_reason)) < 10
  then
    raise exception 'PROVIDER_ANOMALY_DECISION_REJECTED';
  end if;
  select request.* into request_row
  from public.provider_anomaly_resolution_requests request
  where request.id = target_request
  for update;
  if not found or request_row.proposed_by = actor then
    raise exception 'DISTINCT_PROVIDER_ANOMALY_REVIEWER_REQUIRED';
  end if;
  select lease,
    booking.live_session_id,
    coalesce(meeting.meeting_uuid, meeting.meeting_number)
  into lease_row, target_session, provider_meeting_uuid
  from public.live_join_leases lease
  join public.live_bookings booking
    on booking.id = lease.live_booking_id
  join private.zoom_meetings meeting
    on meeting.live_session_id = booking.live_session_id
  where lease.id = request_row.live_join_lease_id
  for update of lease;
  if lease_row.id is null then
    raise exception 'PROVIDER_ANOMALY_LEASE_NOT_FOUND';
  end if;
  insert into public.provider_anomaly_resolution_decisions (
    resolution_request_id, decided_by, decision, reason
  ) values (
    target_request, actor, submitted_decision, trim(submitted_reason)
  );
  if submitted_decision = 'reject' then
    perform internal.append_audit_event(
      actor, 'provider_anomaly.resolution_rejected',
      'provider_anomaly_resolution_request', target_request::text,
      trim(submitted_reason), null,
      jsonb_build_object('leaseId', lease_row.id)
    );
    return 'rejected';
  end if;

  -- If authoritative provider delivery resolved the overlap while the request
  -- waited for a second reviewer, approval is an append-only no-op.
  if lease_row.duplicate_anomaly_at is not null
     and request_row.resolution_kind = 'synthesize_left'
  then
    if not exists (
      select 1
      from public.zoom_participant_events joined
      where joined.live_session_id = target_session
        and joined.customer_key = lease_row.provider_customer_key
        and joined.participant_uuid = request_row.participant_uuid
        and joined.provider_event_type like '%participant_joined'
        and joined.provider_occurrence_at <= request_row.assumed_left_at
        and not exists (
          select 1
          from public.zoom_participant_events departed
          where departed.live_session_id = target_session
            and departed.customer_key = lease_row.provider_customer_key
            and departed.participant_uuid = joined.participant_uuid
            and departed.provider_event_type like '%participant_left'
            and departed.provider_occurrence_at >=
              joined.provider_occurrence_at
        )
    ) and not exists (
      select 1
      from public.zoom_participant_events departed
      where departed.live_session_id = target_session
        and departed.customer_key = lease_row.provider_customer_key
        and departed.participant_uuid = request_row.participant_uuid
        and departed.provider_event_type = 'meeting.participant_left'
        and departed.provider_occurrence_at =
          request_row.assumed_left_at
    ) then
      raise exception 'PROVIDER_ANOMALY_LEFT_EVIDENCE_STALE';
    end if;
    if not exists (
      select 1
      from public.zoom_participant_events departed
      where departed.live_session_id = target_session
        and departed.customer_key = lease_row.provider_customer_key
        and departed.participant_uuid = request_row.participant_uuid
        and departed.provider_event_type = 'meeting.participant_left'
        and departed.provider_occurrence_at =
          request_row.assumed_left_at
    ) then
      insert into public.zoom_participant_events (
        live_session_id, provider_event_type, meeting_uuid,
        participant_uuid, customer_key, provider_occurrence_at,
        canonical_fingerprint, payload
      ) values (
        target_session, 'staff.participant_left',
        provider_meeting_uuid, request_row.participant_uuid,
        lease_row.provider_customer_key, request_row.assumed_left_at,
        encode(extensions.digest(
          'provider-anomaly-resolution:' || target_request::text,
          'sha256'
        ), 'hex'),
        jsonb_build_object(
          'source', 'dual_control_staff_resolution',
          'resolutionRequestId', target_request,
          'evidenceReference', request_row.evidence_reference,
          'proposedBy', request_row.proposed_by,
          'approvedBy', actor
        )
      );
    end if;
    select count(distinct joined.participant_uuid)::integer
    into active_participant_count
    from public.zoom_participant_events joined
    where joined.live_session_id = target_session
      and joined.customer_key = lease_row.provider_customer_key
      and joined.provider_event_type like '%participant_joined'
      and joined.participant_uuid is not null
      and not exists (
        select 1
        from public.zoom_participant_events departed
        where departed.live_session_id = target_session
          and departed.customer_key = lease_row.provider_customer_key
          and departed.participant_uuid = joined.participant_uuid
          and departed.provider_event_type like '%participant_left'
          and departed.provider_occurrence_at >=
            joined.provider_occurrence_at
      );
    if active_participant_count > 1 then
      raise exception 'PROVIDER_ANOMALY_RESOLUTION_INCOMPLETE';
    end if;
    if active_participant_count = 1 then
      select joined.participant_uuid into next_participant_uuid
      from public.zoom_participant_events joined
      where joined.live_session_id = target_session
        and joined.customer_key = lease_row.provider_customer_key
        and joined.provider_event_type like '%participant_joined'
        and joined.participant_uuid is not null
        and not exists (
          select 1
          from public.zoom_participant_events departed
          where departed.live_session_id = target_session
            and departed.customer_key = lease_row.provider_customer_key
            and departed.participant_uuid = joined.participant_uuid
            and departed.provider_event_type like '%participant_left'
            and departed.provider_occurrence_at >=
              joined.provider_occurrence_at
        )
      order by joined.provider_occurrence_at, joined.ingest_sequence
      limit 1;
      next_removed_at := null;
    else
      select joined.participant_uuid,
        (
          select min(departed.provider_occurrence_at)
          from public.zoom_participant_events departed
          where departed.live_session_id = target_session
            and departed.customer_key = lease_row.provider_customer_key
            and departed.participant_uuid = joined.participant_uuid
            and departed.provider_event_type like '%participant_left'
            and departed.provider_occurrence_at >=
              joined.provider_occurrence_at
        )
      into next_participant_uuid, next_removed_at
      from public.zoom_participant_events joined
      where joined.live_session_id = target_session
        and joined.customer_key = lease_row.provider_customer_key
        and joined.provider_event_type like '%participant_joined'
        and joined.participant_uuid is not null
      order by joined.provider_occurrence_at desc,
        joined.ingest_sequence desc
      limit 1;
    end if;
    update public.live_join_leases
    set zoom_participant_uuid = next_participant_uuid,
        old_participant_removed_at = next_removed_at,
        duplicate_anomaly_at = null
    where id = lease_row.id;
  elsif request_row.resolution_kind = 'accept_provider_evidence'
        and lease_row.duplicate_anomaly_at is not null
  then
    update public.live_join_leases
    set duplicate_anomaly_at = null
    where id = lease_row.id;
  elsif lease_row.duplicate_anomaly_at is not null then
    update public.live_join_leases
    set duplicate_anomaly_at = null,
        active = false,
        abort_reason = 'provider_anomaly_permanently_disqualified'
    where id = lease_row.id;
  end if;
  insert into public.live_evidence_events (
    live_session_id, event_type, occurred_at, actor_id, evidence
  ) values (
    target_session, 'provider_anomaly', now(), actor,
    jsonb_build_object(
      'reason', 'dual_control_resolution',
      'resolutionRequestId', target_request,
      'resolutionKind', request_row.resolution_kind,
      'decision', 'approve',
      'proposedBy', request_row.proposed_by,
      'approvedBy', actor
    )
  );
  update public.live_sessions session
  set status = 'ended'
  where session.id = target_session
    and session.status = 'reconciling'
    and exists (
      select 1
      from public.live_evidence_events evidence
      where evidence.live_session_id = session.id
        and evidence.event_type = 'actual_ended'
    )
    and not exists (
      select 1
      from public.live_bookings booking
      join public.live_join_leases lease
        on lease.live_booking_id = booking.id
      where booking.live_session_id = session.id
        and lease.duplicate_anomaly_at is not null
    );
  select session.evidence_settles_at into settlement_available_at
  from public.live_sessions session
  where session.id = target_session
    and session.status = 'ended'
    and not exists (
      select 1
      from public.live_bookings booking
      join public.live_join_leases lease
        on lease.live_booking_id = booking.id
      where booking.live_session_id = session.id
        and lease.duplicate_anomaly_at is not null
    );
  if settlement_available_at is not null then
    insert into public.durable_jobs (
      job_type, business_key, payload, available_at
    ) values (
      'live_attendance_settle',
      'live-attendance-settle:' || target_session::text,
      jsonb_build_object('liveSessionId', target_session),
      greatest(settlement_available_at, now())
    )
    on conflict (business_key) do update
    set status = 'pending',
        available_at = excluded.available_at,
        attempt_count = 0,
        last_error = null,
        completed_at = null;
  end if;
  perform internal.append_audit_event(
    actor, 'provider_anomaly.resolution_approved',
    'provider_anomaly_resolution_request', target_request::text,
    trim(submitted_reason), null,
    jsonb_build_object(
      'leaseId', lease_row.id,
      'resolutionKind', request_row.resolution_kind
    )
  );
  return case
    when lease_row.duplicate_anomaly_at is null then 'already_resolved'
    when request_row.resolution_kind = 'disqualify_booking'
      then 'booking_disqualified'
    else 'recovered'
  end;
end
$$;
revoke all on function
  internal.decide_provider_anomaly_resolution(uuid, text, text, text)
  from public;

create or replace function public.decide_provider_anomaly_resolution(
  p_resolution_request_id uuid,
  p_decision text,
  p_reason text,
  p_nonce_hash text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.decide_provider_anomaly_resolution(
    p_resolution_request_id, p_decision, p_reason, p_nonce_hash
  )
$$;
revoke all on function public.decide_provider_anomaly_resolution(
  uuid, text, text, text
) from public;

create or replace function internal.publish_course_version(
  target_version uuid,
  review_reason text,
  submitted_nonce_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  version_row public.course_versions%rowtype;
  requirement_row public.course_requirements%rowtype;
  decision_row public.accreditation_decision_revisions%rowtype;
  question_count integer;
  live_allocation_total integer;
  component_count integer;
  visited_count integer;
begin
  perform internal.consume_step_up_grant(
    'course_publish', target_version::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('accreditation_reviewer')
     or length(trim(review_reason)) < 10
  then
    raise exception 'ACCREDITATION_REVIEWER_REQUIRED';
  end if;
  select * into version_row
  from public.course_versions where id = target_version for update;
  if not found or version_row.status <> 'in_review' then
    raise exception 'COURSE_NOT_IN_REVIEW';
  end if;
  if version_row.submitted_by is null or version_row.submitted_by = actor then
    raise exception 'SEPARATE_REVIEWER_REQUIRED';
  end if;
  if version_row.price_twd is null
     or version_row.organization_point_price is null
     or version_row.legal_document_id is null
     or version_row.retention_policy_revision_id is null
     or version_row.minimum_completion_window is null
     or version_row.commerce_close_at is null
  then
    raise exception 'COURSE_PUBLICATION_FIELDS_MISSING';
  end if;
  if not exists (
    select 1 from public.legal_documents legal
    where legal.id = version_row.legal_document_id
      and legal.approved_by_legal
      and legal.effective_at <= now()
      and (legal.superseded_at is null or legal.superseded_at > now())
  ) then
    raise exception 'LEGAL_REVISION_NOT_APPROVED';
  end if;
  if not exists (
    select 1 from public.retention_policy_revisions retention
    where retention.id = version_row.retention_policy_revision_id
      and retention.effective_at <= now()
      and length(trim(retention.legal_basis)) >= 10
  ) then
    raise exception 'RETENTION_POLICY_NOT_EFFECTIVE';
  end if;
  if not internal.setting_is_true('legal_approved')
     or not internal.setting_is_true('finance_configured')
     or not internal.setting_is_true('incident_owner_configured')
     or not exists (
       select 1 from public.operating_setting_revisions setting
       where setting.setting_key = 'bank_account'
         and setting.effective_at <= now()
         and (
           setting.superseded_at is null
           or setting.superseded_at > now()
         )
         and setting.value ->> 'bankName' is not null
         and setting.value ->> 'bankCode' is not null
         and setting.value ->> 'accountName' is not null
         and setting.value ->> 'accountNumber' is not null
         and setting.value ->> 'maskedAccount' is not null
     )
     or not exists (
       select 1 from public.operating_setting_revisions setting
       where setting.setting_key = 'finance_high_value_threshold'
         and setting.effective_at <= now()
         and (
           setting.superseded_at is null
           or setting.superseded_at > now()
         )
         and coalesce((setting.value ->> 'amountTwd')::integer, 0) > 0
         and setting.second_approved_by is not null
     )
  then
    raise exception 'OPERATING_CONFIGURATION_INCOMPLETE';
  end if;
  select coalesce(sum(value::integer), 0) into live_allocation_total
  from jsonb_each_text(version_row.live_refund_allocations);
  if version_row.price_twd <>
       version_row.recorded_refund_allocation_twd + live_allocation_total
  then
    raise exception 'REFUND_ALLOCATIONS_DO_NOT_EQUAL_PRICE';
  end if;
  if (
       version_row.delivery_type = 'recorded'
       and (
         version_row.recorded_refund_allocation_twd <> version_row.price_twd
         or jsonb_object_length(version_row.live_refund_allocations) <> 0
       )
     )
     or (
       version_row.delivery_type = 'live'
       and (
         version_row.recorded_refund_allocation_twd <> 0
         or jsonb_object_length(version_row.live_refund_allocations) <> 1
         or not (
           version_row.live_refund_allocations
             ? version_row.id::text
         )
       )
     )
     or (
       version_row.delivery_type = 'hybrid'
       and (
         exists (
           select 1
           from public.hybrid_components component
           where component.course_version_id = version_row.id
             and component.component_type = 'live'
             and not (
               version_row.live_refund_allocations
                 ? component.id::text
             )
         )
         or exists (
           select 1
           from jsonb_object_keys(
             version_row.live_refund_allocations
           ) as allocation_keys(allocation_key)
           where not exists (
             select 1
             from public.hybrid_components component
             where component.course_version_id = version_row.id
               and component.component_type = 'live'
               and component.id::text = allocation_key
           )
         )
       )
     )
  then
    raise exception 'REFUND_ALLOCATION_SCOPE_INVALID';
  end if;

  select * into requirement_row
  from public.course_requirements
  where course_version_id = target_version;
  if not found
     or (version_row.delivery_type in ('recorded', 'hybrid')
       and requirement_row.required_watch_seconds <= 0)
     or requirement_row.live_presence_percent is null
       and version_row.delivery_type in ('live', 'hybrid')
     or requirement_row.live_camera_percent is null
       and version_row.delivery_type in ('live', 'hybrid')
  then
    raise exception 'COMPLETION_REQUIREMENTS_MISSING';
  end if;

  select count(*) into question_count
  from public.question_banks bank
  join public.question_versions question
    on question.question_bank_id = bank.id and question.active
  where bank.course_version_id = target_version;
  if question_count < 20 then raise exception 'QUESTION_BANK_TOO_SMALL'; end if;
  if not exists (
    select 1
    from public.course_instructors course_instructor
    join public.instructors instructor
      on instructor.id = course_instructor.instructor_id
    where course_instructor.course_version_id = target_version
      and instructor.active
      and length(trim(instructor.display_name)) >= 2
      and length(trim(instructor.credentials)) >= 5
  ) then
    raise exception 'ACTIVE_QUALIFIED_INSTRUCTOR_REQUIRED';
  end if;
  if exists (
    select 1 from public.course_materials material
    where material.course_version_id = target_version
      and (
        material.scan_status <> 'safe'
        or material.promoted_object_path is null
      )
  ) then
    raise exception 'COURSE_MATERIAL_NOT_SAFE';
  end if;
  if version_row.delivery_type in ('recorded', 'hybrid')
     and version_row.title not like '%網路課程%'
  then
    raise exception 'RECORDED_TITLE_REQUIREMENT';
  end if;
  if version_row.delivery_type in ('recorded', 'hybrid')
     and exists (
       select 1
       from public.modules module
       join public.lessons lesson on lesson.module_id = module.id
       left join public.lesson_video_versions lvv
         on lvv.lesson_id = lesson.id and lvv.active
       left join public.video_assets asset
         on asset.id = lvv.video_asset_id
       where module.course_version_id = target_version
         and lesson.content_type = 'video'
         and (
           asset.id is null or asset.status <> 'ready'
           or not asset.require_signed_urls
           or asset.master_backup_reference is null
         )
     )
  then
    raise exception 'VIDEO_NOT_READY_OR_BACKED_UP';
  end if;

  select decision.* into decision_row
  from public.course_version_accreditation link
  join public.accreditation_decision_revisions decision
    on decision.id = link.accreditation_revision_id
  where link.course_version_id = target_version
  order by decision.revision desc limit 1;
  if not found
     or decision_row.course_id <> version_row.course_id
     or decision_row.status not in ('applying', 'approved')
     or decision_row.valid_from is null
     or decision_row.valid_until is null
     or (
       decision_row.status = 'applying'
       and coalesce(trim(decision_row.application_reference), '') = ''
     )
     or (
       decision_row.status = 'approved'
       and (
         coalesce(trim(decision_row.approval_reference), '') = ''
         or decision_row.points is null
       )
     )
     or version_row.commerce_close_at >
       decision_row.valid_until - version_row.minimum_completion_window
  then
    raise exception 'ACCREDITATION_WINDOW_INVALID';
  end if;
  if not exists (
    select 1
    from public.organizing_bodies organizer
    join public.accreditation_authorities authority
      on authority.id = decision_row.authority_id
    where organizer.id = decision_row.organizing_body_id
      and organizer.active
      and authority.active
      and organizer.qualification_valid_from
        <= decision_row.valid_from::date
      and (
        organizer.qualification_valid_until is null
        or organizer.qualification_valid_until
          >= decision_row.valid_until::date
      )
      and length(trim(organizer.qualification_reference)) >= 3
      and length(trim(organizer.contact_name)) >= 2
      and length(trim(organizer.contact_email)) >= 3
      and length(trim(authority.submission_method)) >= 3
      and length(trim(authority.contact_name)) >= 2
      and length(trim(authority.contact_email)) >= 3
  ) then
    raise exception 'ACCREDITATION_PARTIES_NOT_QUALIFIED';
  end if;
  if not exists (
    select 1 from public.provider_health health
    where health.provider in ('managed_kms', 'malware_scanner')
      and health.status = 'healthy'
      and health.production_validated_at is not null
    having count(*) = 2
  ) then
    raise exception 'CORE_PROVIDER_HEALTH_REQUIRED';
  end if;
  if version_row.delivery_type in ('recorded', 'hybrid')
     and not exists (
       select 1 from public.provider_health health
       where health.provider = 'cloudflare_stream'
         and health.status = 'healthy'
         and health.production_validated_at is not null
     )
  then
    raise exception 'STREAM_PROVIDER_HEALTH_REQUIRED';
  end if;
  if version_row.delivery_type in ('live', 'hybrid')
     and not exists (
       select 1 from public.provider_health health
       where health.provider in ('zoom_oauth', 'zoom_meeting_sdk')
         and health.status = 'healthy'
         and health.production_validated_at is not null
       having count(*) = 2
     )
  then
    raise exception 'ZOOM_PROVIDER_HEALTH_REQUIRED';
  end if;

  if version_row.delivery_type in ('live', 'hybrid') and exists (
    select 1
    from public.live_sessions session
    where session.course_version_id = target_version
      and (
        session.title not like '%線上同步課程%'
        or session.starts_at < decision_row.valid_from
        or session.ends_at > decision_row.valid_until
        or session.booking_close_at >= session.starts_at
        or session.status <> 'scheduled'
        or session.locked_break_seconds <> coalesce((
          select sum(extract(epoch from
            (formal_break.ends_at - formal_break.starts_at)
          ))::integer
          from public.live_breaks formal_break
          where formal_break.live_session_id = session.id
            and formal_break.locked_at is not null
        ), 0)
        or exists (
          select 1
          from public.live_breaks formal_break
          where formal_break.live_session_id = session.id
            and (
              formal_break.locked_at is null
              or formal_break.starts_at < session.starts_at
              or formal_break.ends_at > session.ends_at
            )
        )
        or (
          select count(*) from public.live_session_assistants assistant
          where assistant.live_session_id = session.id
            and assistant.role in ('assistant', 'cohost')
        ) < internal.required_live_assistants(session.learner_capacity)
        or session.learner_capacity
          > session.verified_zoom_total_capacity
            - session.host_seats - session.cohost_seats
            - session.reserved_support_seats
            - internal.required_live_assistants(session.learner_capacity)
      )
  ) then
    raise exception 'LIVE_SESSION_PUBLICATION_INVALID';
  end if;
  if version_row.delivery_type in ('live', 'hybrid') and (
    not exists (
      select 1 from public.live_sessions session
      where session.course_version_id = target_version
        and session.status = 'scheduled'
    )
    or exists (
      select 1 from public.live_sessions session
      where session.course_version_id = target_version
        and session.status = 'scheduled'
        and (
          not exists (
            select 1 from public.zoom_host_reservations reservation
            where reservation.live_session_id = session.id
              and reservation.status = 'confirmed'
          )
          or not exists (
            select 1 from private.zoom_meetings meeting
            where meeting.live_session_id = session.id
              and meeting.meeting_number <> ''
              and meeting.encrypted_passcode <> '{}'::jsonb
          )
        )
    )
    or (
      version_row.delivery_type = 'hybrid'
      and exists (
        select 1 from public.hybrid_components component
        where component.course_version_id = target_version
          and component.required and component.component_type = 'live'
          and not exists (
            select 1 from public.live_sessions session
            where session.hybrid_component_id = component.id
              and session.status = 'scheduled'
          )
      )
    )
  ) then
    raise exception 'SCHEDULED_LIVE_SESSION_REQUIRED';
  end if;

  if version_row.delivery_type = 'hybrid' then
    select count(*) into component_count
    from public.hybrid_components
    where course_version_id = target_version;
    if component_count < 2 or not exists (
      select 1 from public.hybrid_components
      where course_version_id = target_version and required
        and component_type = 'recorded'
    ) or not exists (
      select 1 from public.hybrid_components
      where course_version_id = target_version and required
        and component_type = 'live'
    ) then
      raise exception 'HYBRID_REQUIRED_COMPONENTS_MISSING';
    end if;
    if exists (
      select 1
      from public.component_prerequisites edge
      join public.hybrid_components source
        on source.id = edge.prerequisite_component_id
      join public.hybrid_components target
        on target.id = edge.dependent_component_id
      where edge.course_version_id = target_version
        and (
          source.course_version_id <> target_version
          or target.course_version_id <> target_version
        )
    ) then
      raise exception 'HYBRID_CROSS_VERSION_EDGE';
    end if;
    with recursive walk(id, path, cycle) as (
      select component.id, array[component.id], false
      from public.hybrid_components component
      where component.course_version_id = target_version
        and not exists (
          select 1 from public.component_prerequisites edge
          where edge.course_version_id = target_version
            and edge.dependent_component_id = component.id
        )
      union all
      select edge.dependent_component_id,
        walk.path || edge.dependent_component_id,
        edge.dependent_component_id = any(walk.path)
      from walk
      join public.component_prerequisites edge
        on edge.prerequisite_component_id = walk.id
        and edge.course_version_id = target_version
      where not walk.cycle
    )
    select count(distinct id) into visited_count from walk where not cycle;
    if visited_count <> component_count then
      raise exception 'HYBRID_GRAPH_CYCLE_OR_UNREACHABLE';
    end if;
  end if;

  update public.course_versions
    set status = 'published', published_by = actor, published_at = now()
    where id = target_version;
  update public.course_requirements set locked_at = now()
    where course_version_id = target_version;
  update public.question_banks set locked_at = now()
    where course_version_id = target_version;
  update public.survey_forms set locked_at = now()
    where course_version_id = target_version;
  insert into public.course_publication_reviews (
    course_version_id, submitted_by, reviewed_by, status,
    checklist, reason, reviewed_at
  ) values (
    target_version, version_row.submitted_by, actor, 'approved',
    jsonb_build_object(
      'questionCount', question_count,
      'accreditationRevision', decision_row.id,
      'legalDocument', version_row.legal_document_id,
      'retentionPolicy', version_row.retention_policy_revision_id
    ),
    review_reason, now()
  );
  perform internal.append_audit_event(
    actor, 'course.published', 'course_version', target_version::text,
    review_reason, null, '{}'::jsonb
  );
  return true;
end
$$;
revoke all on function internal.publish_course_version(uuid, text, text)
  from public;

create or replace function public.publish_course_version(
  p_course_version_id uuid,
  p_reason text,
  p_nonce_hash text
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.publish_course_version(
    p_course_version_id, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.finalize_order_payment(target_order uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  order_row public.orders%rowtype;
  paid_total integer;
  item_row public.order_items%rowtype;
  decision_status text;
  entitlement_status text;
  entitlement_id uuid;
  new_enrollment_id uuid;
begin
  select * into order_row from public.orders
    where id = target_order for update;
  select coalesce(sum(
    case when allocation_kind = 'allocation' then amount_twd else -amount_twd end
  ), 0) into paid_total
  from public.bank_transaction_allocations
  where order_id = target_order;
  if paid_total <> order_row.amount_due_twd then
    update public.orders
      set status = 'payment_review', amount_paid_twd = paid_total
      where id = target_order;
    return 'payment_review';
  end if;
  select * into item_row from public.order_items
    where order_id = target_order limit 1;
  select decision.status into decision_status
  from public.course_version_accreditation link
  join public.accreditation_decision_revisions decision
    on decision.id = link.accreditation_revision_id
  where link.course_version_id = item_row.course_version_id
  order by decision.revision desc limit 1;
  entitlement_status := case
    when decision_status = 'approved' then 'active'
    else 'locked'
  end;

  if exists (
    select 1 from public.live_bookings booking
    where booking.payer_type = 'b2c'
      and booking.payer_source_id = order_row.id
      and (
        booking.status <> 'held'
        or booking.hold_expires_at < now()
      )
  ) then
    update public.live_bookings
    set status = 'released'
    where payer_type = 'b2c'
      and payer_source_id = order_row.id
      and status = 'held';
    update public.orders
      set status = 'paid_unfulfilled', amount_paid_twd = paid_total,
          paid_at = now()
      where id = order_row.id;
    insert into public.payment_events (
      order_id, event_type, amount_twd, actor_id, event_data
    ) values (
      order_row.id, 'payment_confirmed', paid_total,
      internal.current_person_id(),
      jsonb_build_object(
        'fulfillmentStatus', 'paid_unfulfilled',
        'reason', 'live_hold_expired_or_released'
      )
    );
    insert into public.invoice_records (order_id, amount_twd)
    values (order_row.id, paid_total)
    on conflict do nothing;
    insert into public.reconciliation_cases (
      kind, order_id, status, reason
    ) values (
      'capacity_unavailable', order_row.id, 'open',
      'payment confirmed after live hold was unavailable'
    );
    insert into public.notifications (
      person_id, category, title, body, business_key
    ) values (
      order_row.person_id, 'payment', '匯款已確認，待安排履約',
      '已確認實際入帳，但原直播保留位已失效。請選擇合適場次或申請全額退款。',
      'order-paid-unfulfilled:' || order_row.id::text
    ) on conflict (person_id, business_key) do nothing;
    return 'paid_unfulfilled';
  end if;

  insert into public.entitlements (
    person_id, course_version_id, source_type, source_id,
    status, locked_reason, starts_at
  ) values (
    order_row.person_id, item_row.course_version_id, 'b2c_order',
    order_row.id, entitlement_status,
    case when entitlement_status = 'locked'
      then 'accreditation_not_yet_approved' end,
    case when entitlement_status = 'active' then now() end
  )
  on conflict (person_id, course_version_id, source_type, source_id)
  do update set status = excluded.status
  returning id into entitlement_id;
  insert into public.enrollments (
    person_id, course_version_id, entitlement_id
  ) values (
    order_row.person_id, item_row.course_version_id, entitlement_id
  ) on conflict (entitlement_id) do update
    set person_id = excluded.person_id
  returning id into new_enrollment_id;
  update public.live_bookings
    set status = 'confirmed',
        hold_expires_at = null,
        enrollment_id = new_enrollment_id
    where payer_type = 'b2c'
      and payer_source_id = order_row.id
      and status = 'held';
  update public.orders
    set status = 'paid', amount_paid_twd = paid_total, paid_at = now()
    where id = order_row.id;
  insert into public.payment_events (
    order_id, event_type, amount_twd, actor_id, event_data
  ) values (
    order_row.id, 'payment_confirmed', paid_total,
    internal.current_person_id(),
    jsonb_build_object('entitlementStatus', entitlement_status)
  );
  insert into public.invoice_records (
    order_id, amount_twd
  ) values (
    order_row.id, paid_total
  ) on conflict do nothing;
  insert into public.notifications (
    person_id, category, title, body, business_key
  ) values (
    order_row.person_id, 'payment', '匯款已確認',
    case when entitlement_status = 'active'
      then '已確認實際入帳，課程已開通。'
      else '已確認實際入帳；積分核准前課程仍保持鎖定。'
    end,
    'order-paid:' || order_row.id::text
  ) on conflict (person_id, business_key) do nothing;
  insert into public.notification_outbox (
    notification_id, channel, destination_ciphertext,
    template_key, template_data, business_idempotency_key
  )
  select
    notification.id, channel.name, '{}'::jsonb, 'payment_confirmed',
    jsonb_build_object('orderId', order_row.id),
    'order-paid:' || channel.name || ':' || order_row.id::text
  from public.notifications notification
  cross join (values ('sms'), ('email')) as channel(name)
  where notification.person_id = order_row.person_id
    and notification.business_key = 'order-paid:' || order_row.id::text
    and (
      channel.name = 'sms'
      or exists (
        select 1 from public.people person
        where person.id = order_row.person_id
          and person.email_verified_at is not null
      )
    )
  on conflict (business_idempotency_key) do nothing;
  return 'paid';
end
$$;
revoke all on function internal.finalize_order_payment(uuid) from public;

create or replace function internal.allocate_bank_transaction(
  target_transaction uuid,
  target_order uuid,
  allocated_amount integer,
  allocation_reason text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  order_row public.orders%rowtype;
  threshold integer;
  requires_second boolean;
  allocation_id uuid;
  final_status text := 'payment_review';
begin
  if not internal.has_staff_role('finance') then
    raise exception 'FINANCE_ROLE_REQUIRED';
  end if;
  select (setting.value ->> 'amountTwd')::integer into threshold
  from public.operating_setting_revisions setting
  where setting.setting_key = 'finance_high_value_threshold'
    and setting.effective_at <= now()
    and (setting.superseded_at is null or setting.superseded_at > now())
  order by setting.revision desc limit 1;
  if threshold is null then raise exception 'FINANCE_THRESHOLD_MISSING'; end if;

  perform 1
  from public.bank_transactions transaction_row
  join public.bank_import_batches batch
    on batch.id = transaction_row.batch_id
  where transaction_row.id = target_transaction
    and batch.reconciled_at is not null
  for update of transaction_row;
  if not found then raise exception 'BANK_TRANSACTION_NOT_FOUND'; end if;
  select * into order_row from public.orders
    where id = target_order for update;
  if not found or order_row.status not in (
    'proof_submitted', 'payment_review', 'pending_transfer', 'expired'
  ) then
    raise exception 'ORDER_NOT_ALLOCATABLE';
  end if;
  requires_second := order_row.amount_due_twd >= threshold
    or coalesce((order_row.price_snapshot ->> 'relatedParty')::boolean, false);
  insert into public.bank_transaction_allocations (
    bank_transaction_id, order_id, allocation_kind, amount_twd,
    allocated_by, idempotency_key, reason
  ) values (
    target_transaction, target_order, 'allocation', allocated_amount,
    actor, idempotency, allocation_reason
  )
  returning id into allocation_id;

  if not requires_second then
    final_status := internal.finalize_order_payment(target_order);
  else
    update public.orders set status = 'payment_review'
      where id = target_order;
  end if;
  perform internal.append_audit_event(
    actor, 'bank_transaction.allocated', 'order', target_order::text,
    allocation_reason, null,
    jsonb_build_object(
      'allocationId', allocation_id,
      'amountTwd', allocated_amount,
      'requiresSecondReview', requires_second
    )
  );
  return jsonb_build_object(
    'allocationId', allocation_id,
    'status', final_status,
    'requiresSecondReview', requires_second
  );
end
$$;
revoke all on function internal.allocate_bank_transaction(
  uuid, uuid, integer, text, uuid
) from public;

create or replace function public.allocate_bank_transaction(
  p_bank_transaction_id uuid,
  p_order_id uuid,
  p_amount_twd integer,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.allocate_bank_transaction(
    p_bank_transaction_id, p_order_id, p_amount_twd,
    p_reason, p_idempotency_key
  )
$$;

create table public.bank_allocation_reviews (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null unique
    references public.bank_transaction_allocations(id),
  reviewer_id uuid not null references public.people(id),
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.bank_allocation_reviews enable row level security;
alter table public.bank_allocation_reviews force row level security;
revoke all on table public.bank_allocation_reviews
  from public, anon, authenticated;
create trigger bank_allocation_reviews_append_only
before update or delete on public.bank_allocation_reviews
for each row execute function internal.prevent_append_only_change();

create or replace function internal.confirm_bank_allocation(
  target_allocation uuid,
  review_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  allocation_row public.bank_transaction_allocations%rowtype;
  final_status text;
begin
  if not internal.has_staff_role('finance') then
    raise exception 'FINANCE_ROLE_REQUIRED';
  end if;
  select * into allocation_row
  from public.bank_transaction_allocations
  where id = target_allocation for update;
  if not found
     or allocation_row.allocated_by = actor
     or exists (
       select 1 from public.bank_allocation_reviews review
       where review.allocation_id = target_allocation
     )
  then
    raise exception 'DISTINCT_SECOND_REVIEW_REQUIRED';
  end if;
  insert into public.bank_allocation_reviews (
    allocation_id, reviewer_id, reason
  ) values (
    target_allocation, actor, review_reason
  );
  final_status := internal.finalize_order_payment(allocation_row.order_id);
  perform internal.append_audit_event(
    actor, 'bank_allocation.second_confirmed', 'allocation',
    target_allocation::text, review_reason, null, '{}'::jsonb
  );
  return jsonb_build_object('status', final_status);
end
$$;
revoke all on function internal.confirm_bank_allocation(uuid, text)
  from public;

create or replace function public.confirm_bank_allocation(
  p_allocation_id uuid,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.confirm_bank_allocation(p_allocation_id, p_reason)
$$;

create or replace function internal.assign_organization_course(
  target_organization uuid,
  target_member uuid,
  target_course_version uuid,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  version_row public.course_versions%rowtype;
  wallet_row public.organization_wallets%rowtype;
  assignment_id uuid;
  entitlement_id uuid;
  required_points integer;
  remaining_points integer;
  lot record;
  allocated integer;
  decision_status text;
begin
  if not internal.feature_is_open('organization_assignment') then
    raise exception 'ORGANIZATION_ASSIGNMENT_CLOSED';
  end if;
  if not internal.has_organization_role(
    target_organization, array['owner', 'training_manager']
  ) then
    raise exception 'ORGANIZATION_MANAGER_REQUIRED';
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = target_organization
      and membership.person_id = target_member
      and membership.active
  ) then
    raise exception 'ORGANIZATION_MEMBER_REQUIRED';
  end if;
  select * into version_row from public.course_versions
  where id = target_course_version
    and status = 'published'
    and commerce_close_at > now()
  for share;
  if not found or version_row.organization_point_price is null then
    raise exception 'COURSE_NOT_ASSIGNABLE';
  end if;
  required_points := version_row.organization_point_price;
  select * into wallet_row from public.organization_wallets
  where organization_id = target_organization for update;
  if not found or wallet_row.available_points < required_points then
    raise exception 'INSUFFICIENT_POINTS';
  end if;

  insert into public.organization_assignments (
    organization_id, member_person_id, course_version_id,
    assigned_by, point_price_snapshot, idempotency_key
  ) values (
    target_organization, target_member, target_course_version,
    actor, required_points, idempotency
  ) returning id into assignment_id;

  remaining_points := required_points;
  for lot in
    select *
    from public.point_lots
    where organization_id = target_organization
      and available_points > 0
    order by purchased_at, id
    for update
  loop
    allocated := least(remaining_points, lot.available_points);
    insert into public.assignment_point_allocations (
      assignment_id, point_lot_id, points
    ) values (assignment_id, lot.id, allocated);
    update public.point_lots
      set available_points = available_points - allocated,
          reserved_points = reserved_points + allocated
      where id = lot.id;
    insert into public.point_ledger_events (
      organization_id, point_lot_id, event_type, points,
      assignment_id, actor_id, idempotency_key, reason
    ) values (
      target_organization, lot.id, 'reserved', allocated,
      assignment_id, actor, gen_random_uuid(), 'course assignment'
    );
    remaining_points := remaining_points - allocated;
    exit when remaining_points = 0;
  end loop;
  if remaining_points <> 0 then raise exception 'POINT_LEDGER_DRIFT'; end if;
  update public.organization_wallets
    set available_points = available_points - required_points,
        reserved_points = reserved_points + required_points,
        ledger_version = ledger_version + 1,
        updated_at = now()
    where organization_id = target_organization;

  select decision.status into decision_status
  from public.course_version_accreditation link
  join public.accreditation_decision_revisions decision
    on decision.id = link.accreditation_revision_id
  where link.course_version_id = target_course_version
  order by decision.revision desc limit 1;
  insert into public.entitlements (
    person_id, course_version_id, source_type, source_id,
    status, locked_reason, starts_at
  ) values (
    target_member, target_course_version, 'organization_assignment',
    assignment_id,
    case when decision_status = 'approved' then 'active' else 'locked' end,
    case when decision_status <> 'approved'
      then 'accreditation_not_yet_approved' end,
    case when decision_status = 'approved' then now() end
  ) returning id into entitlement_id;
  insert into public.enrollments (
    person_id, course_version_id, entitlement_id
  ) values (
    target_member, target_course_version, entitlement_id
  );
  perform internal.append_audit_event(
    actor, 'organization.assignment_reserved', 'organization_assignment',
    assignment_id::text, 'oldest point lots reserved',
    target_organization, jsonb_build_object('points', required_points)
  );
  return jsonb_build_object(
    'assignmentId', assignment_id,
    'reservedPoints', required_points
  );
end
$$;
revoke all on function internal.assign_organization_course(
  uuid, uuid, uuid, uuid
) from public;

create or replace function public.assign_organization_course(
  p_organization_id uuid,
  p_member_person_id uuid,
  p_course_version_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.assign_organization_course(
    p_organization_id, p_member_person_id,
    p_course_version_id, p_idempotency_key
  )
$$;

create or replace function internal.consume_organization_assignment_for_enrollment(
  target_enrollment uuid,
  consumption_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  assignment_row public.organization_assignments%rowtype;
  allocation record;
  actor uuid;
begin
  if target_enrollment is null then return false; end if;
  select assignment.* into assignment_row
  from public.enrollments enrollment
  join public.entitlements entitlement on entitlement.id = enrollment.entitlement_id
  join public.organization_assignments assignment
    on assignment.id = entitlement.source_id
  where enrollment.id = target_enrollment
    and entitlement.source_type = 'organization_assignment'
  for update of assignment;
  if not found or assignment_row.status <> 'reserved' then return false; end if;
  actor := assignment_row.member_person_id;
  perform 1 from public.organization_wallets
    where organization_id = assignment_row.organization_id for update;
  for allocation in
    select * from public.assignment_point_allocations
    where assignment_id = assignment_row.id
    order by point_lot_id
    for update
  loop
    update public.point_lots
      set reserved_points = reserved_points - allocation.points,
          consumed_points = consumed_points + allocation.points
      where id = allocation.point_lot_id;
    update public.assignment_point_allocations
      set status = 'consumed'
      where id = allocation.id and status = 'reserved';
    insert into public.point_ledger_events (
      organization_id, point_lot_id, event_type, points,
      assignment_id, actor_id, idempotency_key, reason
    ) values (
      assignment_row.organization_id, allocation.point_lot_id,
      'consumed', allocation.points, assignment_row.id,
      actor, gen_random_uuid(), consumption_reason
    );
  end loop;
  update public.organization_wallets
    set reserved_points =
          reserved_points - assignment_row.point_price_snapshot,
        consumed_points =
          consumed_points + assignment_row.point_price_snapshot,
        ledger_version = ledger_version + 1,
        updated_at = now()
    where organization_id = assignment_row.organization_id;
  update public.organization_assignments
    set status = 'consumed', consumed_at = now()
    where id = assignment_row.id;
  return true;
end
$$;
revoke all on function internal.consume_organization_assignment_for_enrollment(
  uuid, text
) from public;

create or replace function internal.select_assignment_live_session(
  target_assignment uuid,
  target_session uuid,
  target_component uuid,
  idempotency uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  assignment_row public.organization_assignments%rowtype;
  session_row public.live_sessions%rowtype;
  target_enrollment uuid;
  booking_id uuid;
  booking_count integer;
begin
  select * into assignment_row
  from public.organization_assignments
  where id = target_assignment for update;
  if not found
     or assignment_row.status not in ('reserved', 'active')
     or (
       assignment_row.member_person_id <> actor
       and not internal.has_organization_role(
         assignment_row.organization_id,
         array['owner', 'training_manager']
       )
     )
  then raise exception 'ASSIGNMENT_SESSION_SELECTION_REJECTED'; end if;
  select * into session_row from public.live_sessions
  where id = target_session
    and course_version_id = assignment_row.course_version_id
    and status in ('scheduled', 'open')
    and booking_close_at > now()
    and internal.business_days_between(now(), starts_at) >= 3
  for update;
  if not found then raise exception 'LIVE_SESSION_NOT_BOOKABLE'; end if;
  if target_component is not null and not exists (
    select 1 from public.hybrid_components component
    where component.id = target_component
      and component.course_version_id = assignment_row.course_version_id
      and component.component_type = 'live'
      and session_row.hybrid_component_id = component.id
  ) then raise exception 'ASSIGNMENT_COMPONENT_MISMATCH'; end if;
  perform internal.release_expired_live_holds(target_session, 1000);
  select count(*) into booking_count from public.live_bookings
  where live_session_id = target_session
    and (
      status in ('confirmed', 'attended')
      or (status = 'held' and hold_expires_at > clock_timestamp())
    );
  if booking_count >= session_row.learner_capacity then
    raise exception 'LIVE_SESSION_FULL';
  end if;
  select enrollment.id into target_enrollment
  from public.enrollments enrollment
  join public.entitlements entitlement
    on entitlement.id = enrollment.entitlement_id
  where entitlement.source_type = 'organization_assignment'
    and entitlement.source_id = target_assignment;
  insert into public.live_bookings (
    person_id, enrollment_id, course_version_id, live_component_id,
    live_session_id, payer_type, payer_source_id, status,
    customer_key, change_locked_at, idempotency_key
  ) values (
    assignment_row.member_person_id, target_enrollment,
    assignment_row.course_version_id, target_component,
    target_session, 'organization', target_assignment, 'confirmed',
    rtrim(
      translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_'),
      '='
    ),
    session_row.starts_at - interval '24 hours', idempotency
  ) returning id into booking_id;
  update public.organization_assignments set status = 'active'
    where id = target_assignment and status = 'reserved';
  perform internal.append_audit_event(
    actor, 'organization.assignment_session_selected', 'live_booking',
    booking_id::text, 'organization assignment booked live session',
    assignment_row.organization_id,
    jsonb_build_object('liveSessionId', target_session)
  );
  return booking_id;
end
$$;
revoke all on function internal.select_assignment_live_session(
  uuid, uuid, uuid, uuid
) from public;

create or replace function public.select_assignment_live_session(
  p_assignment_id uuid,
  p_live_session_id uuid,
  p_live_component_id uuid,
  p_idempotency_key uuid
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.select_assignment_live_session(
    p_assignment_id, p_live_session_id,
    p_live_component_id, p_idempotency_key
  )
$$;

create or replace function internal.change_assignment_live_session(
  target_booking uuid,
  replacement_session uuid,
  idempotency uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  booking_row public.live_bookings%rowtype;
  replacement public.live_sessions%rowtype;
  booking_count integer;
begin
  select * into booking_row from public.live_bookings
  where id = target_booking for update;
  if not found
     or booking_row.payer_type <> 'organization'
     or booking_row.status <> 'confirmed'
     or now() >= booking_row.change_locked_at
     or exists (
       select 1 from public.live_join_leases lease
       where lease.live_booking_id = target_booking
     )
     or (
       booking_row.person_id <> actor
       and not exists (
         select 1 from public.organization_assignments assignment
         where assignment.id = booking_row.payer_source_id
           and internal.has_organization_role(
             assignment.organization_id,
             array['owner', 'training_manager']
           )
       )
     )
  then raise exception 'LIVE_SESSION_CHANGE_LOCKED'; end if;
  select * into replacement from public.live_sessions
  where id = replacement_session
    and course_version_id = booking_row.course_version_id
    and hybrid_component_id is not distinct from
      booking_row.live_component_id
    and status in ('scheduled', 'open')
    and booking_close_at > now()
    and starts_at > now() + interval '24 hours'
  for update;
  if not found then raise exception 'REPLACEMENT_SESSION_INVALID'; end if;
  perform internal.release_expired_live_holds(replacement_session, 1000);
  select count(*) into booking_count from public.live_bookings
  where live_session_id = replacement_session
    and (
      status in ('confirmed', 'attended')
      or (status = 'held' and hold_expires_at > clock_timestamp())
    );
  if booking_count >= replacement.learner_capacity then
    raise exception 'REPLACEMENT_SESSION_FULL';
  end if;
  update public.live_bookings
  set live_session_id = replacement_session,
      change_locked_at = replacement.starts_at - interval '24 hours',
      idempotency_key = idempotency
  where id = target_booking;
  perform internal.append_audit_event(
    actor, 'organization.assignment_session_changed', 'live_booking',
    target_booking::text, 'changed before 24-hour cutoff', null,
    jsonb_build_object('replacementSessionId', replacement_session)
  );
  return true;
end
$$;
revoke all on function internal.change_assignment_live_session(
  uuid, uuid, uuid
) from public;

create or replace function public.change_assignment_live_session(
  p_live_booking_id uuid,
  p_replacement_session_id uuid,
  p_idempotency_key uuid
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.change_assignment_live_session(
    p_live_booking_id, p_replacement_session_id, p_idempotency_key
  )
$$;

create or replace function internal.release_organization_assignment(
  target_assignment uuid,
  submitted_reason text,
  idempotency uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  assignment_row public.organization_assignments%rowtype;
  allocation public.assignment_point_allocations%rowtype;
begin
  select * into assignment_row from public.organization_assignments
  where id = target_assignment for update;
  if not found
     or assignment_row.status not in ('reserved', 'active')
     or length(trim(submitted_reason)) < 10
     or not internal.has_organization_role(
       assignment_row.organization_id,
       array['owner', 'training_manager']
     )
     or exists (
       select 1 from public.live_bookings booking
       join public.live_sessions session
         on session.id = booking.live_session_id
       where booking.payer_type = 'organization'
         and booking.payer_source_id = target_assignment
         and (
           session.starts_at <= now() + interval '24 hours'
           or booking.status = 'attended'
         )
     )
     or exists (
       select 1 from public.progress_summaries summary
       join public.enrollments enrollment
         on enrollment.id = summary.enrollment_id
       join public.entitlements entitlement
         on entitlement.id = enrollment.entitlement_id
       where entitlement.source_type = 'organization_assignment'
         and entitlement.source_id = target_assignment
         and (
           summary.candidate_seconds > 0
           or summary.confirmed_valid_seconds > 0
         )
     )
  then raise exception 'ASSIGNMENT_RELEASE_NOT_ALLOWED'; end if;
  perform 1 from public.organization_wallets
  where organization_id = assignment_row.organization_id for update;
  for allocation in
    select * from public.assignment_point_allocations
    where assignment_id = target_assignment and status = 'reserved'
    order by point_lot_id for update
  loop
    update public.point_lots
    set reserved_points = reserved_points - allocation.points,
        available_points = available_points + allocation.points
    where id = allocation.point_lot_id;
    update public.assignment_point_allocations
    set status = 'released' where id = allocation.id;
    insert into public.point_ledger_events (
      organization_id, point_lot_id, event_type, points,
      assignment_id, actor_id, idempotency_key, reason
    ) values (
      assignment_row.organization_id, allocation.point_lot_id,
      'released', allocation.points, target_assignment,
      actor, gen_random_uuid(), trim(submitted_reason)
    );
  end loop;
  update public.organization_wallets
  set reserved_points = reserved_points
        - assignment_row.point_price_snapshot,
      available_points = available_points
        + assignment_row.point_price_snapshot,
      ledger_version = ledger_version + 1, updated_at = now()
  where organization_id = assignment_row.organization_id;
  update public.organization_assignments
  set status = 'released', released_at = now()
  where id = target_assignment;
  update public.entitlements
  set status = 'revoked', locked_reason = 'assignment released'
  where source_type = 'organization_assignment'
    and source_id = target_assignment;
  update public.enrollments enrollment set status = 'revoked'
  from public.entitlements entitlement
  where entitlement.id = enrollment.entitlement_id
    and entitlement.source_type = 'organization_assignment'
    and entitlement.source_id = target_assignment;
  update public.live_bookings set status = 'released'
  where payer_type = 'organization'
    and payer_source_id = target_assignment
    and status in ('held', 'confirmed');
  perform internal.append_audit_event(
    actor, 'organization.assignment_released', 'organization_assignment',
    target_assignment::text, trim(submitted_reason),
    assignment_row.organization_id,
    jsonb_build_object('points', assignment_row.point_price_snapshot)
  );
  return true;
end
$$;
revoke all on function internal.release_organization_assignment(
  uuid, text, uuid
) from public;

create or replace function public.release_organization_assignment(
  p_assignment_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.release_organization_assignment(
    p_assignment_id, p_reason, p_idempotency_key
  )
$$;

create or replace function internal.read_completion_render_context(
  target_enrollment uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  enrollment_row public.enrollments%rowtype;
  version_row public.course_versions%rowtype;
  requirement_row public.course_requirements%rowtype;
  decision_row public.accreditation_decision_revisions%rowtype;
  authority_name text;
  authoritative_at timestamptz;
  recorded_met boolean;
  live_met boolean;
  refund_clear boolean;
  recompute_result jsonb;
begin
  if auth.role() <> 'service_role'
     or not internal.feature_is_open('certificate_issue')
  then
    raise exception 'COMPLETION_PREFLIGHT_CLOSED';
  end if;
  select * into enrollment_row from public.enrollments
  where id = target_enrollment and status = 'active';
  if not found then raise exception 'ENROLLMENT_NOT_COMPLETABLE'; end if;
  select * into version_row from public.course_versions
  where id = enrollment_row.course_version_id;
  select * into requirement_row from public.course_requirements
  where course_version_id = version_row.id;
  select decision.* into decision_row
  from public.course_version_accreditation link
  join public.accreditation_decision_revisions decision
    on decision.id = link.accreditation_revision_id
  where link.course_version_id = version_row.id
  order by decision.revision desc limit 1;
  select authority.name into authority_name
  from public.accreditation_authorities authority
  where authority.id = decision_row.authority_id;

  if version_row.delivery_type in ('recorded', 'hybrid') then
    recompute_result :=
      internal.recompute_recorded_progress_unchecked(enrollment_row.id);
    if not coalesce((recompute_result ->> 'valid')::boolean, false) then
      -- Return a typed non-renderable result instead of raising: the service
      -- worker will fail closed, while this transaction can commit the
      -- zeroed derived summary and drift marker for operations to inspect.
      return jsonb_build_object(
        'eligible', false,
        'reason', 'recorded_progress_evidence_invalid',
        'progressRecompute', recompute_result
      );
    elsif coalesce(
      (recompute_result ->> 'driftDetected')::boolean, true
    ) then
      -- A first pass that repairs otherwise valid drift is intentionally not
      -- renderable. A later retry must recompute cleanly before it can issue.
      return jsonb_build_object(
        'eligible', false,
        'reason', 'recorded_progress_drift_recomputed',
        'progressRecompute', recompute_result
      );
    end if;
  end if;
  recorded_met := version_row.delivery_type = 'live'
    or coalesce((
      select summary.confirmed_valid_seconds
      from public.progress_summaries summary
      where summary.enrollment_id = enrollment_row.id
    ), 0) >= requirement_row.required_watch_seconds;
  live_met := version_row.delivery_type = 'recorded'
    or (
      not exists (
        select 1
        from public.hybrid_components component
        where component.course_version_id = version_row.id
          and component.required
          and component.component_type = 'live'
          and not exists (
            select 1
            from public.live_bookings booking
            join public.live_sessions session
              on session.id = booking.live_session_id
            join public.attendance_summaries attendance
              on attendance.live_booking_id = booking.id
            where booking.enrollment_id = enrollment_row.id
              and booking.live_component_id = component.id
              and session.status = 'ended'
              and attendance.qualified
              and attendance.quarantined_at is null
          )
      )
      and (
        version_row.delivery_type <> 'live'
        or exists (
          select 1
          from public.live_bookings booking
          join public.live_sessions session
            on session.id = booking.live_session_id
          join public.attendance_summaries attendance
            on attendance.live_booking_id = booking.id
          where booking.enrollment_id = enrollment_row.id
            and session.status = 'ended'
            and attendance.qualified
            and attendance.quarantined_at is null
        )
      )
    );
  authoritative_at := case version_row.delivery_type
    when 'recorded' then internal.recorded_requirement_met_at(
      enrollment_row.id, requirement_row.required_watch_seconds
    )
    when 'live' then (
      select max(session.starts_at)
      from public.live_bookings booking
      join public.live_sessions session on session.id = booking.live_session_id
      join public.attendance_summaries attendance
        on attendance.live_booking_id = booking.id
      where booking.enrollment_id = enrollment_row.id
        and session.status = 'ended'
        and attendance.qualified
        and attendance.quarantined_at is null
    )
    else greatest(
      coalesce((
        select internal.recorded_requirement_met_at(
          enrollment_row.id, requirement_row.required_watch_seconds
        )
      ), '-infinity'::timestamptz),
      coalesce((
        select max(session.starts_at)
        from public.live_bookings booking
        join public.live_sessions session
          on session.id = booking.live_session_id
        join public.attendance_summaries attendance
          on attendance.live_booking_id = booking.id
        where booking.enrollment_id = enrollment_row.id
          and session.status = 'ended'
          and attendance.qualified
          and attendance.quarantined_at is null
      ), '-infinity'::timestamptz)
    )
  end;
  refund_clear := not exists (
    select 1
    from public.entitlements entitlement
    join public.refund_cases refund_case
      on refund_case.order_id = entitlement.source_id
    join public.refund_allocations allocation
      on allocation.refund_case_id = refund_case.id
    where entitlement.id = enrollment_row.entitlement_id
      and entitlement.source_type = 'b2c_order'
      and refund_case.status not in ('rejected', 'failed')
      and (
        allocation.scope_type = 'whole_order'
        or (
          allocation.scope_type = 'recorded'
          and version_row.delivery_type in ('recorded', 'hybrid')
        )
        or (
          allocation.scope_type = 'live_component'
          and (
            version_row.delivery_type = 'live'
            or exists (
              select 1 from public.hybrid_components component
              where component.course_version_id = version_row.id
                and component.id = allocation.scope_id
                and component.required
            )
          )
        )
      )
  );
  if not (
    exists (
      select 1 from public.entitlements entitlement
      where entitlement.id = enrollment_row.entitlement_id
        and entitlement.status = 'active'
    )
    and exists (
      select 1 from private.accreditation_identity_profiles profile
      where profile.person_id = enrollment_row.person_id
        and profile.status = 'verified'
        and enrollment_row.identity_profile_confirmed_at is not null
        and enrollment_row.identity_profile_revision_confirmed =
          profile.profile_revision
    )
    and recorded_met and live_met and refund_clear
    and exists (
      select 1 from public.quiz_attempts attempt
      where attempt.enrollment_id = enrollment_row.id
        and attempt.status = 'passed' and attempt.score >= 80
    )
    and exists (
      select 1 from public.survey_responses response
      where response.enrollment_id = enrollment_row.id
    )
    and decision_row.status = 'approved'
    and coalesce(trim(decision_row.approval_reference), '') <> ''
    and decision_row.points > 0
    and coalesce(trim(authority_name), '') <> ''
    and authoritative_at is not null
    and authoritative_at between decision_row.valid_from
      and decision_row.valid_until
    and not exists (
      select 1
      from public.live_bookings booking
      join public.live_sessions session on session.id = booking.live_session_id
      join public.attendance_summaries attendance
        on attendance.live_booking_id = booking.id
      where booking.enrollment_id = enrollment_row.id
        and attendance.qualified
        and attendance.quarantined_at is null
        and (
          session.starts_at < decision_row.valid_from
          or session.starts_at > decision_row.valid_until
        )
    )
  ) then
    raise exception 'COMPLETION_REQUIREMENTS_NOT_MET';
  end if;
  return jsonb_build_object(
    'personId', enrollment_row.person_id,
    'courseTitle', version_row.title,
    'courseVersion', version_row.version,
    'completedOn', authoritative_at::date,
    'certificateKind', 'completion',
    'officialAccreditationCredited', false,
    'accreditationReference', null,
    'accreditationPoints', null,
    'accreditationAuthority', null,
    'requirements', jsonb_build_object(
      'requiredWatchSeconds', requirement_row.required_watch_seconds,
      'livePresencePercent', requirement_row.live_presence_percent,
      'liveCameraPercent', requirement_row.live_camera_percent,
      'quizPassingScore', 80,
      'surveyRequired', requirement_row.survey_required
    ),
    'liveSessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sessionId', session.id,
        'title', session.title,
        'startsAt', session.starts_at,
        'denominatorSeconds', attendance.denominator_seconds,
        'presenceThreshold', session.presence_threshold,
        'cameraThreshold', session.camera_threshold,
        'presencePercent', attendance.presence_percent,
        'cameraPercent', attendance.camera_percent
      ) order by session.starts_at)
      from public.live_bookings booking
      join public.live_sessions session on session.id = booking.live_session_id
      join public.attendance_summaries attendance
        on attendance.live_booking_id = booking.id
      where booking.enrollment_id = enrollment_row.id
        and attendance.qualified
        and attendance.quarantined_at is null
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function internal.read_completion_render_context(uuid)
  from public;

create or replace function public.read_completion_render_context(
  p_enrollment_id uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.read_completion_render_context(p_enrollment_id)
$$;

create or replace function internal.finalize_completion_and_certificate(
  target_enrollment uuid,
  certificate_pdf_path text,
  certificate_pdf_sha256 text,
  verification_hash text,
  issuing_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  enrollment_row public.enrollments%rowtype;
  version_row public.course_versions%rowtype;
  requirement_row public.course_requirements%rowtype;
  decision_row public.accreditation_decision_revisions%rowtype;
  identity_verified boolean;
  recorded_met boolean;
  live_met boolean;
  quiz_met boolean;
  survey_met boolean;
  entitlement_valid boolean;
  refund_clear boolean;
  accreditation_valid boolean;
  authoritative_at timestamptz;
  snapshot_id uuid;
  certificate_identifier uuid;
  certificate_revision_identifier uuid;
  revision_number integer;
  masked_name text;
  recompute_result jsonb;
begin
  if auth.role() <> 'service_role'
     and not internal.has_staff_role('platform_admin')
  then
    raise exception 'CERTIFICATE_SERVICE_AUTHORITY_REQUIRED';
  end if;
  if not internal.feature_is_open('certificate_issue') then
    raise exception 'CERTIFICATE_ISSUE_CLOSED';
  end if;
  if certificate_pdf_sha256 !~ '^[a-f0-9]{64}$'
     or verification_hash !~ '^[a-f0-9]{64}$'
     or certificate_pdf_path = ''
  then
    raise exception 'CERTIFICATE_ARTIFACT_INVALID';
  end if;

  select * into enrollment_row from public.enrollments
  where id = target_enrollment for update;
  if not found or enrollment_row.status <> 'active' then
    raise exception 'ENROLLMENT_NOT_COMPLETABLE';
  end if;
  select * into version_row from public.course_versions
    where id = enrollment_row.course_version_id;
  select * into requirement_row from public.course_requirements
    where course_version_id = version_row.id;
  select decision.* into decision_row
  from public.course_version_accreditation link
  join public.accreditation_decision_revisions decision
    on decision.id = link.accreditation_revision_id
  where link.course_version_id = version_row.id
  order by decision.revision desc limit 1;

  if version_row.delivery_type in ('recorded', 'hybrid') then
    recompute_result :=
      internal.recompute_recorded_progress_unchecked(enrollment_row.id);
    if not coalesce((recompute_result ->> 'valid')::boolean, false)
       or coalesce(
         (recompute_result ->> 'driftDetected')::boolean, true
       )
    then
      raise exception 'RECORDED_PROGRESS_RECOMPUTE_REQUIRED';
    end if;
  end if;
  select exists (
    select 1 from public.entitlements entitlement
    where entitlement.id = enrollment_row.entitlement_id
      and entitlement.status = 'active'
  ) into entitlement_valid;
  select not exists (
    select 1
    from public.entitlements entitlement
    join public.refund_cases refund_case
      on refund_case.order_id = entitlement.source_id
    join public.refund_allocations allocation
      on allocation.refund_case_id = refund_case.id
    where entitlement.id = enrollment_row.entitlement_id
      and entitlement.source_type = 'b2c_order'
      and refund_case.status not in ('rejected', 'failed')
      and (
        allocation.scope_type = 'whole_order'
        or (
          allocation.scope_type = 'recorded'
          and version_row.delivery_type in ('recorded', 'hybrid')
        )
        or (
          allocation.scope_type = 'live_component'
          and (
            version_row.delivery_type = 'live'
            or exists (
              select 1 from public.hybrid_components component
              where component.course_version_id = version_row.id
                and component.id = allocation.scope_id
                and component.required
            )
          )
        )
      )
  ) into refund_clear;
  select exists (
    select 1 from private.accreditation_identity_profiles profile
    where profile.person_id = enrollment_row.person_id
      and profile.status = 'verified'
      and enrollment_row.identity_profile_confirmed_at is not null
      and enrollment_row.identity_profile_revision_confirmed =
        profile.profile_revision
  ) into identity_verified;
  recorded_met := version_row.delivery_type = 'live'
    or coalesce((
      select confirmed_valid_seconds
      from public.progress_summaries
      where enrollment_id = enrollment_row.id
    ), 0) >= requirement_row.required_watch_seconds;
  live_met := version_row.delivery_type = 'recorded'
    or (
      not exists (
        select 1
        from public.hybrid_components component
        where component.course_version_id = version_row.id
          and component.required
          and component.component_type = 'live'
          and not exists (
            select 1
            from public.live_bookings booking
            join public.live_sessions session
              on session.id = booking.live_session_id
            join public.attendance_summaries attendance
              on attendance.live_booking_id = booking.id
            where booking.enrollment_id = enrollment_row.id
              and booking.live_component_id = component.id
              and session.status = 'ended'
              and attendance.qualified
              and attendance.quarantined_at is null
          )
      )
      and (
        version_row.delivery_type <> 'live'
        or exists (
          select 1
          from public.live_bookings booking
          join public.live_sessions session
            on session.id = booking.live_session_id
          join public.attendance_summaries attendance
            on attendance.live_booking_id = booking.id
          where booking.enrollment_id = enrollment_row.id
            and session.status = 'ended'
            and attendance.qualified
            and attendance.quarantined_at is null
        )
      )
    );
  select exists (
    select 1 from public.quiz_attempts attempt
    where attempt.enrollment_id = enrollment_row.id
      and attempt.status = 'passed'
      and attempt.score >= 80
  ) into quiz_met;
  select exists (
    select 1 from public.survey_responses response
    where response.enrollment_id = enrollment_row.id
  ) into survey_met;
  authoritative_at := case version_row.delivery_type
    when 'recorded' then internal.recorded_requirement_met_at(
      enrollment_row.id, requirement_row.required_watch_seconds
    )
    when 'live' then (
      select max(session.starts_at)
      from public.live_bookings booking
      join public.live_sessions session on session.id = booking.live_session_id
      join public.attendance_summaries attendance
        on attendance.live_booking_id = booking.id
      where booking.enrollment_id = enrollment_row.id
        and attendance.qualified
        and attendance.quarantined_at is null
        and session.status = 'ended'
    )
    else greatest(
      coalesce((
        select internal.recorded_requirement_met_at(
          enrollment_row.id, requirement_row.required_watch_seconds
        )
      ), '-infinity'::timestamptz),
      coalesce((
        select max(session.starts_at)
        from public.live_bookings booking
        join public.live_sessions session on session.id = booking.live_session_id
        join public.attendance_summaries attendance
          on attendance.live_booking_id = booking.id
        where booking.enrollment_id = enrollment_row.id
          and session.status = 'ended'
          and attendance.qualified
          and attendance.quarantined_at is null
      ), '-infinity'::timestamptz)
    )
  end;
  accreditation_valid := decision_row.status = 'approved'
    and coalesce(trim(decision_row.approval_reference), '') <> ''
    and decision_row.points > 0
    and authoritative_at is not null
    and authoritative_at >= decision_row.valid_from
    and authoritative_at <= decision_row.valid_until
    and not exists (
      select 1
      from public.live_bookings booking
      join public.live_sessions session on session.id = booking.live_session_id
      join public.attendance_summaries attendance
        on attendance.live_booking_id = booking.id
      where booking.enrollment_id = enrollment_row.id
        and session.status = 'ended'
        and attendance.qualified
        and attendance.quarantined_at is null
        and (
          session.starts_at < decision_row.valid_from
          or session.starts_at > decision_row.valid_until
        )
    );
  if not (
    entitlement_valid and refund_clear and identity_verified
    and recorded_met and live_met
    and quiz_met and survey_met and accreditation_valid
  ) then
    raise exception 'COMPLETION_REQUIREMENTS_NOT_MET';
  end if;

  insert into public.eligibility_snapshots (
    enrollment_id, accreditation_revision_id, authoritative_date,
    entitlement_valid, identity_verified, recorded_requirement_met,
    live_requirements_met, quiz_passed, survey_completed,
    accreditation_valid, evidence_manifest_hash, signed_snapshot
  ) values (
    enrollment_row.id, decision_row.id, authoritative_at::date,
    entitlement_valid, identity_verified, recorded_met, live_met,
    quiz_met, survey_met, accreditation_valid,
    encode(extensions.digest(
      enrollment_row.id::text || ':' || decision_row.id::text || ':'
      || authoritative_at::date::text, 'sha256'
    ), 'hex'),
    jsonb_build_object(
      'courseVersionId', version_row.id,
      'accreditationRevisionId', decision_row.id,
      'authoritativeDate', authoritative_at::date
    )
  ) returning id into snapshot_id;
  update public.enrollments
    set status = 'completed', completed_at = coalesce(completed_at, now())
    where id = enrollment_row.id;

  insert into public.certificates (
    enrollment_id, certificate_kind, current_status
  ) values (
    enrollment_row.id, 'completion', 'active'
  )
  on conflict (enrollment_id) do update
    set current_status = 'active'
  returning id into certificate_identifier;
  select coalesce(max(revision), 0) + 1 into revision_number
    from public.certificate_revisions
    where certificate_id = certificate_identifier;
  select case
    when display_name is null or length(display_name) < 2 then '歲悅學員'
    else left(display_name, 1)
      || repeat('＊', greatest(length(display_name) - 1, 1))
  end into masked_name
  from public.people where id = enrollment_row.person_id;
  insert into public.certificate_revisions (
    certificate_id, revision, status, masked_name_snapshot,
    course_title_snapshot, course_version_snapshot, completed_on,
    accreditation_reference_snapshot, accreditation_points_snapshot,
    accreditation_authority_snapshot, evidence_manifest_hash,
    pdf_object_path, pdf_sha256, verification_token_hash, issued_by
  )
  select
    certificate_identifier, revision_number, 'active', masked_name,
    version_row.title, version_row.version, authoritative_at::date,
    decision_row.approval_reference, decision_row.points,
    authority.name,
    (select evidence_manifest_hash from public.eligibility_snapshots
      where id = snapshot_id),
    certificate_pdf_path, certificate_pdf_sha256, verification_hash,
    issuing_actor
  from public.accreditation_authorities authority
  where authority.id = decision_row.authority_id
  returning id into certificate_revision_identifier;
  update public.certificates
    set current_revision_id = certificate_revision_identifier,
        current_status = 'active'
    where id = certificate_identifier;

  insert into public.notifications (
    person_id, category, title, body, business_key
  ) values (
    enrollment_row.person_id, 'completion', '課程已完成',
    '你已完成平台課程條件；積分是否登錄，仍以認可單位後續確認為準。',
    'completion:' || enrollment_row.id::text
  ) on conflict (person_id, business_key) do nothing;
  insert into public.notification_outbox (
    notification_id, channel, destination_ciphertext,
    template_key, template_data, business_idempotency_key
  )
  select
    notification.id, 'email', '{}'::jsonb, 'completion',
    jsonb_build_object('enrollmentId', enrollment_row.id),
    'completion-email:' || enrollment_row.id::text
  from public.notifications notification
  where notification.person_id = enrollment_row.person_id
    and notification.business_key = 'completion:' || enrollment_row.id::text
    and exists (
      select 1 from public.people person
      where person.id = enrollment_row.person_id
        and person.email_verified_at is not null
    )
  on conflict (business_idempotency_key) do nothing;
  perform internal.append_audit_event(
    issuing_actor, 'completion.finalized', 'enrollment',
    enrollment_row.id::text, 'atomic eligibility and certificate issue',
    null, jsonb_build_object('snapshotId', snapshot_id)
  );
  return jsonb_build_object(
    'completed', true,
    'eligibilitySnapshotId', snapshot_id,
    'certificateId', certificate_identifier
  );
end
$$;
revoke all on function internal.finalize_completion_and_certificate(
  uuid, text, text, text, uuid
) from public;

create or replace function public.finalize_completion_and_certificate(
  p_enrollment_id uuid,
  p_pdf_object_path text,
  p_pdf_sha256 text,
  p_verification_token_hash text,
  p_issuing_actor_id uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.finalize_completion_and_certificate(
    p_enrollment_id, p_pdf_object_path, p_pdf_sha256,
    p_verification_token_hash, p_issuing_actor_id
  )
$$;

create or replace function internal.bootstrap_platform_admins(
  first_person uuid,
  second_person uuid,
  execution_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
begin
  if auth.role() <> 'service_role'
     or execution_hash !~ '^[a-f0-9]{64}$'
     or first_person = second_person
     or exists (select 1 from public.staff_roles)
     or exists (
       select 1 from private.bootstrap_markers
       where key = 'platform_admins_v1'
     )
  then
    raise exception 'BOOTSTRAP_PERMANENTLY_UNAVAILABLE';
  end if;
  if (
    select count(*) from public.auth_identities identity
    where identity.person_id in (first_person, second_person)
      and identity.active and not identity.restricted
  ) <> 2 then
    raise exception 'BOOTSTRAP_IDENTITIES_NOT_READY';
  end if;
  if (
    select count(distinct identity.person_id)
    from public.auth_identities identity
    join auth.mfa_factors factor on factor.user_id = identity.auth_user_id
    where identity.person_id in (first_person, second_person)
      and factor.factor_type = 'totp'
      and factor.status = 'verified'
  ) <> 2 then
    raise exception 'BOOTSTRAP_TOTP_NOT_READY';
  end if;
  insert into public.staff_roles (person_id, role)
  values
    (first_person, 'platform_admin'),
    (second_person, 'platform_admin');
  insert into private.bootstrap_markers (
    key, completed_at, first_admin_id, second_admin_id, execution_hash
  ) values (
    'platform_admins_v1', now(), first_person, second_person, execution_hash
  );
  perform internal.append_audit_event(
    first_person, 'platform.bootstrap_completed', 'platform',
    'platform_admins_v1', 'two-person bootstrap', null,
    jsonb_build_object('secondAdminId', second_person)
  );
  perform internal.append_audit_event(
    second_person, 'platform.bootstrap_cocustodian', 'platform',
    'platform_admins_v1', 'second bootstrap custodian confirmed',
    null, jsonb_build_object('firstAdminId', first_person)
  );
  return true;
end
$$;
revoke all on function internal.bootstrap_platform_admins(uuid, uuid, text)
  from public;

create or replace function internal.before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if internal.setting_is_true('maintenance_mode') then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 503,
        'message', 'Registration is temporarily unavailable.'
      )
    );
  end if;
  if coalesce(event -> 'user' ->> 'phone', '') = ''
     or coalesce(event -> 'user' -> 'app_metadata' ->> 'provider', '') <> 'phone'
  then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Phone authentication is required.'
      )
    );
  end if;
  return '{}'::jsonb;
end
$$;
revoke all on function internal.before_user_created(jsonb) from public;

create or replace function internal.mfa_verification_attempt(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  scope text := encode(extensions.digest(
    coalesce(event ->> 'user_id', '') || ':'
    || coalesce(event ->> 'factor_id', ''),
    'sha256'
  ), 'hex');
  attempts integer;
begin
  if coalesce((event ->> 'valid')::boolean, false) then
    return jsonb_build_object('decision', 'continue');
  end if;
  insert into public.rate_limit_counters (
    scope_hash, action, window_started_at, count
  ) values (
    scope, 'mfa_failure', date_trunc('minute', now()), 1
  )
  on conflict (scope_hash, action, window_started_at)
  do update set count = public.rate_limit_counters.count + 1
  returning count into attempts;
  if attempts >= 5 then
    return jsonb_build_object(
      'decision', 'reject',
      'message', 'Too many verification attempts.'
    );
  end if;
  return jsonb_build_object('decision', 'continue');
end
$$;
revoke all on function internal.mfa_verification_attempt(jsonb) from public;
grant usage on schema internal to supabase_auth_admin;
grant execute on function internal.before_user_created(jsonb)
  to supabase_auth_admin;
grant execute on function internal.mfa_verification_attempt(jsonb)
  to supabase_auth_admin;

create or replace function public.bootstrap_platform_admins(
  p_first_person_id uuid,
  p_second_person_id uuid,
  p_execution_hash text
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.bootstrap_platform_admins(
    p_first_person_id, p_second_person_id, p_execution_hash
  )
$$;

create or replace function internal.present_legal_contract(
  target_course_version uuid,
  device_hash text,
  request_ip inet
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  version_row public.course_versions%rowtype;
  legal_row public.legal_documents%rowtype;
  acceptance_row public.legal_acceptances%rowtype;
begin
  if device_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'DEVICE_HASH_REJECTED';
  end if;
  select * into version_row
  from public.course_versions
  where id = target_course_version
    and status = 'published'
    and commerce_close_at > now()
  for share;
  if not found or version_row.legal_document_id is null then
    raise exception 'COURSE_CONTRACT_UNAVAILABLE';
  end if;
  select * into legal_row
  from public.legal_documents
  where id = version_row.legal_document_id
    and approved_by_legal
    and effective_at <= now()
    and (superseded_at is null or superseded_at > now())
  for share;
  if not found then raise exception 'LEGAL_REVISION_NOT_APPROVED'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended(actor::text || ':' || legal_row.id::text, 0)
  );
  select * into acceptance_row
  from public.legal_acceptances
  where person_id = actor and legal_document_id = legal_row.id
  order by created_at desc
  limit 1;
  if not found then
    insert into public.legal_acceptances (
      person_id, legal_document_id, first_presented_at, first_ip,
      first_device_hash, document_hash_snapshot
    ) values (
      actor, legal_row.id, now(), request_ip,
      device_hash, legal_row.content_sha256
    )
    returning * into acceptance_row;
    perform internal.append_audit_event(
      actor, 'legal_contract.presented', 'legal_acceptance',
      acceptance_row.id::text, 'first contract presentation', null,
      jsonb_build_object('documentHash', legal_row.content_sha256)
    );
  end if;
  return jsonb_build_object(
    'acceptanceId', acceptance_row.id,
    'firstPresentedAt', acceptance_row.first_presented_at,
    'confirmAvailableAt',
      acceptance_row.first_presented_at + interval '72 hours',
    'secondConfirmedAt', acceptance_row.second_confirmed_at,
    'documentId', legal_row.id,
    'documentHash', acceptance_row.document_hash_snapshot
  );
end
$$;
revoke all on function internal.present_legal_contract(uuid, text, inet)
  from public;

create or replace function public.present_legal_contract(
  p_course_version_id uuid,
  p_device_hash text,
  p_request_ip inet
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.present_legal_contract(
    p_course_version_id, p_device_hash, p_request_ip
  )
$$;

create or replace function internal.confirm_legal_contract(
  target_acceptance uuid,
  device_hash text,
  request_ip inet
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  acceptance_row public.legal_acceptances%rowtype;
begin
  if device_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'DEVICE_HASH_REJECTED';
  end if;
  select * into acceptance_row
  from public.legal_acceptances
  where id = target_acceptance and person_id = actor
  for update;
  if not found then raise exception 'LEGAL_ACCEPTANCE_NOT_FOUND'; end if;
  if acceptance_row.document_hash_snapshot is distinct from (
    select content_sha256 from public.legal_documents
    where id = acceptance_row.legal_document_id
      and approved_by_legal
      and effective_at <= now()
      and (superseded_at is null or superseded_at > now())
  ) then
    raise exception 'LEGAL_DOCUMENT_CHANGED';
  end if;
  if now() < acceptance_row.first_presented_at + interval '72 hours' then
    raise exception 'CONTRACT_REVIEW_PERIOD_ACTIVE';
  end if;
  if acceptance_row.second_confirmed_at is null then
    update public.legal_acceptances
    set second_confirmed_at = now(),
        second_ip = request_ip,
        second_device_hash = device_hash
    where id = acceptance_row.id
    returning * into acceptance_row;
    perform internal.append_audit_event(
      actor, 'legal_contract.second_confirmed', 'legal_acceptance',
      acceptance_row.id::text, 'second confirmation after review period',
      null, '{}'::jsonb
    );
  end if;
  return jsonb_build_object(
    'acceptanceId', acceptance_row.id,
    'secondConfirmedAt', acceptance_row.second_confirmed_at
  );
end
$$;
revoke all on function internal.confirm_legal_contract(uuid, text, inet)
  from public;

create or replace function public.confirm_legal_contract(
  p_acceptance_id uuid,
  p_device_hash text,
  p_request_ip inet
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.confirm_legal_contract(
    p_acceptance_id, p_device_hash, p_request_ip
  )
$$;

create or replace function internal.build_refundable_scopes(
  target_order uuid,
  target_person uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  order_row public.orders%rowtype;
  item_row public.order_items%rowtype;
  enrollment_id uuid;
  total_prior integer;
  scope_prior integer;
  base_amount integer;
  remaining_amount integer;
  confirmed_seconds integer;
  required_seconds integer;
  supplied_ratio numeric;
  is_credited boolean;
  live_allocation record;
  live_label text;
  scopes jsonb := '[]'::jsonb;
  eligible boolean;
  ineligible_reason text;
  recompute_result jsonb;
begin
  select * into order_row
  from public.orders
  where id = target_order and person_id = target_person;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  select * into item_row
  from public.order_items
  where order_id = target_order
  order by created_at
  limit 1;
  select enrollment.id into enrollment_id
  from public.entitlements entitlement
  join public.enrollments enrollment
    on enrollment.entitlement_id = entitlement.id
  where entitlement.person_id = target_person
    and entitlement.source_type = 'b2c_order'
    and entitlement.source_id = target_order;
  select coalesce(sum(allocation.amount_twd), 0) into total_prior
  from public.refund_allocations allocation
  join public.refund_cases refund_case
    on refund_case.id = allocation.refund_case_id
  where refund_case.order_id = target_order
    and refund_case.status not in ('rejected', 'failed');
  select exists (
    select 1
    from public.certificates certificate
    where certificate.enrollment_id = enrollment_id
      and certificate.current_status = 'credited'
  ) into is_credited;

  remaining_amount := greatest(
    order_row.amount_paid_twd - total_prior, 0
  );
  eligible := order_row.status in ('paid', 'paid_unfulfilled')
    and remaining_amount > 0 and not is_credited;
  ineligible_reason := case
    when is_credited then 'official_accreditation_already_credited'
    when order_row.status not in ('paid', 'paid_unfulfilled')
      then 'order_not_paid'
    when remaining_amount <= 0 then 'refund_value_exhausted'
    else null
  end;
  scopes := scopes || jsonb_build_array(jsonb_build_object(
    'scopeType', 'whole_order',
    'scopeId', null,
    'label', '整筆訂單',
    'eligible', eligible,
    'ineligibleReason', ineligible_reason
  ));

  base_amount := coalesce(
    (item_row.price_allocation_snapshot ->> 'recorded')::integer, 0
  );
  if base_amount > 0 then
    if enrollment_id is not null then
      recompute_result :=
        internal.recompute_recorded_progress_unchecked(enrollment_id);
    end if;
    if enrollment_id is null
       or not coalesce((recompute_result ->> 'valid')::boolean, false)
       or coalesce(
         (recompute_result ->> 'driftDetected')::boolean, true
       )
    then
      -- A quotation must never reduce a learner's refundable amount using
      -- unverified or stale viewing totals.
      confirmed_seconds := 0;
      select greatest(
        coalesce(requirement.required_watch_seconds, 0), 1
      )
      into required_seconds
      from public.course_requirements requirement
      where requirement.course_version_id = item_row.course_version_id;
    else
      confirmed_seconds :=
        coalesce((recompute_result ->> 'confirmedSeconds')::integer, 0);
      select greatest(
        coalesce(requirement.required_watch_seconds, 0), 1
      )
      into required_seconds
      from public.course_requirements requirement
      where requirement.course_version_id = item_row.course_version_id;
    end if;
    supplied_ratio := least(
      1,
      greatest(
        0,
        coalesce(confirmed_seconds, 0)::numeric
          / greatest(coalesce(required_seconds, 1), 1)
      )
    );
    select coalesce(sum(allocation.amount_twd), 0)
      into scope_prior
    from public.refund_allocations allocation
    join public.refund_cases refund_case
      on refund_case.id = allocation.refund_case_id
    where refund_case.order_id = target_order
      and refund_case.status not in ('rejected', 'failed')
      and allocation.scope_type = 'recorded'
      and allocation.scope_id = item_row.course_version_id;
    remaining_amount := greatest(
      ceil(base_amount * (1 - supplied_ratio))::integer - scope_prior,
      0
    );
    eligible := order_row.status = 'paid'
      and enrollment_id is not null
      and remaining_amount > 0
      and not is_credited;
    ineligible_reason := case
      when is_credited then 'official_accreditation_already_credited'
      when order_row.status <> 'paid' then 'course_access_not_fulfilled'
      when enrollment_id is null then 'enrollment_not_found'
      when remaining_amount <= 0 then 'refund_value_exhausted'
      else null
    end;
    scopes := scopes || jsonb_build_array(jsonb_build_object(
      'scopeType', 'recorded',
      'scopeId', item_row.course_version_id,
      'label', '預錄課程內容',
      'eligible', eligible,
      'ineligibleReason', ineligible_reason
    ));
  end if;

  for live_allocation in
    select key::uuid as scope_id, value::integer as amount_twd
    from jsonb_each_text(
      coalesce(item_row.price_allocation_snapshot -> 'live', '{}'::jsonb)
    )
    order by key
  loop
    base_amount := live_allocation.amount_twd;
    select coalesce(max(
      attendance.effective_presence_seconds::numeric
        / greatest(attendance.denominator_seconds, 1)
    ), 0) into supplied_ratio
    from public.live_bookings booking
    left join public.attendance_summaries attendance
      on attendance.live_booking_id = booking.id
    where booking.enrollment_id = enrollment_id
      and coalesce(
        booking.live_component_id, booking.course_version_id
      ) = live_allocation.scope_id;
    select coalesce(sum(allocation.amount_twd), 0)
      into scope_prior
    from public.refund_allocations allocation
    join public.refund_cases refund_case
      on refund_case.id = allocation.refund_case_id
    where refund_case.order_id = target_order
      and refund_case.status not in ('rejected', 'failed')
      and allocation.scope_type = 'live_component'
      and allocation.scope_id = live_allocation.scope_id;
    remaining_amount := greatest(
      ceil(base_amount * (1 - least(1, supplied_ratio)))::integer
        - scope_prior,
      0
    );
    select coalesce(component.title, item_row.title_snapshot || '（直播）')
      into live_label
    from (select 1) placeholder
    left join public.hybrid_components component
      on component.id = live_allocation.scope_id;
    eligible := order_row.status = 'paid'
      and enrollment_id is not null
      and remaining_amount > 0
      and not is_credited;
    ineligible_reason := case
      when is_credited then 'official_accreditation_already_credited'
      when order_row.status <> 'paid' then 'course_access_not_fulfilled'
      when enrollment_id is null then 'enrollment_not_found'
      when remaining_amount <= 0 then 'refund_value_exhausted'
      else null
    end;
    scopes := scopes || jsonb_build_array(jsonb_build_object(
      'scopeType', 'live_component',
      'scopeId', live_allocation.scope_id,
      'label', live_label,
      'eligible', eligible,
      'ineligibleReason', ineligible_reason
    ));
  end loop;
  return scopes;
end
$$;
revoke all on function internal.build_refundable_scopes(uuid, uuid)
  from public;

create or replace function internal.read_own_order(target_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  result jsonb;
begin
  select jsonb_build_object(
    'orderId', orders.id,
    'orderNumber', orders.order_number,
    'status', orders.status,
    'amountDueTwd', orders.amount_due_twd,
    'amountPaidTwd', orders.amount_paid_twd,
    'transferDueAt', orders.transfer_due_at,
    'paidAt', orders.paid_at,
    'accreditationDisclosure', orders.accreditation_disclosure_snapshot,
    'courseTitle', item.title_snapshot,
    'bankName', instructions.bank_name_snapshot,
    'bankCode', instructions.bank_code_snapshot,
    'accountName', instructions.account_name_snapshot,
    'accountNumber', instructions.account_number_snapshot,
    'maskedAccount', instructions.masked_account_snapshot,
    'refundableScopes',
      internal.build_refundable_scopes(orders.id, actor)
  ) into result
  from public.orders orders
  join public.order_items item on item.order_id = orders.id
  join public.bank_payment_instructions instructions
    on instructions.order_id = orders.id
  where orders.id = target_order and orders.person_id = actor
  limit 1;
  if result is null then raise exception 'ORDER_NOT_FOUND'; end if;
  return result;
end
$$;
revoke all on function internal.read_own_order(uuid) from public;

create or replace function public.read_own_order(p_order_id uuid)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.read_own_order(p_order_id)
$$;

create or replace function internal.read_own_orders(
  row_limit integer,
  before_created_at timestamptz
)
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
  if row_limit not between 1 and 100 then
    raise exception 'ORDER_LIST_LIMIT_INVALID';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'orderId', listed.id,
    'orderNumber', listed.order_number,
    'courseTitle', listed.title_snapshot,
    'status', listed.status,
    'amountDueTwd', listed.amount_due_twd,
    'amountPaidTwd', listed.amount_paid_twd,
    'transferDueAt', listed.transfer_due_at,
    'createdAt', listed.created_at
  ) order by listed.created_at desc, listed.id desc), '[]'::jsonb)
  into result
  from (
    select orders.id, orders.order_number, item.title_snapshot,
      orders.status, orders.amount_due_twd, orders.amount_paid_twd,
      orders.transfer_due_at, orders.created_at
    from public.orders orders
    join public.order_items item on item.order_id = orders.id
    where orders.person_id = actor
      and (
        before_created_at is null
        or orders.created_at < before_created_at
      )
    order by orders.created_at desc, orders.id desc
    limit row_limit
  ) listed;
  return result;
end
$$;
revoke all on function internal.read_own_orders(integer, timestamptz)
  from public;

create or replace function public.read_own_orders(
  p_limit integer default 50,
  p_before timestamptz default null
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_own_orders(p_limit, p_before)
$$;

create or replace function internal.apply_for_organization(
  legal_name text,
  submitted_tax_index text,
  invoice_email text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  organization_id uuid;
  existing_status text;
begin
  if length(trim(legal_name)) < 2
     or submitted_tax_index !~ '^[a-f0-9]{64}$'
     or invoice_email !~ '^[^@[:space:]]+@[^@[:space:]]+$'
  then
    raise exception 'ORGANIZATION_APPLICATION_INVALID';
  end if;
  if not exists (
    select 1 from public.people person
    where person.id = actor
      and person.email_verified_at is not null
      and lower(person.verified_email) = lower(invoice_email)
  ) then
    raise exception 'VERIFIED_ORGANIZATION_EMAIL_REQUIRED';
  end if;
  select id, status into organization_id, existing_status
  from public.organizations
  where application_idempotency_key = idempotency
    and contact_person_id = actor;
  if found then
    return jsonb_build_object(
      'organizationId', organization_id, 'status', existing_status
    );
  end if;
  if exists (
    select 1 from public.organizations
    where organizations.tax_id_blind_index = submitted_tax_index
  ) then
    raise exception 'ORGANIZATION_ALREADY_EXISTS_CONTACT_SUPPORT';
  end if;
  insert into public.organizations (
    legal_name, tax_id_blind_index, contact_person_id, invoice_email,
    application_idempotency_key
  ) values (
    trim(legal_name), submitted_tax_index, actor, lower(invoice_email),
    idempotency
  ) returning id into organization_id;
  insert into public.organization_memberships (
    organization_id, person_id, role
  ) values (organization_id, actor, 'owner');
  perform internal.append_audit_event(
    actor, 'organization.applied', 'organization', organization_id::text,
    'organization application submitted', organization_id,
    '{}'::jsonb
  );
  return jsonb_build_object(
    'organizationId', organization_id, 'status', 'submitted'
  );
end
$$;
revoke all on function internal.apply_for_organization(
  text, text, text, uuid
) from public;

create or replace function public.apply_for_organization(
  p_legal_name text,
  p_tax_id_blind_index text,
  p_invoice_email text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.apply_for_organization(
    p_legal_name, p_tax_id_blind_index, p_invoice_email, p_idempotency_key
  )
$$;

create or replace function internal.review_organization_application(
  target_organization uuid,
  decision text,
  review_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  next_status text;
begin
  if not internal.has_staff_role('platform_admin') then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;
  if decision not in ('approve', 'reject') or length(trim(review_reason)) < 3 then
    raise exception 'ORGANIZATION_REVIEW_INVALID';
  end if;
  next_status := case when decision = 'approve' then 'approved' else 'rejected' end;
  update public.organizations
  set status = next_status, reviewed_by = actor, reviewed_at = now()
  where id = target_organization and status = 'submitted';
  if not found then raise exception 'ORGANIZATION_NOT_REVIEWABLE'; end if;
  if next_status = 'approved' then
    insert into public.organization_wallets (organization_id)
    values (target_organization)
    on conflict (organization_id) do nothing;
  end if;
  perform internal.append_audit_event(
    actor, 'organization.' || next_status, 'organization',
    target_organization::text, review_reason, target_organization,
    '{}'::jsonb
  );
  return jsonb_build_object('status', next_status);
end
$$;
revoke all on function internal.review_organization_application(
  uuid, text, text
) from public;

create or replace function public.review_organization_application(
  p_organization_id uuid,
  p_decision text,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.review_organization_application(
    p_organization_id, p_decision, p_reason
  )
$$;

create or replace function internal.create_organization_invitation(
  target_organization uuid,
  phone_ciphertext jsonb,
  phone_blind_index text,
  invitation_token_hash text,
  invitation_role text,
  employee_name text,
  employee_number text,
  department text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  invitation_id uuid;
  invitation_expires_at timestamptz;
  actor_role text;
  existing_invitation public.organization_invitations%rowtype;
begin
  select membership.role into actor_role
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.organization_id
  where membership.organization_id = target_organization
    and membership.person_id = actor
    and membership.active
    and organization.status = 'approved'
  for update of membership;
  if actor_role not in ('owner', 'training_manager') then
    raise exception 'ORGANIZATION_MANAGER_REQUIRED';
  end if;
  if phone_blind_index !~ '^[a-f0-9]{64}$'
     or invitation_token_hash !~ '^[a-f0-9]{64}$'
     or invitation_role not in ('training_manager', 'finance', 'member')
     or (actor_role = 'training_manager' and invitation_role <> 'member')
  then
    raise exception 'ORGANIZATION_INVITATION_INVALID';
  end if;
  select * into existing_invitation
  from public.organization_invitations invitation
  where invitation.invited_by = actor
    and invitation.idempotency_key = idempotency
  for update;
  if found then
    if existing_invitation.organization_id <> target_organization
       or existing_invitation.phone_blind_index <> phone_blind_index
       or existing_invitation.role <> invitation_role
    then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object(
      'invitationId', existing_invitation.id,
      'expiresAt', existing_invitation.expires_at
    );
  end if;
  invitation_expires_at := now() + interval '7 days';
  insert into public.organization_invitations (
    organization_id, phone_ciphertext, phone_blind_index, token_hash,
    role, employee_name, employee_number, department, invited_by,
    idempotency_key, expires_at
  ) values (
    target_organization, phone_ciphertext, phone_blind_index,
    invitation_token_hash, invitation_role, nullif(trim(employee_name), ''),
    nullif(trim(employee_number), ''), nullif(trim(department), ''),
    actor, idempotency, invitation_expires_at
  )
  on conflict (organization_id, phone_blind_index)
  do update set
    phone_ciphertext = excluded.phone_ciphertext,
    token_hash = excluded.token_hash,
    role = excluded.role,
    employee_name = excluded.employee_name,
    employee_number = excluded.employee_number,
    department = excluded.department,
    invited_by = excluded.invited_by,
    idempotency_key = excluded.idempotency_key,
    expires_at = excluded.expires_at,
    accepted_at = null,
    revoked_at = null,
    reversible_phone_purged_at = null,
    created_at = now()
  returning id into invitation_id;
  insert into public.durable_jobs (job_type, business_key, payload)
  values (
    'organization_invitation_sms',
    'organization-invitation:' || invitation_id::text || ':'
      || idempotency::text,
    jsonb_build_object('invitationId', invitation_id)
  );
  perform internal.append_audit_event(
    actor, 'organization.invitation_created', 'organization_invitation',
    invitation_id::text, 'phone invitation', target_organization,
    jsonb_build_object('role', invitation_role)
  );
  return jsonb_build_object(
    'invitationId', invitation_id,
    'expiresAt', invitation_expires_at
  );
end
$$;
revoke all on function internal.create_organization_invitation(
  uuid, jsonb, text, text, text, text, text, text, uuid
) from public;

create or replace function public.create_organization_invitation(
  p_organization_id uuid,
  p_phone_ciphertext jsonb,
  p_phone_blind_index text,
  p_token_hash text,
  p_role text,
  p_employee_name text,
  p_employee_number text,
  p_department text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.create_organization_invitation(
    p_organization_id, p_phone_ciphertext, p_phone_blind_index,
    p_token_hash, p_role, p_employee_name, p_employee_number, p_department,
    p_idempotency_key
  )
$$;

create or replace function internal.manage_organization_invitation(
  target_organization uuid,
  target_invitation uuid,
  submitted_operation text,
  submitted_token_hash text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  actor_role text;
  invitation public.organization_invitations%rowtype;
  prior_action public.organization_invitation_actions%rowtype;
  action_id uuid;
  result_status text;
begin
  if submitted_operation not in ('resend', 'revoke') then
    raise exception 'ORGANIZATION_INVITATION_ACTION_INVALID';
  end if;
  select action.* into prior_action
  from public.organization_invitation_actions action
  where action.actor_person_id = actor
    and action.idempotency_key = idempotency;
  if found then
    if prior_action.organization_invitation_id <> target_invitation
       or prior_action.operation <> submitted_operation
    then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object(
      'invitationId', target_invitation,
      'status', prior_action.resulting_status,
      'replayed', true
    );
  end if;
  select membership.role into actor_role
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.organization_id
  where membership.organization_id = target_organization
    and membership.person_id = actor
    and membership.active
    and organization.status = 'approved'
  for update of membership;
  if actor_role not in ('owner', 'training_manager') then
    raise exception 'ORGANIZATION_MANAGER_REQUIRED';
  end if;
  select * into invitation
  from public.organization_invitations
  where id = target_invitation
    and organization_id = target_organization
  for update;
  if not found
     or invitation.accepted_at is not null
     or (
       actor_role = 'training_manager'
       and invitation.role <> 'member'
     )
  then
    raise exception 'ORGANIZATION_INVITATION_ACTION_REJECTED';
  end if;

  if submitted_operation = 'resend' then
    if invitation.revoked_at is not null
       or submitted_token_hash is distinct from invitation.token_hash
    then
      raise exception 'ORGANIZATION_INVITATION_RESEND_REJECTED';
    end if;
    update public.organization_invitations
    set expires_at = clock_timestamp() + interval '7 days',
        created_at = clock_timestamp()
    where id = invitation.id
    returning * into invitation;
    result_status := 'pending';
  else
    update public.organization_invitations
    set revoked_at = coalesce(revoked_at, clock_timestamp())
    where id = invitation.id
    returning * into invitation;
    result_status := 'revoked';
  end if;
  insert into public.organization_invitation_actions (
    organization_invitation_id, actor_person_id, operation,
    idempotency_key, resulting_status
  ) values (
    invitation.id, actor, submitted_operation,
    idempotency, result_status
  ) returning id into action_id;
  if submitted_operation = 'resend' then
    insert into public.durable_jobs (job_type, business_key, payload)
    values (
      'organization_invitation_sms',
      'organization-invitation-resend:' || action_id::text,
      jsonb_build_object('invitationId', invitation.id)
    );
  end if;
  perform internal.append_audit_event(
    actor, 'organization.invitation_' || submitted_operation,
    'organization_invitation', invitation.id::text,
    'organization invitation ' || submitted_operation,
    target_organization,
    jsonb_build_object('role', invitation.role, 'actionId', action_id)
  );
  return jsonb_build_object(
    'invitationId', invitation.id,
    'status', result_status,
    'expiresAt', invitation.expires_at,
    'replayed', false
  );
end
$$;
revoke all on function internal.manage_organization_invitation(
  uuid, uuid, text, text, uuid
) from public;

create or replace function public.manage_organization_invitation(
  p_organization_id uuid,
  p_invitation_id uuid,
  p_operation text,
  p_token_hash text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.manage_organization_invitation(
    p_organization_id, p_invitation_id, p_operation,
    p_token_hash, p_idempotency_key
  )
$$;

create or replace function internal.import_organization_invitations(
  target_organization uuid,
  target_upload uuid,
  submitted_rows jsonb,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  upload_row public.upload_quarantine%rowtype;
  import_id uuid;
  row_data jsonb;
  invitation_id uuid;
  row_count integer;
  actor_role text;
begin
  select membership.role into actor_role
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.organization_id
  where membership.organization_id = target_organization
    and membership.person_id = actor
    and membership.active
    and organization.status = 'approved'
  for update of membership;
  if actor_role not in ('owner', 'training_manager')
     or jsonb_typeof(submitted_rows) <> 'array'
     or jsonb_array_length(submitted_rows) not between 1 and 1000
  then raise exception 'ORGANIZATION_ROSTER_IMPORT_REJECTED'; end if;
  select * into upload_row from public.upload_quarantine
  where id = target_upload
    and owner_person_id = actor
    and purpose = 'organization_roster'
    and status = 'promoted';
  if not found then raise exception 'SAFE_ORGANIZATION_ROSTER_REQUIRED'; end if;
  row_count := jsonb_array_length(submitted_rows);
  if (
    select count(distinct value ->> 'phoneBlindIndex')
    from jsonb_array_elements(submitted_rows)
  ) <> row_count then
    raise exception 'DUPLICATE_ROSTER_PHONE';
  end if;
  insert into public.organization_invitation_imports (
    organization_id, uploaded_by, quarantine_object_path,
    content_sha256, scan_status, validation_status,
    row_count, validation_errors, idempotency_key
  ) values (
    target_organization, actor, upload_row.promoted_object_path,
    upload_row.content_sha256, 'safe', 'valid',
    row_count, '[]'::jsonb, idempotency
  )
  on conflict (organization_id, idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id into import_id;
  if exists (
    select 1 from public.organization_invitation_imports roster_import
    where roster_import.id = import_id
      and roster_import.validation_status = 'imported'
  ) then
    return jsonb_build_object('importId', import_id, 'rowCount', row_count);
  end if;
  for row_data in select value from jsonb_array_elements(submitted_rows)
  loop
    if row_data ->> 'phoneBlindIndex' !~ '^[a-f0-9]{64}$'
       or row_data ->> 'tokenHash' !~ '^[a-f0-9]{64}$'
       or row_data ->> 'role' not in (
         'training_manager', 'finance', 'member'
       )
       or (
         actor_role = 'training_manager'
         and row_data ->> 'role' <> 'member'
       )
       or jsonb_typeof(row_data -> 'phoneCiphertext') <> 'object'
    then raise exception 'ORGANIZATION_ROSTER_ROW_INVALID'; end if;
    insert into public.organization_invitations (
      organization_id, phone_ciphertext, phone_blind_index, token_hash,
      role, employee_name, employee_number, department,
      invited_by, expires_at
    ) values (
      target_organization,
      row_data -> 'phoneCiphertext',
      row_data ->> 'phoneBlindIndex',
      row_data ->> 'tokenHash',
      row_data ->> 'role',
      nullif(trim(coalesce(row_data ->> 'employeeName', '')), ''),
      nullif(trim(coalesce(row_data ->> 'employeeNumber', '')), ''),
      nullif(trim(coalesce(row_data ->> 'department', '')), ''),
      actor, now() + interval '7 days'
    ) on conflict (organization_id, phone_blind_index)
    do update set
      phone_ciphertext = excluded.phone_ciphertext,
      token_hash = excluded.token_hash,
      role = excluded.role,
      employee_name = excluded.employee_name,
      employee_number = excluded.employee_number,
      department = excluded.department,
      invited_by = excluded.invited_by,
      expires_at = excluded.expires_at,
      accepted_at = null, revoked_at = null,
      reversible_phone_purged_at = null, created_at = now()
    returning id into invitation_id;
    insert into public.durable_jobs (job_type, business_key, payload)
    values (
      'organization_invitation_sms',
      'organization-invitation:' || invitation_id::text || ':'
        || (row_data ->> 'tokenHash'),
      jsonb_build_object('invitationId', invitation_id)
    );
  end loop;
  update public.organization_invitation_imports
  set validation_status = 'imported', imported_at = now()
  where id = import_id;
  perform internal.append_audit_event(
    actor, 'organization.roster_imported',
    'organization_invitation_import', import_id::text,
    'all validated rows imported atomically', target_organization,
    jsonb_build_object('rowCount', row_count)
  );
  return jsonb_build_object('importId', import_id, 'rowCount', row_count);
end
$$;
revoke all on function internal.import_organization_invitations(
  uuid, uuid, jsonb, uuid
) from public;

create or replace function public.import_organization_invitations(
  p_organization_id uuid,
  p_upload_id uuid,
  p_rows jsonb,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.import_organization_invitations(
    p_organization_id, p_upload_id, p_rows, p_idempotency_key
  )
$$;

create or replace function internal.accept_organization_invitation(
  invitation_token_hash text,
  authenticated_phone_blind_index text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  invitation public.organization_invitations%rowtype;
begin
  select * into invitation
  from public.organization_invitations
  where token_hash = invitation_token_hash
  for update;
  if not found
     or invitation.accepted_at is not null
     or invitation.revoked_at is not null
     or invitation.expires_at <= now()
     or invitation.phone_blind_index <> authenticated_phone_blind_index
  then
    raise exception 'ORGANIZATION_INVITATION_REJECTED';
  end if;
  insert into public.organization_memberships (
    organization_id, person_id, role, employee_number, department
  ) values (
    invitation.organization_id, actor, invitation.role,
    invitation.employee_number, invitation.department
  )
  on conflict (organization_id, person_id)
  do update set
    role = excluded.role,
    employee_number = excluded.employee_number,
    department = excluded.department,
    active = true,
    left_at = null;
  update public.organization_invitations
  set accepted_at = now(),
      phone_ciphertext = '{"purged":true}'::jsonb,
      reversible_phone_purged_at = now()
  where id = invitation.id;
  perform internal.append_audit_event(
    actor, 'organization.invitation_accepted', 'organization_invitation',
    invitation.id::text, 'same verified phone accepted',
    invitation.organization_id, '{}'::jsonb
  );
  return jsonb_build_object(
    'organizationId', invitation.organization_id, 'role', invitation.role
  );
end
$$;
revoke all on function internal.accept_organization_invitation(text, text)
  from public;

create or replace function public.accept_organization_invitation(
  p_token_hash text,
  p_authenticated_phone_blind_index text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.accept_organization_invitation(
    p_token_hash, p_authenticated_phone_blind_index
  )
$$;

create or replace function internal.present_organization_contract(
  target_organization uuid,
  device_hash text,
  request_ip inet
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  legal_row public.legal_documents%rowtype;
  acceptance_row public.legal_acceptances%rowtype;
begin
  if not internal.has_organization_role(
    target_organization, array['owner', 'finance']
  ) then
    raise exception 'ORGANIZATION_FINANCE_REQUIRED';
  end if;
  if device_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'DEVICE_HASH_REJECTED';
  end if;
  select * into legal_row
  from public.legal_documents
  where kind = 'b2b_contract'
    and approved_by_legal
    and effective_at <= now()
    and (superseded_at is null or superseded_at > now())
  order by revision desc
  limit 1
  for share;
  if not found then raise exception 'B2B_LEGAL_REVISION_MISSING'; end if;
  perform pg_advisory_xact_lock(
    hashtextextended(actor::text || ':' || legal_row.id::text, 0)
  );
  select * into acceptance_row
  from public.legal_acceptances
  where person_id = actor and legal_document_id = legal_row.id
  order by created_at desc limit 1;
  if not found then
    insert into public.legal_acceptances (
      person_id, legal_document_id, first_presented_at, first_ip,
      first_device_hash, document_hash_snapshot
    ) values (
      actor, legal_row.id, now(), request_ip, device_hash,
      legal_row.content_sha256
    ) returning * into acceptance_row;
  end if;
  return jsonb_build_object(
    'acceptanceId', acceptance_row.id,
    'firstPresentedAt', acceptance_row.first_presented_at,
    'confirmAvailableAt',
      acceptance_row.first_presented_at + interval '72 hours',
    'secondConfirmedAt', acceptance_row.second_confirmed_at,
    'documentId', legal_row.id,
    'documentHash', legal_row.content_sha256
  );
end
$$;
revoke all on function internal.present_organization_contract(
  uuid, text, inet
) from public;

create or replace function public.present_organization_contract(
  p_organization_id uuid,
  p_device_hash text,
  p_request_ip inet
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.present_organization_contract(
    p_organization_id, p_device_hash, p_request_ip
  )
$$;

create or replace function internal.create_point_topup(
  target_organization uuid,
  requested_points integer,
  legal_acceptance uuid,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  existing public.point_topups%rowtype;
  topup_id uuid;
  bank_setting jsonb;
  transfer_due timestamptz := now() + interval '72 hours';
begin
  if not internal.feature_is_open('organization_topup') then
    raise exception 'ORGANIZATION_TOPUP_CLOSED';
  end if;
  if not internal.has_organization_role(
    target_organization, array['owner', 'finance']
  ) then
    raise exception 'ORGANIZATION_FINANCE_REQUIRED';
  end if;
  if requested_points <= 0 or requested_points > 10000000 then
    raise exception 'TOPUP_POINTS_INVALID';
  end if;
  select * into existing from public.point_topups
  where organization_id = target_organization and idempotency_key = idempotency;
  if found then
    return jsonb_build_object(
      'topupId', existing.id, 'status', existing.status,
      'expiresAt', existing.transfer_due_at
    );
  end if;
  if not exists (
    select 1 from public.legal_acceptances acceptance
    join public.legal_documents legal
      on legal.id = acceptance.legal_document_id
    where acceptance.id = legal_acceptance
      and acceptance.person_id = actor
      and acceptance.second_confirmed_at is not null
      and legal.kind = 'b2b_contract'
      and legal.approved_by_legal
  ) then
    raise exception 'B2B_CONTRACT_CONFIRMATION_REQUIRED';
  end if;
  select setting.value into bank_setting
  from public.operating_setting_revisions setting
  where setting.setting_key = 'bank_account'
    and setting.effective_at <= now()
    and (setting.superseded_at is null or setting.superseded_at > now())
  order by setting.revision desc limit 1;
  if bank_setting is null
     or bank_setting ->> 'bankName' is null
     or bank_setting ->> 'bankCode' is null
     or bank_setting ->> 'accountName' is null
     or bank_setting ->> 'accountNumber' is null
     or bank_setting ->> 'maskedAccount' is null
  then
    raise exception 'BANK_CONFIGURATION_MISSING';
  end if;
  insert into public.point_topups (
    organization_id, requested_by, points, amount_due_twd,
    legal_acceptance_id, transfer_due_at, idempotency_key
  ) values (
    target_organization, actor, requested_points, requested_points,
    legal_acceptance, transfer_due, idempotency
  ) returning id into topup_id;
  insert into public.bank_payment_instructions (
    topup_id, bank_name_snapshot, bank_code_snapshot,
    account_name_snapshot, account_number_snapshot, masked_account_snapshot,
    amount_twd, expires_at
  ) values (
    topup_id, bank_setting ->> 'bankName', bank_setting ->> 'bankCode',
    bank_setting ->> 'accountName', bank_setting ->> 'accountNumber',
    bank_setting ->> 'maskedAccount', requested_points, transfer_due
  );
  perform internal.append_audit_event(
    actor, 'organization.topup_created', 'point_topup', topup_id::text,
    'manual bank point purchase', target_organization,
    jsonb_build_object('points', requested_points, 'twdPerPoint', 1)
  );
  return jsonb_build_object(
    'topupId', topup_id, 'status', 'pending_transfer',
    'expiresAt', transfer_due
  );
end
$$;
revoke all on function internal.create_point_topup(
  uuid, integer, uuid, uuid
) from public;

create or replace function public.create_point_topup(
  p_organization_id uuid,
  p_points integer,
  p_legal_acceptance_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.create_point_topup(
    p_organization_id, p_points, p_legal_acceptance_id, p_idempotency_key
  )
$$;

create or replace function internal.submit_point_topup_proof(
  target_topup uuid,
  remitter text,
  bank text,
  last_five text,
  transferred timestamptz,
  amount integer,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  topup public.point_topups%rowtype;
begin
  select * into topup from public.point_topups
  where id = target_topup and requested_by = actor
  for update;
  if not found
     or topup.status not in ('pending_transfer', 'proof_submitted')
     or topup.transfer_due_at < transferred
  then
    raise exception 'TOPUP_PROOF_REJECTED';
  end if;
  insert into public.payment_proofs (
    topup_id, submitted_by, remitter_name, bank_name, account_last_five,
    transferred_at, amount_twd, scan_status, idempotency_key
  ) values (
    topup.id, actor, remitter, bank, last_five, transferred, amount,
    'not_provided', idempotency
  ) on conflict (submitted_by, idempotency_key) do nothing;
  update public.point_topups set status = 'proof_submitted'
  where id = topup.id and status = 'pending_transfer';
  perform internal.append_audit_event(
    actor, 'organization.topup_proof_submitted', 'point_topup',
    topup.id::text, 'proof is evidence only and does not mint points',
    topup.organization_id, jsonb_build_object('amountTwd', amount)
  );
  return jsonb_build_object('status', 'proof_submitted');
end
$$;
revoke all on function internal.submit_point_topup_proof(
  uuid, text, text, text, timestamptz, integer, uuid
) from public;

create or replace function public.submit_point_topup_proof(
  p_topup_id uuid,
  p_remitter_name text,
  p_bank_name text,
  p_account_last_five text,
  p_transferred_at timestamptz,
  p_amount_twd integer,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.submit_point_topup_proof(
    p_topup_id, p_remitter_name, p_bank_name, p_account_last_five,
    p_transferred_at, p_amount_twd, p_idempotency_key
  )
$$;

create or replace function internal.read_own_point_topup(target_topup uuid)
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
  select jsonb_build_object(
    'topupId', topup.id,
    'status', topup.status,
    'points', topup.points,
    'amountDueTwd', topup.amount_due_twd,
    'transferDueAt', topup.transfer_due_at,
    'bankName', instructions.bank_name_snapshot,
    'bankCode', instructions.bank_code_snapshot,
    'accountName', instructions.account_name_snapshot,
    'accountNumber', instructions.account_number_snapshot
  ) into result
  from public.point_topups topup
  join public.bank_payment_instructions instructions
    on instructions.topup_id = topup.id
  where topup.id = target_topup
    and (
      topup.requested_by = actor
      or internal.has_organization_role(
        topup.organization_id, array['owner', 'finance']
      )
    );
  if result is null then raise exception 'TOPUP_NOT_FOUND'; end if;
  return result;
end
$$;
revoke all on function internal.read_own_point_topup(uuid) from public;

create or replace function public.read_own_point_topup(p_topup_id uuid)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_own_point_topup(p_topup_id)
$$;

create or replace function internal.allocate_bank_transaction_to_topup(
  target_transaction uuid,
  target_topup uuid,
  allocated_amount integer,
  allocation_reason text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  allocation_id uuid;
begin
  if not internal.has_staff_role('finance') then
    raise exception 'FINANCE_ROLE_REQUIRED';
  end if;
  perform 1
  from public.bank_transactions transaction_row
  join public.bank_import_batches batch
    on batch.id = transaction_row.batch_id
  where transaction_row.id = target_transaction
    and batch.reconciled_at is not null
  for update of transaction_row;
  if not found then raise exception 'BANK_TRANSACTION_NOT_FOUND'; end if;
  perform 1 from public.point_topups
  where id = target_topup
    and status in ('pending_transfer', 'proof_submitted', 'payment_review')
  for update;
  if not found then raise exception 'TOPUP_NOT_ALLOCATABLE'; end if;
  insert into public.bank_transaction_allocations (
    bank_transaction_id, topup_id, allocation_kind, amount_twd,
    allocated_by, idempotency_key, reason
  ) values (
    target_transaction, target_topup, 'allocation', allocated_amount,
    actor, idempotency, allocation_reason
  ) returning id into allocation_id;
  update public.point_topups set status = 'payment_review'
  where id = target_topup;
  perform internal.append_audit_event(
    actor, 'bank_transaction.allocated_to_topup', 'point_topup',
    target_topup::text, allocation_reason, null,
    jsonb_build_object(
      'allocationId', allocation_id, 'amountTwd', allocated_amount,
      'requiresSecondReview', true
    )
  );
  return jsonb_build_object(
    'allocationId', allocation_id,
    'status', 'payment_review',
    'requiresSecondReview', true
  );
end
$$;
revoke all on function internal.allocate_bank_transaction_to_topup(
  uuid, uuid, integer, text, uuid
) from public;

create or replace function public.allocate_bank_transaction_to_topup(
  p_bank_transaction_id uuid,
  p_topup_id uuid,
  p_amount_twd integer,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.allocate_bank_transaction_to_topup(
    p_bank_transaction_id, p_topup_id, p_amount_twd,
    p_reason, p_idempotency_key
  )
$$;

create or replace function internal.confirm_topup_bank_allocation(
  target_allocation uuid,
  review_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  allocation public.bank_transaction_allocations%rowtype;
  topup public.point_topups%rowtype;
  paid_total integer;
  lot_id uuid;
begin
  if not internal.has_staff_role('finance') then
    raise exception 'FINANCE_ROLE_REQUIRED';
  end if;
  select * into allocation from public.bank_transaction_allocations
  where id = target_allocation and topup_id is not null
  for update;
  if not found
     or allocation.allocated_by = actor
     or exists (
       select 1 from public.bank_allocation_reviews review
       where review.allocation_id = target_allocation
     )
  then
    raise exception 'DISTINCT_SECOND_REVIEW_REQUIRED';
  end if;
  insert into public.bank_allocation_reviews (
    allocation_id, reviewer_id, reason
  ) values (allocation.id, actor, review_reason);
  select * into topup from public.point_topups
  where id = allocation.topup_id for update;
  select coalesce(sum(
    case when item.allocation_kind = 'allocation'
      then item.amount_twd else -item.amount_twd end
  ), 0) into paid_total
  from public.bank_transaction_allocations item
  where item.topup_id = topup.id;
  if paid_total <> topup.amount_due_twd
     or exists (
       select 1
       from public.bank_transaction_allocations item
       left join public.bank_allocation_reviews review
         on review.allocation_id = item.id
       where item.topup_id = topup.id
         and item.allocation_kind = 'allocation'
         and review.id is null
     )
  then
    return jsonb_build_object('status', 'payment_review');
  end if;
  if topup.status <> 'paid' then
    insert into public.point_lots (
      organization_id, point_topup_id, purchased_points, available_points,
      purchased_at
    ) values (
      topup.organization_id, topup.id, topup.points, topup.points, now()
    ) returning id into lot_id;
    insert into public.point_ledger_events (
      organization_id, point_lot_id, event_type, points, topup_id,
      actor_id, idempotency_key, reason
    ) values (
      topup.organization_id, lot_id, 'minted', topup.points, topup.id,
      actor, gen_random_uuid(), 'two-person bank confirmation'
    );
    update public.organization_wallets
    set available_points = available_points + topup.points,
        ledger_version = ledger_version + 1,
        updated_at = now()
    where organization_id = topup.organization_id;
    update public.point_topups
    set status = 'paid', amount_paid_twd = paid_total,
        first_confirmed_by = allocation.allocated_by,
        second_confirmed_by = actor, paid_at = now()
    where id = topup.id;
    insert into public.invoice_records (point_topup_id, amount_twd)
    values (topup.id, paid_total)
    on conflict do nothing;
    insert into public.notifications (
      person_id, category, title, body, business_key
    ) values (
      topup.requested_by, 'organization', '機構點數已入帳',
      '銀行實際入帳已由兩位財務人員確認，點數已加入機構錢包。',
      'topup-paid:' || topup.id::text
    ) on conflict (person_id, business_key) do nothing;
    insert into public.notification_outbox (
      notification_id, channel, destination_ciphertext,
      template_key, template_data, business_idempotency_key
    )
    select
      notification.id, channel.name, '{}'::jsonb, 'topup_confirmed',
      jsonb_build_object('topupId', topup.id),
      'topup-paid:' || channel.name || ':' || topup.id::text
    from public.notifications notification
    cross join (values ('sms'), ('email')) as channel(name)
    where notification.person_id = topup.requested_by
      and notification.business_key = 'topup-paid:' || topup.id::text
      and (
        channel.name = 'sms'
        or exists (
          select 1 from public.people person
          where person.id = topup.requested_by
            and person.email_verified_at is not null
        )
      )
    on conflict (business_idempotency_key) do nothing;
  end if;
  perform internal.append_audit_event(
    actor, 'organization.topup_second_confirmed', 'point_topup',
    topup.id::text, review_reason, topup.organization_id,
    jsonb_build_object('points', topup.points)
  );
  return jsonb_build_object('status', 'paid', 'mintedPoints', topup.points);
end
$$;
revoke all on function internal.confirm_topup_bank_allocation(uuid, text)
  from public;

create or replace function public.confirm_topup_bank_allocation(
  p_allocation_id uuid,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.confirm_topup_bank_allocation(p_allocation_id, p_reason)
$$;

create or replace function internal.start_email_verification(
  normalized_email text,
  submitted_code_hmac text,
  request_ip inet
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  challenge_id uuid;
  recent_count integer;
begin
  if normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+$'
     or submitted_code_hmac !~ '^[a-f0-9]{64}$'
  then
    raise exception 'EMAIL_VERIFICATION_INVALID';
  end if;
  select count(*) into recent_count
  from private.email_verification_challenges challenge
  where challenge.person_id = actor
    and challenge.created_at > now() - interval '1 hour';
  if recent_count >= 5 then raise exception 'EMAIL_VERIFICATION_RATE_LIMIT'; end if;
  update private.email_verification_challenges
  set replaced_at = now()
  where person_id = actor
    and lower(private.email_verification_challenges.normalized_email)
      = lower(normalized_email)
    and consumed_at is null
    and replaced_at is null;
  insert into private.email_verification_challenges (
    person_id, normalized_email, code_hmac, expires_at, request_ip
  ) values (
    actor, lower(normalized_email), submitted_code_hmac,
    now() + interval '10 minutes', request_ip
  ) returning id into challenge_id;
  return challenge_id;
end
$$;
revoke all on function internal.start_email_verification(text, text, inet)
  from public;

create or replace function public.start_email_verification(
  p_normalized_email text,
  p_code_hmac text,
  p_request_ip inet
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.start_email_verification(
    p_normalized_email, p_code_hmac, p_request_ip
  )
$$;

create or replace function internal.confirm_email_verification(
  normalized_email text,
  submitted_code_hmac text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  challenge private.email_verification_challenges%rowtype;
begin
  select * into challenge
  from private.email_verification_challenges
  where person_id = actor
    and lower(private.email_verification_challenges.normalized_email)
      = lower(normalized_email)
    and consumed_at is null
    and replaced_at is null
  order by created_at desc limit 1
  for update;
  if not found or challenge.expires_at <= now() then
    raise exception 'EMAIL_VERIFICATION_EXPIRED';
  end if;
  if challenge.code_hmac <> submitted_code_hmac then
    update private.email_verification_challenges
    set error_count = error_count + 1,
        replaced_at = case when error_count + 1 >= 5 then now() end
    where id = challenge.id;
    return false;
  end if;
  update private.email_verification_challenges
  set consumed_at = now() where id = challenge.id;
  update public.people
  set verified_email = lower(normalized_email),
      email_verified_at = now()
  where id = actor;
  perform internal.append_audit_event(
    actor, 'identity.email_verified', 'person', actor::text,
    'contact email verification', null, '{}'::jsonb
  );
  return true;
end
$$;
revoke all on function internal.confirm_email_verification(text, text)
  from public;

create or replace function public.confirm_email_verification(
  p_normalized_email text,
  p_code_hmac text
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.confirm_email_verification(
    p_normalized_email, p_code_hmac
  )
$$;

create or replace function internal.consume_route_rate_limit(
  submitted_scope_hash text,
  submitted_action text,
  submitted_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  next_count integer;
begin
  if auth.role() <> 'service_role'
     or submitted_scope_hash !~ '^[a-f0-9]{64}$'
     or submitted_action = ''
     or submitted_limit not between 1 and 1000
  then
    return false;
  end if;
  insert into public.rate_limit_counters (
    scope_hash, action, window_started_at, count
  ) values (
    submitted_scope_hash, submitted_action, date_trunc('minute', now()), 1
  )
  on conflict (scope_hash, action, window_started_at)
  do update set count = public.rate_limit_counters.count + 1
  returning count into next_count;
  return next_count <= submitted_limit;
end
$$;
revoke all on function internal.consume_route_rate_limit(
  text, text, integer
) from public;

create or replace function public.consume_route_rate_limit(
  p_scope_hash text,
  p_action text,
  p_limit integer
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.consume_route_rate_limit(
    p_scope_hash, p_action, p_limit
  )
$$;

create or replace function internal.assess_post_otp_identity(
  target_auth_user uuid,
  submitted_device_hash text,
  submitted_risk_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  identity_row public.auth_identities%rowtype;
  high_value boolean;
  next_epoch bigint;
begin
  if auth.role() <> 'service_role'
     or submitted_device_hash !~ '^[a-f0-9]{64}$'
     or submitted_risk_decision not in ('trusted', 'review', 'unknown')
  then raise exception 'IDENTITY_RISK_ASSESSMENT_REJECTED'; end if;
  select * into identity_row from public.auth_identities
  where auth_user_id = target_auth_user and active for update;
  if not found then raise exception 'AUTH_IDENTITY_NOT_FOUND'; end if;
  select
    exists (
      select 1 from public.orders order_row
      where order_row.person_id = identity_row.person_id
        and order_row.status in ('paid', 'paid_unfulfilled')
    )
    or exists (
      select 1 from public.entitlements entitlement
      where entitlement.person_id = identity_row.person_id
    )
    or exists (
      select 1
      from public.enrollments enrollment
      join public.certificates certificate
        on certificate.enrollment_id = enrollment.id
      where enrollment.person_id = identity_row.person_id
    )
    or exists (
      select 1 from private.accreditation_identity_profiles profile
      where profile.person_id = identity_row.person_id
    )
  into high_value;
  if high_value and submitted_risk_decision <> 'trusted' then
    update public.people
    set identity_epoch = identity_epoch + 1
    where id = identity_row.person_id
    returning identity_epoch into next_epoch;
    update public.auth_identities
    set restricted = true,
        restriction_reason = 'post-OTP high-value identity review required',
        identity_epoch = next_epoch,
        session_valid_after = clock_timestamp()
    where id = identity_row.id;
    perform internal.append_audit_event(
      identity_row.person_id, 'identity.restricted_after_otp',
      'auth_identity', identity_row.id::text,
      'high-value account risk decision was not trusted', null,
      jsonb_build_object('riskDecision', submitted_risk_decision)
    );
    return jsonb_build_object(
      'restricted', true,
      'reason', 'HIGH_ASSURANCE_RECOVERY_REQUIRED'
    );
  end if;
  if not identity_row.restricted then
    update public.auth_identities
    set trusted_device_verified_at = case
          when submitted_risk_decision = 'trusted' then now()
          else trusted_device_verified_at
        end,
        last_high_assurance_at = case
          when submitted_risk_decision = 'trusted' then now()
          else last_high_assurance_at
        end
    where id = identity_row.id;
  end if;
  return jsonb_build_object(
    'restricted', identity_row.restricted,
    'reason', identity_row.restriction_reason
  );
end
$$;
revoke all on function internal.assess_post_otp_identity(
  uuid, text, text
) from public;

create or replace function public.assess_post_otp_identity(
  p_auth_user_id uuid,
  p_device_hash text,
  p_risk_decision text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.assess_post_otp_identity(
    p_auth_user_id, p_device_hash, p_risk_decision
  )
$$;

create or replace function internal.resolve_restricted_upload_person(
  target_auth_user uuid,
  submitted_purpose text
)
returns uuid
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  result uuid;
begin
  if auth.role() <> 'service_role'
     or submitted_purpose <> 'identity_correction'
  then raise exception 'RESTRICTED_UPLOAD_REJECTED'; end if;
  select identity.person_id into result
  from public.auth_identities identity
  where identity.auth_user_id = target_auth_user
    and identity.active and identity.restricted;
  if result is null then raise exception 'RESTRICTED_IDENTITY_REQUIRED'; end if;
  return result;
end
$$;
revoke all on function internal.resolve_restricted_upload_person(
  uuid, text
) from public;

create or replace function public.resolve_restricted_upload_person(
  p_auth_user_id uuid,
  p_purpose text
)
returns uuid
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.resolve_restricted_upload_person(
    p_auth_user_id, p_purpose
  )
$$;

create or replace function internal.open_identity_recovery_case(
  target_auth_user uuid,
  submitted_kind text,
  submitted_evidence_summary text,
  target_upload uuid,
  idempotency uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_person uuid;
  existing_case uuid;
  recovery_id uuid;
begin
  if auth.role() <> 'service_role'
     or submitted_kind not in (
       'lost_phone', 'recycled_number', 'totp_recovery'
     )
     or length(trim(submitted_evidence_summary)) < 20
  then raise exception 'IDENTITY_RECOVERY_REQUEST_REJECTED'; end if;
  select identity.person_id into target_person
  from public.auth_identities identity
  where identity.auth_user_id = target_auth_user
    and identity.active and identity.restricted
  for update;
  if target_person is null then
    raise exception 'RESTRICTED_IDENTITY_REQUIRED';
  end if;
  select recovery_case.id into existing_case
  from public.identity_recovery_cases recovery_case
  where recovery_case.idempotency_key = idempotency;
  if found then return existing_case; end if;
  if not exists (
    select 1 from public.upload_quarantine upload
    where upload.id = target_upload
      and upload.owner_person_id = target_person
      and upload.purpose = 'identity_correction'
      and upload.status = 'promoted'
  ) then raise exception 'SAFE_RECOVERY_EVIDENCE_REQUIRED'; end if;
  insert into public.identity_recovery_cases (
    person_id, kind, submitted_by, evidence_summary,
    replacement_auth_user_id, idempotency_key, evidence_upload_id
  ) values (
    target_person, submitted_kind, target_person,
    trim(submitted_evidence_summary), target_auth_user,
    idempotency, target_upload
  ) returning id into recovery_id;
  perform internal.append_audit_event(
    target_person, 'identity.recovery_requested',
    'identity_recovery_case', recovery_id::text,
    'restricted account submitted high-assurance recovery evidence',
    null, jsonb_build_object('kind', submitted_kind, 'uploadId', target_upload)
  );
  return recovery_id;
end
$$;
revoke all on function internal.open_identity_recovery_case(
  uuid, text, text, uuid, uuid
) from public;

create or replace function public.open_identity_recovery_case(
  p_auth_user_id uuid,
  p_kind text,
  p_evidence_summary text,
  p_upload_id uuid,
  p_idempotency_key uuid
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.open_identity_recovery_case(
    p_auth_user_id, p_kind, p_evidence_summary,
    p_upload_id, p_idempotency_key
  )
$$;

create or replace function internal.read_identity_encryption_bundle(
  target_person uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, private
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'IDENTITY_SERVICE_AUTHORITY_REQUIRED';
  end if;
  select jsonb_build_object(
    'wrappedDek', key.wrapped_dek,
    'kekVersion', key.kek_version,
    'encryptedFields', profile.encrypted_fields,
    'status', profile.status
  ) into result
  from private.person_encryption_keys key
  left join private.accreditation_identity_profiles profile
    on profile.person_id = key.person_id
  where key.person_id = target_person;
  return coalesce(result, '{}'::jsonb);
end
$$;
revoke all on function internal.read_identity_encryption_bundle(uuid)
  from public;

create or replace function public.read_identity_encryption_bundle(
  p_person_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, private, internal
as $$
  select internal.read_identity_encryption_bundle(p_person_id)
$$;

create or replace function internal.ensure_person_encryption_key(
  target_person uuid,
  submitted_wrapped_dek jsonb,
  submitted_kek_version text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role' or submitted_kek_version = '' then
    raise exception 'IDENTITY_SERVICE_AUTHORITY_REQUIRED';
  end if;
  insert into private.person_encryption_keys (
    person_id, wrapped_dek, kek_version
  ) values (
    target_person, submitted_wrapped_dek, submitted_kek_version
  )
  on conflict (person_id) do nothing;
  select jsonb_build_object(
    'wrappedDek', wrapped_dek, 'kekVersion', kek_version
  ) into result
  from private.person_encryption_keys
  where person_id = target_person
  for update;
  return result;
end
$$;
revoke all on function internal.ensure_person_encryption_key(
  uuid, jsonb, text
) from public;

create or replace function public.ensure_person_encryption_key(
  p_person_id uuid,
  p_wrapped_dek jsonb,
  p_kek_version text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.ensure_person_encryption_key(
    p_person_id, p_wrapped_dek, p_kek_version
  )
$$;

create or replace function internal.upsert_accreditation_identity_profile(
  target_person uuid,
  target_enrollment uuid,
  submitted_encrypted_fields jsonb,
  submitted_wrapped_dek jsonb,
  submitted_kek_version text,
  national_index_current text,
  national_index_previous text,
  care_index_current text,
  care_index_previous text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  profile_id uuid;
  confirmed_profile_revision integer;
begin
  if auth.role() <> 'service_role'
     or national_index_current !~ '^[a-f0-9]{64}$'
     or care_index_current !~ '^[a-f0-9]{64}$'
     or (
       national_index_previous is not null
       and national_index_previous !~ '^[a-f0-9]{64}$'
     )
     or (
       care_index_previous is not null
       and care_index_previous !~ '^[a-f0-9]{64}$'
     )
  then
    raise exception 'IDENTITY_PROFILE_REJECTED';
  end if;
  if not exists (
    select 1 from public.enrollments enrollment
    where enrollment.id = target_enrollment
      and enrollment.person_id = target_person
      and enrollment.status = 'active'
  ) then
    raise exception 'IDENTITY_PROFILE_ENROLLMENT_REQUIRED';
  end if;
  if not exists (
    select 1 from private.person_encryption_keys key
    where key.person_id = target_person
      and key.wrapped_dek = submitted_wrapped_dek
      and key.kek_version = submitted_kek_version
  ) then
    raise exception 'IDENTITY_ENCRYPTION_KEY_MISMATCH';
  end if;
  insert into private.accreditation_identity_profiles as profile (
    person_id, encrypted_fields, national_id_blind_index_current,
    national_id_blind_index_previous, care_worker_id_blind_index_current,
    care_worker_id_blind_index_previous, status
  ) values (
    target_person, submitted_encrypted_fields, national_index_current,
    national_index_previous, care_index_current, care_index_previous,
    'submitted'
  )
  on conflict (person_id) do update
  set encrypted_fields = excluded.encrypted_fields,
      profile_revision = profile.profile_revision + 1,
      national_id_blind_index_current =
        excluded.national_id_blind_index_current,
      national_id_blind_index_previous =
        excluded.national_id_blind_index_previous,
      care_worker_id_blind_index_current =
        excluded.care_worker_id_blind_index_current,
      care_worker_id_blind_index_previous =
        excluded.care_worker_id_blind_index_previous,
      status = 'submitted',
      verified_by = null,
      verified_at = null,
      updated_at = now()
  returning profile.id, profile.profile_revision
    into profile_id, confirmed_profile_revision;
  update public.enrollments
  set identity_profile_confirmed_at = now(),
      identity_profile_revision_confirmed = confirmed_profile_revision
  where id = target_enrollment and person_id = target_person;
  update public.identity_verification_cases
  set status = 'closed',
      closed_at = now(),
      reason = 'superseded by a new encrypted identity submission'
  where person_id = target_person
    and status in ('open', 'needs_correction');
  insert into public.identity_verification_cases (
    person_id, profile_id, status, reason
  )
  select
    target_person, profile_id, 'open', 'learner submitted accreditation identity'
  where not exists (
    select 1 from public.identity_verification_cases verification_case
    where verification_case.person_id = target_person
      and verification_case.status in ('open', 'needs_correction')
  );
  perform internal.append_audit_event(
    target_person, 'identity_profile.submitted', 'identity_profile',
    profile_id::text, 'encrypted accreditation identity submitted',
    null, jsonb_build_object('enrollmentId', target_enrollment)
  );
  return jsonb_build_object(
    'profileId', profile_id,
    'profileRevision', confirmed_profile_revision,
    'status', 'submitted'
  );
end
$$;
revoke all on function internal.upsert_accreditation_identity_profile(
  uuid, uuid, jsonb, jsonb, text, text, text, text, text
) from public;

create or replace function public.upsert_accreditation_identity_profile(
  p_person_id uuid,
  p_enrollment_id uuid,
  p_encrypted_fields jsonb,
  p_wrapped_dek jsonb,
  p_kek_version text,
  p_national_index_current text,
  p_national_index_previous text,
  p_care_index_current text,
  p_care_index_previous text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.upsert_accreditation_identity_profile(
    p_person_id, p_enrollment_id, p_encrypted_fields, p_wrapped_dek,
    p_kek_version, p_national_index_current, p_national_index_previous,
    p_care_index_current, p_care_index_previous
  )
$$;

create or replace function internal.reconfirm_accreditation_identity(
  target_enrollment uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  current_profile_revision integer;
  reconfirmed_at timestamptz := clock_timestamp();
begin
  select profile.profile_revision into current_profile_revision
  from public.enrollments enrollment
  join public.entitlements entitlement
    on entitlement.id = enrollment.entitlement_id
  join private.accreditation_identity_profiles profile
    on profile.person_id = enrollment.person_id
  where enrollment.id = target_enrollment
    and enrollment.person_id = actor
    and enrollment.status = 'active'
    and entitlement.status = 'active'
    and profile.status = 'verified'
  for update of enrollment, profile;
  if not found then
    raise exception 'VERIFIED_IDENTITY_RECONFIRMATION_REQUIRED';
  end if;

  update public.enrollments
  set identity_profile_confirmed_at = reconfirmed_at,
      identity_profile_revision_confirmed = current_profile_revision
  where id = target_enrollment
    and person_id = actor
    and status = 'active';

  perform internal.append_audit_event(
    actor, 'identity_profile.reconfirmed', 'enrollment',
    target_enrollment::text,
    'verified identity profile reconfirmed for this enrollment',
    null,
    jsonb_build_object('profileRevision', current_profile_revision)
  );
  return jsonb_build_object(
    'status', 'verified',
    'profileRevision', current_profile_revision,
    'reconfirmedAt', reconfirmed_at
  );
end
$$;
revoke all on function internal.reconfirm_accreditation_identity(uuid)
  from public;

create or replace function public.reconfirm_accreditation_identity(
  p_enrollment_id uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.reconfirm_accreditation_identity(p_enrollment_id)
$$;

create or replace function internal.issue_step_up_grant(
  submitted_action text,
  submitted_target text,
  submitted_nonce_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  actor_epoch bigint;
  grant_id uuid;
begin
  if submitted_action is null
     or submitted_target is null
     or submitted_nonce_hash is null
     or submitted_action not in (
    'host_join', 'course_publish', 'accreditation_export',
    'accreditation_result', 'pii_decrypt',
    'certificate_revoke', 'attendance_override', 'role_change',
    'invoice_decision', 'point_refund_decision',
    'point_refund_account', 'point_refund_result',
    'identity_recovery', 'deletion_approve', 'refund_decision',
    'refund_account', 'refund_disbursement',
    'bank_reconciliation', 'emergency_suspend',
    'platform_prerequisite_review'
  )
     or submitted_target = ''
     or length(submitted_target) > 200
     or submitted_nonce_hash !~ '^[a-f0-9]{64}$'
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (
       select 1
       from jsonb_array_elements(
         coalesce(auth.jwt() -> 'amr', '[]'::jsonb)
       ) method
       where method ->> 'method' = 'totp'
         and coalesce(method ->> 'timestamp', '') ~ '^[0-9]+$'
         and to_timestamp((method ->> 'timestamp')::double precision)
           >= now() - interval '2 minutes'
     )
     or not exists (
       select 1 from public.staff_roles role
       where role.person_id = actor and role.active
     )
  then
    raise exception 'FRESH_TOTP_STEP_UP_REQUIRED';
  end if;
  select identity_epoch into actor_epoch
  from public.people where id = actor;
  insert into private.step_up_grants (
    actor_id, action, target, nonce_hash, identity_epoch,
    totp_verified_at, expires_at
  ) values (
    actor, submitted_action, submitted_target, submitted_nonce_hash,
    actor_epoch, now(), now() + interval '5 minutes'
  )
  returning id into grant_id;
  return grant_id;
end
$$;
revoke all on function internal.issue_step_up_grant(text, text, text)
  from public;

create or replace function public.issue_step_up_grant(
  p_action text,
  p_target text,
  p_nonce_hash text
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.issue_step_up_grant(p_action, p_target, p_nonce_hash)
$$;

create or replace function internal.consume_step_up_grant(
  required_action text,
  required_target text,
  submitted_nonce_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  consumed_id uuid;
begin
  update private.step_up_grants grant_row
  set consumed_at = now()
  from public.people person
  where grant_row.actor_id = actor
    and person.id = actor
    and grant_row.action = required_action
    and grant_row.target = required_target
    and grant_row.nonce_hash = submitted_nonce_hash
    and grant_row.identity_epoch = person.identity_epoch
    and grant_row.consumed_at is null
    and grant_row.totp_verified_at >= now() - interval '5 minutes'
    and grant_row.expires_at > now()
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
  returning grant_row.id into consumed_id;
  if consumed_id is null then
    raise exception 'STEP_UP_GRANT_REQUIRED';
  end if;
  return true;
end
$$;
revoke all on function internal.consume_step_up_grant(text, text, text)
  from public;

create or replace function internal.request_staff_role_change(
  target_person uuid,
  submitted_role text,
  submitted_action text,
  submitted_reason text,
  submitted_nonce_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  request_id uuid;
begin
  perform internal.consume_step_up_grant(
    'role_change',
    target_person::text || ':' || submitted_role || ':' || submitted_action,
    submitted_nonce_hash
  );
  if not internal.has_staff_role('platform_admin')
     or submitted_role not in (
       'instructor', 'course_admin', 'accreditation_reviewer',
       'finance', 'support', 'platform_admin'
     )
     or submitted_action not in ('grant', 'revoke')
     or length(trim(submitted_reason)) < 10
     or not exists (
       select 1 from public.people person
       where person.id = target_person and person.anonymized_at is null
     )
     or (
       submitted_action = 'grant'
       and exists (
         select 1 from public.staff_roles role
         where role.person_id = target_person
           and role.role = submitted_role and role.active
       )
     )
     or (
       submitted_action = 'revoke'
       and not exists (
         select 1 from public.staff_roles role
         where role.person_id = target_person
           and role.role = submitted_role and role.active
       )
     )
  then raise exception 'ROLE_CHANGE_REQUEST_REJECTED'; end if;
  insert into public.role_approval_requests (
    subject_person_id, requested_role, requested_action,
    requested_by, reason
  ) values (
    target_person, submitted_role, submitted_action,
    actor, trim(submitted_reason)
  ) returning id into request_id;
  perform internal.append_audit_event(
    actor, 'role.change_requested', 'role_approval_request',
    request_id::text, trim(submitted_reason), null,
    jsonb_build_object(
      'subjectPersonId', target_person,
      'role', submitted_role,
      'action', submitted_action
    )
  );
  return request_id;
end
$$;
revoke all on function internal.request_staff_role_change(
  uuid, text, text, text, text
) from public;

create or replace function public.request_staff_role_change(
  p_subject_person_id uuid,
  p_role text,
  p_action text,
  p_reason text,
  p_nonce_hash text
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.request_staff_role_change(
    p_subject_person_id, p_role, p_action, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.decide_staff_role_change(
  target_request uuid,
  submitted_decision text,
  submitted_reason text,
  submitted_nonce_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  request_row public.role_approval_requests%rowtype;
  next_epoch bigint;
begin
  perform internal.consume_step_up_grant(
    'role_change', target_request::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('platform_admin')
     or submitted_decision not in ('approve', 'reject')
     or length(trim(submitted_reason)) < 10
  then raise exception 'ROLE_CHANGE_DECISION_REJECTED'; end if;
  select * into request_row
  from public.role_approval_requests
  where id = target_request for update;
  if not found or request_row.status <> 'pending'
     or request_row.requested_by = actor
     or request_row.subject_person_id = actor
  then raise exception 'DISTINCT_ROLE_REVIEWER_REQUIRED'; end if;
  insert into public.role_approval_decisions (
    request_id, reviewer_id, decision, reason
  ) values (
    target_request, actor, submitted_decision, trim(submitted_reason)
  );
  if submitted_decision = 'reject' then
    update public.role_approval_requests
    set status = 'rejected', decided_at = now()
    where id = target_request;
    perform internal.append_audit_event(
      actor, 'role.change_rejected', 'role_approval_request',
      target_request::text, trim(submitted_reason), null, '{}'::jsonb
    );
    return 'rejected';
  end if;
  if request_row.requested_action = 'revoke'
     and request_row.requested_role = 'platform_admin'
     and (
       select count(*) from public.staff_roles role
       where role.role = 'platform_admin' and role.active
         and role.person_id <> request_row.subject_person_id
     ) < 2
  then raise exception 'TWO_PLATFORM_ADMINS_MUST_REMAIN'; end if;
  if request_row.requested_action = 'grant' then
    insert into public.staff_roles (
      person_id, role, active, approved_request_id, revoked_at
    ) values (
      request_row.subject_person_id, request_row.requested_role,
      true, request_row.id, null
    ) on conflict (person_id, role) do update
      set active = true,
          approved_request_id = excluded.approved_request_id,
          revoked_at = null;
  else
    update public.staff_roles
    set active = false, revoked_at = now(),
        approved_request_id = request_row.id
    where person_id = request_row.subject_person_id
      and role = request_row.requested_role and active;
  end if;
  update public.role_approval_requests
  set status = 'approved', decided_at = now()
  where id = target_request;
  update public.people
  set identity_epoch = identity_epoch + 1
  where id = request_row.subject_person_id
  returning identity_epoch into next_epoch;
  update public.auth_identities
  set identity_epoch = next_epoch,
      session_valid_after = clock_timestamp()
  where person_id = request_row.subject_person_id and active;
  perform internal.append_audit_event(
    actor, 'role.change_approved', 'role_approval_request',
    target_request::text, trim(submitted_reason), null,
    jsonb_build_object(
      'subjectPersonId', request_row.subject_person_id,
      'role', request_row.requested_role,
      'action', request_row.requested_action,
      'identityEpoch', next_epoch
    )
  );
  return 'approved';
end
$$;
revoke all on function internal.decide_staff_role_change(
  uuid, text, text, text
) from public;

create or replace function public.decide_staff_role_change(
  p_request_id uuid,
  p_decision text,
  p_reason text,
  p_nonce_hash text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.decide_staff_role_change(
    p_request_id, p_decision, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.decide_identity_recovery_case(
  target_case uuid,
  submitted_decision text,
  submitted_reason text,
  submitted_nonce_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  case_row public.identity_recovery_cases%rowtype;
  approvals integer;
begin
  perform internal.consume_step_up_grant(
    'identity_recovery', target_case::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('platform_admin')
     or submitted_decision not in ('approve', 'reject')
     or length(trim(submitted_reason)) < 10
  then raise exception 'IDENTITY_RECOVERY_DECISION_REJECTED'; end if;
  select * into case_row from public.identity_recovery_cases
  where id = target_case for update;
  if not found
     or case_row.status not in ('submitted', 'reviewing')
     or case_row.person_id = actor
     or case_row.submitted_by = actor
  then raise exception 'IDENTITY_RECOVERY_NOT_REVIEWABLE'; end if;
  insert into public.identity_recovery_decisions (
    recovery_case_id, reviewer_id, decision, reason
  ) values (
    target_case, actor, submitted_decision, trim(submitted_reason)
  ) on conflict (recovery_case_id, reviewer_id) do nothing;
  if submitted_decision = 'reject' then
    update public.identity_recovery_cases
    set status = 'rejected', completed_at = now()
    where id = target_case;
    perform internal.append_audit_event(
      actor, 'identity.recovery_rejected', 'identity_recovery_case',
      target_case::text, trim(submitted_reason), null, '{}'::jsonb
    );
    return 'rejected';
  end if;
  select count(distinct reviewer_id) into approvals
  from public.identity_recovery_decisions
  where recovery_case_id = target_case and decision = 'approve';
  if approvals < 2 then
    update public.identity_recovery_cases set status = 'reviewing'
    where id = target_case;
    return 'reviewing';
  end if;
  update public.identity_recovery_cases
  set status = 'cooling_off',
      cooling_off_until = now() + interval '24 hours'
  where id = target_case;
  insert into public.notifications (
    person_id, category, title, body, business_key
  ) values (
    case_row.person_id, 'identity_recovery',
    '帳號復原進入 24 小時冷卻期',
    '兩位不同管理員已核准。若非本人提出，請立即聯絡歲悅學苑。',
    'identity-recovery-cooling:' || target_case::text
  ) on conflict (person_id, business_key) do nothing;
  insert into public.notification_outbox (
    notification_id, channel, destination_ciphertext,
    template_key, template_data, business_idempotency_key,
    available_at
  )
  select
    notification.id, channel.name, '{}'::jsonb,
    'identity_recovery_cooling',
    jsonb_build_object('recoveryCaseId', target_case),
    'identity-recovery-cooling:' || channel.name || ':' || target_case::text,
    now()
  from public.notifications notification
  cross join (values ('sms'), ('email')) as channel(name)
  where notification.person_id = case_row.person_id
    and notification.business_key =
      'identity-recovery-cooling:' || target_case::text
    and (
      channel.name = 'sms'
      or exists (
        select 1 from public.people person
        where person.id = case_row.person_id
          and person.email_verified_at is not null
      )
    )
  on conflict (business_idempotency_key) do nothing;
  insert into public.durable_jobs (
    job_type, business_key, payload, available_at
  ) values (
    'identity_recovery_complete',
    'identity-recovery-complete:' || target_case::text,
    jsonb_build_object('recoveryCaseId', target_case),
    now() + interval '24 hours'
  ) on conflict (business_key) do nothing;
  perform internal.append_audit_event(
    actor, 'identity.recovery_cooling_started',
    'identity_recovery_case', target_case::text,
    trim(submitted_reason), null,
    jsonb_build_object('approvals', approvals)
  );
  return 'cooling_off';
end
$$;
revoke all on function internal.decide_identity_recovery_case(
  uuid, text, text, text
) from public;

create or replace function public.decide_identity_recovery_case(
  p_recovery_case_id uuid,
  p_decision text,
  p_reason text,
  p_nonce_hash text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.decide_identity_recovery_case(
    p_recovery_case_id, p_decision, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.complete_identity_recovery_case(
  target_case uuid,
  replacement_auth_user uuid,
  submitted_confirmation_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  case_row public.identity_recovery_cases%rowtype;
  replacement_identity uuid;
  next_epoch bigint;
begin
  if auth.role() <> 'service_role'
     or submitted_confirmation_hash !~ '^[a-f0-9]{64}$'
  then raise exception 'IDENTITY_RECOVERY_SERVICE_REJECTED'; end if;
  select * into case_row from public.identity_recovery_cases
  where id = target_case for update;
  if not found
     or case_row.status <> 'cooling_off'
     or case_row.cooling_off_until > now()
     or (
       select count(distinct reviewer_id)
       from public.identity_recovery_decisions
       where recovery_case_id = target_case and decision = 'approve'
     ) < 2
     or not exists (
       select 1 from auth.users auth_user
       where auth_user.id = replacement_auth_user
         and auth_user.phone_confirmed_at is not null
     )
  then raise exception 'IDENTITY_RECOVERY_NOT_COMPLETABLE'; end if;
  select identity.id into replacement_identity
  from public.auth_identities identity
  where identity.auth_user_id = replacement_auth_user
  for update;
  if replacement_identity is null then
    raise exception 'REPLACEMENT_AUTH_IDENTITY_REQUIRED';
  end if;
  update public.people set identity_epoch = identity_epoch + 1
  where id = case_row.person_id
  returning identity_epoch into next_epoch;
  update public.auth_identities
  set active = false, restricted = true,
      restriction_reason = 'superseded by completed recovery',
      session_valid_after = clock_timestamp(), disabled_at = now()
  where person_id = case_row.person_id;
  update public.auth_identities
  set person_id = case_row.person_id,
      active = true, restricted = false, restriction_reason = null,
      identity_epoch = next_epoch,
      session_valid_after = clock_timestamp(),
      last_high_assurance_at = now(), disabled_at = null
  where id = replacement_identity;
  update public.identity_recovery_cases
  set status = 'approved', completed_at = now(),
      replacement_auth_user_id = replacement_auth_user,
      provider_confirmation_hash = submitted_confirmation_hash
  where id = target_case;
  insert into public.notifications (
    person_id, category, title, body, business_key
  ) values (
    case_row.person_id, 'identity_recovery', '帳號復原已完成',
    '所有舊 session 與 TOTP 已由復原控制面撤銷；請重新登入並設定 TOTP。',
    'identity-recovery-completed:' || target_case::text
  ) on conflict (person_id, business_key) do nothing;
  perform internal.append_audit_event(
    case_row.person_id, 'identity.recovery_completed',
    'identity_recovery_case', target_case::text,
    'provider-confirmed recovery after dual approval and cooling period',
    null, jsonb_build_object(
      'identityEpoch', next_epoch,
      'confirmationHash', submitted_confirmation_hash
    )
  );
  return true;
end
$$;
revoke all on function internal.complete_identity_recovery_case(
  uuid, uuid, text
) from public;

create or replace function public.complete_identity_recovery_case(
  p_recovery_case_id uuid,
  p_replacement_auth_user_id uuid,
  p_confirmation_hash text
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.complete_identity_recovery_case(
    p_recovery_case_id, p_replacement_auth_user_id, p_confirmation_hash
  )
$$;

create or replace function internal.read_host_join_context(
  target_session uuid,
  submitted_nonce_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  session_row public.live_sessions%rowtype;
  meeting_row private.zoom_meetings%rowtype;
begin
  perform internal.consume_step_up_grant(
    'host_join', target_session::text, submitted_nonce_hash
  );
  select * into session_row from public.live_sessions
  where id = target_session;
  if not found
     or session_row.status not in ('scheduled', 'open', 'in_progress')
     or now() < session_row.starts_at - interval '60 minutes'
     or now() > session_row.ends_at + interval '60 minutes'
  then
    raise exception 'HOST_JOIN_WINDOW_CLOSED';
  end if;
  if not exists (
    select 1
    from public.staff_roles role
    where role.person_id = actor and role.active
      and (
        role.role in ('course_admin', 'platform_admin')
        or (
          role.role = 'instructor'
          and exists (
            select 1
            from public.course_instructors course_instructor
            join public.instructors instructor
              on instructor.id = course_instructor.instructor_id
            where course_instructor.course_version_id =
              session_row.course_version_id
              and instructor.person_id = actor
              and instructor.active
          )
        )
      )
  ) then
    raise exception 'HOST_ROLE_NOT_ASSIGNED';
  end if;
  select * into meeting_row from private.zoom_meetings
  where live_session_id = target_session;
  if not found
     or not meeting_row.waiting_room
     or not meeting_row.participant_rename_disabled
     or not meeting_row.participant_share_disabled
     or not meeting_row.cloud_recording_disabled
     or not meeting_row.removed_participant_rejoin_disabled
  then
    raise exception 'ZOOM_HOST_CONFIGURATION_UNSAFE';
  end if;
  perform internal.append_audit_event(
    actor, 'zoom.host_join_issued', 'live_session',
    target_session::text, 'fresh TOTP host material issued',
    null, '{}'::jsonb
  );
  return jsonb_build_object(
    'meetingNumber', meeting_row.meeting_number,
    'encryptedPasscode', meeting_row.encrypted_passcode,
    'providerHostId', meeting_row.provider_host_id,
    'displayName', '歲悅學苑主持人'
  );
end
$$;
revoke all on function internal.read_host_join_context(uuid, text)
  from public;

create or replace function public.read_host_join_context(
  p_live_session_id uuid,
  p_nonce_hash text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.read_host_join_context(
    p_live_session_id, p_nonce_hash
  )
$$;

create or replace function internal.create_accreditation_submission_batch(
  target_course_version uuid,
  target_accreditation_revision uuid,
  target_live_session uuid,
  submitted_template_version text,
  idempotency uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  batch_id uuid;
begin
  if not internal.has_staff_role('course_admin')
     or submitted_template_version = ''
     or length(submitted_template_version) > 100
     or not exists (
       select 1
       from public.course_versions version
       join public.course_version_accreditation link
         on link.course_version_id = version.id
       where version.id = target_course_version
         and version.status = 'published'
         and link.accreditation_revision_id =
           target_accreditation_revision
     )
     or (
       target_live_session is not null
       and not exists (
         select 1 from public.live_sessions session
         where session.id = target_live_session
           and session.course_version_id = target_course_version
           and session.status = 'ended'
       )
     )
  then
    raise exception 'ACCREDITATION_BATCH_REJECTED';
  end if;
  insert into public.accreditation_submission_batches (
    course_version_id, accreditation_revision_id, live_session_id,
    template_version, application_idempotency_key, requested_by
  ) values (
    target_course_version, target_accreditation_revision,
    target_live_session, submitted_template_version, idempotency, actor
  ) returning id into batch_id;

  insert into public.accreditation_submission_items (
    batch_id, enrollment_id, eligibility_snapshot_id, status,
    missing_reasons
  )
  select
    batch_id,
    enrollment.id,
    snapshot.id,
    case when coalesce(snapshot.eligible, false)
      and not exists (
        select 1
        from public.live_bookings booking
        join public.attendance_summaries attendance
          on attendance.live_booking_id = booking.id
        where booking.enrollment_id = enrollment.id
          and attendance.quarantined_at is not null
      )
      then 'included' else 'excluded' end,
    to_jsonb(array_remove(array[
      case when snapshot.id is null
        then 'eligibility_snapshot_missing' end,
      case when snapshot.id is not null and not snapshot.entitlement_valid
        then 'entitlement_invalid' end,
      case when snapshot.id is not null and not snapshot.identity_verified
        then 'identity_unverified' end,
      case when snapshot.id is not null
        and not snapshot.recorded_requirement_met
        then 'recorded_requirement_missing' end,
      case when snapshot.id is not null
        and not snapshot.live_requirements_met
        then 'live_requirement_missing' end,
      case when snapshot.id is not null and not snapshot.quiz_passed
        then 'quiz_not_passed' end,
      case when snapshot.id is not null and not snapshot.survey_completed
        then 'survey_missing' end,
      case when snapshot.id is not null and not snapshot.accreditation_valid
        then 'accreditation_invalid' end,
      case when exists (
        select 1
        from public.live_bookings booking
        join public.attendance_summaries attendance
          on attendance.live_booking_id = booking.id
        where booking.enrollment_id = enrollment.id
          and attendance.quarantined_at is not null
      ) then 'late_provider_evidence_pending_review' end
    ], null))
  from public.enrollments enrollment
  left join lateral (
    select eligibility.*
    from public.eligibility_snapshots eligibility
    where eligibility.enrollment_id = enrollment.id
      and eligibility.accreditation_revision_id =
        target_accreditation_revision
    order by eligibility.created_at desc
    limit 1
  ) snapshot on true
  where enrollment.course_version_id = target_course_version
    and (
      target_live_session is null
      or exists (
        select 1 from public.live_bookings booking
        where booking.enrollment_id = enrollment.id
          and booking.live_session_id = target_live_session
      )
    );
  perform internal.append_audit_event(
    actor, 'accreditation.batch_created', 'submission_batch',
    batch_id::text, 'eligibility preview created', null,
    jsonb_build_object(
      'courseVersionId', target_course_version,
      'liveSessionId', target_live_session
    )
  );
  return batch_id;
end
$$;
revoke all on function internal.create_accreditation_submission_batch(
  uuid, uuid, uuid, text, uuid
) from public;

create or replace function public.create_accreditation_submission_batch(
  p_course_version_id uuid,
  p_accreditation_revision_id uuid,
  p_live_session_id uuid,
  p_template_version text,
  p_idempotency_key uuid
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.create_accreditation_submission_batch(
    p_course_version_id, p_accreditation_revision_id,
    p_live_session_id, p_template_version, p_idempotency_key
  )
$$;

create or replace function internal.approve_and_authorize_export(
  target_batch uuid,
  submitted_nonce_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  batch_row public.accreditation_submission_batches%rowtype;
  included_count integer;
begin
  perform internal.consume_step_up_grant(
    'accreditation_export', target_batch::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('accreditation_reviewer') then
    raise exception 'ACCREDITATION_REVIEWER_REQUIRED';
  end if;
  select * into batch_row
  from public.accreditation_submission_batches
  where id = target_batch for update;
  if not found
     or batch_row.status not in ('draft', 'approved')
     or batch_row.requested_by = actor
  then
    raise exception 'DISTINCT_EXPORT_APPROVER_REQUIRED';
  end if;
  perform session.id
  from public.accreditation_submission_items item
  join public.live_bookings booking
    on booking.enrollment_id = item.enrollment_id
  join public.live_sessions session
    on session.id = booking.live_session_id
  where item.batch_id = target_batch
    and item.status = 'included'
  order by session.id
  for update of session;
  update public.accreditation_submission_items item
  set status = 'excluded',
      missing_reasons = coalesce(item.missing_reasons, '[]'::jsonb)
        || jsonb_build_array('late_provider_evidence_pending_review')
  where item.batch_id = target_batch
    and item.status = 'included'
    and exists (
      select 1
      from public.live_bookings booking
      join public.attendance_summaries attendance
        on attendance.live_booking_id = booking.id
      where booking.enrollment_id = item.enrollment_id
        and attendance.quarantined_at is not null
    );
  select count(*) into included_count
  from public.accreditation_submission_items item
  join public.eligibility_snapshots snapshot
    on snapshot.id = item.eligibility_snapshot_id
  where item.batch_id = target_batch
    and item.status = 'included'
    and snapshot.eligible
    and not exists (
      select 1
      from public.live_bookings booking
      join public.attendance_summaries attendance
        on attendance.live_booking_id = booking.id
      where booking.enrollment_id = snapshot.enrollment_id
        and attendance.quarantined_at is not null
    );
  if included_count = 0 then
    raise exception 'EXPORT_HAS_NO_ELIGIBLE_ROWS';
  end if;
  update public.accreditation_submission_batches
  set status = 'approved',
      approved_by = coalesce(approved_by, actor)
  where id = target_batch
    and (approved_by is null or approved_by = actor);
  if not found then raise exception 'EXPORT_APPROVER_MISMATCH'; end if;
  perform internal.append_audit_event(
    actor, 'accreditation.export_authorized', 'submission_batch',
    target_batch::text, 'fresh TOTP and distinct reviewer approved',
    null, jsonb_build_object('rowCount', included_count)
  );
  return jsonb_build_object(
    'actorId', actor,
    'rowCount', included_count,
    'courseVersionId', batch_row.course_version_id,
    'accreditationRevisionId', batch_row.accreditation_revision_id,
    'liveSessionId', batch_row.live_session_id,
    'templateVersion', batch_row.template_version
  );
end
$$;
revoke all on function internal.approve_and_authorize_export(
  uuid, text
) from public;

create or replace function public.approve_and_authorize_export(
  p_batch_id uuid,
  p_nonce_hash text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.approve_and_authorize_export(p_batch_id, p_nonce_hash)
$$;

create or replace function internal.record_accreditation_export(
  target_batch uuid,
  target_actor uuid,
  submitted_object_path text,
  submitted_sha256 text,
  submitted_envelope_key jsonb,
  submitted_row_count integer,
  submitted_filter jsonb,
  submitted_capability_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  export_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'EXPORT_RECORD_REJECTED';
  end if;
  perform session.id
  from public.accreditation_submission_items item
  join public.live_bookings booking
    on booking.enrollment_id = item.enrollment_id
  join public.live_sessions session
    on session.id = booking.live_session_id
  where item.batch_id = target_batch
    and item.status = 'included'
  order by session.id
  for update of session;
  if submitted_object_path = ''
     or submitted_sha256 !~ '^[a-f0-9]{64}$'
     or submitted_capability_hash !~ '^[a-f0-9]{64}$'
     or submitted_row_count <= 0
     or not exists (
       select 1 from public.accreditation_submission_batches batch
       where batch.id = target_batch
         and batch.status = 'approved'
         and batch.approved_by = target_actor
     )
     or exists (
       select 1
       from public.accreditation_submission_items item
       join public.live_bookings booking
         on booking.enrollment_id = item.enrollment_id
       join public.attendance_summaries attendance
         on attendance.live_booking_id = booking.id
       where item.batch_id = target_batch
         and item.status = 'included'
         and attendance.quarantined_at is not null
     )
  then
    raise exception 'EXPORT_RECORD_REJECTED';
  end if;
  insert into private.accreditation_exports (
    batch_id, encrypted_object_path, object_sha256, envelope_key,
    row_count, filter_snapshot, generated_by
  ) values (
    target_batch, submitted_object_path, submitted_sha256,
    submitted_envelope_key, submitted_row_count, submitted_filter,
    target_actor
  ) returning id into export_id;
  insert into private.export_download_capabilities (
    export_id, actor_id, token_hash, expires_at
  ) values (
    export_id, target_actor, submitted_capability_hash,
    now() + interval '10 minutes'
  );
  update public.accreditation_submission_batches
    set status = 'exported'
    where id = target_batch and status = 'approved';
  perform internal.append_audit_event(
    target_actor, 'accreditation.export_generated',
    'accreditation_export', export_id::text,
    'encrypted export generated', null,
    jsonb_build_object(
      'batchId', target_batch, 'rowCount', submitted_row_count,
      'sha256', submitted_sha256
    )
  );
  return jsonb_build_object('exportId', export_id);
end
$$;
revoke all on function internal.record_accreditation_export(
  uuid, uuid, text, text, jsonb, integer, jsonb, text
) from public;

create or replace function public.record_accreditation_export(
  p_batch_id uuid,
  p_actor_id uuid,
  p_object_path text,
  p_sha256 text,
  p_envelope_key jsonb,
  p_row_count integer,
  p_filter jsonb,
  p_capability_hash text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.record_accreditation_export(
    p_batch_id, p_actor_id, p_object_path, p_sha256,
    p_envelope_key, p_row_count, p_filter, p_capability_hash
  )
$$;

create or replace function internal.mark_accreditation_batch_submitted(
  target_batch uuid,
  submitted_external_reference text,
  submitted_reason text,
  submitted_nonce_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
begin
  perform internal.consume_step_up_grant(
    'accreditation_result', target_batch::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('accreditation_reviewer')
     or length(trim(submitted_external_reference)) < 3
     or length(trim(submitted_reason)) < 10
  then raise exception 'ACCREDITATION_SUBMISSION_REJECTED'; end if;
  perform session.id
  from public.accreditation_submission_items item
  join public.live_bookings booking
    on booking.enrollment_id = item.enrollment_id
  join public.live_sessions session
    on session.id = booking.live_session_id
  where item.batch_id = target_batch
    and item.status = 'included'
  order by session.id
  for update of session;
  update public.accreditation_submission_batches batch
  set status = 'submitted',
      submitted_by = actor,
      external_submission_reference = trim(submitted_external_reference),
      submitted_at = now()
  where batch.id = target_batch
    and batch.status = 'exported'
    and actor <> batch.requested_by
    and not exists (
      select 1
      from public.accreditation_submission_items item
      join public.live_bookings booking
        on booking.enrollment_id = item.enrollment_id
      join public.attendance_summaries attendance
        on attendance.live_booking_id = booking.id
      where item.batch_id = batch.id
        and item.status = 'included'
        and attendance.quarantined_at is not null
    );
  if not found then raise exception 'EXPORTED_BATCH_REQUIRED'; end if;
  update public.enrollments enrollment
  set status = 'submitted', submitted_at = now()
  from public.accreditation_submission_items item
  where item.batch_id = target_batch
    and item.enrollment_id = enrollment.id
    and item.status = 'included'
    and enrollment.status = 'completed';
  update public.certificates certificate
  set current_status = 'submitted'
  from public.accreditation_submission_items item
  where item.batch_id = target_batch
    and item.enrollment_id = certificate.enrollment_id
    and item.status = 'included'
    and certificate.current_status = 'active';
  perform internal.append_audit_event(
    actor, 'accreditation.batch_submitted', 'submission_batch',
    target_batch::text, trim(submitted_reason), null,
    jsonb_build_object(
      'externalReference', trim(submitted_external_reference)
    )
  );
  return 'submitted';
end
$$;
revoke all on function internal.mark_accreditation_batch_submitted(
  uuid, text, text, text
) from public;

create or replace function public.mark_accreditation_batch_submitted(
  p_batch_id uuid,
  p_external_reference text,
  p_reason text,
  p_nonce_hash text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.mark_accreditation_batch_submitted(
    p_batch_id, p_external_reference, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.record_accreditation_batch_results(
  target_batch uuid,
  submitted_items jsonb,
  submitted_reason text,
  submitted_nonce_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  batch_row public.accreditation_submission_batches%rowtype;
  item jsonb;
  target_enrollment uuid;
  target_status text;
  item_reason text;
  processed integer := 0;
  next_batch_status text;
begin
  perform internal.consume_step_up_grant(
    'accreditation_result', target_batch::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('accreditation_reviewer')
     or jsonb_typeof(submitted_items) <> 'array'
     or jsonb_array_length(submitted_items) not between 1 and 1000
     or length(trim(submitted_reason)) < 10
  then raise exception 'ACCREDITATION_RESULT_REJECTED'; end if;
  select * into batch_row
  from public.accreditation_submission_batches
  where id = target_batch for update;
  if not found or batch_row.status <> 'submitted'
     or batch_row.submitted_by is null
     or batch_row.submitted_by = actor
     or batch_row.requested_by = actor
  then raise exception 'DISTINCT_RESULT_REVIEWER_REQUIRED'; end if;
  for item in select value from jsonb_array_elements(submitted_items)
  loop
    target_enrollment := (item ->> 'enrollmentId')::uuid;
    target_status := item ->> 'status';
    item_reason := trim(coalesce(item ->> 'reason', ''));
    -- Share the provider/settlement session lock before accepting an external
    -- accreditation result. If a late provider event is already in flight,
    -- this statement waits and the quarantine recheck below sees it.
    perform session.id
    from public.live_bookings booking
    join public.live_sessions session
      on session.id = booking.live_session_id
    where booking.enrollment_id = target_enrollment
    order by session.id
    for update of session;
    if target_status not in ('accepted', 'needs_correction', 'rejected')
       or length(item_reason) < 3
       or not exists (
         select 1 from public.accreditation_submission_items batch_item
         where batch_item.batch_id = target_batch
           and batch_item.enrollment_id = target_enrollment
           and batch_item.status = 'included'
       )
       or (
         target_status = 'accepted'
         and exists (
           select 1
           from public.live_bookings booking
           join public.attendance_summaries attendance
             on attendance.live_booking_id = booking.id
           where booking.enrollment_id = target_enrollment
             and attendance.quarantined_at is not null
         )
       )
    then raise exception 'ACCREDITATION_RESULT_ITEM_INVALID'; end if;
    update public.accreditation_submission_items
    set status = target_status,
        missing_reasons = case
          when target_status = 'accepted' then '[]'::jsonb
          else jsonb_build_array(item_reason)
        end
    where batch_id = target_batch
      and enrollment_id = target_enrollment
      and status = 'included';
    update public.enrollments
    set status = case target_status
          when 'accepted' then 'credited'
          else target_status
        end,
        credited_at = case when target_status = 'accepted'
          then now() else credited_at end
    where id = target_enrollment and status = 'submitted';
    update public.certificates
    set current_status = case target_status
          when 'accepted' then 'credited'
          else target_status
        end
    where enrollment_id = target_enrollment
      and current_status = 'submitted';
    insert into public.notifications (
      person_id, category, title, body, business_key
    )
    select
      enrollment.person_id, 'accreditation_result',
      case target_status
        when 'accepted' then '積分登錄已確認'
        when 'needs_correction' then '積分資料需要補正'
        else '積分登錄未通過'
      end,
      case target_status
        when 'accepted' then '認可單位已確認本次積分登錄。'
        else item_reason
      end,
      'accreditation-result:' || target_batch::text || ':'
        || target_enrollment::text
    from public.enrollments enrollment
    where enrollment.id = target_enrollment
    on conflict (person_id, business_key) do nothing;
    insert into public.notification_outbox (
      notification_id, channel, destination_ciphertext,
      template_key, template_data, business_idempotency_key
    )
    select
      notification.id, 'email', '{}'::jsonb, 'accreditation_result',
      jsonb_build_object(
        'batchId', target_batch, 'enrollmentId', target_enrollment,
        'status', target_status
      ),
      'accreditation-result-email:' || target_batch::text || ':'
        || target_enrollment::text
    from public.notifications notification
    join public.enrollments enrollment
      on enrollment.person_id = notification.person_id
    join public.people person on person.id = enrollment.person_id
    where enrollment.id = target_enrollment
      and notification.business_key =
        'accreditation-result:' || target_batch::text || ':'
          || target_enrollment::text
      and person.email_verified_at is not null
    on conflict (business_idempotency_key) do nothing;
    processed := processed + 1;
  end loop;
  select case
    when exists (
      select 1 from public.accreditation_submission_items batch_item
      where batch_item.batch_id = target_batch
        and batch_item.status = 'included'
    ) then 'submitted'
    when not exists (
      select 1 from public.accreditation_submission_items batch_item
      where batch_item.batch_id = target_batch
        and batch_item.status <> 'accepted'
    ) then 'accepted'
    when exists (
      select 1 from public.accreditation_submission_items batch_item
      where batch_item.batch_id = target_batch
        and batch_item.status = 'needs_correction'
    ) then 'needs_correction'
    when exists (
      select 1 from public.accreditation_submission_items batch_item
      where batch_item.batch_id = target_batch
        and batch_item.status = 'accepted'
    ) then 'needs_correction'
    else 'rejected'
  end into next_batch_status;
  update public.accreditation_submission_batches
  set status = next_batch_status
  where id = target_batch;
  perform internal.append_audit_event(
    actor, 'accreditation.results_recorded', 'submission_batch',
    target_batch::text, trim(submitted_reason), null,
    jsonb_build_object(
      'processed', processed, 'batchStatus', next_batch_status
    )
  );
  return jsonb_build_object(
    'processed', processed, 'batchStatus', next_batch_status
  );
end
$$;
revoke all on function internal.record_accreditation_batch_results(
  uuid, jsonb, text, text
) from public;

create or replace function public.record_accreditation_batch_results(
  p_batch_id uuid,
  p_items jsonb,
  p_reason text,
  p_nonce_hash text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.record_accreditation_batch_results(
    p_batch_id, p_items, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.consume_export_download_capability(
  target_actor uuid,
  submitted_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role'
     or submitted_token_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'EXPORT_DOWNLOAD_REJECTED';
  end if;
  update private.export_download_capabilities capability
  set consumed_at = now()
  from private.accreditation_exports export_row
  where capability.export_id = export_row.id
    and capability.actor_id = target_actor
    and capability.token_hash = submitted_token_hash
    and capability.consumed_at is null
    and capability.expires_at > now()
  returning jsonb_build_object(
    'exportId', export_row.id,
    'batchId', export_row.batch_id,
    'objectPath', export_row.encrypted_object_path,
    'objectSha256', export_row.object_sha256,
    'envelopeKey', export_row.envelope_key
  ) into result;
  if result is null then raise exception 'EXPORT_CAPABILITY_INVALID'; end if;
  return result;
end
$$;
revoke all on function internal.consume_export_download_capability(
  uuid, text
) from public;

create or replace function public.consume_export_download_capability(
  p_actor_id uuid,
  p_token_hash text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.consume_export_download_capability(
    p_actor_id, p_token_hash
  )
$$;

create or replace function internal.authorize_certificate_download(
  target_certificate uuid
)
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
  select jsonb_build_object(
    'objectPath', revision.pdf_object_path,
    'sha256', revision.pdf_sha256,
    'fileName', 'suiyue-certificate-' || certificate.id::text || '.pdf'
  ) into result
  from public.certificates certificate
  join public.enrollments enrollment
    on enrollment.id = certificate.enrollment_id
  join public.certificate_revisions revision
    on revision.id = certificate.current_revision_id
  where certificate.id = target_certificate
    and enrollment.person_id = actor
    and enrollment.status in ('completed', 'submitted', 'credited')
    and certificate.current_status in ('active', 'submitted', 'credited')
    and revision.status in ('active', 'submitted', 'credited')
    and revision.revoked_at is null
    and not exists (
      select 1
      from public.live_bookings booking
      join public.attendance_summaries attendance
        on attendance.live_booking_id = booking.id
      where booking.enrollment_id = enrollment.id
        and attendance.quarantined_at is not null
    );
  if result is null then
    raise exception 'CERTIFICATE_DOWNLOAD_NOT_AUTHORIZED';
  end if;
  return result;
end
$$;
revoke all on function internal.authorize_certificate_download(uuid)
  from public;

create or replace function public.authorize_certificate_download(
  p_certificate_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.authorize_certificate_download(p_certificate_id)
$$;

create or replace function internal.request_certificate_revocation(
  target_certificate uuid,
  submitted_reason text,
  idempotency uuid,
  submitted_nonce_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  request_id uuid;
begin
  perform internal.consume_step_up_grant(
    'certificate_revoke', target_certificate::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('accreditation_reviewer')
     or length(trim(submitted_reason)) < 10
     or not exists (
       select 1 from public.certificates certificate
       where certificate.id = target_certificate
         and certificate.current_status <> 'revoked'
     )
  then raise exception 'CERTIFICATE_REVOCATION_REQUEST_REJECTED'; end if;
  select request.id into request_id
  from public.certificate_revocation_requests request
  where request.idempotency_key = idempotency;
  if found then return request_id; end if;
  insert into public.certificate_revocation_requests (
    certificate_id, requested_by, reason, idempotency_key
  ) values (
    target_certificate, actor, trim(submitted_reason), idempotency
  ) returning id into request_id;
  perform internal.append_audit_event(
    actor, 'certificate.revocation_requested',
    'certificate_revocation_request', request_id::text,
    trim(submitted_reason), null,
    jsonb_build_object('certificateId', target_certificate)
  );
  return request_id;
end
$$;
revoke all on function internal.request_certificate_revocation(
  uuid, text, uuid, text
) from public;

create or replace function public.request_certificate_revocation(
  p_certificate_id uuid,
  p_reason text,
  p_idempotency_key uuid,
  p_nonce_hash text
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.request_certificate_revocation(
    p_certificate_id, p_reason, p_idempotency_key, p_nonce_hash
  )
$$;

create or replace function internal.decide_certificate_revocation(
  target_request uuid,
  submitted_decision text,
  submitted_reason text,
  submitted_nonce_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  request_row public.certificate_revocation_requests%rowtype;
  certificate_row public.certificates%rowtype;
  revision_row public.certificate_revisions%rowtype;
  next_revision_id uuid;
begin
  perform internal.consume_step_up_grant(
    'certificate_revoke', target_request::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('accreditation_reviewer')
     or submitted_decision not in ('approve', 'reject')
     or length(trim(submitted_reason)) < 10
  then raise exception 'CERTIFICATE_REVOCATION_DECISION_REJECTED'; end if;
  select * into request_row
  from public.certificate_revocation_requests
  where id = target_request for update;
  if not found or request_row.status <> 'pending'
     or request_row.requested_by = actor
  then raise exception 'DISTINCT_CERTIFICATE_REVIEWER_REQUIRED'; end if;
  insert into public.certificate_revocation_decisions (
    request_id, reviewer_id, decision, reason
  ) values (
    target_request, actor, submitted_decision, trim(submitted_reason)
  );
  if submitted_decision = 'reject' then
    update public.certificate_revocation_requests
    set status = 'rejected', decided_at = now()
    where id = target_request;
    return 'rejected';
  end if;
  select * into certificate_row from public.certificates
  where id = request_row.certificate_id for update;
  if certificate_row.current_status = 'revoked' then
    raise exception 'CERTIFICATE_ALREADY_REVOKED';
  end if;
  select * into revision_row from public.certificate_revisions
  where id = certificate_row.current_revision_id;
  insert into public.certificate_revisions (
    certificate_id, revision, status, masked_name_snapshot,
    course_title_snapshot, course_version_snapshot, completed_on,
    accreditation_reference_snapshot, accreditation_points_snapshot,
    accreditation_authority_snapshot, live_session_snapshot,
    evidence_manifest_hash, pdf_object_path, pdf_sha256,
    verification_token_hash, issued_by, approved_by,
    revoked_at, revocation_reason
  ) values (
    certificate_row.id, revision_row.revision + 1, 'revoked',
    revision_row.masked_name_snapshot, revision_row.course_title_snapshot,
    revision_row.course_version_snapshot, revision_row.completed_on,
    revision_row.accreditation_reference_snapshot,
    revision_row.accreditation_points_snapshot,
    revision_row.accreditation_authority_snapshot,
    revision_row.live_session_snapshot,
    revision_row.evidence_manifest_hash, revision_row.pdf_object_path,
    revision_row.pdf_sha256,
    encode(extensions.digest(
      gen_random_uuid()::text || clock_timestamp()::text, 'sha256'
    ), 'hex'),
    request_row.requested_by, actor, now(), trim(submitted_reason)
  ) returning id into next_revision_id;
  update public.certificates
  set current_revision_id = next_revision_id, current_status = 'revoked'
  where id = certificate_row.id;
  update public.enrollments
  set status = 'revoked'
  where id = certificate_row.enrollment_id
    and status in ('completed', 'submitted', 'credited', 'needs_correction');
  update public.certificate_revocation_requests
  set status = 'approved', decided_at = now()
  where id = target_request;
  insert into public.notifications (
    person_id, category, title, body, business_key
  )
  select
    enrollment.person_id, 'certificate', '證明狀態已撤銷',
    '證明歷史仍保留；公開查驗頁會顯示目前撤銷狀態。',
    'certificate-revoked:' || certificate_row.id::text
  from public.enrollments enrollment
  where enrollment.id = certificate_row.enrollment_id
  on conflict (person_id, business_key) do nothing;
  perform internal.append_audit_event(
    actor, 'certificate.revocation_approved',
    'certificate_revocation_request', target_request::text,
    trim(submitted_reason), null,
    jsonb_build_object(
      'certificateId', certificate_row.id,
      'revisionId', next_revision_id
    )
  );
  return 'approved';
end
$$;
revoke all on function internal.decide_certificate_revocation(
  uuid, text, text, text
) from public;

create or replace function public.decide_certificate_revocation(
  p_request_id uuid,
  p_decision text,
  p_reason text,
  p_nonce_hash text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.decide_certificate_revocation(
    p_request_id, p_decision, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.approve_identity_profile_access(
  target_case uuid,
  submitted_reason text,
  submitted_nonce_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  case_row public.identity_verification_cases%rowtype;
  approval_count integer;
  actor_epoch bigint;
  access_grant_id uuid;
begin
  perform internal.consume_step_up_grant(
    'pii_decrypt', target_case::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('accreditation_reviewer')
     or length(trim(submitted_reason)) < 10
  then
    raise exception 'IDENTITY_ACCESS_REVIEWER_REQUIRED';
  end if;
  select * into case_row
  from public.identity_verification_cases
  where id = target_case for update;
  if not found or case_row.status not in ('open', 'needs_correction') then
    raise exception 'IDENTITY_CASE_NOT_OPEN';
  end if;
  insert into public.identity_verification_access_approvals (
    verification_case_id, reviewer_id, reason
  ) values (
    target_case, actor, trim(submitted_reason)
  ) on conflict (verification_case_id, reviewer_id) do nothing;
  update public.identity_verification_cases
  set assigned_reviewer_id = coalesce(assigned_reviewer_id, actor)
  where id = target_case;
  select * into case_row
  from public.identity_verification_cases
  where id = target_case;
  select count(distinct reviewer_id) into approval_count
  from public.identity_verification_access_approvals
  where verification_case_id = target_case;
  perform internal.append_audit_event(
    actor, 'identity.pii_access_approved', 'identity_verification_case',
    target_case::text, trim(submitted_reason), null,
    jsonb_build_object('approvalCount', approval_count)
  );
  if approval_count >= 2 and case_row.assigned_reviewer_id = actor then
    select identity_epoch into actor_epoch
    from public.people where id = actor;
    insert into private.identity_review_access_grants (
      verification_case_id, actor_id, identity_epoch, reason, expires_at
    ) values (
      target_case, actor, actor_epoch, trim(submitted_reason),
      now() + interval '2 minutes'
    ) returning id into access_grant_id;
  end if;
  return jsonb_build_object(
    'ready', access_grant_id is not null,
    'approvalCount', approval_count,
    'accessGrantId', access_grant_id,
    'actorId', case when access_grant_id is not null then actor else null end
  );
end
$$;
revoke all on function internal.approve_identity_profile_access(
  uuid, text, text
) from public;

create or replace function public.approve_identity_profile_access(
  p_case_id uuid,
  p_reason text,
  p_nonce_hash text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.approve_identity_profile_access(
    p_case_id, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.consume_identity_review_access(
  target_grant uuid,
  target_case uuid,
  target_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  result jsonb;
  grant_reason text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'IDENTITY_REVIEW_SERVICE_REQUIRED';
  end if;
  update private.identity_review_access_grants grant_row
  set consumed_at = now()
  from public.people actor,
       public.identity_verification_cases verification_case
  where grant_row.id = target_grant
    and grant_row.verification_case_id = target_case
    and grant_row.actor_id = target_actor
    and actor.id = target_actor
    and actor.identity_epoch = grant_row.identity_epoch
    and verification_case.id = target_case
    and verification_case.assigned_reviewer_id = target_actor
    and verification_case.status in ('open', 'needs_correction')
    and grant_row.consumed_at is null
    and grant_row.expires_at > now()
  returning grant_row.reason into grant_reason;
  if grant_reason is null then
    raise exception 'IDENTITY_REVIEW_CAPABILITY_INVALID';
  end if;
  if (
    select count(distinct approval.reviewer_id)
    from public.identity_verification_access_approvals approval
    where approval.verification_case_id = target_case
  ) < 2 then
    raise exception 'IDENTITY_REVIEW_DUAL_CONTROL_REQUIRED';
  end if;
  select jsonb_build_object(
    'personId', profile.person_id,
    'wrappedDek', key.wrapped_dek,
    'kekVersion', key.kek_version,
    'encryptedFields', profile.encrypted_fields,
    'status', profile.status
  ) into result
  from public.identity_verification_cases verification_case
  join private.accreditation_identity_profiles profile
    on profile.id = verification_case.profile_id
    and profile.person_id = verification_case.person_id
  join private.person_encryption_keys key
    on key.person_id = profile.person_id
  where verification_case.id = target_case;
  if result is null then raise exception 'IDENTITY_REVIEW_BUNDLE_MISSING'; end if;
  perform internal.append_audit_event(
    target_actor, 'identity.pii_access_consumed',
    'identity_verification_case', target_case::text,
    grant_reason, null, jsonb_build_object('accessGrantId', target_grant)
  );
  return result;
end
$$;
revoke all on function internal.consume_identity_review_access(
  uuid, uuid, uuid
) from public;

create or replace function public.consume_identity_review_access(
  p_grant_id uuid,
  p_case_id uuid,
  p_actor_id uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.consume_identity_review_access(
    p_grant_id, p_case_id, p_actor_id
  )
$$;

create or replace function internal.decide_identity_verification_case(
  target_case uuid,
  submitted_decision text,
  submitted_reason text,
  submitted_nonce_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  case_row public.identity_verification_cases%rowtype;
  approval_count integer;
  next_status text;
begin
  perform internal.consume_step_up_grant(
    'pii_decrypt', target_case::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('accreditation_reviewer')
     or submitted_decision not in ('approve', 'needs_correction', 'reject')
     or length(trim(submitted_reason)) < 10
  then
    raise exception 'IDENTITY_DECISION_REJECTED';
  end if;
  select * into case_row from public.identity_verification_cases
  where id = target_case for update;
  if not found
     or case_row.status not in ('open', 'needs_correction')
     or case_row.assigned_reviewer_id <> actor
  then
    raise exception 'IDENTITY_DUAL_CONTROL_REQUIRED';
  end if;
  select count(distinct reviewer_id) into approval_count
  from public.identity_verification_access_approvals
  where verification_case_id = target_case;
  if approval_count < 2 then
    raise exception 'IDENTITY_DUAL_CONTROL_REQUIRED';
  end if;
  next_status := case submitted_decision
    when 'approve' then 'approved'
    when 'reject' then 'rejected'
    else 'needs_correction'
  end;
  update public.identity_verification_cases
  set status = next_status,
      reason = trim(submitted_reason),
      closed_at = case when next_status in ('approved', 'rejected')
        then now() else null end
  where id = target_case;
  update private.accreditation_identity_profiles
  set status = case submitted_decision
        when 'approve' then 'verified'
        when 'reject' then 'rejected'
        else 'needs_correction'
      end,
      verified_by = case when submitted_decision = 'approve'
        then actor else null end,
      verified_at = case when submitted_decision = 'approve'
        then now() else null end,
      updated_at = now()
  where id = case_row.profile_id and person_id = case_row.person_id;
  perform internal.append_audit_event(
    actor, 'identity.verification_decided',
    'identity_verification_case', target_case::text,
    trim(submitted_reason), null,
    jsonb_build_object('decision', submitted_decision)
  );
  return next_status;
end
$$;
revoke all on function internal.decide_identity_verification_case(
  uuid, text, text, text
) from public;

create or replace function public.decide_identity_verification_case(
  p_case_id uuid,
  p_decision text,
  p_reason text,
  p_nonce_hash text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.decide_identity_verification_case(
    p_case_id, p_decision, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.register_stream_direct_upload(
  target_lesson uuid,
  submitted_provider_uid text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  asset_id uuid;
  lesson_video_id uuid;
  next_version integer;
  existing_uid text;
begin
  if not internal.has_staff_role('course_admin')
     or submitted_provider_uid = ''
     or length(submitted_provider_uid) > 200
  then raise exception 'STREAM_UPLOAD_REGISTRATION_REJECTED'; end if;
  select asset.id, asset.provider_uid into asset_id, existing_uid
  from public.video_assets asset
  where asset.application_idempotency_key = idempotency;
  if found then
    return jsonb_build_object(
      'videoAssetId', asset_id,
      'providerUid', existing_uid,
      'reused', true
    );
  end if;
  perform 1
  from public.lessons lesson
  join public.modules module on module.id = lesson.module_id
  join public.course_versions version on version.id = module.course_version_id
  where lesson.id = target_lesson
    and lesson.content_type = 'video'
    and version.status = 'draft'
  for update of lesson;
  if not found then raise exception 'DRAFT_VIDEO_LESSON_REQUIRED'; end if;
  insert into public.video_assets (
    provider_uid, status, require_signed_urls, provider_payload,
    application_idempotency_key, uploaded_by
  ) values (
    submitted_provider_uid, 'uploading', true,
    jsonb_build_object('providerReady', false),
    idempotency, actor
  ) returning id into asset_id;
  select coalesce(max(video.version), 0) + 1 into next_version
  from public.lesson_video_versions video
  where video.lesson_id = target_lesson;
  update public.lesson_video_versions
  set active = false
  where lesson_id = target_lesson and active;
  insert into public.lesson_video_versions (
    lesson_id, video_asset_id, version, active, created_by
  ) values (
    target_lesson, asset_id, next_version, true, actor
  ) returning id into lesson_video_id;
  perform internal.append_audit_event(
    actor, 'stream.direct_upload_registered', 'video_asset',
    asset_id::text, 'one-time direct upload attached to draft lesson',
    null, jsonb_build_object(
      'lessonId', target_lesson, 'lessonVideoVersionId', lesson_video_id
    )
  );
  return jsonb_build_object(
    'videoAssetId', asset_id,
    'lessonVideoVersionId', lesson_video_id,
    'providerUid', submitted_provider_uid,
    'reused', false
  );
end
$$;
revoke all on function internal.register_stream_direct_upload(
  uuid, text, uuid
) from public;

create or replace function public.register_stream_direct_upload(
  p_lesson_id uuid,
  p_provider_uid text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.register_stream_direct_upload(
    p_lesson_id, p_provider_uid, p_idempotency_key
  )
$$;

create or replace function internal.authorize_video_master_backup(
  target_asset uuid
)
returns uuid
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
begin
  if not internal.has_staff_role('course_admin')
     or not exists (
       select 1
       from public.video_assets asset
       join public.lesson_video_versions video
         on video.video_asset_id = asset.id
       join public.lessons lesson on lesson.id = video.lesson_id
       join public.modules module on module.id = lesson.module_id
       join public.course_versions version
         on version.id = module.course_version_id
       where asset.id = target_asset
         and asset.status in ('uploading', 'processing')
         and version.status = 'draft'
     )
  then raise exception 'VIDEO_BACKUP_AUTHORIZATION_REJECTED'; end if;
  return actor;
end
$$;
revoke all on function internal.authorize_video_master_backup(uuid)
  from public;

create or replace function public.authorize_video_master_backup(
  p_video_asset_id uuid
)
returns uuid
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.authorize_video_master_backup(p_video_asset_id)
$$;

create or replace function internal.confirm_video_master_backup(
  target_asset uuid,
  target_actor uuid,
  submitted_reference text,
  submitted_sha256 text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  next_status text;
begin
  if auth.role() <> 'service_role'
     or submitted_reference = ''
     or submitted_sha256 !~ '^[a-f0-9]{64}$'
     or not exists (
       select 1 from public.staff_roles role
       where role.person_id = target_actor
         and role.role in ('course_admin', 'platform_admin')
         and role.active
     )
  then raise exception 'VIDEO_MASTER_BACKUP_REJECTED'; end if;
  update public.video_assets asset
  set master_backup_reference = submitted_reference,
      provider_payload = provider_payload || jsonb_build_object(
        'masterBackupSha256', submitted_sha256,
        'masterBackupVerifiedAt', now()
      ),
      status = case
        when (provider_payload ->> 'providerReady')::boolean
          then 'ready'
        else 'processing'
      end,
      ready_at = case
        when (provider_payload ->> 'providerReady')::boolean
          then now()
        else ready_at
      end
  where asset.id = target_asset
    and asset.status in ('uploading', 'processing')
  returning status into next_status;
  if next_status is null then raise exception 'VIDEO_ASSET_NOT_PENDING'; end if;
  perform internal.append_audit_event(
    target_actor, 'video.master_backup_verified', 'video_asset',
    target_asset::text, 'private immutable master verified',
    null, jsonb_build_object('sha256', submitted_sha256)
  );
  return next_status;
end
$$;
revoke all on function internal.confirm_video_master_backup(
  uuid, uuid, text, text
) from public;

create or replace function public.confirm_video_master_backup(
  p_video_asset_id uuid,
  p_actor_id uuid,
  p_reference text,
  p_sha256 text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.confirm_video_master_backup(
    p_video_asset_id, p_actor_id, p_reference, p_sha256
  )
$$;

create or replace function internal.record_local_stream_ready(
  submitted_provider_uid text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'STREAM_SERVICE_REQUIRED';
  end if;
  update public.video_assets
  set provider_payload = provider_payload || jsonb_build_object(
        'providerReady', true, 'localMock', true
      ),
      status = case when master_backup_reference is not null
        then 'ready' else 'processing' end,
      ready_at = case when master_backup_reference is not null
        then now() else ready_at end
  where provider_uid = submitted_provider_uid
    and status in ('uploading', 'processing');
  if not found then raise exception 'STREAM_ASSET_NOT_PENDING'; end if;
  return true;
end
$$;
revoke all on function internal.record_local_stream_ready(text) from public;

create or replace function public.record_local_stream_ready(
  p_provider_uid text
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.record_local_stream_ready(p_provider_uid)
$$;

create or replace function internal.create_course_draft(
  submitted_spec jsonb,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  target_course uuid;
  version_id uuid;
  next_version integer;
  delivery text := submitted_spec ->> 'deliveryType';
  module_spec jsonb;
  lesson_spec jsonb;
  component_spec jsonb;
  dependency text;
  module_id uuid;
  component_id uuid;
  component_ids jsonb := '{}'::jsonb;
  live_refund_allocation integer :=
    coalesce((submitted_spec ->> 'liveRefundAllocationTwd')::integer, 0);
  hybrid_live_allocation integer;
  hybrid_recorded_allocation integer;
begin
  if not internal.has_staff_role('course_admin')
     or delivery not in ('recorded', 'live', 'hybrid')
     or coalesce(submitted_spec ->> 'title', '') = ''
     or coalesce(submitted_spec ->> 'summary', '') = ''
     or coalesce(submitted_spec ->> 'description', '') = ''
     or jsonb_typeof(submitted_spec -> 'learningObjectives') <> 'array'
     or jsonb_array_length(submitted_spec -> 'learningObjectives') = 0
     or jsonb_typeof(submitted_spec -> 'modules') <> 'array'
     or (submitted_spec ->> 'priceTwd')::integer < 0
     or (submitted_spec ->> 'recordedRefundAllocationTwd')::integer < 0
     or live_refund_allocation < 0
     or (submitted_spec ->> 'organizationPointPrice')::integer <= 0
     or (submitted_spec ->> 'minimumCompletionDays')::integer <= 0
     or (
       delivery = 'recorded'
       and (
         live_refund_allocation <> 0
         or (submitted_spec ->> 'recordedRefundAllocationTwd')::integer
           <> (submitted_spec ->> 'priceTwd')::integer
       )
     )
     or (
       delivery = 'live'
       and (
         (submitted_spec ->> 'recordedRefundAllocationTwd')::integer <> 0
         or live_refund_allocation
           <> (submitted_spec ->> 'priceTwd')::integer
       )
     )
     or (delivery = 'hybrid' and live_refund_allocation <> 0)
  then
    raise exception 'COURSE_DRAFT_SPEC_INVALID';
  end if;
  if submitted_spec ->> 'courseId' is null then
    if coalesce(submitted_spec ->> 'slug', '')
       !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    then
      raise exception 'COURSE_SLUG_INVALID';
    end if;
    insert into public.courses (
      slug, internal_title, created_by
    ) values (
      submitted_spec ->> 'slug',
      submitted_spec ->> 'internalTitle',
      actor
    ) returning id into target_course;
    next_version := 1;
  else
    target_course := (submitted_spec ->> 'courseId')::uuid;
    if not exists (
      select 1 from public.courses course
      where course.id = target_course and course.archived_at is null
    ) then raise exception 'COURSE_NOT_FOUND'; end if;
    select coalesce(max(version), 0) + 1 into next_version
    from public.course_versions where course_id = target_course;
  end if;
  insert into public.course_versions (
    course_id, version, title, summary, description,
    learning_objectives, delivery_type, price_twd,
    organization_point_price, recorded_refund_allocation_twd,
    live_refund_allocations, equipment_requirements,
    legal_document_id, retention_policy_revision_id,
    minimum_completion_window, commerce_close_at,
    content_available_at, created_by, authoring_idempotency_key
  ) values (
    target_course, next_version, submitted_spec ->> 'title',
    submitted_spec ->> 'summary', submitted_spec ->> 'description',
    submitted_spec -> 'learningObjectives', delivery,
    (submitted_spec ->> 'priceTwd')::integer,
    (submitted_spec ->> 'organizationPointPrice')::integer,
    (submitted_spec ->> 'recordedRefundAllocationTwd')::integer,
    '{}'::jsonb,
    coalesce(submitted_spec ->> 'equipmentRequirements', ''),
    (submitted_spec ->> 'legalDocumentId')::uuid,
    (submitted_spec ->> 'retentionPolicyRevisionId')::uuid,
    ((submitted_spec ->> 'minimumCompletionDays') || ' days')::interval,
    (submitted_spec ->> 'commerceCloseAt')::timestamptz,
    (submitted_spec ->> 'contentAvailableAt')::timestamptz,
    actor, idempotency
  ) returning id into version_id;
  if delivery = 'live' then
    update public.course_versions
    set live_refund_allocations = jsonb_build_object(
      version_id::text, live_refund_allocation
    )
    where id = version_id;
  end if;
  insert into public.course_requirements (
    course_version_id, required_watch_seconds,
    live_presence_percent, live_camera_percent
  ) values (
    version_id,
    (submitted_spec ->> 'requiredWatchSeconds')::integer,
    case when delivery in ('live', 'hybrid')
      then (submitted_spec ->> 'livePresencePercent')::numeric else null end,
    case when delivery in ('live', 'hybrid')
      then (submitted_spec ->> 'liveCameraPercent')::numeric else null end
  );
  insert into public.survey_forms (course_version_id) values (version_id);
  insert into public.question_banks (
    course_version_id, version, created_by
  ) values (version_id, 1, actor);
  insert into public.course_version_accreditation (
    course_version_id, accreditation_revision_id, disclosure_snapshot
  ) values (
    version_id,
    (submitted_spec ->> 'accreditationRevisionId')::uuid,
    submitted_spec ->> 'accreditationDisclosure'
  );

  for module_spec in
    select value from jsonb_array_elements(submitted_spec -> 'modules')
  loop
    insert into public.modules (
      course_version_id, title, sort_order
    ) values (
      version_id, module_spec ->> 'title',
      (module_spec ->> 'sortOrder')::integer
    ) returning id into module_id;
    for lesson_spec in
      select value from jsonb_array_elements(module_spec -> 'lessons')
    loop
      insert into public.lessons (
        module_id, title, content_type, preview, sort_order
      ) values (
        module_id, lesson_spec ->> 'title',
        lesson_spec ->> 'contentType',
        coalesce((lesson_spec ->> 'preview')::boolean, false),
        (lesson_spec ->> 'sortOrder')::integer
      );
    end loop;
  end loop;

  if delivery = 'hybrid' then
    if jsonb_array_length(
      coalesce(submitted_spec -> 'hybridComponents', '[]'::jsonb)
    ) < 2 then
      raise exception 'HYBRID_COMPONENTS_REQUIRED';
    end if;
    for component_spec in
      select value from jsonb_array_elements(
        submitted_spec -> 'hybridComponents'
      )
    loop
      insert into public.hybrid_components (
        course_version_id, component_type, title, required,
        sort_order, refund_allocation_twd
      ) values (
        version_id, component_spec ->> 'componentType',
        component_spec ->> 'title',
        coalesce((component_spec ->> 'required')::boolean, true),
        (component_spec ->> 'sortOrder')::integer,
        (component_spec ->> 'refundAllocationTwd')::integer
      ) returning id into component_id;
      component_ids := component_ids || jsonb_build_object(
        component_spec ->> 'sortOrder', component_id
      );
    end loop;
    for component_spec in
      select value from jsonb_array_elements(
        submitted_spec -> 'hybridComponents'
      )
    loop
      for dependency in
        select value #>> '{}'
        from jsonb_array_elements(
          coalesce(component_spec -> 'dependsOnSortOrders', '[]'::jsonb)
        )
      loop
        insert into public.component_prerequisites (
          course_version_id, prerequisite_component_id,
          dependent_component_id
        ) values (
          version_id,
          (component_ids ->> dependency)::uuid,
          (component_ids ->> (component_spec ->> 'sortOrder'))::uuid
        );
      end loop;
    end loop;
    update public.course_versions
    set live_refund_allocations = coalesce((
      select jsonb_object_agg(
        component.id::text, component.refund_allocation_twd
      )
      from public.hybrid_components component
      where component.course_version_id = version_id
        and component.component_type = 'live'
    ), '{}'::jsonb)
    where id = version_id;
    select coalesce(sum(component.refund_allocation_twd), 0)
      into hybrid_live_allocation
    from public.hybrid_components component
    where component.course_version_id = version_id
      and component.component_type = 'live';
    select coalesce(sum(component.refund_allocation_twd), 0)
      into hybrid_recorded_allocation
    from public.hybrid_components component
    where component.course_version_id = version_id
      and component.component_type = 'recorded';
    if (submitted_spec ->> 'recordedRefundAllocationTwd')::integer
         + hybrid_live_allocation
       <> (submitted_spec ->> 'priceTwd')::integer
       or hybrid_recorded_allocation
         <> (submitted_spec ->> 'recordedRefundAllocationTwd')::integer
    then
      raise exception 'REFUND_ALLOCATIONS_DO_NOT_EQUAL_PRICE';
    end if;
  end if;
  perform internal.append_audit_event(
    actor, 'course.draft_created', 'course_version',
    version_id::text, 'versioned draft created', null,
    jsonb_build_object('courseId', target_course, 'version', next_version)
  );
  return jsonb_build_object(
    'courseId', target_course,
    'courseVersionId', version_id,
    'version', next_version
  );
exception
  when unique_violation then
    select jsonb_build_object(
      'courseId', course_id, 'courseVersionId', id, 'version', version
    ) into submitted_spec
    from public.course_versions
    where authoring_idempotency_key = idempotency;
    if submitted_spec is not null then return submitted_spec; end if;
    raise;
end
$$;
revoke all on function internal.create_course_draft(jsonb, uuid)
  from public;

create or replace function public.create_course_draft(
  p_spec jsonb,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.create_course_draft(p_spec, p_idempotency_key)
$$;

create or replace function internal.add_question_to_draft(
  target_version uuid,
  submitted_prompt text,
  submitted_topic text,
  submitted_explanation text,
  submitted_options jsonb,
  correct_index integer,
  idempotency uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  bank_id uuid;
  question_id uuid;
  option_id uuid;
  option_text text;
  option_index integer := 0;
  correct_option uuid;
  question_sort integer;
begin
  if not internal.has_staff_role('course_admin')
     or length(trim(submitted_prompt)) < 5
     or length(trim(submitted_topic)) < 2
     or length(trim(submitted_explanation)) < 5
     or jsonb_typeof(submitted_options) <> 'array'
     or jsonb_array_length(submitted_options) <> 4
     or correct_index not between 0 and 3
  then
    raise exception 'QUESTION_SPEC_INVALID';
  end if;
  select bank.id into bank_id
  from public.question_banks bank
  join public.course_versions version
    on version.id = bank.course_version_id
  where bank.course_version_id = target_version
    and bank.locked_at is null
    and version.status = 'draft';
  if not found then raise exception 'QUESTION_BANK_LOCKED'; end if;
  select coalesce(max(question.sort_order), -1) + 1
    into question_sort
  from public.question_versions question
  where question.question_bank_id = bank_id
    and question.active;
  insert into public.question_versions (
    question_bank_id, stable_question_id, version,
    prompt, topic, explanation, sort_order
  ) values (
    bank_id, idempotency, 1, trim(submitted_prompt),
    trim(submitted_topic), trim(submitted_explanation), question_sort
  )
  on conflict (stable_question_id, version) do update
    set prompt = excluded.prompt
  returning id into question_id;
  if exists (
    select 1 from private.question_answer_keys answer
    where answer.question_version_id = question_id
  ) then return question_id; end if;
  for option_text in
    select value #>> '{}' from jsonb_array_elements(submitted_options)
  loop
    insert into public.question_option_versions (
      question_version_id, stable_option_id, option_text, sort_order
    ) values (
      question_id, gen_random_uuid(), option_text, option_index
    ) returning id into option_id;
    if option_index = correct_index then correct_option := option_id; end if;
    option_index := option_index + 1;
  end loop;
  insert into private.question_answer_keys (
    question_version_id, correct_option_id
  ) values (question_id, correct_option);
  perform internal.append_audit_event(
    actor, 'course.question_added', 'course_version',
    target_version::text, 'question version created', null,
    jsonb_build_object('questionId', question_id)
  );
  return question_id;
end
$$;
revoke all on function internal.add_question_to_draft(
  uuid, text, text, text, jsonb, integer, uuid
) from public;

create or replace function public.add_question_to_draft(
  p_course_version_id uuid,
  p_prompt text,
  p_topic text,
  p_explanation text,
  p_options jsonb,
  p_correct_index integer,
  p_idempotency_key uuid
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.add_question_to_draft(
    p_course_version_id, p_prompt, p_topic, p_explanation,
    p_options, p_correct_index, p_idempotency_key
  )
$$;

create or replace function internal.manage_question_draft(
  target_version uuid,
  submitted_operation text,
  submitted_spec jsonb,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  bank_id uuid;
  question_id uuid;
  option_id uuid;
  correct_option uuid;
  option_text text;
  option_index integer := 0;
  requested_count integer;
  existing_count integer;
  ordered_item record;
  result jsonb;
  request_hash text;
begin
  if not internal.has_staff_role('course_admin')
     or submitted_operation not in (
       'question_update', 'question_delete', 'question_reorder'
     )
     or jsonb_typeof(submitted_spec) <> 'object'
  then raise exception 'QUESTION_DRAFT_OPERATION_REJECTED'; end if;
  select bank.id into bank_id
  from public.question_banks bank
  join public.course_versions version
    on version.id = bank.course_version_id
  where bank.course_version_id = target_version
    and bank.locked_at is null
    and version.status = 'draft'
    and (
      version.created_by = actor
      or internal.has_staff_role('platform_admin')
    )
  for update of bank;
  if bank_id is null then raise exception 'QUESTION_BANK_LOCKED'; end if;

  request_hash := encode(extensions.digest(
    target_version::text || '|' || submitted_operation || '|'
      || submitted_spec::text,
    'sha256'
  ), 'hex');
  insert into public.idempotency_records (
    actor_id, operation, idempotency_key, request_hash, locked_until
  ) values (
    actor, 'question_draft:' || submitted_operation, idempotency,
    request_hash, clock_timestamp() + interval '1 minute'
  )
  on conflict (actor_id, operation, idempotency_key) do nothing;
  if not found then
    select record.response_body into result
    from public.idempotency_records record
    where record.actor_id = actor
      and record.operation = 'question_draft:' || submitted_operation
      and record.idempotency_key = idempotency
      and record.request_hash = request_hash
      and record.completed_at is not null;
    if result is null then raise exception 'IDEMPOTENCY_REQUEST_CONFLICT'; end if;
    return result;
  end if;

  if submitted_operation = 'question_update' then
    question_id := (submitted_spec ->> 'questionId')::uuid;
    if length(trim(coalesce(submitted_spec ->> 'prompt', ''))) < 5
       or length(trim(coalesce(submitted_spec ->> 'topic', ''))) < 2
       or length(trim(coalesce(submitted_spec ->> 'explanation', ''))) < 5
       or jsonb_typeof(submitted_spec -> 'options') <> 'array'
       or jsonb_array_length(submitted_spec -> 'options') <> 4
       or coalesce(submitted_spec ->> 'correctIndex', '') !~ '^[0-3]$'
       or not exists (
         select 1 from public.question_versions question
         where question.id = question_id
           and question.question_bank_id = bank_id
           and question.active
       )
    then raise exception 'QUESTION_SPEC_INVALID'; end if;
    update public.question_versions
    set prompt = trim(submitted_spec ->> 'prompt'),
        topic = trim(submitted_spec ->> 'topic'),
        explanation = trim(submitted_spec ->> 'explanation')
    where id = question_id
      and question_bank_id = bank_id
      and active;
    delete from private.question_answer_keys
    where question_version_id = question_id;
    delete from public.question_option_versions
    where question_version_id = question_id;
    for option_text in
      select value #>> '{}'
      from jsonb_array_elements(submitted_spec -> 'options')
    loop
      if length(trim(option_text)) < 1 then
        raise exception 'QUESTION_OPTION_INVALID';
      end if;
      insert into public.question_option_versions (
        question_version_id, stable_option_id, option_text, sort_order
      ) values (
        question_id, gen_random_uuid(), trim(option_text), option_index
      ) returning id into option_id;
      if option_index =
           (submitted_spec ->> 'correctIndex')::integer
      then correct_option := option_id; end if;
      option_index := option_index + 1;
    end loop;
    insert into private.question_answer_keys (
      question_version_id, correct_option_id
    ) values (question_id, correct_option);
    result := jsonb_build_object('questionId', question_id);
  elsif submitted_operation = 'question_delete' then
    question_id := (submitted_spec ->> 'questionId')::uuid;
    if not exists (
      select 1 from public.question_versions question
      where question.id = question_id
        and question.question_bank_id = bank_id
        and question.active
    ) then raise exception 'QUESTION_NOT_FOUND'; end if;
    delete from private.question_answer_keys
    where question_version_id = question_id;
    delete from public.question_option_versions
    where question_version_id = question_id;
    delete from public.question_versions
    where id = question_id and question_bank_id = bank_id;
    result := jsonb_build_object('questionId', question_id);
  else
    if jsonb_typeof(submitted_spec -> 'orderedIds') <> 'array'
    then raise exception 'QUESTION_ORDER_INVALID'; end if;
    requested_count := jsonb_array_length(submitted_spec -> 'orderedIds');
    select count(*) into existing_count
    from public.question_versions question
    where question.question_bank_id = bank_id and question.active;
    if requested_count <> existing_count
       or (
         select count(distinct value #>> '{}')
         from jsonb_array_elements(submitted_spec -> 'orderedIds')
       ) <> existing_count
       or exists (
         select 1
         from jsonb_array_elements(submitted_spec -> 'orderedIds') item
         where not exists (
           select 1 from public.question_versions question
           where question.id = (item.value #>> '{}')::uuid
             and question.question_bank_id = bank_id
             and question.active
         )
       )
    then raise exception 'QUESTION_ORDER_INVALID'; end if;
    update public.question_versions
    set sort_order = sort_order + 1000000
    where question_bank_id = bank_id and active;
    for ordered_item in
      select value #>> '{}' as item_id, ordinality - 1 as position
      from jsonb_array_elements(submitted_spec -> 'orderedIds')
        with ordinality
    loop
      update public.question_versions
      set sort_order = ordered_item.position
      where id = ordered_item.item_id::uuid
        and question_bank_id = bank_id
        and active;
    end loop;
    result := jsonb_build_object(
      'orderedIds', submitted_spec -> 'orderedIds'
    );
  end if;

  update public.idempotency_records
  set response_status = 200,
      response_body = result,
      completed_at = clock_timestamp(),
      locked_until = null
  where actor_id = actor
    and operation = 'question_draft:' || submitted_operation
    and idempotency_key = idempotency;
  perform internal.append_audit_event(
    actor, 'course.' || submitted_operation,
    'course_version', target_version::text,
    'draft-only question authoring', null, result
  );
  return result;
end
$$;
revoke all on function internal.manage_question_draft(
  uuid, text, jsonb, uuid
) from public;

create or replace function public.manage_question_draft(
  p_course_version_id uuid,
  p_operation text,
  p_spec jsonb,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.manage_question_draft(
    p_course_version_id, p_operation, p_spec, p_idempotency_key
  )
$$;

create or replace function internal.submit_course_version_for_review(
  target_version uuid,
  submitted_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
begin
  if not internal.has_staff_role('course_admin')
     or length(trim(submitted_reason)) < 10
  then raise exception 'COURSE_SUBMISSION_REJECTED'; end if;
  update public.course_versions
  set status = 'in_review', submitted_by = actor, submitted_at = now()
  where id = target_version and status = 'draft';
  if not found then raise exception 'COURSE_DRAFT_REQUIRED'; end if;
  insert into public.course_publication_reviews (
    course_version_id, submitted_by, status, checklist, reason
  ) values (
    target_version, actor, 'pending',
    jsonb_build_object('submittedAt', now()), trim(submitted_reason)
  );
  perform internal.append_audit_event(
    actor, 'course.submitted_for_review', 'course_version',
    target_version::text, trim(submitted_reason), null, '{}'::jsonb
  );
  return true;
end
$$;
revoke all on function internal.submit_course_version_for_review(
  uuid, text
) from public;

create or replace function public.submit_course_version_for_review(
  p_course_version_id uuid,
  p_reason text
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.submit_course_version_for_review(
    p_course_version_id, p_reason
  )
$$;

create or replace function internal.replace_draft_live_breaks(
  target_session uuid,
  submitted_intervals jsonb,
  submitted_reason text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  session_row public.live_sessions%rowtype;
  existing_revision public.live_break_revisions%rowtype;
  break_item jsonb;
  break_starts_at timestamptz;
  break_ends_at timestamptz;
  previous_break_end timestamptz;
  break_seconds integer := 0;
begin
  if jsonb_typeof(submitted_intervals) <> 'array'
     or jsonb_array_length(submitted_intervals) > 20
     or length(trim(submitted_reason)) < 10
  then
    raise exception 'LIVE_BREAK_REVISION_INVALID';
  end if;
  select * into existing_revision
  from public.live_break_revisions revision
  where revision.actor_person_id = actor
    and revision.idempotency_key = idempotency;
  if found then
    if existing_revision.live_session_id <> target_session
       or existing_revision.break_intervals_snapshot
         is distinct from submitted_intervals
    then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object(
      'liveSessionId', target_session,
      'breakIntervals', existing_revision.break_intervals_snapshot,
      'lockedBreakSeconds', (
        select session.locked_break_seconds
        from public.live_sessions session
        where session.id = target_session
      ),
      'replayed', true
    );
  end if;
  if not internal.has_staff_role('course_admin') then
    raise exception 'COURSE_ADMIN_REQUIRED';
  end if;
  select * into session_row
  from public.live_sessions session
  where session.id = target_session
  for update;
  if not found
     or session_row.status <> 'draft'
     or exists (
       select 1
       from public.live_breaks formal_break
       where formal_break.live_session_id = target_session
         and formal_break.locked_at is not null
     )
  then
    raise exception 'LIVE_BREAK_DRAFT_REQUIRED';
  end if;
  for break_item in
    select value
    from jsonb_array_elements(submitted_intervals)
    order by (value ->> 'startsAt')::timestamptz
  loop
    break_starts_at := (break_item ->> 'startsAt')::timestamptz;
    break_ends_at := (break_item ->> 'endsAt')::timestamptz;
    if break_starts_at is null
       or break_ends_at is null
       or break_ends_at <= break_starts_at
       or break_starts_at < session_row.starts_at
       or break_ends_at > session_row.ends_at
       or (
         previous_break_end is not null
         and break_starts_at < previous_break_end
       )
    then
      raise exception 'LIVE_BREAK_INTERVALS_INVALID';
    end if;
    break_seconds := break_seconds
      + extract(epoch from break_ends_at - break_starts_at)::integer;
    previous_break_end := break_ends_at;
  end loop;
  if break_seconds >= session_row.scheduled_teaching_seconds then
    raise exception 'LIVE_TEACHING_DURATION_INVALID';
  end if;

  delete from public.live_breaks
  where live_session_id = target_session;
  for break_item in
    select value
    from jsonb_array_elements(submitted_intervals)
  loop
    insert into public.live_breaks (
      live_session_id, starts_at, ends_at
    ) values (
      target_session,
      (break_item ->> 'startsAt')::timestamptz,
      (break_item ->> 'endsAt')::timestamptz
    );
  end loop;
  update public.live_sessions
  set locked_break_seconds = break_seconds
  where id = target_session;
  insert into public.live_break_revisions (
    live_session_id, actor_person_id, idempotency_key,
    break_intervals_snapshot, reason
  ) values (
    target_session, actor, idempotency,
    submitted_intervals, trim(submitted_reason)
  );
  perform internal.append_audit_event(
    actor, 'live.breaks_replaced', 'live_session',
    target_session::text, trim(submitted_reason), null,
    jsonb_build_object(
      'breakIntervals', submitted_intervals,
      'lockedBreakSeconds', break_seconds
    )
  );
  return jsonb_build_object(
    'liveSessionId', target_session,
    'breakIntervals', submitted_intervals,
    'lockedBreakSeconds', break_seconds,
    'replayed', false
  );
end
$$;
revoke all on function internal.replace_draft_live_breaks(
  uuid, jsonb, text, uuid
) from public;

create or replace function public.replace_draft_live_breaks(
  p_live_session_id uuid,
  p_break_intervals jsonb,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.replace_draft_live_breaks(
    p_live_session_id, p_break_intervals, p_reason, p_idempotency_key
  )
$$;

create or replace function internal.prepare_live_session_setup(
  submitted_spec jsonb,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  session_id uuid;
  starts_at timestamptz := (submitted_spec ->> 'startsAt')::timestamptz;
  ends_at timestamptz := (submitted_spec ->> 'endsAt')::timestamptz;
  break_seconds integer := 0;
  break_item jsonb;
  break_starts_at timestamptz;
  break_ends_at timestamptz;
  previous_break_end timestamptz;
  host_reference text;
  duration_seconds integer;
begin
  if not internal.has_staff_role('course_admin')
     or ends_at <= starts_at
     or starts_at <= now()
     or (submitted_spec ->> 'bookingCloseAt')::timestamptz >= starts_at
     or (submitted_spec ->> 'learnerCapacity')::integer not between 1 and 200
     or (submitted_spec ->> 'presenceThreshold')::numeric < 80
     or (submitted_spec ->> 'cameraThreshold')::numeric < 80
  then raise exception 'LIVE_SESSION_SPEC_INVALID'; end if;
  duration_seconds := extract(epoch from ends_at - starts_at)::integer;
  if jsonb_typeof(
       coalesce(submitted_spec -> 'breakIntervals', '[]'::jsonb)
     )
       <> 'array'
     or jsonb_array_length(
       coalesce(submitted_spec -> 'breakIntervals', '[]'::jsonb)
     ) > 20
  then
    raise exception 'LIVE_BREAK_INTERVALS_INVALID';
  end if;
  for break_item in
    select value
    from jsonb_array_elements(
      coalesce(submitted_spec -> 'breakIntervals', '[]'::jsonb)
    )
    order by (value ->> 'startsAt')::timestamptz
  loop
    break_starts_at := (break_item ->> 'startsAt')::timestamptz;
    break_ends_at := (break_item ->> 'endsAt')::timestamptz;
    if break_starts_at is null
       or break_ends_at is null
       or break_ends_at <= break_starts_at
       or break_starts_at < starts_at
       or break_ends_at > ends_at
       or (
         previous_break_end is not null
         and break_starts_at < previous_break_end
       )
    then
      raise exception 'LIVE_BREAK_INTERVALS_INVALID';
    end if;
    break_seconds := break_seconds
      + extract(epoch from break_ends_at - break_starts_at)::integer;
    previous_break_end := break_ends_at;
  end loop;
  if break_seconds < 0
     or duration_seconds <= break_seconds
  then
    raise exception 'LIVE_TEACHING_DURATION_INVALID';
  end if;
  if not exists (
    select 1 from public.course_versions version
    where version.id = (submitted_spec ->> 'courseVersionId')::uuid
      and version.status = 'draft'
      and version.delivery_type in ('live', 'hybrid')
  ) then raise exception 'LIVE_COURSE_DRAFT_REQUIRED'; end if;
  if submitted_spec ->> 'hybridComponentId' is not null
     and not exists (
       select 1 from public.hybrid_components component
       where component.id =
         (submitted_spec ->> 'hybridComponentId')::uuid
         and component.course_version_id =
           (submitted_spec ->> 'courseVersionId')::uuid
         and component.component_type = 'live'
     )
  then raise exception 'LIVE_COMPONENT_MISMATCH'; end if;
  select resource.host_user_reference into host_reference
  from public.zoom_host_resources resource
  where resource.id = (submitted_spec ->> 'hostResourceId')::uuid
    and resource.active
    and resource.license_verified_at >= now() - interval '30 days'
    and resource.verified_total_capacity >=
      (submitted_spec ->> 'verifiedZoomTotalCapacity')::integer
  for update;
  if not found then raise exception 'VERIFIED_ZOOM_HOST_REQUIRED'; end if;

  insert into public.live_sessions (
    course_version_id, hybrid_component_id, title, status,
    starts_at, ends_at, booking_close_at, learner_capacity,
    verified_zoom_total_capacity, host_seats, cohost_seats,
    reserved_support_seats, scheduled_teaching_seconds,
    locked_break_seconds, presence_threshold, camera_threshold,
    evidence_settles_at, application_idempotency_key, created_by
  ) values (
    (submitted_spec ->> 'courseVersionId')::uuid,
    (submitted_spec ->> 'hybridComponentId')::uuid,
    submitted_spec ->> 'title', 'draft', starts_at, ends_at,
    (submitted_spec ->> 'bookingCloseAt')::timestamptz,
    (submitted_spec ->> 'learnerCapacity')::integer,
    (submitted_spec ->> 'verifiedZoomTotalCapacity')::integer,
    (submitted_spec ->> 'hostSeats')::integer,
    (submitted_spec ->> 'cohostSeats')::integer,
    (submitted_spec ->> 'reservedSupportSeats')::integer,
    duration_seconds, break_seconds,
    (submitted_spec ->> 'presenceThreshold')::numeric,
    (submitted_spec ->> 'cameraThreshold')::numeric,
    ends_at + interval '24 hours', idempotency, actor
  ) returning id into session_id;
  for break_item in
    select value
    from jsonb_array_elements(
      coalesce(submitted_spec -> 'breakIntervals', '[]'::jsonb)
    )
  loop
    insert into public.live_breaks (
      live_session_id, starts_at, ends_at
    ) values (
      session_id,
      (break_item ->> 'startsAt')::timestamptz,
      (break_item ->> 'endsAt')::timestamptz
    );
  end loop;
  insert into public.zoom_host_reservations (
    host_resource_id, live_session_id, reservation_window,
    status, expires_at, saga_key
  ) values (
    (submitted_spec ->> 'hostResourceId')::uuid,
    session_id,
    tstzrange(
      starts_at - interval '60 minutes',
      ends_at + interval '60 minutes',
      '[)'
    ),
    'pending', now() + interval '15 minutes', idempotency
  );
  return jsonb_build_object(
    'liveSessionId', session_id,
    'hostUserReference', host_reference,
    'topic', submitted_spec ->> 'title',
    'startsAt', starts_at,
    'durationMinutes', ceil(
      extract(epoch from ends_at - starts_at) / 60
    )::integer
  );
exception
  when unique_violation then
    select jsonb_build_object(
      'liveSessionId', session.id,
      'hostUserReference', resource.host_user_reference,
      'topic', session.title,
      'startsAt', session.starts_at,
      'durationMinutes', ceil(
        extract(epoch from session.ends_at - session.starts_at) / 60
      )::integer
    ) into submitted_spec
    from public.live_sessions session
    join public.zoom_host_reservations reservation
      on reservation.live_session_id = session.id
    join public.zoom_host_resources resource
      on resource.id = reservation.host_resource_id
    join public.course_versions version
      on version.id = session.course_version_id
    where session.application_idempotency_key = idempotency;
    if submitted_spec is not null then return submitted_spec; end if;
    raise;
end
$$;
revoke all on function internal.prepare_live_session_setup(jsonb, uuid)
  from public;

create or replace function public.prepare_live_session_setup(
  p_spec jsonb,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.prepare_live_session_setup(p_spec, p_idempotency_key)
$$;

create or replace function internal.finalize_live_session_setup(
  target_session uuid,
  submitted_meeting_number text,
  submitted_meeting_uuid text,
  submitted_encrypted_passcode jsonb,
  submitted_provider_host_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  version_id uuid;
  actual_break_seconds integer;
  draft_starts_at timestamptz;
  draft_ends_at timestamptz;
begin
  if auth.role() <> 'service_role'
     or submitted_meeting_number = ''
     or submitted_provider_host_id = ''
  then raise exception 'LIVE_SETUP_SERVICE_REQUIRED'; end if;
  select session.course_version_id, session.starts_at, session.ends_at
    into version_id, draft_starts_at, draft_ends_at
  from public.live_sessions session
  join public.course_versions version
    on version.id = session.course_version_id
  join public.zoom_host_reservations reservation
    on reservation.live_session_id = session.id
  where session.id = target_session
    and session.status = 'draft'
    and reservation.status = 'pending'
    and reservation.expires_at > now()
  for update of session, reservation;
  if not found then raise exception 'LIVE_SETUP_SAGA_EXPIRED'; end if;
  select coalesce(sum(
      extract(epoch from formal_break.ends_at - formal_break.starts_at)
    )::integer, 0)
    into actual_break_seconds
  from public.live_breaks formal_break
  where formal_break.live_session_id = target_session
    and formal_break.locked_at is null
    and formal_break.starts_at >= draft_starts_at
    and formal_break.ends_at <= draft_ends_at;
  if actual_break_seconds >=
       extract(epoch from draft_ends_at - draft_starts_at)::integer
     or exists (
       select 1
       from public.live_breaks formal_break
       where formal_break.live_session_id = target_session
         and (
           formal_break.locked_at is not null
           or formal_break.starts_at < draft_starts_at
           or formal_break.ends_at > draft_ends_at
         )
     )
  then
    raise exception 'LIVE_BREAK_INTERVALS_INVALID';
  end if;
  insert into private.zoom_meetings (
    live_session_id, meeting_number, meeting_uuid,
    encrypted_passcode, provider_host_id
  ) values (
    target_session, submitted_meeting_number, submitted_meeting_uuid,
    submitted_encrypted_passcode, submitted_provider_host_id
  );
  perform set_config(
    'app.suiyue_locking_live_breaks',
    target_session::text,
    true
  );
  update public.live_breaks
  set locked_at = clock_timestamp()
  where live_session_id = target_session
    and locked_at is null;
  update public.live_sessions
    set status = 'scheduled',
        locked_break_seconds = actual_break_seconds
    where id = target_session;
  update public.zoom_host_reservations
    set status = 'confirmed', expires_at = null
    where live_session_id = target_session and status = 'pending';
  return true;
end
$$;
revoke all on function internal.finalize_live_session_setup(
  uuid, text, text, jsonb, text
) from public;

create or replace function public.finalize_live_session_setup(
  p_live_session_id uuid,
  p_meeting_number text,
  p_meeting_uuid text,
  p_encrypted_passcode jsonb,
  p_provider_host_id text
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.finalize_live_session_setup(
    p_live_session_id, p_meeting_number, p_meeting_uuid,
    p_encrypted_passcode, p_provider_host_id
  )
$$;

create or replace function internal.fail_live_session_setup(
  target_session uuid,
  submitted_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'LIVE_SETUP_SERVICE_REQUIRED';
  end if;
  update public.live_sessions
  set status = 'cancelled'
  where id = target_session and status = 'draft';
  update public.zoom_host_reservations
  set status = 'released', expires_at = null
  where live_session_id = target_session and status = 'pending';
  insert into public.reconciliation_cases (
    kind, status, reason
  ) values (
    'capacity_unavailable', 'open',
    left('Zoom live setup failed: ' || submitted_reason, 1000)
  );
  return true;
end
$$;
revoke all on function internal.fail_live_session_setup(uuid, text)
  from public;

create or replace function public.fail_live_session_setup(
  p_live_session_id uuid,
  p_reason text
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.fail_live_session_setup(p_live_session_id, p_reason)
$$;

create or replace function internal.assign_live_session_assistant(
  target_session uuid,
  target_person uuid,
  submitted_role text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
begin
  if not internal.has_staff_role('course_admin')
     or submitted_role not in ('assistant', 'cohost', 'reserved_support')
     or not exists (
       select 1 from public.live_sessions session
       where session.id = target_session
         and session.status in ('draft', 'scheduled')
         and session.starts_at > now()
     )
  then raise exception 'LIVE_ASSISTANT_ASSIGNMENT_REJECTED'; end if;
  insert into public.live_session_assistants (
    live_session_id, person_id, role
  ) values (
    target_session, target_person, submitted_role
  ) on conflict (live_session_id, person_id) do update
    set role = excluded.role;
  perform internal.append_audit_event(
    actor, 'live.assistant_assigned', 'live_session',
    target_session::text, 'assistant roster updated', null,
    jsonb_build_object('personId', target_person, 'role', submitted_role)
  );
  return true;
end
$$;
revoke all on function internal.assign_live_session_assistant(
  uuid, uuid, text
) from public;

create or replace function public.assign_live_session_assistant(
  p_live_session_id uuid,
  p_person_id uuid,
  p_role text
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.assign_live_session_assistant(
    p_live_session_id, p_person_id, p_role
  )
$$;

create or replace function internal.request_refund(
  target_case uuid,
  target_order uuid,
  submitted_basis text,
  submitted_reason text,
  submitted_scopes jsonb,
  submitted_account_ciphertext jsonb,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  order_row public.orders%rowtype;
  item_row public.order_items%rowtype;
  entitlement_row public.entitlements%rowtype;
  target_enrollment uuid;
  scope jsonb;
  scope_type text;
  scope_id uuid;
  allocation_amount integer;
  base_amount integer;
  confirmed_seconds integer;
  required_seconds integer;
  supplied_ratio numeric;
  prior_refunds integer;
  prior_scope_refunds integer;
  total_requested integer := 0;
  existing_case uuid;
  recompute_result jsonb;
  recorded_usage_verified boolean := false;
begin
  select refund_case.id into existing_case
  from public.refund_cases refund_case
  where refund_case.requested_by = actor
    and refund_case.idempotency_key = idempotency;
  if found then
    return jsonb_build_object('refundCaseId', existing_case);
  end if;
  if submitted_basis not in (
    'consumer_withdrawal', 'proportional_termination',
    'accreditation_failure', 'provider_failure',
    'suiyue_cancellation', 'material_change', 'other'
  )
     or length(trim(submitted_reason)) < 10
     or jsonb_typeof(submitted_scopes) <> 'array'
     or jsonb_array_length(submitted_scopes) not between 1 and 20
     or (
       select count(*)
       from jsonb_array_elements(submitted_scopes)
     ) <> (
       select count(distinct
         (item ->> 'scopeType') || ':' || coalesce(item ->> 'scopeId', '')
       )
       from jsonb_array_elements(submitted_scopes) item
     )
     or (
       jsonb_array_length(submitted_scopes) > 1
       and exists (
         select 1 from jsonb_array_elements(submitted_scopes) item
         where item ->> 'scopeType' = 'whole_order'
       )
     )
  then raise exception 'REFUND_REQUEST_INVALID'; end if;
  select * into order_row from public.orders
  where id = target_order and person_id = actor
    and status in ('paid', 'paid_unfulfilled')
  for update;
  if not found then raise exception 'PAID_ORDER_REQUIRED'; end if;
  select * into item_row from public.order_items
  where order_id = target_order
  order by created_at limit 1;
  select entitlement.* into entitlement_row
  from public.entitlements entitlement
  where entitlement.person_id = actor
    and entitlement.source_type = 'b2c_order'
    and entitlement.source_id = target_order
  for update;
  select enrollment.id into target_enrollment
  from public.enrollments enrollment
  where enrollment.entitlement_id = entitlement_row.id;
  if target_enrollment is not null
     and exists (
       select 1
       from jsonb_array_elements(submitted_scopes) requested_scope
       where requested_scope ->> 'scopeType'
         in ('recorded', 'whole_order')
     )
  then
    -- Serialize the usage snapshot against an in-flight presence
    -- confirmation. Confirmation locks the same challenge first and rechecks
    -- entitlement state, so either its block is included here or it is
    -- rejected after this refund freezes access.
    perform challenge.id
    from public.presence_challenges challenge
    where challenge.enrollment_id = target_enrollment
    order by challenge.id
    for update;
    recompute_result :=
      internal.recompute_recorded_progress_unchecked(target_enrollment);
    recorded_usage_verified :=
      coalesce((recompute_result ->> 'valid')::boolean, false)
      and not coalesce(
        (recompute_result ->> 'driftDetected')::boolean, true
      );
    confirmed_seconds := case
      when recorded_usage_verified
        then coalesce(
          (recompute_result ->> 'confirmedSeconds')::integer, 0
        )
      else 0
    end;
    update public.presence_challenges challenge
    set timed_out_at = clock_timestamp(),
        consumed_at = clock_timestamp()
    where challenge.enrollment_id = target_enrollment
      and challenge.confirmed_at is null
      and challenge.timed_out_at is null
      and challenge.consumed_at is null;
    update public.playback_sessions session
    set active = false,
        closed_at = coalesce(session.closed_at, clock_timestamp()),
        candidate_unconfirmed_seconds = 0,
        candidate_origin_lesson_video_version_id = null,
        candidate_origin_media_position_seconds = null,
        candidate_event_manifest = '[]'::jsonb
    where session.enrollment_id = target_enrollment;
    update public.progress_summaries summary
    set candidate_seconds = 0,
        updated_at = clock_timestamp()
    where summary.enrollment_id = target_enrollment;
  end if;
  if exists (
    select 1
    from public.certificates certificate
    where certificate.enrollment_id = target_enrollment
      and certificate.current_status = 'credited'
  ) then
    raise exception 'CREDITED_ENROLLMENT_NOT_REFUNDABLE';
  end if;
  if entitlement_row.id is null and not (
    jsonb_array_length(submitted_scopes) = 1
    and submitted_scopes -> 0 ->> 'scopeType' = 'whole_order'
    and order_row.status = 'paid_unfulfilled'
  ) then
    raise exception 'REFUND_SCOPE_REQUIRES_ENTITLEMENT';
  end if;
  select coalesce(sum(allocation.amount_twd), 0) into prior_refunds
  from public.refund_allocations allocation
  join public.refund_cases refund_case
    on refund_case.id = allocation.refund_case_id
  where refund_case.order_id = target_order
    and refund_case.status not in ('rejected', 'failed');

  insert into public.refund_cases (
    id, order_id, requested_by, basis, reason,
    account_details_ciphertext, usage_snapshot, idempotency_key
  ) values (
    target_case, target_order, actor, submitted_basis,
    trim(submitted_reason), submitted_account_ciphertext,
    jsonb_build_object(
      'capturedAt', now(),
      'entitlementId', entitlement_row.id,
      'entitlementStatus', entitlement_row.status,
      'enrollmentId', target_enrollment,
      'recordedUsageVerified', recorded_usage_verified,
      'recordedConfirmedSeconds', coalesce(confirmed_seconds, 0),
      'recordedRecompute', recompute_result
    ),
    idempotency
  );

  for scope in select value from jsonb_array_elements(submitted_scopes)
  loop
    scope_type := scope ->> 'scopeType';
    scope_id := (scope ->> 'scopeId')::uuid;
    if scope_type = 'whole_order' then
      base_amount := order_row.amount_paid_twd;
      supplied_ratio := 0;
      allocation_amount := order_row.amount_paid_twd - prior_refunds;
      update public.entitlements set status = 'frozen',
        locked_reason = 'refund:' || target_case::text
      where id = entitlement_row.id;
    elsif scope_type = 'recorded' then
      if scope_id is distinct from item_row.course_version_id then
        raise exception 'REFUND_SCOPE_INVALID';
      end if;
      base_amount := coalesce(
        (item_row.price_allocation_snapshot ->> 'recorded')::integer, 0
      );
      select greatest(
        coalesce(requirement.required_watch_seconds, 0), 1
      )
        into required_seconds
      from public.course_requirements requirement
      where requirement.course_version_id = item_row.course_version_id;
      supplied_ratio := least(
        1, greatest(0, confirmed_seconds::numeric / required_seconds)
      );
      select coalesce(sum(allocation.amount_twd), 0)
        into prior_scope_refunds
      from public.refund_allocations allocation
      join public.refund_cases refund_case
        on refund_case.id = allocation.refund_case_id
      where refund_case.order_id = target_order
        and refund_case.status not in ('rejected', 'failed')
        and allocation.scope_type = 'recorded'
        and allocation.scope_id = scope_id;
      allocation_amount := ceil(
        base_amount * (1 - supplied_ratio)
      )::integer - prior_scope_refunds;
      update public.playback_sessions
      set active = false, closed_at = now()
      where playback_sessions.enrollment_id = target_enrollment
        and active;
    elsif scope_type = 'live_component' and scope_id is not null then
      if not exists (
        select 1
        from public.live_bookings booking
        where booking.enrollment_id = target_enrollment
          and coalesce(
            booking.live_component_id, booking.course_version_id
          ) = scope_id
      ) then
        raise exception 'REFUND_SCOPE_INVALID';
      end if;
      base_amount := coalesce(
        (
          item_row.price_allocation_snapshot
            -> 'live' ->> scope_id::text
        )::integer,
        0
      );
      select coalesce(
        max(
          attendance.effective_presence_seconds::numeric
          / greatest(attendance.denominator_seconds, 1)
        ), 0
      ) into supplied_ratio
      from public.live_bookings booking
      left join public.attendance_summaries attendance
        on attendance.live_booking_id = booking.id
      where booking.enrollment_id = target_enrollment
        and coalesce(
          booking.live_component_id, booking.course_version_id
        ) = scope_id;
      select coalesce(sum(allocation.amount_twd), 0)
        into prior_scope_refunds
      from public.refund_allocations allocation
      join public.refund_cases refund_case
        on refund_case.id = allocation.refund_case_id
      where refund_case.order_id = target_order
        and refund_case.status not in ('rejected', 'failed')
        and allocation.scope_type = 'live_component'
        and allocation.scope_id = scope_id;
      allocation_amount := ceil(
        base_amount * (1 - least(1, supplied_ratio))
      )::integer - prior_scope_refunds;
      update public.live_bookings set status = 'released'
      where enrollment_id = target_enrollment
        and coalesce(live_component_id, course_version_id) = scope_id
        and status in ('held', 'confirmed');
      update public.live_join_leases lease set active = false
      from public.live_bookings booking
      where booking.id = lease.live_booking_id
        and booking.enrollment_id = target_enrollment
        and coalesce(
          booking.live_component_id, booking.course_version_id
        ) = scope_id
        and lease.active;
    else
      raise exception 'REFUND_SCOPE_INVALID';
    end if;
    if allocation_amount <= 0 then
      raise exception 'REFUND_SCOPE_HAS_NO_REMAINING_VALUE';
    end if;
    total_requested := total_requested + allocation_amount;
    if prior_refunds + total_requested > order_row.amount_paid_twd then
      raise exception 'REFUND_EXCEEDS_PAYMENT';
    end if;
    insert into public.refund_allocations (
      refund_case_id, order_item_id, scope_type, scope_id,
      amount_twd, calculation_snapshot
    ) values (
      target_case, item_row.id, scope_type, scope_id,
      allocation_amount,
      jsonb_build_object(
        'calculatedAt', now(), 'baseAmountTwd', base_amount,
        'suppliedRatio', supplied_ratio,
        'consumerFavorableRounding', 'ceil'
      )
    );
  end loop;
  if exists (
    select 1 from public.refund_allocations allocation
    where allocation.refund_case_id = target_case
      and allocation.scope_type = 'whole_order'
  ) then
    update public.playback_sessions
      set active = false, closed_at = now()
      where enrollment_id = target_enrollment
        and active;
    update public.live_bookings set status = 'released'
      where enrollment_id = target_enrollment
        and status in ('held', 'confirmed');
    update public.live_join_leases lease set active = false
    from public.live_bookings booking
      where booking.id = lease.live_booking_id
      and booking.enrollment_id = target_enrollment
      and lease.active;
  end if;
  perform internal.append_audit_event(
    actor, 'refund.requested', 'refund_case', target_case::text,
    trim(submitted_reason), null,
    jsonb_build_object('orderId', target_order, 'amountTwd', total_requested)
  );
  return jsonb_build_object(
    'refundCaseId', target_case,
    'calculatedAmountTwd', total_requested,
    'status', 'submitted'
  );
end
$$;
revoke all on function internal.request_refund(
  uuid, uuid, text, text, jsonb, jsonb, uuid
) from public;

create or replace function public.request_refund(
  p_refund_case_id uuid,
  p_order_id uuid,
  p_basis text,
  p_reason text,
  p_scopes jsonb,
  p_account_ciphertext jsonb,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.request_refund(
    p_refund_case_id, p_order_id, p_basis, p_reason, p_scopes,
    p_account_ciphertext, p_idempotency_key
  )
$$;

create or replace function internal.decide_refund_case(
  target_case uuid,
  submitted_decision text,
  submitted_reason text,
  submitted_nonce_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  case_row public.refund_cases%rowtype;
  approval_count integer;
  enrollment_id uuid;
begin
  perform internal.consume_step_up_grant(
    'refund_decision', target_case::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('finance')
     or submitted_decision not in ('approve', 'reject')
     or length(trim(submitted_reason)) < 10
  then raise exception 'REFUND_DECISION_REJECTED'; end if;
  select * into case_row from public.refund_cases
  where id = target_case for update;
  if not found
     or case_row.status not in ('submitted', 'reviewing')
     or case_row.requested_by = actor
  then raise exception 'REFUND_CASE_NOT_REVIEWABLE'; end if;
  insert into public.refund_case_decisions (
    refund_case_id, reviewer_id, decision, reason
  ) values (
    target_case, actor, submitted_decision, trim(submitted_reason)
  ) on conflict (refund_case_id, reviewer_id) do nothing;
  if submitted_decision = 'reject' then
    update public.refund_cases
    set status = 'rejected', decided_at = now()
    where id = target_case;
    select enrollment.id into enrollment_id
    from public.enrollments enrollment
    join public.entitlements entitlement
      on entitlement.id = enrollment.entitlement_id
    where entitlement.source_type = 'b2c_order'
      and entitlement.source_id = case_row.order_id;
    update public.entitlements
    set status = 'active', locked_reason = null
    where source_type = 'b2c_order'
      and source_id = case_row.order_id
      and status = 'frozen';
    update public.live_bookings set status = 'confirmed'
    where payer_type = 'b2c'
      and payer_source_id = case_row.order_id
      and status = 'released'
      and exists (
        select 1 from public.live_sessions session
        where session.id = live_bookings.live_session_id
          and session.booking_close_at > now()
      );
    perform internal.append_audit_event(
      actor, 'refund.rejected', 'refund_case', target_case::text,
      trim(submitted_reason), null, '{}'::jsonb
    );
    return 'rejected';
  end if;
  select count(distinct reviewer_id) into approval_count
  from public.refund_case_decisions
  where refund_case_id = target_case and decision = 'approve';
  if approval_count >= 2 then
    update public.refund_cases
    set status = 'approved', decided_at = now()
    where id = target_case;
    return 'approved';
  end if;
  update public.refund_cases set status = 'reviewing'
    where id = target_case;
  return 'reviewing';
end
$$;
revoke all on function internal.decide_refund_case(
  uuid, text, text, text
) from public;

create or replace function public.decide_refund_case(
  p_refund_case_id uuid,
  p_decision text,
  p_reason text,
  p_nonce_hash text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.decide_refund_case(
    p_refund_case_id, p_decision, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.authorize_refund_account_access(
  target_case uuid,
  submitted_reason text,
  submitted_nonce_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  grant_id uuid;
begin
  perform internal.consume_step_up_grant(
    'refund_account', target_case::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('finance')
     or length(trim(submitted_reason)) < 10
     or not exists (
       select 1 from public.refund_cases refund_case
       where refund_case.id = target_case
         and refund_case.status in (
           'approved', 'disbursing', 'partially_disbursed'
         )
         and refund_case.account_details_ciphertext is not null
     )
     or (
       select count(distinct decision.reviewer_id)
       from public.refund_case_decisions decision
       where decision.refund_case_id = target_case
         and decision.decision = 'approve'
     ) < 2
  then
    raise exception 'REFUND_ACCOUNT_ACCESS_REJECTED';
  end if;
  insert into private.refund_account_access_grants (
    refund_case_id, actor_id, expires_at
  ) values (
    target_case, actor, now() + interval '2 minutes'
  ) returning id into grant_id;
  perform internal.append_audit_event(
    actor, 'refund.account_access_authorized', 'refund_case',
    target_case::text, trim(submitted_reason), null,
    jsonb_build_object('grantId', grant_id)
  );
  return jsonb_build_object('grantId', grant_id, 'actorId', actor);
end
$$;
revoke all on function internal.authorize_refund_account_access(
  uuid, text, text
) from public;

create or replace function public.authorize_refund_account_access(
  p_refund_case_id uuid,
  p_reason text,
  p_nonce_hash text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.authorize_refund_account_access(
    p_refund_case_id, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.consume_refund_account_access(
  target_grant uuid,
  target_case uuid,
  target_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'REFUND_ACCOUNT_SERVICE_REQUIRED';
  end if;
  update private.refund_account_access_grants access_grant
  set consumed_at = now()
  from public.refund_cases refund_case
  where access_grant.id = target_grant
    and access_grant.refund_case_id = target_case
    and access_grant.actor_id = target_actor
    and access_grant.consumed_at is null
    and access_grant.expires_at > now()
    and refund_case.id = access_grant.refund_case_id
    and refund_case.status in (
      'approved', 'disbursing', 'partially_disbursed'
    )
    and exists (
      select 1 from public.staff_roles role
      where role.person_id = target_actor
        and role.role in ('finance', 'platform_admin')
        and role.active
    )
  returning refund_case.account_details_ciphertext into result;
  if result is null then
    raise exception 'REFUND_ACCOUNT_CAPABILITY_INVALID';
  end if;
  return result;
end
$$;
revoke all on function internal.consume_refund_account_access(
  uuid, uuid, uuid
) from public;

create or replace function public.consume_refund_account_access(
  p_grant_id uuid,
  p_refund_case_id uuid,
  p_actor_id uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.consume_refund_account_access(
    p_grant_id, p_refund_case_id, p_actor_id
  )
$$;

create or replace function internal.record_refund_disbursement(
  target_allocation uuid,
  submitted_amount integer,
  submitted_external_reference text,
  idempotency uuid,
  submitted_nonce_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  allocation_row public.refund_allocations%rowtype;
  case_row public.refund_cases%rowtype;
  already_disbursed integer;
  next_attempt integer;
  disbursement_id uuid;
begin
  select allocation.* into allocation_row
  from public.refund_allocations allocation
  where allocation.id = target_allocation for update;
  select * into case_row from public.refund_cases
  where id = allocation_row.refund_case_id for update;
  perform internal.consume_step_up_grant(
    'refund_disbursement', case_row.id::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('finance')
     or case_row.status not in (
       'approved', 'disbursing', 'partially_disbursed'
     )
     or submitted_amount <= 0
     or length(trim(submitted_external_reference)) < 3
  then raise exception 'REFUND_DISBURSEMENT_REJECTED'; end if;
  select coalesce(sum(amount_twd), 0), coalesce(max(attempt), 0) + 1
    into already_disbursed, next_attempt
  from public.refund_disbursements
  where refund_allocation_id = target_allocation
    and status in ('pending', 'completed');
  if already_disbursed + submitted_amount > allocation_row.amount_twd then
    raise exception 'REFUND_ALLOCATION_EXCEEDED';
  end if;
  insert into public.refund_disbursements (
    refund_allocation_id, attempt, amount_twd, status,
    external_reference, executed_by, idempotency_key
  ) values (
    target_allocation, next_attempt, submitted_amount, 'pending',
    trim(submitted_external_reference), actor, idempotency
  ) returning id into disbursement_id;
  update public.refund_cases set status = 'disbursing'
    where id = case_row.id;
  return jsonb_build_object(
    'disbursementId', disbursement_id,
    'requiresDistinctConfirmation', true
  );
end
$$;
revoke all on function internal.record_refund_disbursement(
  uuid, integer, text, uuid, text
) from public;

create or replace function public.record_refund_disbursement(
  p_refund_allocation_id uuid,
  p_amount_twd integer,
  p_external_reference text,
  p_idempotency_key uuid,
  p_nonce_hash text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.record_refund_disbursement(
    p_refund_allocation_id, p_amount_twd, p_external_reference,
    p_idempotency_key, p_nonce_hash
  )
$$;

create or replace function internal.confirm_refund_disbursement(
  target_disbursement uuid,
  submitted_reason text,
  submitted_nonce_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  disbursement_row public.refund_disbursements%rowtype;
  allocation_row public.refund_allocations%rowtype;
  case_row public.refund_cases%rowtype;
  total_allocated integer;
  total_completed integer;
  enrollment_row public.enrollments%rowtype;
  certificate_row public.certificates%rowtype;
  revision_row public.certificate_revisions%rowtype;
  new_revision_id uuid;
begin
  select * into disbursement_row
  from public.refund_disbursements
  where id = target_disbursement for update;
  select * into allocation_row from public.refund_allocations
  where id = disbursement_row.refund_allocation_id;
  select * into case_row from public.refund_cases
  where id = allocation_row.refund_case_id for update;
  perform internal.consume_step_up_grant(
    'refund_disbursement', case_row.id::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('finance')
     or disbursement_row.status <> 'pending'
     or disbursement_row.executed_by = actor
     or length(trim(submitted_reason)) < 10
     or (
       select count(distinct reviewer_id)
       from public.refund_case_decisions
       where refund_case_id = case_row.id and decision = 'approve'
     ) < 2
  then raise exception 'REFUND_SECOND_CONFIRMATION_REQUIRED'; end if;
  update public.refund_disbursements
  set status = 'completed', completed_at = now()
  where id = target_disbursement;
  select coalesce(sum(amount_twd), 0) into total_allocated
  from public.refund_allocations where refund_case_id = case_row.id;
  select coalesce(sum(disbursement.amount_twd), 0)
    into total_completed
  from public.refund_disbursements disbursement
  join public.refund_allocations allocation
    on allocation.id = disbursement.refund_allocation_id
  where allocation.refund_case_id = case_row.id
    and disbursement.status = 'completed';
  update public.refund_cases
  set status = case when total_completed = total_allocated
    then 'completed' else 'partially_disbursed' end
  where id = case_row.id;

  select enrollment.* into enrollment_row
  from public.enrollments enrollment
  join public.entitlements entitlement
    on entitlement.id = enrollment.entitlement_id
  where entitlement.source_type = 'b2c_order'
    and entitlement.source_id = case_row.order_id;
  if allocation_row.scope_type = 'whole_order' then
    update public.entitlements
    set status = 'revoked', locked_reason = 'refund completed'
    where id = enrollment_row.entitlement_id;
    update public.enrollments set status = 'refunded'
    where id = enrollment_row.id and status <> 'credited';
  end if;
  select * into certificate_row from public.certificates
  where enrollment_id = enrollment_row.id
    and current_status <> 'credited'
  for update;
  if found then
    select * into revision_row from public.certificate_revisions
    where id = certificate_row.current_revision_id;
    insert into public.certificate_revisions (
      certificate_id, revision, status, masked_name_snapshot,
      course_title_snapshot, course_version_snapshot, completed_on,
      accreditation_reference_snapshot, accreditation_points_snapshot,
      accreditation_authority_snapshot, live_session_snapshot,
      evidence_manifest_hash, pdf_object_path, pdf_sha256,
      verification_token_hash, issued_by, revoked_at, revocation_reason
    ) values (
      certificate_row.id, revision_row.revision + 1, 'revoked',
      revision_row.masked_name_snapshot, revision_row.course_title_snapshot,
      revision_row.course_version_snapshot, revision_row.completed_on,
      revision_row.accreditation_reference_snapshot,
      revision_row.accreditation_points_snapshot,
      revision_row.accreditation_authority_snapshot,
      revision_row.live_session_snapshot,
      revision_row.evidence_manifest_hash, revision_row.pdf_object_path,
      revision_row.pdf_sha256,
      encode(extensions.digest(
        gen_random_uuid()::text || clock_timestamp()::text, 'sha256'
      ), 'hex'),
      actor, now(), trim(submitted_reason)
    ) returning id into new_revision_id;
    update public.certificates
    set current_revision_id = new_revision_id, current_status = 'revoked'
    where id = certificate_row.id;
  end if;
  insert into public.invoice_events (
    invoice_record_id, event_type, amount_twd, actor_id, reason
  )
  select invoice.id,
    case when allocation_row.scope_type = 'whole_order'
          and total_completed = total_allocated
      then 'void_requested' else 'allowance_requested' end,
    disbursement_row.amount_twd, actor, trim(submitted_reason)
  from public.invoice_records invoice
  where invoice.order_id = case_row.order_id;
  insert into public.notifications (
    person_id, category, title, body, business_key
  ) values (
    case_row.requested_by, 'refund', '退款進度已更新',
    '人工匯回已確認；受影響的課程範圍已依退款案件更新。',
    'refund-completed:' || target_disbursement::text
  ) on conflict (person_id, business_key) do nothing;
  perform internal.append_audit_event(
    actor, 'refund.disbursement_confirmed', 'refund_disbursement',
    target_disbursement::text, trim(submitted_reason), null,
    jsonb_build_object(
      'refundCaseId', case_row.id,
      'amountTwd', disbursement_row.amount_twd
    )
  );
  return case when total_completed = total_allocated
    then 'completed' else 'partially_disbursed' end;
end
$$;
revoke all on function internal.confirm_refund_disbursement(
  uuid, text, text
) from public;

create or replace function public.confirm_refund_disbursement(
  p_disbursement_id uuid,
  p_reason text,
  p_nonce_hash text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.confirm_refund_disbursement(
    p_disbursement_id, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.record_manual_invoice_result(
  target_invoice uuid,
  submitted_event_type text,
  submitted_amount integer,
  submitted_external_reference text,
  submitted_reason text,
  submitted_nonce_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  invoice_row public.invoice_records%rowtype;
  request_actor uuid;
  request_amount integer;
begin
  perform internal.consume_step_up_grant(
    'invoice_decision', target_invoice::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('finance')
     or submitted_event_type not in (
       'issued', 'failed', 'allowance_completed', 'void_completed'
     )
     or length(trim(submitted_reason)) < 10
     or (
       submitted_event_type <> 'failed'
       and length(trim(submitted_external_reference)) < 3
     )
  then raise exception 'INVOICE_RESULT_REJECTED'; end if;
  select * into invoice_row from public.invoice_records
  where id = target_invoice for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if submitted_event_type in ('issued', 'failed') then
    if invoice_row.status <> 'pending' then
      raise exception 'INVOICE_ALREADY_RESOLVED';
    end if;
    if submitted_event_type = 'issued'
       and submitted_amount <> invoice_row.amount_twd
    then raise exception 'INVOICE_AMOUNT_MISMATCH'; end if;
    update public.invoice_records
    set status = submitted_event_type,
        external_number = case when submitted_event_type = 'issued'
          then trim(submitted_external_reference) else external_number end,
        issued_on = case when submitted_event_type = 'issued'
          then current_date else issued_on end
    where id = target_invoice;
  else
    select event.actor_id, event.amount_twd
      into request_actor, request_amount
    from public.invoice_events event
    where event.invoice_record_id = target_invoice
      and event.event_type = case submitted_event_type
        when 'allowance_completed' then 'allowance_requested'
        else 'void_requested'
      end
    order by event.created_at desc limit 1;
    if request_actor is null or request_actor = actor
       or submitted_amount is null or submitted_amount <= 0
       or submitted_amount <> request_amount
       or exists (
         select 1 from public.invoice_events completed
         where completed.invoice_record_id = target_invoice
           and completed.event_type = submitted_event_type
           and completed.amount_twd = request_amount
           and completed.created_at > (
             select max(requested.created_at)
             from public.invoice_events requested
             where requested.invoice_record_id = target_invoice
               and requested.event_type = case submitted_event_type
                 when 'allowance_completed' then 'allowance_requested'
                 else 'void_requested'
               end
           )
       )
    then raise exception 'DISTINCT_INVOICE_COMPLETION_REQUIRED'; end if;
  end if;
  insert into public.invoice_events (
    invoice_record_id, event_type, amount_twd,
    external_reference, actor_id, reason
  ) values (
    target_invoice, submitted_event_type,
    case when submitted_event_type = 'failed'
      then null else submitted_amount end,
    nullif(trim(submitted_external_reference), ''),
    actor, trim(submitted_reason)
  );
  perform internal.append_audit_event(
    actor, 'invoice.result_recorded', 'invoice_record',
    target_invoice::text, trim(submitted_reason), null,
    jsonb_build_object(
      'eventType', submitted_event_type,
      'amountTwd', submitted_amount
    )
  );
  return submitted_event_type;
end
$$;
revoke all on function internal.record_manual_invoice_result(
  uuid, text, integer, text, text, text
) from public;

create or replace function public.record_manual_invoice_result(
  p_invoice_id uuid,
  p_event_type text,
  p_amount_twd integer,
  p_external_reference text,
  p_reason text,
  p_nonce_hash text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.record_manual_invoice_result(
    p_invoice_id, p_event_type, p_amount_twd,
    p_external_reference, p_reason, p_nonce_hash
  )
$$;

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
  if auth.role() <> 'service_role'
     or submitted_purpose not in (
       'payment_proof', 'identity_correction', 'course_material',
       'organization_roster', 'bank_statement'
     )
     or submitted_object_path = ''
     or submitted_declared_mime not in (
       'image/jpeg', 'image/png', 'application/pdf',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'text/csv'
     )
     or submitted_byte_size not between 1 and 10000000
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
) from public;

create or replace function public.register_quarantine_upload(
  p_upload_id uuid,
  p_owner_id uuid,
  p_purpose text,
  p_object_path text,
  p_declared_mime text,
  p_byte_size bigint,
  p_sha256 text
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.register_quarantine_upload(
    p_upload_id, p_owner_id, p_purpose, p_object_path,
    p_declared_mime, p_byte_size, p_sha256
  )
$$;

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
begin
  if auth.role() <> 'service_role'
     or submitted_detected_mime = ''
     or (is_safe and submitted_promoted_path is null)
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
      scanner_result = submitted_result,
      scanned_at = now(),
      purge_after = case when is_safe
        then now() + interval '30 days' else now() + interval '7 days' end
  where id = target_upload
    and status in ('quarantined', 'scanning');
  if not found then raise exception 'QUARANTINE_STATE_MISMATCH'; end if;
  update public.provider_health
  set status = 'healthy', checked_at = now(), last_success_at = now(),
      updated_at = now()
  where provider = 'malware_scanner';
  return next_status;
end
$$;
revoke all on function internal.finish_quarantine_scan(
  uuid, boolean, text, integer, bigint, boolean, text, jsonb
) from public;

create or replace function public.finish_quarantine_scan(
  p_upload_id uuid,
  p_safe boolean,
  p_detected_mime text,
  p_archive_entry_count integer,
  p_expanded_byte_size bigint,
  p_metadata_stripped boolean,
  p_promoted_object_path text,
  p_result jsonb
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.finish_quarantine_scan(
    p_upload_id, p_safe, p_detected_mime, p_archive_entry_count,
    p_expanded_byte_size, p_metadata_stripped,
    p_promoted_object_path, p_result
  )
$$;

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
  if auth.role() <> 'service_role' then
    raise exception 'QUARANTINE_SERVICE_REQUIRED';
  end if;
  select jsonb_build_object(
    'objectPath', upload.promoted_object_path,
    'contentSha256', upload.content_sha256,
    'detectedMime', upload.detected_mime
  ) into result
  from public.upload_quarantine upload
  where upload.id = target_upload
    and upload.owner_person_id = target_owner
    and upload.purpose = required_purpose
    and upload.status = 'promoted';
  if result is null then raise exception 'SAFE_UPLOAD_REQUIRED'; end if;
  return result;
end
$$;
revoke all on function internal.read_safe_quarantine_upload(
  uuid, uuid, text
) from public;

create or replace function public.read_safe_quarantine_upload(
  p_upload_id uuid,
  p_owner_id uuid,
  p_purpose text
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_safe_quarantine_upload(
    p_upload_id, p_owner_id, p_purpose
  )
$$;

create or replace function internal.import_bank_statement_batch(
  submitted_source_sha256 text,
  submitted_attachment_reference text,
  submitted_booked_on date,
  submitted_bank_total integer,
  submitted_rows jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  batch_id uuid;
  row_data jsonb;
  calculated_total bigint;
begin
  if not internal.has_staff_role('finance')
     or submitted_source_sha256 !~ '^[a-f0-9]{64}$'
     or submitted_attachment_reference = ''
     or submitted_bank_total < 0
     or jsonb_typeof(submitted_rows) <> 'array'
     or jsonb_array_length(submitted_rows) not between 1 and 5000
  then raise exception 'BANK_IMPORT_REJECTED'; end if;
  select coalesce(sum((value ->> 'amountTwd')::bigint), 0)
    into calculated_total
  from jsonb_array_elements(submitted_rows);
  if calculated_total <> submitted_bank_total then
    raise exception 'BANK_IMPORT_TOTAL_MISMATCH';
  end if;
  insert into public.bank_import_batches (
    source_sha256, attachment_reference, booked_on,
    imported_by, bank_total_twd
  ) values (
    submitted_source_sha256, submitted_attachment_reference,
    submitted_booked_on, actor, submitted_bank_total
  )
  on conflict (source_sha256) do update
    set source_sha256 = excluded.source_sha256
  returning id into batch_id;
  if exists (
    select 1 from public.bank_import_batches batch
    where batch.id = batch_id and batch.imported_by <> actor
  ) then raise exception 'BANK_IMPORT_SOURCE_ALREADY_USED'; end if;
  if exists (
    select 1 from public.bank_transactions transaction_row
    where transaction_row.batch_id = batch_id
  ) then return batch_id; end if;
  for row_data in select value from jsonb_array_elements(submitted_rows)
  loop
    if (row_data ->> 'amountTwd')::integer <= 0
       or coalesce(row_data ->> 'remitterName', '') = ''
       or (
         row_data ->> 'accountLastFive' is not null
         and row_data ->> 'accountLastFive' !~ '^[0-9]{5}$'
       )
       or row_data ->> 'fingerprint' !~ '^[a-f0-9]{64}$'
    then raise exception 'BANK_IMPORT_ROW_INVALID'; end if;
    insert into public.bank_transactions (
      batch_id, bank_fingerprint, booked_on, remitter_name,
      account_last_five, amount_twd, bank_reference, created_by
    ) values (
      batch_id, row_data ->> 'fingerprint', submitted_booked_on,
      row_data ->> 'remitterName', row_data ->> 'accountLastFive',
      (row_data ->> 'amountTwd')::integer,
      row_data ->> 'bankReference', actor
    );
  end loop;
  perform internal.append_audit_event(
    actor, 'bank_statement.imported', 'bank_import_batch',
    batch_id::text, 'quarantined source imported', null,
    jsonb_build_object(
      'sourceSha256', submitted_source_sha256,
      'bankTotalTwd', submitted_bank_total,
      'rowCount', jsonb_array_length(submitted_rows)
    )
  );
  return batch_id;
end
$$;
revoke all on function internal.import_bank_statement_batch(
  text, text, date, integer, jsonb
) from public;

create or replace function public.import_bank_statement_batch(
  p_source_sha256 text,
  p_attachment_reference text,
  p_booked_on date,
  p_bank_total_twd integer,
  p_rows jsonb
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.import_bank_statement_batch(
    p_source_sha256, p_attachment_reference, p_booked_on,
    p_bank_total_twd, p_rows
  )
$$;

create or replace function internal.reconcile_bank_statement_batch(
  target_batch uuid,
  submitted_reason text,
  submitted_nonce_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  batch_row public.bank_import_batches%rowtype;
  transaction_total bigint;
begin
  perform internal.consume_step_up_grant(
    'bank_reconciliation', target_batch::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('finance')
     or length(trim(submitted_reason)) < 10
  then raise exception 'BANK_RECONCILIATION_REJECTED'; end if;
  select * into batch_row from public.bank_import_batches
  where id = target_batch for update;
  if not found
     or batch_row.reconciled_at is not null
     or batch_row.imported_by = actor
  then raise exception 'DISTINCT_BANK_RECONCILER_REQUIRED'; end if;
  select coalesce(sum(amount_twd), 0) into transaction_total
  from public.bank_transactions where batch_id = target_batch;
  if transaction_total <> batch_row.bank_total_twd then
    raise exception 'BANK_RECONCILIATION_TOTAL_MISMATCH';
  end if;
  update public.bank_import_batches
  set reconciled_by = actor, reconciled_at = now()
  where id = target_batch;
  perform internal.append_audit_event(
    actor, 'bank_statement.reconciled', 'bank_import_batch',
    target_batch::text, trim(submitted_reason), null,
    jsonb_build_object('totalTwd', transaction_total)
  );
  return true;
end
$$;
revoke all on function internal.reconcile_bank_statement_batch(
  uuid, text, text
) from public;

create or replace function public.reconcile_bank_statement_batch(
  p_batch_id uuid,
  p_reason text,
  p_nonce_hash text
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.reconcile_bank_statement_batch(
    p_batch_id, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.read_anonymous_survey_aggregate(
  target_version uuid
)
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
  if not (
    internal.has_staff_role('course_admin')
    or exists (
      select 1
      from public.staff_roles role
      join public.instructors instructor on instructor.person_id = role.person_id
      join public.course_instructors course_instructor
        on course_instructor.instructor_id = instructor.id
      where role.person_id = actor
        and role.role = 'instructor'
        and role.active
        and instructor.active
        and course_instructor.course_version_id = target_version
    )
  ) then raise exception 'SURVEY_AGGREGATE_REJECTED'; end if;
  with latest as (
    select distinct on (revision.survey_response_id)
      revision.ratings
    from public.survey_response_revisions revision
    join public.survey_responses response
      on response.id = revision.survey_response_id
    join public.survey_forms form on form.id = response.survey_form_id
    where form.course_version_id = target_version
    order by revision.survey_response_id, revision.revision desc
  )
  select jsonb_build_object(
    'responseCount', count(*),
    'averageRatings', case when count(*) = 0 then '[]'::jsonb else
      jsonb_build_array(
        round(avg(ratings[1]), 2),
        round(avg(ratings[2]), 2),
        round(avg(ratings[3]), 2),
        round(avg(ratings[4]), 2),
        round(avg(ratings[5]), 2)
      )
    end
  ) into result from latest;
  return result;
end
$$;
revoke all on function internal.read_anonymous_survey_aggregate(uuid)
  from public;

create or replace function public.read_anonymous_survey_aggregate(
  p_course_version_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_anonymous_survey_aggregate(p_course_version_id)
$$;

create or replace function internal.read_survey_investigation(
  target_response uuid,
  submitted_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  result jsonb;
begin
  if not internal.has_staff_role('platform_admin')
     or length(trim(submitted_reason)) < 10
  then raise exception 'SURVEY_INVESTIGATION_REJECTED'; end if;
  select jsonb_build_object(
    'surveyResponseId', response.id,
    'enrollmentId', response.enrollment_id,
    'revision', revision.revision,
    'ratings', revision.ratings,
    'comment', revision.optional_comment,
    'submittedAt', revision.submitted_at
  ) into result
  from public.survey_responses response
  join lateral (
    select revision.*
    from public.survey_response_revisions revision
    where revision.survey_response_id = response.id
    order by revision.revision desc limit 1
  ) revision on true
  where response.id = target_response;
  if result is null then raise exception 'SURVEY_RESPONSE_NOT_FOUND'; end if;
  perform internal.append_audit_event(
    actor, 'survey.raw_investigation_read', 'survey_response',
    target_response::text, trim(submitted_reason), null,
    jsonb_build_object('fields', array['ratings', 'optional_comment'])
  );
  return result;
end
$$;
revoke all on function internal.read_survey_investigation(uuid, text)
  from public;

create or replace function public.read_survey_investigation(
  p_survey_response_id uuid,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.read_survey_investigation(
    p_survey_response_id, p_reason
  )
$$;

create or replace function internal.author_course_structure(
  target_version uuid,
  submitted_operation text,
  submitted_spec jsonb,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  request_hash text;
  result jsonb;
  instructor_id uuid;
  target_module_id uuid;
  created_id uuid;
  target_lesson_id uuid;
  target_instructor_id uuid;
  upload_row public.upload_quarantine%rowtype;
  next_sort integer;
  requested_count integer;
  existing_count integer;
  ordered_item record;
  version_row public.course_versions%rowtype;
  component_spec jsonb;
  hybrid_live_total integer := 0;
  hybrid_recorded_total integer := 0;
  dependency_id text;
begin
  if not internal.has_staff_role('course_admin')
     or submitted_operation not in (
       'instructor', 'lesson', 'material', 'cover',
       'course_update',
       'module_update', 'module_delete', 'module_reorder',
       'lesson_update', 'lesson_delete', 'lesson_reorder',
       'instructor_update', 'instructor_delete', 'instructor_reorder'
     )
     or jsonb_typeof(submitted_spec) <> 'object'
     or not exists (
       select 1 from public.course_versions version
       where version.id = target_version
         and version.status = 'draft'
         and (
           version.created_by = actor
           or internal.has_staff_role('platform_admin')
         )
     )
  then raise exception 'COURSE_STRUCTURE_AUTHORING_REJECTED'; end if;
  request_hash := encode(
    extensions.digest(
      target_version::text || '|' || submitted_operation || '|'
        || submitted_spec::text,
      'sha256'
    ),
    'hex'
  );
  insert into public.idempotency_records (
    actor_id, operation, idempotency_key, request_hash, locked_until
  ) values (
    actor, 'course_structure:' || submitted_operation, idempotency,
    request_hash, now() + interval '1 minute'
  )
  on conflict (actor_id, operation, idempotency_key) do nothing;
  if not found then
    select record.response_body into result
    from public.idempotency_records record
    where record.actor_id = actor
      and record.operation = 'course_structure:' || submitted_operation
      and record.idempotency_key = idempotency
      and record.request_hash = request_hash
      and record.completed_at is not null;
    if result is null then raise exception 'IDEMPOTENCY_REQUEST_CONFLICT'; end if;
    return result;
  end if;
  if submitted_operation = 'course_update' then
    select * into version_row
    from public.course_versions version
    where version.id = target_version
      and version.status = 'draft'
    for update;
    if length(trim(coalesce(submitted_spec ->> 'title', ''))) < 2
       or length(trim(coalesce(submitted_spec ->> 'summary', ''))) < 10
       or length(trim(coalesce(submitted_spec ->> 'description', ''))) < 20
       or jsonb_typeof(submitted_spec -> 'learningObjectives') <> 'array'
       or jsonb_array_length(
         submitted_spec -> 'learningObjectives'
       ) < 1
       or coalesce(submitted_spec ->> 'priceTwd', '') !~ '^[0-9]+$'
       or coalesce(
         submitted_spec ->> 'organizationPointPrice', ''
       ) !~ '^[1-9][0-9]*$'
       or coalesce(
         submitted_spec ->> 'recordedRefundAllocationTwd', ''
       ) !~ '^[0-9]+$'
       or coalesce(
         submitted_spec ->> 'minimumCompletionDays', ''
       ) !~ '^[1-9][0-9]*$'
       or coalesce(
         submitted_spec ->> 'requiredWatchSeconds', ''
       ) !~ '^[0-9]+$'
       or nullif(submitted_spec ->> 'legalDocumentId', '') is null
       or nullif(
         submitted_spec ->> 'retentionPolicyRevisionId', ''
       ) is null
       or nullif(
         submitted_spec ->> 'accreditationRevisionId', ''
       ) is null
       or length(trim(coalesce(
         submitted_spec ->> 'accreditationDisclosure', ''
       ))) < 10
       or nullif(submitted_spec ->> 'commerceCloseAt', '') is null
       or nullif(submitted_spec ->> 'contentAvailableAt', '') is null
    then raise exception 'COURSE_UPDATE_SPEC_INVALID'; end if;
    if not exists (
         select 1 from public.legal_documents legal
         where legal.id =
           (submitted_spec ->> 'legalDocumentId')::uuid
           and legal.approved_by_legal
       )
       or not exists (
         select 1 from public.retention_policy_revisions retention
         where retention.id =
           (submitted_spec ->> 'retentionPolicyRevisionId')::uuid
       )
       or not exists (
         select 1
         from public.accreditation_decision_revisions accreditation
         where accreditation.id =
           (submitted_spec ->> 'accreditationRevisionId')::uuid
           and accreditation.course_id = version_row.course_id
           and accreditation.status in ('applying', 'approved')
       )
    then raise exception 'COURSE_UPDATE_PREREQUISITE_INVALID'; end if;
    if version_row.delivery_type in ('live', 'hybrid')
       and (
         coalesce(
           submitted_spec ->> 'livePresencePercent', ''
         ) !~ '^[0-9]+(?:\.[0-9]+)?$'
         or coalesce(
           submitted_spec ->> 'liveCameraPercent', ''
         ) !~ '^[0-9]+(?:\.[0-9]+)?$'
         or (submitted_spec ->> 'livePresencePercent')::numeric
           not between 80 and 100
         or (submitted_spec ->> 'liveCameraPercent')::numeric
           not between 80 and 100
       )
    then raise exception 'COURSE_LIVE_THRESHOLD_INVALID'; end if;

    if version_row.delivery_type = 'recorded' then
      if (submitted_spec ->> 'recordedRefundAllocationTwd')::integer
           <> (submitted_spec ->> 'priceTwd')::integer
         or (
           submitted_spec ? 'hybridComponents'
           and jsonb_array_length(
             submitted_spec -> 'hybridComponents'
           ) <> 0
         )
      then raise exception 'COURSE_REFUND_ALLOCATION_INVALID'; end if;
    elsif version_row.delivery_type = 'live' then
      if (submitted_spec ->> 'recordedRefundAllocationTwd')::integer <> 0
      then raise exception 'COURSE_REFUND_ALLOCATION_INVALID'; end if;
    else
      if jsonb_typeof(submitted_spec -> 'hybridComponents') <> 'array'
      then raise exception 'HYBRID_COMPONENTS_REQUIRED'; end if;
      requested_count :=
        jsonb_array_length(submitted_spec -> 'hybridComponents');
      select count(*) into existing_count
      from public.hybrid_components component
      where component.course_version_id = target_version;
      if requested_count <> existing_count
         or requested_count < 2
         or (
           select count(distinct item.value ->> 'componentId')
           from jsonb_array_elements(
             submitted_spec -> 'hybridComponents'
           ) item
         ) <> existing_count
         or exists (
           select 1
           from jsonb_array_elements(
             submitted_spec -> 'hybridComponents'
           ) item
           where not exists (
             select 1 from public.hybrid_components component
             where component.id =
                 (item.value ->> 'componentId')::uuid
               and component.course_version_id = target_version
           )
         )
      then raise exception 'HYBRID_COMPONENT_SET_IMMUTABLE'; end if;
      update public.hybrid_components
      set sort_order = sort_order + 1000000
      where course_version_id = target_version;
      for component_spec in
        select value
        from jsonb_array_elements(
          submitted_spec -> 'hybridComponents'
        )
        order by (value ->> 'sortOrder')::integer
      loop
        if length(trim(coalesce(component_spec ->> 'title', ''))) < 2
           or coalesce(
             component_spec ->> 'sortOrder', ''
           ) !~ '^[0-9]+$'
           or coalesce(
             component_spec ->> 'refundAllocationTwd', ''
           ) !~ '^[0-9]+$'
           or jsonb_typeof(
             component_spec -> 'dependsOnComponentIds'
           ) <> 'array'
        then raise exception 'HYBRID_COMPONENT_SPEC_INVALID'; end if;
        update public.hybrid_components component
        set title = trim(component_spec ->> 'title'),
            required = coalesce(
              (component_spec ->> 'required')::boolean, true
            ),
            sort_order = (component_spec ->> 'sortOrder')::integer,
            refund_allocation_twd =
              (component_spec ->> 'refundAllocationTwd')::integer
        where component.id =
            (component_spec ->> 'componentId')::uuid
          and component.course_version_id = target_version;
      end loop;
      delete from public.component_prerequisites
      where course_version_id = target_version;
      for component_spec in
        select value
        from jsonb_array_elements(
          submitted_spec -> 'hybridComponents'
        )
      loop
        for dependency_id in
          select value #>> '{}'
          from jsonb_array_elements(
            component_spec -> 'dependsOnComponentIds'
          )
        loop
          if dependency_id =
               component_spec ->> 'componentId'
             or not exists (
               select 1 from public.hybrid_components component
               where component.id = dependency_id::uuid
                 and component.course_version_id = target_version
             )
          then raise exception 'HYBRID_DEPENDENCY_INVALID'; end if;
          insert into public.component_prerequisites (
            course_version_id, prerequisite_component_id,
            dependent_component_id
          ) values (
            target_version, dependency_id::uuid,
            (component_spec ->> 'componentId')::uuid
          );
        end loop;
      end loop;
      select coalesce(sum(component.refund_allocation_twd), 0)
        into hybrid_live_total
      from public.hybrid_components component
      where component.course_version_id = target_version
        and component.component_type = 'live';
      select coalesce(sum(component.refund_allocation_twd), 0)
        into hybrid_recorded_total
      from public.hybrid_components component
      where component.course_version_id = target_version
        and component.component_type = 'recorded';
      if (submitted_spec ->> 'recordedRefundAllocationTwd')::integer
           + hybrid_live_total
         <> (submitted_spec ->> 'priceTwd')::integer
         or hybrid_recorded_total
           <> (submitted_spec ->> 'recordedRefundAllocationTwd')::integer
      then raise exception 'COURSE_REFUND_ALLOCATION_INVALID'; end if;
    end if;

    update public.course_versions
    set title = trim(submitted_spec ->> 'title'),
        summary = trim(submitted_spec ->> 'summary'),
        description = trim(submitted_spec ->> 'description'),
        learning_objectives = submitted_spec -> 'learningObjectives',
        price_twd = (submitted_spec ->> 'priceTwd')::integer,
        organization_point_price =
          (submitted_spec ->> 'organizationPointPrice')::integer,
        recorded_refund_allocation_twd =
          (submitted_spec ->> 'recordedRefundAllocationTwd')::integer,
        live_refund_allocations = case version_row.delivery_type
          when 'recorded' then '{}'::jsonb
          when 'live' then jsonb_build_object(
            target_version::text,
            (submitted_spec ->> 'priceTwd')::integer
          )
          else coalesce((
            select jsonb_object_agg(
              component.id::text,
              component.refund_allocation_twd
            )
            from public.hybrid_components component
            where component.course_version_id = target_version
              and component.component_type = 'live'
          ), '{}'::jsonb)
        end,
        equipment_requirements = coalesce(
          submitted_spec ->> 'equipmentRequirements', ''
        ),
        legal_document_id =
          (submitted_spec ->> 'legalDocumentId')::uuid,
        retention_policy_revision_id =
          (submitted_spec ->> 'retentionPolicyRevisionId')::uuid,
        minimum_completion_window = (
          (submitted_spec ->> 'minimumCompletionDays') || ' days'
        )::interval,
        commerce_close_at =
          (submitted_spec ->> 'commerceCloseAt')::timestamptz,
        content_available_at =
          (submitted_spec ->> 'contentAvailableAt')::timestamptz
    where id = target_version and status = 'draft';
    update public.course_requirements
    set required_watch_seconds =
          (submitted_spec ->> 'requiredWatchSeconds')::integer,
        live_presence_percent = case
          when version_row.delivery_type in ('live', 'hybrid')
            then (submitted_spec ->> 'livePresencePercent')::numeric
          else null end,
        live_camera_percent = case
          when version_row.delivery_type in ('live', 'hybrid')
            then (submitted_spec ->> 'liveCameraPercent')::numeric
          else null end
    where course_version_id = target_version
      and locked_at is null;
    delete from public.course_version_accreditation
    where course_version_id = target_version;
    insert into public.course_version_accreditation (
      course_version_id, accreditation_revision_id,
      disclosure_snapshot
    ) values (
      target_version,
      (submitted_spec ->> 'accreditationRevisionId')::uuid,
      trim(submitted_spec ->> 'accreditationDisclosure')
    );
    result := jsonb_build_object('courseVersionId', target_version);
  elsif submitted_operation = 'module_update' then
    if length(trim(coalesce(submitted_spec ->> 'title', ''))) < 2
    then raise exception 'MODULE_SPEC_INVALID'; end if;
    update public.modules module
    set title = trim(submitted_spec ->> 'title')
    where module.id = (submitted_spec ->> 'moduleId')::uuid
      and module.course_version_id = target_version
    returning module.id into created_id;
    if created_id is null then raise exception 'MODULE_NOT_FOUND'; end if;
    result := jsonb_build_object('moduleId', created_id);
  elsif submitted_operation = 'module_delete' then
    select module.id into target_module_id
    from public.modules module
    where module.id = (submitted_spec ->> 'moduleId')::uuid
      and module.course_version_id = target_version
    for update;
    if target_module_id is null then raise exception 'MODULE_NOT_FOUND'; end if;
    update public.course_materials material
    set lesson_id = null
    where material.lesson_id in (
      select lesson.id from public.lessons lesson
      where lesson.module_id = target_module_id
    );
    delete from public.lesson_video_versions video
    using public.lessons lesson
    where lesson.id = video.lesson_id
      and lesson.module_id = target_module_id;
    delete from public.lessons lesson
    where lesson.module_id = target_module_id;
    delete from public.modules module where module.id = target_module_id;
    result := jsonb_build_object('moduleId', target_module_id);
  elsif submitted_operation = 'module_reorder' then
    if jsonb_typeof(submitted_spec -> 'orderedIds') <> 'array'
    then raise exception 'MODULE_ORDER_INVALID'; end if;
    requested_count := jsonb_array_length(submitted_spec -> 'orderedIds');
    select count(*) into existing_count
    from public.modules module
    where module.course_version_id = target_version;
    if requested_count <> existing_count
       or (
         select count(distinct value #>> '{}')
         from jsonb_array_elements(submitted_spec -> 'orderedIds')
       ) <> existing_count
       or exists (
         select 1
         from jsonb_array_elements(submitted_spec -> 'orderedIds') item
         where not exists (
           select 1 from public.modules module
           where module.id = (item.value #>> '{}')::uuid
             and module.course_version_id = target_version
         )
       )
    then raise exception 'MODULE_ORDER_INVALID'; end if;
    update public.modules
    set sort_order = sort_order + 1000000
    where course_version_id = target_version;
    for ordered_item in
      select value #>> '{}' as item_id, ordinality - 1 as position
      from jsonb_array_elements(submitted_spec -> 'orderedIds')
        with ordinality
    loop
      update public.modules
      set sort_order = ordered_item.position
      where id = ordered_item.item_id::uuid
        and course_version_id = target_version;
    end loop;
    result := jsonb_build_object(
      'orderedIds', submitted_spec -> 'orderedIds'
    );
  elsif submitted_operation = 'lesson_update' then
    if length(trim(coalesce(submitted_spec ->> 'title', ''))) < 2
       or submitted_spec ->> 'contentType'
         not in ('video', 'material', 'quiz', 'survey')
    then raise exception 'LESSON_SPEC_INVALID'; end if;
    update public.lessons lesson
    set title = trim(submitted_spec ->> 'title'),
        content_type = submitted_spec ->> 'contentType',
        preview = coalesce(
          (submitted_spec ->> 'preview')::boolean, false
        )
    from public.modules module
    where lesson.id = (submitted_spec ->> 'lessonId')::uuid
      and module.id = lesson.module_id
      and module.course_version_id = target_version
    returning lesson.id into created_id;
    if created_id is null then raise exception 'LESSON_NOT_FOUND'; end if;
    result := jsonb_build_object('lessonId', created_id);
  elsif submitted_operation = 'lesson_delete' then
    select lesson.id into target_lesson_id
    from public.lessons lesson
    join public.modules module on module.id = lesson.module_id
    where lesson.id = (submitted_spec ->> 'lessonId')::uuid
      and module.course_version_id = target_version
    for update of lesson;
    if target_lesson_id is null then raise exception 'LESSON_NOT_FOUND'; end if;
    update public.course_materials
    set lesson_id = null where lesson_id = target_lesson_id;
    delete from public.lesson_video_versions
    where lesson_id = target_lesson_id;
    delete from public.lessons where id = target_lesson_id;
    result := jsonb_build_object('lessonId', target_lesson_id);
  elsif submitted_operation = 'lesson_reorder' then
    target_module_id := (submitted_spec ->> 'moduleId')::uuid;
    if jsonb_typeof(submitted_spec -> 'orderedIds') <> 'array'
       or not exists (
         select 1 from public.modules module
         where module.id = target_module_id
           and module.course_version_id = target_version
       )
    then raise exception 'LESSON_ORDER_INVALID'; end if;
    requested_count := jsonb_array_length(submitted_spec -> 'orderedIds');
    select count(*) into existing_count
    from public.lessons lesson
    where lesson.module_id = target_module_id;
    if requested_count <> existing_count
       or (
         select count(distinct value #>> '{}')
         from jsonb_array_elements(submitted_spec -> 'orderedIds')
       ) <> existing_count
       or exists (
         select 1
         from jsonb_array_elements(submitted_spec -> 'orderedIds') item
         where not exists (
           select 1 from public.lessons lesson
           where lesson.id = (item.value #>> '{}')::uuid
             and lesson.module_id = target_module_id
         )
       )
    then raise exception 'LESSON_ORDER_INVALID'; end if;
    update public.lessons
    set sort_order = sort_order + 1000000
    where module_id = target_module_id;
    for ordered_item in
      select value #>> '{}' as item_id, ordinality - 1 as position
      from jsonb_array_elements(submitted_spec -> 'orderedIds')
        with ordinality
    loop
      update public.lessons
      set sort_order = ordered_item.position
      where id = ordered_item.item_id::uuid
        and module_id = target_module_id;
    end loop;
    result := jsonb_build_object(
      'moduleId', target_module_id,
      'orderedIds', submitted_spec -> 'orderedIds'
    );
  elsif submitted_operation = 'instructor_update' then
    target_instructor_id :=
      (submitted_spec ->> 'instructorId')::uuid;
    if length(trim(coalesce(submitted_spec ->> 'displayName', ''))) < 2
       or length(trim(coalesce(submitted_spec ->> 'biography', ''))) < 10
       or length(trim(coalesce(submitted_spec ->> 'credentials', ''))) < 5
       or not exists (
         select 1 from public.course_instructors link
         where link.course_version_id = target_version
           and link.instructor_id = target_instructor_id
       )
       or exists (
         select 1
         from public.course_instructors link
         join public.course_versions version
           on version.id = link.course_version_id
         where link.instructor_id = target_instructor_id
           and version.id <> target_version
           and version.status <> 'draft'
       )
    then raise exception 'INSTRUCTOR_PROFILE_IMMUTABLE'; end if;
    update public.instructors
    set display_name = trim(submitted_spec ->> 'displayName'),
        biography = trim(submitted_spec ->> 'biography'),
        credentials = trim(submitted_spec ->> 'credentials')
    where id = target_instructor_id;
    result := jsonb_build_object('instructorId', target_instructor_id);
  elsif submitted_operation = 'instructor_delete' then
    target_instructor_id :=
      (submitted_spec ->> 'instructorId')::uuid;
    delete from public.course_instructors
    where course_version_id = target_version
      and instructor_id = target_instructor_id;
    if not found then raise exception 'INSTRUCTOR_NOT_FOUND'; end if;
    result := jsonb_build_object('instructorId', target_instructor_id);
  elsif submitted_operation = 'instructor_reorder' then
    if jsonb_typeof(submitted_spec -> 'orderedIds') <> 'array'
    then raise exception 'INSTRUCTOR_ORDER_INVALID'; end if;
    requested_count := jsonb_array_length(submitted_spec -> 'orderedIds');
    select count(*) into existing_count
    from public.course_instructors link
    where link.course_version_id = target_version;
    if requested_count <> existing_count
       or (
         select count(distinct value #>> '{}')
         from jsonb_array_elements(submitted_spec -> 'orderedIds')
       ) <> existing_count
       or exists (
         select 1
         from jsonb_array_elements(submitted_spec -> 'orderedIds') item
         where not exists (
           select 1 from public.course_instructors link
           where link.instructor_id = (item.value #>> '{}')::uuid
             and link.course_version_id = target_version
         )
       )
    then raise exception 'INSTRUCTOR_ORDER_INVALID'; end if;
    update public.course_instructors
    set sort_order = sort_order + 1000000
    where course_version_id = target_version;
    for ordered_item in
      select value #>> '{}' as item_id, ordinality - 1 as position
      from jsonb_array_elements(submitted_spec -> 'orderedIds')
        with ordinality
    loop
      update public.course_instructors
      set sort_order = ordered_item.position
      where instructor_id = ordered_item.item_id::uuid
        and course_version_id = target_version;
    end loop;
    result := jsonb_build_object(
      'orderedIds', submitted_spec -> 'orderedIds'
    );
  elsif submitted_operation = 'instructor' then
    if length(trim(coalesce(submitted_spec ->> 'displayName', ''))) < 2
       or length(trim(coalesce(submitted_spec ->> 'biography', ''))) < 10
       or length(trim(coalesce(submitted_spec ->> 'credentials', ''))) < 5
       or (
         submitted_spec ->> 'personId' is not null
         and not exists (
           select 1 from public.people person
           where person.id = (submitted_spec ->> 'personId')::uuid
             and person.anonymized_at is null
         )
       )
    then raise exception 'INSTRUCTOR_PROFILE_INVALID'; end if;
    insert into public.instructors (
      person_id, display_name, biography, credentials
    ) values (
      (submitted_spec ->> 'personId')::uuid,
      trim(submitted_spec ->> 'displayName'),
      trim(submitted_spec ->> 'biography'),
      trim(submitted_spec ->> 'credentials')
    ) returning id into instructor_id;
    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.course_instructors where course_version_id = target_version;
    insert into public.course_instructors (
      course_version_id, instructor_id, sort_order
    ) values (target_version, instructor_id, next_sort);
    result := jsonb_build_object('instructorId', instructor_id);
  elsif submitted_operation = 'lesson' then
    if length(trim(coalesce(submitted_spec ->> 'lessonTitle', ''))) < 2
       or submitted_spec ->> 'contentType'
         not in ('video', 'material', 'quiz', 'survey')
    then raise exception 'LESSON_SPEC_INVALID'; end if;
    if submitted_spec ->> 'moduleId' is null then
      if length(trim(coalesce(submitted_spec ->> 'moduleTitle', ''))) < 2
      then raise exception 'MODULE_TITLE_REQUIRED'; end if;
      select coalesce(max(sort_order), -1) + 1 into next_sort
      from public.modules where course_version_id = target_version;
      insert into public.modules (
        course_version_id, title, sort_order
      ) values (
        target_version, trim(submitted_spec ->> 'moduleTitle'), next_sort
      ) returning id into target_module_id;
    else
      select module.id into target_module_id from public.modules module
      where module.id = (submitted_spec ->> 'moduleId')::uuid
        and module.course_version_id = target_version;
      if target_module_id is null then raise exception 'MODULE_NOT_FOUND'; end if;
    end if;
    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.lessons lesson
    where lesson.module_id = target_module_id;
    insert into public.lessons (
      module_id, title, content_type, preview, sort_order
    ) values (
      target_module_id, trim(submitted_spec ->> 'lessonTitle'),
      submitted_spec ->> 'contentType',
      coalesce((submitted_spec ->> 'preview')::boolean, false),
      next_sort
    ) returning id into created_id;
    result := jsonb_build_object(
      'moduleId', target_module_id, 'lessonId', created_id
    );
  else
    select * into upload_row from public.upload_quarantine upload
    where upload.id = (submitted_spec ->> 'uploadId')::uuid
      and upload.owner_person_id = actor
      and upload.purpose = 'course_material'
      and upload.status = 'promoted'
    for update;
    if not found then raise exception 'SAFE_COURSE_UPLOAD_REQUIRED'; end if;
    if submitted_operation = 'cover' then
      if upload_row.detected_mime not in ('image/jpeg', 'image/png')
      then raise exception 'COURSE_COVER_IMAGE_REQUIRED'; end if;
      update public.course_versions
      set cover_path = upload_row.promoted_object_path,
          has_cover = true
      where id = target_version and status = 'draft';
      result := jsonb_build_object(
        'coverPath', upload_row.promoted_object_path
      );
    else
      if length(trim(coalesce(submitted_spec ->> 'title', ''))) < 2
         or (
           submitted_spec ->> 'lessonId' is not null
           and not exists (
             select 1
             from public.lessons lesson
             join public.modules module on module.id = lesson.module_id
             where lesson.id = (submitted_spec ->> 'lessonId')::uuid
               and module.course_version_id = target_version
           )
         )
      then raise exception 'COURSE_MATERIAL_SPEC_INVALID'; end if;
      insert into public.course_materials (
        course_version_id, lesson_id, title, quarantine_object_path,
        promoted_object_path, scan_status, content_sha256, created_by
      ) values (
        target_version, (submitted_spec ->> 'lessonId')::uuid,
        trim(submitted_spec ->> 'title'), upload_row.object_path,
        upload_row.promoted_object_path, 'safe',
        upload_row.content_sha256, actor
      ) returning id into created_id;
      result := jsonb_build_object('courseMaterialId', created_id);
    end if;
  end if;
  update public.idempotency_records
  set response_status = 200, response_body = result,
      completed_at = now(), locked_until = null
  where actor_id = actor
    and operation = 'course_structure:' || submitted_operation
    and idempotency_key = idempotency;
  perform internal.append_audit_event(
    actor, 'course.' || submitted_operation || '_authored',
    'course_version', target_version::text,
    'draft-only versioned course authoring', null, result
  );
  return result;
end
$$;
revoke all on function internal.author_course_structure(
  uuid, text, jsonb, uuid
) from public;

create or replace function public.author_course_structure(
  p_course_version_id uuid,
  p_operation text,
  p_spec jsonb,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.author_course_structure(
    p_course_version_id, p_operation, p_spec, p_idempotency_key
  )
$$;

create or replace function internal.read_staff_queue_counts(
  requested_queue text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  required_role text;
  result jsonb;
begin
  required_role := case requested_queue
    when 'courses' then null
    when 'accreditation' then 'accreditation_reviewer'
    when 'finance' then 'finance'
    when 'live' then null
    when 'organizations' then 'platform_admin'
    when 'operations' then 'platform_admin'
    else null
  end;
  if requested_queue not in (
       'courses', 'accreditation', 'finance',
       'live', 'organizations', 'operations'
     )
     or (
       requested_queue in ('courses', 'live')
       and not (
         internal.has_staff_role('course_admin')
         or internal.has_staff_role('accreditation_reviewer')
       )
     )
     or (
       required_role is not null
       and not internal.has_staff_role(required_role)
     )
  then raise exception 'STAFF_QUEUE_REJECTED'; end if;
  result := case requested_queue
    when 'courses' then jsonb_build_array(
      jsonb_build_object(
        'label', '草稿／送審中',
        'count', (
          select count(*) from public.course_versions
          where status in ('draft', 'in_review')
        )
      ),
      jsonb_build_object(
        'label', 'Stream 處理失敗',
        'count', (
          select count(*) from public.video_assets where status = 'failed'
        )
      ),
      jsonb_build_object(
        'label', '影片 master 尚未備份',
        'count', (
          select count(*) from public.video_assets
          where status in ('processing', 'ready')
            and master_backup_reference is null
        )
      )
    )
    when 'accreditation' then jsonb_build_array(
      jsonb_build_object(
        'label', '積分身分待核／補正',
        'count', (
          select count(*) from public.identity_verification_cases
          where status in ('open', 'reviewing', 'needs_correction')
        )
      ),
      jsonb_build_object(
        'label', '送審批次待提交',
        'count', (
          select count(*) from public.accreditation_submission_batches
          where status in ('draft', 'approved', 'exported')
        )
      ),
      jsonb_build_object(
        'label', '認可單位結果待補正',
        'count', (
          select count(*) from public.enrollments
          where status = 'needs_correction'
        )
      )
    )
    when 'finance' then jsonb_build_array(
      jsonb_build_object(
        'label', '匯款待核',
        'count', (
          select (
            (select count(*) from public.orders
              where status in ('proof_submitted', 'payment_review'))
            + (select count(*) from public.point_topups
              where status in ('proof_submitted', 'payment_review'))
          )
        )
      ),
      jsonb_build_object(
        'label', '銀行批次待覆核',
        'count', (
          select count(*) from public.bank_import_batches
          where reconciled_at is null
        )
      ),
      jsonb_build_object(
        'label', '人工發票待辦',
        'count', (
          select count(*) from public.invoice_records
          where status in ('pending', 'failed')
        )
      ),
      jsonb_build_object(
        'label', '退款待決定／匯回',
        'count', (
          select (
            (select count(*) from public.refund_cases
              where status not in ('completed', 'rejected'))
            + (select count(*) from public.point_refund_cases
              where status not in ('completed', 'rejected'))
          )
        )
      )
    )
    when 'live' then jsonb_build_array(
      jsonb_build_object(
        'label', '場次容量／provider reconciliation',
        'count', (
          select count(*) from public.live_sessions
          where status = 'reconciling'
        )
      ),
      jsonb_build_object(
        'label', 'Zoom webhook 處理異常',
        'count', (
          select count(*) from public.provider_events
          where provider = 'zoom' and processing_error is not null
        )
      ),
      jsonb_build_object(
        'label', '出席更正待第二人',
        'count', (
          select count(*) from public.attendance_corrections correction
          where not exists (
            select 1
            from public.attendance_correction_decisions decision
            where decision.attendance_correction_id = correction.id
          )
        )
      ),
      jsonb_build_object(
        'label', 'Provider 異常待提案／覆核',
        'count', (
          select (
            (
              select count(*)
              from public.live_join_leases lease
              where lease.duplicate_anomaly_at is not null
                and not exists (
                  select 1
                  from public.provider_anomaly_resolution_requests request
                  left join
                    public.provider_anomaly_resolution_decisions decision
                    on decision.resolution_request_id = request.id
                  where request.live_join_lease_id = lease.id
                    and decision.id is null
                )
            )
            + (
              select count(*)
              from public.provider_anomaly_resolution_requests request
              where not exists (
                select 1
                from public.provider_anomaly_resolution_decisions decision
                where decision.resolution_request_id = request.id
              )
            )
          )
        )
      )
    )
    when 'organizations' then jsonb_build_array(
      jsonb_build_object(
        'label', '機構申請待核',
        'count', (
          select count(*) from public.organizations where status = 'submitted'
        )
      ),
      jsonb_build_object(
        'label', '購點待第二人確認',
        'count', (
          select count(*) from public.point_topups
          where status = 'payment_review'
        )
      ),
      jsonb_build_object(
        'label', '未使用點數退款待辦',
        'count', (
          select count(*) from public.point_refund_cases
          where status not in ('completed', 'rejected')
        )
      )
    )
    else jsonb_build_array(
      jsonb_build_object(
        'label', 'Provider 非健康',
        'count', (
          select count(*) from public.provider_health
          where status <> 'healthy'
            or checked_at < now() - interval '15 minutes'
        )
      ),
      jsonb_build_object(
        'label', '工作／通知 dead-letter',
        'count', (
          select (
            (select count(*) from public.durable_jobs
              where status = 'dead_letter')
            + (select count(*) from public.notification_outbox
              where status = 'dead_letter')
          )
        )
      ),
      jsonb_build_object(
        'label', '未結資安事故',
        'count', (
          select count(*) from public.security_incidents
          where status not in ('resolved', 'closed')
        )
      )
    )
  end;
  return result;
end
$$;
revoke all on function internal.read_staff_queue_counts(text) from public;

create or replace function public.read_staff_queue_counts(
  p_queue text
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_staff_queue_counts(p_queue)
$$;

create or replace function internal.read_staff_queue_items(
  requested_queue text,
  search_text text,
  requested_status text,
  cursor_value text,
  requested_limit integer
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  effective_limit integer := least(greatest(
    coalesce(requested_limit, 25), 1
  ), 100);
  normalized_search text := nullif(trim(search_text), '');
  normalized_status text := nullif(trim(requested_status), '');
  cursor_at timestamptz;
  cursor_item_id text;
  items jsonb := '[]'::jsonb;
  available_statuses jsonb;
  last_item jsonb;
  next_cursor text;
begin
  if requested_queue not in (
       'courses', 'accreditation', 'finance',
       'live', 'organizations', 'operations'
     )
     or (
       requested_queue in ('courses', 'live')
       and not (
         internal.has_staff_role('course_admin')
         or internal.has_staff_role('accreditation_reviewer')
       )
     )
     or (
       requested_queue = 'accreditation'
       and not internal.has_staff_role('accreditation_reviewer')
     )
     or (
       requested_queue = 'finance'
       and not internal.has_staff_role('finance')
     )
     or (
       requested_queue in ('organizations', 'operations')
       and not internal.has_staff_role('platform_admin')
     )
  then
    raise exception 'STAFF_QUEUE_REJECTED';
  end if;
  if cursor_value is not null then
    begin
      cursor_at := split_part(cursor_value, '|', 1)::timestamptz;
      cursor_item_id := substring(
        cursor_value from length(split_part(cursor_value, '|', 1)) + 2
      );
      if cursor_item_id = '' then
        raise exception 'empty cursor id';
      end if;
    exception when others then
      raise exception 'STAFF_QUEUE_CURSOR_INVALID';
    end;
  end if;

  with entries as (
    select
      'courses'::text as queue_name,
      'course:' || version.id::text as item_id,
      'course_version'::text as kind,
      version.title,
      course.slug || '／v' || version.version::text as reference_label,
      version.status,
      case version.status
        when 'draft' then '草稿'
        when 'in_review' then '待發布覆核'
        when 'suspended' then '已暫停'
        else version.status
      end as status_label,
      version.summary,
      coalesce(
        version.submitted_at, version.published_at, version.created_at
      ) as updated_at,
      jsonb_build_array(
        jsonb_build_object('label', '授課型態', 'value', version.delivery_type),
        jsonb_build_object('label', '售價', 'value',
          coalesce(version.price_twd::text, '未設定'))
      ) as context,
      case
        when version.status = 'in_review'
          and internal.has_staff_role('accreditation_reviewer')
          and version.submitted_by is distinct from actor
        then jsonb_build_array(jsonb_build_object(
          'key', 'course_publish',
          'label', '完成獨立覆核並發布',
          'targetId', version.id,
          'payload', '{}'::jsonb
        ))
        else '[]'::jsonb
      end as actions
    from public.course_versions version
    join public.courses course on course.id = version.course_id
    where version.status in ('draft', 'in_review', 'suspended')

    union all
    select
      'accreditation',
      'identity:' || verification.id::text,
      'identity_verification',
      '積分身分審核：' || person.display_name,
      verification.id::text,
      verification.status,
      case verification.status
        when 'open' then '待審核'
        when 'needs_correction' then '待補正'
        else verification.status
      end,
      verification.reason,
      verification.created_at,
      jsonb_build_array(
        jsonb_build_object(
          'label', '學員', 'value', person.display_name
        )
      ),
      case when verification.status in ('open', 'needs_correction')
        and verification.person_id <> actor
      then jsonb_build_array(jsonb_build_object(
        'key', 'identity_decide',
        'label', '檢視遮罩資料並審核',
        'targetId', verification.id,
        'payload', '{}'::jsonb
      )) else '[]'::jsonb end
    from public.identity_verification_cases verification
    join public.people person on person.id = verification.person_id
    where verification.status in ('open', 'needs_correction')

    union all
    select
      'accreditation',
      'export:' || batch.id::text,
      'accreditation_batch',
      '送審名冊：' || version.title,
      batch.id::text,
      batch.status,
      case batch.status
        when 'approved' then '已覆核，待匯出'
        when 'exported' then '已匯出'
        when 'needs_correction' then '待補正'
        else batch.status
      end,
      '模板版本 ' || batch.template_version,
      batch.created_at,
      jsonb_build_array(
        jsonb_build_object(
          'label', '課程', 'value', version.title
        )
      ),
      case when batch.status = 'approved'
      then jsonb_build_array(jsonb_build_object(
        'key', 'export_generate_download',
        'label', '產生並下載一次性送審檔',
        'targetId', batch.id,
        'payload', '{}'::jsonb
      )) else '[]'::jsonb end
    from public.accreditation_submission_batches batch
    join public.course_versions version
      on version.id = batch.course_version_id
    where batch.status in (
      'approved', 'exported', 'submitted', 'needs_correction'
    )

    union all
    select
      'live',
      'live-session:' || session.id::text,
      'live_session',
      session.title,
      session.id::text,
      session.status,
      case session.status
        when 'scheduled' then '已排程'
        when 'open' then '已開放'
        when 'in_progress' then '進行中'
        when 'reconciling' then '證據核對中'
        when 'ended' then '已結束'
        else session.status
      end,
      '場次 ' || session.starts_at::text,
      case when session.status in ('ended', 'reconciling')
        then session.ends_at else session.starts_at end,
      jsonb_build_array(
        jsonb_build_object(
          'label', '容量', 'value', session.learner_capacity::text
        ),
        jsonb_build_object(
          'label', '開始', 'value', session.starts_at::text
        )
      ),
      jsonb_build_array(jsonb_build_object(
        'key', 'live_open',
        'label', '開啟場次工作台',
        'targetId', session.id,
        'payload', '{}'::jsonb
      ))
    from public.live_sessions session
    where session.status in (
      'scheduled', 'open', 'in_progress', 'reconciling', 'ended'
    )

    union all
    select
      'live',
      'attendance:' || correction.id::text,
      'attendance_correction',
      '出席更正覆核',
      correction.id::text,
      correction.status,
      case correction.status
        when 'pending' then '待第二人覆核'
        else correction.status
      end,
      correction.reason,
      correction.created_at,
      jsonb_build_array(
        jsonb_build_object(
          'label', '證據索引',
          'value', correction.evidence_reference
        )
      ),
      case when correction.status = 'pending'
        and correction.proposed_by <> actor
        and internal.has_staff_role('accreditation_reviewer')
      then jsonb_build_array(jsonb_build_object(
        'key', 'attendance_decide',
        'label', '獨立覆核出席更正',
        'targetId', correction.id,
        'payload', '{}'::jsonb
      )) else '[]'::jsonb end
    from public.attendance_corrections correction
    where not exists (
      select 1
      from public.attendance_correction_decisions decision
      where decision.attendance_correction_id = correction.id
    )

    union all
    select
      'live',
      'provider-anomaly:' || lease.id::text,
      'provider_anomaly',
      'Zoom 參與者重複：' || person.display_name,
      lease.id::text,
      'unresolved',
      '待提出雙人補正',
      session.title,
      lease.duplicate_anomaly_at,
      jsonb_build_array(
        jsonb_build_object(
          'label', '場次', 'value', session.starts_at::text
        ),
        jsonb_build_object(
          'label', '憑證尾碼',
          'value', right(lease.provider_customer_key, 6)
        )
      ),
      case when internal.has_staff_role('course_admin')
      then jsonb_build_array(jsonb_build_object(
        'key', 'provider_anomaly_propose',
        'label', '提出 Provider 異常補正',
        'targetId', lease.id,
        'payload', jsonb_build_object(
          'allowedResolutionKinds',
          jsonb_build_array(
            'synthesize_left', 'accept_provider_evidence',
            'disqualify_booking'
          )
        )
      )) else '[]'::jsonb end
    from public.live_join_leases lease
    join public.live_bookings booking
      on booking.id = lease.live_booking_id
    join public.live_sessions session
      on session.id = booking.live_session_id
    join public.people person on person.id = lease.person_id
    where lease.duplicate_anomaly_at is not null
      and not exists (
        select 1
        from public.provider_anomaly_resolution_requests request
        left join public.provider_anomaly_resolution_decisions decision
          on decision.resolution_request_id = request.id
        where request.live_join_lease_id = lease.id
          and decision.id is null
      )

    union all
    select
      'live',
      'provider-resolution:' || request.id::text,
      'provider_anomaly_resolution',
      'Provider 異常補正覆核：' || person.display_name,
      request.id::text,
      'pending',
      '待第二人覆核',
      request.reason,
      request.created_at,
      jsonb_build_array(
        jsonb_build_object(
          'label', '處理方式', 'value', request.resolution_kind
        ),
        jsonb_build_object(
          'label', '證據索引', 'value', request.evidence_reference
        ),
        jsonb_build_object(
          'label', '提案人', 'value', proposer.display_name
        )
      ),
      case when request.proposed_by <> actor
        and internal.has_staff_role('accreditation_reviewer')
      then jsonb_build_array(jsonb_build_object(
        'key', 'provider_anomaly_decide',
        'label', '獨立覆核 Provider 補正',
        'targetId', request.id,
        'payload', jsonb_build_object(
          'resolutionKind', request.resolution_kind
        )
      )) else '[]'::jsonb end
    from public.provider_anomaly_resolution_requests request
    join public.live_join_leases lease
      on lease.id = request.live_join_lease_id
    join public.live_bookings booking
      on booking.id = lease.live_booking_id
    join public.live_sessions session
      on session.id = booking.live_session_id
    join public.people person on person.id = lease.person_id
    join public.people proposer on proposer.id = request.proposed_by
    where not exists (
      select 1
      from public.provider_anomaly_resolution_decisions decision
      where decision.resolution_request_id = request.id
    )

    union all
    select
      'organizations',
      'organization:' || organization.id::text,
      'organization_application',
      organization.legal_name,
      organization.id::text,
      organization.status,
      case organization.status
        when 'submitted' then '待首次審核'
        when 'suspended' then '已停權'
        else organization.status
      end,
      '機構申請',
      coalesce(organization.reviewed_at, organization.created_at),
      jsonb_build_array(
        jsonb_build_object(
          'label', '發票 Email', 'value', organization.invoice_email
        )
      ),
      case when organization.status = 'submitted'
        and organization.contact_person_id is distinct from actor
      then jsonb_build_array(jsonb_build_object(
        'key', 'organization_review',
        'label', '審核機構申請',
        'targetId', organization.id,
        'payload', '{}'::jsonb
      )) else '[]'::jsonb end
    from public.organizations organization
    where organization.status in ('submitted', 'suspended')

    union all
    select
      'operations',
      'prerequisite:' || change.id::text,
      'platform_prerequisite',
      '平台前置設定：' || change.kind,
      change.id::text,
      change.status,
      case change.status
        when 'pending_review' then '待第二位管理員覆核'
        else change.status
      end,
      change.creation_reason,
      change.created_at,
      jsonb_build_array(
        jsonb_build_object('label', '類型', 'value', change.kind)
      ),
      case when change.status = 'pending_review'
        and change.created_by <> actor
      then jsonb_build_array(jsonb_build_object(
        'key', 'prerequisite_decide',
        'label', '獨立覆核並套用',
        'targetId', change.id,
        'payload', jsonb_build_object('kind', change.kind)
      )) else '[]'::jsonb end
    from public.platform_prerequisite_changes change
    where change.status = 'pending_review'

    union all
    select
      'operations',
      'role-request:' || request.id::text,
      'role_change_request',
      '後台角色異動：' || person.display_name,
      request.id::text,
      request.status,
      case request.status when 'pending' then '待第二人覆核'
        else request.status end,
      request.reason,
      request.created_at,
      jsonb_build_array(
        jsonb_build_object(
          'label', '異動',
          'value', request.requested_action || ' '
            || request.requested_role
        )
      ),
      case when request.status = 'pending'
        and request.requested_by <> actor
        and request.subject_person_id <> actor
      then jsonb_build_array(jsonb_build_object(
        'key', 'role_change_decide',
        'label', '獨立覆核角色異動',
        'targetId', request.id,
        'payload', jsonb_build_object(
          'subjectLabel', person.display_name,
          'role', request.requested_role,
          'action', request.requested_action
        )
      )) else '[]'::jsonb end
    from public.role_approval_requests request
    join public.people person on person.id = request.subject_person_id
    where request.status = 'pending'

    union all
    select
      'operations',
      'staff-person:' || person.id::text,
      'staff_role_subject',
      '管理後台成員：' || person.display_name,
      person.id::text,
      'active',
      '可申請角色異動',
      '建立另一位管理員覆核的異動申請',
      max(role.created_at),
      jsonb_build_array(
        jsonb_build_object(
          'label', '目前角色',
          'value', string_agg(role.role, '、' order by role.role)
        )
      ),
      jsonb_build_array(jsonb_build_object(
        'key', 'role_change_request',
        'label', '建立角色異動申請',
        'targetId', person.id,
        'payload', jsonb_build_object(
          'subjectLabel', person.display_name,
          'availableRoles',
          'instructor,course_admin,accreditation_reviewer,finance,support,platform_admin'
        )
      ))
    from public.people person
    join public.staff_roles role
      on role.person_id = person.id and role.active
    where person.anonymized_at is null
    group by person.id, person.display_name

    union all
    select
      'finance',
      'bank-batch:' || batch.id::text,
      'bank_import_batch',
      '銀行入帳批次 ' || batch.booked_on::text,
      batch.id::text,
      'unreconciled',
      '待獨立覆核',
      '銀行總額 NT$' || batch.bank_total_twd::text,
      batch.created_at,
      jsonb_build_array(
        jsonb_build_object(
          'label', '匯入人', 'value', importer.display_name
        )
      ),
      case when batch.reconciled_at is null
        and batch.imported_by <> actor
      then jsonb_build_array(jsonb_build_object(
        'key', 'bank_reconcile',
        'label', '核對銀行批次',
        'targetId', batch.id,
        'payload', '{}'::jsonb
      )) else '[]'::jsonb end
    from public.bank_import_batches batch
    join public.people importer on importer.id = batch.imported_by
    where batch.reconciled_at is null

    union all
    select
      'finance',
      'finance-order:' || orders.id::text,
      'payment_allocation',
      '個人匯款配對：' || orders.order_number,
      orders.id::text,
      orders.status,
      '已有入帳候選，可進行配置',
      '待收 NT$'
        || (orders.amount_due_twd - orders.amount_paid_twd)::text,
      greatest(orders.created_at, match.created_at),
      jsonb_build_array(
        jsonb_build_object(
          'label', '銀行交易', 'value', match.bank_reference
        ),
        jsonb_build_object(
          'label', '候選金額',
          'value', 'NT$' || match.allocatable_twd::text
        )
      ),
      jsonb_build_array(jsonb_build_object(
        'key', 'finance_allocate',
        'label', '配置銀行入帳至此訂單',
        'targetId', orders.id,
        'payload', jsonb_build_object(
          'targetType', 'order',
          'bankTransactionId', match.bank_transaction_id,
          'amountTwd', least(
            match.allocatable_twd,
            orders.amount_due_twd - orders.amount_paid_twd
          )
        )
      ))
    from public.orders orders
    join lateral (
      select
        transaction_row.id as bank_transaction_id,
        transaction_row.bank_reference,
        transaction_row.created_at,
        transaction_row.amount_twd - coalesce((
          select sum(case allocation.allocation_kind
            when 'allocation' then allocation.amount_twd
            else -allocation.amount_twd end
          )
          from public.bank_transaction_allocations allocation
          where allocation.bank_transaction_id = transaction_row.id
        ), 0)::integer as allocatable_twd
      from public.payment_proofs proof
      join public.bank_transactions transaction_row
        on transaction_row.amount_twd = proof.amount_twd
       and transaction_row.account_last_five =
         proof.account_last_five
      join public.bank_import_batches reconciled_batch
        on reconciled_batch.id = transaction_row.batch_id
       and reconciled_batch.reconciled_at is not null
      where proof.order_id = orders.id
        and (
          proof.scan_status = 'not_provided'
          or proof.scan_status = 'safe'
        )
        and transaction_row.amount_twd - coalesce((
          select sum(case allocation.allocation_kind
            when 'allocation' then allocation.amount_twd
            else -allocation.amount_twd end
          )
          from public.bank_transaction_allocations allocation
          where allocation.bank_transaction_id = transaction_row.id
        ), 0) > 0
      order by transaction_row.booked_on, transaction_row.id
      limit 1
    ) match on true
    where orders.status in (
      'proof_submitted', 'payment_review', 'pending_transfer', 'expired'
    )
      and orders.amount_paid_twd < orders.amount_due_twd

    union all
    select
      'finance',
      'finance-topup:' || topup.id::text,
      'topup_payment_allocation',
      '機構購點匯款配對：' || organization.legal_name,
      topup.id::text,
      topup.status,
      '已有入帳候選，可進行配置',
      '待收 NT$'
        || (topup.amount_due_twd - topup.amount_paid_twd)::text,
      greatest(topup.created_at, match.created_at),
      jsonb_build_array(
        jsonb_build_object(
          'label', '銀行交易', 'value', match.bank_reference
        ),
        jsonb_build_object(
          'label', '候選金額',
          'value', 'NT$' || match.allocatable_twd::text
        )
      ),
      jsonb_build_array(jsonb_build_object(
        'key', 'finance_allocate',
        'label', '配置銀行入帳至此購點單',
        'targetId', topup.id,
        'payload', jsonb_build_object(
          'targetType', 'topup',
          'bankTransactionId', match.bank_transaction_id,
          'amountTwd', least(
            match.allocatable_twd::bigint,
            topup.amount_due_twd - topup.amount_paid_twd
          )
        )
      ))
    from public.point_topups topup
    join public.organizations organization
      on organization.id = topup.organization_id
    join lateral (
      select
        transaction_row.id as bank_transaction_id,
        transaction_row.bank_reference,
        transaction_row.created_at,
        transaction_row.amount_twd - coalesce((
          select sum(case allocation.allocation_kind
            when 'allocation' then allocation.amount_twd
            else -allocation.amount_twd end
          )
          from public.bank_transaction_allocations allocation
          where allocation.bank_transaction_id = transaction_row.id
        ), 0)::integer as allocatable_twd
      from public.payment_proofs proof
      join public.bank_transactions transaction_row
        on transaction_row.amount_twd = proof.amount_twd
       and transaction_row.account_last_five =
         proof.account_last_five
      join public.bank_import_batches reconciled_batch
        on reconciled_batch.id = transaction_row.batch_id
       and reconciled_batch.reconciled_at is not null
      where proof.topup_id = topup.id
        and (
          proof.scan_status = 'not_provided'
          or proof.scan_status = 'safe'
        )
        and transaction_row.amount_twd - coalesce((
          select sum(case allocation.allocation_kind
            when 'allocation' then allocation.amount_twd
            else -allocation.amount_twd end
          )
          from public.bank_transaction_allocations allocation
          where allocation.bank_transaction_id = transaction_row.id
        ), 0) > 0
      order by transaction_row.booked_on, transaction_row.id
      limit 1
    ) match on true
    where topup.status in (
      'proof_submitted', 'payment_review', 'pending_transfer'
    )
      and topup.amount_paid_twd < topup.amount_due_twd

    union all
    select
      'finance',
      'allocation:' || allocation.id::text,
      'bank_allocation',
      case when allocation.order_id is not null
        then '個人訂單入帳第二覆核'
        else '機構購點入帳第二覆核'
      end,
      allocation.id::text,
      'second_review',
      '待第二人確認',
      '配置金額 NT$' || allocation.amount_twd::text,
      allocation.created_at,
      jsonb_build_array(
        jsonb_build_object(
          'label', '配置人', 'value', allocator.display_name
        )
      ),
      case when allocation.allocated_by <> actor
      then jsonb_build_array(jsonb_build_object(
        'key', 'finance_confirm',
        'label', '第二人確認入帳',
        'targetId', allocation.id,
        'payload', jsonb_build_object(
          'targetType', case when allocation.order_id is not null
            then 'order' else 'topup' end
        )
      )) else '[]'::jsonb end
    from public.bank_transaction_allocations allocation
    join public.people allocator on allocator.id = allocation.allocated_by
    left join public.bank_allocation_reviews review
      on review.allocation_id = allocation.id
    where allocation.allocation_kind = 'allocation'
      and review.id is null

    union all
    select
      'finance',
      'invoice:' || invoice.id::text,
      'manual_invoice',
      '人工發票結果',
      invoice.id::text,
      invoice.status,
      case invoice.status
        when 'pending' then '待開立'
        when 'failed' then '開立失敗'
        else invoice.status
      end,
      '發票金額 NT$' || invoice.amount_twd::text,
      invoice.created_at,
      jsonb_build_array(
        jsonb_build_object(
          'label', '買受人', 'value',
          coalesce(invoice.buyer_name, '未填')
        )
      ),
      jsonb_build_array(jsonb_build_object(
        'key', 'invoice_result',
        'label', '登錄人工發票結果',
        'targetId', invoice.id,
        'payload', jsonb_build_object(
          'amountTwd', invoice.amount_twd,
          'maxAmountTwd', invoice.amount_twd,
          'invoiceStatus', invoice.status
        )
      ))
    from public.invoice_records invoice
    where invoice.status in ('pending', 'failed')

    union all
    select
      'finance',
      'refund:' || refund.id::text,
      'refund_case',
      '個人退款案件 ' || orders.order_number,
      refund.id::text,
      refund.status,
      case refund.status
        when 'submitted' then '待第一位審核'
        when 'reviewing' then '待第二位審核'
        else refund.status
      end,
      refund.reason,
      refund.submitted_at,
      jsonb_build_array(
        jsonb_build_object(
          'label', '退款事由', 'value', refund.basis
        )
      ),
      case when refund.status in ('submitted', 'reviewing')
        and refund.requested_by <> actor
        and not exists (
          select 1 from public.refund_case_decisions decision
          where decision.refund_case_id = refund.id
            and decision.reviewer_id = actor
        )
      then jsonb_build_array(jsonb_build_object(
        'key', 'refund_decide',
        'label', '審核退款',
        'targetId', refund.id,
        'payload', '{}'::jsonb
      )) else '[]'::jsonb end
    from public.refund_cases refund
    join public.orders orders on orders.id = refund.order_id
    where refund.status in ('submitted', 'reviewing')

    union all
    select
      'finance',
      'refund-allocation:' || allocation.id::text,
      'refund_allocation',
      '執行退款匯回',
      refund.id::text,
      refund.status,
      '已核准，待匯回',
      allocation.scope_type || '／NT$'
        || remaining.remaining_twd::text,
      allocation.created_at,
      jsonb_build_array(
        jsonb_build_object(
          'label', '剩餘可匯回',
          'value', 'NT$' || remaining.remaining_twd::text
        )
      ),
      jsonb_build_array(jsonb_build_object(
        'key', 'refund_disburse',
        'label', '取得一次性帳戶資料並匯回',
        'targetId', refund.id,
        'payload', jsonb_build_object(
          'allocationId', allocation.id,
          'maxAmountTwd', remaining.remaining_twd,
          'allocationLabel', allocation.scope_type
        )
      ))
    from public.refund_allocations allocation
    join public.refund_cases refund
      on refund.id = allocation.refund_case_id
    cross join lateral (
      select allocation.amount_twd - coalesce(sum(
        disbursement.amount_twd
      ) filter (
        where disbursement.status in ('pending', 'completed')
      ), 0)::integer as remaining_twd
      from public.refund_disbursements disbursement
      where disbursement.refund_allocation_id = allocation.id
    ) remaining
    where refund.status in (
      'approved', 'disbursing', 'partially_disbursed'
    )
      and remaining.remaining_twd > 0
      and not exists (
        select 1 from public.refund_disbursements pending
        where pending.refund_allocation_id = allocation.id
          and pending.status = 'pending'
      )

    union all
    select
      'finance',
      'refund-disbursement:' || disbursement.id::text,
      'refund_disbursement',
      '退款匯回第二人確認',
      disbursement.id::text,
      disbursement.status,
      '待第二人確認',
      '匯回 NT$' || disbursement.amount_twd::text,
      disbursement.created_at,
      jsonb_build_array(
        jsonb_build_object(
          'label', '外部序號', 'value',
          coalesce(disbursement.external_reference, '未填')
        )
      ),
      case when disbursement.executed_by is distinct from actor
      then jsonb_build_array(jsonb_build_object(
        'key', 'refund_disbursement_confirm',
        'label', '第二人確認退款結果',
        'targetId', disbursement.id,
        'payload', jsonb_build_object(
          'refundCaseId', refund.id,
          'amountTwd', disbursement.amount_twd,
          'externalReference', disbursement.external_reference
        )
      )) else '[]'::jsonb end
    from public.refund_disbursements disbursement
    join public.refund_allocations allocation
      on allocation.id = disbursement.refund_allocation_id
    join public.refund_cases refund
      on refund.id = allocation.refund_case_id
    where disbursement.status = 'pending'

    union all
    select
      'finance',
      'point-refund:' || refund.id::text,
      'point_refund',
      '機構未使用點數退款：' || organization.legal_name,
      refund.id::text,
      refund.status,
      case refund.status
        when 'submitted' then '待第一位審核'
        when 'reviewing' then '待第二位審核'
        when 'approved' then '待匯回'
        when 'failed' then '匯回失敗'
        else refund.status
      end,
      refund.points::text || ' 點／NT$' || refund.amount_twd::text,
      coalesce(refund.decided_at, refund.requested_at),
      jsonb_build_array(
        jsonb_build_object(
          'label', '機構', 'value', organization.legal_name
        )
      ),
      case
        when refund.status in ('submitted', 'reviewing')
          and refund.requested_by <> actor
          and refund.first_approved_by is distinct from actor
        then jsonb_build_array(jsonb_build_object(
          'key', 'point_refund_decide',
          'label', '審核點數退款',
          'targetId', refund.id,
          'payload', jsonb_build_object(
            'organizationLabel', organization.legal_name,
            'points', refund.points,
            'amountTwd', refund.amount_twd
          )
        ))
        when refund.status in ('approved', 'disbursing', 'failed')
          and refund.requested_by <> actor
          and refund.first_approved_by is not null
          and refund.second_approved_by is not null
        then jsonb_build_array(jsonb_build_object(
          'key', 'point_refund_result',
          'label', '取得帳戶資料並登錄匯回結果',
          'targetId', refund.id,
          'payload', jsonb_build_object(
            'organizationLabel', organization.legal_name,
            'points', refund.points,
            'amountTwd', refund.amount_twd
          )
        ))
        else '[]'::jsonb
      end
    from public.point_refund_cases refund
    join public.organizations organization
      on organization.id = refund.organization_id
    where refund.status in (
      'submitted', 'reviewing', 'approved', 'disbursing', 'failed'
    )

    union all
    select
      'operations',
      'provider:' || health.provider,
      'provider_health',
      '外部服務：' || health.provider,
      health.provider,
      health.status,
      case health.status
        when 'healthy' then '正常'
        when 'degraded' then '降級'
        when 'down' then '中斷'
        else health.status
      end,
      coalesce(health.details ->> 'message', '等待健康檢查'),
      coalesce(health.checked_at, health.updated_at),
      jsonb_build_array(
        jsonb_build_object(
          'label', '最後成功',
          'value', coalesce(health.last_success_at::text, '尚無')
        )
      ),
      '[]'::jsonb
    from public.provider_health health
    where health.status <> 'healthy'
       or health.checked_at is null
       or health.checked_at < now() - interval '15 minutes'
  ),
  filtered as (
    select *
    from entries entry
    where entry.queue_name = requested_queue
      and (
        normalized_status is null
        or entry.status = normalized_status
      )
      and (
        normalized_search is null
        or concat_ws(
          ' ', entry.title, entry.reference_label,
          entry.summary, entry.status_label
        ) ilike '%' || normalized_search || '%'
      )
      and (
        cursor_at is null
        or (entry.updated_at, entry.item_id)
          < (cursor_at, cursor_item_id)
      )
    order by entry.updated_at desc, entry.item_id desc
    limit effective_limit
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'itemId', filtered.item_id,
      'kind', filtered.kind,
      'title', filtered.title,
      'referenceLabel', filtered.reference_label,
      'status', filtered.status,
      'statusLabel', filtered.status_label,
      'summary', filtered.summary,
      'updatedAt', filtered.updated_at,
      'context', filtered.context,
      'actions', filtered.actions
    )
    order by filtered.updated_at desc, filtered.item_id desc
  ), '[]'::jsonb)
  into items
  from filtered;

  available_statuses := case requested_queue
    when 'courses' then jsonb_build_array(
      jsonb_build_object('value', 'draft', 'label', '草稿'),
      jsonb_build_object('value', 'in_review', 'label', '待發布覆核'),
      jsonb_build_object('value', 'suspended', 'label', '已暫停')
    )
    when 'accreditation' then jsonb_build_array(
      jsonb_build_object('value', 'open', 'label', '待審核'),
      jsonb_build_object('value', 'needs_correction', 'label', '待補正'),
      jsonb_build_object('value', 'approved', 'label', '已覆核待匯出')
    )
    when 'finance' then jsonb_build_array(
      jsonb_build_object('value', 'unreconciled', 'label', '銀行批次待核'),
      jsonb_build_object('value', 'second_review', 'label', '待第二人'),
      jsonb_build_object('value', 'pending', 'label', '待處理'),
      jsonb_build_object('value', 'submitted', 'label', '待審核'),
      jsonb_build_object('value', 'failed', 'label', '失敗待處理')
    )
    when 'live' then jsonb_build_array(
      jsonb_build_object('value', 'scheduled', 'label', '已排程'),
      jsonb_build_object('value', 'in_progress', 'label', '進行中'),
      jsonb_build_object('value', 'reconciling', 'label', '證據核對中'),
      jsonb_build_object('value', 'unresolved', 'label', '待提出補正'),
      jsonb_build_object('value', 'pending', 'label', '更正待覆核')
    )
    when 'organizations' then jsonb_build_array(
      jsonb_build_object('value', 'submitted', 'label', '申請待核'),
      jsonb_build_object('value', 'suspended', 'label', '已停權')
    )
    else jsonb_build_array(
      jsonb_build_object(
        'value', 'pending_review', 'label', '前置設定待覆核'
      ),
      jsonb_build_object('value', 'pending', 'label', '角色異動待覆核'),
      jsonb_build_object('value', 'active', 'label', '後台成員')
    )
  end;
  if jsonb_array_length(items) = effective_limit then
    last_item := items -> (jsonb_array_length(items) - 1);
    next_cursor := (last_item ->> 'updatedAt')
      || '|' || (last_item ->> 'itemId');
  end if;
  return jsonb_build_object(
    'items', items,
    'nextCursor', next_cursor,
    'availableStatuses', available_statuses
  );
end
$$;
revoke all on function internal.read_staff_queue_items(
  text, text, text, text, integer
) from public;

create or replace function public.read_staff_queue_items(
  p_queue text,
  p_search text default null,
  p_status text default null,
  p_cursor text default null,
  p_limit integer default 25
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_staff_queue_items(
    p_queue, p_search, p_status, p_cursor, p_limit
  )
$$;

create or replace function internal.request_live_session_change(
  target_session uuid,
  submitted_action text,
  replacement_starts_at timestamptz,
  replacement_ends_at timestamptz,
  replacement_booking_close_at timestamptz,
  submitted_reason text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  session_row public.live_sessions%rowtype;
  reservation_row public.zoom_host_reservations%rowtype;
  decision public.accreditation_decision_revisions%rowtype;
  job_id uuid;
  business_key text := 'live-session-change:' || idempotency::text;
begin
  if not internal.has_staff_role('course_admin')
     or submitted_action not in ('reschedule', 'cancel')
     or length(trim(submitted_reason)) < 10
  then raise exception 'LIVE_SESSION_CHANGE_REJECTED'; end if;
  select job.id into job_id from public.durable_jobs job
  where job.business_key = business_key;
  if job_id is not null then
    return jsonb_build_object('jobId', job_id, 'queued', true);
  end if;
  select * into session_row from public.live_sessions
  where id = target_session for update;
  if not found
     or session_row.status not in ('scheduled', 'open')
     or session_row.starts_at <= now()
  then raise exception 'LIVE_SESSION_CHANGE_REJECTED'; end if;
  select * into reservation_row from public.zoom_host_reservations
  where live_session_id = target_session
    and status = 'confirmed'
  for update;
  if not found then raise exception 'LIVE_HOST_RESERVATION_MISSING'; end if;
  if submitted_action = 'reschedule' then
    if replacement_starts_at is null
       or replacement_ends_at is null
       or replacement_booking_close_at is null
       or replacement_starts_at <= now()
       or replacement_ends_at <= replacement_starts_at
       or replacement_booking_close_at >= replacement_starts_at
       or replacement_ends_at - replacement_starts_at
         <> session_row.ends_at - session_row.starts_at
    then raise exception 'RESCHEDULE_WINDOW_INVALID'; end if;
    select accreditation.* into decision
    from public.course_version_accreditation link
    join public.accreditation_decision_revisions accreditation
      on accreditation.id = link.accreditation_revision_id
    where link.course_version_id = session_row.course_version_id
    order by accreditation.revision desc limit 1;
    if not found
       or decision.status <> 'approved'
       or replacement_starts_at < decision.valid_from
       or replacement_ends_at > decision.valid_until
    then raise exception 'RESCHEDULE_OUTSIDE_ACCREDITATION'; end if;
    update public.zoom_host_reservations
    set reservation_window = tstzrange(
          replacement_starts_at - interval '60 minutes',
          replacement_ends_at + interval '60 minutes',
          '[)'
        ),
        status = 'reconciling'
    where id = reservation_row.id;
  else
    update public.zoom_host_reservations set status = 'reconciling'
    where id = reservation_row.id;
  end if;
  update public.live_sessions set status = 'reconciling'
  where id = target_session;
  insert into public.durable_jobs (
    job_type, business_key, payload
  ) values (
    'live_session_change', business_key,
    jsonb_build_object(
      'liveSessionId', target_session,
      'action', submitted_action,
      'previousStatus', session_row.status,
      'previousStartsAt', session_row.starts_at,
      'previousEndsAt', session_row.ends_at,
      'previousBookingCloseAt', session_row.booking_close_at,
      'replacementStartsAt', replacement_starts_at,
      'replacementEndsAt', replacement_ends_at,
      'replacementBookingCloseAt', replacement_booking_close_at,
      'requestedBy', actor,
      'reason', trim(submitted_reason)
    )
  ) returning id into job_id;
  perform internal.append_audit_event(
    actor, 'live_session.' || submitted_action || '_requested',
    'live_session', target_session::text, trim(submitted_reason), null,
    jsonb_build_object('durableJobId', job_id)
  );
  return jsonb_build_object('jobId', job_id, 'queued', true);
end
$$;
revoke all on function internal.request_live_session_change(
  uuid, text, timestamptz, timestamptz, timestamptz, text, uuid
) from public;

create or replace function public.request_live_session_change(
  p_live_session_id uuid,
  p_action text,
  p_replacement_starts_at timestamptz,
  p_replacement_ends_at timestamptz,
  p_replacement_booking_close_at timestamptz,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.request_live_session_change(
    p_live_session_id, p_action, p_replacement_starts_at,
    p_replacement_ends_at, p_replacement_booking_close_at,
    p_reason, p_idempotency_key
  )
$$;

create or replace function internal.read_live_session_change_context(
  target_job uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, private
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'LIVE_CHANGE_SERVICE_REQUIRED';
  end if;
  select job.payload || jsonb_build_object(
    'meetingNumber', meeting.meeting_number,
    'topic', session.title
  ) into result
  from public.durable_jobs job
  join public.live_sessions session
    on session.id = (job.payload ->> 'liveSessionId')::uuid
  join private.zoom_meetings meeting
    on meeting.live_session_id = session.id
  where job.id = target_job
    and job.job_type = 'live_session_change'
    and job.status = 'leased'
    and session.status = 'reconciling';
  if result is null then raise exception 'LIVE_CHANGE_CONTEXT_INVALID'; end if;
  return result;
end
$$;
revoke all on function internal.read_live_session_change_context(uuid)
  from public;

create or replace function public.read_live_session_change_context(
  p_job_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, private, internal
as $$
  select internal.read_live_session_change_context(p_job_id)
$$;

create or replace function internal.finalize_live_session_change(
  target_job uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  job_row public.durable_jobs%rowtype;
  target_session uuid;
  submitted_action text;
  previous_start timestamptz;
  replacement_start timestamptz;
  replacement_end timestamptz;
  replacement_booking_close timestamptz;
  requested_by uuid;
  submitted_reason text;
  next_status text;
  delta interval;
  notification record;
begin
  if auth.role() <> 'service_role' then
    raise exception 'LIVE_CHANGE_SERVICE_REQUIRED';
  end if;
  select * into job_row from public.durable_jobs
  where id = target_job
    and job_type = 'live_session_change'
    and status = 'leased'
  for update;
  if not found then raise exception 'LIVE_CHANGE_JOB_INVALID'; end if;
  target_session := (job_row.payload ->> 'liveSessionId')::uuid;
  submitted_action := job_row.payload ->> 'action';
  previous_start := (job_row.payload ->> 'previousStartsAt')::timestamptz;
    requested_by := (job_row.payload ->> 'requestedBy')::uuid;
  submitted_reason := job_row.payload ->> 'reason';
  if submitted_action = 'reschedule' then
    replacement_start :=
      (job_row.payload ->> 'replacementStartsAt')::timestamptz;
    replacement_end :=
      (job_row.payload ->> 'replacementEndsAt')::timestamptz;
    replacement_booking_close :=
      (job_row.payload ->> 'replacementBookingCloseAt')::timestamptz;
    delta := replacement_start - previous_start;
    next_status := job_row.payload ->> 'previousStatus';
    update public.live_sessions
    set starts_at = replacement_start,
        ends_at = replacement_end,
        booking_close_at = replacement_booking_close,
        evidence_settles_at = replacement_end + interval '24 hours',
        status = next_status,
        calendar_sequence = calendar_sequence + 1
    where id = target_session and status = 'reconciling';
    perform set_config(
      'app.suiyue_controlled_break_shift',
      target_session::text,
      true
    );
    update public.live_breaks
    set starts_at = starts_at + delta,
        ends_at = ends_at + delta
    where live_session_id = target_session;
    perform set_config('app.suiyue_controlled_break_shift', '', true);
    update public.live_bookings
    set change_locked_at = replacement_start - interval '24 hours'
    where live_session_id = target_session
      and status in ('held', 'confirmed');
    update public.zoom_host_reservations
    set status = 'confirmed'
    where live_session_id = target_session and status = 'reconciling';
  elsif submitted_action = 'cancel' then
    update public.live_sessions
    set status = 'cancelled',
        calendar_sequence = calendar_sequence + 1
    where id = target_session and status = 'reconciling';
    update public.zoom_host_reservations
    set status = 'released'
    where live_session_id = target_session and status = 'reconciling';
    update public.live_join_leases lease
    set active = false
    from public.live_bookings booking
    where booking.id = lease.live_booking_id
      and booking.live_session_id = target_session
      and lease.active;
    update public.live_bookings set status = 'cancelled'
    where live_session_id = target_session
      and status in ('held', 'confirmed');
    insert into public.support_cases (
      kind, priority, summary, response_due_at
    ) values (
      'live_session_cancelled', 'critical',
      'Cancelled session requires free replacement or refund/point remedy: '
        || target_session::text,
      now() + interval '1 day'
    );
  else
    raise exception 'LIVE_CHANGE_ACTION_INVALID';
  end if;
  for notification in
    insert into public.notifications (
      person_id, category, title, body, business_key
    )
    select distinct
      booking.person_id, 'live',
      case when submitted_action = 'cancel'
        then '直播場次緊急取消' else '直播場次已改期' end,
      case when submitted_action = 'cancel'
        then '請登入選擇免費替代場次或依法申請退款；機構資金由機構管理者決定。'
        else '時間已更新，請重新下載行事曆；入場連結不含 Zoom 密碼。'
      end,
      'live-' || submitted_action || ':' || target_session::text
    from public.live_bookings booking
    where booking.live_session_id = target_session
    on conflict (person_id, business_key) do update
      set title = excluded.title, body = excluded.body
    returning id, person_id
  loop
    insert into public.notification_outbox (
      notification_id, channel, destination_ciphertext, template_key,
      template_data, business_idempotency_key
    )
    select
      notification.id, channel.name, '{}'::jsonb,
      'live_' || submitted_action,
      jsonb_build_object('liveSessionId', target_session),
      'live-' || submitted_action || ':' || channel.name || ':'
        || target_session::text || ':' || notification.person_id::text
    from (values ('sms'), ('email')) as channel(name)
    where channel.name = 'sms'
      or exists (
        select 1 from public.people person
        where person.id = notification.person_id
          and person.email_verified_at is not null
      )
    on conflict (business_idempotency_key) do nothing;
  end loop;
  perform internal.append_audit_event(
    requested_by, 'live_session.' || submitted_action || '_completed',
    'live_session', target_session::text, submitted_reason, null,
    jsonb_build_object('durableJobId', target_job)
  );
  return case
    when submitted_action = 'cancel' then 'cancelled'
    else 'rescheduled'
  end;
end
$$;
revoke all on function internal.finalize_live_session_change(uuid)
  from public;

create or replace function public.finalize_live_session_change(
  p_job_id uuid
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.finalize_live_session_change(p_job_id)
$$;

create or replace function internal.request_point_refund(
  target_case uuid,
  target_organization uuid,
  target_topup uuid,
  requested_points bigint,
  encrypted_account jsonb,
  submitted_reason text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  topup_row public.point_topups%rowtype;
  lot_row public.point_lots%rowtype;
  existing public.point_refund_cases%rowtype;
begin
  if not internal.has_organization_role(
    target_organization, array['owner', 'finance']
  )
     or requested_points <= 0
     or encrypted_account is null
     or jsonb_typeof(encrypted_account) <> 'object'
     or length(trim(submitted_reason)) < 10
  then raise exception 'POINT_REFUND_REQUEST_REJECTED'; end if;
  select * into existing from public.point_refund_cases
  where requested_by = actor and idempotency_key = idempotency;
  if found then
    return jsonb_build_object(
      'pointRefundCaseId', existing.id,
      'status', existing.status,
      'points', existing.points
    );
  end if;
  select * into topup_row from public.point_topups
  where id = target_topup
    and organization_id = target_organization
    and status in ('paid', 'partially_refunded')
  for update;
  if not found then raise exception 'POINT_TOPUP_NOT_REFUNDABLE'; end if;
  select * into lot_row from public.point_lots
  where point_topup_id = target_topup for update;
  if not found or lot_row.available_points < requested_points then
    raise exception 'ONLY_UNUSED_POINTS_REFUNDABLE';
  end if;
  perform 1 from public.organization_wallets
  where organization_id = target_organization for update;
  update public.point_lots
  set available_points = available_points - requested_points,
      refund_reserved_points = refund_reserved_points + requested_points
  where id = lot_row.id;
  update public.organization_wallets
  set available_points = available_points - requested_points,
      refund_reserved_points = refund_reserved_points + requested_points,
      ledger_version = ledger_version + 1,
      updated_at = now()
  where organization_id = target_organization;
  insert into public.point_refund_cases (
    id, organization_id, point_topup_id, point_lot_id, requested_by,
    points, amount_twd, account_details_ciphertext, idempotency_key
  ) values (
    target_case, target_organization, target_topup, lot_row.id, actor,
    requested_points, requested_points, encrypted_account, idempotency
  );
  insert into public.point_ledger_events (
    organization_id, point_lot_id, event_type, points, topup_id,
    actor_id, idempotency_key, reason
  ) values (
    target_organization, lot_row.id, 'refund_reserved', requested_points,
    target_topup, actor, gen_random_uuid(), trim(submitted_reason)
  );
  update public.point_topups set status = 'refund_pending'
  where id = target_topup;
  perform internal.append_audit_event(
    actor, 'organization.point_refund_requested', 'point_refund_case',
    target_case::text, trim(submitted_reason), target_organization,
    jsonb_build_object(
      'pointTopupId', target_topup, 'points', requested_points
    )
  );
  return jsonb_build_object(
    'pointRefundCaseId', target_case,
    'status', 'submitted',
    'points', requested_points
  );
end
$$;
revoke all on function internal.request_point_refund(
  uuid, uuid, uuid, bigint, jsonb, text, uuid
) from public;

create or replace function public.request_point_refund(
  p_point_refund_case_id uuid,
  p_organization_id uuid,
  p_point_topup_id uuid,
  p_points bigint,
  p_account_details_ciphertext jsonb,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.request_point_refund(
    p_point_refund_case_id, p_organization_id, p_point_topup_id, p_points,
    p_account_details_ciphertext, p_reason, p_idempotency_key
  )
$$;

create or replace function internal.decide_point_refund(
  target_case uuid,
  submitted_decision text,
  submitted_reason text,
  submitted_nonce_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  case_row public.point_refund_cases%rowtype;
  next_topup_status text;
begin
  perform internal.consume_step_up_grant(
    'point_refund_decision', target_case::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('finance')
     or submitted_decision not in ('approve', 'reject')
     or length(trim(submitted_reason)) < 10
  then raise exception 'POINT_REFUND_DECISION_REJECTED'; end if;
  select * into case_row from public.point_refund_cases
  where id = target_case for update;
  if not found
     or case_row.status not in ('submitted', 'reviewing')
     or case_row.requested_by = actor
  then raise exception 'POINT_REFUND_DECISION_REJECTED'; end if;
  if submitted_decision = 'reject' then
    perform 1 from public.point_lots
    where id = case_row.point_lot_id for update;
    perform 1 from public.organization_wallets
    where organization_id = case_row.organization_id for update;
    update public.point_lots
    set refund_reserved_points = refund_reserved_points - case_row.points,
        available_points = available_points + case_row.points
    where id = case_row.point_lot_id
      and refund_reserved_points >= case_row.points;
    if not found then raise exception 'POINT_LEDGER_DRIFT'; end if;
    update public.organization_wallets
    set refund_reserved_points = refund_reserved_points - case_row.points,
        available_points = available_points + case_row.points,
        ledger_version = ledger_version + 1,
        updated_at = now()
    where organization_id = case_row.organization_id
      and refund_reserved_points >= case_row.points;
    if not found then raise exception 'POINT_WALLET_DRIFT'; end if;
    insert into public.point_ledger_events (
      organization_id, point_lot_id, event_type, points, topup_id,
      actor_id, idempotency_key, reason
    ) values (
      case_row.organization_id, case_row.point_lot_id, 'refund_released',
      case_row.points, case_row.point_topup_id, actor,
      gen_random_uuid(), trim(submitted_reason)
    );
    update public.point_refund_cases
    set status = 'rejected', decided_at = now()
    where id = target_case;
    select case
      when lot.refunded_points = 0 then 'paid'
      else 'partially_refunded'
    end into next_topup_status
    from public.point_lots lot where lot.id = case_row.point_lot_id;
    update public.point_topups set status = next_topup_status
    where id = case_row.point_topup_id;
  elsif case_row.first_approved_by is null then
    update public.point_refund_cases
    set status = 'reviewing', first_approved_by = actor
    where id = target_case;
  elsif case_row.first_approved_by = actor then
    raise exception 'DISTINCT_POINT_REFUND_REVIEWER_REQUIRED';
  else
    update public.point_refund_cases
    set status = 'approved', second_approved_by = actor, decided_at = now()
    where id = target_case;
  end if;
  perform internal.append_audit_event(
    actor, 'organization.point_refund_' || submitted_decision,
    'point_refund_case', target_case::text, trim(submitted_reason),
    case_row.organization_id,
    jsonb_build_object(
      'reviewStage',
      case
        when submitted_decision = 'reject' then 'rejected'
        when case_row.first_approved_by is null then 'first'
        else 'second'
      end
    )
  );
  return (
    select status from public.point_refund_cases where id = target_case
  );
end
$$;
revoke all on function internal.decide_point_refund(
  uuid, text, text, text
) from public;

create or replace function public.decide_point_refund(
  p_point_refund_case_id uuid,
  p_decision text,
  p_reason text,
  p_nonce_hash text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.decide_point_refund(
    p_point_refund_case_id, p_decision, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.authorize_point_refund_account_access(
  target_case uuid,
  submitted_reason text,
  submitted_nonce_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  grant_id uuid;
begin
  perform internal.consume_step_up_grant(
    'point_refund_account', target_case::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('finance')
     or length(trim(submitted_reason)) < 10
     or not exists (
       select 1 from public.point_refund_cases refund
       where refund.id = target_case
         and refund.status in ('approved', 'disbursing', 'failed')
         and refund.first_approved_by is not null
         and refund.second_approved_by is not null
         and refund.requested_by <> actor
     )
  then raise exception 'POINT_REFUND_ACCOUNT_ACCESS_REJECTED'; end if;
  insert into private.refund_account_access_grants (
    point_refund_case_id, actor_id, expires_at
  ) values (
    target_case, actor, now() + interval '2 minutes'
  ) returning id into grant_id;
  perform internal.append_audit_event(
    actor, 'organization.point_refund_account_authorized',
    'point_refund_case', target_case::text, trim(submitted_reason),
    null, '{}'::jsonb
  );
  return jsonb_build_object('grantId', grant_id, 'actorId', actor);
end
$$;
revoke all on function internal.authorize_point_refund_account_access(
  uuid, text, text
) from public;

create or replace function public.authorize_point_refund_account_access(
  p_point_refund_case_id uuid,
  p_reason text,
  p_nonce_hash text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.authorize_point_refund_account_access(
    p_point_refund_case_id, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.consume_point_refund_account_access(
  target_grant uuid,
  target_case uuid,
  target_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  encrypted jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  update private.refund_account_access_grants grant_row
  set consumed_at = now()
  where grant_row.id = target_grant
    and grant_row.point_refund_case_id = target_case
    and grant_row.actor_id = target_actor
    and grant_row.consumed_at is null
    and grant_row.expires_at > now();
  if not found then raise exception 'POINT_REFUND_CAPABILITY_INVALID'; end if;
  select refund.account_details_ciphertext into encrypted
  from public.point_refund_cases refund
  where refund.id = target_case
    and refund.status in ('approved', 'disbursing', 'failed');
  if encrypted is null then raise exception 'POINT_REFUND_ACCOUNT_MISSING'; end if;
  return encrypted;
end
$$;
revoke all on function internal.consume_point_refund_account_access(
  uuid, uuid, uuid
) from public;

create or replace function public.consume_point_refund_account_access(
  p_grant_id uuid,
  p_point_refund_case_id uuid,
  p_actor_id uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.consume_point_refund_account_access(
    p_grant_id, p_point_refund_case_id, p_actor_id
  )
$$;

create or replace function internal.record_point_refund_result(
  target_case uuid,
  succeeded boolean,
  submitted_external_reference text,
  submitted_failure_reason text,
  submitted_reason text,
  idempotency uuid,
  submitted_nonce_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  case_row public.point_refund_cases%rowtype;
  next_topup_status text;
  notification_id uuid;
begin
  perform internal.consume_step_up_grant(
    'point_refund_result', target_case::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('finance')
     or length(trim(submitted_reason)) < 10
     or (succeeded and coalesce(trim(submitted_external_reference), '') = '')
     or (not succeeded and coalesce(trim(submitted_failure_reason), '') = '')
  then raise exception 'POINT_REFUND_RESULT_REJECTED'; end if;
  if exists (
    select 1 from public.payment_events event
    where event.idempotency_key = idempotency
      and event.event_type like 'point_refund_%'
  ) then
    return (
      select status from public.point_refund_cases where id = target_case
    );
  end if;
  select * into case_row from public.point_refund_cases
  where id = target_case for update;
  if not found
     or case_row.status not in ('approved', 'disbursing', 'failed')
     or case_row.first_approved_by is null
     or case_row.second_approved_by is null
     or case_row.requested_by = actor
  then raise exception 'POINT_REFUND_RESULT_REJECTED'; end if;
  insert into public.payment_events (
    event_type, amount_twd, actor_id, idempotency_key, event_data
  ) values (
    case when succeeded
      then 'point_refund_completed' else 'point_refund_failed' end,
    case_row.amount_twd, actor, idempotency,
    jsonb_build_object(
      'pointRefundCaseId', target_case,
      'externalReference', submitted_external_reference,
      'failureReason', submitted_failure_reason
    )
  );
  if not succeeded then
    update public.point_refund_cases
    set status = 'failed', failure_reason = submitted_failure_reason
    where id = target_case;
    perform internal.append_audit_event(
      actor, 'organization.point_refund_failed', 'point_refund_case',
      target_case::text, trim(submitted_reason), case_row.organization_id,
      jsonb_build_object('failureReason', submitted_failure_reason)
    );
    return 'failed';
  end if;
  perform 1 from public.point_lots
  where id = case_row.point_lot_id for update;
  perform 1 from public.organization_wallets
  where organization_id = case_row.organization_id for update;
  update public.point_lots
  set refund_reserved_points = refund_reserved_points - case_row.points,
      refunded_points = refunded_points + case_row.points
  where id = case_row.point_lot_id
    and refund_reserved_points >= case_row.points;
  if not found then raise exception 'POINT_LEDGER_DRIFT'; end if;
  update public.organization_wallets
  set refund_reserved_points = refund_reserved_points - case_row.points,
      refunded_points = refunded_points + case_row.points,
      ledger_version = ledger_version + 1,
      updated_at = now()
  where organization_id = case_row.organization_id
    and refund_reserved_points >= case_row.points;
  if not found then raise exception 'POINT_WALLET_DRIFT'; end if;
  insert into public.point_ledger_events (
    organization_id, point_lot_id, event_type, points, topup_id,
    actor_id, idempotency_key, reason
  ) values (
    case_row.organization_id, case_row.point_lot_id, 'refunded',
    case_row.points, case_row.point_topup_id, actor,
    gen_random_uuid(), trim(submitted_reason)
  );
  select case
    when lot.refunded_points = lot.purchased_points then 'refunded'
    else 'partially_refunded'
  end into next_topup_status
  from public.point_lots lot where lot.id = case_row.point_lot_id;
  update public.point_topups set status = next_topup_status
  where id = case_row.point_topup_id;
  update public.point_refund_cases
  set status = 'completed',
      external_reference = trim(submitted_external_reference),
      failure_reason = null,
      completed_at = now()
  where id = target_case;
  insert into public.invoice_events (
    invoice_record_id, event_type, amount_twd,
    actor_id, reason
  )
  select invoice.id, 'allowance_requested', case_row.amount_twd,
    actor, 'unused organization points refunded'
  from public.invoice_records invoice
  where invoice.point_topup_id = case_row.point_topup_id;
  insert into public.notifications (
    person_id, category, title, body, business_key
  ) values (
    case_row.requested_by, 'organization', '未使用點數退款已完成',
    '退款已依原實付價匯回；相同 point lot 已留下不可變扣除紀錄。',
    'point-refund-completed:' || target_case::text
  ) on conflict (person_id, business_key) do update
    set title = excluded.title
  returning id into notification_id;
  insert into public.notification_outbox (
    notification_id, channel, destination_ciphertext, template_key,
    template_data, business_idempotency_key
  ) values (
    notification_id, 'email', '{}'::jsonb, 'point_refund_completed',
    jsonb_build_object(
      'pointRefundCaseId', target_case,
      'points', case_row.points,
      'amountTwd', case_row.amount_twd
    ),
    'point-refund-completed:email:' || target_case::text
  ) on conflict (business_idempotency_key) do nothing;
  perform internal.append_audit_event(
    actor, 'organization.point_refund_completed', 'point_refund_case',
    target_case::text, trim(submitted_reason), case_row.organization_id,
    jsonb_build_object(
      'points', case_row.points,
      'amountTwd', case_row.amount_twd,
      'externalReference', submitted_external_reference
    )
  );
  return 'completed';
end
$$;
revoke all on function internal.record_point_refund_result(
  uuid, boolean, text, text, text, uuid, text
) from public;

create or replace function public.record_point_refund_result(
  p_point_refund_case_id uuid,
  p_succeeded boolean,
  p_external_reference text,
  p_failure_reason text,
  p_reason text,
  p_idempotency_key uuid,
  p_nonce_hash text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.record_point_refund_result(
    p_point_refund_case_id, p_succeeded, p_external_reference,
    p_failure_reason, p_reason, p_idempotency_key, p_nonce_hash
  )
$$;

create or replace function internal.read_organization_training_report(
  target_organization uuid,
  filter_course_version uuid,
  filter_live_session uuid,
  filter_department text,
  filter_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
begin
  if not internal.has_organization_role(
    target_organization, array['owner', 'training_manager', 'finance']
  )
     or (
       filter_status is not null
       and filter_status not in (
         'reserved', 'active', 'consumed', 'released', 'completed',
         'cancelled', 'refunded'
       )
     )
     or (
       filter_live_session is not null
       and not exists (
         select 1 from public.live_sessions session
         where session.id = filter_live_session
           and (
             filter_course_version is null
             or session.course_version_id = filter_course_version
           )
       )
     )
  then raise exception 'ORGANIZATION_REPORT_REJECTED'; end if;
  select jsonb_build_object(
    'generatedAt', now(),
    'organizationId', target_organization,
    'trainingSummary', coalesce((
      select jsonb_agg(to_jsonb(summary_row) order by summary_row.course_title)
      from (
        select
          version.title as course_title,
          version.version as course_version,
          count(*)::integer as assigned_count,
          count(*) filter (
            where assignment.status = 'completed'
              or enrollment.status in ('completed', 'submitted', 'credited')
          )::integer as completed_count,
          count(*) filter (
            where enrollment.status = 'credited'
          )::integer as credited_count,
          sum(assignment.point_price_snapshot)::bigint as funded_points
        from public.organization_assignments assignment
        join public.course_versions version
          on version.id = assignment.course_version_id
        join public.organization_memberships membership
          on membership.organization_id = assignment.organization_id
          and membership.person_id = assignment.member_person_id
        left join public.entitlements entitlement
          on entitlement.source_type = 'organization_assignment'
          and entitlement.source_id = assignment.id
        left join public.enrollments enrollment
          on enrollment.entitlement_id = entitlement.id
        where assignment.organization_id = target_organization
          and (
            filter_course_version is null
            or assignment.course_version_id = filter_course_version
          )
          and (
            filter_department is null
            or membership.department = filter_department
          )
          and (
            filter_status is null or assignment.status = filter_status
          )
          and (
            filter_live_session is null
            or exists (
              select 1 from public.live_bookings booking
              where booking.payer_type = 'organization'
                and booking.payer_source_id = assignment.id
                and booking.live_session_id = filter_live_session
            )
          )
        group by version.id, version.title, version.version
      ) summary_row
    ), '[]'::jsonb),
    'learnerResults', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignmentId', assignment.id,
        'employeeNumber', membership.employee_number,
        'department', membership.department,
        'courseTitle', version.title,
        'courseVersion', version.version,
        'assignmentStatus', assignment.status,
        'enrollmentStatus', enrollment.status,
        'validMinutes', round(
          coalesce(progress.confirmed_valid_seconds, 0)::numeric / 60, 2
        ),
        'quizScore', quiz.best_score,
        'quizPassed', coalesce(quiz.best_score >= 80, false),
        'certificateStatus', case
          when exists (
            select 1
            from public.live_bookings booking
            join public.attendance_summaries attendance
              on attendance.live_booking_id = booking.id
            where booking.enrollment_id = enrollment.id
              and attendance.quarantined_at is not null
          ) then 'needs_correction'
          else certificate.current_status
        end,
        'completedAt', enrollment.completed_at
      ) order by version.title, membership.employee_number, assignment.id)
      from public.organization_assignments assignment
      join public.course_versions version
        on version.id = assignment.course_version_id
      join public.organization_memberships membership
        on membership.organization_id = assignment.organization_id
        and membership.person_id = assignment.member_person_id
      left join public.entitlements entitlement
        on entitlement.source_type = 'organization_assignment'
        and entitlement.source_id = assignment.id
      left join public.enrollments enrollment
        on enrollment.entitlement_id = entitlement.id
      left join public.progress_summaries progress
        on progress.enrollment_id = enrollment.id
      left join lateral (
        select max(attempt.score) as best_score
        from public.quiz_attempts attempt
        where attempt.enrollment_id = enrollment.id
          and attempt.status in ('submitted', 'passed', 'failed')
      ) quiz on true
      left join public.certificates certificate
        on certificate.enrollment_id = enrollment.id
      where assignment.organization_id = target_organization
        and (
          filter_course_version is null
          or assignment.course_version_id = filter_course_version
        )
        and (
          filter_department is null
          or membership.department = filter_department
        )
        and (filter_status is null or assignment.status = filter_status)
        and (
          filter_live_session is null
          or exists (
            select 1 from public.live_bookings booking
            where booking.payer_type = 'organization'
              and booking.payer_source_id = assignment.id
              and booking.live_session_id = filter_live_session
          )
        )
    ), '[]'::jsonb),
    'liveAttendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignmentId', assignment.id,
        'employeeNumber', membership.employee_number,
        'department', membership.department,
        'courseTitle', version.title,
        'sessionTitle', session.title,
        'startsAt', session.starts_at,
        'presencePercent', attendance.presence_percent,
        'cameraPercent', attendance.camera_percent,
        'qualified',
          attendance.qualified
            and attendance.quarantined_at is null,
        'settledAt', attendance.settled_at,
        'quarantinedAt', attendance.quarantined_at,
        'quarantineReason', attendance.quarantine_reason
      ) order by session.starts_at, membership.employee_number)
      from public.organization_assignments assignment
      join public.course_versions version
        on version.id = assignment.course_version_id
      join public.organization_memberships membership
        on membership.organization_id = assignment.organization_id
        and membership.person_id = assignment.member_person_id
      join public.live_bookings booking
        on booking.payer_type = 'organization'
        and booking.payer_source_id = assignment.id
      join public.live_sessions session on session.id = booking.live_session_id
      left join public.attendance_summaries attendance
        on attendance.live_booking_id = booking.id
      where assignment.organization_id = target_organization
        and (
          filter_course_version is null
          or assignment.course_version_id = filter_course_version
        )
        and (
          filter_live_session is null
          or session.id = filter_live_session
        )
        and (
          filter_department is null
          or membership.department = filter_department
        )
        and (filter_status is null or assignment.status = filter_status)
    ), '[]'::jsonb),
    'pointLedger', coalesce((
      select jsonb_agg(jsonb_build_object(
        'occurredAt', event.occurred_at,
        'eventType', event.event_type,
        'points', event.points,
        'pointLotId', event.point_lot_id,
        'assignmentId', event.assignment_id,
        'reason', event.reason
      ) order by event.occurred_at, event.id)
      from public.point_ledger_events event
      left join public.organization_assignments assignment
        on assignment.id = event.assignment_id
      where event.organization_id = target_organization
        and (
          filter_course_version is null
          or assignment.course_version_id = filter_course_version
        )
        and (
          filter_status is null
          or (
            assignment.id is not null
            and assignment.status = filter_status
          )
        )
        and (
          filter_department is null
          or exists (
            select 1 from public.organization_memberships membership
            where membership.organization_id = target_organization
              and membership.person_id = assignment.member_person_id
              and membership.department = filter_department
          )
        )
        and (
          filter_live_session is null
          or exists (
            select 1 from public.live_bookings booking
            where booking.payer_type = 'organization'
              and booking.payer_source_id = assignment.id
              and booking.live_session_id = filter_live_session
          )
        )
    ), '[]'::jsonb)
  ) into result;
  perform internal.append_audit_event(
    internal.current_person_id(), 'organization.training_report_read',
    'organization', target_organization::text,
    'masked organization-funded training report',
    target_organization,
    jsonb_build_object(
      'courseVersionId', filter_course_version,
      'liveSessionId', filter_live_session,
      'department', filter_department,
      'status', filter_status
    )
  );
  return result;
end
$$;
revoke all on function internal.read_organization_training_report(
  uuid, uuid, uuid, text, text
) from public;

create or replace function public.read_organization_training_report(
  p_organization_id uuid,
  p_course_version_id uuid,
  p_live_session_id uuid,
  p_department text,
  p_status text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.read_organization_training_report(
    p_organization_id, p_course_version_id, p_live_session_id,
    p_department, p_status
  )
$$;

create or replace function internal.emergency_suspend_platform(
  submitted_reason text,
  submitted_nonce_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  incident_id uuid;
  next_revision integer;
  notification record;
begin
  perform internal.consume_step_up_grant(
    'emergency_suspend', 'all', submitted_nonce_hash
  );
  if not internal.has_staff_role('platform_admin')
     or length(trim(submitted_reason)) < 10
  then raise exception 'EMERGENCY_SUSPEND_REJECTED'; end if;
  perform pg_advisory_xact_lock(
    hashtextextended('suiyue:maintenance-mode', 0)
  );
  update public.feature_switches
  set enabled = false,
      suspended_at = coalesce(suspended_at, now()),
      suspended_by = actor,
      reason = trim(submitted_reason),
      updated_at = now();
  select coalesce(max(setting.revision), 0) + 1 into next_revision
  from public.operating_setting_revisions setting
  where setting.setting_key = 'maintenance_mode';
  update public.operating_setting_revisions
  set superseded_at = now()
  where setting_key = 'maintenance_mode'
    and superseded_at is null;
  insert into public.operating_setting_revisions (
    setting_key, revision, value, approved_by, effective_at
  ) values (
    'maintenance_mode', next_revision,
    jsonb_build_object('enabled', true, 'reason', trim(submitted_reason)),
    actor, now()
  );
  insert into public.security_incidents (
    severity, status, owner, summary, detected_at, contained_at,
    notification_deadline_at
  ) values (
    'critical', 'contained', actor::text, trim(submitted_reason),
    now(), now(), now() + interval '72 hours'
  ) returning id into incident_id;
  for notification in
    insert into public.notifications (
      person_id, category, title, body, business_key
    )
    select
      role.person_id, 'security', '平台已緊急暫停',
      '所有功能開關已關閉並進入 maintenance；請依事故手冊處理。',
      'emergency-suspend:' || incident_id::text
    from public.staff_roles role
    where role.role = 'platform_admin' and role.active
    on conflict (person_id, business_key) do nothing
    returning id, person_id
  loop
    insert into public.notification_outbox (
      notification_id, channel, destination_ciphertext, template_key,
      template_data, business_idempotency_key
    )
    select
      notification.id, channel.name, '{}'::jsonb,
      'emergency_suspend',
      jsonb_build_object('incidentId', incident_id),
      'emergency-suspend:' || channel.name || ':'
        || incident_id::text || ':' || notification.person_id::text
    from (values ('sms'), ('email')) as channel(name)
    where channel.name = 'sms'
       or exists (
         select 1 from public.people person
         where person.id = notification.person_id
           and person.email_verified_at is not null
       )
    on conflict (business_idempotency_key) do nothing;
  end loop;
  perform internal.append_audit_event(
    actor, 'platform.emergency_suspended', 'security_incident',
    incident_id::text, trim(submitted_reason), null,
    jsonb_build_object('allFeatureSwitchesDisabled', true)
  );
  return incident_id;
end
$$;
revoke all on function internal.emergency_suspend_platform(text, text)
  from public;

create or replace function public.emergency_suspend_platform(
  p_reason text,
  p_nonce_hash text
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.emergency_suspend_platform(p_reason, p_nonce_hash)
$$;

create or replace function internal.read_platform_prerequisite_options()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  is_platform_admin boolean := internal.has_staff_role('platform_admin');
begin
  if not internal.has_staff_role('course_admin')
     and not is_platform_admin
  then
    raise exception 'COURSE_ADMIN_REQUIRED';
  end if;
  return jsonb_build_object(
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', course.id,
        'label', course.internal_title
      ) order by course.internal_title, course.id)
      from public.courses course
      where course.archived_at is null
        and (is_platform_admin or course.created_by = actor)
    ), '[]'::jsonb),
    'liveCourseVersions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', version.id,
        'label', version.title || '（v' || version.version::text || '）',
        'components', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', component.id,
            'label', component.title
          ) order by component.sort_order, component.id)
          from public.hybrid_components component
          where component.course_version_id = version.id
            and component.component_type = 'live'
        ), '[]'::jsonb)
      ) order by version.title, version.version)
      from public.course_versions version
      where version.status = 'draft'
        and version.delivery_type in ('live', 'hybrid')
        and (is_platform_admin or version.created_by = actor)
    ), '[]'::jsonb),
    'courseDrafts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', version.id,
        'label', version.title || '（v' || version.version::text || '）',
        'deliveryType', version.delivery_type,
        'metadata', jsonb_build_object(
          'title', version.title,
          'summary', version.summary,
          'description', version.description,
          'learningObjectives', version.learning_objectives,
          'priceTwd', version.price_twd,
          'organizationPointPrice', version.organization_point_price,
          'recordedRefundAllocationTwd',
            version.recorded_refund_allocation_twd,
          'equipmentRequirements', version.equipment_requirements,
          'legalDocumentId', version.legal_document_id,
          'retentionPolicyRevisionId',
            version.retention_policy_revision_id,
          'accreditationRevisionId', (
            select link.accreditation_revision_id
            from public.course_version_accreditation link
            where link.course_version_id = version.id
            order by link.accreditation_revision_id
            limit 1
          ),
          'accreditationDisclosure', (
            select link.disclosure_snapshot
            from public.course_version_accreditation link
            where link.course_version_id = version.id
            order by link.accreditation_revision_id
            limit 1
          ),
          'minimumCompletionDays',
            extract(epoch from version.minimum_completion_window)
              / 86400,
          'commerceCloseAt', version.commerce_close_at,
          'contentAvailableAt', version.content_available_at,
          'requiredWatchSeconds', requirement.required_watch_seconds,
          'livePresencePercent', requirement.live_presence_percent,
          'liveCameraPercent', requirement.live_camera_percent,
          'hasCover', version.has_cover,
          'hybridComponents', coalesce((
            select jsonb_agg(jsonb_build_object(
              'componentId', component.id,
              'componentType', component.component_type,
              'title', component.title,
              'required', component.required,
              'sortOrder', component.sort_order,
              'refundAllocationTwd', component.refund_allocation_twd,
              'dependsOnComponentIds', coalesce((
                select jsonb_agg(
                  edge.prerequisite_component_id
                  order by prerequisite.sort_order,
                    edge.prerequisite_component_id
                )
                from public.component_prerequisites edge
                join public.hybrid_components prerequisite
                  on prerequisite.id =
                    edge.prerequisite_component_id
                where edge.dependent_component_id = component.id
                  and edge.course_version_id = version.id
              ), '[]'::jsonb)
            ) order by component.sort_order, component.id)
            from public.hybrid_components component
            where component.course_version_id = version.id
          ), '[]'::jsonb)
        ),
        'instructors', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', instructor.id,
            'label', instructor.display_name,
            'biography', instructor.biography,
            'credentials', instructor.credentials,
            'sortOrder', link.sort_order
          ) order by link.sort_order, instructor.id)
          from public.course_instructors link
          join public.instructors instructor
            on instructor.id = link.instructor_id
          where link.course_version_id = version.id
        ), '[]'::jsonb),
        'questions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', question.id,
            'prompt', question.prompt,
            'topic', question.topic,
            'explanation', question.explanation,
            'options', coalesce((
              select jsonb_agg(
                option.option_text order by option.sort_order, option.id
              )
              from public.question_option_versions option
              where option.question_version_id = question.id
            ), '[]'::jsonb),
            'correctIndex', (
              select option.sort_order
              from private.question_answer_keys answer
              join public.question_option_versions option
                on option.id = answer.correct_option_id
              where answer.question_version_id = question.id
            ),
            'sortOrder', question.sort_order
          ) order by question.sort_order, question.id)
          from public.question_banks bank
          join public.question_versions question
            on question.question_bank_id = bank.id
          where bank.course_version_id = version.id
            and question.active
        ), '[]'::jsonb),
        'materials', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', material.id,
            'title', material.title,
            'lessonId', material.lesson_id
          ) order by material.created_at, material.id)
          from public.course_materials material
          where material.course_version_id = version.id
            and material.scan_status = 'safe'
        ), '[]'::jsonb),
        'modules', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', module.id,
            'label', module.title,
            'sortOrder', module.sort_order,
            'lessons', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', lesson.id,
                'label', lesson.title,
                'contentType', lesson.content_type,
                'preview', lesson.preview,
                'sortOrder', lesson.sort_order,
                'videoStatus', (
                  select asset.status
                  from public.lesson_video_versions video
                  join public.video_assets asset
                    on asset.id = video.video_asset_id
                  where video.lesson_id = lesson.id
                    and video.active
                  order by video.version desc
                  limit 1
                )
              ) order by lesson.sort_order, lesson.id)
              from public.lessons lesson
              where lesson.module_id = module.id
                and lesson.archived_at is null
            ), '[]'::jsonb)
          ) order by module.sort_order, module.id)
          from public.modules module
          where module.course_version_id = version.id
        ), '[]'::jsonb)
      ) order by version.title, version.version)
      from public.course_versions version
      join public.course_requirements requirement
        on requirement.course_version_id = version.id
      where version.status = 'draft'
        and (is_platform_admin or version.created_by = actor)
    ), '[]'::jsonb),
    'organizingBodies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', body.id, 'label', body.legal_name
      ) order by body.legal_name, body.id)
      from public.organizing_bodies body
      where body.active
        and body.qualification_valid_from <= current_date
        and (
          body.qualification_valid_until is null
          or body.qualification_valid_until >= current_date
        )
    ), '[]'::jsonb),
    'authorities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', authority.id, 'label', authority.name
      ) order by authority.name, authority.id)
      from public.accreditation_authorities authority
      where authority.active
    ), '[]'::jsonb),
    'accreditationRevisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', revision.id,
        'label', course.internal_title || '／'
          || coalesce(
            revision.approval_reference,
            revision.application_reference,
            '申請中'
          )
      ) order by course.internal_title, revision.revision desc)
      from public.accreditation_decision_revisions revision
      join public.courses course on course.id = revision.course_id
      where revision.status in ('applying', 'approved')
        and revision.valid_from <= now()
        and revision.valid_until > now()
    ), '[]'::jsonb),
    'legalDocuments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', legal.id,
        'label', legal.kind || '／第' || legal.revision::text || '版'
      ) order by legal.kind, legal.revision desc)
      from public.legal_documents legal
      where legal.approved_by_legal
        and legal.effective_at <= now()
        and (legal.superseded_at is null or legal.superseded_at > now())
    ), '[]'::jsonb),
    'retentionPolicies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', retention.id,
        'label', retention.data_class || '／第'
          || retention.revision::text || '版'
      ) order by retention.data_class, retention.revision desc)
      from public.retention_policy_revisions retention
      where retention.effective_at <= now()
    ), '[]'::jsonb),
    'zoomHosts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', resource.id,
        'label', resource.host_user_reference || '（'
          || resource.verified_total_capacity::text || '人）'
      ) order by resource.host_user_reference, resource.id)
      from public.zoom_host_resources resource
      where resource.active
        and resource.license_verified_at >= now() - interval '30 days'
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function internal.read_platform_prerequisite_options()
  from public;

create or replace function public.read_platform_prerequisite_options()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_platform_prerequisite_options()
$$;

create or replace function internal.read_staff_live_session_context(
  target_session uuid
)
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
    'title', session.title,
    'status', session.status,
    'startsAt', session.starts_at,
    'endsAt', session.ends_at,
    'bookingCloseAt', session.booking_close_at,
    'canHost', session.status in ('scheduled', 'open', 'in_progress')
      and now() between session.starts_at - interval '60 minutes'
        and session.ends_at + interval '60 minutes',
    'canEditBreaks', session.status = 'draft'
      and not exists (
        select 1 from public.live_breaks formal_break
        where formal_break.live_session_id = session.id
          and formal_break.locked_at is not null
      ),
    'canSettle', session.status = 'ended'
      and now() >= session.evidence_settles_at,
    'canReschedule', session.status in ('draft', 'scheduled')
      and session.starts_at > now(),
    'breakIntervals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'startsAt', formal_break.starts_at,
        'endsAt', formal_break.ends_at
      ) order by formal_break.starts_at, formal_break.id)
      from public.live_breaks formal_break
      where formal_break.live_session_id = session.id
    ), '[]'::jsonb)
  ) into result
  from public.live_sessions session
  join public.course_versions version
    on version.id = session.course_version_id
  where session.id = target_session
    and (
      internal.has_staff_role('platform_admin')
      or version.created_by = actor
    );
  if result is null then
    raise exception 'LIVE_SESSION_CONTEXT_NOT_AUTHORIZED';
  end if;
  return result;
end
$$;
revoke all on function internal.read_staff_live_session_context(uuid)
  from public;

create or replace function public.read_staff_live_session_context(
  p_live_session_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_staff_live_session_context(p_live_session_id)
$$;

create or replace function internal.manage_platform_prerequisite(
  submitted_kind text,
  submitted_operation text,
  submitted_spec jsonb,
  submitted_reason text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  existing public.platform_prerequisite_changes%rowtype;
  change_id uuid;
begin
  if not internal.has_staff_role('platform_admin')
     or submitted_operation <> 'create_draft'
     or submitted_kind not in (
       'operating_setting', 'organizing_body',
       'accreditation_authority', 'accreditation_revision',
       'retention_policy_revision', 'legal_document_revision',
       'zoom_host_resource'
     )
     or jsonb_typeof(submitted_spec) <> 'object'
     or length(trim(submitted_reason)) < 10
  then
    raise exception 'PLATFORM_PREREQUISITE_CREATE_REJECTED';
  end if;

  select * into existing
  from public.platform_prerequisite_changes change
  where change.created_by = actor
    and change.idempotency_key = idempotency;
  if found then
    if existing.kind <> submitted_kind
       or existing.specification <> submitted_spec
       or existing.creation_reason <> trim(submitted_reason)
    then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object(
      'prerequisiteId', existing.id,
      'kind', existing.kind,
      'status', existing.status,
      'replayed', true
    );
  end if;

  -- Validate every kind before preserving it as a reviewable request. The
  -- authoritative tables remain untouched until a distinct reviewer approves.
  case submitted_kind
    when 'operating_setting' then
      if submitted_spec ->> 'settingKey' not in (
           'commerce_b2c', 'commerce_b2b', 'recorded_learning',
           'live_learning', 'hybrid_learning', 'certificate_issuance',
           'accreditation_exports'
         )
         or jsonb_typeof(submitted_spec -> 'enabled') <> 'boolean'
         or nullif(submitted_spec ->> 'effectiveAt', '') is null
      then raise exception 'OPERATING_SETTING_SPEC_INVALID'; end if;
      perform (submitted_spec ->> 'effectiveAt')::timestamptz;
    when 'organizing_body' then
      if length(trim(coalesce(submitted_spec ->> 'legalName', ''))) < 2
         or length(trim(coalesce(
           submitted_spec ->> 'qualificationReference', ''
         ))) < 2
         or nullif(submitted_spec ->> 'qualificationValidFrom', '') is null
         or length(trim(coalesce(submitted_spec ->> 'contactName', ''))) < 2
         or coalesce(submitted_spec ->> 'contactEmail', '')
           !~ '^[^@[:space:]]+@[^@[:space:]]+$'
      then raise exception 'ORGANIZING_BODY_SPEC_INVALID'; end if;
      if nullif(submitted_spec ->> 'qualificationValidUntil', '') is not null
         and (submitted_spec ->> 'qualificationValidUntil')::date
           < (submitted_spec ->> 'qualificationValidFrom')::date
      then raise exception 'ORGANIZING_BODY_VALIDITY_INVALID'; end if;
    when 'accreditation_authority' then
      if length(trim(coalesce(submitted_spec ->> 'name', ''))) < 2
         or length(trim(coalesce(
           submitted_spec ->> 'submissionMethod', ''
         ))) < 2
         or length(trim(coalesce(submitted_spec ->> 'contactName', ''))) < 2
         or coalesce(submitted_spec ->> 'contactEmail', '')
           !~ '^[^@[:space:]]+@[^@[:space:]]+$'
      then raise exception 'ACCREDITATION_AUTHORITY_SPEC_INVALID'; end if;
    when 'accreditation_revision' then
      if nullif(submitted_spec ->> 'courseId', '') is null
         or nullif(submitted_spec ->> 'organizingBodyId', '') is null
         or nullif(submitted_spec ->> 'authorityId', '') is null
         or length(trim(coalesce(
           submitted_spec ->> 'applicationReference', ''
         ))) < 1
         or length(trim(coalesce(
           submitted_spec ->> 'sourceDocumentPath', ''
         ))) < 1
         or coalesce(submitted_spec ->> 'sourceDocumentSha256', '')
           !~ '^[a-f0-9]{64}$'
         or nullif(submitted_spec ->> 'validFrom', '') is null
         or nullif(submitted_spec ->> 'validUntil', '') is null
         or (submitted_spec ->> 'validUntil')::timestamptz
           <= (submitted_spec ->> 'validFrom')::timestamptz
      then raise exception 'ACCREDITATION_REVISION_SPEC_INVALID'; end if;
      perform (submitted_spec ->> 'courseId')::uuid;
      perform (submitted_spec ->> 'organizingBodyId')::uuid;
      perform (submitted_spec ->> 'authorityId')::uuid;
    when 'retention_policy_revision' then
      if length(trim(coalesce(submitted_spec ->> 'policyName', ''))) < 2
         or length(trim(coalesce(submitted_spec ->> 'purpose', ''))) < 10
         or length(trim(coalesce(submitted_spec ->> 'legalBasis', ''))) < 5
         or coalesce(submitted_spec ->> 'retentionDays', '') !~ '^[0-9]+$'
         or (submitted_spec ->> 'retentionDays')::integer not between 1 and 36500
         or nullif(submitted_spec ->> 'effectiveAt', '') is null
      then raise exception 'RETENTION_POLICY_SPEC_INVALID'; end if;
    when 'legal_document_revision' then
      if submitted_spec ->> 'documentKind' not in (
           'b2c_terms', 'b2b_terms', 'privacy',
           'accreditation_disclosure'
         )
         or length(trim(coalesce(submitted_spec ->> 'title', ''))) < 2
         or length(trim(coalesce(submitted_spec ->> 'content', ''))) < 100
         or nullif(submitted_spec ->> 'effectiveAt', '') is null
      then raise exception 'LEGAL_DOCUMENT_SPEC_INVALID'; end if;
    when 'zoom_host_resource' then
      if length(trim(coalesce(
           submitted_spec ->> 'hostUserReference', ''
         ))) < 2
         or coalesce(submitted_spec ->> 'verifiedTotalCapacity', '')
           !~ '^[0-9]+$'
         or (submitted_spec ->> 'verifiedTotalCapacity')::integer
           not between 1 and 200
         or coalesce(submitted_spec ->> 'concurrencySlot', '')
           !~ '^[0-9]+$'
         or (submitted_spec ->> 'concurrencySlot')::integer
           not between 1 and 20
         or nullif(submitted_spec ->> 'licenseVerifiedAt', '') is null
      then raise exception 'ZOOM_HOST_RESOURCE_SPEC_INVALID'; end if;
  end case;

  insert into public.platform_prerequisite_changes (
    kind, specification, created_by, creation_reason, idempotency_key
  ) values (
    submitted_kind, submitted_spec, actor,
    trim(submitted_reason), idempotency
  )
  returning id into change_id;
  perform internal.append_audit_event(
    actor, 'platform_prerequisite.created',
    'platform_prerequisite', change_id::text,
    trim(submitted_reason), null,
    jsonb_build_object('kind', submitted_kind)
  );
  return jsonb_build_object(
    'prerequisiteId', change_id,
    'kind', submitted_kind,
    'status', 'pending_review',
    'replayed', false
  );
end
$$;
revoke all on function internal.manage_platform_prerequisite(
  text, text, jsonb, text, uuid
) from public;

create or replace function public.manage_platform_prerequisite(
  p_kind text,
  p_operation text,
  p_spec jsonb,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.manage_platform_prerequisite(
    p_kind, p_operation, p_spec, p_reason, p_idempotency_key
  )
$$;

create or replace function internal.decide_platform_prerequisite(
  submitted_kind text,
  target_change uuid,
  submitted_decision text,
  submitted_reason text,
  submitted_nonce_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  change public.platform_prerequisite_changes%rowtype;
  target_id uuid;
  next_revision integer;
  requested_effective_at timestamptz;
  requested_setting_key text;
  switch_names text[];
  switch_name text;
  legal_kind text;
begin
  perform internal.consume_step_up_grant(
    'platform_prerequisite_review',
    target_change::text,
    submitted_nonce_hash
  );
  if not internal.has_staff_role('platform_admin')
     or submitted_decision not in ('approve', 'reject')
     or length(trim(submitted_reason)) < 10
  then
    raise exception 'PLATFORM_PREREQUISITE_DECISION_REJECTED';
  end if;
  select * into change
  from public.platform_prerequisite_changes pending
  where pending.id = target_change
  for update;
  if not found
     or change.kind <> submitted_kind
     or change.status <> 'pending_review'
     or change.created_by = actor
  then
    raise exception 'DISTINCT_PREREQUISITE_REVIEWER_REQUIRED';
  end if;
  if submitted_decision = 'reject' then
    update public.platform_prerequisite_changes
    set status = 'rejected',
        reviewed_by = actor,
        review_reason = trim(submitted_reason),
        reviewed_at = clock_timestamp()
    where id = target_change;
    perform internal.append_audit_event(
      actor, 'platform_prerequisite.rejected',
      'platform_prerequisite', target_change::text,
      trim(submitted_reason), null,
      jsonb_build_object('kind', submitted_kind)
    );
    return jsonb_build_object(
      'prerequisiteId', target_change,
      'kind', submitted_kind,
      'status', 'rejected'
    );
  end if;

  case submitted_kind
    when 'operating_setting' then
      requested_setting_key := change.specification ->> 'settingKey';
      requested_effective_at :=
        (change.specification ->> 'effectiveAt')::timestamptz;
      perform pg_advisory_xact_lock(
        hashtextextended('suiyue:setting:' || requested_setting_key, 0)
      );
      select coalesce(max(revision), 0) + 1 into next_revision
      from public.operating_setting_revisions
      where operating_setting_revisions.setting_key =
        requested_setting_key;
      update public.operating_setting_revisions
      set superseded_at = requested_effective_at
      where operating_setting_revisions.setting_key =
          requested_setting_key
        and superseded_at is null
        and requested_effective_at
          >= operating_setting_revisions.effective_at;
      insert into public.operating_setting_revisions (
        setting_key, revision, value, approved_by, second_approved_by,
        effective_at
      ) values (
        requested_setting_key, next_revision,
        jsonb_build_object(
          'enabled',
          (change.specification ->> 'enabled')::boolean
        ),
        change.created_by, actor, requested_effective_at
      ) returning id into target_id;
      switch_names := case requested_setting_key
        when 'commerce_b2c' then array['b2c_commerce']
        when 'commerce_b2b' then
          array['organization_topup', 'organization_assignment']
        when 'recorded_learning' then array['recorded_playback']
        when 'live_learning' then array['live_booking', 'zoom_join']
        when 'hybrid_learning' then array['hybrid_completion']
        when 'certificate_issuance' then array['certificate_issue']
        when 'accreditation_exports' then array['accreditation_export']
        else array[]::text[]
      end;
      foreach switch_name in array switch_names loop
        update public.feature_switches
        set enabled = (change.specification ->> 'enabled')::boolean,
            approved_at = requested_effective_at,
            approved_by = actor,
            suspended_at = case
              when (change.specification ->> 'enabled')::boolean
                then null else clock_timestamp()
            end,
            suspended_by = case
              when (change.specification ->> 'enabled')::boolean
                then null else actor
            end,
            reason = trim(submitted_reason),
            updated_at = clock_timestamp()
        where name = switch_name;
      end loop;
    when 'organizing_body' then
      insert into public.organizing_bodies (
        legal_name, qualification_reference,
        qualification_valid_from, qualification_valid_until,
        contact_name, contact_email, active
      ) values (
        trim(change.specification ->> 'legalName'),
        trim(change.specification ->> 'qualificationReference'),
        (change.specification ->> 'qualificationValidFrom')::date,
        nullif(
          change.specification ->> 'qualificationValidUntil', ''
        )::date,
        trim(change.specification ->> 'contactName'),
        lower(trim(change.specification ->> 'contactEmail')),
        true
      ) returning id into target_id;
    when 'accreditation_authority' then
      insert into public.accreditation_authorities (
        name, submission_method, contact_name, contact_email, active
      ) values (
        trim(change.specification ->> 'name'),
        trim(change.specification ->> 'submissionMethod'),
        trim(change.specification ->> 'contactName'),
        lower(trim(change.specification ->> 'contactEmail')),
        true
      ) returning id into target_id;
    when 'accreditation_revision' then
      perform pg_advisory_xact_lock(hashtextextended(
        'suiyue:accreditation:'
          || (change.specification ->> 'courseId'), 0
      ));
      select coalesce(max(revision), 0) + 1 into next_revision
      from public.accreditation_decision_revisions
      where course_id =
        (change.specification ->> 'courseId')::uuid;
      insert into public.accreditation_decision_revisions (
        course_id, organizing_body_id, authority_id, revision, status,
        application_reference, valid_from, valid_until, effective_at,
        source_document_path, source_document_sha256, review_snapshot,
        created_by, reviewed_by
      ) values (
        (change.specification ->> 'courseId')::uuid,
        (change.specification ->> 'organizingBodyId')::uuid,
        (change.specification ->> 'authorityId')::uuid,
        next_revision, 'applying',
        trim(change.specification ->> 'applicationReference'),
        (change.specification ->> 'validFrom')::timestamptz,
        (change.specification ->> 'validUntil')::timestamptz,
        coalesce(
          nullif(change.specification ->> 'effectiveAt', '')::timestamptz,
          (change.specification ->> 'validFrom')::timestamptz
        ),
        trim(change.specification ->> 'sourceDocumentPath'),
        change.specification ->> 'sourceDocumentSha256',
        jsonb_build_object(
          'platformPrerequisiteId', change.id,
          'creationReason', change.creation_reason,
          'reviewReason', trim(submitted_reason)
        ),
        change.created_by, actor
      ) returning id into target_id;
    when 'retention_policy_revision' then
      perform pg_advisory_xact_lock(hashtextextended(
        'suiyue:retention:'
          || (change.specification ->> 'policyName'), 0
      ));
      select coalesce(max(revision), 0) + 1 into next_revision
      from public.retention_policy_revisions
      where data_class = change.specification ->> 'policyName';
      insert into public.retention_policy_revisions (
        data_class, revision, online_days, archive_days,
        legal_basis, approved_by, effective_at
      ) values (
        trim(change.specification ->> 'policyName'),
        next_revision,
        (change.specification ->> 'retentionDays')::integer,
        (change.specification ->> 'retentionDays')::integer,
        trim(change.specification ->> 'legalBasis')
          || E'\n目的：' || trim(change.specification ->> 'purpose'),
        actor,
        (change.specification ->> 'effectiveAt')::timestamptz
      ) returning id into target_id;
    when 'legal_document_revision' then
      legal_kind := case change.specification ->> 'documentKind'
        when 'b2c_terms' then 'b2c_contract'
        when 'b2b_terms' then 'b2b_contract'
        when 'privacy' then 'privacy_notice'
        else 'pending_accreditation_disclosure'
      end;
      perform pg_advisory_xact_lock(hashtextextended(
        'suiyue:legal:' || legal_kind, 0
      ));
      select coalesce(max(revision), 0) + 1 into next_revision
      from public.legal_documents
      where kind = legal_kind;
      insert into public.legal_documents (
        kind, revision, content_sha256, object_path,
        approved_by_legal, effective_at
      ) values (
        legal_kind, next_revision,
        encode(extensions.digest(
          convert_to(change.specification ->> 'content', 'UTF8'),
          'sha256'
        ), 'hex'),
        'inline://platform-prerequisite/' || change.id::text,
        true,
        (change.specification ->> 'effectiveAt')::timestamptz
      ) returning id into target_id;
    when 'zoom_host_resource' then
      insert into public.zoom_host_resources (
        host_user_reference, backup_host_reference,
        verified_total_capacity, concurrency_slot,
        license_verified_at, active
      ) values (
        trim(change.specification ->> 'hostUserReference'),
        nullif(trim(coalesce(
          change.specification ->> 'backupHostReference', ''
        )), ''),
        (change.specification ->> 'verifiedTotalCapacity')::integer,
        (change.specification ->> 'concurrencySlot')::integer,
        (change.specification ->> 'licenseVerifiedAt')::timestamptz,
        true
      ) returning id into target_id;
  end case;

  update public.platform_prerequisite_changes
  set status = 'approved',
      reviewed_by = actor,
      materialized_target_id = target_id,
      review_reason = trim(submitted_reason),
      reviewed_at = clock_timestamp()
  where id = target_change;
  perform internal.append_audit_event(
    actor, 'platform_prerequisite.approved',
    'platform_prerequisite', target_change::text,
    trim(submitted_reason), null,
    jsonb_build_object(
      'kind', submitted_kind,
      'materializedTargetId', target_id
    )
  );
  return jsonb_build_object(
    'prerequisiteId', target_change,
    'kind', submitted_kind,
    'status', 'approved',
    'materializedTargetId', target_id
  );
end
$$;
revoke all on function internal.decide_platform_prerequisite(
  text, uuid, text, text, text
) from public;

create or replace function public.decide_platform_prerequisite(
  p_kind text,
  p_target_id uuid,
  p_decision text,
  p_reason text,
  p_nonce_hash text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.decide_platform_prerequisite(
    p_kind, p_target_id, p_decision, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.read_public_course_readiness(
  target_version uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  version_row public.course_versions%rowtype;
  reasons jsonb := '[]'::jsonb;
begin
  select * into version_row
  from public.course_versions version
  where version.id = target_version;
  if not found
     or version_row.status <> 'published'
     or version_row.commerce_close_at <= now()
  then
    return jsonb_build_object(
      'purchaseReady', false,
      'reasons', jsonb_build_array('此課程目前未開放報名。')
    );
  end if;
  if not internal.feature_is_open('b2c_commerce') then
    reasons := reasons || jsonb_build_array('個人購課目前暫停。');
  end if;
  if not exists (
    select 1
    from public.course_version_accreditation link
    join public.accreditation_decision_revisions accreditation
      on accreditation.id = link.accreditation_revision_id
    where link.course_version_id = target_version
      and accreditation.status in ('applying', 'approved')
      and accreditation.valid_from <= now()
      and accreditation.valid_until >
        version_row.commerce_close_at
  ) then
    reasons := reasons || jsonb_build_array('積分申請或有效期限尚未完成。');
  end if;
  if not exists (
    select 1 from public.legal_documents legal
    where legal.id = version_row.legal_document_id
      and legal.approved_by_legal
      and legal.effective_at <= now()
      and (legal.superseded_at is null or legal.superseded_at > now())
  ) then
    reasons := reasons || jsonb_build_array('購課條款尚未生效。');
  end if;
  if version_row.delivery_type in ('recorded', 'hybrid')
     and not exists (
       select 1 from public.provider_health health
       where health.provider = 'cloudflare_stream'
         and health.status = 'healthy'
         and health.production_validated_at is not null
     )
  then
    reasons := reasons || jsonb_build_array('錄播服務目前未通過營運檢查。');
  end if;
  if version_row.delivery_type in ('live', 'hybrid') then
    if not exists (
      select 1 from public.provider_health health
      where health.provider in ('zoom_oauth', 'zoom_meeting_sdk')
        and health.status = 'healthy'
        and health.production_validated_at is not null
      having count(*) = 2
    ) then
      reasons := reasons || jsonb_build_array('直播服務目前未通過營運檢查。');
    end if;
    if not exists (
      select 1 from public.live_sessions session
      where session.course_version_id = target_version
        and session.status in ('scheduled', 'open')
        and session.booking_close_at > now()
    ) then
      reasons := reasons || jsonb_build_array('目前沒有可報名的直播場次。');
    end if;
  end if;
  return jsonb_build_object(
    'purchaseReady', jsonb_array_length(reasons) = 0,
    'reasons', reasons
  );
end
$$;
revoke all on function internal.read_public_course_readiness(uuid)
  from public;

create or replace function public.read_public_course_readiness(
  p_course_version_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_public_course_readiness(p_course_version_id)
$$;

create or replace function internal.read_learner_course_workspace(
  target_enrollment uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  result jsonb;
begin
  select jsonb_build_object(
    'courseTitle', version.title,
    'deliveryType', version.delivery_type,
    'enrollmentStatus', enrollment.status,
    'accreditationStatus', accreditation.status,
    'identity', case when profile.id is null then null else
      jsonb_build_object(
        'status', profile.status,
        'maskedName', case
          when person.display_name is null then null
          when length(person.display_name) <= 1 then person.display_name
          else left(person.display_name, 1)
            || repeat('○', greatest(length(person.display_name) - 1, 1))
        end,
        'maskedNationalId', null,
        'maskedCareWorkerId', null,
        'reconfirmedAt', enrollment.identity_profile_confirmed_at
      )
    end,
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', module.id,
        'title', module.title,
        'lessons', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', lesson.id,
            'title', lesson.title,
            'type', lesson.content_type,
            'videoVersionId', video.id,
            'completed', case lesson.content_type
              when 'video' then coalesce((
                select sum(block.seconds) >= video.duration_seconds
                from public.confirmed_watch_blocks block
                join public.presence_challenges challenge
                  on challenge.id = block.presence_challenge_id
                where block.enrollment_id = enrollment.id
                  and challenge.lesson_video_version_id = video.id
              ), false)
              when 'quiz' then exists (
                select 1 from public.quiz_attempts attempt
                where attempt.enrollment_id = enrollment.id
                  and attempt.status = 'passed'
              )
              when 'survey' then exists (
                select 1 from public.survey_responses response
                where response.enrollment_id = enrollment.id
              )
              else false
            end,
            'resumeSeconds', coalesce((
              select floor(max(session.last_media_position_seconds))::integer
              from public.playback_sessions session
              where session.enrollment_id = enrollment.id
                and session.lesson_video_version_id = video.id
            ), 0),
            'locked', enrollment.status not in ('active', 'completed'),
            'lockReason', case
              when enrollment.status not in ('active', 'completed')
                then '修課權限目前不可使用'
              else null
            end
          ) order by lesson.sort_order, lesson.id)
          from public.lessons lesson
          left join lateral (
            select video_version.id, video_asset.duration_seconds
            from public.lesson_video_versions video_version
            join public.video_assets video_asset
              on video_asset.id = video_version.video_asset_id
            where video_version.lesson_id = lesson.id
              and video_version.active
            order by video_version.version desc
            limit 1
          ) video on true
          where lesson.module_id = module.id
            and lesson.archived_at is null
        ), '[]'::jsonb)
      ) order by module.sort_order, module.id)
      from public.modules module
      where module.course_version_id = version.id
    ), '[]'::jsonb),
    'materials', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', material.id,
        'title', material.title,
        'lessonId', material.lesson_id
      ) order by material.created_at, material.id)
      from public.course_materials material
      where material.course_version_id = version.id
        and material.scan_status = 'safe'
        and material.promoted_object_path is not null
    ), '[]'::jsonb),
    'components', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', component.id,
        'title', component.title,
        'type', component.component_type,
        'required', component.required,
        'completed', case component.component_type
          when 'recorded' then
            coalesce(progress.confirmed_valid_seconds, 0)
              >= requirement.required_watch_seconds
          else exists (
            select 1
            from public.live_bookings booking
            join public.attendance_summaries attendance
              on attendance.live_booking_id = booking.id
            where booking.enrollment_id = enrollment.id
              and booking.live_component_id = component.id
              and attendance.qualified
              and attendance.quarantined_at is null
          )
        end,
        'prerequisiteIds', coalesce((
          select jsonb_agg(
            edge.prerequisite_component_id
            order by prerequisite.sort_order,
              edge.prerequisite_component_id
          )
          from public.component_prerequisites edge
          join public.hybrid_components prerequisite
            on prerequisite.id = edge.prerequisite_component_id
          where edge.dependent_component_id = component.id
        ), '[]'::jsonb)
      ) order by component.sort_order, component.id)
      from public.hybrid_components component
      where component.course_version_id = version.id
    ), '[]'::jsonb),
    'liveBookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bookingId', booking.id,
        'sessionId', session.id,
        'title', session.title,
        'status', booking.status,
        'startsAt', session.starts_at,
        'endsAt', session.ends_at,
        'changeLockedAt', booking.change_locked_at,
        'canChange', booking.status = 'confirmed'
          and now() < booking.change_locked_at,
        'canJoin', booking.status = 'confirmed'
          and session.status in ('open', 'in_progress')
          and now() between session.starts_at - interval '30 minutes'
            and session.ends_at + interval '30 minutes'
      ) order by session.starts_at, booking.id)
      from public.live_bookings booking
      join public.live_sessions session
        on session.id = booking.live_session_id
      where booking.enrollment_id = enrollment.id
    ), '[]'::jsonb),
    'completion', jsonb_build_object(
      'confirmedValidSeconds',
        coalesce(progress.confirmed_valid_seconds, 0),
      'requiredWatchSeconds', requirement.required_watch_seconds,
      'quizPassed', exists (
        select 1 from public.quiz_attempts attempt
        where attempt.enrollment_id = enrollment.id
          and attempt.status = 'passed'
      ),
      'surveyCompleted', exists (
        select 1 from public.survey_responses response
        where response.enrollment_id = enrollment.id
      ),
      'identityVerified', profile.status = 'verified'
        and enrollment.identity_profile_revision_confirmed =
          profile.profile_revision,
      'allLiveQualified', not exists (
        select 1
        from public.hybrid_components component
        where component.course_version_id = version.id
          and component.required
          and component.component_type = 'live'
          and not exists (
            select 1
            from public.live_bookings booking
            join public.attendance_summaries attendance
              on attendance.live_booking_id = booking.id
            where booking.enrollment_id = enrollment.id
              and booking.live_component_id = component.id
              and attendance.qualified
              and attendance.quarantined_at is null
          )
      )
    ),
    'certificate', case when certificate.id is null then null else
      jsonb_build_object(
        'id', certificate.id,
        'kind', certificate.certificate_kind,
        'status', case
          when exists (
            select 1
            from public.live_bookings booking
            join public.attendance_summaries attendance
              on attendance.live_booking_id = booking.id
            where booking.enrollment_id = enrollment.id
              and attendance.quarantined_at is not null
          ) then 'needs_correction'
          else certificate.current_status
        end
      )
    end
  ) into result
  from public.enrollments enrollment
  join public.entitlements entitlement
    on entitlement.id = enrollment.entitlement_id
  join public.course_versions version
    on version.id = enrollment.course_version_id
  join public.people person on person.id = enrollment.person_id
  join public.course_requirements requirement
    on requirement.course_version_id = version.id
  left join public.progress_summaries progress
    on progress.enrollment_id = enrollment.id
  left join private.accreditation_identity_profiles profile
    on profile.person_id = enrollment.person_id
  left join public.certificates certificate
    on certificate.enrollment_id = enrollment.id
  left join lateral (
    select decision.status
    from public.course_version_accreditation link
    join public.accreditation_decision_revisions decision
      on decision.id = link.accreditation_revision_id
    where link.course_version_id = version.id
    order by decision.revision desc
    limit 1
  ) accreditation on true
  where enrollment.id = target_enrollment
    and enrollment.person_id = actor
    and entitlement.status in ('active', 'frozen');
  if result is null then
    raise exception 'LEARNER_WORKSPACE_NOT_AUTHORIZED';
  end if;
  return result;
end
$$;
revoke all on function internal.read_learner_course_workspace(uuid)
  from public;

create or replace function public.read_learner_course_workspace(
  p_enrollment_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, private, internal
as $$
  select internal.read_learner_course_workspace(p_enrollment_id)
$$;

create or replace function internal.read_learner_course_material_reference(
  target_material uuid,
  target_person uuid
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
  if auth.role() <> 'service_role' then
    raise exception 'COURSE_MATERIAL_SERVICE_REQUIRED';
  end if;
  select jsonb_build_object(
    'objectPath', material.promoted_object_path,
    'detectedMime', upload.detected_mime,
    'contentSha256', material.content_sha256
  ) into result
  from public.course_materials material
  join public.enrollments enrollment
    on enrollment.course_version_id = material.course_version_id
  join public.entitlements entitlement
    on entitlement.id = enrollment.entitlement_id
  join public.upload_quarantine upload
    on upload.promoted_object_path = material.promoted_object_path
  where material.id = target_material
    and enrollment.person_id = target_person
    and enrollment.status in ('active', 'completed')
    and entitlement.status = 'active'
    and material.scan_status = 'safe'
    and material.promoted_object_path is not null
    and upload.status = 'promoted'
    and upload.detected_mime is not null;
  if result is null then
    raise exception 'COURSE_MATERIAL_NOT_AUTHORIZED';
  end if;
  return result;
end
$$;
revoke all on function internal.read_learner_course_material_reference(
  uuid, uuid
) from public;

create or replace function public.read_learner_course_material_reference(
  p_course_material_id uuid,
  p_person_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_learner_course_material_reference(
    p_course_material_id, p_person_id
  )
$$;

create or replace function internal.read_own_organization_application()
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
  select jsonb_build_object(
    'organizationId', organization.id,
    'organizationName', organization.legal_name,
    'status', organization.status,
    'reasonSummary', (
      select audit.reason
      from public.audit_events audit
      where audit.target_type = 'organization'
        and audit.target_id = organization.id::text
        and audit.action in (
          'organization.rejected', 'organization.suspended'
        )
      order by audit.occurred_at desc, audit.sequence desc
      limit 1
    ),
    'role', membership.role
  ) into result
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.organization_id
  where membership.person_id = actor
    and membership.active
  order by organization.created_at desc, organization.id
  limit 1;
  return result;
end
$$;
revoke all on function internal.read_own_organization_application()
  from public;

create or replace function public.read_own_organization_application()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_own_organization_application()
$$;

create or replace function internal.read_organization_workspace_details(
  target_organization uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  actor_role text;
  can_train boolean;
  result jsonb;
begin
  select membership.role into actor_role
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.organization_id
  where membership.organization_id = target_organization
    and membership.person_id = actor
    and membership.active
    and organization.status = 'approved';
  if actor_role not in ('owner', 'training_manager', 'finance') then
    raise exception 'ORGANIZATION_WORKSPACE_NOT_AUTHORIZED';
  end if;
  can_train := actor_role in ('owner', 'training_manager');
  select jsonb_build_object(
    'members', case when can_train then coalesce((
      select jsonb_agg(jsonb_build_object(
        'personId', membership.person_id,
        'displayName', coalesce(person.display_name, '未填姓名'),
        'employeeNumber', membership.employee_number,
        'department', membership.department,
        'role', membership.role,
        'status', case when membership.active then 'active' else 'inactive' end
      ) order by coalesce(membership.department, ''),
        coalesce(person.display_name, ''), membership.person_id)
      from public.organization_memberships membership
      join public.people person on person.id = membership.person_id
      where membership.organization_id = target_organization
    ), '[]'::jsonb) else '[]'::jsonb end,
    'invitations', case when can_train then coalesce((
      select jsonb_agg(jsonb_build_object(
        'invitationId', invitation.id,
        'maskedPhone', '受保護門號（' ||
          left(invitation.phone_blind_index, 6) || '…）',
        'role', invitation.role,
        'status', case
          when invitation.accepted_at is not null then 'accepted'
          when invitation.revoked_at is not null then 'revoked'
          when invitation.expires_at <= now() then 'expired'
          else 'pending'
        end,
        'expiresAt', invitation.expires_at
      ) order by invitation.created_at desc, invitation.id)
      from public.organization_invitations invitation
      where invitation.organization_id = target_organization
    ), '[]'::jsonb) else '[]'::jsonb end,
    'topups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'topupId', topup.id,
        'referenceNumber', 'TOP-' || upper(left(
          replace(topup.id::text, '-', ''), 10
        )),
        'points', topup.points,
        'amountTwd', topup.amount_due_twd,
        'status', topup.status,
        'transferDueAt', topup.transfer_due_at,
        'createdAt', topup.created_at
      ) order by topup.created_at desc, topup.id)
      from public.point_topups topup
      where topup.organization_id = target_organization
    ), '[]'::jsonb),
    'assignments', case when can_train then coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignmentId', assignment.id,
        'memberLabel', coalesce(person.display_name, '未填姓名'),
        'courseTitle', version.title,
        'courseVersionId', version.id,
        'liveComponentId', (
          select booking.live_component_id
          from public.live_bookings booking
          where booking.payer_type = 'organization'
            and booking.payer_source_id = assignment.id
          order by booking.created_at
          limit 1
        ),
        'status', assignment.status,
        'points', assignment.point_price_snapshot,
        'canRelease', assignment.status = 'reserved',
        'eligibleLiveSessions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', session.id,
            'title', session.title,
            'startsAt', session.starts_at,
            'bookingCloseAt', session.booking_close_at
          ) order by session.starts_at, session.id)
          from public.live_sessions session
          where session.course_version_id = assignment.course_version_id
            and session.status in ('scheduled', 'open')
            and session.booking_close_at > now()
        ), '[]'::jsonb)
      ) order by assignment.created_at desc, assignment.id)
      from public.organization_assignments assignment
      join public.people person on person.id = assignment.member_person_id
      join public.course_versions version
        on version.id = assignment.course_version_id
      where assignment.organization_id = target_organization
    ), '[]'::jsonb) else '[]'::jsonb end,
    'liveBookings', case when can_train then coalesce((
      select jsonb_agg(jsonb_build_object(
        'bookingId', booking.id,
        'sessionId', session.id,
        'assignmentId', assignment.id,
        'memberLabel', coalesce(person.display_name, '未填姓名'),
        'courseTitle', version.title,
        'sessionTitle', session.title,
        'startsAt', session.starts_at,
        'status', booking.status,
        'canChange', booking.status = 'confirmed'
          and now() < booking.change_locked_at,
        'replacementSessions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', replacement.id,
            'title', replacement.title,
            'startsAt', replacement.starts_at,
            'bookingCloseAt', replacement.booking_close_at
          ) order by replacement.starts_at, replacement.id)
          from public.live_sessions replacement
          where replacement.course_version_id =
              assignment.course_version_id
            and replacement.id <> session.id
            and replacement.status in ('scheduled', 'open')
            and replacement.booking_close_at > now()
        ), '[]'::jsonb)
      ) order by session.starts_at, booking.id)
      from public.live_bookings booking
      join public.organization_assignments assignment
        on booking.payer_type = 'organization'
        and booking.payer_source_id = assignment.id
      join public.live_sessions session
        on session.id = booking.live_session_id
      join public.people person on person.id = booking.person_id
      join public.course_versions version
        on version.id = booking.course_version_id
      where assignment.organization_id = target_organization
    ), '[]'::jsonb) else '[]'::jsonb end,
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'invoiceId', invoice.id,
        'externalNumber', invoice.external_number,
        'status', invoice.status,
        'amountTwd', invoice.amount_twd,
        'issuedOn', invoice.issued_on
      ) order by invoice.created_at desc, invoice.id)
      from public.invoice_records invoice
      join public.point_topups topup
        on topup.id = invoice.point_topup_id
      where topup.organization_id = target_organization
    ), '[]'::jsonb),
    'outcomes', case when can_train then coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignmentId', assignment.id,
        'memberLabel', coalesce(person.display_name, '未填姓名'),
        'courseTitle', version.title,
        'progressPercent', least(100, case
          when requirement.required_watch_seconds = 0 then 100
          else round(
            coalesce(progress.confirmed_valid_seconds, 0)::numeric
              * 100 / requirement.required_watch_seconds
          )::integer
        end),
        'validMinutes',
          floor(coalesce(progress.confirmed_valid_seconds, 0) / 60.0),
        'quizScore', (
          select attempt.score
          from public.quiz_attempts attempt
          where attempt.enrollment_id = enrollment.id
            and attempt.submitted_at is not null
          order by attempt.attempt_number desc
          limit 1
        ),
        'completionStatus', coalesce(enrollment.status, 'not_started'),
        'accreditationStatus', coalesce(accreditation.status, 'not_started')
      ) order by assignment.created_at desc, assignment.id)
      from public.organization_assignments assignment
      join public.people person on person.id = assignment.member_person_id
      join public.course_versions version
        on version.id = assignment.course_version_id
      join public.course_requirements requirement
        on requirement.course_version_id = version.id
      left join public.entitlements entitlement
        on entitlement.source_type = 'organization_assignment'
        and entitlement.source_id = assignment.id
      left join public.enrollments enrollment
        on enrollment.entitlement_id = entitlement.id
      left join public.progress_summaries progress
        on progress.enrollment_id = enrollment.id
      left join lateral (
        select decision.status
        from public.course_version_accreditation link
        join public.accreditation_decision_revisions decision
          on decision.id = link.accreditation_revision_id
        where link.course_version_id = version.id
        order by decision.revision desc
        limit 1
      ) accreditation on true
      where assignment.organization_id = target_organization
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into result;
  return result;
end
$$;
revoke all on function internal.read_organization_workspace_details(uuid)
  from public;

create or replace function public.read_organization_workspace_details(
  p_organization_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_organization_workspace_details(p_organization_id)
$$;

-- Explicit server and RPC grants. service_role can read projections and invoke
-- narrow operations, but receives no blanket table write grant.
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema internal to authenticated, service_role;
grant select on all tables in schema public to service_role;
grant select on public.certificate_verification_projection to service_role;

grant execute on function internal.read_public_course_readiness(uuid)
  to anon, authenticated;
grant execute on function public.read_public_course_readiness(uuid)
  to anon, authenticated;
grant execute on function internal.read_learner_course_workspace(uuid)
  to authenticated;
grant execute on function public.read_learner_course_workspace(uuid)
  to authenticated;
grant execute on function internal.read_learner_course_material_reference(
  uuid, uuid
) to service_role;
grant execute on function public.read_learner_course_material_reference(
  uuid, uuid
) to service_role;
grant execute on function internal.read_platform_prerequisite_options()
  to authenticated;
grant execute on function public.read_platform_prerequisite_options()
  to authenticated;
grant execute on function internal.read_staff_live_session_context(uuid)
  to authenticated;
grant execute on function public.read_staff_live_session_context(uuid)
  to authenticated;
grant execute on function internal.manage_platform_prerequisite(
  text, text, jsonb, text, uuid
) to authenticated;
grant execute on function public.manage_platform_prerequisite(
  text, text, jsonb, text, uuid
) to authenticated;
grant execute on function internal.decide_platform_prerequisite(
  text, uuid, text, text, text
) to authenticated;
grant execute on function public.decide_platform_prerequisite(
  text, uuid, text, text, text
) to authenticated;
grant execute on function internal.authorize_staff_action(text, text, text)
  to authenticated;
grant execute on function public.authorize_staff_action(text, text, text)
  to authenticated;
grant execute on function internal.emergency_suspend_platform(text, text)
  to authenticated;
grant execute on function public.emergency_suspend_platform(text, text)
  to authenticated;
grant execute on function internal.create_b2c_order(uuid, uuid, jsonb, uuid)
  to authenticated;
grant execute on function public.create_b2c_order(uuid, uuid, jsonb, uuid)
  to authenticated;
grant execute on function internal.expire_due_live_booking_holds(integer)
  to service_role;
grant execute on function public.expire_due_live_booking_holds(integer)
  to service_role;
grant execute on function internal.submit_payment_proof(
  uuid, text, text, text, timestamptz, integer, text, text, uuid
) to authenticated;
grant execute on function public.submit_payment_proof(
  uuid, text, text, text, timestamptz, integer, text, text, uuid
) to authenticated;
grant execute on function internal.authorize_recorded_playback(uuid, uuid)
  to authenticated;
grant execute on function public.authorize_recorded_playback(uuid, uuid)
  to authenticated;
grant execute on function internal.recompute_recorded_progress(uuid)
  to service_role;
grant execute on function public.recompute_recorded_progress(uuid)
  to service_role;
grant execute on function internal.enqueue_completion_evaluation(uuid)
  to service_role;
grant execute on function public.enqueue_completion_evaluation(uuid)
  to service_role;
grant execute on function internal.record_playback_heartbeat(
  uuid, uuid, bigint, bigint, numeric, boolean, boolean, boolean, text
) to authenticated;
grant execute on function public.record_playback_heartbeat(
  uuid, uuid, bigint, bigint, numeric, boolean, boolean, boolean, text
) to authenticated;
grant execute on function internal.confirm_presence_challenge(
  uuid, text, uuid
)
  to authenticated;
grant execute on function public.confirm_presence_challenge(
  uuid, text, uuid
)
  to authenticated;
grant execute on function internal.start_quiz_attempt(uuid, uuid)
  to authenticated;
grant execute on function public.start_quiz_attempt(uuid, uuid)
  to authenticated;
grant execute on function internal.submit_quiz_attempt(uuid, jsonb, uuid)
  to authenticated;
grant execute on function public.submit_quiz_attempt(uuid, jsonb, uuid)
  to authenticated;
grant execute on function internal.submit_survey(uuid, integer[], text, uuid)
  to authenticated;
grant execute on function public.submit_survey(uuid, integer[], text, uuid)
  to authenticated;
grant execute on function internal.issue_live_join_lease(uuid, text, uuid)
  to authenticated;
grant execute on function public.issue_live_join_lease(uuid, text, uuid)
  to authenticated;
grant execute on function internal.read_live_calendar_event(uuid)
  to authenticated;
grant execute on function public.read_live_calendar_event(uuid)
  to authenticated;
grant execute on function internal.request_live_session_change(
  uuid, text, timestamptz, timestamptz, timestamptz, text, uuid
) to authenticated;
grant execute on function public.request_live_session_change(
  uuid, text, timestamptz, timestamptz, timestamptz, text, uuid
) to authenticated;
grant execute on function internal.read_live_session_change_context(uuid)
  to service_role;
grant execute on function public.read_live_session_change_context(uuid)
  to service_role;
grant execute on function internal.finalize_live_session_change(uuid)
  to service_role;
grant execute on function public.finalize_live_session_change(uuid)
  to service_role;
grant execute on function internal.record_live_heartbeat(
  uuid, bigint, boolean, boolean
) to authenticated;
grant execute on function public.record_live_heartbeat(
  uuid, bigint, boolean, boolean
) to authenticated;
grant execute on function internal.record_live_check_event(
  uuid, text, boolean, uuid
) to authenticated;
grant execute on function public.record_live_check_event(
  uuid, text, boolean, uuid
) to authenticated;
grant execute on function internal.settle_live_attendance(uuid)
  to authenticated, service_role;
grant execute on function public.settle_live_attendance(uuid)
  to authenticated, service_role;
grant execute on function internal.propose_attendance_correction(
  uuid, integer, integer, text, text, text
) to authenticated;
grant execute on function public.propose_attendance_correction(
  uuid, integer, integer, text, text, text
) to authenticated;
grant execute on function internal.decide_attendance_correction(
  uuid, text, text, text
) to authenticated;
grant execute on function public.decide_attendance_correction(
  uuid, text, text, text
) to authenticated;
grant execute on function internal.propose_provider_anomaly_resolution(
  uuid, text, text, timestamptz, text, text, uuid, text
) to authenticated;
grant execute on function public.propose_provider_anomaly_resolution(
  uuid, text, text, timestamptz, text, text, uuid, text
) to authenticated;
grant execute on function internal.decide_provider_anomaly_resolution(
  uuid, text, text, text
) to authenticated;
grant execute on function public.decide_provider_anomaly_resolution(
  uuid, text, text, text
) to authenticated;
grant execute on function internal.assign_organization_course(
  uuid, uuid, uuid, uuid
) to authenticated;
grant execute on function public.assign_organization_course(
  uuid, uuid, uuid, uuid
) to authenticated;
grant execute on function internal.select_assignment_live_session(
  uuid, uuid, uuid, uuid
) to authenticated;
grant execute on function public.select_assignment_live_session(
  uuid, uuid, uuid, uuid
) to authenticated;
grant execute on function internal.change_assignment_live_session(
  uuid, uuid, uuid
) to authenticated;
grant execute on function public.change_assignment_live_session(
  uuid, uuid, uuid
) to authenticated;
grant execute on function internal.release_organization_assignment(
  uuid, text, uuid
) to authenticated;
grant execute on function public.release_organization_assignment(
  uuid, text, uuid
) to authenticated;
grant execute on function internal.allocate_bank_transaction(
  uuid, uuid, integer, text, uuid
) to authenticated;
grant execute on function public.allocate_bank_transaction(
  uuid, uuid, integer, text, uuid
) to authenticated;
grant execute on function internal.confirm_bank_allocation(uuid, text)
  to authenticated;
grant execute on function public.confirm_bank_allocation(uuid, text)
  to authenticated;
grant execute on function internal.publish_course_version(uuid, text, text)
  to authenticated;
grant execute on function public.publish_course_version(uuid, text, text)
  to authenticated;

grant execute on function internal.ingest_provider_event(
  text, text, text, text, timestamptz, jsonb, text
) to service_role;
grant execute on function public.ingest_provider_event(
  text, text, text, text, timestamptz, jsonb, text
) to service_role;
grant execute on function internal.lease_due_jobs(text, integer)
  to service_role;
grant execute on function public.lease_due_jobs(text, integer)
  to service_role;
grant execute on function internal.finalize_live_join_lease(
  uuid, text, jsonb
)
  to service_role;
grant execute on function public.finalize_live_join_lease(
  uuid, text, jsonb
)
  to service_role;
grant execute on function internal.read_live_join_abort_context(uuid, uuid)
  to service_role;
grant execute on function public.read_live_join_abort_context(uuid, uuid)
  to service_role;
grant execute on function internal.read_live_join_expiry_context(uuid, uuid)
  to service_role;
grant execute on function public.read_live_join_expiry_context(uuid, uuid)
  to service_role;
grant execute on function internal.abort_live_join_lease(
  uuid, boolean, boolean, text, uuid
)
  to service_role;
grant execute on function public.abort_live_join_lease(
  uuid, boolean, boolean, text, uuid
)
  to service_role;
grant execute on function internal.expire_live_join_credential(
  uuid, boolean, text, uuid
)
  to service_role;
grant execute on function public.expire_live_join_credential(
  uuid, boolean, text, uuid
)
  to service_role;
grant execute on function internal.finalize_completion_and_certificate(
  uuid, text, text, text, uuid
) to service_role;
grant execute on function public.finalize_completion_and_certificate(
  uuid, text, text, text, uuid
) to service_role;
grant execute on function internal.bootstrap_platform_admins(uuid, uuid, text)
  to service_role;
grant execute on function public.bootstrap_platform_admins(uuid, uuid, text)
  to service_role;
grant execute on function internal.present_legal_contract(uuid, text, inet)
  to authenticated;
grant execute on function public.present_legal_contract(uuid, text, inet)
  to authenticated;
grant execute on function internal.confirm_legal_contract(uuid, text, inet)
  to authenticated;
grant execute on function public.confirm_legal_contract(uuid, text, inet)
  to authenticated;
grant execute on function internal.read_own_order(uuid) to authenticated;
grant execute on function public.read_own_order(uuid) to authenticated;
grant execute on function internal.read_own_orders(integer, timestamptz)
  to authenticated;
grant execute on function public.read_own_orders(integer, timestamptz)
  to authenticated;
grant execute on function internal.apply_for_organization(
  text, text, text, uuid
) to authenticated;
grant execute on function public.apply_for_organization(
  text, text, text, uuid
) to authenticated;
grant execute on function internal.review_organization_application(
  uuid, text, text
) to authenticated;
grant execute on function public.review_organization_application(
  uuid, text, text
) to authenticated;
grant execute on function internal.create_organization_invitation(
  uuid, jsonb, text, text, text, text, text, text, uuid
) to authenticated;
grant execute on function public.create_organization_invitation(
  uuid, jsonb, text, text, text, text, text, text, uuid
) to authenticated;
grant execute on function internal.manage_organization_invitation(
  uuid, uuid, text, text, uuid
) to authenticated;
grant execute on function public.manage_organization_invitation(
  uuid, uuid, text, text, uuid
) to authenticated;
grant execute on function internal.import_organization_invitations(
  uuid, uuid, jsonb, uuid
) to authenticated;
grant execute on function public.import_organization_invitations(
  uuid, uuid, jsonb, uuid
) to authenticated;
grant execute on function internal.accept_organization_invitation(text, text)
  to authenticated;
grant execute on function public.accept_organization_invitation(text, text)
  to authenticated;
grant execute on function internal.present_organization_contract(
  uuid, text, inet
) to authenticated;
grant execute on function public.present_organization_contract(
  uuid, text, inet
) to authenticated;
grant execute on function internal.create_point_topup(
  uuid, integer, uuid, uuid
) to authenticated;
grant execute on function public.create_point_topup(
  uuid, integer, uuid, uuid
) to authenticated;
grant execute on function internal.submit_point_topup_proof(
  uuid, text, text, text, timestamptz, integer, uuid
) to authenticated;
grant execute on function public.submit_point_topup_proof(
  uuid, text, text, text, timestamptz, integer, uuid
) to authenticated;
grant execute on function internal.read_own_point_topup(uuid)
  to authenticated;
grant execute on function public.read_own_point_topup(uuid)
  to authenticated;
grant execute on function internal.allocate_bank_transaction_to_topup(
  uuid, uuid, integer, text, uuid
) to authenticated;
grant execute on function public.allocate_bank_transaction_to_topup(
  uuid, uuid, integer, text, uuid
) to authenticated;
grant execute on function internal.confirm_topup_bank_allocation(uuid, text)
  to authenticated;
grant execute on function public.confirm_topup_bank_allocation(uuid, text)
  to authenticated;
grant execute on function internal.read_anonymous_survey_aggregate(uuid)
  to authenticated;
grant execute on function public.read_anonymous_survey_aggregate(uuid)
  to authenticated;
grant execute on function internal.read_survey_investigation(uuid, text)
  to authenticated;
grant execute on function public.read_survey_investigation(uuid, text)
  to authenticated;
grant execute on function internal.request_point_refund(
  uuid, uuid, uuid, bigint, jsonb, text, uuid
) to authenticated;
grant execute on function public.request_point_refund(
  uuid, uuid, uuid, bigint, jsonb, text, uuid
) to authenticated;
grant execute on function internal.decide_point_refund(
  uuid, text, text, text
) to authenticated;
grant execute on function public.decide_point_refund(
  uuid, text, text, text
) to authenticated;
grant execute on function internal.authorize_point_refund_account_access(
  uuid, text, text
) to authenticated;
grant execute on function public.authorize_point_refund_account_access(
  uuid, text, text
) to authenticated;
grant execute on function internal.consume_point_refund_account_access(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.consume_point_refund_account_access(
  uuid, uuid, uuid
) to service_role;
grant execute on function internal.record_point_refund_result(
  uuid, boolean, text, text, text, uuid, text
) to authenticated;
grant execute on function public.record_point_refund_result(
  uuid, boolean, text, text, text, uuid, text
) to authenticated;
grant execute on function internal.read_organization_training_report(
  uuid, uuid, uuid, text, text
) to authenticated;
grant execute on function public.read_organization_training_report(
  uuid, uuid, uuid, text, text
) to authenticated;
grant execute on function internal.start_email_verification(text, text, inet)
  to authenticated;
grant execute on function public.start_email_verification(text, text, inet)
  to authenticated;
grant execute on function internal.confirm_email_verification(text, text)
  to authenticated;
grant execute on function public.confirm_email_verification(text, text)
  to authenticated;
grant execute on function internal.consume_route_rate_limit(
  text, text, integer
) to service_role;
grant execute on function public.consume_route_rate_limit(
  text, text, integer
) to service_role;
grant execute on function internal.assess_post_otp_identity(
  uuid, text, text
) to service_role;
grant execute on function public.assess_post_otp_identity(
  uuid, text, text
) to service_role;
grant execute on function internal.resolve_restricted_upload_person(
  uuid, text
) to service_role;
grant execute on function public.resolve_restricted_upload_person(
  uuid, text
) to service_role;
grant execute on function internal.open_identity_recovery_case(
  uuid, text, text, uuid, uuid
) to service_role;
grant execute on function public.open_identity_recovery_case(
  uuid, text, text, uuid, uuid
) to service_role;
grant execute on function internal.read_completion_render_context(uuid)
  to service_role;
grant execute on function public.read_completion_render_context(uuid)
  to service_role;
grant execute on function internal.read_identity_encryption_bundle(uuid)
  to service_role;
grant execute on function public.read_identity_encryption_bundle(uuid)
  to service_role;
grant execute on function internal.ensure_person_encryption_key(
  uuid, jsonb, text
) to service_role;
grant execute on function public.ensure_person_encryption_key(
  uuid, jsonb, text
) to service_role;
grant execute on function internal.upsert_accreditation_identity_profile(
  uuid, uuid, jsonb, jsonb, text, text, text, text, text
) to service_role;
grant execute on function public.upsert_accreditation_identity_profile(
  uuid, uuid, jsonb, jsonb, text, text, text, text, text
) to service_role;
grant execute on function internal.reconfirm_accreditation_identity(uuid)
  to authenticated;
grant execute on function public.reconfirm_accreditation_identity(uuid)
  to authenticated;
grant execute on function internal.issue_step_up_grant(text, text, text)
  to authenticated;
grant execute on function public.issue_step_up_grant(text, text, text)
  to authenticated;
grant execute on function internal.request_staff_role_change(
  uuid, text, text, text, text
) to authenticated;
grant execute on function public.request_staff_role_change(
  uuid, text, text, text, text
) to authenticated;
grant execute on function internal.decide_staff_role_change(
  uuid, text, text, text
) to authenticated;
grant execute on function public.decide_staff_role_change(
  uuid, text, text, text
) to authenticated;
grant execute on function internal.decide_identity_recovery_case(
  uuid, text, text, text
) to authenticated;
grant execute on function public.decide_identity_recovery_case(
  uuid, text, text, text
) to authenticated;
grant execute on function internal.complete_identity_recovery_case(
  uuid, uuid, text
) to service_role;
grant execute on function public.complete_identity_recovery_case(
  uuid, uuid, text
) to service_role;
grant execute on function internal.read_host_join_context(uuid, text)
  to authenticated;
grant execute on function public.read_host_join_context(uuid, text)
  to authenticated;
grant execute on function internal.create_accreditation_submission_batch(
  uuid, uuid, uuid, text, uuid
) to authenticated;
grant execute on function public.create_accreditation_submission_batch(
  uuid, uuid, uuid, text, uuid
) to authenticated;
grant execute on function internal.approve_and_authorize_export(uuid, text)
  to authenticated;
grant execute on function public.approve_and_authorize_export(uuid, text)
  to authenticated;
grant execute on function internal.record_accreditation_export(
  uuid, uuid, text, text, jsonb, integer, jsonb, text
) to service_role;
grant execute on function public.record_accreditation_export(
  uuid, uuid, text, text, jsonb, integer, jsonb, text
) to service_role;
grant execute on function internal.mark_accreditation_batch_submitted(
  uuid, text, text, text
) to authenticated;
grant execute on function public.mark_accreditation_batch_submitted(
  uuid, text, text, text
) to authenticated;
grant execute on function internal.record_accreditation_batch_results(
  uuid, jsonb, text, text
) to authenticated;
grant execute on function public.record_accreditation_batch_results(
  uuid, jsonb, text, text
) to authenticated;
grant execute on function internal.consume_export_download_capability(
  uuid, text
) to service_role;
grant execute on function public.consume_export_download_capability(
  uuid, text
) to service_role;
grant execute on function internal.authorize_certificate_download(uuid)
  to authenticated;
grant execute on function public.authorize_certificate_download(uuid)
  to authenticated;
grant execute on function internal.request_certificate_revocation(
  uuid, text, uuid, text
) to authenticated;
grant execute on function public.request_certificate_revocation(
  uuid, text, uuid, text
) to authenticated;
grant execute on function internal.decide_certificate_revocation(
  uuid, text, text, text
) to authenticated;
grant execute on function public.decide_certificate_revocation(
  uuid, text, text, text
) to authenticated;
grant execute on function internal.approve_identity_profile_access(
  uuid, text, text
) to authenticated;
grant execute on function public.approve_identity_profile_access(
  uuid, text, text
) to authenticated;
grant execute on function internal.consume_identity_review_access(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.consume_identity_review_access(
  uuid, uuid, uuid
) to service_role;
grant execute on function internal.decide_identity_verification_case(
  uuid, text, text, text
) to authenticated;
grant execute on function public.decide_identity_verification_case(
  uuid, text, text, text
) to authenticated;
grant execute on function internal.register_stream_direct_upload(
  uuid, text, uuid
) to authenticated;
grant execute on function public.register_stream_direct_upload(
  uuid, text, uuid
) to authenticated;
grant execute on function internal.authorize_video_master_backup(uuid)
  to authenticated;
grant execute on function public.authorize_video_master_backup(uuid)
  to authenticated;
grant execute on function internal.confirm_video_master_backup(
  uuid, uuid, text, text
) to service_role;
grant execute on function public.confirm_video_master_backup(
  uuid, uuid, text, text
) to service_role;
grant execute on function internal.record_local_stream_ready(text)
  to service_role;
grant execute on function public.record_local_stream_ready(text)
  to service_role;
grant execute on function internal.create_course_draft(jsonb, uuid)
  to authenticated;
grant execute on function public.create_course_draft(jsonb, uuid)
  to authenticated;
grant execute on function internal.author_course_structure(
  uuid, text, jsonb, uuid
) to authenticated;
grant execute on function public.author_course_structure(
  uuid, text, jsonb, uuid
) to authenticated;
grant execute on function internal.read_staff_queue_counts(text)
  to authenticated;
grant execute on function public.read_staff_queue_counts(text)
  to authenticated;
grant execute on function internal.read_staff_queue_items(
  text, text, text, text, integer
) to authenticated;
grant execute on function public.read_staff_queue_items(
  text, text, text, text, integer
) to authenticated;
grant execute on function internal.add_question_to_draft(
  uuid, text, text, text, jsonb, integer, uuid
) to authenticated;
grant execute on function public.add_question_to_draft(
  uuid, text, text, text, jsonb, integer, uuid
) to authenticated;
grant execute on function internal.manage_question_draft(
  uuid, text, jsonb, uuid
) to authenticated;
grant execute on function public.manage_question_draft(
  uuid, text, jsonb, uuid
) to authenticated;
grant execute on function internal.submit_course_version_for_review(
  uuid, text
) to authenticated;
grant execute on function public.submit_course_version_for_review(
  uuid, text
) to authenticated;
grant execute on function internal.replace_draft_live_breaks(
  uuid, jsonb, text, uuid
) to authenticated;
grant execute on function public.replace_draft_live_breaks(
  uuid, jsonb, text, uuid
) to authenticated;
grant execute on function internal.prepare_live_session_setup(jsonb, uuid)
  to authenticated;
grant execute on function public.prepare_live_session_setup(jsonb, uuid)
  to authenticated;
grant execute on function internal.finalize_live_session_setup(
  uuid, text, text, jsonb, text
) to service_role;
grant execute on function public.finalize_live_session_setup(
  uuid, text, text, jsonb, text
) to service_role;
grant execute on function internal.fail_live_session_setup(uuid, text)
  to service_role;
grant execute on function public.fail_live_session_setup(uuid, text)
  to service_role;
grant execute on function internal.assign_live_session_assistant(
  uuid, uuid, text
) to authenticated;
grant execute on function public.assign_live_session_assistant(
  uuid, uuid, text
) to authenticated;
grant execute on function internal.request_refund(
  uuid, uuid, text, text, jsonb, jsonb, uuid
) to authenticated;
grant execute on function public.request_refund(
  uuid, uuid, text, text, jsonb, jsonb, uuid
) to authenticated;
grant execute on function internal.decide_refund_case(
  uuid, text, text, text
) to authenticated;
grant execute on function public.decide_refund_case(
  uuid, text, text, text
) to authenticated;
grant execute on function internal.authorize_refund_account_access(
  uuid, text, text
) to authenticated;
grant execute on function public.authorize_refund_account_access(
  uuid, text, text
) to authenticated;
grant execute on function internal.consume_refund_account_access(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.consume_refund_account_access(
  uuid, uuid, uuid
) to service_role;
grant execute on function internal.record_refund_disbursement(
  uuid, integer, text, uuid, text
) to authenticated;
grant execute on function public.record_refund_disbursement(
  uuid, integer, text, uuid, text
) to authenticated;
grant execute on function internal.confirm_refund_disbursement(
  uuid, text, text
) to authenticated;
grant execute on function public.confirm_refund_disbursement(
  uuid, text, text
) to authenticated;
grant execute on function internal.record_manual_invoice_result(
  uuid, text, integer, text, text, text
) to authenticated;
grant execute on function public.record_manual_invoice_result(
  uuid, text, integer, text, text, text
) to authenticated;
grant execute on function internal.register_quarantine_upload(
  uuid, uuid, text, text, text, bigint, text
) to service_role;
grant execute on function public.register_quarantine_upload(
  uuid, uuid, text, text, text, bigint, text
) to service_role;
grant execute on function internal.finish_quarantine_scan(
  uuid, boolean, text, integer, bigint, boolean, text, jsonb
) to service_role;
grant execute on function public.finish_quarantine_scan(
  uuid, boolean, text, integer, bigint, boolean, text, jsonb
) to service_role;
grant execute on function internal.read_safe_quarantine_upload(
  uuid, uuid, text
) to service_role;
grant execute on function public.read_safe_quarantine_upload(
  uuid, uuid, text
) to service_role;
grant execute on function internal.import_bank_statement_batch(
  text, text, date, integer, jsonb
) to authenticated;
grant execute on function public.import_bank_statement_batch(
  text, text, date, integer, jsonb
) to authenticated;
grant execute on function internal.reconcile_bank_statement_batch(
  uuid, text, text
) to authenticated;
grant execute on function public.reconcile_bank_statement_batch(
  uuid, text, text
) to authenticated;
grant execute on function internal.finish_durable_job(
  uuid, text, boolean, text
) to service_role;
grant execute on function public.finish_durable_job(
  uuid, text, boolean, text
) to service_role;
grant execute on function internal.lease_notification_outbox(text, integer)
  to service_role;
grant execute on function public.lease_notification_outbox(text, integer)
  to service_role;
grant execute on function internal.finish_notification_outbox(
  uuid, text, boolean, text, text
) to service_role;
grant execute on function public.finish_notification_outbox(
  uuid, text, boolean, text, text
) to service_role;
grant execute on function internal.read_notification_destination(uuid)
  to service_role;
grant execute on function public.read_notification_destination(uuid)
  to service_role;
grant execute on function internal.enqueue_due_live_reminders()
  to service_role;
grant execute on function public.enqueue_due_live_reminders()
  to service_role;
grant execute on function internal.process_provider_event(uuid, text)
  to service_role;
grant execute on function public.process_provider_event(uuid, text)
  to service_role;

-- Explicitly deny direct mutation of append-only authority to all API roles.
revoke insert, update, delete on
  public.audit_events,
  public.payment_events,
  public.bank_transactions,
  public.bank_transaction_allocations,
  public.bank_allocation_reviews,
  public.invoice_events,
  public.point_refund_cases,
  public.point_ledger_events,
  public.playback_events,
  public.confirmed_watch_blocks,
  public.learning_events,
  public.zoom_participant_events,
  public.live_client_heartbeats,
  public.check_events,
  public.live_evidence_events,
  public.attendance_corrections,
  public.attendance_correction_decisions,
  public.provider_anomaly_resolution_requests,
  public.provider_anomaly_resolution_decisions,
  public.attendance_summary_revisions,
  public.eligibility_snapshots,
  public.certificate_revisions,
  public.provider_events,
  public.notification_delivery_events
from anon, authenticated, service_role;
