-- Close two B2B launch blockers without widening browser table access:
-- Ordered after the complete pre-launch schema chain.
-- 1. organization top-up proofs must retain only a promoted, owner-bound upload;
-- 2. finance and training projections must remain mutually isolated.

create or replace function internal.require_organization_capability(
  target_organization uuid,
  required_capability text
)
returns text
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  actor_role text;
begin
  select membership.role into actor_role
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.organization_id
  where membership.organization_id = target_organization
    and membership.person_id = actor
    and membership.active
    and organization.status = 'approved';

  if required_capability = 'workspace' then
    if actor_role is null
       or actor_role not in ('owner', 'training_manager', 'finance')
    then
      raise exception 'ORGANIZATION_WORKSPACE_NOT_AUTHORIZED';
    end if;
  elsif required_capability = 'finance_read' then
    if actor_role is null or actor_role not in ('owner', 'finance') then
      raise exception 'ORGANIZATION_FINANCE_NOT_AUTHORIZED';
    end if;
  elsif required_capability = 'training_read' then
    if actor_role is null
       or actor_role not in ('owner', 'training_manager')
    then
      raise exception 'ORGANIZATION_TRAINING_NOT_AUTHORIZED';
    end if;
  else
    raise exception 'UNKNOWN_ORGANIZATION_CAPABILITY';
  end if;

  return actor_role;
end
$$;

revoke all on function internal.require_organization_capability(uuid, text)
  from public, anon, authenticated, service_role;

-- Remove the attachment-dropping overload before publishing the corrected
-- signature. The public wrapper is dropped first because it depends on the
-- internal implementation.
revoke all on function public.submit_point_topup_proof(
  uuid, text, text, text, timestamptz, integer, uuid
) from public, anon, authenticated, service_role;
drop function public.submit_point_topup_proof(
  uuid, text, text, text, timestamptz, integer, uuid
);

revoke all on function internal.submit_point_topup_proof(
  uuid, text, text, text, timestamptz, integer, uuid
) from public, anon, authenticated, service_role;
drop function internal.submit_point_topup_proof(
  uuid, text, text, text, timestamptz, integer, uuid
);

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
       or prior_proof.promoted_object_path is distinct from object_path
       or prior_proof.content_sha256 is distinct from content_hash
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

  if (object_path is null) <> (content_hash is null) then
    raise exception 'SAFE_UPLOAD_REQUIRED';
  end if;

  if object_path is not null and not exists (
    select 1
    from public.upload_quarantine upload
    where upload.owner_person_id = actor
      and upload.purpose = 'payment_proof'
      and upload.status = 'promoted'
      and upload.promoted_object_path = object_path
      and upload.promoted_sha256 = content_hash
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
    object_path, content_hash,
    case when object_path is null then 'not_provided' else 'safe' end,
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
      'hasObject', object_path is not null
    )
  );

  return jsonb_build_object(
    'status', 'proof_submitted',
    'proofId', proof_id,
    'attachmentStatus',
      case when object_path is null then 'not_provided' else 'safe' end,
    'replayed', false
  );
end
$$;

revoke all on function internal.submit_point_topup_proof(
  uuid, text, text, text, timestamptz, integer, text, text, uuid
) from public, anon, authenticated, service_role;

create or replace function public.submit_point_topup_proof(
  p_topup_id uuid,
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
  select internal.submit_point_topup_proof(
    p_topup_id, p_remitter_name, p_bank_name, p_account_last_five,
    p_transferred_at, p_amount_twd, p_object_path, p_content_hash,
    p_idempotency_key
  )
$$;

revoke all on function public.submit_point_topup_proof(
  uuid, text, text, text, timestamptz, integer, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.submit_point_topup_proof(
  uuid, text, text, text, timestamptz, integer, text, text, uuid
) to authenticated;
grant execute on function public.submit_point_topup_proof(
  uuid, text, text, text, timestamptz, integer, text, text, uuid
) to authenticated;

-- The v2 projections predate the owner/training/finance split. They remain
-- implementation details only; authenticated callers must use the role-safe
-- v3 boundaries below.
revoke all on function internal.read_organization_workspace_details(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.read_organization_workspace_details(uuid)
  from public, anon, authenticated, service_role;
revoke all on function internal.read_organization_workspace_v2(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.read_organization_workspace_v2(uuid)
  from public, anon, authenticated, service_role;

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
  actor_role text;
  base jsonb;
  enriched_assignments jsonb;
begin
  actor_role := internal.require_organization_capability(
    target_organization, 'workspace'
  );
  base := internal.read_organization_workspace_v2(target_organization);

  if actor_role = 'training_manager' then
    base := jsonb_set(base, '{topups}', '[]'::jsonb, true);
    base := jsonb_set(base, '{invoices}', '[]'::jsonb, true);
  elsif actor_role = 'finance' then
    base := jsonb_set(base, '{members}', '[]'::jsonb, true);
    base := jsonb_set(base, '{invitations}', '[]'::jsonb, true);
    base := jsonb_set(base, '{assignments}', '[]'::jsonb, true);
    base := jsonb_set(base, '{liveBookings}', '[]'::jsonb, true);
    base := jsonb_set(base, '{outcomes}', '[]'::jsonb, true);
  end if;

  base := jsonb_set(
    base,
    '{capabilities}',
    coalesce(base -> 'capabilities', '{}'::jsonb) || jsonb_build_object(
      'canViewFinance', actor_role in ('owner', 'finance'),
      'canViewTraining', actor_role in ('owner', 'training_manager'),
      'canExportTrainingReport',
        actor_role in ('owner', 'training_manager')
    ),
    true
  );

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

revoke all on function internal.read_organization_training_report(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.read_organization_training_report(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function internal.read_organization_training_report_v2(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.read_organization_training_report_v2(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;

create or replace function internal.read_organization_training_report_v3(
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
  actor_role text;
  result jsonb;
begin
  actor_role := internal.require_organization_capability(
    target_organization, 'training_read'
  );
  result := internal.read_organization_training_report_v2(
    target_organization, filter_course_version, filter_live_session,
    filter_department, filter_status
  );
  if actor_role = 'training_manager' then
    result := jsonb_set(result, '{pointLedger}', '[]'::jsonb, true);
  end if;
  return result;
end
$$;

revoke all on function internal.read_organization_training_report_v3(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;

create or replace function public.read_organization_training_report_v3(
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
  select internal.read_organization_training_report_v3(
    p_organization_id, p_course_version_id, p_live_session_id,
    p_department, p_status
  )
$$;

revoke all on function public.read_organization_training_report_v3(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function internal.read_organization_training_report_v3(
  uuid, uuid, uuid, text, text
) to authenticated;
grant execute on function public.read_organization_training_report_v3(
  uuid, uuid, uuid, text, text
) to authenticated;
