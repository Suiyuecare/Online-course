-- Operations Control Plane v2
-- Ordered after the complete pre-launch schema chain.
--
-- Adds safe legal metadata, a role-scoped audit projection, SLA escalation
-- evidence, and retention dry-runs. No function in this migration deletes
-- protected data, sends an external notification, or performs a provider call.

create table public.sla_escalation_events (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null
    check (source_kind in ('support_case', 'refund_case')),
  source_id uuid not null,
  deadline_at timestamptz not null,
  severity text not null check (severity in ('due_soon', 'overdue')),
  durable_job_id uuid not null unique references public.durable_jobs(id),
  created_at timestamptz not null default now(),
  unique (source_kind, source_id, deadline_at, severity)
);

create table public.retention_dry_run_requests (
  id uuid primary key default gen_random_uuid(),
  retention_policy_revision_id uuid not null
    references public.retention_policy_revisions(id),
  data_class text not null,
  cutoff_at timestamptz not null,
  candidate_count bigint not null check (candidate_count >= 0),
  candidate_digest text not null check (candidate_digest ~ '^[a-f0-9]{64}$'),
  requested_by uuid not null references public.people(id),
  reason text not null check (length(trim(reason)) between 10 and 1000),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (requested_by, idempotency_key)
);

create table public.retention_dry_run_decisions (
  id uuid primary key default gen_random_uuid(),
  dry_run_request_id uuid not null unique
    references public.retention_dry_run_requests(id),
  operations_evidence_event_id uuid not null unique
    references public.operations_evidence_events(id),
  reviewer_id uuid not null references public.people(id),
  decision text not null check (decision in ('approve', 'reject')),
  reason text not null check (length(trim(reason)) between 10 and 1000),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_reference text not null
    check (length(trim(evidence_reference)) between 3 and 500),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (reviewer_id, idempotency_key)
);

alter table public.operations_evidence_events
  drop constraint operations_evidence_events_evidence_kind_check,
  add constraint operations_evidence_events_evidence_kind_check
  check (evidence_kind in (
    'storage_manifest_registered',
    'storage_restore_verified',
    'archive_reload_verified',
    'deletion_tombstones_replayed',
    'audit_chain_verified',
    'database_backup_manifest_registered',
    'database_restore_verified',
    'retention_candidate_manifest_verified'
  )),
  drop constraint operations_evidence_events_target_type_check,
  add constraint operations_evidence_events_target_type_check
  check (target_type in (
    'storage_bucket', 'archive_manifest', 'deletion_manifest',
    'audit_checkpoint', 'database', 'retention_dry_run'
  ));

create index support_cases_sla_scan_idx
  on public.support_cases(response_due_at, id)
  where status not in ('resolved', 'closed');
create index refund_cases_sla_scan_idx
  on public.refund_cases(submitted_at, id)
  where status not in ('completed', 'rejected');
create index sla_escalation_events_source_idx
  on public.sla_escalation_events(
    source_kind, source_id, deadline_at desc, created_at desc
  );
create index retention_dry_run_requests_policy_idx
  on public.retention_dry_run_requests(
    retention_policy_revision_id, created_at desc
  );

alter table public.sla_escalation_events enable row level security;
alter table public.sla_escalation_events force row level security;
alter table public.retention_dry_run_requests enable row level security;
alter table public.retention_dry_run_requests force row level security;
alter table public.retention_dry_run_decisions enable row level security;
alter table public.retention_dry_run_decisions force row level security;

revoke all on table public.sla_escalation_events
  from public, anon, authenticated, service_role;
revoke all on table public.retention_dry_run_requests
  from public, anon, authenticated, service_role;
revoke all on table public.retention_dry_run_decisions
  from public, anon, authenticated, service_role;

create trigger sla_escalation_events_append_only
before update or delete on public.sla_escalation_events
for each row execute function internal.prevent_append_only_change();

create trigger retention_dry_run_requests_append_only
before update or delete on public.retention_dry_run_requests
for each row execute function internal.prevent_append_only_change();

create trigger retention_dry_run_decisions_append_only
before update or delete on public.retention_dry_run_decisions
for each row execute function internal.prevent_append_only_change();

-- Public legal metadata is deliberately narrower than legal_documents. It
-- returns only the currently effective, legal-approved revision per kind and
-- never exposes object paths or prerequisite specifications.
create or replace function internal.read_effective_legal_center()
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'documentId', effective.id,
    'kind', effective.kind,
    'revision', effective.revision,
    'contentSha256', effective.content_sha256,
    'effectiveAt', effective.effective_at,
    'downloadPath', '/api/legal/documents/' || effective.id::text
  ) order by effective.kind), '[]'::jsonb)
  from (
    select distinct on (document.kind)
      document.id,
      document.kind,
      document.revision,
      document.content_sha256,
      document.effective_at
    from public.legal_documents document
    where document.approved_by_legal
      and document.effective_at is not null
      and document.effective_at <= now()
      and (
        document.superseded_at is null
        or document.superseded_at > now()
      )
    order by
      document.kind,
      document.effective_at desc,
      document.revision desc,
      document.id
  ) effective
$$;

revoke all on function internal.read_effective_legal_center()
  from public, anon, authenticated, service_role;
grant execute on function internal.read_effective_legal_center()
  to authenticated, service_role, suiyue_catalog_owner;
grant usage on schema internal to suiyue_catalog_owner;

create or replace function public.read_effective_legal_center()
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, internal
as $$
  select internal.read_effective_legal_center()
$$;

grant create on schema public to suiyue_catalog_owner;
alter function public.read_effective_legal_center()
  owner to suiyue_catalog_owner;
revoke create on schema public from suiyue_catalog_owner;
revoke all on function public.read_effective_legal_center()
  from public, anon, authenticated, service_role;
grant execute on function public.read_effective_legal_center()
  to anon, authenticated, service_role;

create or replace function internal.read_staff_audit_events(
  submitted_action_prefix text,
  submitted_target_type text,
  cursor_before bigint,
  submitted_limit integer
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  normalized_action text :=
    nullif(lower(trim(submitted_action_prefix)), '');
  normalized_target text :=
    nullif(lower(trim(submitted_target_type)), '');
  effective_limit integer :=
    least(greatest(coalesce(submitted_limit, 25), 1), 100);
  items jsonb;
  next_cursor text;
begin
  if not internal.has_staff_role('platform_admin')
     or (
       normalized_action is not null
       and (
         length(normalized_action) > 80
         or normalized_action !~ '^[a-z0-9_.-]+$'
       )
     )
     or (
       normalized_target is not null
       and (
         length(normalized_target) > 80
         or normalized_target !~ '^[a-z0-9_.-]+$'
       )
     )
     or cursor_before is not null and cursor_before <= 0
  then
    raise exception 'AUDIT_EXPLORER_REJECTED';
  end if;

  with selected as (
    select
      event.sequence,
      event.action,
      event.target_type,
      left(encode(extensions.digest(
        event.target_type || '|' || event.target_id,
        'sha256'
      ), 'hex'), 16) as target_reference,
      case
        when event.actor_id is null then 'system'
        else 'identified_actor'
      end
        as actor_kind,
      event.organization_id is not null as organization_scoped,
      event.reason is not null as has_reason,
      event.event_hash,
      event.occurred_at
    from public.audit_events event
    where (
        normalized_action is null
        or left(lower(event.action), length(normalized_action))
          = normalized_action
      )
      and (
        normalized_target is null
        or lower(event.target_type) = normalized_target
      )
      and (
        cursor_before is null
        or event.sequence < cursor_before
      )
    order by event.sequence desc
    limit effective_limit + 1
  ),
  visible as (
    select *
    from selected
    order by sequence desc
    limit effective_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'sequence', visible.sequence::text,
      'action', visible.action,
      'targetType', visible.target_type,
      'targetReference', visible.target_reference,
      'actorKind', visible.actor_kind,
      'organizationScoped', visible.organization_scoped,
      'hasReason', visible.has_reason,
      'eventHash', visible.event_hash,
      'occurredAt', visible.occurred_at
    ) order by visible.sequence desc), '[]'::jsonb),
    case
      when (select count(*) from selected) > effective_limit
      then (select min(sequence)::text from visible)
      else null
    end
  into items, next_cursor
  from visible;

  return jsonb_build_object(
    'items', items,
    'nextCursor', next_cursor,
    'filters', jsonb_build_object(
      'actionPrefix', normalized_action,
      'targetType', normalized_target
    )
  );
end
$$;

revoke all on function internal.read_staff_audit_events(
  text, text, bigint, integer
) from public, anon, authenticated, service_role;
grant execute on function internal.read_staff_audit_events(
  text, text, bigint, integer
) to authenticated;

create or replace function public.read_staff_audit_events(
  p_action_prefix text,
  p_target_type text,
  p_cursor_before bigint,
  p_limit integer
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_staff_audit_events(
    p_action_prefix, p_target_type, p_cursor_before, p_limit
  )
$$;

revoke all on function public.read_staff_audit_events(
  text, text, bigint, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_staff_audit_events(
  text, text, bigint, integer
) to authenticated;

create or replace function internal.read_staff_sla_workspace(
  submitted_scope text,
  cursor_deadline timestamptz,
  cursor_reference text,
  submitted_limit integer
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  can_support boolean :=
    internal.has_exact_staff_role('support')
    or internal.has_staff_role('platform_admin');
  can_refund boolean :=
    internal.has_exact_staff_role('finance')
    or internal.has_staff_role('platform_admin');
  effective_limit integer :=
    least(greatest(coalesce(submitted_limit, 50), 1), 100);
  items jsonb;
  next_cursor jsonb;
begin
  if submitted_scope not in ('support', 'refund', 'all')
     or (submitted_scope = 'support' and not can_support)
     or (submitted_scope = 'refund' and not can_refund)
     or (
       submitted_scope = 'all'
       and not internal.has_staff_role('platform_admin')
     )
     or ((cursor_deadline is null) <> (cursor_reference is null))
     or (
       cursor_reference is not null
       and cursor_reference !~ '^(SUP|REF)-[A-F0-9]{12}$'
     )
  then
    raise exception 'SLA_WORKSPACE_REJECTED';
  end if;

  with sla_items as (
    select
      'support_case'::text as source_kind,
      support_case.id as source_id,
      support_case.public_reference as reference,
      support_case.kind as category,
      support_case.status,
      support_case.priority,
      support_case.response_due_at as deadline_at,
      support_case.assigned_to is not null as assigned
    from public.support_cases support_case
    where submitted_scope in ('support', 'all')
      and support_case.status not in ('resolved', 'closed')
    union all
    select
      'refund_case'::text,
      refund.id,
      'REF-' || upper(left(encode(extensions.digest(
        refund.id::text, 'sha256'
      ), 'hex'), 12)),
      refund.basis,
      refund.status,
      case
        when refund.status = 'failed' then 'critical'
        when refund.status in ('approved', 'disbursing',
          'partially_disbursed') then 'high'
        else 'normal'
      end,
      refund.submitted_at + interval '15 days',
      refund.decided_at is not null
    from public.refund_cases refund
    where submitted_scope in ('refund', 'all')
      and refund.status not in ('completed', 'rejected')
  ),
  selected as (
    select *
    from sla_items
    where cursor_deadline is null
      or (deadline_at, reference) > (cursor_deadline, cursor_reference)
    order by deadline_at, reference
    limit effective_limit + 1
  ),
  visible as (
    select *
    from selected
    order by deadline_at, reference
    limit effective_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'sourceKind', item.source_kind,
      'reference', item.reference,
      'category', item.category,
      'status', item.status,
      'priority', item.priority,
      'deadlineAt', item.deadline_at,
      'slaState', case
        when item.deadline_at < now() then 'overdue'
        when item.deadline_at <= now() + case
          when item.source_kind = 'support_case' then interval '4 hours'
          else interval '24 hours'
        end
          then 'due_soon'
        else 'on_track'
      end,
      'assigned', item.assigned,
      'latestEscalationAt', (
        select max(event.created_at)
        from public.sla_escalation_events event
        where event.source_kind = item.source_kind
          and event.source_id = item.source_id
      )
    ) order by item.deadline_at, item.reference), '[]'::jsonb),
    case
      when (select count(*) from selected) > effective_limit
      then (
        select jsonb_build_object(
          'deadlineAt', cursor_item.deadline_at,
          'reference', cursor_item.reference
        )
        from visible cursor_item
        order by cursor_item.deadline_at desc, cursor_item.reference desc
        limit 1
      )
      else null
    end
  into items, next_cursor
  from visible item;

  return jsonb_build_object(
    'generatedAt', now(),
    'items', items,
    'nextCursor', next_cursor
  );
end
$$;

revoke all on function internal.read_staff_sla_workspace(
  text, timestamptz, text, integer
)
  from public, anon, authenticated, service_role;
grant execute on function internal.read_staff_sla_workspace(
  text, timestamptz, text, integer
)
  to authenticated;

create or replace function public.read_staff_sla_workspace(
  p_scope text,
  p_cursor_deadline timestamptz default null,
  p_cursor_reference text default null,
  p_limit integer default 50
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_staff_sla_workspace(
    p_scope, p_cursor_deadline, p_cursor_reference, p_limit
  )
$$;

revoke all on function public.read_staff_sla_workspace(
  text, timestamptz, text, integer
)
  from public, anon, authenticated, service_role;
grant execute on function public.read_staff_sla_workspace(
  text, timestamptz, text, integer
)
  to authenticated;

create or replace function internal.enqueue_due_sla_escalations()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  inserted_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  with due as (
    select
      'support_case'::text as source_kind,
      support_case.id as source_id,
      support_case.response_due_at as deadline_at,
      case
        when support_case.response_due_at < now() then 'overdue'
        else 'due_soon'
      end as severity
    from public.support_cases support_case
    where support_case.status not in ('resolved', 'closed')
      and support_case.response_due_at <= now() + interval '4 hours'
    union all
    select
      'refund_case'::text,
      refund.id,
      refund.submitted_at + interval '15 days',
      case
        when refund.submitted_at + interval '15 days' < now()
          then 'overdue'
        else 'due_soon'
      end
    from public.refund_cases refund
    where refund.status not in ('completed', 'rejected')
      and refund.submitted_at + interval '15 days'
        <= now() + interval '24 hours'
  )
  insert into public.durable_jobs (
    job_type, business_key, payload, available_at
  )
  select
    'sla_escalation_record',
    'sla:' || due.source_kind || ':' || due.source_id::text || ':' ||
      left(encode(extensions.digest(
        due.deadline_at::text, 'sha256'
      ), 'hex'), 16) || ':' || due.severity,
    jsonb_build_object(
      'sourceKind', due.source_kind,
      'sourceId', due.source_id,
      'deadlineAt', due.deadline_at,
      'severity', due.severity
    ),
    now()
  from due
  on conflict (business_key) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end
$$;

revoke all on function internal.enqueue_due_sla_escalations()
  from public, anon, authenticated, service_role;
grant execute on function internal.enqueue_due_sla_escalations()
  to service_role;

create or replace function public.enqueue_due_sla_escalations()
returns integer
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.enqueue_due_sla_escalations()
$$;

revoke all on function public.enqueue_due_sla_escalations()
  from public, anon, authenticated, service_role;
grant execute on function public.enqueue_due_sla_escalations()
  to service_role;

create or replace function internal.record_sla_escalation(
  target_job uuid,
  worker_id text,
  expected_lease_generation bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  job public.durable_jobs%rowtype;
  source_kind text;
  source_id uuid;
  submitted_deadline timestamptz;
  submitted_severity text;
  current_deadline timestamptz;
  actionable boolean := false;
  event_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  select candidate.* into job
  from public.durable_jobs candidate
  where candidate.id = target_job
    and candidate.job_type = 'sla_escalation_record'
    and candidate.status = 'leased'
    and candidate.lease_owner = worker_id
    and candidate.lease_generation = expected_lease_generation
    and candidate.lease_expires_at > now()
  for update;
  if not found then
    raise exception 'SLA_JOB_LEASE_MISMATCH';
  end if;

  source_kind := job.payload ->> 'sourceKind';
  source_id := (job.payload ->> 'sourceId')::uuid;
  submitted_deadline := (job.payload ->> 'deadlineAt')::timestamptz;
  submitted_severity := job.payload ->> 'severity';

  if source_kind = 'support_case' then
    select support_case.response_due_at,
      support_case.status not in ('resolved', 'closed')
    into current_deadline, actionable
    from public.support_cases support_case
    where support_case.id = source_id;
  elsif source_kind = 'refund_case' then
    select refund.submitted_at + interval '15 days',
      refund.status not in ('completed', 'rejected')
    into current_deadline, actionable
    from public.refund_cases refund
    where refund.id = source_id;
  else
    raise exception 'SLA_JOB_PAYLOAD_INVALID';
  end if;

  actionable := coalesce(actionable, false)
    and current_deadline = submitted_deadline
    and submitted_severity in ('due_soon', 'overdue')
    and (
      (submitted_severity = 'overdue' and current_deadline < now())
      or (
        submitted_severity = 'due_soon'
        and current_deadline >= now()
        and current_deadline <= now() + case
          when source_kind = 'support_case' then interval '4 hours'
          else interval '24 hours'
        end
      )
    );

  if not actionable then
    return false;
  end if;

  insert into public.sla_escalation_events (
    source_kind, source_id, deadline_at, severity, durable_job_id
  ) values (
    source_kind, source_id, submitted_deadline,
    submitted_severity, job.id
  )
  on conflict (
    source_kind, source_id, deadline_at, severity
  ) do nothing
  returning id into event_id;

  if event_id is not null then
    perform internal.append_audit_event(
      null, 'operations.sla_' || submitted_severity,
      source_kind, source_id::text,
      'automatic SLA evidence record', null,
      jsonb_build_object(
        'deadlineAt', submitted_deadline,
        'severity', submitted_severity,
        'externalNotificationSent', false
      )
    );
  end if;
  return true;
end
$$;

revoke all on function internal.record_sla_escalation(
  uuid, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function internal.record_sla_escalation(
  uuid, text, bigint
) to service_role;

create or replace function public.record_sla_escalation(
  p_job_id uuid,
  p_worker_id text,
  p_lease_generation bigint
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.record_sla_escalation(
    p_job_id, p_worker_id, p_lease_generation
  )
$$;

revoke all on function public.record_sla_escalation(
  uuid, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.record_sla_escalation(
  uuid, text, bigint
) to service_role;

create or replace function internal.retention_candidate_summary(
  submitted_data_class text,
  submitted_cutoff timestamptz
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  candidate_count bigint;
  candidate_manifest_sha256 text;
begin
  case submitted_data_class
    when 'support_cases' then
      select count(*), encode(extensions.digest(
        coalesce(string_agg(
          support_case.id::text, E'\n' order by support_case.id
        ), ''),
        'sha256'
      ), 'hex')
      into candidate_count, candidate_manifest_sha256
      from public.support_cases support_case
      where support_case.status = 'closed'
        and support_case.closed_at < submitted_cutoff;
    when 'provider_events' then
      select count(*), encode(extensions.digest(
        coalesce(string_agg(event.id::text, E'\n' order by event.id), ''),
        'sha256'
      ), 'hex')
      into candidate_count, candidate_manifest_sha256
      from public.provider_events event
      where event.processed_at is not null
        and event.received_at < submitted_cutoff;
    when 'notification_delivery_events' then
      select count(*), encode(extensions.digest(
        coalesce(string_agg(event.id::text, E'\n' order by event.id), ''),
        'sha256'
      ), 'hex')
      into candidate_count, candidate_manifest_sha256
      from public.notification_delivery_events event
      where event.created_at < submitted_cutoff;
    when 'idempotency_records' then
      select count(*), encode(extensions.digest(
        coalesce(string_agg(record.id::text, E'\n' order by record.id), ''),
        'sha256'
      ), 'hex')
      into candidate_count, candidate_manifest_sha256
      from public.idempotency_records record
      where record.completed_at is not null
        and record.created_at < submitted_cutoff;
    when 'audit_events' then
      select count(*), encode(extensions.digest(
        coalesce(string_agg(
          event.sequence::text, E'\n' order by event.sequence
        ), ''),
        'sha256'
      ), 'hex')
      into candidate_count, candidate_manifest_sha256
      from public.audit_events event
      where event.occurred_at < submitted_cutoff;
    when 'notifications' then
      select count(*), encode(extensions.digest(
        coalesce(string_agg(
          notification.id::text, E'\n' order by notification.id
        ), ''),
        'sha256'
      ), 'hex')
      into candidate_count, candidate_manifest_sha256
      from public.notifications notification
      where notification.read_at is not null
        and notification.created_at < submitted_cutoff;
    else
      raise exception 'RETENTION_DATA_CLASS_UNSUPPORTED';
  end case;

  return jsonb_build_object(
    'candidateCount', candidate_count,
    'candidateManifestSha256', candidate_manifest_sha256,
    'cutoffAt', submitted_cutoff,
    'dataClass', submitted_data_class
  );
end
$$;

revoke all on function internal.retention_candidate_summary(
  text, timestamptz
) from public, anon, authenticated, service_role;

-- Extend the fixed action list while preserving AAL2, recent TOTP, staff role,
-- identity epoch, target binding, and one-time nonce semantics.
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
       'platform_prerequisite_review', 'provider_reconcile',
       'incident_transition', 'operations_dead_letter',
       'operations_evidence', 'retention_dry_run'
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
       select 1
       from public.staff_roles role
       where role.person_id = actor
         and role.active
     )
  then
    raise exception 'FRESH_TOTP_STEP_UP_REQUIRED';
  end if;

  select identity_epoch into actor_epoch
  from public.people
  where id = actor;
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
  from public, anon, authenticated, service_role;
grant execute on function internal.issue_step_up_grant(text, text, text)
  to authenticated;

create or replace function internal.record_retention_dry_run_evidence(
  target_request uuid,
  submitted_evidence_reference text,
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
  request_row public.retention_dry_run_requests%rowtype;
  prior public.operations_evidence_events%rowtype;
  calculated_hash text;
  evidence_id uuid;
begin
  if not internal.has_staff_role('platform_admin')
     or length(trim(coalesce(submitted_reason, ''))) not between 10 and 1000
     or length(trim(coalesce(submitted_evidence_reference, '')))
       not between 3 and 500
  then
    raise exception 'RETENTION_EVIDENCE_REJECTED';
  end if;

  select request.* into request_row
  from public.retention_dry_run_requests request
  where request.id = target_request;
  if not found
     or request_row.requested_by = actor
     or exists (
       select 1
       from public.retention_dry_run_decisions decision
       where decision.dry_run_request_id = target_request
     )
  then
    raise exception 'INDEPENDENT_RETENTION_REVIEW_REQUIRED';
  end if;

  calculated_hash := encode(extensions.digest(
    target_request::text || '|' || request_row.candidate_digest || '|' ||
    trim(submitted_evidence_reference) || '|' || trim(submitted_reason),
    'sha256'
  ), 'hex');
  select event.* into prior
  from public.operations_evidence_events event
  where event.actor_id = actor
    and event.idempotency_key = idempotency;
  if found then
    if prior.request_hash <> calculated_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return prior.id;
  end if;

  perform internal.consume_step_up_grant(
    'operations_evidence',
    'retention_candidate_manifest_verified:' || target_request::text,
    submitted_nonce_hash
  );

  insert into public.operations_evidence_events (
    evidence_kind, target_type, target_identifier, outcome,
    evidence_sha256, external_reference, actor_id, reason, observed_at,
    request_hash, idempotency_key
  ) values (
    'retention_candidate_manifest_verified',
    'retention_dry_run',
    target_request::text,
    'passed',
    request_row.candidate_digest,
    trim(submitted_evidence_reference),
    actor,
    trim(submitted_reason),
    now(),
    calculated_hash,
    idempotency
  )
  returning id into evidence_id;

  perform internal.append_audit_event(
    actor, 'retention.evidence_recorded', 'retention_dry_run',
    target_request::text, trim(submitted_reason), null,
    jsonb_build_object(
      'operationsEvidenceEventId', evidence_id,
      'candidateDigest', request_row.candidate_digest,
      'externalActionPerformed', false,
      'physicalPurgePerformed', false
    )
  );
  return evidence_id;
end
$$;

revoke all on function internal.record_retention_dry_run_evidence(
  uuid, text, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function internal.record_retention_dry_run_evidence(
  uuid, text, text, uuid, text
) to authenticated;

create or replace function public.record_retention_dry_run_evidence(
  p_dry_run_request_id uuid,
  p_evidence_reference text,
  p_reason text,
  p_idempotency_key uuid,
  p_nonce_hash text
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.record_retention_dry_run_evidence(
    p_dry_run_request_id, p_evidence_reference, p_reason,
    p_idempotency_key, p_nonce_hash
  )
$$;

revoke all on function public.record_retention_dry_run_evidence(
  uuid, text, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_retention_dry_run_evidence(
  uuid, text, text, uuid, text
) to authenticated;

create or replace function internal.request_retention_dry_run(
  target_policy uuid,
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
  policy public.retention_policy_revisions%rowtype;
  cutoff_at timestamptz;
  summary jsonb;
  candidate_digest text;
  calculated_hash text;
  prior public.retention_dry_run_requests%rowtype;
  request_id uuid;
begin
  if not internal.has_staff_role('platform_admin')
     or length(trim(coalesce(submitted_reason, ''))) not between 10 and 1000
  then
    raise exception 'RETENTION_DRY_RUN_REJECTED';
  end if;

  calculated_hash := encode(extensions.digest(
    target_policy::text || '|' || trim(submitted_reason),
    'sha256'
  ), 'hex');
  select request.* into prior
  from public.retention_dry_run_requests request
  where request.requested_by = actor
    and request.idempotency_key = idempotency;
  if found then
    if prior.request_hash <> calculated_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return prior.id;
  end if;

  perform internal.consume_step_up_grant(
    'retention_dry_run',
    target_policy::text || ':dry_run',
    submitted_nonce_hash
  );

  select candidate.* into policy
  from public.retention_policy_revisions candidate
  where candidate.id = target_policy
    and candidate.effective_at <= now()
    and not exists (
      select 1
      from public.retention_policy_revisions newer
      where newer.data_class = candidate.data_class
        and newer.effective_at <= now()
        and newer.revision > candidate.revision
    );
  if not found then
    raise exception 'EFFECTIVE_RETENTION_POLICY_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'suiyue:retention-policy-dry-run:' || policy.id::text,
      0
    )
  );
  if exists (
    select 1
    from public.retention_dry_run_requests request
    left join public.retention_dry_run_decisions decision
      on decision.dry_run_request_id = request.id
    where request.retention_policy_revision_id = policy.id
      and decision.id is null
  ) then
    raise exception 'RETENTION_DRY_RUN_PENDING_REVIEW';
  end if;

  cutoff_at := now() - make_interval(days => policy.archive_days);
  summary := internal.retention_candidate_summary(
    policy.data_class, cutoff_at
  );
  candidate_digest := encode(extensions.digest(
    policy.data_class || '|' ||
    extract(epoch from cutoff_at)::numeric::text || '|' ||
    (summary ->> 'candidateCount') || '|' ||
    (summary ->> 'candidateManifestSha256'),
    'sha256'
  ), 'hex');

  insert into public.retention_dry_run_requests (
    retention_policy_revision_id, data_class, cutoff_at,
    candidate_count, candidate_digest, requested_by, reason,
    request_hash, idempotency_key
  ) values (
    policy.id, policy.data_class, cutoff_at,
    (summary ->> 'candidateCount')::bigint, candidate_digest,
    actor, trim(submitted_reason), calculated_hash, idempotency
  )
  returning id into request_id;

  perform internal.append_audit_event(
    actor, 'retention.dry_run_requested', 'retention_policy_revision',
    policy.id::text, trim(submitted_reason), null,
    jsonb_build_object(
      'dryRunRequestId', request_id,
      'dataClass', policy.data_class,
      'cutoffAt', cutoff_at,
      'candidateCount', (summary ->> 'candidateCount')::bigint,
      'candidateDigest', candidate_digest,
      'physicalPurgePerformed', false
    )
  );
  return request_id;
end
$$;

revoke all on function internal.request_retention_dry_run(
  uuid, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function internal.request_retention_dry_run(
  uuid, text, uuid, text
) to authenticated;

create or replace function public.request_retention_dry_run(
  p_retention_policy_revision_id uuid,
  p_reason text,
  p_idempotency_key uuid,
  p_nonce_hash text
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.request_retention_dry_run(
    p_retention_policy_revision_id, p_reason,
    p_idempotency_key, p_nonce_hash
  )
$$;

revoke all on function public.request_retention_dry_run(
  uuid, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.request_retention_dry_run(
  uuid, text, uuid, text
) to authenticated;

create or replace function internal.decide_retention_dry_run(
  target_request uuid,
  submitted_decision text,
  submitted_reason text,
  submitted_evidence_event_id uuid,
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
  request_row public.retention_dry_run_requests%rowtype;
  evidence public.operations_evidence_events%rowtype;
  prior public.retention_dry_run_decisions%rowtype;
  calculated_hash text;
  decision_id uuid;
begin
  if not internal.has_staff_role('platform_admin')
     or submitted_decision not in ('approve', 'reject')
     or length(trim(coalesce(submitted_reason, ''))) not between 10 and 1000
     or submitted_evidence_event_id is null
  then
    raise exception 'RETENTION_DRY_RUN_DECISION_REJECTED';
  end if;

  calculated_hash := encode(extensions.digest(
    target_request::text || '|' || submitted_decision || '|' ||
    trim(submitted_reason) || '|' || submitted_evidence_event_id::text,
    'sha256'
  ), 'hex');
  select decision.* into prior
  from public.retention_dry_run_decisions decision
  where decision.reviewer_id = actor
    and decision.idempotency_key = idempotency;
  if found then
    if prior.request_hash <> calculated_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object(
      'decisionId', prior.id,
      'status', prior.decision,
      'replayed', true,
      'physicalPurgePerformed', false
    );
  end if;

  perform internal.consume_step_up_grant(
    'retention_dry_run',
    target_request::text || ':' || submitted_decision,
    submitted_nonce_hash
  );
  perform pg_advisory_xact_lock(
    hashtextextended('suiyue:retention-dry-run:' || target_request::text, 0)
  );
  select request.* into request_row
  from public.retention_dry_run_requests request
  where request.id = target_request;
  if not found
     or request_row.requested_by = actor
     or exists (
       select 1 from public.retention_dry_run_decisions decision
       where decision.dry_run_request_id = target_request
     )
  then
    raise exception 'INDEPENDENT_RETENTION_REVIEW_REQUIRED';
  end if;
  select event.* into evidence
  from public.operations_evidence_events event
  where event.id = submitted_evidence_event_id
    and event.actor_id = actor
    and event.evidence_kind = 'retention_candidate_manifest_verified'
    and event.target_type = 'retention_dry_run'
    and event.target_identifier = request_row.id::text
    and event.outcome = 'passed'
    and event.evidence_sha256 = request_row.candidate_digest
    and event.observed_at >= request_row.created_at;
  if not found then
    raise exception 'RETENTION_EVIDENCE_RECORD_REQUIRED';
  end if;

  insert into public.retention_dry_run_decisions (
    dry_run_request_id, operations_evidence_event_id,
    reviewer_id, decision, reason,
    evidence_sha256, evidence_reference, request_hash, idempotency_key
  ) values (
    request_row.id, evidence.id,
    actor, submitted_decision, trim(submitted_reason),
    evidence.evidence_sha256, evidence.external_reference,
    calculated_hash, idempotency
  )
  returning id into decision_id;

  perform internal.append_audit_event(
    actor, 'retention.dry_run_' || submitted_decision,
    'retention_dry_run', request_row.id::text,
    trim(submitted_reason), null,
    jsonb_build_object(
      'candidateCount', request_row.candidate_count,
      'candidateDigest', request_row.candidate_digest,
      'operationsEvidenceEventId', evidence.id,
      'evidenceSha256', evidence.evidence_sha256,
      'physicalPurgePerformed', false
    )
  );
  return jsonb_build_object(
    'decisionId', decision_id,
    'status', submitted_decision,
    'replayed', false,
    'physicalPurgePerformed', false
  );
end
$$;

revoke all on function internal.decide_retention_dry_run(
  uuid, text, text, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function internal.decide_retention_dry_run(
  uuid, text, text, uuid, uuid, text
) to authenticated;

create or replace function public.decide_retention_dry_run(
  p_dry_run_request_id uuid,
  p_decision text,
  p_reason text,
  p_operations_evidence_event_id uuid,
  p_idempotency_key uuid,
  p_nonce_hash text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.decide_retention_dry_run(
    p_dry_run_request_id, p_decision, p_reason,
    p_operations_evidence_event_id,
    p_idempotency_key, p_nonce_hash
  )
$$;

revoke all on function public.decide_retention_dry_run(
  uuid, text, text, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.decide_retention_dry_run(
  uuid, text, text, uuid, uuid, text
) to authenticated;

create or replace function internal.read_retention_control_plane()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  if not internal.has_staff_role('platform_admin') then
    raise exception 'RETENTION_CONTROL_PLANE_REJECTED';
  end if;

  return jsonb_build_object(
    'policies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'policyRevisionId', policy.id,
        'dataClass', policy.data_class,
        'revision', policy.revision,
        'onlineDays', policy.online_days,
        'archiveDays', policy.archive_days,
        'effectiveAt', policy.effective_at,
        'dryRunSupported', policy.data_class in (
          'support_cases', 'provider_events',
          'notification_delivery_events', 'idempotency_records',
          'audit_events', 'notifications'
        ),
        'latestRequest', (
          select jsonb_build_object(
            'requestId', request.id,
            'cutoffAt', request.cutoff_at,
            'candidateCount', request.candidate_count,
            'candidateDigest', request.candidate_digest,
            'requestedAt', request.created_at,
            'status', coalesce(decision.decision, 'pending'),
            'canReview',
              decision.id is null
              and request.requested_by <> internal.current_person_id()
          )
          from public.retention_dry_run_requests request
          left join public.retention_dry_run_decisions decision
            on decision.dry_run_request_id = request.id
          where request.retention_policy_revision_id = policy.id
          order by request.created_at desc
          limit 1
        )
      ) order by policy.data_class), '[]'::jsonb)
      from (
        select distinct on (candidate.data_class) candidate.*
        from public.retention_policy_revisions candidate
        where candidate.effective_at <= now()
        order by
          candidate.data_class,
          candidate.revision desc,
          candidate.effective_at desc
      ) policy
    ), '[]'::jsonb),
    'notice',
      'dry-run and evidence only; no protected data is physically purged'
  );
end
$$;

revoke all on function internal.read_retention_control_plane()
  from public, anon, authenticated, service_role;
grant execute on function internal.read_retention_control_plane()
  to authenticated;

create or replace function public.read_retention_control_plane()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_retention_control_plane()
$$;

revoke all on function public.read_retention_control_plane()
  from public, anon, authenticated, service_role;
grant execute on function public.read_retention_control_plane()
  to authenticated;
