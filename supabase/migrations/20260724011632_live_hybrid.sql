create extension if not exists btree_gist with schema extensions;

create table public.zoom_host_resources (
  id uuid primary key default gen_random_uuid(),
  host_user_reference text not null unique,
  backup_host_reference text,
  verified_total_capacity integer not null check (verified_total_capacity > 0),
  concurrency_slot integer not null default 1 check (concurrency_slot > 0),
  license_verified_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  course_version_id uuid not null references public.course_versions(id),
  hybrid_component_id uuid references public.hybrid_components(id),
  title text not null,
  status text not null default 'draft'
    check (status in (
      'draft', 'scheduled', 'open', 'in_progress', 'ended',
      'cancelled', 'reconciling'
    )),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  booking_close_at timestamptz not null,
  learner_capacity integer not null check (learner_capacity between 1 and 200),
  verified_zoom_total_capacity integer not null
    check (verified_zoom_total_capacity > 0),
  host_seats integer not null default 1 check (host_seats >= 1),
  cohost_seats integer not null default 0 check (cohost_seats >= 0),
  reserved_support_seats integer not null default 0
    check (reserved_support_seats >= 0),
  scheduled_teaching_seconds integer not null
    check (scheduled_teaching_seconds > 0),
  locked_break_seconds integer not null default 0
    check (locked_break_seconds >= 0),
  presence_threshold numeric(5,2) not null default 80
    check (presence_threshold between 80 and 100),
  camera_threshold numeric(5,2) not null default 80
    check (camera_threshold between 80 and 100),
  evidence_settles_at timestamptz not null,
  application_idempotency_key uuid not null unique,
  calendar_sequence integer not null default 0
    check (calendar_sequence >= 0),
  created_by uuid not null references public.people(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (booking_close_at < starts_at),
  check (locked_break_seconds < scheduled_teaching_seconds),
  check (evidence_settles_at = ends_at + interval '24 hours')
);

create table public.live_breaks (
  id uuid primary key default gen_random_uuid(),
  live_session_id uuid not null references public.live_sessions(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (live_session_id, starts_at)
);

create table public.live_break_revisions (
  id uuid primary key default gen_random_uuid(),
  live_session_id uuid not null references public.live_sessions(id),
  actor_person_id uuid not null references public.people(id),
  idempotency_key uuid not null,
  break_intervals_snapshot jsonb not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (actor_person_id, idempotency_key)
);

alter table public.live_breaks
  add constraint live_breaks_do_not_overlap
  exclude using gist (
    live_session_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  );

create or replace function internal.guard_live_break_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  session_row public.live_sessions%rowtype;
  controlled_shift text :=
    current_setting('app.suiyue_controlled_break_shift', true);
begin
  if tg_op = 'DELETE' then
    if old.locked_at is not null then
      raise exception 'LOCKED_LIVE_BREAK_IMMUTABLE';
    end if;
    if not exists (
      select 1
      from public.live_sessions
      where id = old.live_session_id
        and status = 'draft'
    ) then
      raise exception 'LIVE_BREAK_DRAFT_REQUIRED';
    end if;
    return old;
  end if;

  select * into session_row
  from public.live_sessions
  where id = new.live_session_id;
  if not found
     or new.starts_at < session_row.starts_at
     or new.ends_at > session_row.ends_at
  then
    raise exception 'LIVE_BREAK_OUTSIDE_TEACHING_WINDOW';
  end if;

  if tg_op = 'INSERT' then
    if session_row.status <> 'draft' or new.locked_at is not null then
      raise exception 'LIVE_BREAK_DRAFT_REQUIRED';
    end if;
    return new;
  end if;

  if old.locked_at is not null then
    if controlled_shift is distinct from old.live_session_id::text
       or new.live_session_id <> old.live_session_id
       or new.locked_at is distinct from old.locked_at
       or (new.ends_at - new.starts_at) <> (old.ends_at - old.starts_at)
    then
      raise exception 'LOCKED_LIVE_BREAK_IMMUTABLE';
    end if;
    return new;
  end if;

  if session_row.status <> 'draft'
     or (
       new.locked_at is not null
       and current_setting('app.suiyue_locking_live_breaks', true)
         is distinct from old.live_session_id::text
     )
  then
    raise exception 'LIVE_BREAK_DRAFT_REQUIRED';
  end if;
  return new;
end
$$;
revoke all on function internal.guard_live_break_revision() from public;

create trigger live_break_revision_guard
before insert or update or delete on public.live_breaks
for each row execute function internal.guard_live_break_revision();

create table public.live_session_assistants (
  live_session_id uuid not null references public.live_sessions(id),
  person_id uuid not null references public.people(id),
  role text not null check (role in ('assistant', 'cohost', 'reserved_support')),
  confirmed_present_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (live_session_id, person_id)
);

create table public.zoom_host_reservations (
  id uuid primary key default gen_random_uuid(),
  host_resource_id uuid not null references public.zoom_host_resources(id),
  live_session_id uuid not null references public.live_sessions(id),
  reservation_window tstzrange not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'reconciling', 'released')),
  expires_at timestamptz,
  saga_key uuid not null unique,
  created_at timestamptz not null default now()
);

alter table public.zoom_host_reservations
  add constraint no_zoom_host_collision
  exclude using gist (
    host_resource_id with =,
    reservation_window with &&
  ) where (status in ('pending', 'confirmed', 'reconciling'));

create table private.zoom_meetings (
  live_session_id uuid primary key references public.live_sessions(id),
  meeting_number text not null unique,
  meeting_uuid text,
  encrypted_passcode jsonb not null,
  provider_host_id text not null,
  waiting_room boolean not null default true,
  participant_rename_disabled boolean not null default true,
  participant_share_disabled boolean not null default true,
  cloud_recording_disabled boolean not null default true,
  removed_participant_rejoin_disabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.live_bookings (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id),
  enrollment_id uuid references public.enrollments(id),
  course_version_id uuid not null references public.course_versions(id),
  live_component_id uuid references public.hybrid_components(id),
  live_session_id uuid not null references public.live_sessions(id),
  payer_type text not null check (payer_type in ('b2c', 'organization')),
  payer_source_id uuid not null,
  status text not null default 'held'
    check (status in ('held', 'confirmed', 'cancelled', 'attended', 'released')),
  customer_key text not null unique
    check (customer_key ~ '^[A-Za-z0-9_-]{32}$'),
  hold_expires_at timestamptz,
  change_locked_at timestamptz not null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (person_id, idempotency_key)
);

create unique index one_equivalent_live_booking
  on public.live_bookings (
    person_id,
    course_version_id,
    coalesce(live_component_id, course_version_id)
  )
  where status in ('held', 'confirmed', 'attended');

create table public.live_join_leases (
  id uuid primary key default gen_random_uuid(),
  live_booking_id uuid not null references public.live_bookings(id),
  person_id uuid not null references public.people(id),
  lease_epoch bigint not null check (lease_epoch > 0),
  issuance_idempotency_key uuid not null,
  device_hash text not null,
  synthetic_email text not null unique,
  provider_customer_key text not null unique
    check (provider_customer_key ~ '^[A-Za-z0-9_-]{32}$'),
  zoom_registrant_id text,
  zoom_participant_uuid text,
  registrant_token_ciphertext jsonb,
  credential_expires_at timestamptz not null,
  active boolean not null default true,
  old_registrant_revoked_at timestamptz,
  old_participant_removed_at timestamptz,
  duplicate_anomaly_at timestamptz,
  last_heartbeat_sequence bigint not null default 0
    check (last_heartbeat_sequence >= 0),
  last_heartbeat_at timestamptz,
  abort_idempotency_key uuid,
  abort_reason text,
  created_at timestamptz not null default now(),
  unique (person_id, issuance_idempotency_key)
);

create unique index one_active_live_lease_per_booking
  on public.live_join_leases(live_booking_id) where active;

create table public.zoom_participant_events (
  id uuid not null default gen_random_uuid(),
  live_session_id uuid not null references public.live_sessions(id),
  provider_event_type text not null,
  meeting_uuid text not null,
  participant_uuid text,
  customer_key text,
  provider_occurrence_at timestamptz not null,
  ingest_sequence bigint generated always as identity,
  canonical_fingerprint text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  primary key (id, received_at),
  unique (canonical_fingerprint, received_at)
) partition by range (received_at);

create table public.zoom_participant_events_default
  partition of public.zoom_participant_events default;
create index zoom_participant_events_evidence_lookup
  on public.zoom_participant_events(
    live_session_id, customer_key, participant_uuid,
    provider_occurrence_at, provider_event_type
  );

create table public.live_client_heartbeats (
  id uuid not null default gen_random_uuid(),
  live_session_id uuid not null references public.live_sessions(id),
  join_lease_id uuid not null references public.live_join_leases(id),
  sequence bigint not null check (sequence > 0),
  camera_on boolean not null,
  device_test_passed boolean not null,
  received_at timestamptz not null default now(),
  primary key (id, received_at),
  unique (join_lease_id, sequence, received_at)
) partition by range (received_at);

create table public.live_client_heartbeats_default
  partition of public.live_client_heartbeats default;
create index live_client_heartbeats_settlement_lookup
  on public.live_client_heartbeats(
    live_session_id, join_lease_id, received_at, sequence
  );

create table public.check_events (
  id uuid primary key default gen_random_uuid(),
  live_booking_id uuid not null references public.live_bookings(id),
  event_type text not null check (event_type in ('check_in', 'check_out')),
  device_test_passed boolean not null,
  occurred_at timestamptz not null default now(),
  idempotency_key uuid not null,
  unique (live_booking_id, event_type),
  unique (live_booking_id, idempotency_key)
);

create table public.live_evidence_events (
  id uuid primary key default gen_random_uuid(),
  live_session_id uuid not null references public.live_sessions(id),
  event_type text not null check (event_type in (
    'actual_started', 'actual_ended', 'actual_break_started',
    'actual_break_ended', 'assistant_present', 'assistant_absent',
    'provider_anomaly'
  )),
  occurred_at timestamptz not null,
  actor_id uuid references public.people(id),
  evidence jsonb not null,
  created_at timestamptz not null default now()
);

create table public.attendance_summaries (
  id uuid primary key default gen_random_uuid(),
  live_booking_id uuid not null unique references public.live_bookings(id),
  denominator_seconds integer not null check (denominator_seconds > 0),
  effective_presence_seconds integer not null check (effective_presence_seconds >= 0),
  camera_seconds integer not null check (camera_seconds >= 0),
  presence_percent numeric(6,3) not null check (presence_percent between 0 and 100),
  camera_percent numeric(6,3) not null check (camera_percent between 0 and 100),
  device_check_passed boolean not null,
  checked_in boolean not null,
  checked_out boolean not null,
  qualified boolean not null,
  source_manifest_hash text not null,
  settled_at timestamptz not null,
  corrected_at timestamptz,
  quarantined_at timestamptz,
  quarantine_reason text,
  check (effective_presence_seconds <= denominator_seconds),
  check (camera_seconds <= denominator_seconds),
  check (
    (quarantined_at is null and quarantine_reason is null)
    or
    (quarantined_at is not null and quarantine_reason is not null)
  )
);

create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  attendance_summary_id uuid not null references public.attendance_summaries(id),
  proposed_by uuid not null references public.people(id),
  approved_by uuid references public.people(id),
  presence_seconds_delta integer not null default 0,
  camera_seconds_delta integer not null default 0,
  reason text not null,
  evidence_reference text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (approved_by is null or approved_by <> proposed_by)
);

create table public.attendance_correction_decisions (
  id uuid primary key default gen_random_uuid(),
  attendance_correction_id uuid not null unique
    references public.attendance_corrections(id),
  decided_by uuid not null references public.people(id),
  decision text not null check (decision in ('approve', 'reject')),
  reason text not null,
  decided_at timestamptz not null default now()
);

create table public.provider_anomaly_resolution_requests (
  id uuid primary key default gen_random_uuid(),
  live_join_lease_id uuid not null references public.live_join_leases(id),
  proposed_by uuid not null references public.people(id),
  resolution_kind text not null check (
    resolution_kind in (
      'synthesize_left', 'accept_provider_evidence',
      'disqualify_booking'
    )
  ),
  participant_uuid text,
  assumed_left_at timestamptz,
  reason text not null check (length(trim(reason)) >= 10),
  evidence_reference text not null
    check (length(trim(evidence_reference)) >= 3),
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  check (
    (
      resolution_kind = 'synthesize_left'
      and participant_uuid is not null
      and assumed_left_at is not null
    )
    or (
      resolution_kind in (
        'accept_provider_evidence', 'disqualify_booking'
      )
      and participant_uuid is null
      and assumed_left_at is null
    )
  )
);

create table public.provider_anomaly_resolution_decisions (
  id uuid primary key default gen_random_uuid(),
  resolution_request_id uuid not null unique
    references public.provider_anomaly_resolution_requests(id),
  decided_by uuid not null references public.people(id),
  decision text not null check (decision in ('approve', 'reject')),
  reason text not null check (length(trim(reason)) >= 10),
  decided_at timestamptz not null default now()
);

create table public.attendance_summary_revisions (
  id uuid primary key default gen_random_uuid(),
  attendance_summary_id uuid not null
    references public.attendance_summaries(id),
  revision integer not null check (revision > 0),
  denominator_seconds integer not null check (denominator_seconds > 0),
  effective_presence_seconds integer not null
    check (effective_presence_seconds >= 0),
  camera_seconds integer not null check (camera_seconds >= 0),
  presence_percent numeric(6,3) not null
    check (presence_percent between 0 and 100),
  camera_percent numeric(6,3) not null
    check (camera_percent between 0 and 100),
  device_check_passed boolean not null,
  checked_in boolean not null,
  checked_out boolean not null,
  qualified boolean not null,
  source_manifest_hash text not null,
  source_kind text not null check (
    source_kind in ('initial_settlement', 'provider_anomaly_recompute')
  ),
  provider_anomaly_resolution_request_id uuid
    references public.provider_anomaly_resolution_requests(id),
  created_at timestamptz not null default now(),
  unique (attendance_summary_id, revision),
  unique (attendance_summary_id, source_manifest_hash),
  check (effective_presence_seconds <= denominator_seconds),
  check (camera_seconds <= denominator_seconds),
  check (
    (source_kind = 'initial_settlement'
      and provider_anomaly_resolution_request_id is null)
    or
    (source_kind = 'provider_anomaly_recompute'
      and provider_anomaly_resolution_request_id is not null)
  )
);

create trigger zoom_events_append_only
before update or delete on public.zoom_participant_events
for each row execute function internal.prevent_append_only_change();
create trigger live_heartbeats_append_only
before update or delete on public.live_client_heartbeats
for each row execute function internal.prevent_append_only_change();
create trigger check_events_append_only
before update or delete on public.check_events
for each row execute function internal.prevent_append_only_change();
create trigger live_evidence_append_only
before update or delete on public.live_evidence_events
for each row execute function internal.prevent_append_only_change();
create trigger attendance_corrections_append_only
before update or delete on public.attendance_corrections
for each row execute function internal.prevent_append_only_change();
create trigger attendance_correction_decisions_append_only
before update or delete on public.attendance_correction_decisions
for each row execute function internal.prevent_append_only_change();
create trigger provider_anomaly_resolution_requests_append_only
before update or delete on public.provider_anomaly_resolution_requests
for each row execute function internal.prevent_append_only_change();
create trigger provider_anomaly_resolution_decisions_append_only
before update or delete on public.provider_anomaly_resolution_decisions
for each row execute function internal.prevent_append_only_change();
create trigger attendance_summary_revisions_append_only
before update or delete on public.attendance_summary_revisions
for each row execute function internal.prevent_append_only_change();
