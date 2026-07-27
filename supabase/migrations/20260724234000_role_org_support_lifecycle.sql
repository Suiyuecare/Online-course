-- Close the remaining role, organization-lifecycle, and support boundaries.
-- This migration is intentionally forward-only and does not touch provider
-- integration or Zoom state.

alter table public.organizations
  add column contact_name text not null default '',
  add column contact_email text not null default '',
  add column invoice_recipient text not null default '',
  add column invoice_address text not null default '',
  add constraint organization_contact_name_length
    check (length(contact_name) <= 100),
  add constraint organization_contact_email_length
    check (length(contact_email) <= 320),
  add constraint organization_invoice_recipient_length
    check (length(invoice_recipient) <= 200),
  add constraint organization_invoice_address_length
    check (length(invoice_address) <= 500);

alter table public.organization_memberships
  add column lifecycle_revision integer not null default 1
    check (lifecycle_revision > 0);

create unique index one_instructor_profile_per_person
  on public.instructors(person_id)
  where person_id is not null;

alter table public.support_cases
  add column public_reference text,
  add column last_activity_at timestamptz not null default now(),
  add column customer_last_message_at timestamptz,
  add column support_last_reply_at timestamptz,
  add column closed_at timestamptz;

update public.support_cases
set public_reference = 'SUP-' || upper(left(replace(id::text, '-', ''), 12))
where public_reference is null;

alter table public.support_cases
  alter column public_reference set default (
    'SUP-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 12))
  ),
  alter column public_reference set not null,
  add constraint support_case_reference_format
    check (public_reference ~ '^SUP-[A-F0-9]{12}$');

create unique index support_case_public_reference_unique
  on public.support_cases(public_reference);

create table public.organization_assignment_outcome_snapshots (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null
    references public.organization_assignments(id),
  organization_id uuid not null references public.organizations(id),
  member_person_id uuid not null references public.people(id),
  membership_lifecycle_revision integer not null
    check (membership_lifecycle_revision > 0),
  outcome jsonb not null,
  live_attendance jsonb not null default '[]'::jsonb,
  visibility_cutoff_at timestamptz not null,
  captured_by uuid not null references public.people(id),
  captured_at timestamptz not null default now(),
  unique (assignment_id, membership_lifecycle_revision),
  check (jsonb_typeof(outcome) = 'object'),
  check (jsonb_typeof(live_attendance) = 'array')
);

create table public.organization_member_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  member_person_id uuid not null references public.people(id),
  actor_person_id uuid not null references public.people(id),
  previous_role text not null,
  resulting_role text not null,
  previous_active boolean not null,
  resulting_active boolean not null,
  lifecycle_revision integer not null check (lifecycle_revision > 0),
  reason text not null,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (actor_person_id, idempotency_key)
);

create table public.support_case_messages (
  id uuid primary key default gen_random_uuid(),
  support_case_id uuid not null references public.support_cases(id),
  author_person_id uuid not null references public.people(id),
  author_kind text not null check (author_kind in ('customer', 'support')),
  body text not null check (length(trim(body)) between 1 and 4000),
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (author_person_id, idempotency_key)
);

create table public.support_case_events (
  id uuid primary key default gen_random_uuid(),
  support_case_id uuid not null references public.support_cases(id),
  actor_person_id uuid not null references public.people(id),
  event_type text not null check (event_type in (
    'created', 'customer_message', 'support_reply', 'assigned',
    'status_changed', 'sla_changed'
  )),
  previous_status text,
  resulting_status text,
  assigned_to uuid references public.people(id),
  response_due_at timestamptz,
  reason text not null,
  event_data jsonb not null default '{}'::jsonb,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (actor_person_id, idempotency_key),
  check (jsonb_typeof(event_data) = 'object')
);

alter table public.organization_assignment_outcome_snapshots
  enable row level security;
alter table public.organization_assignment_outcome_snapshots
  force row level security;
alter table public.organization_member_events enable row level security;
alter table public.organization_member_events force row level security;
alter table public.support_case_messages enable row level security;
alter table public.support_case_messages force row level security;
alter table public.support_case_events enable row level security;
alter table public.support_case_events force row level security;

revoke all on
  public.organization_assignment_outcome_snapshots,
  public.organization_member_events,
  public.support_case_messages,
  public.support_case_events
from public, anon, authenticated, service_role;

create trigger organization_outcome_snapshots_append_only
before update or delete on public.organization_assignment_outcome_snapshots
for each row execute function internal.prevent_append_only_change();

create trigger organization_member_events_append_only
before update or delete on public.organization_member_events
for each row execute function internal.prevent_append_only_change();

create trigger support_case_messages_append_only
before update or delete on public.support_case_messages
for each row execute function internal.prevent_append_only_change();

create trigger support_case_events_append_only
before update or delete on public.support_case_events
for each row execute function internal.prevent_append_only_change();

create or replace function internal.canonical_request_hash(payload jsonb)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select encode(extensions.digest(payload::text, 'sha256'), 'hex')
$$;
revoke all on function internal.canonical_request_hash(jsonb) from public;

create or replace function
internal.organization_assignment_has_consumption_proof(
  target_assignment uuid
)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select coalesce((
    select
      assignment.status in ('consumed', 'completed')
      and coalesce(sum(allocation.points) filter (
        where allocation.status = 'consumed'
      ), 0) = assignment.point_price_snapshot
      and count(allocation.id) filter (
        where allocation.status <> 'consumed'
      ) = 0
      and coalesce((
        select sum(event.points)
        from public.point_ledger_events event
        where event.assignment_id = assignment.id
          and event.organization_id = assignment.organization_id
          and event.event_type = 'consumed'
      ), 0) = assignment.point_price_snapshot
    from public.organization_assignments assignment
    left join public.assignment_point_allocations allocation
      on allocation.assignment_id = assignment.id
    where assignment.id = target_assignment
    group by assignment.id, assignment.status,
      assignment.point_price_snapshot
  ), false)
$$;
revoke all on function
  internal.organization_assignment_has_consumption_proof(uuid)
from public;

create or replace function
internal.consume_organization_assignment_for_enrollment(
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
  allocation public.assignment_point_allocations%rowtype;
  actor uuid;
  affected_rows integer;
  allocation_points bigint;
  non_reserved_allocations integer;
  normalized_reason text := trim(coalesce(consumption_reason, ''));
begin
  if target_enrollment is null then return false; end if;
  select assignment.* into assignment_row
  from public.enrollments enrollment
  join public.entitlements entitlement
    on entitlement.id = enrollment.entitlement_id
  join public.organization_assignments assignment
    on assignment.id = entitlement.source_id
  where enrollment.id = target_enrollment
    and entitlement.source_type = 'organization_assignment'
    and entitlement.person_id = enrollment.person_id
    and entitlement.course_version_id = enrollment.course_version_id
    and assignment.member_person_id = enrollment.person_id
    and assignment.course_version_id = enrollment.course_version_id
  for update of assignment;
  if not found then return false; end if;
  if assignment_row.status in ('consumed', 'completed') then
    if not internal.organization_assignment_has_consumption_proof(
      assignment_row.id
    )
    then
      raise exception 'ORGANIZATION_ASSIGNMENT_FUNDING_INVALID';
    end if;
    return false;
  end if;
  if assignment_row.status not in ('reserved', 'active')
     or length(normalized_reason) not between 3 and 500
  then
    raise exception 'ORGANIZATION_ASSIGNMENT_CONSUMPTION_REJECTED';
  end if;

  perform 1
  from public.organization_wallets wallet
  where wallet.organization_id = assignment_row.organization_id
  for update;
  if not found then
    raise exception 'ORGANIZATION_ASSIGNMENT_FUNDING_INVALID';
  end if;
  perform 1
  from public.assignment_point_allocations item
  where item.assignment_id = assignment_row.id
  order by item.point_lot_id
  for update;
  select
    coalesce(sum(item.points), 0),
    count(*) filter (where item.status <> 'reserved')
  into allocation_points, non_reserved_allocations
  from public.assignment_point_allocations item
  where item.assignment_id = assignment_row.id;
  if allocation_points <> assignment_row.point_price_snapshot
     or non_reserved_allocations <> 0
  then
    raise exception 'ORGANIZATION_ASSIGNMENT_FUNDING_INVALID';
  end if;

  actor := assignment_row.member_person_id;
  for allocation in
    select item.*
    from public.assignment_point_allocations item
    where item.assignment_id = assignment_row.id
      and item.status = 'reserved'
    order by item.point_lot_id
    for update
  loop
    update public.point_lots lot
    set reserved_points = lot.reserved_points - allocation.points,
        consumed_points = lot.consumed_points + allocation.points
    where lot.id = allocation.point_lot_id
      and lot.organization_id = assignment_row.organization_id
      and lot.reserved_points >= allocation.points;
    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      raise exception 'ORGANIZATION_ASSIGNMENT_FUNDING_INVALID';
    end if;
    update public.assignment_point_allocations item
    set status = 'consumed'
    where item.id = allocation.id
      and item.status = 'reserved';
    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      raise exception 'ORGANIZATION_ASSIGNMENT_FUNDING_INVALID';
    end if;
    insert into public.point_ledger_events (
      organization_id, point_lot_id, event_type, points,
      assignment_id, actor_id, idempotency_key, reason
    ) values (
      assignment_row.organization_id, allocation.point_lot_id,
      'consumed', allocation.points, assignment_row.id,
      actor, gen_random_uuid(), normalized_reason
    );
  end loop;

  update public.organization_wallets wallet
  set reserved_points =
        wallet.reserved_points - assignment_row.point_price_snapshot,
      consumed_points =
        wallet.consumed_points + assignment_row.point_price_snapshot,
      ledger_version = wallet.ledger_version + 1,
      updated_at = clock_timestamp()
  where wallet.organization_id = assignment_row.organization_id
    and wallet.reserved_points >= assignment_row.point_price_snapshot;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'ORGANIZATION_ASSIGNMENT_FUNDING_INVALID';
  end if;
  update public.organization_assignments assignment
  set status = 'consumed',
      consumed_at = coalesce(assignment.consumed_at, clock_timestamp())
  where assignment.id = assignment_row.id
    and assignment.status in ('reserved', 'active');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1
     or not internal.organization_assignment_has_consumption_proof(
       assignment_row.id
     )
  then
    raise exception 'ORGANIZATION_ASSIGNMENT_FUNDING_INVALID';
  end if;
  perform internal.append_audit_event(
    actor,
    'organization.assignment_consumed',
    'organization_assignment',
    assignment_row.id::text,
    normalized_reason,
    assignment_row.organization_id,
    jsonb_build_object(
      'points', assignment_row.point_price_snapshot,
      'previousStatus', assignment_row.status
    )
  );
  return true;
end
$$;
revoke all on function
  internal.consume_organization_assignment_for_enrollment(uuid, text)
from public;

create or replace function internal.guard_support_case_projection()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  event_identifier text;
  projection_event public.support_case_events%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'SUPPORT_CASE_DELETE_FORBIDDEN';
  end if;
  if new.id is distinct from old.id
     or new.public_reference is distinct from old.public_reference
     or new.person_id is distinct from old.person_id
     or new.organization_id is distinct from old.organization_id
     or new.kind is distinct from old.kind
     or new.priority is distinct from old.priority
     or new.summary is distinct from old.summary
     or new.created_at is distinct from old.created_at
  then
    raise exception 'SUPPORT_CASE_IDENTITY_IMMUTABLE';
  end if;

  event_identifier :=
    current_setting('app.suiyue_support_case_event_id', true);
  if coalesce(event_identifier, '') = '' then
    raise exception 'SUPPORT_CASE_EVENT_REQUIRED';
  end if;
  begin
    select event.* into projection_event
    from public.support_case_events event
    where event.id = event_identifier::uuid
      and event.support_case_id = old.id;
  exception
    when invalid_text_representation then
      raise exception 'SUPPORT_CASE_EVENT_REQUIRED';
  end;
  if not found
     or projection_event.resulting_status is distinct from new.status
     or projection_event.assigned_to is distinct from new.assigned_to
     or projection_event.response_due_at is distinct from new.response_due_at
  then
    raise exception 'SUPPORT_CASE_EVENT_REQUIRED';
  end if;
  return new;
end
$$;
revoke all on function internal.guard_support_case_projection() from public;

create trigger support_cases_projection_guard
before update or delete on public.support_cases
for each row execute function internal.guard_support_case_projection();

create or replace function
internal.guard_organization_assignment_authoritative_completion()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'completed'
     and new.status is distinct from old.status
     and (
       old.status <> 'consumed'
       or not exists (
         select 1
         from public.entitlements entitlement
         join public.enrollments enrollment
           on enrollment.entitlement_id = entitlement.id
         where entitlement.source_type = 'organization_assignment'
           and entitlement.source_id = new.id
           and entitlement.person_id = new.member_person_id
           and entitlement.course_version_id = new.course_version_id
           and entitlement.status in ('active', 'frozen', 'expired')
           and enrollment.person_id = new.member_person_id
           and enrollment.course_version_id = new.course_version_id
           and enrollment.status in ('completed', 'submitted', 'credited')
           and enrollment.completed_at is not null
       )
       or not internal.organization_assignment_has_consumption_proof(new.id)
     )
  then
    raise exception 'AUTHORITATIVE_ASSIGNMENT_COMPLETION_REQUIRED';
  end if;
  return new;
end
$$;
revoke all on function
  internal.guard_organization_assignment_authoritative_completion()
from public;

create trigger organization_assignment_completion_guard
before update of status on public.organization_assignments
for each row execute function
  internal.guard_organization_assignment_authoritative_completion();

create or replace function
internal.sync_organization_assignment_authoritative_completion()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  completed_assignment public.organization_assignments%rowtype;
begin
  if new.status not in ('completed', 'submitted', 'credited')
     or new.completed_at is null
  then
    return new;
  end if;
  update public.organization_assignments assignment
  set status = 'completed'
  from public.entitlements entitlement
  where entitlement.id = new.entitlement_id
    and entitlement.source_type = 'organization_assignment'
    and entitlement.source_id = assignment.id
    and entitlement.person_id = new.person_id
    and entitlement.course_version_id = new.course_version_id
    and assignment.member_person_id = new.person_id
    and assignment.course_version_id = new.course_version_id
    and assignment.status = 'consumed'
  returning assignment.* into completed_assignment;
  if found then
    perform internal.append_audit_event(
      null,
      'organization.assignment_completed',
      'organization_assignment',
      completed_assignment.id::text,
      'authoritative enrollment completion',
      completed_assignment.organization_id,
      jsonb_build_object('enrollmentId', new.id)
    );
  end if;
  return new;
end
$$;
revoke all on function
  internal.sync_organization_assignment_authoritative_completion()
from public;

create trigger enrollment_syncs_organization_assignment_completion
after insert or update of status, completed_at on public.enrollments
for each row execute function
  internal.sync_organization_assignment_authoritative_completion();

create or replace function internal.has_exact_staff_role(required_role text)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.staff_roles role
    where role.person_id = internal.request_person_id()
      and role.active
      and role.role in (required_role, 'platform_admin')
  )
  and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;
revoke all on function internal.has_exact_staff_role(text) from public;

create or replace function public.authorize_exact_staff_role(
  p_required_role text
)
returns boolean
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.has_exact_staff_role(p_required_role)
$$;

create or replace function internal.guard_instructor_role_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.active
     and (
       new.person_id is null
       or not exists (
       select 1
       from public.people person
       join public.staff_roles role on role.person_id = person.id
       where person.id = new.person_id
         and person.anonymized_at is null
         and role.role = 'instructor'
         and role.active
       )
     )
  then
    raise exception 'ACTIVE_INSTRUCTOR_ROLE_REQUIRED';
  end if;
  return new;
end
$$;
revoke all on function internal.guard_instructor_role_binding() from public;

create trigger instructors_require_active_role
before insert or update on public.instructors
for each row execute function internal.guard_instructor_role_binding();

create or replace function internal.guard_course_instructor_link()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.instructors instructor
    join public.staff_roles role
      on role.person_id = instructor.person_id
     and role.role = 'instructor'
     and role.active
    where instructor.id = new.instructor_id
      and instructor.active
      and instructor.person_id is not null
  )
  then
    raise exception 'ACTIVE_INSTRUCTOR_ROLE_REQUIRED';
  end if;
  return new;
end
$$;
revoke all on function internal.guard_course_instructor_link() from public;

create trigger course_instructors_require_active_role
before insert or update on public.course_instructors
for each row execute function internal.guard_course_instructor_link();

create or replace function internal.guard_course_submission_instructors()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status in ('in_review', 'published')
     and new.status is distinct from old.status
     and (
       not exists (
         select 1
         from public.course_instructors link
         join public.instructors instructor
           on instructor.id = link.instructor_id
         join public.staff_roles role
           on role.person_id = instructor.person_id
          and role.role = 'instructor'
          and role.active
         where link.course_version_id = new.id
           and instructor.active
       )
       or exists (
         select 1
         from public.course_instructors link
         join public.instructors instructor
           on instructor.id = link.instructor_id
         left join public.staff_roles role
           on role.person_id = instructor.person_id
          and role.role = 'instructor'
          and role.active
         where link.course_version_id = new.id
           and (
             not instructor.active
             or instructor.person_id is null
             or role.id is null
           )
       )
     )
  then
    raise exception 'ACTIVE_QUALIFIED_INSTRUCTOR_REQUIRED';
  end if;
  return new;
end
$$;
revoke all on function internal.guard_course_submission_instructors()
  from public;

create trigger course_submission_requires_bound_instructors
before update of status on public.course_versions
for each row execute function internal.guard_course_submission_instructors();

create or replace function internal.enforce_active_organization_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_organization uuid;
begin
  target_organization := case
    when tg_op = 'DELETE' then old.organization_id
    else new.organization_id
  end;
  perform pg_advisory_xact_lock(
    hashtextextended('organization-owner:' || target_organization::text, 0)
  );
  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization
      and membership.active
      and membership.role = 'owner'
  )
  then
    raise exception 'ACTIVE_ORGANIZATION_OWNER_REQUIRED';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
revoke all on function internal.enforce_active_organization_owner()
  from public;

create constraint trigger organization_requires_active_owner
after insert or update or delete on public.organization_memberships
deferrable initially immediate
for each row execute function internal.enforce_active_organization_owner();

create or replace function internal.read_active_instructor_options()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  if not internal.has_staff_role('course_admin') then
    raise exception 'COURSE_ADMIN_REQUIRED';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'roleId', role.id,
      'label', coalesce(
        nullif(trim(instructor.display_name), ''),
        nullif(trim(person.display_name), ''),
        '已核准講師'
      ),
      'hasProfile', instructor.id is not null,
      'displayName', coalesce(
        nullif(trim(instructor.display_name), ''),
        nullif(trim(person.display_name), ''),
        ''
      ),
      'biography', coalesce(instructor.biography, ''),
      'credentials', coalesce(instructor.credentials, '')
    ) order by coalesce(
      nullif(trim(instructor.display_name), ''),
      nullif(trim(person.display_name), ''),
      role.id::text
    ), role.id)
    from public.staff_roles role
    join public.people person on person.id = role.person_id
    left join public.instructors instructor
      on instructor.person_id = role.person_id
    where role.role = 'instructor'
      and role.active
      and person.anonymized_at is null
      and (instructor.id is null or instructor.active)
  ), '[]'::jsonb);
end
$$;
revoke all on function internal.read_active_instructor_options() from public;

create or replace function public.read_active_instructor_options()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_active_instructor_options()
$$;

create or replace function internal.bind_course_instructor(
  target_version uuid,
  target_role uuid,
  submitted_display_name text,
  submitted_biography text,
  submitted_credentials text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  role_row public.staff_roles%rowtype;
  profile_row public.instructors%rowtype;
  prior public.idempotency_records%rowtype;
  request_hash text;
  next_sort integer;
  result jsonb;
begin
  if not internal.has_staff_role('course_admin')
     or not exists (
       select 1
       from public.course_versions version
       where version.id = target_version
         and version.status = 'draft'
         and (
           version.created_by = actor
           or internal.has_staff_role('platform_admin')
         )
     )
  then
    raise exception 'COURSE_STRUCTURE_AUTHORING_REJECTED';
  end if;

  select role.* into role_row
  from public.staff_roles role
  join public.people person on person.id = role.person_id
  where role.id = target_role
    and role.role = 'instructor'
    and role.active
    and person.anonymized_at is null
  for share of role;
  if not found then raise exception 'ACTIVE_INSTRUCTOR_ROLE_REQUIRED'; end if;

  request_hash := internal.canonical_request_hash(jsonb_build_object(
    'courseVersionId', target_version,
    'instructorRoleId', target_role,
    'displayName', trim(coalesce(submitted_display_name, '')),
    'biography', trim(coalesce(submitted_biography, '')),
    'credentials', trim(coalesce(submitted_credentials, ''))
  ));
  select * into prior
  from public.idempotency_records record
  where record.actor_id = actor
    and record.operation = 'course_instructor_bind'
    and record.idempotency_key = idempotency
  for update;
  if found then
    if prior.request_hash <> request_hash
       or prior.completed_at is null
       or prior.response_body is null
    then raise exception 'IDEMPOTENCY_REQUEST_CONFLICT'; end if;
    return prior.response_body;
  end if;
  insert into public.idempotency_records (
    actor_id, operation, idempotency_key, request_hash, locked_until
  ) values (
    actor, 'course_instructor_bind', idempotency, request_hash,
    now() + interval '1 minute'
  );

  select * into profile_row
  from public.instructors instructor
  where instructor.person_id = role_row.person_id
  for update;
  if not found then
    if length(trim(coalesce(submitted_display_name, ''))) < 2
       or length(trim(coalesce(submitted_display_name, ''))) > 100
       or length(trim(coalesce(submitted_biography, ''))) < 10
       or length(trim(coalesce(submitted_biography, ''))) > 3000
       or length(trim(coalesce(submitted_credentials, ''))) < 5
       or length(trim(coalesce(submitted_credentials, ''))) > 1000
    then
      raise exception 'INSTRUCTOR_PROFILE_INVALID';
    end if;
    insert into public.instructors (
      person_id, display_name, biography, credentials, active
    ) values (
      role_row.person_id, trim(submitted_display_name),
      trim(submitted_biography), trim(submitted_credentials), true
    )
    returning * into profile_row;
  elsif not profile_row.active then
    raise exception 'ACTIVE_INSTRUCTOR_ROLE_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.course_instructors link
    where link.course_version_id = target_version
      and link.instructor_id = profile_row.id
  ) then
    select coalesce(max(link.sort_order), -1) + 1 into next_sort
    from public.course_instructors link
    where link.course_version_id = target_version;
    insert into public.course_instructors (
      course_version_id, instructor_id, sort_order
    ) values (target_version, profile_row.id, next_sort);
  end if;

  result := jsonb_build_object(
    'instructorId', profile_row.id,
    'courseVersionId', target_version,
    'displayName', profile_row.display_name
  );
  update public.idempotency_records
  set response_status = 200,
      response_body = result,
      completed_at = now(),
      locked_until = null
  where actor_id = actor
    and operation = 'course_instructor_bind'
    and idempotency_key = idempotency;
  perform internal.append_audit_event(
    actor, 'course.instructor_bound', 'course_version',
    target_version::text, 'active instructor role bound', null,
    jsonb_build_object('instructorProfileId', profile_row.id)
  );
  return result;
end
$$;
revoke all on function internal.bind_course_instructor(
  uuid, uuid, text, text, text, uuid
) from public;

create or replace function public.bind_course_instructor(
  p_course_version_id uuid,
  p_instructor_role_id uuid,
  p_display_name text,
  p_biography text,
  p_credentials text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.bind_course_instructor(
    p_course_version_id, p_instructor_role_id, p_display_name,
    p_biography, p_credentials, p_idempotency_key
  )
$$;

create or replace function internal.read_instructor_dashboard()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  profile_row public.instructors%rowtype;
begin
  if not internal.has_exact_staff_role('instructor') then
    raise exception 'INSTRUCTOR_ROLE_REQUIRED';
  end if;
  select instructor.* into profile_row
  from public.instructors instructor
  where instructor.person_id = actor
    and instructor.active;
  if not found then raise exception 'INSTRUCTOR_PROFILE_REQUIRED'; end if;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'displayName', profile_row.display_name,
      'biography', profile_row.biography,
      'credentials', profile_row.credentials
    ),
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'courseVersionId', version.id,
        'title', version.title,
        'version', version.version,
        'status', version.status,
        'deliveryType', version.delivery_type,
        'liveSessions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'liveSessionId', session.id,
            'title', session.title,
            'status', session.status,
            'startsAt', session.starts_at,
            'endsAt', session.ends_at
          ) order by session.starts_at, session.id)
          from public.live_sessions session
          where session.course_version_id = version.id
        ), '[]'::jsonb),
        'surveySummary',
          internal.read_anonymous_survey_aggregate(version.id)
      ) order by version.created_at desc, version.id)
      from public.course_instructors link
      join public.course_versions version
        on version.id = link.course_version_id
      where link.instructor_id = profile_row.id
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function internal.read_instructor_dashboard() from public;

create or replace function public.read_instructor_dashboard()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_instructor_dashboard()
$$;

create or replace function internal.organization_assignment_current_outcome(
  target_assignment uuid
)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'progressPercent', least(100, case
      when requirement.required_watch_seconds = 0 then 100
      else round(
        coalesce(progress.confirmed_valid_seconds, 0)::numeric
          * 100 / requirement.required_watch_seconds
      )::integer
    end),
    'validMinutes',
      floor(coalesce(progress.confirmed_valid_seconds, 0) / 60.0)::integer,
    'quizScore', (
      select attempt.score
      from public.quiz_attempts attempt
      where attempt.enrollment_id = enrollment.id
        and attempt.submitted_at is not null
      order by attempt.attempt_number desc
      limit 1
    ),
    'quizPassed', coalesce((
      select attempt.passed
      from public.quiz_attempts attempt
      where attempt.enrollment_id = enrollment.id
        and attempt.submitted_at is not null
      order by attempt.attempt_number desc
      limit 1
    ), false),
    'completionStatus', coalesce(enrollment.status, 'not_started'),
    'enrollmentStatus', coalesce(enrollment.status, 'not_started'),
    'accreditationStatus', coalesce(accreditation.status, 'not_started'),
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
  )
  from public.organization_assignments assignment
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
  where assignment.id = target_assignment
$$;
revoke all on function internal.organization_assignment_current_outcome(uuid)
  from public;

create or replace function internal.organization_assignment_live_attendance(
  target_assignment uuid
)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'bookingId', booking.id,
    'liveSessionId', session.id,
    'sessionTitle', session.title,
    'startsAt', session.starts_at,
    'presencePercent', attendance.presence_percent,
    'cameraPercent', attendance.camera_percent,
    'qualified', attendance.qualified
      and attendance.quarantined_at is null,
    'settledAt', attendance.settled_at,
    'quarantinedAt', attendance.quarantined_at,
    'quarantineReason', attendance.quarantine_reason
  ) order by session.starts_at, booking.id), '[]'::jsonb)
  from public.live_bookings booking
  join public.live_sessions session on session.id = booking.live_session_id
  left join public.attendance_summaries attendance
    on attendance.live_booking_id = booking.id
  where booking.payer_type = 'organization'
    and booking.payer_source_id = target_assignment
$$;
revoke all on function internal.organization_assignment_live_attendance(uuid)
  from public;

create or replace function internal.update_organization_profile(
  target_organization uuid,
  submitted_contact_name text,
  submitted_contact_email text,
  submitted_invoice_email text,
  submitted_invoice_recipient text,
  submitted_invoice_address text,
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
  request_hash text;
  result jsonb;
begin
  if not internal.has_organization_role(
    target_organization, array['owner']
  )
  then raise exception 'ORGANIZATION_OWNER_REQUIRED'; end if;
  if length(trim(coalesce(submitted_contact_name, ''))) > 100
     or length(trim(coalesce(submitted_contact_email, ''))) > 320
     or length(trim(coalesce(submitted_invoice_email, ''))) < 3
     or length(trim(coalesce(submitted_invoice_email, ''))) > 320
     or length(trim(coalesce(submitted_invoice_recipient, ''))) > 200
     or length(trim(coalesce(submitted_invoice_address, ''))) > 500
     or (
       nullif(trim(coalesce(submitted_contact_email, '')), '') is not null
       and trim(submitted_contact_email)
         !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     )
     or trim(submitted_invoice_email)
       !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then raise exception 'ORGANIZATION_PROFILE_INVALID'; end if;

  request_hash := internal.canonical_request_hash(jsonb_build_object(
    'organizationId', target_organization,
    'contactName', trim(coalesce(submitted_contact_name, '')),
    'contactEmail', lower(trim(coalesce(submitted_contact_email, ''))),
    'invoiceEmail', lower(trim(submitted_invoice_email)),
    'invoiceRecipient', trim(coalesce(submitted_invoice_recipient, '')),
    'invoiceAddress', trim(coalesce(submitted_invoice_address, ''))
  ));
  select * into prior
  from public.idempotency_records record
  where record.actor_id = actor
    and record.operation = 'organization_profile_update'
    and record.idempotency_key = idempotency
  for update;
  if found then
    if prior.request_hash <> request_hash
       or prior.response_body is null
    then raise exception 'IDEMPOTENCY_REQUEST_CONFLICT'; end if;
    return prior.response_body;
  end if;
  insert into public.idempotency_records (
    actor_id, operation, idempotency_key, request_hash, locked_until
  ) values (
    actor, 'organization_profile_update', idempotency, request_hash,
    now() + interval '1 minute'
  );

  update public.organizations
  set contact_name = trim(coalesce(submitted_contact_name, '')),
      contact_email = lower(trim(coalesce(submitted_contact_email, ''))),
      invoice_email = lower(trim(submitted_invoice_email)),
      invoice_recipient =
        trim(coalesce(submitted_invoice_recipient, '')),
      invoice_address = trim(coalesce(submitted_invoice_address, ''))
  where id = target_organization
    and status = 'approved';
  if not found then raise exception 'ORGANIZATION_PROFILE_INVALID'; end if;

  result := jsonb_build_object(
    'organizationId', target_organization,
    'updated', true
  );
  update public.idempotency_records
  set response_status = 200,
      response_body = result,
      completed_at = now(),
      locked_until = null
  where actor_id = actor
    and operation = 'organization_profile_update'
    and idempotency_key = idempotency;
  perform internal.append_audit_event(
    actor, 'organization.profile_updated', 'organization',
    target_organization::text, 'owner updated safe profile fields',
    target_organization,
    jsonb_build_object(
      'fields', jsonb_build_array(
        'contactName', 'contactEmail', 'invoiceEmail',
        'invoiceRecipient', 'invoiceAddress'
      )
    )
  );
  return result;
end
$$;
revoke all on function internal.update_organization_profile(
  uuid, text, text, text, text, text, uuid
) from public;

create or replace function public.update_organization_profile(
  p_organization_id uuid,
  p_contact_name text,
  p_contact_email text,
  p_invoice_email text,
  p_invoice_recipient text,
  p_invoice_address text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.update_organization_profile(
    p_organization_id, p_contact_name, p_contact_email,
    p_invoice_email, p_invoice_recipient, p_invoice_address,
    p_idempotency_key
  )
$$;

create or replace function internal.manage_organization_member(
  target_organization uuid,
  target_person uuid,
  submitted_role text,
  submitted_active boolean,
  submitted_employee_number text,
  submitted_department text,
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
  actor_membership public.organization_memberships%rowtype;
  target_membership public.organization_memberships%rowtype;
  prior_event public.organization_member_events%rowtype;
  request_hash text := internal.canonical_request_hash(jsonb_build_object(
    'organizationId', target_organization,
    'personId', target_person,
    'role', submitted_role,
    'active', submitted_active,
    'employeeNumber', trim(coalesce(submitted_employee_number, '')),
    'department', trim(coalesce(submitted_department, '')),
    'reason', trim(coalesce(submitted_reason, ''))
  ));
  next_revision integer;
  result jsonb;
  assignment record;
begin
  select membership.* into actor_membership
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.organization_id
  where membership.organization_id = target_organization
    and membership.person_id = actor
    and membership.active
    and organization.status = 'approved'
  for update of membership;
  if not found
     or actor_membership.role not in ('owner', 'training_manager')
  then raise exception 'ORGANIZATION_MANAGER_REQUIRED'; end if;

  select * into prior_event
  from public.organization_member_events event
  where event.actor_person_id = actor
    and event.idempotency_key = idempotency;
  if found then
    if prior_event.request_hash <> request_hash
    then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object(
      'organizationId', target_organization,
      'personId', target_person,
      'role', prior_event.resulting_role,
      'active', prior_event.resulting_active,
      'lifecycleRevision', prior_event.lifecycle_revision,
      'replayed', true
    );
  end if;

  select * into target_membership
  from public.organization_memberships membership
  where membership.organization_id = target_organization
    and membership.person_id = target_person
  for update;
  if not found
     or submitted_role not in (
       'owner', 'training_manager', 'finance', 'member'
     )
     or length(trim(coalesce(submitted_employee_number, ''))) > 100
     or length(trim(coalesce(submitted_department, ''))) > 100
     or length(trim(coalesce(submitted_reason, ''))) < 10
     or length(trim(coalesce(submitted_reason, ''))) > 2000
     or (
       actor_membership.role = 'training_manager'
       and (
         target_membership.role <> 'member'
         or submitted_role <> 'member'
       )
     )
  then raise exception 'ORGANIZATION_MEMBER_CHANGE_REJECTED'; end if;

  if target_membership.active and not submitted_active then
    if exists (
      select 1
      from public.organization_assignments assignment
      where assignment.organization_id = target_organization
        and assignment.member_person_id = target_person
        and assignment.status in ('reserved', 'active', 'consumed')
    )
    then raise exception 'ACTIVE_OR_UNSETTLED_ASSIGNMENT_BLOCKS_OFFBOARDING';
    end if;
    if exists (
      select 1
      from public.live_bookings booking
      join public.organization_assignments assignment
        on booking.payer_type = 'organization'
       and booking.payer_source_id = assignment.id
      where assignment.organization_id = target_organization
        and assignment.member_person_id = target_person
        and booking.status in ('held', 'confirmed')
    )
    then raise exception 'ACTIVE_LIVE_BOOKING_BLOCKS_OFFBOARDING'; end if;

    next_revision := target_membership.lifecycle_revision + 1;
    for assignment in
      select item.id
      from public.organization_assignments item
      where item.organization_id = target_organization
        and item.member_person_id = target_person
        and item.status = 'completed'
        and internal.organization_assignment_has_consumption_proof(item.id)
        and exists (
          select 1
          from public.entitlements entitlement
          join public.enrollments enrollment
            on enrollment.entitlement_id = entitlement.id
          where entitlement.source_type = 'organization_assignment'
            and entitlement.source_id = item.id
            and entitlement.person_id = item.member_person_id
            and entitlement.course_version_id = item.course_version_id
            and entitlement.status in ('active', 'frozen', 'expired')
            and enrollment.person_id = item.member_person_id
            and enrollment.course_version_id = item.course_version_id
            and enrollment.status in ('completed', 'submitted', 'credited')
            and enrollment.completed_at is not null
        )
      order by item.created_at, item.id
    loop
      insert into public.organization_assignment_outcome_snapshots (
        assignment_id, organization_id, member_person_id,
        membership_lifecycle_revision, outcome, live_attendance,
        visibility_cutoff_at, captured_by
      ) values (
        assignment.id, target_organization, target_person, next_revision,
        coalesce(
          internal.organization_assignment_current_outcome(assignment.id),
          '{}'::jsonb
        ),
        internal.organization_assignment_live_attendance(assignment.id),
        clock_timestamp(), actor
      );
    end loop;
  elsif target_membership.active is distinct from submitted_active then
    next_revision := target_membership.lifecycle_revision + 1;
  else
    next_revision := target_membership.lifecycle_revision;
  end if;

  update public.organization_memberships
  set role = submitted_role,
      active = submitted_active,
      employee_number =
        nullif(trim(coalesce(submitted_employee_number, '')), ''),
      department = nullif(trim(coalesce(submitted_department, '')), ''),
      lifecycle_revision = next_revision,
      left_at = case
        when submitted_active then null
        else coalesce(left_at, clock_timestamp())
      end
  where id = target_membership.id;

  insert into public.organization_member_events (
    organization_id, member_person_id, actor_person_id,
    previous_role, resulting_role, previous_active, resulting_active,
    lifecycle_revision, reason, idempotency_key, request_hash
  ) values (
    target_organization, target_person, actor,
    target_membership.role, submitted_role,
    target_membership.active, submitted_active,
    next_revision, trim(submitted_reason), idempotency, request_hash
  );
  perform internal.append_audit_event(
    actor, 'organization.member_changed', 'organization_membership',
    target_membership.id::text, trim(submitted_reason),
    target_organization,
    jsonb_build_object(
      'previousRole', target_membership.role,
      'resultingRole', submitted_role,
      'previousActive', target_membership.active,
      'resultingActive', submitted_active,
      'lifecycleRevision', next_revision
    )
  );
  result := jsonb_build_object(
    'organizationId', target_organization,
    'personId', target_person,
    'role', submitted_role,
    'active', submitted_active,
    'lifecycleRevision', next_revision,
    'replayed', false
  );
  return result;
end
$$;
revoke all on function internal.manage_organization_member(
  uuid, uuid, text, boolean, text, text, text, uuid
) from public;

create or replace function public.manage_organization_member(
  p_organization_id uuid,
  p_person_id uuid,
  p_role text,
  p_active boolean,
  p_employee_number text,
  p_department text,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.manage_organization_member(
    p_organization_id, p_person_id, p_role, p_active,
    p_employee_number, p_department, p_reason, p_idempotency_key
  )
$$;

create or replace function internal.organization_assignment_visible_outcome(
  target_assignment uuid
)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select case
    when membership.active then
      internal.organization_assignment_current_outcome(assignment.id)
    else coalesce(snapshot.outcome, jsonb_build_object(
      'progressPercent', 0,
      'validMinutes', 0,
      'quizScore', null,
      'quizPassed', false,
      'completionStatus', 'historical_unavailable',
      'enrollmentStatus', 'historical_unavailable',
      'accreditationStatus', 'historical_unavailable',
      'certificateStatus', null,
      'completedAt', null
    ))
  end
  from public.organization_assignments assignment
  join public.organization_memberships membership
    on membership.organization_id = assignment.organization_id
   and membership.person_id = assignment.member_person_id
  left join lateral (
    select stored.outcome
    from public.organization_assignment_outcome_snapshots stored
    where stored.assignment_id = assignment.id
    order by stored.membership_lifecycle_revision desc, stored.captured_at desc
    limit 1
  ) snapshot on true
  where assignment.id = target_assignment
$$;
revoke all on function internal.organization_assignment_visible_outcome(uuid)
  from public;

create or replace function
internal.organization_assignment_visible_live_attendance(
  target_assignment uuid
)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select case
    when membership.active then
      internal.organization_assignment_live_attendance(assignment.id)
    else coalesce(snapshot.live_attendance, '[]'::jsonb)
  end
  from public.organization_assignments assignment
  join public.organization_memberships membership
    on membership.organization_id = assignment.organization_id
   and membership.person_id = assignment.member_person_id
  left join lateral (
    select stored.live_attendance
    from public.organization_assignment_outcome_snapshots stored
    where stored.assignment_id = assignment.id
    order by stored.membership_lifecycle_revision desc, stored.captured_at desc
    limit 1
  ) snapshot on true
  where assignment.id = target_assignment
$$;
revoke all on function
  internal.organization_assignment_visible_live_attendance(uuid)
from public;

create or replace function internal.read_organization_workspace_v2(
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
  base jsonb;
  safe_members jsonb;
  safe_outcomes jsonb;
  profile jsonb;
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

  base := internal.read_organization_workspace_details(target_organization);
  select jsonb_build_object(
    'legalName', organization.legal_name,
    'contactName', organization.contact_name,
    'contactEmail', organization.contact_email,
    'invoiceEmail', case
      when actor_role in ('owner', 'finance')
        then organization.invoice_email
      else null
    end,
    'invoiceRecipient', case
      when actor_role in ('owner', 'finance')
        then organization.invoice_recipient
      else null
    end,
    'invoiceAddress', case
      when actor_role in ('owner', 'finance')
        then organization.invoice_address
      else null
    end
  ) into profile
  from public.organizations organization
  where organization.id = target_organization;

  if actor_role in ('owner', 'training_manager') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'personId', membership.person_id,
      'displayName', coalesce(person.display_name, '未填姓名'),
      'employeeNumber', membership.employee_number,
      'department', membership.department,
      'role', membership.role,
      'status', case when membership.active then 'active' else 'inactive' end,
      'canManage', actor_role = 'owner'
        or (
          actor_role = 'training_manager'
          and membership.role = 'member'
        ),
      'canChangeRole', actor_role = 'owner',
      'canDeactivate', membership.active
        and (
          actor_role = 'owner'
          or (
            actor_role = 'training_manager'
            and membership.role = 'member'
          )
        )
        and not exists (
          select 1
          from public.organization_assignments assignment
          where assignment.organization_id = target_organization
            and assignment.member_person_id = membership.person_id
            and assignment.status in ('reserved', 'active', 'consumed')
        )
        and not exists (
          select 1
          from public.live_bookings booking
          join public.organization_assignments assignment
            on booking.payer_type = 'organization'
           and booking.payer_source_id = assignment.id
          where assignment.organization_id = target_organization
            and assignment.member_person_id = membership.person_id
            and booking.status in ('held', 'confirmed')
        )
        and (
          membership.role <> 'owner'
          or exists (
            select 1
            from public.organization_memberships other_owner
            where other_owner.organization_id = target_organization
              and other_owner.person_id <> membership.person_id
              and other_owner.active
              and other_owner.role = 'owner'
          )
        ),
      'offboardingBlock', case
        when not membership.active then null
        when membership.role = 'owner'
          and not exists (
            select 1
            from public.organization_memberships other_owner
            where other_owner.organization_id = target_organization
              and other_owner.person_id <> membership.person_id
              and other_owner.active
              and other_owner.role = 'owner'
          ) then 'last_active_owner'
        when exists (
          select 1
          from public.organization_assignments assignment
          where assignment.organization_id = target_organization
            and assignment.member_person_id = membership.person_id
            and assignment.status in ('reserved', 'active', 'consumed')
        ) then 'active_or_unsettled_assignment'
        when exists (
          select 1
          from public.live_bookings booking
          join public.organization_assignments assignment
            on booking.payer_type = 'organization'
           and booking.payer_source_id = assignment.id
          where assignment.organization_id = target_organization
            and assignment.member_person_id = membership.person_id
            and booking.status in ('held', 'confirmed')
        ) then 'active_live_booking'
        else null
      end
    ) order by membership.active desc,
      coalesce(membership.department, ''),
      coalesce(person.display_name, ''), membership.person_id), '[]'::jsonb)
    into safe_members
    from public.organization_memberships membership
    join public.people person on person.id = membership.person_id
    where membership.organization_id = target_organization;
  else
    safe_members := '[]'::jsonb;
  end if;

  if actor_role in ('owner', 'training_manager') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'assignmentId', assignment.id,
      'memberLabel', coalesce(person.display_name, '未填姓名'),
      'courseTitle', version.title,
      'progressPercent', coalesce(
        (visible.outcome ->> 'progressPercent')::integer, 0
      ),
      'validMinutes', coalesce(
        (visible.outcome ->> 'validMinutes')::integer, 0
      ),
      'quizScore', visible.outcome -> 'quizScore',
      'completionStatus', coalesce(
        visible.outcome ->> 'completionStatus', 'not_started'
      ),
      'accreditationStatus', coalesce(
        visible.outcome ->> 'accreditationStatus', 'not_started'
      )
    ) order by assignment.created_at desc, assignment.id), '[]'::jsonb)
    into safe_outcomes
    from public.organization_assignments assignment
    join public.organization_memberships membership
      on membership.organization_id = assignment.organization_id
     and membership.person_id = assignment.member_person_id
    join public.people person on person.id = assignment.member_person_id
    join public.course_versions version
      on version.id = assignment.course_version_id
    cross join lateral (
      select internal.organization_assignment_visible_outcome(
        assignment.id
      ) as outcome
    ) visible
    where assignment.organization_id = target_organization;
  else
    safe_outcomes := '[]'::jsonb;
  end if;

  return base || jsonb_build_object(
    'organizationProfile', profile,
    'capabilities', jsonb_build_object(
      'actorRole', actor_role,
      'canEditProfile', actor_role = 'owner',
      'canManageMembers', actor_role in ('owner', 'training_manager'),
      'canManageOwnersOrFinance', actor_role = 'owner'
    ),
    'members', safe_members,
    'outcomes', safe_outcomes
  );
end
$$;
revoke all on function internal.read_organization_workspace_v2(uuid)
  from public;

create or replace function public.read_organization_workspace_v2(
  p_organization_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_organization_workspace_v2(p_organization_id)
$$;

revoke execute on function
  internal.read_organization_workspace_details(uuid)
from authenticated;
revoke execute on function
  public.read_organization_workspace_details(uuid)
from authenticated;

create or replace function internal.read_organization_training_report_v2(
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
  base jsonb;
  training_summary jsonb;
  learner_results jsonb;
  live_attendance jsonb;
begin
  base := internal.read_organization_training_report(
    target_organization, filter_course_version, filter_live_session,
    filter_department, filter_status
  );

  select coalesce(jsonb_agg(
    to_jsonb(summary_row) order by summary_row.course_title
  ), '[]'::jsonb)
  into training_summary
  from (
    select
      version.title as course_title,
      version.version as course_version,
      count(*)::integer as assigned_count,
      count(*) filter (
        where assignment.status = 'completed'
          or visible.outcome ->> 'enrollmentStatus'
            in ('completed', 'submitted', 'credited')
      )::integer as completed_count,
      count(*) filter (
        where visible.outcome ->> 'enrollmentStatus' = 'credited'
      )::integer as credited_count,
      sum(assignment.point_price_snapshot)::bigint as funded_points
    from public.organization_assignments assignment
    join public.course_versions version
      on version.id = assignment.course_version_id
    join public.organization_memberships membership
      on membership.organization_id = assignment.organization_id
     and membership.person_id = assignment.member_person_id
    cross join lateral (
      select internal.organization_assignment_visible_outcome(
        assignment.id
      ) as outcome
    ) visible
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
    group by version.id, version.title, version.version
  ) summary_row;

  select coalesce(jsonb_agg(jsonb_build_object(
    'assignmentId', assignment.id,
    'employeeNumber', membership.employee_number,
    'department', membership.department,
    'courseTitle', version.title,
    'courseVersion', version.version,
    'assignmentStatus', assignment.status,
    'enrollmentStatus', visible.outcome ->> 'enrollmentStatus',
    'validMinutes', coalesce(
      (visible.outcome ->> 'validMinutes')::numeric, 0
    ),
    'quizScore', visible.outcome -> 'quizScore',
    'quizPassed', coalesce(
      (visible.outcome ->> 'quizPassed')::boolean, false
    ),
    'certificateStatus', visible.outcome ->> 'certificateStatus',
    'completedAt', visible.outcome ->> 'completedAt'
  ) order by version.title, membership.employee_number, assignment.id),
  '[]'::jsonb)
  into learner_results
  from public.organization_assignments assignment
  join public.course_versions version
    on version.id = assignment.course_version_id
  join public.organization_memberships membership
    on membership.organization_id = assignment.organization_id
   and membership.person_id = assignment.member_person_id
  cross join lateral (
    select internal.organization_assignment_visible_outcome(
      assignment.id
    ) as outcome
  ) visible
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
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'assignmentId', attendance_row.assignment_id,
    'employeeNumber', attendance_row.employee_number,
    'department', attendance_row.department,
    'courseTitle', attendance_row.course_title,
    'sessionTitle', attendance_row.item ->> 'sessionTitle',
    'startsAt', attendance_row.item ->> 'startsAt',
    'presencePercent', attendance_row.item -> 'presencePercent',
    'cameraPercent', attendance_row.item -> 'cameraPercent',
    'qualified', coalesce(
      (attendance_row.item ->> 'qualified')::boolean, false
    ),
    'settledAt', attendance_row.item ->> 'settledAt',
    'quarantinedAt', attendance_row.item ->> 'quarantinedAt',
    'quarantineReason', attendance_row.item ->> 'quarantineReason'
  ) order by attendance_row.item ->> 'startsAt',
    attendance_row.employee_number, attendance_row.assignment_id),
  '[]'::jsonb)
  into live_attendance
  from (
    select
      assignment.id as assignment_id,
      assignment.status as assignment_status,
      assignment.course_version_id,
      membership.employee_number,
      membership.department,
      version.title as course_title,
      item.value as item
    from public.organization_assignments assignment
    join public.course_versions version
      on version.id = assignment.course_version_id
    join public.organization_memberships membership
      on membership.organization_id = assignment.organization_id
     and membership.person_id = assignment.member_person_id
    cross join lateral jsonb_array_elements(
      internal.organization_assignment_visible_live_attendance(
        assignment.id
      )
    ) item
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
        or item.value ->> 'liveSessionId' = filter_live_session::text
      )
  ) attendance_row;

  return base || jsonb_build_object(
    'trainingSummary', training_summary,
    'learnerResults', learner_results,
    'liveAttendance', live_attendance
  );
end
$$;
revoke all on function internal.read_organization_training_report_v2(
  uuid, uuid, uuid, text, text
) from public;

create or replace function public.read_organization_training_report_v2(
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
  select internal.read_organization_training_report_v2(
    p_organization_id, p_course_version_id, p_live_session_id,
    p_department, p_status
  )
$$;

revoke execute on function internal.read_organization_training_report(
  uuid, uuid, uuid, text, text
) from authenticated;
revoke execute on function public.read_organization_training_report(
  uuid, uuid, uuid, text, text
) from authenticated;

create or replace function internal.redact_support_text(submitted text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  redacted text := coalesce(submitted, '');
begin
  redacted := regexp_replace(
    redacted,
    '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}',
    '[已遮罩電子郵件]',
    'gi'
  );
  redacted := regexp_replace(
    redacted,
    '(照服員|照顧服務員|長照人員|長照認證|care[ _-]*worker)'
      || '[[:space:]:：#_-]*[[:alnum:]_.-]{4,30}',
    '[已遮罩長照人員識別碼]',
    'gi'
  );
  redacted := regexp_replace(
    redacted,
    '([A-Z][[:space:].-]*[89]([[:space:].-]*[0-9]){8})'
      || '|([A-Z][[:space:].-]*[A-D]'
      || '([[:space:].-]*[0-9]){8})',
    '[已遮罩居留識別碼]',
    'gi'
  );
  redacted := regexp_replace(
    redacted,
    '[A-Z][[:space:].-]*[12]([[:space:].-]*[0-9]){8}',
    '[已遮罩身分識別碼]',
    'gi'
  );
  redacted := regexp_replace(
    redacted,
    '[+]?(886|0)[[:space:].-]*9[0-9]'
      || '([[:space:].-]*[0-9]){7}',
    '[已遮罩行動電話]',
    'g'
  );
  redacted := regexp_replace(
    redacted,
    '[0-9]([[:space:].-]*[0-9]){7,19}',
    '[已遮罩帳號或長數字]',
    'g'
  );
  return trim(redacted);
end
$$;
revoke all on function internal.redact_support_text(text) from public;

create or replace function internal.support_safe_preview(submitted_kind text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case submitted_kind
    when 'learning' then '學習與進度案件'
    when 'live' then '直播課程案件'
    when 'order' then '訂單與匯款狀態案件'
    when 'organization' then '機構培訓案件'
    when 'account' then '帳號登入案件'
    else '其他客服案件'
  end || '；內容需透過安全補件流程'
$$;
revoke all on function internal.support_safe_preview(text) from public;

create or replace function internal.customer_can_access_support_case(
  target_case uuid
)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.support_cases support_case
    where support_case.id = target_case
      and (
        (
          support_case.organization_id is null
          and support_case.person_id = internal.request_person_id()
        )
        or (
          support_case.organization_id is not null
          and internal.has_organization_role(
            support_case.organization_id,
            array['owner', 'training_manager', 'finance']
          )
        )
      )
  )
$$;
revoke all on function
  internal.customer_can_access_support_case(uuid)
from public;

create or replace function internal.create_support_case(
  submitted_kind text,
  submitted_summary text,
  submitted_initial_message text,
  target_organization uuid,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  prior public.support_case_events%rowtype;
  case_id uuid := gen_random_uuid();
  message_id uuid := gen_random_uuid();
  public_reference text :=
    'SUP-' || upper(left(replace(case_id::text, '-', ''), 12));
  normalized_summary text := trim(coalesce(submitted_summary, ''));
  normalized_message text :=
    trim(coalesce(submitted_initial_message, ''));
  request_hash text := internal.canonical_request_hash(jsonb_build_object(
    'kind', submitted_kind,
    'summary', normalized_summary,
    'initialMessage', normalized_message,
    'organizationId', target_organization
  ));
  due_at timestamptz := internal.add_business_days(clock_timestamp(), 1);
begin
  select * into prior
  from public.support_case_events event
  where event.actor_person_id = actor
    and event.idempotency_key = idempotency;
  if found then
    if prior.event_type <> 'created'
       or prior.request_hash <> request_hash
       or not internal.customer_can_access_support_case(
         prior.support_case_id
       )
    then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object(
      'caseId', prior.support_case_id,
      'reference', (
        select support_case.public_reference
        from public.support_cases support_case
        where support_case.id = prior.support_case_id
      ),
      'replayed', true
    );
  end if;
  if submitted_kind not in (
       'learning', 'live', 'order', 'organization', 'account', 'other'
     )
     or length(normalized_summary) not between 5 and 200
     or length(normalized_message) not between 1 and 4000
     or (
       target_organization is not null
       and not internal.has_organization_role(
         target_organization,
         array['owner', 'training_manager', 'finance']
       )
     )
  then raise exception 'SUPPORT_CASE_INVALID'; end if;

  insert into public.support_cases (
    id, public_reference, person_id, organization_id, kind,
    status, priority, summary, response_due_at, last_activity_at,
    customer_last_message_at
  ) values (
    case_id, public_reference, actor, target_organization, submitted_kind,
    'open', 'normal', normalized_summary, due_at, clock_timestamp(),
    clock_timestamp()
  );
  insert into public.support_case_messages (
    id, support_case_id, author_person_id, author_kind,
    body, idempotency_key, request_hash
  ) values (
    message_id, case_id, actor, 'customer', normalized_message,
    idempotency, request_hash
  );
  insert into public.support_case_events (
    support_case_id, actor_person_id, event_type,
    resulting_status, response_due_at, reason, event_data,
    idempotency_key, request_hash
  ) values (
    case_id, actor, 'created', 'open', due_at,
    'customer created support case',
    jsonb_build_object(
      'kind', submitted_kind,
      'organizationScoped', target_organization is not null,
      'messageId', message_id
    ),
    idempotency, request_hash
  );
  perform internal.append_audit_event(
    actor, 'support.case_created', 'support_case', case_id::text,
    'customer created support case', target_organization,
    jsonb_build_object(
      'kind', submitted_kind,
      'organizationScoped', target_organization is not null
    )
  );
  return jsonb_build_object(
    'caseId', case_id,
    'reference', public_reference,
    'replayed', false
  );
end
$$;
revoke all on function internal.create_support_case(
  text, text, text, uuid, uuid
) from public;

create or replace function public.create_support_case(
  p_kind text,
  p_summary text,
  p_initial_message text,
  p_organization_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.create_support_case(
    p_kind, p_summary, p_initial_message,
    p_organization_id, p_idempotency_key
  )
$$;

create or replace function internal.append_support_case_message(
  target_case uuid,
  submitted_body text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  case_row public.support_cases%rowtype;
  prior public.support_case_messages%rowtype;
  message_id uuid := gen_random_uuid();
  event_id uuid := gen_random_uuid();
  normalized_body text := trim(coalesce(submitted_body, ''));
  request_hash text := internal.canonical_request_hash(jsonb_build_object(
    'caseId', target_case,
    'body', normalized_body
  ));
  resulting_status text;
begin
  select * into prior
  from public.support_case_messages message
  where message.author_person_id = actor
    and message.idempotency_key = idempotency;
  if found then
    if prior.support_case_id <> target_case
       or prior.author_kind <> 'customer'
       or prior.request_hash <> request_hash
       or not internal.customer_can_access_support_case(target_case)
    then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object(
      'caseId', target_case,
      'messageId', prior.id,
      'status', (
        select support_case.status
        from public.support_cases support_case
        where support_case.id = target_case
      ),
      'replayed', true
    );
  end if;
  if not internal.customer_can_access_support_case(target_case)
     or length(normalized_body) not between 1 and 4000
  then raise exception 'SUPPORT_CASE_MESSAGE_REJECTED'; end if;
  select * into case_row
  from public.support_cases support_case
  where support_case.id = target_case
  for update;
  if not found or case_row.status = 'closed' then
    raise exception 'SUPPORT_CASE_MESSAGE_REJECTED';
  end if;
  resulting_status := case
    when case_row.status in ('waiting_customer', 'resolved') then 'open'
    else case_row.status
  end;
  insert into public.support_case_messages (
    id, support_case_id, author_person_id, author_kind,
    body, idempotency_key, request_hash
  ) values (
    message_id, target_case, actor, 'customer', normalized_body,
    idempotency, request_hash
  );
  insert into public.support_case_events (
    id, support_case_id, actor_person_id, event_type,
    previous_status, resulting_status, assigned_to, response_due_at,
    reason, event_data, idempotency_key, request_hash
  ) values (
    event_id, target_case, actor, 'customer_message',
    case_row.status, resulting_status, case_row.assigned_to,
    case_row.response_due_at,
    'customer appended support message',
    jsonb_build_object('messageId', message_id),
    idempotency, request_hash
  );
  perform set_config(
    'app.suiyue_support_case_event_id', event_id::text, true
  );
  update public.support_cases
  set status = resulting_status,
      last_activity_at = clock_timestamp(),
      customer_last_message_at = clock_timestamp(),
      resolved_at = case
        when resulting_status = 'resolved' then resolved_at
        else null
      end
  where id = target_case;
  perform set_config('app.suiyue_support_case_event_id', '', true);
  perform internal.append_audit_event(
    actor, 'support.customer_message_added', 'support_case',
    target_case::text, 'customer appended support message',
    case_row.organization_id,
    jsonb_build_object('status', resulting_status)
  );
  return jsonb_build_object(
    'caseId', target_case,
    'messageId', message_id,
    'status', resulting_status,
    'replayed', false
  );
end
$$;
revoke all on function internal.append_support_case_message(
  uuid, text, uuid
) from public;

create or replace function public.append_support_case_message(
  p_support_case_id uuid,
  p_body text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.append_support_case_message(
    p_support_case_id, p_body, p_idempotency_key
  )
$$;

create or replace function internal.read_support_center()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
begin
  return jsonb_build_object(
    'organizationOptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', organization.id,
        'label', organization.legal_name
      ) order by organization.legal_name, organization.id)
      from public.organization_memberships membership
      join public.organizations organization
        on organization.id = membership.organization_id
      where membership.person_id = actor
        and membership.active
        and membership.role in ('owner', 'training_manager', 'finance')
        and organization.status = 'approved'
    ), '[]'::jsonb),
    'cases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'caseId', support_case.id,
        'reference', support_case.public_reference,
        'kind', support_case.kind,
        'summary', support_case.summary,
        'status', support_case.status,
        'priority', support_case.priority,
        'organizationScoped', support_case.organization_id is not null,
        'responseDueAt', support_case.response_due_at,
        'updatedAt', support_case.last_activity_at,
        'messages', coalesce((
          select jsonb_agg(jsonb_build_object(
            'messageId', message.id,
            'authorKind', message.author_kind,
            'body', message.body,
            'createdAt', message.created_at
          ) order by message.created_at, message.id)
          from public.support_case_messages message
          where message.support_case_id = support_case.id
        ), '[]'::jsonb)
      ) order by support_case.last_activity_at desc, support_case.id)
      from public.support_cases support_case
      where (
        support_case.organization_id is null
        and support_case.person_id = actor
      )
        or (
          support_case.organization_id is not null
          and internal.has_organization_role(
            support_case.organization_id,
            array['owner', 'training_manager', 'finance']
          )
        )
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function internal.read_support_center() from public;

create or replace function public.read_support_center()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_support_center()
$$;

create or replace function internal.read_support_queue()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
begin
  if not internal.has_exact_staff_role('support') then
    raise exception 'SUPPORT_ROLE_REQUIRED';
  end if;
  return jsonb_build_object(
    'agents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'roleId', role.id,
        'label', coalesce(nullif(trim(person.display_name), ''), '客服人員')
      ) order by coalesce(person.display_name, ''), role.id)
      from public.staff_roles role
      join public.people person on person.id = role.person_id
      where role.role = 'support'
        and role.active
        and person.anonymized_at is null
    ), '[]'::jsonb),
    'cases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'caseId', support_case.id,
        'reference', support_case.public_reference,
        'kind', support_case.kind,
        'safePreview', internal.support_safe_preview(support_case.kind),
        'status', support_case.status,
        'priority', support_case.priority,
        'scopeLabel', case
          when support_case.organization_id is null then '個人案件'
          else '機構案件'
        end,
        'requesterLabel', case
          when support_case.organization_id is null then '個人案件提出人'
          else '機構授權窗口'
        end,
        'assigned', support_case.assigned_to is not null,
        'assignedToMe', support_case.assigned_to = actor,
        'canReadThread', support_case.assigned_to = actor,
        'responseDueAt', support_case.response_due_at,
        'slaState', case
          when support_case.status in ('resolved', 'closed') then 'complete'
          when support_case.response_due_at < now() then 'overdue'
          when support_case.response_due_at <= now() + interval '4 hours'
            then 'due_soon'
          else 'on_track'
        end,
        'updatedAt', support_case.last_activity_at,
        'messages', case
          when support_case.assigned_to = actor then coalesce((
            select jsonb_agg(jsonb_build_object(
              'messageId', message.id,
              'authorKind', message.author_kind,
              'body', case message.author_kind
                when 'customer'
                  then '客戶內容需透過安全補件流程'
                else internal.redact_support_text(message.body)
              end,
              'createdAt', message.created_at
            ) order by message.created_at, message.id)
            from public.support_case_messages message
            where message.support_case_id = support_case.id
          ), '[]'::jsonb)
          else '[]'::jsonb
        end
      ) order by
        (support_case.status not in ('resolved', 'closed')) desc,
        support_case.response_due_at, support_case.last_activity_at desc,
        support_case.id), '[]'::jsonb)
      from public.support_cases support_case
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function internal.read_support_queue() from public;

create or replace function public.read_support_queue()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_support_queue()
$$;

create or replace function internal.act_on_support_case(
  target_case uuid,
  submitted_action text,
  submitted_assignee_role uuid,
  submitted_status text,
  submitted_body text,
  submitted_response_due_at timestamptz,
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
  case_row public.support_cases%rowtype;
  prior public.support_case_events%rowtype;
  assignee_person uuid;
  resulting_status text;
  resulting_assignee uuid;
  resulting_due_at timestamptz;
  message_id uuid;
  event_id uuid := gen_random_uuid();
  normalized_body text := trim(coalesce(submitted_body, ''));
  normalized_reason text := trim(coalesce(submitted_reason, ''));
  request_hash text := internal.canonical_request_hash(jsonb_build_object(
    'caseId', target_case,
    'action', submitted_action,
    'assigneeRoleId', submitted_assignee_role,
    'status', submitted_status,
    'body', normalized_body,
    'responseDueAt', submitted_response_due_at,
    'reason', normalized_reason
  ));
begin
  if not internal.has_exact_staff_role('support') then
    raise exception 'SUPPORT_ROLE_REQUIRED';
  end if;
  select * into prior
  from public.support_case_events event
  where event.actor_person_id = actor
    and event.idempotency_key = idempotency;
  if found then
    if prior.support_case_id <> target_case
       or prior.request_hash <> request_hash
    then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object(
      'caseId', target_case,
      'status', prior.resulting_status,
      'responseDueAt', prior.response_due_at,
      'replayed', true
    );
  end if;
  select * into case_row
  from public.support_cases support_case
  where support_case.id = target_case
  for update;
  if not found
     or submitted_action not in ('assign', 'reply', 'status', 'sla')
     or length(normalized_reason) < 5
     or length(normalized_reason) > 2000
  then raise exception 'SUPPORT_ACTION_REJECTED'; end if;

  resulting_status := case_row.status;
  resulting_assignee := case_row.assigned_to;
  resulting_due_at := case_row.response_due_at;

  if submitted_action = 'assign' then
    select role.person_id into assignee_person
    from public.staff_roles role
    join public.people person on person.id = role.person_id
    where role.id = submitted_assignee_role
      and role.role = 'support'
      and role.active
      and person.anonymized_at is null;
    if assignee_person is null then
      raise exception 'ACTIVE_SUPPORT_ASSIGNEE_REQUIRED';
    end if;
    resulting_assignee := assignee_person;
  elsif submitted_action = 'reply' then
    if case_row.assigned_to <> actor
       or case_row.status = 'closed'
       or length(normalized_body) not between 1 and 4000
    then raise exception 'ASSIGNED_SUPPORT_REPLY_REQUIRED'; end if;
    message_id := gen_random_uuid();
    insert into public.support_case_messages (
      id, support_case_id, author_person_id, author_kind,
      body, idempotency_key, request_hash
    ) values (
      message_id, target_case, actor, 'support', normalized_body,
      idempotency, request_hash
    );
    resulting_status := 'waiting_customer';
  elsif submitted_action = 'status' then
    if case_row.assigned_to <> actor
       or submitted_status not in (
         'open', 'investigating', 'waiting_customer', 'resolved', 'closed'
       )
    then raise exception 'ASSIGNED_SUPPORT_STATUS_REQUIRED'; end if;
    resulting_status := submitted_status;
  else
    if case_row.assigned_to <> actor
       or submitted_response_due_at is null
       or submitted_response_due_at <= clock_timestamp()
       or submitted_response_due_at >
         clock_timestamp() + interval '15 days'
       or case_row.status in ('resolved', 'closed')
    then raise exception 'ASSIGNED_SUPPORT_SLA_REQUIRED'; end if;
    resulting_due_at := submitted_response_due_at;
  end if;

  insert into public.support_case_events (
    id, support_case_id, actor_person_id, event_type,
    previous_status, resulting_status, assigned_to, response_due_at,
    reason, event_data, idempotency_key, request_hash
  ) values (
    event_id, target_case, actor, case submitted_action
      when 'assign' then 'assigned'
      when 'reply' then 'support_reply'
      when 'status' then 'status_changed'
      else 'sla_changed'
    end,
    case_row.status, resulting_status, resulting_assignee, resulting_due_at,
    normalized_reason,
    case when message_id is null then '{}'::jsonb
      else jsonb_build_object('messageId', message_id)
    end,
    idempotency, request_hash
  );
  perform set_config(
    'app.suiyue_support_case_event_id', event_id::text, true
  );
  update public.support_cases
  set assigned_to = resulting_assignee,
      status = resulting_status,
      response_due_at = resulting_due_at,
      last_activity_at = clock_timestamp(),
      support_last_reply_at = case
        when submitted_action = 'reply' then clock_timestamp()
        else support_last_reply_at
      end,
      resolved_at = case
        when resulting_status = 'resolved'
          then coalesce(resolved_at, clock_timestamp())
        when resulting_status not in ('resolved', 'closed') then null
        else resolved_at
      end,
      closed_at = case
        when resulting_status = 'closed'
          then coalesce(closed_at, clock_timestamp())
        else null
      end
  where id = target_case;
  perform set_config('app.suiyue_support_case_event_id', '', true);
  perform internal.append_audit_event(
    actor, 'support.' || submitted_action, 'support_case',
    target_case::text, normalized_reason, case_row.organization_id,
    jsonb_build_object(
      'previousStatus', case_row.status,
      'resultingStatus', resulting_status,
      'assigned', resulting_assignee is not null,
      'responseDueAt', resulting_due_at
    )
  );
  return jsonb_build_object(
    'caseId', target_case,
    'status', resulting_status,
    'responseDueAt', resulting_due_at,
    'replayed', false
  );
end
$$;
revoke all on function internal.act_on_support_case(
  uuid, text, uuid, text, text, timestamptz, text, uuid
) from public;

create or replace function public.act_on_support_case(
  p_support_case_id uuid,
  p_action text,
  p_assignee_role_id uuid,
  p_status text,
  p_body text,
  p_response_due_at timestamptz,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.act_on_support_case(
    p_support_case_id, p_action, p_assignee_role_id, p_status,
    p_body, p_response_due_at, p_reason, p_idempotency_key
  )
$$;

alter default privileges in schema public
  revoke execute on functions
  from public, anon, authenticated, service_role;

revoke all on function public.authorize_exact_staff_role(text)
  from public, anon, authenticated, service_role;
revoke all on function public.read_active_instructor_options()
  from public, anon, authenticated, service_role;
revoke all on function public.bind_course_instructor(
  uuid, uuid, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.read_instructor_dashboard()
  from public, anon, authenticated, service_role;
revoke all on function public.update_organization_profile(
  uuid, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.manage_organization_member(
  uuid, uuid, text, boolean, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.read_organization_workspace_v2(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.read_organization_training_report_v2(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.create_support_case(
  text, text, text, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.append_support_case_message(
  uuid, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.read_support_center()
  from public, anon, authenticated, service_role;
revoke all on function public.read_support_queue()
  from public, anon, authenticated, service_role;
revoke all on function public.act_on_support_case(
  uuid, text, uuid, text, text, timestamptz, text, uuid
) from public, anon, authenticated, service_role;

grant execute on function internal.read_active_instructor_options()
  to authenticated;
grant execute on function internal.has_exact_staff_role(text)
  to authenticated;
grant execute on function public.authorize_exact_staff_role(text)
  to authenticated;
grant execute on function public.read_active_instructor_options()
  to authenticated;
grant execute on function internal.bind_course_instructor(
  uuid, uuid, text, text, text, uuid
) to authenticated;
grant execute on function public.bind_course_instructor(
  uuid, uuid, text, text, text, uuid
) to authenticated;
grant execute on function internal.read_instructor_dashboard()
  to authenticated;
grant execute on function public.read_instructor_dashboard()
  to authenticated;

grant execute on function internal.update_organization_profile(
  uuid, text, text, text, text, text, uuid
) to authenticated;
grant execute on function public.update_organization_profile(
  uuid, text, text, text, text, text, uuid
) to authenticated;
grant execute on function internal.manage_organization_member(
  uuid, uuid, text, boolean, text, text, text, uuid
) to authenticated;
grant execute on function public.manage_organization_member(
  uuid, uuid, text, boolean, text, text, text, uuid
) to authenticated;
grant execute on function internal.read_organization_workspace_v2(uuid)
  to authenticated;
grant execute on function public.read_organization_workspace_v2(uuid)
  to authenticated;
grant execute on function internal.read_organization_training_report_v2(
  uuid, uuid, uuid, text, text
) to authenticated;
grant execute on function public.read_organization_training_report_v2(
  uuid, uuid, uuid, text, text
) to authenticated;

grant execute on function internal.create_support_case(
  text, text, text, uuid, uuid
) to authenticated;
grant execute on function public.create_support_case(
  text, text, text, uuid, uuid
) to authenticated;
grant execute on function internal.append_support_case_message(
  uuid, text, uuid
) to authenticated;
grant execute on function public.append_support_case_message(
  uuid, text, uuid
) to authenticated;
grant execute on function internal.read_support_center()
  to authenticated;
grant execute on function public.read_support_center()
  to authenticated;
grant execute on function internal.read_support_queue()
  to authenticated;
grant execute on function public.read_support_queue()
  to authenticated;
grant execute on function internal.act_on_support_case(
  uuid, text, uuid, text, text, timestamptz, text, uuid
) to authenticated;
grant execute on function public.act_on_support_case(
  uuid, text, uuid, text, text, timestamptz, text, uuid
) to authenticated;

revoke insert, update, delete on
  public.organization_assignment_outcome_snapshots,
  public.organization_member_events,
  public.support_case_messages,
  public.support_case_events
from anon, authenticated, service_role;

revoke insert, update, delete on public.support_cases
from public, anon, authenticated, service_role;
