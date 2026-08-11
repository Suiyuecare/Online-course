-- Forward-fix functions that passed creation but failed plpgsql_check/runtime
-- because variable names collided with table columns. The parameter signatures
-- and grants remain unchanged.

create or replace function internal.submit_point_topup_proof(
  target_topup uuid,
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
  topup public.point_topups%rowtype;
  prior_proof public.payment_proofs%rowtype;
  proof_id uuid;
  submitted_object_path text := object_path;
  submitted_content_hash text := content_hash;
begin
  select proof.* into prior_proof
  from public.payment_proofs proof
  where proof.submitted_by = actor
    and proof.idempotency_key = idempotency;

  if found then
    if prior_proof.topup_id is distinct from target_topup
       or prior_proof.remitter_name is distinct from remitter
       or prior_proof.bank_name is distinct from bank
       or prior_proof.account_last_five is distinct from last_five
       or prior_proof.transferred_at is distinct from transferred
       or prior_proof.amount_twd is distinct from amount
       or prior_proof.promoted_object_path
          is distinct from submitted_object_path
       or prior_proof.content_sha256
          is distinct from submitted_content_hash
    then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object(
      'status', 'proof_submitted',
      'proofId', prior_proof.id,
      'attachmentStatus', prior_proof.scan_status,
      'replayed', true
    );
  end if;

  select candidate.* into topup
  from public.point_topups candidate
  where candidate.id = target_topup
    and (
      candidate.requested_by = actor
      or internal.has_organization_role(
        candidate.organization_id, array['owner', 'finance']
      )
    )
  for update;

  if not found
     or topup.status not in ('pending_transfer', 'proof_submitted')
     or topup.transfer_due_at < clock_timestamp()
     or transferred > clock_timestamp() + interval '5 minutes'
     or transferred > topup.transfer_due_at
  then
    raise exception 'TOPUP_PROOF_REJECTED';
  end if;

  if (submitted_object_path is null) <>
     (submitted_content_hash is null)
  then
    raise exception 'SAFE_UPLOAD_REQUIRED';
  end if;

  if submitted_object_path is not null and not exists (
    select 1
    from public.upload_quarantine upload
    where upload.owner_person_id = actor
      and upload.purpose = 'payment_proof'
      and upload.status = 'promoted'
      and upload.promoted_object_path = submitted_object_path
      and upload.promoted_sha256 = submitted_content_hash
      and upload.promoted_sha256 ~ '^[a-f0-9]{64}$'
  ) then
    raise exception 'SAFE_UPLOAD_REQUIRED';
  end if;

  insert into public.payment_proofs (
    topup_id, submitted_by, remitter_name, bank_name, account_last_five,
    transferred_at, amount_twd, promoted_object_path, content_sha256,
    scan_status, idempotency_key
  ) values (
    topup.id, actor, remitter, bank, last_five, transferred, amount,
    submitted_object_path, submitted_content_hash,
    case
      when submitted_object_path is null then 'not_provided'
      else 'safe'
    end,
    idempotency
  )
  returning id into proof_id;

  update public.point_topups
  set status = 'proof_submitted'
  where id = topup.id
    and status = 'pending_transfer';

  perform internal.append_audit_event(
    actor, 'organization.topup_proof_submitted', 'point_topup',
    topup.id::text, 'proof is evidence only and does not mint points',
    topup.organization_id,
    jsonb_build_object(
      'amountTwd', amount,
      'hasObject', submitted_object_path is not null
    )
  );

  return jsonb_build_object(
    'status', 'proof_submitted',
    'proofId', proof_id,
    'attachmentStatus',
      case
        when submitted_object_path is null then 'not_provided'
        else 'safe'
      end,
    'replayed', false
  );
end
$$;

revoke all on function internal.submit_point_topup_proof(
  uuid, text, text, text, timestamptz, integer, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.submit_point_topup_proof(
  uuid, text, text, text, timestamptz, integer, text, text, uuid
) to authenticated;

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
  target_source_kind text;
  target_source_id uuid;
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

  target_source_kind := job.payload ->> 'sourceKind';
  target_source_id := (job.payload ->> 'sourceId')::uuid;
  submitted_deadline := (job.payload ->> 'deadlineAt')::timestamptz;
  submitted_severity := job.payload ->> 'severity';

  if target_source_kind = 'support_case' then
    select support_case.response_due_at,
      support_case.status not in ('resolved', 'closed')
    into current_deadline, actionable
    from public.support_cases support_case
    where support_case.id = target_source_id;
  elsif target_source_kind = 'refund_case' then
    select refund.submitted_at + interval '15 days',
      refund.status not in ('completed', 'rejected')
    into current_deadline, actionable
    from public.refund_cases refund
    where refund.id = target_source_id;
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
          when target_source_kind = 'support_case' then interval '4 hours'
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
    target_source_kind, target_source_id, submitted_deadline,
    submitted_severity, job.id
  )
  on conflict (
    source_kind, source_id, deadline_at, severity
  ) do nothing
  returning id into event_id;

  if event_id is not null then
    perform internal.append_audit_event(
      null, 'operations.sla_' || submitted_severity,
      target_source_kind, target_source_id::text,
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
