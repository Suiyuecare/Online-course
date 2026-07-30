-- Operations Control Plane v1
-- Ordered after the complete pre-launch schema chain.
--
-- This migration deliberately records operational evidence rather than
-- pretending to run an external backup, restore, provider replay, or retention
-- sweep. All operator actions require a fresh TOTP step-up, a platform_admin
-- role, an idempotency key, and an append-only audit trail.

create table public.security_incident_transition_requests (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.security_incidents(id),
  requested_action text not null check (requested_action in (
    'contain', 'investigate', 'record_legal_contact',
    'resolve', 'close', 'reopen'
  )),
  prior_status text not null check (prior_status in (
    'open', 'contained', 'investigating', 'resolved', 'closed'
  )),
  requested_status text not null check (requested_status in (
    'open', 'contained', 'investigating', 'resolved', 'closed'
  )),
  requested_by uuid not null references public.people(id),
  reason text not null check (length(trim(reason)) between 10 and 1000),
  evidence_reference text
    check (
      evidence_reference is null
      or length(trim(evidence_reference)) between 3 and 500
    ),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (requested_by, idempotency_key)
);

create table public.security_incident_transition_decisions (
  id uuid primary key default gen_random_uuid(),
  transition_request_id uuid not null unique
    references public.security_incident_transition_requests(id),
  reviewer_id uuid not null references public.people(id),
  decision text not null check (decision in ('approve', 'reject')),
  reason text not null check (length(trim(reason)) between 10 and 1000),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (reviewer_id, idempotency_key)
);

create table public.security_incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.security_incidents(id),
  transition_request_id uuid
    references public.security_incident_transition_requests(id),
  event_type text not null check (event_type in (
    'transition_requested', 'transition_approved', 'transition_rejected'
  )),
  prior_status text not null check (prior_status in (
    'open', 'contained', 'investigating', 'resolved', 'closed'
  )),
  resulting_status text not null check (resulting_status in (
    'open', 'contained', 'investigating', 'resolved', 'closed'
  )),
  actor_id uuid not null references public.people(id),
  reason text not null,
  evidence_reference text,
  created_at timestamptz not null default now()
);

create table public.operations_dead_letter_actions (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null
    check (source_kind in ('durable_job', 'notification_outbox')),
  source_id uuid not null,
  action text not null check (action in ('retry', 'acknowledge')),
  actor_id uuid not null references public.people(id),
  reason text not null check (length(trim(reason)) between 10 and 1000),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (actor_id, idempotency_key)
);

create table public.operations_evidence_events (
  id uuid primary key default gen_random_uuid(),
  evidence_kind text not null check (evidence_kind in (
    'storage_manifest_registered',
    'storage_restore_verified',
    'archive_reload_verified',
    'deletion_tombstones_replayed',
    'audit_chain_verified',
    'database_backup_manifest_registered',
    'database_restore_verified'
  )),
  target_type text not null check (target_type in (
    'storage_bucket', 'archive_manifest', 'deletion_manifest',
    'audit_checkpoint', 'database'
  )),
  target_identifier text not null
    check (length(trim(target_identifier)) between 1 and 100),
  outcome text not null check (outcome in ('passed', 'failed')),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  external_reference text not null
    check (length(trim(external_reference)) between 3 and 500),
  actor_id uuid not null references public.people(id),
  reason text not null check (length(trim(reason)) between 10 and 1000),
  observed_at timestamptz not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (actor_id, idempotency_key)
);

create index security_incident_transition_requests_incident_idx
  on public.security_incident_transition_requests(incident_id, created_at desc);
create index security_incident_events_incident_idx
  on public.security_incident_events(incident_id, created_at desc);
create index operations_dead_letter_actions_source_idx
  on public.operations_dead_letter_actions(
    source_kind, source_id, created_at desc
  );
create index operations_evidence_events_target_idx
  on public.operations_evidence_events(
    evidence_kind, target_type, target_identifier, observed_at desc
  );

alter table public.security_incident_transition_requests
  enable row level security;
alter table public.security_incident_transition_requests
  force row level security;
alter table public.security_incident_transition_decisions
  enable row level security;
alter table public.security_incident_transition_decisions
  force row level security;
alter table public.security_incident_events enable row level security;
alter table public.security_incident_events force row level security;
alter table public.operations_dead_letter_actions enable row level security;
alter table public.operations_dead_letter_actions force row level security;
alter table public.operations_evidence_events enable row level security;
alter table public.operations_evidence_events force row level security;

revoke all on table public.security_incident_transition_requests
  from public, anon, authenticated, service_role;
revoke all on table public.security_incident_transition_decisions
  from public, anon, authenticated, service_role;
revoke all on table public.security_incident_events
  from public, anon, authenticated, service_role;
revoke all on table public.operations_dead_letter_actions
  from public, anon, authenticated, service_role;
revoke all on table public.operations_evidence_events
  from public, anon, authenticated, service_role;

create trigger security_incident_transition_requests_append_only
before update or delete on public.security_incident_transition_requests
for each row execute function internal.prevent_append_only_change();

create trigger security_incident_transition_decisions_append_only
before update or delete on public.security_incident_transition_decisions
for each row execute function internal.prevent_append_only_change();

create trigger security_incident_events_append_only
before update or delete on public.security_incident_events
for each row execute function internal.prevent_append_only_change();

create trigger operations_dead_letter_actions_append_only
before update or delete on public.operations_dead_letter_actions
for each row execute function internal.prevent_append_only_change();

create trigger operations_evidence_events_append_only
before update or delete on public.operations_evidence_events
for each row execute function internal.prevent_append_only_change();

-- Extend the existing fixed step-up capability list without weakening its
-- recent-TOTP, AAL2, identity-epoch, or active-staff checks.
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
       'operations_evidence'
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

create or replace function internal.request_security_incident_transition(
  target_incident uuid,
  submitted_action text,
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
  incident public.security_incidents%rowtype;
  desired_status text;
  normalized_evidence text := nullif(trim(submitted_evidence_reference), '');
  calculated_hash text;
  prior_request public.security_incident_transition_requests%rowtype;
  request_id uuid;
begin
  if not internal.has_staff_role('platform_admin')
     or submitted_action not in (
       'contain', 'investigate', 'record_legal_contact',
       'resolve', 'close', 'reopen'
     )
     or length(trim(coalesce(submitted_reason, ''))) not between 10 and 1000
     or (
       normalized_evidence is not null
       and length(normalized_evidence) not between 3 and 500
     )
  then
    raise exception 'INCIDENT_TRANSITION_REJECTED';
  end if;

  calculated_hash := encode(extensions.digest(
    target_incident::text || '|' || submitted_action || '|' ||
    trim(submitted_reason) || '|' || coalesce(normalized_evidence, ''),
    'sha256'
  ), 'hex');

  select request.* into prior_request
  from public.security_incident_transition_requests request
  where request.requested_by = actor
    and request.idempotency_key = idempotency;

  if found then
    if prior_request.request_hash <> calculated_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return prior_request.id;
  end if;

  perform internal.consume_step_up_grant(
    'incident_transition',
    target_incident::text || ':' || submitted_action,
    submitted_nonce_hash
  );
  perform pg_advisory_xact_lock(
    hashtextextended('suiyue:security-incident:' || target_incident::text, 0)
  );

  select candidate.* into incident
  from public.security_incidents candidate
  where candidate.id = target_incident
  for update;
  if not found then
    raise exception 'INCIDENT_NOT_FOUND';
  end if;

  desired_status := case submitted_action
    when 'contain' then 'contained'
    when 'investigate' then 'investigating'
    when 'record_legal_contact' then incident.status
    when 'resolve' then 'resolved'
    when 'close' then 'closed'
    when 'reopen' then 'investigating'
  end;

  if not (
    (submitted_action = 'contain' and incident.status = 'open')
    or (
      submitted_action = 'investigate'
      and incident.status = 'contained'
    )
    or (
      submitted_action = 'record_legal_contact'
      and incident.status <> 'closed'
      and incident.legal_contacted_at is null
    )
    or (
      submitted_action = 'resolve'
      and incident.status = 'investigating'
    )
    or (
      submitted_action = 'close'
      and incident.status = 'resolved'
    )
    or (
      submitted_action = 'reopen'
      and incident.status = 'resolved'
    )
  ) then
    raise exception 'INCIDENT_STATUS_TRANSITION_REJECTED';
  end if;

  if exists (
    select 1
    from public.security_incident_transition_requests pending
    where pending.incident_id = target_incident
      and not exists (
        select 1
        from public.security_incident_transition_decisions decision
        where decision.transition_request_id = pending.id
      )
  ) then
    raise exception 'INCIDENT_TRANSITION_ALREADY_PENDING';
  end if;

  insert into public.security_incident_transition_requests (
    incident_id, requested_action, prior_status, requested_status,
    requested_by, reason, evidence_reference, request_hash, idempotency_key
  ) values (
    incident.id, submitted_action, incident.status, desired_status,
    actor, trim(submitted_reason), normalized_evidence,
    calculated_hash, idempotency
  )
  returning id into request_id;

  insert into public.security_incident_events (
    incident_id, transition_request_id, event_type, prior_status,
    resulting_status, actor_id, reason, evidence_reference
  ) values (
    incident.id, request_id, 'transition_requested', incident.status,
    incident.status, actor, trim(submitted_reason), normalized_evidence
  );

  perform internal.append_audit_event(
    actor, 'security.incident_transition_requested',
    'security_incident', incident.id::text, trim(submitted_reason), null,
    jsonb_build_object(
      'transitionRequestId', request_id,
      'requestedAction', submitted_action,
      'priorStatus', incident.status,
      'requestedStatus', desired_status,
      'hasEvidenceReference', normalized_evidence is not null
    )
  );
  return request_id;
end
$$;

revoke all on function internal.request_security_incident_transition(
  uuid, text, text, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function internal.request_security_incident_transition(
  uuid, text, text, text, uuid, text
) to authenticated;

create or replace function public.request_security_incident_transition(
  p_incident_id uuid,
  p_action text,
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
  select internal.request_security_incident_transition(
    p_incident_id, p_action, p_reason, p_evidence_reference,
    p_idempotency_key, p_nonce_hash
  )
$$;

revoke all on function public.request_security_incident_transition(
  uuid, text, text, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.request_security_incident_transition(
  uuid, text, text, text, uuid, text
) to authenticated;

create or replace function internal.decide_security_incident_transition(
  target_request uuid,
  submitted_decision text,
  submitted_reason text,
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
  request_row public.security_incident_transition_requests%rowtype;
  incident public.security_incidents%rowtype;
  prior_decision public.security_incident_transition_decisions%rowtype;
  calculated_hash text;
  decision_id uuid;
begin
  if not internal.has_staff_role('platform_admin')
     or submitted_decision not in ('approve', 'reject')
     or length(trim(coalesce(submitted_reason, ''))) not between 10 and 1000
  then
    raise exception 'INCIDENT_TRANSITION_DECISION_REJECTED';
  end if;

  calculated_hash := encode(extensions.digest(
    target_request::text || '|' || submitted_decision || '|' ||
    trim(submitted_reason),
    'sha256'
  ), 'hex');

  select decision.* into prior_decision
  from public.security_incident_transition_decisions decision
  where decision.reviewer_id = actor
    and decision.idempotency_key = idempotency;
  if found then
    if prior_decision.request_hash <> calculated_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object(
      'decisionId', prior_decision.id,
      'status', submitted_decision,
      'replayed', true
    );
  end if;

  perform internal.consume_step_up_grant(
    'incident_transition',
    target_request::text || ':' || submitted_decision,
    submitted_nonce_hash
  );
  perform pg_advisory_xact_lock(
    hashtextextended('suiyue:incident-transition:' || target_request::text, 0)
  );

  select transition.* into request_row
  from public.security_incident_transition_requests transition
  where transition.id = target_request
  for update;
  if not found
     or request_row.requested_by = actor
     or exists (
       select 1
       from public.security_incident_transition_decisions existing
       where existing.transition_request_id = target_request
     )
  then
    raise exception 'INDEPENDENT_INCIDENT_REVIEW_REQUIRED';
  end if;

  select candidate.* into incident
  from public.security_incidents candidate
  where candidate.id = request_row.incident_id
  for update;
  if not found or incident.status <> request_row.prior_status then
    raise exception 'INCIDENT_TRANSITION_STALE';
  end if;

  insert into public.security_incident_transition_decisions (
    transition_request_id, reviewer_id, decision, reason,
    request_hash, idempotency_key
  ) values (
    request_row.id, actor, submitted_decision, trim(submitted_reason),
    calculated_hash, idempotency
  )
  returning id into decision_id;

  if submitted_decision = 'approve' then
    update public.security_incidents
    set status = request_row.requested_status,
        contained_at = case
          when request_row.requested_action = 'contain'
            then coalesce(contained_at, now())
          else contained_at
        end,
        legal_contacted_at = case
          when request_row.requested_action = 'record_legal_contact'
            then coalesce(legal_contacted_at, now())
          else legal_contacted_at
        end,
        closed_at = case
          when request_row.requested_action = 'close' then now()
          else closed_at
        end
    where id = incident.id;
  end if;

  insert into public.security_incident_events (
    incident_id, transition_request_id, event_type, prior_status,
    resulting_status, actor_id, reason, evidence_reference
  ) values (
    incident.id, request_row.id,
    case
      when submitted_decision = 'approve'
        then 'transition_approved'
      else 'transition_rejected'
    end,
    incident.status,
    case
      when submitted_decision = 'approve'
        then request_row.requested_status
      else incident.status
    end,
    actor, trim(submitted_reason), request_row.evidence_reference
  );

  perform internal.append_audit_event(
    actor,
    case
      when submitted_decision = 'approve'
        then 'security.incident_transition_approved'
      else 'security.incident_transition_rejected'
    end,
    'security_incident', incident.id::text, trim(submitted_reason), null,
    jsonb_build_object(
      'transitionRequestId', request_row.id,
      'requestedAction', request_row.requested_action,
      'priorStatus', incident.status,
      'resultingStatus',
        case
          when submitted_decision = 'approve'
            then request_row.requested_status
          else incident.status
        end
    )
  );

  return jsonb_build_object(
    'decisionId', decision_id,
    'status', submitted_decision,
    'incidentStatus',
      case
        when submitted_decision = 'approve'
          then request_row.requested_status
        else incident.status
      end,
    'replayed', false
  );
end
$$;

revoke all on function internal.decide_security_incident_transition(
  uuid, text, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function internal.decide_security_incident_transition(
  uuid, text, text, uuid, text
) to authenticated;

create or replace function public.decide_security_incident_transition(
  p_transition_request_id uuid,
  p_decision text,
  p_reason text,
  p_idempotency_key uuid,
  p_nonce_hash text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.decide_security_incident_transition(
    p_transition_request_id, p_decision, p_reason,
    p_idempotency_key, p_nonce_hash
  )
$$;

revoke all on function public.decide_security_incident_transition(
  uuid, text, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.decide_security_incident_transition(
  uuid, text, text, uuid, text
) to authenticated;

create or replace function internal.act_on_operations_dead_letter(
  submitted_source_kind text,
  target_source uuid,
  submitted_action text,
  submitted_reason text,
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
  job public.durable_jobs%rowtype;
  outbox public.notification_outbox%rowtype;
  prior_action public.operations_dead_letter_actions%rowtype;
  calculated_hash text;
  action_id uuid;
begin
  if not internal.has_staff_role('platform_admin')
     or submitted_source_kind not in (
       'durable_job', 'notification_outbox'
     )
     or submitted_action not in ('retry', 'acknowledge')
     or length(trim(coalesce(submitted_reason, ''))) not between 10 and 1000
  then
    raise exception 'DEAD_LETTER_ACTION_REJECTED';
  end if;

  calculated_hash := encode(extensions.digest(
    submitted_source_kind || '|' || target_source::text || '|' ||
    submitted_action || '|' || trim(submitted_reason),
    'sha256'
  ), 'hex');

  select action.* into prior_action
  from public.operations_dead_letter_actions action
  where action.actor_id = actor
    and action.idempotency_key = idempotency;
  if found then
    if prior_action.request_hash <> calculated_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object(
      'actionId', prior_action.id,
      'status', prior_action.action,
      'replayed', true
    );
  end if;

  perform internal.consume_step_up_grant(
    'operations_dead_letter',
    submitted_source_kind || ':' || target_source::text || ':' ||
      submitted_action,
    submitted_nonce_hash
  );
  perform pg_advisory_xact_lock(
    hashtextextended(
      'suiyue:dead-letter:' || submitted_source_kind || ':' ||
        target_source::text,
      0
    )
  );

  if submitted_source_kind = 'durable_job' then
    select candidate.* into job
    from public.durable_jobs candidate
    where candidate.id = target_source
    for update;
    if not found or job.status <> 'dead_letter' then
      raise exception 'DEAD_LETTER_NOT_ACTIONABLE';
    end if;
    if submitted_action = 'retry' then
      -- Only database-local, idempotent recomputations may be retried here.
      -- Provider, email/SMS, storage, and identity side effects require their
      -- dedicated reconciliation path and are never blindly replayed.
      if job.job_type not in (
        'completion_evaluate',
        'recorded_progress_recompute',
        'live_attendance_settle'
      ) then
        raise exception 'DEAD_LETTER_RECONCILIATION_REQUIRED';
      end if;
      update public.durable_jobs
      set status = 'retry',
          available_at = now(),
          lease_owner = null,
          lease_expires_at = null,
          completed_at = null
      where id = job.id;
    end if;
  else
    select candidate.* into outbox
    from public.notification_outbox candidate
    where candidate.id = target_source
    for update;
    if not found or outbox.status <> 'dead_letter' then
      raise exception 'DEAD_LETTER_NOT_ACTIONABLE';
    end if;
    if submitted_action = 'retry' then
      raise exception 'DEAD_LETTER_RECONCILIATION_REQUIRED';
    end if;
  end if;

  insert into public.operations_dead_letter_actions (
    source_kind, source_id, action, actor_id, reason,
    request_hash, idempotency_key
  ) values (
    submitted_source_kind, target_source, submitted_action, actor,
    trim(submitted_reason), calculated_hash, idempotency
  )
  returning id into action_id;

  perform internal.append_audit_event(
    actor, 'operations.dead_letter_' || submitted_action,
    submitted_source_kind, target_source::text, trim(submitted_reason), null,
    jsonb_build_object(
      'actionId', action_id,
      'providerReplayAttempted', false,
      'sourceKind', submitted_source_kind
    )
  );
  return jsonb_build_object(
    'actionId', action_id,
    'status', submitted_action,
    'replayed', false
  );
end
$$;

revoke all on function internal.act_on_operations_dead_letter(
  text, uuid, text, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function internal.act_on_operations_dead_letter(
  text, uuid, text, text, uuid, text
) to authenticated;

create or replace function public.act_on_operations_dead_letter(
  p_source_kind text,
  p_source_id uuid,
  p_action text,
  p_reason text,
  p_idempotency_key uuid,
  p_nonce_hash text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.act_on_operations_dead_letter(
    p_source_kind, p_source_id, p_action, p_reason,
    p_idempotency_key, p_nonce_hash
  )
$$;

revoke all on function public.act_on_operations_dead_letter(
  text, uuid, text, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.act_on_operations_dead_letter(
  text, uuid, text, text, uuid, text
) to authenticated;

create or replace function internal.record_operations_evidence(
  submitted_evidence_kind text,
  submitted_target_type text,
  submitted_target_identifier text,
  submitted_outcome text,
  submitted_evidence_sha256 text,
  submitted_external_reference text,
  submitted_reason text,
  submitted_observed_at timestamptz,
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
  prior_event public.operations_evidence_events%rowtype;
  calculated_hash text;
  event_id uuid;
begin
  if not internal.has_staff_role('platform_admin')
     or submitted_evidence_kind not in (
       'storage_manifest_registered',
       'storage_restore_verified',
       'archive_reload_verified',
       'deletion_tombstones_replayed',
       'audit_chain_verified',
       'database_backup_manifest_registered',
       'database_restore_verified'
     )
     or submitted_target_type not in (
       'storage_bucket', 'archive_manifest', 'deletion_manifest',
       'audit_checkpoint', 'database'
     )
     or length(trim(coalesce(submitted_target_identifier, '')))
       not between 1 and 100
     or submitted_outcome not in ('passed', 'failed')
     or submitted_evidence_sha256 !~ '^[a-f0-9]{64}$'
     or length(trim(coalesce(submitted_external_reference, '')))
       not between 3 and 500
     or length(trim(coalesce(submitted_reason, ''))) not between 10 and 1000
     or submitted_observed_at is null
     or submitted_observed_at > now() + interval '5 minutes'
  then
    raise exception 'OPERATIONS_EVIDENCE_REJECTED';
  end if;

  if (
    submitted_evidence_kind in (
      'storage_manifest_registered', 'storage_restore_verified'
    )
    and (
      submitted_target_type <> 'storage_bucket'
      or submitted_target_identifier not in (
        'quarantine', 'safe-uploads', 'certificates',
        'legal-documents', 'accreditation-exports'
      )
    )
  ) or (
    submitted_evidence_kind in (
      'database_backup_manifest_registered', 'database_restore_verified'
    )
    and (
      submitted_target_type <> 'database'
      or submitted_target_identifier <> 'primary'
    )
  ) or (
    submitted_evidence_kind = 'archive_reload_verified'
    and submitted_target_type <> 'archive_manifest'
  ) or (
    submitted_evidence_kind = 'deletion_tombstones_replayed'
    and submitted_target_type <> 'deletion_manifest'
  ) or (
    submitted_evidence_kind = 'audit_chain_verified'
    and submitted_target_type <> 'audit_checkpoint'
  ) then
    raise exception 'OPERATIONS_EVIDENCE_TARGET_REJECTED';
  end if;

  calculated_hash := encode(extensions.digest(
    submitted_evidence_kind || '|' || submitted_target_type || '|' ||
    trim(submitted_target_identifier) || '|' || submitted_outcome || '|' ||
    submitted_evidence_sha256 || '|' ||
    trim(submitted_external_reference) || '|' || trim(submitted_reason) ||
    '|' || submitted_observed_at::text,
    'sha256'
  ), 'hex');

  select event.* into prior_event
  from public.operations_evidence_events event
  where event.actor_id = actor
    and event.idempotency_key = idempotency;
  if found then
    if prior_event.request_hash <> calculated_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return prior_event.id;
  end if;

  perform internal.consume_step_up_grant(
    'operations_evidence',
    submitted_evidence_kind || ':' || trim(submitted_target_identifier),
    submitted_nonce_hash
  );

  insert into public.operations_evidence_events (
    evidence_kind, target_type, target_identifier, outcome,
    evidence_sha256, external_reference, actor_id, reason, observed_at,
    request_hash, idempotency_key
  ) values (
    submitted_evidence_kind, submitted_target_type,
    trim(submitted_target_identifier), submitted_outcome,
    submitted_evidence_sha256, trim(submitted_external_reference),
    actor, trim(submitted_reason), submitted_observed_at,
    calculated_hash, idempotency
  )
  returning id into event_id;

  perform internal.append_audit_event(
    actor, 'operations.evidence_recorded', 'operations_evidence',
    event_id::text, trim(submitted_reason), null,
    jsonb_build_object(
      'evidenceKind', submitted_evidence_kind,
      'targetType', submitted_target_type,
      'targetIdentifier', trim(submitted_target_identifier),
      'outcome', submitted_outcome,
      'externalActionPerformed', false
    )
  );
  return event_id;
end
$$;

revoke all on function internal.record_operations_evidence(
  text, text, text, text, text, text, text, timestamptz, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function internal.record_operations_evidence(
  text, text, text, text, text, text, text, timestamptz, uuid, text
) to authenticated;

create or replace function public.record_operations_evidence(
  p_evidence_kind text,
  p_target_type text,
  p_target_identifier text,
  p_outcome text,
  p_evidence_sha256 text,
  p_external_reference text,
  p_reason text,
  p_observed_at timestamptz,
  p_idempotency_key uuid,
  p_nonce_hash text
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.record_operations_evidence(
    p_evidence_kind, p_target_type, p_target_identifier, p_outcome,
    p_evidence_sha256, p_external_reference, p_reason, p_observed_at,
    p_idempotency_key, p_nonce_hash
  )
$$;

revoke all on function public.record_operations_evidence(
  text, text, text, text, text, text, text, timestamptz, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_operations_evidence(
  text, text, text, text, text, text, text, timestamptz, uuid, text
) to authenticated;

create or replace function internal.read_operations_control_plane()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
begin
  if not internal.has_staff_role('platform_admin') then
    raise exception 'OPERATIONS_CONTROL_PLANE_REJECTED';
  end if;

  select jsonb_build_object(
    'generatedAt', now(),
    'runtime', jsonb_build_object(
      'workers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'workerName', worker.worker_name,
          'lastSuccessAt', worker.last_success_at,
          'fresh',
            worker.last_success_at is not null
            and worker.last_success_at >= now() - interval '20 minutes',
          'reportedDeadLetterCount', worker.dead_letter_count
        ) order by worker.worker_name)
        from public.worker_heartbeats worker
      ), '[]'::jsonb),
      'durableDeadLetterCount', (
        select count(*) from public.durable_jobs job
        where job.status = 'dead_letter'
      ),
      'notificationDeadLetterCount', (
        select count(*) from public.notification_outbox outbox
        where outbox.status = 'dead_letter'
      ),
      'oldestDueJobAt', (
        select min(job.created_at) from public.durable_jobs job
        where job.status in ('pending', 'retry')
          and job.available_at <= now()
      ),
      'oldestDueNotificationAt', (
        select min(outbox.created_at)
        from public.notification_outbox outbox
        where outbox.status in ('pending', 'retry')
          and outbox.available_at <= now()
      )
    ),
    'incidents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', incident.id,
        'severity', incident.severity,
        'status', incident.status,
        'detectedAt', incident.detected_at,
        'containedAt', incident.contained_at,
        'legalContactedAt', incident.legal_contacted_at,
        'notificationDeadlineAt', incident.notification_deadline_at,
        'deadlineState', case
          when incident.notification_deadline_at is null then 'not_set'
          when incident.legal_contacted_at is not null then 'recorded'
          when incident.notification_deadline_at < now() then 'overdue'
          when incident.notification_deadline_at < now() + interval '12 hours'
            then 'due_soon'
          else 'open'
        end,
        'pendingRequest', (
          select jsonb_build_object(
            'id', request.id,
            'action', request.requested_action,
            'requestedAt', request.created_at,
            'canReview', request.requested_by <> internal.current_person_id()
          )
          from public.security_incident_transition_requests request
          where request.incident_id = incident.id
            and not exists (
              select 1
              from public.security_incident_transition_decisions decision
              where decision.transition_request_id = request.id
            )
          order by request.created_at desc
          limit 1
        )
      ) order by
        case incident.status
          when 'open' then 0
          when 'contained' then 1
          when 'investigating' then 2
          when 'resolved' then 3
          else 4
        end,
        incident.detected_at desc)
      from (
        select candidate.*
        from public.security_incidents candidate
        order by candidate.detected_at desc
        limit 50
      ) incident
    ), '[]'::jsonb),
    'deadLetters', coalesce((
      with dead_letters as (
        select
          'durable_job'::text as source_kind,
          job.id as source_id,
          job.job_type as item_type,
          job.attempt_count,
          job.created_at,
          job.job_type in (
            'completion_evaluate',
            'recorded_progress_recompute',
            'live_attendance_settle'
          ) as retryable,
          case
            when job.last_error is null then 'unknown'
            when job.last_error ilike '%config%' then 'configuration'
            when job.last_error ilike '%auth%' then 'authorization'
            when job.last_error ilike '%timeout%'
              then 'ambiguous_timeout'
            else 'execution_failure'
          end as failure_class
        from public.durable_jobs job
        where job.status = 'dead_letter'
        union all
        select
          'notification_outbox'::text,
          outbox.id,
          outbox.channel || ':' || outbox.template_key,
          outbox.attempt_count,
          outbox.created_at,
          false,
          case
            when outbox.last_error is null then 'unknown'
            when outbox.last_error ilike '%config%' then 'configuration'
            when outbox.last_error ilike '%auth%' then 'authorization'
            when outbox.last_error ilike '%timeout%'
              then 'ambiguous_timeout'
            else 'delivery_failure'
          end
        from public.notification_outbox outbox
        where outbox.status = 'dead_letter'
      )
      select jsonb_agg(jsonb_build_object(
        'sourceKind', dead_letter.source_kind,
        'sourceId', dead_letter.source_id,
        'itemType', left(dead_letter.item_type, 100),
        'attemptCount', dead_letter.attempt_count,
        'createdAt', dead_letter.created_at,
        'retryable', dead_letter.retryable,
        'requiresReconciliation', not dead_letter.retryable,
        'failureClass', dead_letter.failure_class,
        'latestAction', (
          select action.action
          from public.operations_dead_letter_actions action
          where action.source_kind = dead_letter.source_kind
            and action.source_id = dead_letter.source_id
          order by action.created_at desc
          limit 1
        )
      ) order by dead_letter.created_at)
      from (
        select *
        from dead_letters
        order by created_at
        limit 100
      ) dead_letter
    ), '[]'::jsonb),
    'evidence', jsonb_build_object(
      'storageBuckets', (
        select jsonb_agg(jsonb_build_object(
          'bucketName', bucket.name,
          'latestManifestAt', (
            select max(event.observed_at)
            from public.operations_evidence_events event
            where event.evidence_kind = 'storage_manifest_registered'
              and event.target_type = 'storage_bucket'
              and event.target_identifier = bucket.name
              and event.outcome = 'passed'
          ),
          'latestRestoreVerifiedAt', (
            select max(event.observed_at)
            from public.operations_evidence_events event
            where event.evidence_kind = 'storage_restore_verified'
              and event.target_type = 'storage_bucket'
              and event.target_identifier = bucket.name
              and event.outcome = 'passed'
          ),
          'legacyManifestCount', (
            select count(*)
            from public.storage_backup_manifests manifest
            where manifest.bucket_name = bucket.name
          )
        ) order by bucket.name)
        from (
          values
            ('accreditation-exports'),
            ('certificates'),
            ('legal-documents'),
            ('quarantine'),
            ('safe-uploads')
        ) as bucket(name)
      ),
      'latestDatabaseBackupAt', (
        select max(event.observed_at)
        from public.operations_evidence_events event
        where event.evidence_kind =
          'database_backup_manifest_registered'
          and event.outcome = 'passed'
      ),
      'latestDatabaseRestoreVerifiedAt', (
        select max(event.observed_at)
        from public.operations_evidence_events event
        where event.evidence_kind = 'database_restore_verified'
          and event.outcome = 'passed'
      ),
      'latestArchiveReloadVerifiedAt', (
        select max(event.observed_at)
        from public.operations_evidence_events event
        where event.evidence_kind = 'archive_reload_verified'
          and event.outcome = 'passed'
      ),
      'latestDeletionTombstonesReplayedAt', (
        select max(event.observed_at)
        from public.operations_evidence_events event
        where event.evidence_kind = 'deletion_tombstones_replayed'
          and event.outcome = 'passed'
      ),
      'latestAuditChainVerifiedAt', (
        select max(event.observed_at)
        from public.operations_evidence_events event
        where event.evidence_kind = 'audit_chain_verified'
          and event.outcome = 'passed'
      ),
      'latestAuditCheckpointAt', (
        select max(checkpoint.created_at)
        from public.audit_hash_checkpoints checkpoint
      )
    )
  ) into result;
  return result;
end
$$;

revoke all on function internal.read_operations_control_plane()
  from public, anon, authenticated, service_role;
grant execute on function internal.read_operations_control_plane()
  to authenticated;

create or replace function public.read_operations_control_plane()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_operations_control_plane()
$$;

revoke all on function public.read_operations_control_plane()
  from public, anon, authenticated, service_role;
grant execute on function public.read_operations_control_plane()
  to authenticated;
