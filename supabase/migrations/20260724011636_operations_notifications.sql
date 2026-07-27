create table public.audit_events (
  sequence bigint generated always as identity primary key,
  actor_id uuid references public.people(id),
  action text not null,
  target_type text not null,
  target_id text not null,
  organization_id uuid references public.organizations(id),
  reason text,
  request_id uuid,
  source_ip inet,
  event_data jsonb not null default '{}'::jsonb,
  previous_hash text,
  event_hash text not null,
  occurred_at timestamptz not null default now()
);
alter table public.audit_events owner to suiyue_audit_owner;

create table public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.people(id),
  operation text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  locked_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (actor_id, operation, idempotency_key)
);

create table public.provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('cloudflare_stream', 'zoom', 'resend')),
  event_type text not null,
  native_event_id text,
  canonical_fingerprint text not null,
  provider_occurred_at timestamptz,
  payload jsonb not null,
  environment text not null check (environment in ('development', 'test', 'preview', 'production')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  unique (provider, canonical_fingerprint)
);

create unique index provider_native_event_unique
  on public.provider_events(provider, native_event_id)
  where native_event_id is not null;

create table public.provider_health (
  provider text primary key,
  status text not null check (status in ('unknown', 'healthy', 'degraded', 'down', 'disabled')),
  checked_at timestamptz,
  last_success_at timestamptz,
  last_event_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  production_validated_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.provider_health (provider, status)
values
  ('supabase_phone_auth', 'disabled'),
  ('twilio_verify', 'disabled'),
  ('cloudflare_stream', 'disabled'),
  ('zoom_oauth', 'disabled'),
  ('zoom_meeting_sdk', 'disabled'),
  ('resend', 'disabled'),
  ('managed_kms', 'disabled'),
  ('malware_scanner', 'disabled'),
  ('external_monitor', 'disabled')
on conflict (provider) do nothing;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id),
  category text not null,
  title text not null,
  body text not null,
  business_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (person_id, business_key)
);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id),
  channel text not null check (channel in ('email', 'sms')),
  destination_ciphertext jsonb not null,
  template_key text not null,
  template_data jsonb not null,
  business_idempotency_key text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'leased', 'delivered', 'retry', 'dead_letter', 'suppressed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create table public.notification_delivery_events (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.notification_outbox(id),
  provider_event_id uuid references public.provider_events(id),
  provider_message_id text,
  status text not null check (status in (
    'accepted', 'delivered', 'bounced', 'complained', 'suppressed', 'failed'
  )),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table private.email_verification_challenges (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id),
  normalized_email text not null,
  code_hmac text not null,
  error_count integer not null default 0 check (error_count between 0 and 5),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  replaced_at timestamptz,
  request_ip inet not null,
  created_at timestamptz not null default now()
);

create unique index one_active_email_challenge
  on private.email_verification_challenges(person_id, normalized_email)
  where consumed_at is null and replaced_at is null;

create table public.durable_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  business_key text not null unique,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'leased', 'completed', 'retry', 'dead_letter')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.worker_heartbeats (
  worker_name text primary key,
  last_started_at timestamptz,
  last_success_at timestamptz,
  oldest_job_age interval,
  dead_letter_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.support_cases (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references public.people(id),
  organization_id uuid references public.organizations(id),
  kind text not null,
  status text not null default 'open'
    check (status in ('open', 'investigating', 'waiting_customer', 'resolved', 'closed')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'critical')),
  summary text not null,
  assigned_to uuid references public.people(id),
  response_due_at timestamptz not null default (now() + interval '15 days'),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.security_incidents (
  id uuid primary key default gen_random_uuid(),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open'
    check (status in ('open', 'contained', 'investigating', 'resolved', 'closed')),
  owner text not null,
  summary text not null,
  detected_at timestamptz not null,
  contained_at timestamptz,
  legal_contacted_at timestamptz,
  notification_deadline_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.upload_quarantine (
  id uuid primary key default gen_random_uuid(),
  owner_person_id uuid references public.people(id),
  organization_id uuid references public.organizations(id),
  purpose text not null check (purpose in (
    'payment_proof', 'identity_correction', 'course_material',
    'organization_roster', 'bank_statement'
  )),
  object_path text not null unique,
  declared_mime text not null,
  detected_mime text,
  byte_size bigint not null check (byte_size > 0),
  image_pixels bigint,
  archive_entry_count integer,
  expanded_byte_size bigint,
  content_sha256 text not null,
  status text not null default 'quarantined'
    check (status in ('quarantined', 'scanning', 'safe', 'rejected', 'failed', 'promoted')),
  scanner_result jsonb,
  metadata_stripped boolean not null default false,
  promoted_object_path text,
  purge_after timestamptz,
  created_at timestamptz not null default now(),
  scanned_at timestamptz
);

alter table public.identity_recovery_cases
  add column evidence_upload_id uuid
  references public.upload_quarantine(id);

create table public.external_monitor_signals (
  id uuid primary key default gen_random_uuid(),
  monitor_name text not null,
  signal_type text not null check (signal_type in (
    'public_site', 'auth', 'health', 'dead_man', 'alert_delivery'
  )),
  healthy boolean not null,
  checked_at timestamptz not null,
  external_reference text not null,
  details jsonb not null default '{}'::jsonb
);

create table public.rate_limit_counters (
  scope_hash text not null,
  action text not null,
  window_started_at timestamptz not null,
  count integer not null check (count >= 0),
  primary key (scope_hash, action, window_started_at)
);

create trigger audit_events_append_only
before update or delete on public.audit_events
for each row execute function internal.prevent_append_only_change();
create trigger provider_events_append_only
before update or delete on public.provider_events
for each row execute function internal.prevent_append_only_change();
create trigger notification_delivery_append_only
before update or delete on public.notification_delivery_events
for each row execute function internal.prevent_append_only_change();
create trigger external_monitor_append_only
before update or delete on public.external_monitor_signals
for each row execute function internal.prevent_append_only_change();
