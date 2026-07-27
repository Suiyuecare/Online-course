create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
create schema if not exists internal;
revoke all on schema private from public, anon, authenticated;
revoke all on schema internal from public, anon, authenticated;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'suiyue_audit_owner') then
    create role suiyue_audit_owner nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'suiyue_money_owner') then
    create role suiyue_money_owner nologin noinherit;
  end if;
end
$roles$;

create table public.people (
  id uuid primary key default gen_random_uuid(),
  display_name text,
  verified_email text,
  email_verified_at timestamptz,
  identity_epoch bigint not null default 1 check (identity_epoch > 0),
  created_at timestamptz not null default now(),
  anonymized_at timestamptz
);

create table public.auth_identities (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  active boolean not null default true,
  restricted boolean not null default false,
  restriction_reason text,
  trusted_device_verified_at timestamptz,
  last_high_assurance_at timestamptz,
  session_valid_after timestamptz not null default '-infinity',
  identity_epoch bigint not null default 1 check (identity_epoch > 0),
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

create unique index one_active_identity_per_person
  on public.auth_identities(person_id) where active;

create table public.staff_roles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id),
  role text not null check (role in (
    'instructor', 'course_admin', 'accreditation_reviewer', 'finance',
    'support', 'platform_admin'
  )),
  active boolean not null default true,
  approved_request_id uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (person_id, role)
);

create table public.role_approval_requests (
  id uuid primary key default gen_random_uuid(),
  subject_person_id uuid not null references public.people(id),
  requested_role text not null,
  requested_action text not null
    check (requested_action in ('grant', 'revoke')),
  requested_by uuid not null references public.people(id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reason text not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table public.staff_roles
  add constraint staff_roles_approval_fk
  foreign key (approved_request_id)
  references public.role_approval_requests(id);

create table public.role_approval_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.role_approval_requests(id),
  reviewer_id uuid not null references public.people(id),
  decision text not null check (decision in ('approve', 'reject')),
  reason text not null,
  decided_at timestamptz not null default now(),
  unique (request_id, reviewer_id)
);

create unique index one_pending_role_change_per_subject_role
  on public.role_approval_requests(subject_person_id, requested_role)
  where status = 'pending';

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  tax_id_blind_index text not null unique,
  contact_person_id uuid references public.people(id),
  invoice_email text not null,
  status text not null default 'submitted'
    check (status in ('submitted', 'approved', 'rejected', 'suspended')),
  application_idempotency_key uuid not null unique,
  reviewed_by uuid references public.people(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  person_id uuid not null references public.people(id),
  role text not null check (role in ('owner', 'training_manager', 'finance', 'member')),
  active boolean not null default true,
  employee_number text,
  department text,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (organization_id, person_id)
);

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  phone_ciphertext jsonb not null,
  phone_blind_index text not null,
  token_hash text not null unique,
  role text not null default 'member'
    check (role in ('training_manager', 'finance', 'member')),
  employee_name text,
  employee_number text,
  department text,
  invited_by uuid not null references public.people(id),
  idempotency_key uuid not null default gen_random_uuid(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  reversible_phone_purged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, phone_blind_index),
  unique (invited_by, idempotency_key)
);

create table public.organization_invitation_actions (
  id uuid primary key default gen_random_uuid(),
  organization_invitation_id uuid not null
    references public.organization_invitations(id),
  actor_person_id uuid not null references public.people(id),
  operation text not null check (operation in ('resend', 'revoke')),
  idempotency_key uuid not null,
  resulting_status text not null,
  created_at timestamptz not null default now(),
  unique (actor_person_id, idempotency_key)
);

create table private.person_encryption_keys (
  person_id uuid primary key references public.people(id),
  wrapped_dek jsonb not null,
  kek_version text not null,
  rewrap_status text not null default 'current',
  created_at timestamptz not null default now()
);

create table private.accreditation_identity_profiles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references public.people(id),
  profile_revision integer not null default 1 check (profile_revision > 0),
  encrypted_fields jsonb not null,
  national_id_blind_index_current text unique,
  national_id_blind_index_previous text,
  care_worker_id_blind_index_current text,
  care_worker_id_blind_index_previous text,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'verified', 'needs_correction', 'rejected')),
  verified_by uuid references public.people(id),
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.identity_verification_cases (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id),
  profile_id uuid references private.accreditation_identity_profiles(id),
  status text not null default 'open'
    check (status in ('open', 'needs_correction', 'approved', 'rejected', 'closed')),
  reason text not null,
  assigned_reviewer_id uuid references public.people(id),
  attachment_purge_after timestamptz,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create unique index one_open_identity_verification_case_per_person
  on public.identity_verification_cases(person_id)
  where status in ('open', 'needs_correction');

create table public.identity_verification_access_approvals (
  id uuid primary key default gen_random_uuid(),
  verification_case_id uuid not null
    references public.identity_verification_cases(id),
  reviewer_id uuid not null references public.people(id),
  reason text not null,
  approved_at timestamptz not null default now(),
  unique (verification_case_id, reviewer_id)
);

create table private.identity_review_access_grants (
  id uuid primary key default gen_random_uuid(),
  verification_case_id uuid not null
    references public.identity_verification_cases(id),
  actor_id uuid not null references public.people(id),
  identity_epoch bigint not null,
  reason text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at <= created_at + interval '2 minutes')
);

create table public.identity_recovery_cases (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id),
  kind text not null check (kind in ('lost_phone', 'recycled_number', 'totp_recovery')),
  status text not null default 'submitted'
    check (status in ('submitted', 'reviewing', 'cooling_off', 'approved', 'rejected')),
  submitted_by uuid not null references public.people(id),
  evidence_summary text not null,
  replacement_auth_user_id uuid references auth.users(id),
  provider_confirmation_hash text,
  idempotency_key uuid not null unique,
  cooling_off_until timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index one_open_recovery_case_per_person
  on public.identity_recovery_cases(person_id)
  where status in ('submitted', 'reviewing', 'cooling_off');

create table public.identity_recovery_decisions (
  id uuid primary key default gen_random_uuid(),
  recovery_case_id uuid not null references public.identity_recovery_cases(id),
  reviewer_id uuid not null references public.people(id),
  decision text not null check (decision in ('approve', 'reject')),
  reason text not null,
  created_at timestamptz not null default now(),
  unique (recovery_case_id, reviewer_id)
);

create table private.step_up_grants (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.people(id),
  action text not null,
  target text not null,
  nonce_hash text not null unique,
  identity_epoch bigint not null,
  totp_verified_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at <= created_at + interval '5 minutes')
);

create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'b2c_contract', 'b2b_contract', 'privacy_notice', 'refund_policy',
    'pending_accreditation_disclosure'
  )),
  revision integer not null check (revision > 0),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  object_path text not null,
  approved_by_legal boolean not null default false,
  effective_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, revision)
);

create table public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id),
  legal_document_id uuid not null references public.legal_documents(id),
  first_presented_at timestamptz not null,
  second_confirmed_at timestamptz,
  first_ip inet not null,
  second_ip inet,
  first_device_hash text not null,
  second_device_hash text,
  document_hash_snapshot text not null,
  created_at timestamptz not null default now(),
  check (
    second_confirmed_at is null
    or second_confirmed_at >= first_presented_at + interval '72 hours'
  )
);

create table public.retention_policy_revisions (
  id uuid primary key default gen_random_uuid(),
  data_class text not null,
  revision integer not null check (revision > 0),
  online_days integer not null check (online_days >= 0),
  archive_days integer not null check (archive_days >= online_days),
  legal_basis text not null,
  approved_by uuid not null references public.people(id),
  effective_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (data_class, revision)
);

create table public.operating_setting_revisions (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null,
  revision integer not null check (revision > 0),
  value jsonb not null,
  approved_by uuid not null references public.people(id),
  second_approved_by uuid references public.people(id),
  effective_at timestamptz not null,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  check (second_approved_by is null or second_approved_by <> approved_by),
  unique (setting_key, revision)
);

-- Platform prerequisites are staged separately from their authoritative
-- tables. Creation never enables a feature or asserts a qualification; a
-- distinct AAL2 platform administrator must approve and materialize it.
create table public.platform_prerequisite_changes (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'operating_setting', 'organizing_body',
    'accreditation_authority', 'accreditation_revision',
    'retention_policy_revision', 'legal_document_revision',
    'zoom_host_resource'
  )),
  specification jsonb not null,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected')),
  created_by uuid not null references public.people(id),
  reviewed_by uuid references public.people(id),
  materialized_target_id uuid,
  creation_reason text not null,
  review_reason text,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check (reviewed_by is null or reviewed_by <> created_by),
  check (
    (status = 'pending_review'
      and reviewed_by is null
      and reviewed_at is null
      and review_reason is null)
    or
    (status in ('approved', 'rejected')
      and reviewed_by is not null
      and reviewed_at is not null
      and review_reason is not null)
  ),
  unique (created_by, idempotency_key)
);

create table public.feature_switches (
  name text primary key check (name in (
    'b2c_commerce', 'organization_topup', 'organization_assignment',
    'recorded_playback', 'live_booking', 'zoom_join', 'hybrid_completion',
    'accreditation_export', 'certificate_issue'
  )),
  enabled boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references public.people(id),
  suspended_at timestamptz,
  suspended_by uuid references public.people(id),
  reason text not null default 'initial fail-closed state',
  updated_at timestamptz not null default now()
);

insert into public.feature_switches (name)
values
  ('b2c_commerce'), ('organization_topup'), ('organization_assignment'),
  ('recorded_playback'), ('live_booking'), ('zoom_join'),
  ('hybrid_completion'), ('accreditation_export'), ('certificate_issue')
on conflict (name) do nothing;

create table private.bootstrap_markers (
  key text primary key,
  completed_at timestamptz not null,
  first_admin_id uuid not null references public.people(id),
  second_admin_id uuid not null references public.people(id),
  execution_hash text not null,
  check (first_admin_id <> second_admin_id)
);

create or replace function internal.handle_new_phone_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_person_id uuid;
begin
  if new.phone is null then
    raise exception 'PHONE_AUTH_ONLY';
  end if;
  insert into public.people default values returning id into new_person_id;
  insert into public.auth_identities (
    person_id, auth_user_id, restricted, restriction_reason
  ) values (
    new_person_id, new.id, false, null
  );
  return new;
end
$$;

revoke all on function internal.handle_new_phone_identity() from public;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function internal.handle_new_phone_identity();
