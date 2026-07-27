-- API-facing authorization helpers. These deliberately expose only the
-- minimum preflight result needed before the application invokes KMS or uses
-- the service role. Final write RPCs remain the transaction authority.

create or replace function internal.require_current_person()
returns uuid
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select internal.current_person_id()
$$;

revoke all on function internal.require_current_person()
  from public, anon, authenticated;
grant execute on function internal.require_current_person()
  to authenticated;

create or replace function public.require_current_person()
returns uuid
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.require_current_person()
$$;

revoke all on function public.require_current_person()
  from public, anon, authenticated;
grant execute on function public.require_current_person()
  to authenticated;

create or replace function internal.authorize_organization_invitation_preparation(
  target_organization uuid,
  requested_role text
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
  if requested_role is not null
     and requested_role not in ('training_manager', 'finance', 'member')
  then
    raise exception 'ORGANIZATION_INVITATION_INVALID';
  end if;

  select membership.role into actor_role
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.organization_id
  where membership.organization_id = target_organization
    and membership.person_id = actor
    and membership.active
    and organization.status = 'approved';

  if actor_role not in ('owner', 'training_manager')
     or (
       requested_role is not null
       and actor_role = 'training_manager'
       and requested_role <> 'member'
     )
  then
    raise exception 'ORGANIZATION_MANAGER_REQUIRED';
  end if;

  return actor_role;
end
$$;

revoke all on function internal.authorize_organization_invitation_preparation(
  uuid, text
) from public, anon, authenticated;
grant execute on function internal.authorize_organization_invitation_preparation(
  uuid, text
) to authenticated;

create or replace function public.authorize_organization_invitation_preparation(
  p_organization_id uuid,
  p_requested_role text
)
returns text
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.authorize_organization_invitation_preparation(
    p_organization_id, p_requested_role
  )
$$;

revoke all on function public.authorize_organization_invitation_preparation(
  uuid, text
) from public, anon, authenticated;
grant execute on function public.authorize_organization_invitation_preparation(
  uuid, text
) to authenticated;

create or replace function internal.authorize_point_refund_preparation(
  target_organization uuid,
  target_topup uuid,
  requested_points bigint
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
  if requested_points <= 0
     or not internal.has_organization_role(
       target_organization, array['owner', 'finance']
     )
  then
    raise exception 'POINT_REFUND_REQUEST_REJECTED';
  end if;

  perform 1
  from public.point_topups topup
  join public.point_lots lot on lot.point_topup_id = topup.id
  where topup.id = target_topup
    and topup.organization_id = target_organization
    and topup.status in ('paid', 'partially_refunded')
    and lot.available_points >= requested_points;

  if not found then
    raise exception 'POINT_TOPUP_NOT_REFUNDABLE';
  end if;

  return actor;
end
$$;

revoke all on function internal.authorize_point_refund_preparation(
  uuid, uuid, bigint
) from public, anon, authenticated;
grant execute on function internal.authorize_point_refund_preparation(
  uuid, uuid, bigint
) to authenticated;

create or replace function public.authorize_point_refund_preparation(
  p_organization_id uuid,
  p_point_topup_id uuid,
  p_points bigint
)
returns uuid
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.authorize_point_refund_preparation(
    p_organization_id, p_point_topup_id, p_points
  )
$$;

revoke all on function public.authorize_point_refund_preparation(
  uuid, uuid, bigint
) from public, anon, authenticated;
grant execute on function public.authorize_point_refund_preparation(
  uuid, uuid, bigint
) to authenticated;

create or replace function internal.record_worker_heartbeat(
  submitted_worker_name text,
  succeeded boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  oldest_age interval;
  dead_letters integer;
begin
  if auth.role() <> 'service_role'
     or submitted_worker_name !~ '^[a-z0-9][a-z0-9_-]{1,63}$'
  then
    raise exception 'WORKER_SERVICE_AUTHORITY_REQUIRED';
  end if;

  select max(clock_timestamp() - job.created_at)
    into oldest_age
  from public.durable_jobs job
  where job.status in ('pending', 'retry')
    and job.available_at <= clock_timestamp();

  select count(*)::integer
    into dead_letters
  from public.durable_jobs job
  where job.status = 'dead_letter';

  insert into public.worker_heartbeats (
    worker_name,
    last_started_at,
    last_success_at,
    oldest_job_age,
    dead_letter_count,
    updated_at
  ) values (
    submitted_worker_name,
    clock_timestamp(),
    case when succeeded then clock_timestamp() end,
    oldest_age,
    dead_letters,
    clock_timestamp()
  )
  on conflict (worker_name) do update
  set last_started_at = case
        when succeeded then public.worker_heartbeats.last_started_at
        else excluded.last_started_at
      end,
      last_success_at = case
        when succeeded then excluded.last_success_at
        else public.worker_heartbeats.last_success_at
      end,
      oldest_job_age = excluded.oldest_job_age,
      dead_letter_count = excluded.dead_letter_count,
      updated_at = excluded.updated_at;
end
$$;

revoke all on function internal.record_worker_heartbeat(text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function internal.record_worker_heartbeat(text, boolean)
  to service_role;

create or replace function public.record_worker_heartbeat(
  p_worker_name text,
  p_succeeded boolean
)
returns void
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.record_worker_heartbeat(p_worker_name, p_succeeded)
$$;

revoke all on function public.record_worker_heartbeat(text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.record_worker_heartbeat(text, boolean)
  to service_role;

-- A Zoom setup may never inherit a successful safety attestation merely
-- because the provider columns were omitted. Existing rows are reset and must
-- be re-attested before host credentials can be issued.
alter table private.zoom_meetings
  add column accountless_join_enabled boolean not null default false,
  alter column waiting_room set default false,
  alter column participant_rename_disabled set default false,
  alter column participant_share_disabled set default false,
  alter column cloud_recording_disabled set default false,
  alter column removed_participant_rejoin_disabled set default false;

update private.zoom_meetings
set accountless_join_enabled = false,
    waiting_room = false,
    participant_rename_disabled = false,
    participant_share_disabled = false,
    cloud_recording_disabled = false,
    removed_participant_rejoin_disabled = false;

alter table public.zoom_host_reservations
  add column provider_request_claim_id uuid,
  add column provider_request_claimed_at timestamptz,
  add column provider_host_id_snapshot text,
  add constraint zoom_provider_claim_pair check (
    (
      provider_request_claim_id is null
      and provider_request_claimed_at is null
      and provider_host_id_snapshot is null
    )
    or (
      provider_request_claim_id is not null
      and provider_request_claimed_at is not null
      and length(trim(provider_host_id_snapshot)) between 1 and 200
    )
  );

create table public.zoom_setup_reconciliation_requests (
  id uuid primary key default gen_random_uuid(),
  live_session_id uuid not null references public.live_sessions(id),
  proposed_by uuid not null references public.people(id),
  resolution_kind text not null check (
    resolution_kind in ('confirm_not_created', 'register_existing')
  ),
  provider_meeting_number text,
  reason text not null check (length(trim(reason)) between 10 and 1000),
  evidence_reference text not null check (
    length(trim(evidence_reference)) between 3 and 500
  ),
  idempotency_key uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  check (
    (
      resolution_kind = 'confirm_not_created'
      and provider_meeting_number is null
    )
    or (
      resolution_kind = 'register_existing'
      and provider_meeting_number ~ '^[0-9]{9,12}$'
    )
  )
);

create table public.zoom_setup_reconciliation_decisions (
  id uuid primary key default gen_random_uuid(),
  reconciliation_request_id uuid not null unique
    references public.zoom_setup_reconciliation_requests(id),
  decided_by uuid not null references public.people(id),
  decision text not null check (decision in ('approve', 'reject')),
  reason text not null check (length(trim(reason)) between 10 and 1000),
  decided_at timestamptz not null default clock_timestamp()
);

alter table public.zoom_setup_reconciliation_requests
  enable row level security;
alter table public.zoom_setup_reconciliation_requests
  force row level security;
alter table public.zoom_setup_reconciliation_decisions
  enable row level security;
alter table public.zoom_setup_reconciliation_decisions
  force row level security;

create trigger zoom_setup_reconciliation_requests_append_only
before update or delete on public.zoom_setup_reconciliation_requests
for each row execute function internal.prevent_append_only_change();
create trigger zoom_setup_reconciliation_decisions_append_only
before update or delete on public.zoom_setup_reconciliation_decisions
for each row execute function internal.prevent_append_only_change();

revoke all on public.zoom_setup_reconciliation_requests
  from public, anon, authenticated, service_role;
revoke all on public.zoom_setup_reconciliation_decisions
  from public, anon, authenticated, service_role;

create or replace function internal.claim_zoom_meeting_provider_request(
  target_session uuid,
  submitted_claim_id uuid,
  submitted_provider_host_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  actor uuid := internal.current_person_id();
  reservation public.zoom_host_reservations%rowtype;
begin
  if not internal.has_staff_role('course_admin') then
    raise exception 'ZOOM_MEETING_PROVIDER_CLAIM_REJECTED';
  end if;

  select host_reservation.* into reservation
  from public.zoom_host_reservations host_reservation
  join public.live_sessions live_session
    on live_session.id = host_reservation.live_session_id
  where host_reservation.live_session_id = target_session
    and live_session.created_by = actor
  for update of host_reservation, live_session;

  if not found then
    raise exception 'ZOOM_MEETING_PROVIDER_CLAIM_REJECTED';
  end if;

  if reservation.status = 'reconciling'
     and reservation.provider_request_claim_id is not null
  then
    if reservation.provider_request_claim_id = submitted_claim_id
       and reservation.provider_host_id_snapshot =
         trim(submitted_provider_host_id)
    then
      return jsonb_build_object('claimed', true, 'reused', true);
    end if;
    return jsonb_build_object(
      'claimed', false,
      'reused', true,
      'claimedAt', reservation.provider_request_claimed_at
    );
  end if;

  if reservation.status <> 'pending'
     or reservation.expires_at <= clock_timestamp()
     or reservation.provider_request_claim_id is not null
     or length(trim(coalesce(submitted_provider_host_id, '')))
       not between 1 and 200
     or not exists (
       select 1
       from public.live_sessions live_session
       where live_session.id = target_session
         and live_session.status = 'draft'
     )
  then
    raise exception 'ZOOM_MEETING_PROVIDER_CLAIM_REJECTED';
  end if;

  update public.zoom_host_reservations
  set provider_request_claim_id = submitted_claim_id,
      provider_request_claimed_at = clock_timestamp(),
      provider_host_id_snapshot = trim(submitted_provider_host_id),
      status = 'reconciling'
  where live_session_id = target_session
    and status = 'pending';
  update public.live_sessions
  set status = 'reconciling'
  where id = target_session
    and status = 'draft';
  perform internal.append_audit_event(
    actor,
    'live.zoom_setup_provider_claimed',
    'live_session',
    target_session::text,
    'Zoom create request claimed; provider outcome must be receipted or dual-control reconciled',
    null,
    jsonb_build_object(
      'providerClaimId', submitted_claim_id,
      'providerHostIdSnapshot', trim(submitted_provider_host_id)
    )
  );
  return jsonb_build_object('claimed', true, 'reused', false);
end
$$;

revoke all on function internal.claim_zoom_meeting_provider_request(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function internal.claim_zoom_meeting_provider_request(
  uuid, uuid, text
) to authenticated;

create or replace function public.claim_zoom_meeting_provider_request(
  p_live_session_id uuid,
  p_claim_id uuid,
  p_provider_host_id text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.claim_zoom_meeting_provider_request(
    p_live_session_id, p_claim_id, p_provider_host_id
  )
$$;

revoke all on function public.claim_zoom_meeting_provider_request(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.claim_zoom_meeting_provider_request(
  uuid, uuid, text
) to authenticated;

create or replace function internal.finalize_verified_live_session_setup(
  target_session uuid,
  submitted_meeting_number text,
  submitted_meeting_uuid text,
  submitted_encrypted_passcode jsonb,
  submitted_provider_host_id text,
  verified_accountless_join_enabled boolean,
  verified_waiting_room boolean,
  verified_participant_rename_disabled boolean,
  verified_participant_share_disabled boolean,
  verified_cloud_recording_disabled boolean,
  verified_removed_participant_rejoin_disabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, internal
as $$
declare
  finalized boolean;
  attested_at timestamptz;
  receipt_created_at timestamptz;
  reservation_status text;
  live_session_status text;
  audit_actor uuid;
begin
  if auth.role() <> 'service_role'
     or not coalesce(verified_accountless_join_enabled, false)
     or not coalesce(verified_waiting_room, false)
     or not coalesce(verified_participant_rename_disabled, false)
     or not coalesce(verified_participant_share_disabled, false)
     or not coalesce(verified_cloud_recording_disabled, false)
     or not coalesce(verified_removed_participant_rejoin_disabled, false)
  then
    raise exception 'ZOOM_VERIFIED_CONFIGURATION_REQUIRED';
  end if;

  select
    (receipt.response_payload #>> '{safety,verifiedAt}')::timestamptz,
    receipt.created_at,
    reservation.status,
    live_session.status,
    coalesce((
      select decision.decided_by
      from public.zoom_setup_reconciliation_requests request
      join public.zoom_setup_reconciliation_decisions decision
        on decision.reconciliation_request_id = request.id
       and decision.decision = 'approve'
      where request.live_session_id = target_session
        and request.resolution_kind = 'register_existing'
      order by decision.decided_at desc
      limit 1
    ), live_session.created_by)
    into
      attested_at,
      receipt_created_at,
      reservation_status,
      live_session_status,
      audit_actor
  from public.zoom_host_reservations reservation
  join public.live_sessions live_session
    on live_session.id = reservation.live_session_id
  join public.provider_operation_receipts receipt
    on receipt.provider = 'zoom'
   and receipt.operation = 'create_meeting'
   and receipt.business_key =
     'zoom-meeting:' || reservation.live_session_id::text
  where reservation.live_session_id = target_session
    and reservation.status in ('pending', 'reconciling', 'confirmed')
    and live_session.status in ('draft', 'reconciling', 'scheduled')
    and reservation.provider_request_claim_id is not null
    and reservation.provider_request_claimed_at is not null
    and reservation.provider_host_id_snapshot =
      submitted_provider_host_id
    and receipt.created_at >= reservation.provider_request_claimed_at
    and receipt.provider_reference = submitted_meeting_number
    and receipt.response_payload ->> 'meetingNumber' =
      submitted_meeting_number
    and receipt.response_payload ->> 'meetingUuid' =
      submitted_meeting_uuid
    and receipt.response_payload ->> 'providerHostId' =
      submitted_provider_host_id
    and receipt.response_payload ->> 'meetingType' = '2'
    and receipt.response_payload ->> 'topic' = live_session.title
    and abs(extract(
      epoch from (
        (receipt.response_payload ->> 'startsAt')::timestamptz
          - live_session.starts_at
      )
    )) <= 60
    and (receipt.response_payload ->> 'durationMinutes')::integer =
      ceil(
        extract(epoch from live_session.ends_at - live_session.starts_at)
          / 60
      )::integer
    and receipt.response_payload -> 'encryptedPasscode' =
      submitted_encrypted_passcode
    and receipt.response_payload
      #>> '{safety,accountlessJoinEnabled}' = 'true'
    and receipt.response_payload #>> '{safety,waitingRoom}' = 'true'
    and receipt.response_payload
      #>> '{safety,participantRenameDisabled}' = 'true'
    and receipt.response_payload
      #>> '{safety,participantShareDisabled}' = 'true'
    and receipt.response_payload
      #>> '{safety,cloudRecordingDisabled}' = 'true'
    and receipt.response_payload
      #>> '{safety,removedParticipantRejoinDisabled}' = 'true'
  for update of reservation, live_session;

  if attested_at is null
     or receipt_created_at is null
     or abs(extract(epoch from receipt_created_at - attested_at)) > 120
     or attested_at > clock_timestamp() + interval '1 minute'
  then
    raise exception 'ZOOM_VERIFIED_RECEIPT_REQUIRED';
  end if;

  if live_session_status = 'scheduled'
     and reservation_status = 'confirmed'
  then
    perform 1
    from private.zoom_meetings meeting
    where meeting.live_session_id = target_session
      and meeting.meeting_number = submitted_meeting_number
      and meeting.meeting_uuid is not distinct from submitted_meeting_uuid
      and meeting.encrypted_passcode = submitted_encrypted_passcode
      and meeting.provider_host_id = submitted_provider_host_id
      and meeting.accountless_join_enabled
      and meeting.waiting_room
      and meeting.participant_rename_disabled
      and meeting.participant_share_disabled
      and meeting.cloud_recording_disabled
      and meeting.removed_participant_rejoin_disabled;
    if not found then
      raise exception 'ZOOM_VERIFIED_FINALIZE_REPLAY_MISMATCH';
    end if;
    return true;
  end if;

  if live_session_status = 'reconciling'
     and reservation_status = 'reconciling'
  then
    update public.live_sessions
    set status = 'draft'
    where id = target_session
      and status = 'reconciling';
    update public.zoom_host_reservations
    set status = 'pending',
        expires_at = greatest(
          coalesce(expires_at, clock_timestamp()),
          clock_timestamp() + interval '5 minutes'
        )
    where live_session_id = target_session
      and status = 'reconciling';
  elsif live_session_status <> 'draft'
        or reservation_status <> 'pending'
  then
    raise exception 'ZOOM_VERIFIED_FINALIZE_STATE_INVALID';
  end if;

  finalized := internal.finalize_live_session_setup(
    target_session,
    submitted_meeting_number,
    submitted_meeting_uuid,
    submitted_encrypted_passcode,
    submitted_provider_host_id
  );

  update private.zoom_meetings
  set accountless_join_enabled = verified_accountless_join_enabled,
      waiting_room = verified_waiting_room,
      participant_rename_disabled =
        verified_participant_rename_disabled,
      participant_share_disabled =
        verified_participant_share_disabled,
      cloud_recording_disabled =
        verified_cloud_recording_disabled,
      removed_participant_rejoin_disabled =
        verified_removed_participant_rejoin_disabled
  where live_session_id = target_session;

  if not found then
    raise exception 'ZOOM_VERIFIED_FINALIZE_FAILED';
  end if;
  perform internal.append_audit_event(
    audit_actor,
    'live.zoom_setup_verified',
    'live_session',
    target_session::text,
    'Provider receipt and fail-closed Zoom safety readback verified',
    null,
    jsonb_build_object(
      'meetingNumber', submitted_meeting_number,
      'providerHostId', submitted_provider_host_id,
      'safetyAttestedAt', attested_at
    )
  );
  return finalized;
end
$$;

revoke all on function internal.finalize_verified_live_session_setup(
  uuid, text, text, jsonb, text,
  boolean, boolean, boolean, boolean, boolean, boolean
) from public, anon, authenticated, service_role;
grant execute on function internal.finalize_verified_live_session_setup(
  uuid, text, text, jsonb, text,
  boolean, boolean, boolean, boolean, boolean, boolean
) to service_role;

create or replace function public.finalize_verified_live_session_setup(
  p_live_session_id uuid,
  p_meeting_number text,
  p_meeting_uuid text,
  p_encrypted_passcode jsonb,
  p_provider_host_id text,
  p_accountless_join_enabled boolean,
  p_waiting_room boolean,
  p_participant_rename_disabled boolean,
  p_participant_share_disabled boolean,
  p_cloud_recording_disabled boolean,
  p_removed_participant_rejoin_disabled boolean
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.finalize_verified_live_session_setup(
    p_live_session_id,
    p_meeting_number,
    p_meeting_uuid,
    p_encrypted_passcode,
    p_provider_host_id,
    p_accountless_join_enabled,
    p_waiting_room,
    p_participant_rename_disabled,
    p_participant_share_disabled,
    p_cloud_recording_disabled,
    p_removed_participant_rejoin_disabled
  )
$$;

revoke all on function public.finalize_verified_live_session_setup(
  uuid, text, text, jsonb, text,
  boolean, boolean, boolean, boolean, boolean, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_verified_live_session_setup(
  uuid, text, text, jsonb, text,
  boolean, boolean, boolean, boolean, boolean, boolean
) to service_role;

create or replace function internal.fail_claimed_live_session_setup(
  target_session uuid,
  submitted_reason text,
  provider_delete_confirmed boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  audit_actor uuid;
begin
  if auth.role() <> 'service_role'
     or not coalesce(provider_delete_confirmed, false)
     or length(trim(submitted_reason)) < 3
  then
    raise exception 'ZOOM_PROVIDER_DELETE_CONFIRMATION_REQUIRED';
  end if;

  select live_session.created_by into audit_actor
  from public.live_sessions live_session
  join public.zoom_host_reservations reservation
    on reservation.live_session_id = live_session.id
  where live_session.id = target_session
    and live_session.status = 'reconciling'
    and reservation.status = 'reconciling'
    and reservation.provider_request_claim_id is not null
    and not exists (
      select 1
      from public.provider_operation_receipts receipt
      where receipt.provider = 'zoom'
        and receipt.operation = 'create_meeting'
        and receipt.business_key =
          'zoom-meeting:' || target_session::text
    )
  for update of live_session, reservation;
  if not found then
    raise exception 'ZOOM_CLAIMED_SETUP_NOT_FAILABLE';
  end if;

  update public.live_sessions
  set status = 'cancelled'
  where id = target_session
    and status = 'reconciling';
  update public.zoom_host_reservations
  set status = 'released',
      expires_at = null
  where live_session_id = target_session
    and status = 'reconciling';
  insert into public.reconciliation_cases (
    kind, status, reason
  ) values (
    'capacity_unavailable',
    'open',
    left(
      'Zoom setup safely abandoned after confirmed provider deletion: '
        || trim(submitted_reason),
      1000
    )
  );
  perform internal.append_audit_event(
    audit_actor,
    'live.zoom_setup_provider_deleted',
    'live_session',
    target_session::text,
    trim(submitted_reason),
    null,
    jsonb_build_object('providerDeleteConfirmed', true)
  );
  return true;
end
$$;

revoke all on function internal.fail_claimed_live_session_setup(
  uuid, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function internal.fail_claimed_live_session_setup(
  uuid, text, boolean
) to service_role;

create or replace function public.fail_claimed_live_session_setup(
  p_live_session_id uuid,
  p_reason text,
  p_provider_delete_confirmed boolean
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.fail_claimed_live_session_setup(
    p_live_session_id,
    p_reason,
    p_provider_delete_confirmed
  )
$$;

revoke all on function public.fail_claimed_live_session_setup(
  uuid, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.fail_claimed_live_session_setup(
  uuid, text, boolean
) to service_role;

-- The original step-up issuer used a fixed allow-list. Provider-side-effect
-- reconciliation is intentionally a separate capability from attendance
-- overrides, so neither grant can be replayed for the other operation.
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
       'platform_prerequisite_review', 'provider_reconcile'
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
  from public, anon, authenticated;
grant execute on function internal.issue_step_up_grant(text, text, text)
  to authenticated;

create or replace function internal.propose_zoom_setup_reconciliation(
  target_session uuid,
  submitted_resolution_kind text,
  submitted_provider_meeting_number text,
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
  normalized_meeting_number text :=
    nullif(trim(submitted_provider_meeting_number), '');
  existing_request public.zoom_setup_reconciliation_requests%rowtype;
  request_id uuid;
begin
  select request.* into existing_request
  from public.zoom_setup_reconciliation_requests request
  where request.idempotency_key = idempotency;
  if found then
    if existing_request.proposed_by <> actor
       or existing_request.live_session_id <> target_session
       or existing_request.resolution_kind <> submitted_resolution_kind
       or existing_request.provider_meeting_number
         is distinct from normalized_meeting_number
       or existing_request.reason is distinct from trim(submitted_reason)
       or existing_request.evidence_reference
         is distinct from trim(submitted_evidence_reference)
    then
      raise exception 'ZOOM_RECONCILIATION_IDEMPOTENCY_MISMATCH';
    end if;
    return existing_request.id;
  end if;

  perform internal.consume_step_up_grant(
    'provider_reconcile',
    target_session::text,
    submitted_nonce_hash
  );
  if not internal.has_staff_role('course_admin')
     or submitted_resolution_kind not in (
       'confirm_not_created', 'register_existing'
     )
     or length(trim(submitted_reason)) not between 10 and 1000
     or length(trim(submitted_evidence_reference)) not between 3 and 500
     or (
       submitted_resolution_kind = 'confirm_not_created'
       and normalized_meeting_number is not null
     )
     or (
       submitted_resolution_kind = 'register_existing'
       and coalesce(normalized_meeting_number, '') !~ '^[0-9]{9,12}$'
     )
  then
    raise exception 'ZOOM_RECONCILIATION_PROPOSAL_REJECTED';
  end if;

  perform 1
  from public.live_sessions live_session
  join public.zoom_host_reservations reservation
    on reservation.live_session_id = live_session.id
  where live_session.id = target_session
    and live_session.status = 'reconciling'
    and reservation.status = 'reconciling'
    and reservation.provider_request_claim_id is not null
    and reservation.provider_request_claimed_at is not null
    and reservation.provider_request_claimed_at <=
      clock_timestamp() - interval '15 minutes'
  for update of live_session, reservation;
  if not found
     or exists (
       select 1
       from public.provider_operation_receipts receipt
       where receipt.provider = 'zoom'
         and receipt.operation = 'create_meeting'
         and receipt.business_key =
           'zoom-meeting:' || target_session::text
     )
     or exists (
       select 1
       from public.zoom_setup_reconciliation_requests request
       left join public.zoom_setup_reconciliation_decisions decision
         on decision.reconciliation_request_id = request.id
       where request.live_session_id = target_session
         and decision.id is null
     )
     or exists (
       select 1
       from public.durable_jobs job
       where job.job_type = 'zoom_setup_reconcile'
         and job.payload ->> 'liveSessionId' = target_session::text
         and job.status in ('pending', 'retry', 'leased')
     )
  then
    raise exception 'ZOOM_RECONCILIATION_NOT_PROPOSABLE';
  end if;

  insert into public.zoom_setup_reconciliation_requests (
    live_session_id,
    proposed_by,
    resolution_kind,
    provider_meeting_number,
    reason,
    evidence_reference,
    idempotency_key
  ) values (
    target_session,
    actor,
    submitted_resolution_kind,
    normalized_meeting_number,
    trim(submitted_reason),
    trim(submitted_evidence_reference),
    idempotency
  )
  returning id into request_id;
  perform internal.append_audit_event(
    actor,
    'live.zoom_setup_reconciliation_proposed',
    'zoom_setup_reconciliation_request',
    request_id::text,
    trim(submitted_reason),
    null,
    jsonb_build_object(
      'liveSessionId', target_session,
      'resolutionKind', submitted_resolution_kind,
      'evidenceReference', trim(submitted_evidence_reference)
    )
  );
  return request_id;
end
$$;

revoke all on function internal.propose_zoom_setup_reconciliation(
  uuid, text, text, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function internal.propose_zoom_setup_reconciliation(
  uuid, text, text, text, text, uuid, text
) to authenticated;

create or replace function public.propose_zoom_setup_reconciliation(
  p_live_session_id uuid,
  p_resolution_kind text,
  p_provider_meeting_number text,
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
  select internal.propose_zoom_setup_reconciliation(
    p_live_session_id,
    p_resolution_kind,
    p_provider_meeting_number,
    p_reason,
    p_evidence_reference,
    p_idempotency_key,
    p_nonce_hash
  )
$$;

revoke all on function public.propose_zoom_setup_reconciliation(
  uuid, text, text, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.propose_zoom_setup_reconciliation(
  uuid, text, text, text, text, uuid, text
) to authenticated;

create or replace function internal.decide_zoom_setup_reconciliation(
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
  request_row public.zoom_setup_reconciliation_requests%rowtype;
  existing_decision public.zoom_setup_reconciliation_decisions%rowtype;
  job_id uuid;
begin
  select decision.* into existing_decision
  from public.zoom_setup_reconciliation_decisions decision
  where decision.reconciliation_request_id = target_request;
  if found then
    if existing_decision.decided_by <> actor
       or existing_decision.decision <> submitted_decision
       or existing_decision.reason is distinct from trim(submitted_reason)
    then
      raise exception 'ZOOM_RECONCILIATION_DECISION_REPLAY_MISMATCH';
    end if;
    return case existing_decision.decision
      when 'reject' then 'rejected'
      else 'approved'
    end;
  end if;

  perform internal.consume_step_up_grant(
    'provider_reconcile',
    target_request::text,
    submitted_nonce_hash
  );
  if not internal.has_staff_role('accreditation_reviewer')
     or submitted_decision not in ('approve', 'reject')
     or length(trim(submitted_reason)) not between 10 and 1000
  then
    raise exception 'ZOOM_RECONCILIATION_DECISION_REJECTED';
  end if;

  select request.* into request_row
  from public.zoom_setup_reconciliation_requests request
  where request.id = target_request
  for update;
  if not found or request_row.proposed_by = actor then
    raise exception 'DISTINCT_ZOOM_RECONCILIATION_REVIEWER_REQUIRED';
  end if;
  perform 1
  from public.live_sessions live_session
  join public.zoom_host_reservations reservation
    on reservation.live_session_id = live_session.id
  where live_session.id = request_row.live_session_id
    and live_session.status = 'reconciling'
    and reservation.status = 'reconciling'
    and reservation.provider_request_claim_id is not null
    and reservation.provider_request_claimed_at is not null
    and reservation.provider_request_claimed_at <=
      clock_timestamp() - interval '15 minutes'
  for update of live_session, reservation;
  if not found then
    raise exception 'ZOOM_RECONCILIATION_STATE_CHANGED';
  end if;

  insert into public.zoom_setup_reconciliation_decisions (
    reconciliation_request_id,
    decided_by,
    decision,
    reason
  ) values (
    target_request,
    actor,
    submitted_decision,
    trim(submitted_reason)
  );
  if submitted_decision = 'reject' then
    perform internal.append_audit_event(
      actor,
      'live.zoom_setup_reconciliation_rejected',
      'zoom_setup_reconciliation_request',
      target_request::text,
      trim(submitted_reason),
      null,
      jsonb_build_object('liveSessionId', request_row.live_session_id)
    );
    return 'rejected';
  end if;

  if exists (
       select 1
       from public.provider_operation_receipts receipt
       where receipt.provider = 'zoom'
         and receipt.operation = 'create_meeting'
         and receipt.business_key =
           'zoom-meeting:' || request_row.live_session_id::text
     )
  then
    raise exception 'ZOOM_RECONCILIATION_RECEIPT_ALREADY_EXISTS';
  end if;

  if request_row.resolution_kind = 'confirm_not_created' then
    if exists (
      select 1
      from public.durable_jobs job
      where job.job_type = 'zoom_setup_reconcile'
        and job.payload ->> 'liveSessionId' =
          request_row.live_session_id::text
        and job.status in ('pending', 'retry', 'leased')
    ) then
      raise exception 'ZOOM_RECONCILIATION_JOB_ACTIVE';
    end if;
    update public.live_sessions
    set status = 'draft'
    where id = request_row.live_session_id
      and status = 'reconciling';
    update public.zoom_host_reservations
    set status = 'pending',
        expires_at = clock_timestamp() + interval '15 minutes',
        provider_request_claim_id = null,
        provider_request_claimed_at = null,
        provider_host_id_snapshot = null
    where live_session_id = request_row.live_session_id
      and status = 'reconciling';
    perform internal.append_audit_event(
      actor,
      'live.zoom_setup_retry_released',
      'zoom_setup_reconciliation_request',
      target_request::text,
      trim(submitted_reason),
      null,
      jsonb_build_object(
        'liveSessionId', request_row.live_session_id,
        'proposedBy', request_row.proposed_by,
        'approvedBy', actor,
        'evidenceReference', request_row.evidence_reference
      )
    );
    return 'retry_released';
  end if;

  insert into public.durable_jobs (
    job_type,
    business_key,
    payload
  ) values (
    'zoom_setup_reconcile',
    'zoom-setup-reconcile:' || target_request::text,
    jsonb_build_object(
      'reconciliationRequestId', target_request,
      'liveSessionId', request_row.live_session_id,
      'providerMeetingNumber', request_row.provider_meeting_number
    )
  )
  returning id into job_id;
  perform internal.append_audit_event(
    actor,
    'live.zoom_setup_existing_registration_approved',
    'zoom_setup_reconciliation_request',
    target_request::text,
    trim(submitted_reason),
    null,
    jsonb_build_object(
      'liveSessionId', request_row.live_session_id,
      'proposedBy', request_row.proposed_by,
      'approvedBy', actor,
      'durableJobId', job_id,
      'evidenceReference', request_row.evidence_reference
    )
  );
  return 'queued';
end
$$;

revoke all on function internal.decide_zoom_setup_reconciliation(
  uuid, text, text, text
) from public, anon, authenticated;
grant execute on function internal.decide_zoom_setup_reconciliation(
  uuid, text, text, text
) to authenticated;

create or replace function public.decide_zoom_setup_reconciliation(
  p_reconciliation_request_id uuid,
  p_decision text,
  p_reason text,
  p_nonce_hash text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.decide_zoom_setup_reconciliation(
    p_reconciliation_request_id,
    p_decision,
    p_reason,
    p_nonce_hash
  )
$$;

revoke all on function public.decide_zoom_setup_reconciliation(
  uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.decide_zoom_setup_reconciliation(
  uuid, text, text, text
) to authenticated;

create or replace function internal.read_zoom_setup_reconciliation_context(
  target_job uuid
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
    raise exception 'ZOOM_RECONCILIATION_SERVICE_REQUIRED';
  end if;
  select jsonb_build_object(
    'reconciliationRequestId', request.id,
    'liveSessionId', request.live_session_id,
    'providerMeetingNumber', request.provider_meeting_number,
    'expectedProviderHostId', reservation.provider_host_id_snapshot,
    'expectedTopic', live_session.title,
    'expectedStartsAt', live_session.starts_at,
    'expectedDurationMinutes', ceil(
      extract(epoch from live_session.ends_at - live_session.starts_at)
        / 60
    )::integer
  )
  into result
  from public.durable_jobs job
  join public.zoom_setup_reconciliation_requests request
    on request.id =
      (job.payload ->> 'reconciliationRequestId')::uuid
  join public.zoom_setup_reconciliation_decisions decision
    on decision.reconciliation_request_id = request.id
   and decision.decision = 'approve'
  join public.live_sessions live_session
    on live_session.id = request.live_session_id
  join public.zoom_host_reservations reservation
    on reservation.live_session_id = live_session.id
  where job.id = target_job
    and job.job_type = 'zoom_setup_reconcile'
    and job.status = 'leased'
    and request.resolution_kind = 'register_existing'
    and request.provider_meeting_number =
      job.payload ->> 'providerMeetingNumber'
    and reservation.provider_request_claim_id is not null
    and reservation.provider_request_claimed_at is not null
    and reservation.provider_host_id_snapshot is not null
    and (
      (
        live_session.status = 'reconciling'
        and reservation.status = 'reconciling'
      )
      or (
        live_session.status = 'scheduled'
        and reservation.status = 'confirmed'
      )
    );
  if result is null then
    raise exception 'ZOOM_RECONCILIATION_CONTEXT_INVALID';
  end if;
  return result;
end
$$;

revoke all on function internal.read_zoom_setup_reconciliation_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.read_zoom_setup_reconciliation_context(uuid)
  to service_role;

create or replace function public.read_zoom_setup_reconciliation_context(
  p_job_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_zoom_setup_reconciliation_context(p_job_id)
$$;

revoke all on function public.read_zoom_setup_reconciliation_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_zoom_setup_reconciliation_context(uuid)
  to service_role;

create or replace function internal.enqueue_zoom_orphan_cleanup(
  target_session uuid,
  submitted_provider_meeting_number text,
  submitted_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  job_id uuid;
  audit_actor uuid;
  inserted_job boolean := false;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or length(trim(coalesce(submitted_provider_meeting_number, '')))
       not between 1 and 32
     or length(trim(coalesce(submitted_reason, ''))) not between 3 and 1000
  then
    raise exception 'ZOOM_ORPHAN_CLEANUP_REJECTED';
  end if;

  select live_session.created_by into audit_actor
  from public.live_sessions live_session
  where live_session.id = target_session;
  if not found then
    raise exception 'ZOOM_ORPHAN_CLEANUP_SESSION_INVALID';
  end if;

  insert into public.durable_jobs (
    job_type,
    business_key,
    payload
  ) values (
    'zoom_orphan_cleanup',
    'zoom-orphan-cleanup:' ||
      trim(submitted_provider_meeting_number),
    jsonb_build_object(
      'liveSessionId', target_session,
      'providerMeetingNumber',
        trim(submitted_provider_meeting_number),
      'reason', trim(submitted_reason)
    )
  )
  on conflict (business_key) do nothing
  returning id into job_id;
  inserted_job := job_id is not null;

  if not inserted_job then
    select job.id into job_id
    from public.durable_jobs job
    where job.business_key =
        'zoom-orphan-cleanup:' ||
          trim(submitted_provider_meeting_number)
      and job.job_type = 'zoom_orphan_cleanup'
      and job.payload ->> 'liveSessionId' = target_session::text
      and job.payload ->> 'providerMeetingNumber' =
        trim(submitted_provider_meeting_number);
    if job_id is null then
      raise exception 'ZOOM_ORPHAN_CLEANUP_REPLAY_MISMATCH';
    end if;
  else
    perform internal.append_audit_event(
      audit_actor,
      'live.zoom_orphan_cleanup_enqueued',
      'durable_job',
      job_id::text,
      trim(submitted_reason),
      null,
      jsonb_build_object(
        'liveSessionId', target_session,
        'providerMeetingNumber',
          trim(submitted_provider_meeting_number)
      )
    );
  end if;
  return job_id;
end
$$;

revoke all on function internal.enqueue_zoom_orphan_cleanup(
  uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function internal.enqueue_zoom_orphan_cleanup(
  uuid, text, text
) to service_role;

create or replace function public.enqueue_zoom_orphan_cleanup(
  p_live_session_id uuid,
  p_provider_meeting_number text,
  p_reason text
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.enqueue_zoom_orphan_cleanup(
    p_live_session_id,
    p_provider_meeting_number,
    p_reason
  )
$$;

revoke all on function public.enqueue_zoom_orphan_cleanup(
  uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_zoom_orphan_cleanup(
  uuid, text, text
) to service_role;

create or replace function internal.read_zoom_orphan_cleanup_context(
  target_job uuid,
  worker_id text
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
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or length(trim(coalesce(worker_id, ''))) = 0
  then
    raise exception 'ZOOM_ORPHAN_CLEANUP_SERVICE_REQUIRED';
  end if;

  select jsonb_build_object(
    'liveSessionId', live_session.id,
    'providerMeetingNumber',
      job.payload ->> 'providerMeetingNumber',
    'authoritativeReceiptReference', receipt.provider_reference
  )
  into result
  from public.durable_jobs job
  join public.live_sessions live_session
    on live_session.id =
      (job.payload ->> 'liveSessionId')::uuid
  left join public.provider_operation_receipts receipt
    on receipt.provider = 'zoom'
   and receipt.operation = 'create_meeting'
   and receipt.business_key =
     'zoom-meeting:' || live_session.id::text
  where job.id = target_job
    and job.job_type = 'zoom_orphan_cleanup'
    and job.status = 'leased'
    and job.lease_owner = worker_id
    and job.business_key =
      'zoom-orphan-cleanup:' ||
        (job.payload ->> 'providerMeetingNumber');
  if result is null then
    raise exception 'ZOOM_ORPHAN_CLEANUP_CONTEXT_INVALID';
  end if;
  return result;
end
$$;

revoke all on function internal.read_zoom_orphan_cleanup_context(
  uuid, text
) from public, anon, authenticated, service_role;
grant execute on function internal.read_zoom_orphan_cleanup_context(
  uuid, text
) to service_role;

create or replace function public.read_zoom_orphan_cleanup_context(
  p_job_id uuid,
  p_worker_id text
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_zoom_orphan_cleanup_context(
    p_job_id, p_worker_id
  )
$$;

revoke all on function public.read_zoom_orphan_cleanup_context(
  uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.read_zoom_orphan_cleanup_context(
  uuid, text
) to service_role;

create or replace function internal.complete_zoom_orphan_cleanup(
  target_job uuid,
  worker_id text,
  provider_delete_confirmed boolean,
  preserved_authoritative boolean
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  job public.durable_jobs%rowtype;
  target_session uuid;
  orphan_meeting_number text;
  authoritative_reference text;
  audit_actor uuid;
  live_status text;
  reservation_status text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or length(trim(coalesce(worker_id, ''))) = 0
  then
    raise exception 'ZOOM_ORPHAN_CLEANUP_SERVICE_REQUIRED';
  end if;

  select durable_job.* into job
  from public.durable_jobs durable_job
  where durable_job.id = target_job
    and durable_job.job_type = 'zoom_orphan_cleanup'
    and durable_job.status = 'leased'
    and durable_job.lease_owner = worker_id
  for update;
  if not found then
    raise exception 'ZOOM_ORPHAN_CLEANUP_LEASE_MISMATCH';
  end if;

  target_session := (job.payload ->> 'liveSessionId')::uuid;
  orphan_meeting_number := job.payload ->> 'providerMeetingNumber';
  if job.business_key is distinct from
       'zoom-orphan-cleanup:' || orphan_meeting_number
  then
    raise exception 'ZOOM_ORPHAN_CLEANUP_JOB_INVALID';
  end if;

  select
    live_session.created_by,
    live_session.status,
    reservation.status
  into audit_actor, live_status, reservation_status
  from public.live_sessions live_session
  join public.zoom_host_reservations reservation
    on reservation.live_session_id = live_session.id
  where live_session.id = target_session
  for update of live_session, reservation;
  if not found then
    raise exception 'ZOOM_ORPHAN_CLEANUP_SESSION_INVALID';
  end if;

  select receipt.provider_reference into authoritative_reference
  from public.provider_operation_receipts receipt
  where receipt.provider = 'zoom'
    and receipt.operation = 'create_meeting'
    and receipt.business_key =
      'zoom-meeting:' || target_session::text;

  if authoritative_reference = orphan_meeting_number then
    if not coalesce(preserved_authoritative, false)
       or coalesce(provider_delete_confirmed, false)
    then
      raise exception 'ZOOM_ORPHAN_CLEANUP_AUTHORITATIVE_PRESERVE_REQUIRED';
    end if;
  else
    if not coalesce(provider_delete_confirmed, false)
       or coalesce(preserved_authoritative, false)
    then
      raise exception 'ZOOM_ORPHAN_DELETE_CONFIRMATION_REQUIRED';
    end if;
    if authoritative_reference is null then
      if live_status = 'reconciling'
         and reservation_status = 'reconciling'
      then
        update public.live_sessions
        set status = 'cancelled'
        where id = target_session
          and status = 'reconciling';
        update public.zoom_host_reservations
        set status = 'released',
            expires_at = null
        where live_session_id = target_session
          and status = 'reconciling';
        insert into public.reconciliation_cases (
          kind, status, reason
        ) values (
          'capacity_unavailable',
          'open',
          left(
            'Zoom orphan meeting deletion confirmed: ' ||
              orphan_meeting_number,
            1000
          )
        );
      elsif not (
        (live_status = 'draft' and reservation_status = 'pending')
        or (
          live_status = 'cancelled'
          and reservation_status = 'released'
        )
      ) then
        raise exception 'ZOOM_ORPHAN_CLEANUP_STATE_INVALID';
      end if;
    end if;
  end if;

  update public.durable_jobs
  set status = 'completed',
      completed_at = clock_timestamp(),
      lease_owner = null,
      lease_expires_at = null,
      last_error = null,
      payload = payload || jsonb_build_object(
        'resolution',
        case
          when authoritative_reference = orphan_meeting_number
            then 'preserved_authoritative'
          else 'provider_delete_confirmed'
        end
      )
  where id = target_job;

  perform internal.append_audit_event(
    audit_actor,
    case
      when authoritative_reference = orphan_meeting_number
        then 'live.zoom_orphan_cleanup_preserved_authoritative'
      else 'live.zoom_orphan_cleanup_completed'
    end,
    'durable_job',
    target_job::text,
    case
      when authoritative_reference = orphan_meeting_number
        then 'Authoritative immutable receipt prevented provider deletion'
      else 'Zoom provider deletion returned 204 or 404'
    end,
    null,
    jsonb_build_object(
      'liveSessionId', target_session,
      'providerMeetingNumber', orphan_meeting_number,
      'authoritativeReceiptReference', authoritative_reference
    )
  );
  return 'completed';
end
$$;

revoke all on function internal.complete_zoom_orphan_cleanup(
  uuid, text, boolean, boolean
) from public, anon, authenticated, service_role;
grant execute on function internal.complete_zoom_orphan_cleanup(
  uuid, text, boolean, boolean
) to service_role;

create or replace function public.complete_zoom_orphan_cleanup(
  p_job_id uuid,
  p_worker_id text,
  p_provider_delete_confirmed boolean,
  p_preserved_authoritative boolean
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.complete_zoom_orphan_cleanup(
    p_job_id,
    p_worker_id,
    p_provider_delete_confirmed,
    p_preserved_authoritative
  )
$$;

revoke all on function public.complete_zoom_orphan_cleanup(
  uuid, text, boolean, boolean
) from public, anon, authenticated, service_role;

-- A worker identity is not a sufficient lease fence: an expired lease can be
-- reclaimed by the same process identity. A monotonically increasing
-- generation makes every claim unique and prevents stale completion (ABA).
alter table public.durable_jobs
  add column lease_generation bigint not null default 0
  check (lease_generation >= 0);

create index durable_jobs_recoverable_claim_idx
on public.durable_jobs (
  status,
  lease_expires_at,
  available_at,
  created_at
)
where status in ('pending', 'retry', 'leased');

create or replace function internal.read_live_join_expiry_context(
  target_lease uuid,
  target_person uuid,
  target_job uuid,
  worker_id text,
  expected_lease_generation bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, internal
as $$
declare
  result jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or expected_lease_generation <= 0
  then
    raise exception 'LIVE_JOIN_SERVICE_REQUIRED';
  end if;
  perform 1
  from public.durable_jobs job
  where job.id = target_job
    and job.job_type = 'live_join_lease_expiry'
    and job.status = 'leased'
    and job.lease_owner = worker_id
    and job.lease_generation = expected_lease_generation
    and job.payload ->> 'leaseId' = target_lease::text
    and job.payload ->> 'personId' = target_person::text
  for update;
  if not found then
    raise exception 'LIVE_JOIN_EXPIRY_LEASE_GENERATION_MISMATCH';
  end if;
  result := internal.read_live_join_expiry_context(
    target_lease,
    target_person
  );
  return result;
end
$$;

revoke all on function internal.read_live_join_expiry_context(
  uuid, uuid, uuid, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function internal.read_live_join_expiry_context(
  uuid, uuid, uuid, text, bigint
) to service_role;

create or replace function public.read_live_join_expiry_context(
  p_lease_id uuid,
  p_person_id uuid,
  p_job_id uuid,
  p_worker_id text,
  p_lease_generation bigint
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.read_live_join_expiry_context(
    p_lease_id,
    p_person_id,
    p_job_id,
    p_worker_id,
    p_lease_generation
  )
$$;

revoke all on function public.read_live_join_expiry_context(
  uuid, uuid, uuid, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.read_live_join_expiry_context(
  uuid, uuid, uuid, text, bigint
) to service_role;
revoke all on function internal.read_live_join_expiry_context(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.read_live_join_expiry_context(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function internal.expire_live_join_credential(
  target_lease uuid,
  target_job uuid,
  worker_id text,
  expected_lease_generation bigint,
  registrant_was_revoked boolean,
  submitted_reason text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, internal
as $$
declare
  result jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or expected_lease_generation <= 0
  then
    raise exception 'LIVE_CREDENTIAL_EXPIRY_REJECTED';
  end if;
  perform 1
  from public.durable_jobs job
  where job.id = target_job
    and job.job_type = 'live_join_lease_expiry'
    and job.status = 'leased'
    and job.lease_owner = worker_id
    and job.lease_generation = expected_lease_generation
    and job.payload ->> 'leaseId' = target_lease::text
  for update;
  if not found then
    raise exception 'LIVE_JOIN_EXPIRY_LEASE_GENERATION_MISMATCH';
  end if;
  result := internal.expire_live_join_credential(
    target_lease,
    registrant_was_revoked,
    submitted_reason,
    idempotency
  );
  return result;
end
$$;

revoke all on function internal.expire_live_join_credential(
  uuid, uuid, text, bigint, boolean, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.expire_live_join_credential(
  uuid, uuid, text, bigint, boolean, text, uuid
) to service_role;

create or replace function public.expire_live_join_credential(
  p_lease_id uuid,
  p_job_id uuid,
  p_worker_id text,
  p_lease_generation bigint,
  p_registrant_revoked boolean,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.expire_live_join_credential(
    p_lease_id,
    p_job_id,
    p_worker_id,
    p_lease_generation,
    p_registrant_revoked,
    p_reason,
    p_idempotency_key
  )
$$;

revoke all on function public.expire_live_join_credential(
  uuid, uuid, text, bigint, boolean, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.expire_live_join_credential(
  uuid, uuid, text, bigint, boolean, text, uuid
) to service_role;
revoke all on function internal.expire_live_join_credential(
  uuid, boolean, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.expire_live_join_credential(
  uuid, boolean, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.complete_zoom_orphan_cleanup(
  uuid, text, boolean, boolean
) to service_role;

create or replace function internal.read_zoom_setup_reconciliation_worklist()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, internal
as $$
declare
  actor uuid := internal.current_person_id();
  result jsonb;
begin
  if not (
    internal.has_staff_role('course_admin')
    or internal.has_staff_role('accreditation_reviewer')
  ) then
    raise exception 'ZOOM_RECONCILIATION_WORKLIST_REJECTED';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'liveSessionId', live_session.id,
    'title', live_session.title,
    'claimedAt', reservation.provider_request_claimed_at,
    'claimEligibleAt',
      reservation.provider_request_claimed_at + interval '15 minutes',
    'requestId', latest_request.id,
    'resolutionKind', latest_request.resolution_kind,
    'providerMeetingNumber', latest_request.provider_meeting_number,
    'proposalReason', latest_request.reason,
    'evidenceReference', latest_request.evidence_reference,
    'proposedAt', latest_request.created_at,
    'reviewStatus',
      case
        when latest_request.id is null
             and reservation.provider_request_claimed_at >
               clock_timestamp() - interval '15 minutes'
          then 'provider_request_in_flight'
        when latest_request.id is null
          then 'proposal_required'
        when latest_decision.id is null
          then 'awaiting_review'
        when latest_decision.decision = 'reject'
          then 'rejected'
        when latest_job.status in ('pending', 'retry', 'leased')
          then 'provider_verification'
        when latest_job.status = 'dead_letter'
          then 'provider_verification_failed'
        else 'provider_verification_complete'
      end,
    'jobStatus', latest_job.status,
    'canPropose',
      internal.has_staff_role('course_admin')
      and reservation.provider_request_claimed_at <=
        clock_timestamp() - interval '15 minutes'
      and (
        latest_request.id is null
        or latest_decision.decision = 'reject'
      )
      and latest_job.id is null,
    'canDecide',
      latest_request.id is not null
      and latest_decision.id is null
      and latest_request.proposed_by <> actor
      and internal.has_staff_role('accreditation_reviewer')
  ) order by reservation.provider_request_claimed_at), '[]'::jsonb)
  into result
  from public.live_sessions live_session
  join public.zoom_host_reservations reservation
    on reservation.live_session_id = live_session.id
  left join lateral (
    select request.*
    from public.zoom_setup_reconciliation_requests request
    where request.live_session_id = live_session.id
    order by request.created_at desc
    limit 1
  ) latest_request on true
  left join public.zoom_setup_reconciliation_decisions latest_decision
    on latest_decision.reconciliation_request_id = latest_request.id
  left join lateral (
    select job.*
    from public.durable_jobs job
    where job.job_type = 'zoom_setup_reconcile'
      and job.business_key =
        'zoom-setup-reconcile:' || latest_request.id::text
    order by job.created_at desc
    limit 1
  ) latest_job on true
  where live_session.status = 'reconciling'
    and reservation.status = 'reconciling'
    and reservation.provider_request_claim_id is not null
    and reservation.provider_request_claimed_at is not null
    and not exists (
      select 1
      from public.provider_operation_receipts receipt
      where receipt.provider = 'zoom'
        and receipt.operation = 'create_meeting'
        and receipt.business_key =
          'zoom-meeting:' || live_session.id::text
    );

  return result;
end
$$;

revoke all on function internal.read_zoom_setup_reconciliation_worklist()
  from public, anon, authenticated;
grant execute on function internal.read_zoom_setup_reconciliation_worklist()
  to authenticated;

create or replace function public.read_zoom_setup_reconciliation_worklist()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_zoom_setup_reconciliation_worklist()
$$;

revoke all on function public.read_zoom_setup_reconciliation_worklist()
  from public, anon, authenticated;
grant execute on function public.read_zoom_setup_reconciliation_worklist()
  to authenticated;

create or replace function internal.read_zoom_orphan_cleanup_worklist()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, internal
as $$
declare
  result jsonb;
begin
  if not (
    internal.has_staff_role('course_admin')
    or internal.has_staff_role('accreditation_reviewer')
    or internal.has_staff_role('platform_admin')
  ) then
    raise exception 'ZOOM_ORPHAN_CLEANUP_WORKLIST_REJECTED';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'jobId', job.id,
    'liveSessionId', live_session.id,
    'title', live_session.title,
    'providerMeetingNumber',
      job.payload ->> 'providerMeetingNumber',
    'status', job.status,
    'attemptCount', job.attempt_count,
    'lastError', job.last_error,
    'createdAt', job.created_at
  ) order by job.created_at), '[]'::jsonb)
  into result
  from public.durable_jobs job
  join public.live_sessions live_session
    on live_session.id =
      (job.payload ->> 'liveSessionId')::uuid
  where job.job_type = 'zoom_orphan_cleanup'
    and job.status in ('pending', 'retry', 'leased', 'dead_letter');
  return result;
end
$$;

revoke all on function internal.read_zoom_orphan_cleanup_worklist()
  from public, anon, authenticated;
grant execute on function internal.read_zoom_orphan_cleanup_worklist()
  to authenticated;

create or replace function public.read_zoom_orphan_cleanup_worklist()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_zoom_orphan_cleanup_worklist()
$$;

revoke all on function public.read_zoom_orphan_cleanup_worklist()
  from public, anon, authenticated;
grant execute on function public.read_zoom_orphan_cleanup_worklist()
  to authenticated;

-- Recording the provider receipt and enqueueing finalization must be one
-- database transaction. Otherwise a process crash between those two writes
-- would leave a real Zoom meeting permanently stuck in reconciling state.
create or replace function internal.enqueue_zoom_setup_finalize_from_receipt()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  target_session uuid;
  receipt_host_id text;
  reservation_status text;
  live_session_status text;
  provider_claim_id uuid;
  provider_claimed_at timestamptz;
  provider_host_snapshot text;
  session_title text;
  session_starts_at timestamptz;
  session_ends_at timestamptz;
  session_actor uuid;
  approved_release_request uuid;
  safety_verified_at timestamptz;
  orphan_cleanup_job_id uuid;
  orphan_cleanup_status text;
begin
  if new.provider <> 'zoom'
     or new.operation <> 'create_meeting'
     or new.business_key !~
       '^zoom-meeting:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    return new;
  end if;
  target_session := substring(
    new.business_key from length('zoom-meeting:') + 1
  )::uuid;

  receipt_host_id := nullif(trim(
    new.response_payload ->> 'providerHostId'
  ), '');
  if new.provider_reference is null
     or new.provider_reference is distinct from
       new.response_payload ->> 'meetingNumber'
     or receipt_host_id is null
  then
    raise exception 'ZOOM_SETUP_RECEIPT_IDENTITY_INVALID';
  end if;
  select
    reservation.status,
    live_session.status,
    reservation.provider_request_claim_id,
    reservation.provider_request_claimed_at,
    reservation.provider_host_id_snapshot,
    live_session.title,
    live_session.starts_at,
    live_session.ends_at,
    live_session.created_by
  into
    reservation_status,
    live_session_status,
    provider_claim_id,
    provider_claimed_at,
    provider_host_snapshot,
    session_title,
    session_starts_at,
    session_ends_at,
    session_actor
  from public.zoom_host_reservations reservation
  join public.live_sessions live_session
    on live_session.id = reservation.live_session_id
  where reservation.live_session_id = target_session
  for update of live_session, reservation;
  if not found then
    raise exception 'ZOOM_SETUP_RECEIPT_SESSION_INVALID';
  end if;

  -- A concurrent identical/mismatched replay reaches the trigger before
  -- ON CONFLICT is resolved. The existing immutable receipt is authoritative;
  -- the receipt RPC will compare its fingerprint after this trigger returns.
  if exists (
    select 1
    from public.provider_operation_receipts receipt
    where receipt.provider = 'zoom'
      and receipt.operation = 'create_meeting'
      and receipt.business_key = new.business_key
  ) then
    return new;
  end if;

  safety_verified_at := nullif(
    new.response_payload #>> '{safety,verifiedAt}',
    ''
  )::timestamptz;
  if safety_verified_at is null
     or new.response_payload
       #>> '{safety,accountlessJoinEnabled}' is distinct from 'true'
     or new.response_payload
       #>> '{safety,waitingRoom}' is distinct from 'true'
     or new.response_payload
       #>> '{safety,participantRenameDisabled}' is distinct from 'true'
     or new.response_payload
       #>> '{safety,participantShareDisabled}' is distinct from 'true'
     or new.response_payload
       #>> '{safety,cloudRecordingDisabled}' is distinct from 'true'
     or new.response_payload
       #>> '{safety,removedParticipantRejoinDisabled}'
         is distinct from 'true'
     or abs(extract(
       epoch from (new.created_at - safety_verified_at)
     )) > 120
     or safety_verified_at > clock_timestamp() + interval '1 minute'
  then
    raise exception 'ZOOM_SETUP_RECEIPT_SAFETY_STALE';
  end if;

  select job.id, job.status
  into orphan_cleanup_job_id, orphan_cleanup_status
  from public.durable_jobs job
  where job.job_type = 'zoom_orphan_cleanup'
    and job.business_key =
      'zoom-orphan-cleanup:' || new.provider_reference
  for update;
  if orphan_cleanup_job_id is not null then
    if orphan_cleanup_status in ('pending', 'retry', 'dead_letter') then
      update public.durable_jobs
      set status = 'completed',
          completed_at = clock_timestamp(),
          lease_owner = null,
          lease_expires_at = null,
          last_error = null,
          payload = payload || jsonb_build_object(
            'resolution', 'preserved_authoritative_receipt'
          )
      where id = orphan_cleanup_job_id;
      perform internal.append_audit_event(
        session_actor,
        'live.zoom_orphan_cleanup_preserved_by_receipt',
        'durable_job',
        orphan_cleanup_job_id::text,
        'A fresh authoritative receipt superseded orphan deletion',
        null,
        jsonb_build_object(
          'liveSessionId', target_session,
          'providerMeetingNumber', new.provider_reference
        )
      );
    else
      -- A leased cleanup may already be deleting the provider meeting, while
      -- a completed cleanup proves deletion. Never persist a receipt that may
      -- point at a deleted provider resource.
      raise exception 'ZOOM_SETUP_RECEIPT_ORPHAN_CLEANUP_CONFLICT';
    end if;
  end if;

  if new.response_payload ->> 'meetingType' is distinct from '2'
     or new.response_payload ->> 'topic' is distinct from session_title
     or new.response_payload ->> 'startsAt' is null
     or abs(extract(
       epoch from (
         (new.response_payload ->> 'startsAt')::timestamptz
           - session_starts_at
       )
     )) > 60
     or new.response_payload ->> 'durationMinutes' is null
     or (new.response_payload ->> 'durationMinutes')::integer <>
       ceil(
         extract(epoch from session_ends_at - session_starts_at) / 60
       )::integer
  then
    raise exception 'ZOOM_SETUP_RECEIPT_SPEC_MISMATCH';
  end if;

  if live_session_status = 'reconciling'
     and reservation_status = 'reconciling'
  then
    if provider_claim_id is null
       or provider_claimed_at is null
       or provider_host_snapshot is distinct from receipt_host_id
    then
      raise exception 'ZOOM_SETUP_RECEIPT_CLAIM_MISMATCH';
    end if;
    -- The insert can start before a newer retry acquires the row lock. Bind
    -- the first durable outcome to the serialized claim so finalization can
    -- win; a competing route must delete its different meeting by reference.
    if new.created_at < provider_claimed_at then
      update public.zoom_host_reservations
      set provider_request_claimed_at = new.created_at
      where live_session_id = target_session;
    end if;
  elsif live_session_status = 'draft'
        and reservation_status = 'pending'
        and provider_claim_id is null
        and provider_claimed_at is null
        and provider_host_snapshot is null
  then
    select request.id into approved_release_request
    from public.zoom_setup_reconciliation_requests request
    join public.zoom_setup_reconciliation_decisions decision
      on decision.reconciliation_request_id = request.id
     and decision.decision = 'approve'
    where request.live_session_id = target_session
      and request.resolution_kind = 'confirm_not_created'
    order by decision.decided_at desc
    limit 1;
    if approved_release_request is null then
      raise exception 'ZOOM_SETUP_RECEIPT_UNCLAIMED';
    end if;

    update public.live_sessions
    set status = 'reconciling'
    where id = target_session
      and status = 'draft';
    update public.zoom_host_reservations
    set status = 'reconciling',
        provider_request_claim_id = gen_random_uuid(),
        provider_request_claimed_at = new.created_at,
        provider_host_id_snapshot = receipt_host_id
    where live_session_id = target_session
      and status = 'pending';
    perform internal.append_audit_event(
      session_actor,
      'live.zoom_setup_late_receipt_restored',
      'live_session',
      target_session::text,
      'A provider receipt won the serialized race after a manual retry release',
      null,
      jsonb_build_object(
        'reconciliationRequestId', approved_release_request,
        'providerMeetingNumber', new.provider_reference,
        'providerHostId', receipt_host_id
      )
    );
  else
    raise exception 'ZOOM_SETUP_RECEIPT_STATE_INVALID';
  end if;

  insert into public.durable_jobs (
    job_type,
    business_key,
    payload
  ) values (
    'zoom_setup_finalize',
    'zoom-setup-finalize:' || target_session::text,
    jsonb_build_object('liveSessionId', target_session)
  )
  on conflict (business_key) do nothing;
  return new;
end
$$;

revoke all on function internal.enqueue_zoom_setup_finalize_from_receipt()
  from public, anon, authenticated, service_role;

create trigger provider_receipt_enqueue_zoom_setup_finalize
before insert on public.provider_operation_receipts
for each row execute function
  internal.enqueue_zoom_setup_finalize_from_receipt();

insert into public.durable_jobs (job_type, business_key, payload)
select
  'zoom_setup_finalize',
  'zoom-setup-finalize:' ||
    substring(receipt.business_key from length('zoom-meeting:') + 1),
  jsonb_build_object(
    'liveSessionId',
    substring(
      receipt.business_key from length('zoom-meeting:') + 1
    )::uuid
  )
from public.provider_operation_receipts receipt
where receipt.provider = 'zoom'
  and receipt.operation = 'create_meeting'
  and receipt.business_key ~
    '^zoom-meeting:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict (business_key) do nothing;

-- The unverified finalizer remains an internal implementation detail for the
-- verified wrapper, but is no longer directly callable through either schema.
revoke execute on function internal.finalize_live_session_setup(
  uuid, text, text, jsonb, text
) from service_role;
revoke execute on function public.finalize_live_session_setup(
  uuid, text, text, jsonb, text
) from service_role;

-- A Zoom registrant is staged before the immutable receipt RPC. The fence is
-- locked by both receipt recording and reconciliation, so an absent receipt
-- can only become a revoke decision after every in-flight receipt transaction
-- has committed or rolled back.
create table private.zoom_registrant_receipt_fences (
  business_key text primary key check (
    business_key ~
      '^zoom-registrant:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  state text not null default 'open' check (
    state in ('open', 'receipt_authoritative', 'sealed_no_receipt')
  ),
  provider_reference text,
  sealed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (state = 'open' and provider_reference is null and sealed_at is null)
    or (
      state = 'receipt_authoritative'
      and provider_reference is not null
      and sealed_at is null
    )
    or (
      state = 'sealed_no_receipt'
      and provider_reference is not null
      and sealed_at is not null
    )
  )
);

create table private.zoom_registrant_reconciliations (
  id uuid primary key default gen_random_uuid(),
  live_join_lease_id uuid not null unique
    references public.live_join_leases(id),
  receipt_business_key text not null unique
    references private.zoom_registrant_receipt_fences(business_key),
  meeting_number text not null check (
    length(meeting_number) between 1 and 32
  ),
  provider_registrant_id text not null check (
    length(provider_registrant_id) between 1 and 500
  ),
  encrypted_registrant_token jsonb not null check (
    jsonb_typeof(encrypted_registrant_token) = 'object'
  ),
  status text not null default 'staged' check (
    status in (
      'staged',
      'preserve_required',
      'revoke_required',
      'preserved',
      'revoked'
    )
  ),
  decision_reason text,
  created_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  resolved_at timestamptz,
  check (
    (status = 'staged' and decided_at is null and resolved_at is null)
    or (
      status in ('preserve_required', 'revoke_required')
      and decided_at is not null
      and resolved_at is null
    )
    or (
      status in ('preserved', 'revoked')
      and decided_at is not null
      and resolved_at is not null
    )
  )
);

alter table private.zoom_registrant_receipt_fences
  enable row level security;
alter table private.zoom_registrant_receipt_fences
  force row level security;
alter table private.zoom_registrant_reconciliations
  enable row level security;
alter table private.zoom_registrant_reconciliations
  force row level security;
revoke all on private.zoom_registrant_receipt_fences
  from public, anon, authenticated, service_role;
revoke all on private.zoom_registrant_reconciliations
  from public, anon, authenticated, service_role;

insert into private.zoom_registrant_receipt_fences (
  business_key,
  state,
  provider_reference
)
select
  receipt.business_key,
  'receipt_authoritative',
  receipt.provider_reference
from public.provider_operation_receipts receipt
where receipt.provider = 'zoom'
  and receipt.operation = 'register_participant'
  and receipt.provider_reference is not null
  and receipt.business_key ~
    '^zoom-registrant:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict (business_key) do nothing;

create or replace function internal.record_provider_operation_receipt(
  submitted_provider text,
  submitted_operation text,
  submitted_business_key text,
  submitted_provider_reference text,
  submitted_response_fingerprint text,
  submitted_response_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, internal
as $$
declare
  receipt public.provider_operation_receipts%rowtype;
  registrant_fence private.zoom_registrant_receipt_fences%rowtype;
  inserted_count integer := 0;
  is_zoom_registrant boolean :=
    submitted_provider = 'zoom'
    and submitted_operation = 'register_participant';
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or submitted_provider not in (
       'cloudflare_stream', 'zoom', 'resend', 'twilio', 'identity_recovery'
     )
     or submitted_operation = ''
     or length(submitted_operation) > 100
     or submitted_business_key = ''
     or length(submitted_business_key) > 500
     or submitted_response_fingerprint !~ '^[a-f0-9]{64}$'
     or submitted_response_payload is null
  then
    raise exception 'PROVIDER_RECEIPT_REJECTED';
  end if;

  if is_zoom_registrant then
    if submitted_business_key !~
         '^zoom-registrant:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or nullif(trim(submitted_provider_reference), '') is null
       or submitted_response_payload ->> 'registrantId'
          is distinct from submitted_provider_reference
       or jsonb_typeof(
         submitted_response_payload -> 'encryptedRegistrantToken'
       ) is distinct from 'object'
    then
      raise exception 'ZOOM_REGISTRANT_RECEIPT_INVALID';
    end if;

    insert into private.zoom_registrant_receipt_fences (business_key)
    values (submitted_business_key)
    on conflict (business_key) do nothing;

    select fence.* into registrant_fence
    from private.zoom_registrant_receipt_fences fence
    where fence.business_key = submitted_business_key
    for update;

    if registrant_fence.state = 'sealed_no_receipt' then
      raise exception 'ZOOM_REGISTRANT_RECEIPT_FENCED_REVOKE';
    end if;
  end if;

  insert into public.provider_operation_receipts (
    provider, operation, business_key, provider_reference,
    response_fingerprint, response_payload
  ) values (
    submitted_provider, submitted_operation, submitted_business_key,
    nullif(submitted_provider_reference, ''),
    submitted_response_fingerprint, submitted_response_payload
  )
  on conflict (provider, operation, business_key) do nothing;
  get diagnostics inserted_count = row_count;

  select * into receipt
  from public.provider_operation_receipts
  where provider = submitted_provider
    and operation = submitted_operation
    and business_key = submitted_business_key;

  if receipt.provider_reference is distinct from
       nullif(submitted_provider_reference, '')
     or receipt.response_fingerprint <> submitted_response_fingerprint
     or receipt.response_payload <> submitted_response_payload
  then
    raise exception 'PROVIDER_RECEIPT_REPLAY_MISMATCH';
  end if;

  if is_zoom_registrant then
    update private.zoom_registrant_receipt_fences
    set state = 'receipt_authoritative',
        provider_reference = receipt.provider_reference,
        sealed_at = null,
        updated_at = clock_timestamp()
    where business_key = submitted_business_key;
  end if;

  return jsonb_build_object(
    'providerReference', receipt.provider_reference,
    'responsePayload', receipt.response_payload,
    'recordedAt', receipt.created_at,
    'reused', inserted_count = 0
  );
end
$$;

revoke all on function internal.record_provider_operation_receipt(
  text, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function internal.record_provider_operation_receipt(
  text, text, text, text, text, jsonb
) to service_role;

create or replace function internal.stage_zoom_registrant_reconciliation(
  target_lease uuid,
  submitted_meeting_number text,
  submitted_provider_registrant_id text,
  submitted_encrypted_registrant_token jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private, internal
as $$
declare
  receipt_key text := 'zoom-registrant:' || target_lease::text;
  reconciliation_id uuid;
  reconciliation_job_id uuid;
  existing private.zoom_registrant_reconciliations%rowtype;
  session_actor uuid;
  expected_meeting_number text;
  inserted_reconciliation boolean := false;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or length(trim(coalesce(submitted_meeting_number, '')))
        not between 1 and 32
     or length(trim(coalesce(submitted_provider_registrant_id, '')))
        not between 1 and 500
     or jsonb_typeof(submitted_encrypted_registrant_token)
        is distinct from 'object'
  then
    raise exception 'ZOOM_REGISTRANT_RECONCILIATION_STAGE_REJECTED';
  end if;

  select lease.person_id, meeting.meeting_number
  into session_actor, expected_meeting_number
  from public.live_join_leases lease
  join public.live_bookings booking
    on booking.id = lease.live_booking_id
  join private.zoom_meetings meeting
    on meeting.live_session_id = booking.live_session_id
  where lease.id = target_lease
    and lease.active
    and lease.provider_status in ('pending', 'registered')
    and lease.credential_expires_at > clock_timestamp()
  for update of lease;
  if not found
     or expected_meeting_number is distinct from
       trim(submitted_meeting_number)
  then
    raise exception 'ZOOM_REGISTRANT_RECONCILIATION_LEASE_INVALID';
  end if;

  insert into private.zoom_registrant_receipt_fences (business_key)
  values (receipt_key)
  on conflict (business_key) do nothing;

  insert into private.zoom_registrant_reconciliations (
    live_join_lease_id,
    receipt_business_key,
    meeting_number,
    provider_registrant_id,
    encrypted_registrant_token
  ) values (
    target_lease,
    receipt_key,
    trim(submitted_meeting_number),
    trim(submitted_provider_registrant_id),
    submitted_encrypted_registrant_token
  )
  on conflict (live_join_lease_id) do nothing
  returning id into reconciliation_id;
  inserted_reconciliation := reconciliation_id is not null;

  if not inserted_reconciliation then
    select reconciliation.* into existing
    from private.zoom_registrant_reconciliations reconciliation
    where reconciliation.live_join_lease_id = target_lease;
    if existing.receipt_business_key is distinct from receipt_key
       or existing.meeting_number is distinct from
         trim(submitted_meeting_number)
       or existing.provider_registrant_id is distinct from
         trim(submitted_provider_registrant_id)
       or existing.encrypted_registrant_token is distinct from
         submitted_encrypted_registrant_token
    then
      raise exception 'ZOOM_REGISTRANT_RECONCILIATION_REPLAY_MISMATCH';
    end if;
    reconciliation_id := existing.id;
  end if;

  insert into public.durable_jobs (
    job_type,
    business_key,
    payload,
    available_at
  ) values (
    'zoom_registrant_reconcile',
    'zoom-registrant-reconcile:' || target_lease::text,
    jsonb_build_object(
      'reconciliationId', reconciliation_id,
      'leaseId', target_lease
    ),
    clock_timestamp() + interval '30 seconds'
  )
  on conflict (business_key) do nothing
  returning id into reconciliation_job_id;
  if reconciliation_job_id is null then
    select job.id into reconciliation_job_id
    from public.durable_jobs job
    where job.business_key =
        'zoom-registrant-reconcile:' || target_lease::text
      and job.job_type = 'zoom_registrant_reconcile'
      and job.payload ->> 'reconciliationId' =
        reconciliation_id::text
      and job.payload ->> 'leaseId' = target_lease::text;
    if reconciliation_job_id is null then
      raise exception 'ZOOM_REGISTRANT_RECONCILIATION_JOB_REPLAY_MISMATCH';
    end if;
  end if;

  if inserted_reconciliation then
    perform internal.append_audit_event(
      session_actor,
      'live.zoom_registrant_reconciliation_staged',
      'live_join_lease',
      target_lease::text,
      'Zoom registrant staged before immutable provider receipt',
      null,
      jsonb_build_object(
        'reconciliationId', reconciliation_id,
        'providerRegistrantId', trim(submitted_provider_registrant_id)
      )
    );
  end if;
  return reconciliation_id;
end
$$;

revoke all on function internal.stage_zoom_registrant_reconciliation(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function internal.stage_zoom_registrant_reconciliation(
  uuid, text, text, jsonb
) to service_role;

create or replace function public.stage_zoom_registrant_reconciliation(
  p_lease_id uuid,
  p_meeting_number text,
  p_provider_registrant_id text,
  p_encrypted_registrant_token jsonb
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.stage_zoom_registrant_reconciliation(
    p_lease_id,
    p_meeting_number,
    p_provider_registrant_id,
    p_encrypted_registrant_token
  )
$$;

revoke all on function public.stage_zoom_registrant_reconciliation(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.stage_zoom_registrant_reconciliation(
  uuid, text, text, jsonb
) to service_role;

create or replace function internal.read_zoom_registrant_reconciliation_context(
  target_job uuid,
  worker_id text,
  expected_lease_generation bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, internal
as $$
declare
  job public.durable_jobs%rowtype;
  reconciliation private.zoom_registrant_reconciliations%rowtype;
  fence private.zoom_registrant_receipt_fences%rowtype;
  lease public.live_join_leases%rowtype;
  receipt public.provider_operation_receipts%rowtype;
  receipt_found boolean := false;
  expected_meeting_number text;
  next_action text;
  decision text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or length(trim(coalesce(worker_id, ''))) = 0
     or expected_lease_generation <= 0
  then
    raise exception 'ZOOM_REGISTRANT_RECONCILIATION_SERVICE_REQUIRED';
  end if;

  select durable_job.* into job
  from public.durable_jobs durable_job
  where durable_job.id = target_job
    and durable_job.job_type = 'zoom_registrant_reconcile'
    and durable_job.status = 'leased'
    and durable_job.lease_owner = worker_id
    and durable_job.lease_generation = expected_lease_generation
  for update;
  if not found then
    raise exception 'ZOOM_REGISTRANT_RECONCILIATION_LEASE_MISMATCH';
  end if;

  select candidate.* into reconciliation
  from private.zoom_registrant_reconciliations candidate
  where candidate.id =
      (job.payload ->> 'reconciliationId')::uuid
    and candidate.live_join_lease_id =
      (job.payload ->> 'leaseId')::uuid
  for update;
  if not found
     or reconciliation.status in ('preserved', 'revoked')
     or job.business_key is distinct from
       'zoom-registrant-reconcile:' ||
         reconciliation.live_join_lease_id::text
  then
    raise exception 'ZOOM_REGISTRANT_RECONCILIATION_JOB_INVALID';
  end if;

  select join_lease.* into lease
  from public.live_join_leases join_lease
  where join_lease.id = reconciliation.live_join_lease_id
  for update;
  if not found then
    raise exception 'ZOOM_REGISTRANT_RECONCILIATION_LEASE_INVALID';
  end if;

  select meeting.meeting_number into expected_meeting_number
  from public.live_bookings booking
  join private.zoom_meetings meeting
    on meeting.live_session_id = booking.live_session_id
  where booking.id = lease.live_booking_id;
  if not found
     or expected_meeting_number is distinct from
       reconciliation.meeting_number
  then
    raise exception 'ZOOM_REGISTRANT_RECONCILIATION_MEETING_INVALID';
  end if;

  select receipt_fence.* into fence
  from private.zoom_registrant_receipt_fences receipt_fence
  where receipt_fence.business_key =
    reconciliation.receipt_business_key
  for update;
  if not found then
    raise exception 'ZOOM_REGISTRANT_RECEIPT_FENCE_MISSING';
  end if;

  select provider_receipt.* into receipt
  from public.provider_operation_receipts provider_receipt
  where provider_receipt.provider = 'zoom'
    and provider_receipt.operation = 'register_participant'
    and provider_receipt.business_key =
      reconciliation.receipt_business_key;
  receipt_found := found;

  if receipt_found then
    if fence.state is distinct from 'receipt_authoritative'
       or fence.provider_reference is distinct from
         receipt.provider_reference
    then
      raise exception 'ZOOM_REGISTRANT_RECEIPT_FENCE_DRIFT';
    end if;
  else
    if fence.state = 'receipt_authoritative' then
      raise exception 'ZOOM_REGISTRANT_RECEIPT_FENCE_DRIFT';
    end if;
    update private.zoom_registrant_receipt_fences
    set state = 'sealed_no_receipt',
        provider_reference = reconciliation.provider_registrant_id,
        sealed_at = coalesce(sealed_at, clock_timestamp()),
        updated_at = clock_timestamp()
    where business_key = reconciliation.receipt_business_key;
  end if;

  if receipt_found
     and receipt.provider_reference =
       reconciliation.provider_registrant_id
     and receipt.response_payload ->> 'registrantId' =
       reconciliation.provider_registrant_id
     and jsonb_typeof(
       receipt.response_payload -> 'encryptedRegistrantToken'
     ) = 'object'
     and lease.active
     and lease.credential_expires_at > clock_timestamp()
  then
    next_action := 'preserve';
    decision := 'authoritative_receipt';
  else
    next_action := 'revoke';
    decision := case
      when not receipt_found then 'fenced_receipt_absent'
      when receipt.provider_reference is distinct from
        reconciliation.provider_registrant_id
        then 'competing_authoritative_receipt'
      when not lease.active
        or lease.credential_expires_at <= clock_timestamp()
        then 'credential_no_longer_usable'
      else 'authoritative_receipt_invalid'
    end;
  end if;

  update private.zoom_registrant_reconciliations
  set status = case next_action
        when 'preserve' then 'preserve_required'
        else 'revoke_required'
      end,
      decision_reason = decision,
      decided_at = coalesce(decided_at, clock_timestamp())
  where id = reconciliation.id;

  return jsonb_build_object(
    'action', next_action,
    'meetingNumber', reconciliation.meeting_number,
    'providerRegistrantId', reconciliation.provider_registrant_id
  );
end
$$;

revoke all on function internal.read_zoom_registrant_reconciliation_context(
  uuid, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function internal.read_zoom_registrant_reconciliation_context(
  uuid, text, bigint
) to service_role;

create or replace function public.read_zoom_registrant_reconciliation_context(
  p_job_id uuid,
  p_worker_id text,
  p_lease_generation bigint
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.read_zoom_registrant_reconciliation_context(
    p_job_id,
    p_worker_id,
    p_lease_generation
  )
$$;

revoke all on function public.read_zoom_registrant_reconciliation_context(
  uuid, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.read_zoom_registrant_reconciliation_context(
  uuid, text, bigint
) to service_role;

create or replace function internal.complete_zoom_registrant_reconciliation(
  target_job uuid,
  worker_id text,
  expected_lease_generation bigint,
  provider_revoked boolean,
  preserved_authoritative boolean
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private, internal
as $$
declare
  job public.durable_jobs%rowtype;
  reconciliation private.zoom_registrant_reconciliations%rowtype;
  fence private.zoom_registrant_receipt_fences%rowtype;
  lease public.live_join_leases%rowtype;
  receipt public.provider_operation_receipts%rowtype;
  receipt_found boolean := false;
  authoritative_valid boolean := false;
  preserve_competing boolean := false;
  resolution text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or length(trim(coalesce(worker_id, ''))) = 0
     or expected_lease_generation <= 0
     or coalesce(provider_revoked, false) =
       coalesce(preserved_authoritative, false)
  then
    raise exception 'ZOOM_REGISTRANT_RECONCILIATION_COMPLETION_REJECTED';
  end if;

  select durable_job.* into job
  from public.durable_jobs durable_job
  where durable_job.id = target_job
    and durable_job.job_type = 'zoom_registrant_reconcile'
    and durable_job.status = 'leased'
    and durable_job.lease_owner = worker_id
    and durable_job.lease_generation = expected_lease_generation
  for update;
  if not found then
    raise exception 'ZOOM_REGISTRANT_RECONCILIATION_LEASE_MISMATCH';
  end if;

  select candidate.* into reconciliation
  from private.zoom_registrant_reconciliations candidate
  where candidate.id =
      (job.payload ->> 'reconciliationId')::uuid
    and candidate.live_join_lease_id =
      (job.payload ->> 'leaseId')::uuid
  for update;
  if not found then
    raise exception 'ZOOM_REGISTRANT_RECONCILIATION_JOB_INVALID';
  end if;

  select join_lease.* into lease
  from public.live_join_leases join_lease
  where join_lease.id = reconciliation.live_join_lease_id
  for update;
  if not found then
    raise exception 'ZOOM_REGISTRANT_RECONCILIATION_LEASE_INVALID';
  end if;

  select receipt_fence.* into fence
  from private.zoom_registrant_receipt_fences receipt_fence
  where receipt_fence.business_key =
    reconciliation.receipt_business_key
  for update;
  if not found then
    raise exception 'ZOOM_REGISTRANT_RECEIPT_FENCE_MISSING';
  end if;

  select provider_receipt.* into receipt
  from public.provider_operation_receipts provider_receipt
  where provider_receipt.provider = 'zoom'
    and provider_receipt.operation = 'register_participant'
    and provider_receipt.business_key =
      reconciliation.receipt_business_key;
  receipt_found := found;
  authoritative_valid :=
    receipt_found
    and receipt.provider_reference is not null
    and receipt.response_payload ->> 'registrantId' =
      receipt.provider_reference
    and jsonb_typeof(
      receipt.response_payload -> 'encryptedRegistrantToken'
    ) = 'object';

  if preserved_authoritative then
    if reconciliation.status is distinct from 'preserve_required'
       or not authoritative_valid
       or receipt.provider_reference is distinct from
         reconciliation.provider_registrant_id
       or fence.state is distinct from 'receipt_authoritative'
       or fence.provider_reference is distinct from
         receipt.provider_reference
       or not lease.active
       or lease.credential_expires_at <= clock_timestamp()
    then
      raise exception 'ZOOM_REGISTRANT_AUTHORITATIVE_PRESERVE_REJECTED';
    end if;

    if lease.provider_status = 'registered' then
      if lease.zoom_registrant_id is distinct from
           receipt.provider_reference
         or lease.registrant_token_ciphertext is distinct from
           receipt.response_payload -> 'encryptedRegistrantToken'
      then
        raise exception 'ZOOM_REGISTRANT_LEASE_RECEIPT_MISMATCH';
      end if;
    else
      update public.live_join_leases
      set zoom_registrant_id = receipt.provider_reference,
          registrant_token_ciphertext =
            receipt.response_payload -> 'encryptedRegistrantToken',
          provider_status = 'registered'
      where id = lease.id
        and active
        and provider_status = 'pending'
        and credential_expires_at > clock_timestamp();
      if not found then
        raise exception 'ZOOM_REGISTRANT_LEASE_PRESERVE_FAILED';
      end if;
    end if;
    resolution := 'preserved';
  else
    if reconciliation.status is distinct from 'revoke_required'
       or not provider_revoked
    then
      raise exception 'ZOOM_REGISTRANT_REVOCATION_CONFIRMATION_REQUIRED';
    end if;
    if not receipt_found then
      if fence.state is distinct from 'sealed_no_receipt'
         or fence.provider_reference is distinct from
           reconciliation.provider_registrant_id
      then
        raise exception 'ZOOM_REGISTRANT_ABSENT_RECEIPT_NOT_FENCED';
      end if;
    elsif fence.state is distinct from 'receipt_authoritative'
          or fence.provider_reference is distinct from
            receipt.provider_reference
    then
      raise exception 'ZOOM_REGISTRANT_RECEIPT_FENCE_DRIFT';
    end if;

    preserve_competing :=
      authoritative_valid
      and receipt.provider_reference is distinct from
        reconciliation.provider_registrant_id
      and lease.active
      and lease.credential_expires_at > clock_timestamp();
    if preserve_competing then
      update public.live_join_leases
      set zoom_registrant_id = receipt.provider_reference,
          registrant_token_ciphertext =
            receipt.response_payload -> 'encryptedRegistrantToken',
          provider_status = 'registered'
      where id = lease.id
        and active
        and provider_status in ('pending', 'registered');
      if not found then
        raise exception 'ZOOM_REGISTRANT_COMPETING_RECEIPT_PRESERVE_FAILED';
      end if;
      resolution := 'revoked_duplicate_preserved_authoritative';
    else
      update public.live_join_leases
      set active = false,
          provider_status = case
            when receipt_found then 'revoked'
            else 'failed'
          end,
          zoom_registrant_id = case
            when authoritative_valid then receipt.provider_reference
            else zoom_registrant_id
          end,
          registrant_token_ciphertext = case
            when authoritative_valid
              then receipt.response_payload -> 'encryptedRegistrantToken'
            else registrant_token_ciphertext
          end,
          old_registrant_revoked_at = coalesce(
            old_registrant_revoked_at,
            clock_timestamp()
          )
      where id = lease.id;
      resolution := 'revoked';
    end if;
  end if;

  update private.zoom_registrant_reconciliations
  set status = case
        when resolution = 'preserved' then 'preserved'
        else 'revoked'
      end,
      resolved_at = clock_timestamp()
  where id = reconciliation.id;

  update public.durable_jobs
  set status = 'completed',
      completed_at = clock_timestamp(),
      lease_owner = null,
      lease_expires_at = null,
      last_error = null,
      payload = payload || jsonb_build_object(
        'resolution', resolution,
        'resolvedLeaseGeneration', expected_lease_generation
      )
  where id = job.id
    and status = 'leased'
    and lease_owner = worker_id
    and lease_generation = expected_lease_generation;
  if not found then
    raise exception 'ZOOM_REGISTRANT_RECONCILIATION_LEASE_MISMATCH';
  end if;

  perform internal.append_audit_event(
    lease.person_id,
    case
      when resolution = 'preserved'
        then 'live.zoom_registrant_preserved'
      else 'live.zoom_registrant_revoked'
    end,
    'live_join_lease',
    lease.id::text,
    reconciliation.decision_reason,
    null,
    jsonb_build_object(
      'reconciliationId', reconciliation.id,
      'durableJobId', job.id,
      'leaseGeneration', expected_lease_generation,
      'resolution', resolution
    )
  );
  return 'completed';
end
$$;

revoke all on function internal.complete_zoom_registrant_reconciliation(
  uuid, text, bigint, boolean, boolean
) from public, anon, authenticated, service_role;
grant execute on function internal.complete_zoom_registrant_reconciliation(
  uuid, text, bigint, boolean, boolean
) to service_role;

create or replace function public.complete_zoom_registrant_reconciliation(
  p_job_id uuid,
  p_worker_id text,
  p_lease_generation bigint,
  p_provider_revoked boolean,
  p_preserved_authoritative boolean
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.complete_zoom_registrant_reconciliation(
    p_job_id,
    p_worker_id,
    p_lease_generation,
    p_provider_revoked,
    p_preserved_authoritative
  )
$$;

revoke all on function public.complete_zoom_registrant_reconciliation(
  uuid, text, bigint, boolean, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.complete_zoom_registrant_reconciliation(
  uuid, text, bigint, boolean, boolean
) to service_role;

create or replace function internal.lease_due_jobs_filtered(
  worker_id text,
  job_limit integer,
  excluded_job_types text[],
  allowed_job_types text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  leased jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or worker_id = ''
     or job_limit not between 1 and 100
  then
    raise exception 'WORKER_SERVICE_AUTHORITY_REQUIRED';
  end if;

  with candidates as (
    select job.id
    from public.durable_jobs job
    where (
        (
          job.status in ('pending', 'retry')
          and job.available_at <= clock_timestamp()
        )
        or (
          job.status = 'leased'
          and job.lease_expires_at < clock_timestamp()
        )
      )
      and (
        case
          when internal.setting_is_true('maintenance_mode') then
            job.job_type = any(array[
              'provider_event_process',
              'live_join_lease_expiry',
              'zoom_registrant_reconcile',
              'zoom_orphan_cleanup',
              'quarantine_scan'
            ]::text[])
          when allowed_job_types is not null then
            job.job_type = any(allowed_job_types)
          else
            not (
              job.job_type = any(
                coalesce(excluded_job_types, array[]::text[])
              )
            )
        end
      )
    order by
      case when job.status = 'leased'
        then job.lease_expires_at
        else job.available_at
      end,
      job.created_at
    for update skip locked
    limit job_limit
  ), updated as (
    update public.durable_jobs job
    set status = 'leased',
        lease_owner = worker_id,
        lease_expires_at = clock_timestamp() + interval '5 minutes',
        lease_generation = job.lease_generation + 1,
        attempt_count = job.attempt_count + 1
    from candidates
    where job.id = candidates.id
    returning
      job.id,
      job.job_type,
      job.business_key,
      job.payload,
      job.lease_generation
  )
  select coalesce(jsonb_agg(to_jsonb(updated)), '[]'::jsonb)
  into leased
  from updated;
  return leased;
end
$$;

revoke all on function internal.lease_due_jobs_filtered(
  text, integer, text[], text[]
) from public, anon, authenticated, service_role;
grant execute on function internal.lease_due_jobs_filtered(
  text, integer, text[], text[]
) to service_role;

-- The unfiltered v1 lease API cannot return a generation and is no longer a
-- valid worker entry point.
revoke all on function internal.lease_due_jobs(text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.lease_due_jobs(text, integer)
  from public, anon, authenticated, service_role;

create or replace function internal.finish_durable_job(
  target_job uuid,
  worker_id text,
  expected_lease_generation bigint,
  succeeded boolean,
  failure_message text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  result text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or expected_lease_generation <= 0
  then
    raise exception 'WORKER_SERVICE_AUTHORITY_REQUIRED';
  end if;

  perform 1
  from public.durable_jobs job
  where job.id = target_job
    and job.status = 'leased'
    and job.lease_owner = worker_id
    and job.lease_generation = expected_lease_generation
  for update;
  if not found then
    raise exception 'JOB_LEASE_GENERATION_MISMATCH';
  end if;

  result := internal.finish_durable_job(
    target_job,
    worker_id,
    succeeded,
    failure_message
  );
  return result;
end
$$;

revoke all on function internal.finish_durable_job(
  uuid, text, bigint, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function internal.finish_durable_job(
  uuid, text, bigint, boolean, text
) to service_role;

create or replace function public.finish_durable_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_generation bigint,
  p_succeeded boolean,
  p_failure_message text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.finish_durable_job(
    p_job_id,
    p_worker_id,
    p_lease_generation,
    p_succeeded,
    p_failure_message
  )
$$;

revoke all on function public.finish_durable_job(
  uuid, text, bigint, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.finish_durable_job(
  uuid, text, bigint, boolean, text
) to service_role;

revoke all on function internal.finish_durable_job(
  uuid, text, boolean, text
) from public, anon, authenticated, service_role;
revoke all on function public.finish_durable_job(
  uuid, text, boolean, text
) from public, anon, authenticated, service_role;

create or replace function internal.read_zoom_orphan_cleanup_context(
  target_job uuid,
  worker_id text,
  expected_lease_generation bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  result jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or expected_lease_generation <= 0
  then
    raise exception 'ZOOM_ORPHAN_CLEANUP_SERVICE_REQUIRED';
  end if;
  perform 1
  from public.durable_jobs job
  where job.id = target_job
    and job.job_type = 'zoom_orphan_cleanup'
    and job.status = 'leased'
    and job.lease_owner = worker_id
    and job.lease_generation = expected_lease_generation
  for update;
  if not found then
    raise exception 'ZOOM_ORPHAN_CLEANUP_LEASE_GENERATION_MISMATCH';
  end if;
  result := internal.read_zoom_orphan_cleanup_context(
    target_job,
    worker_id
  );
  return result;
end
$$;

revoke all on function internal.read_zoom_orphan_cleanup_context(
  uuid, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function internal.read_zoom_orphan_cleanup_context(
  uuid, text, bigint
) to service_role;

create or replace function public.read_zoom_orphan_cleanup_context(
  p_job_id uuid,
  p_worker_id text,
  p_lease_generation bigint
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.read_zoom_orphan_cleanup_context(
    p_job_id,
    p_worker_id,
    p_lease_generation
  )
$$;

revoke all on function public.read_zoom_orphan_cleanup_context(
  uuid, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.read_zoom_orphan_cleanup_context(
  uuid, text, bigint
) to service_role;
revoke all on function internal.read_zoom_orphan_cleanup_context(
  uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.read_zoom_orphan_cleanup_context(
  uuid, text
) from public, anon, authenticated, service_role;

create or replace function internal.complete_zoom_orphan_cleanup(
  target_job uuid,
  worker_id text,
  expected_lease_generation bigint,
  provider_delete_confirmed boolean,
  preserved_authoritative boolean
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  result text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or expected_lease_generation <= 0
  then
    raise exception 'ZOOM_ORPHAN_CLEANUP_SERVICE_REQUIRED';
  end if;
  perform 1
  from public.durable_jobs job
  where job.id = target_job
    and job.job_type = 'zoom_orphan_cleanup'
    and job.status = 'leased'
    and job.lease_owner = worker_id
    and job.lease_generation = expected_lease_generation
  for update;
  if not found then
    raise exception 'ZOOM_ORPHAN_CLEANUP_LEASE_GENERATION_MISMATCH';
  end if;
  result := internal.complete_zoom_orphan_cleanup(
    target_job,
    worker_id,
    provider_delete_confirmed,
    preserved_authoritative
  );
  return result;
end
$$;

revoke all on function internal.complete_zoom_orphan_cleanup(
  uuid, text, bigint, boolean, boolean
) from public, anon, authenticated, service_role;
grant execute on function internal.complete_zoom_orphan_cleanup(
  uuid, text, bigint, boolean, boolean
) to service_role;

create or replace function public.complete_zoom_orphan_cleanup(
  p_job_id uuid,
  p_worker_id text,
  p_lease_generation bigint,
  p_provider_delete_confirmed boolean,
  p_preserved_authoritative boolean
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.complete_zoom_orphan_cleanup(
    p_job_id,
    p_worker_id,
    p_lease_generation,
    p_provider_delete_confirmed,
    p_preserved_authoritative
  )
$$;

revoke all on function public.complete_zoom_orphan_cleanup(
  uuid, text, bigint, boolean, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.complete_zoom_orphan_cleanup(
  uuid, text, bigint, boolean, boolean
) to service_role;
revoke all on function internal.complete_zoom_orphan_cleanup(
  uuid, text, boolean, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.complete_zoom_orphan_cleanup(
  uuid, text, boolean, boolean
) from public, anon, authenticated, service_role;
