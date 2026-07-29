-- Organization assignment batches are one authenticated command with
-- row-level business results. A successful row reserves points and, when
-- requested, books the live seat in the same subtransaction.

alter table public.enrollments
  add column completion_due_at timestamptz,
  add constraint enrollments_completion_due_after_creation
    check (
      completion_due_at is null
      or completion_due_at > created_at
    );

create index enrollments_open_completion_due_idx
  on public.enrollments(completion_due_at, person_id)
  where completion_due_at is not null
    and status in ('active', 'needs_correction');

grant select (completion_due_at)
  on public.enrollments to authenticated;

-- Keep the security-invoker learner projection column-compatible by appending
-- the deadline after every previously published column.
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
  version.has_cover,
  enrollment.completion_due_at
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

create or replace function internal.batch_assign_organization_course(
  target_organization uuid,
  target_members uuid[],
  target_course_version uuid,
  target_live_session uuid,
  target_completion_due_at timestamptz,
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
  version_row public.course_versions%rowtype;
  session_row public.live_sessions%rowtype;
  member_id uuid;
  assignment_result jsonb;
  assignment_id uuid;
  live_booking_id uuid;
  failure_code text;
  request_hash text;
  row_results jsonb := '[]'::jsonb;
  result jsonb;
  succeeded_count integer := 0;
  failed_count integer := 0;
  total_reserved_points bigint := 0;
begin
  if target_organization is null
     or target_course_version is null
     or idempotency is null
     or target_members is null
     or cardinality(target_members) < 1
     or cardinality(target_members) > 200
     or exists (
       select 1 from unnest(target_members) submitted(member_id)
       where submitted.member_id is null
     )
     or (
       select count(distinct submitted.member_id)
       from unnest(target_members) submitted(member_id)
     ) <> cardinality(target_members)
  then
    raise exception 'ORGANIZATION_BATCH_ASSIGNMENT_INVALID';
  end if;

  -- Lock the actor's tenant membership for the duration of the command.
  perform 1
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.organization_id
  where membership.organization_id = target_organization
    and membership.person_id = actor
    and membership.active
    and membership.role in ('owner', 'training_manager')
    and organization.status = 'approved'
  for share of membership, organization;
  if not found then
    raise exception 'ORGANIZATION_MANAGER_REQUIRED';
  end if;

  request_hash := internal.canonical_request_hash(jsonb_build_object(
    'organizationId', target_organization,
    'memberPersonIds', to_jsonb(target_members),
    'courseVersionId', target_course_version,
    'liveSessionId', target_live_session,
    'completionDueAt', target_completion_due_at
  ));

  insert into public.idempotency_records (
    actor_id, operation, idempotency_key, request_hash, locked_until
  ) values (
    actor, 'organization_batch_assignment', idempotency, request_hash,
    clock_timestamp() + interval '2 minutes'
  )
  on conflict (actor_id, operation, idempotency_key) do nothing;

  if not found then
    select record.* into prior
    from public.idempotency_records record
    where record.actor_id = actor
      and record.operation = 'organization_batch_assignment'
      and record.idempotency_key = idempotency
    for update;
    if not found
       or prior.request_hash <> request_hash
       or prior.completed_at is null
       or prior.response_body is null
    then
      raise exception 'IDEMPOTENCY_REQUEST_CONFLICT';
    end if;
    return prior.response_body;
  end if;

  if not internal.feature_is_open('organization_assignment') then
    raise exception 'ORGANIZATION_ASSIGNMENT_CLOSED';
  end if;
  if target_completion_due_at is not null
     and target_completion_due_at <= clock_timestamp()
  then
    raise exception 'COMPLETION_DEADLINE_INVALID';
  end if;

  select version.* into version_row
  from public.course_versions version
  where version.id = target_course_version
    and version.status = 'published'
    and version.commerce_close_at > clock_timestamp()
    and version.organization_point_price is not null
  for share of version;
  if not found then raise exception 'COURSE_NOT_ASSIGNABLE'; end if;

  if version_row.delivery_type = 'live'
     and target_live_session is null
  then
    raise exception 'LIVE_SESSION_REQUIRED';
  end if;

  if target_live_session is not null then
    select session.* into session_row
    from public.live_sessions session
    where session.id = target_live_session
      and session.course_version_id = target_course_version
      and session.status in ('scheduled', 'open')
      and session.booking_close_at > clock_timestamp()
      and internal.business_days_between(
        clock_timestamp(), session.starts_at
      ) >= 3
    for update of session;
    if not found then raise exception 'LIVE_SESSION_NOT_BOOKABLE'; end if;
    if target_completion_due_at is not null
       and target_completion_due_at <= session_row.ends_at
    then
      raise exception 'COMPLETION_DEADLINE_BEFORE_SESSION_END';
    end if;
  end if;

  foreach member_id in array target_members
  loop
    assignment_id := null;
    live_booking_id := null;
    failure_code := null;

    -- Tenant membership is checked and locked for every row. A UUID from a
    -- different organization therefore cannot consume this wallet.
    perform 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization
      and membership.person_id = member_id
      and membership.active
    for share of membership;
    if not found then
      failed_count := failed_count + 1;
      row_results := row_results || jsonb_build_array(jsonb_build_object(
        'memberPersonId', member_id,
        'status', 'failed',
        'assignmentId', null,
        'liveBookingId', null,
        'reservedPoints', 0,
        'errorCode', 'ORGANIZATION_MEMBER_REQUIRED'
      ));
      continue;
    end if;

    if exists (
      select 1
      from public.organization_assignments assignment
      where assignment.organization_id = target_organization
        and assignment.member_person_id = member_id
        and assignment.course_version_id = target_course_version
    ) then
      failed_count := failed_count + 1;
      row_results := row_results || jsonb_build_array(jsonb_build_object(
        'memberPersonId', member_id,
        'status', 'failed',
        'assignmentId', null,
        'liveBookingId', null,
        'reservedPoints', 0,
        'errorCode', 'DUPLICATE_ASSIGNMENT'
      ));
      continue;
    end if;

    begin
      assignment_result := internal.assign_organization_course(
        target_organization,
        member_id,
        target_course_version,
        gen_random_uuid()
      );
      assignment_id := (assignment_result ->> 'assignmentId')::uuid;

      update public.enrollments enrollment
      set completion_due_at = target_completion_due_at
      from public.entitlements entitlement
      where entitlement.id = enrollment.entitlement_id
        and entitlement.source_type = 'organization_assignment'
        and entitlement.source_id = assignment_id
        and enrollment.person_id = member_id
        and enrollment.course_version_id = target_course_version;
      if not found then
        raise exception 'ASSIGNMENT_ENROLLMENT_MISSING';
      end if;

      if target_live_session is not null then
        live_booking_id := internal.select_assignment_live_session(
          assignment_id,
          target_live_session,
          session_row.hybrid_component_id,
          gen_random_uuid()
        );
      end if;

      succeeded_count := succeeded_count + 1;
      total_reserved_points := total_reserved_points
        + (assignment_result ->> 'reservedPoints')::bigint;
      row_results := row_results || jsonb_build_array(jsonb_build_object(
        'memberPersonId', member_id,
        'status', 'assigned',
        'assignmentId', assignment_id,
        'liveBookingId', live_booking_id,
        'reservedPoints',
          (assignment_result ->> 'reservedPoints')::bigint,
        'errorCode', null
      ));
    exception
      when unique_violation then
        -- Only the expected assignment race is a row-level business failure.
        -- A unique violation from the ledger, entitlement or booking graph is
        -- an invariant breach and must abort the whole command.
        if exists (
          select 1
          from public.organization_assignments assignment
          where assignment.organization_id = target_organization
            and assignment.member_person_id = member_id
            and assignment.course_version_id = target_course_version
        ) then
          failure_code := 'DUPLICATE_ASSIGNMENT';
        else
          raise;
        end if;
      when raise_exception then
        failure_code := sqlerrm;
        if failure_code not in (
          'ORGANIZATION_MEMBER_REQUIRED',
          'DUPLICATE_ASSIGNMENT',
          'INSUFFICIENT_POINTS',
          'LIVE_SESSION_FULL',
          'LIVE_SESSION_NOT_BOOKABLE',
          'ASSIGNMENT_SESSION_SELECTION_REJECTED',
          'ASSIGNMENT_COMPONENT_MISMATCH',
          'ORGANIZATION_ASSIGNMENT_CLOSED'
        ) then
          raise;
        end if;
    end;

    if failure_code is not null then
      failed_count := failed_count + 1;
      row_results := row_results || jsonb_build_array(jsonb_build_object(
        'memberPersonId', member_id,
        'status', 'failed',
        'assignmentId', null,
        'liveBookingId', null,
        'reservedPoints', 0,
        'errorCode', failure_code
      ));
    end if;
  end loop;

  result := jsonb_build_object(
    'requestedCount', cardinality(target_members),
    'succeededCount', succeeded_count,
    'failedCount', failed_count,
    'reservedPoints', total_reserved_points,
    'courseVersionId', target_course_version,
    'liveSessionId', target_live_session,
    'completionDueAt', target_completion_due_at,
    'results', row_results
  );

  update public.idempotency_records record
  set response_status = 200,
      response_body = result,
      completed_at = clock_timestamp(),
      locked_until = null
  where record.actor_id = actor
    and record.operation = 'organization_batch_assignment'
    and record.idempotency_key = idempotency;

  perform internal.append_audit_event(
    actor,
    'organization.assignment_batch_processed',
    'organization',
    target_organization::text,
    'batch course assignment processed',
    target_organization,
    jsonb_build_object(
      'courseVersionId', target_course_version,
      'liveSessionId', target_live_session,
      'completionDueAt', target_completion_due_at,
      'requestedCount', cardinality(target_members),
      'succeededCount', succeeded_count,
      'failedCount', failed_count,
      'reservedPoints', total_reserved_points
    )
  );
  return result;
end
$$;

revoke all on function internal.batch_assign_organization_course(
  uuid, uuid[], uuid, uuid, timestamptz, uuid
) from public, anon, authenticated, service_role;

create or replace function public.batch_assign_organization_course(
  p_organization_id uuid,
  p_member_person_ids uuid[],
  p_course_version_id uuid,
  p_live_session_id uuid,
  p_completion_due_at timestamptz,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.batch_assign_organization_course(
    p_organization_id,
    p_member_person_ids,
    p_course_version_id,
    p_live_session_id,
    p_completion_due_at,
    p_idempotency_key
  )
$$;

revoke all on function public.batch_assign_organization_course(
  uuid, uuid[], uuid, uuid, timestamptz, uuid
) from public, anon, authenticated, service_role;

grant execute on function internal.batch_assign_organization_course(
  uuid, uuid[], uuid, uuid, timestamptz, uuid
) to authenticated;

grant execute on function public.batch_assign_organization_course(
  uuid, uuid[], uuid, uuid, timestamptz, uuid
) to authenticated;

-- Enrich the existing role-safe organization workspace without broadening
-- table grants. The v2 function remains the authorization boundary.
create or replace function internal.read_organization_workspace_v3(
  target_organization uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  base jsonb;
  enriched_assignments jsonb;
begin
  base := internal.read_organization_workspace_v2(target_organization);

  select coalesce(jsonb_agg(
    item.value || jsonb_build_object(
      'completionDueAt', enrollment.completion_due_at
    )
    order by item.ordinality
  ), '[]'::jsonb)
  into enriched_assignments
  from jsonb_array_elements(coalesce(base -> 'assignments', '[]'::jsonb))
    with ordinality item(value, ordinality)
  left join public.organization_assignments assignment
    on assignment.id = (item.value ->> 'assignmentId')::uuid
   and assignment.organization_id = target_organization
  left join public.entitlements entitlement
    on entitlement.source_type = 'organization_assignment'
   and entitlement.source_id = assignment.id
  left join public.enrollments enrollment
    on enrollment.entitlement_id = entitlement.id;

  return jsonb_set(
    base,
    '{assignments}',
    enriched_assignments,
    true
  );
end
$$;

revoke all on function internal.read_organization_workspace_v3(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.read_organization_workspace_v3(
  p_organization_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_organization_workspace_v3(p_organization_id)
$$;

revoke all on function public.read_organization_workspace_v3(uuid)
  from public, anon, authenticated, service_role;

grant execute on function internal.read_organization_workspace_v3(uuid)
  to authenticated;
grant execute on function public.read_organization_workspace_v3(uuid)
  to authenticated;
