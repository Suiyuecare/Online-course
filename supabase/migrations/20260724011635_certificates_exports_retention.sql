create table public.eligibility_snapshots (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  accreditation_revision_id uuid not null
    references public.accreditation_decision_revisions(id),
  authoritative_date date not null,
  entitlement_valid boolean not null,
  identity_verified boolean not null,
  recorded_requirement_met boolean not null,
  live_requirements_met boolean not null,
  quiz_passed boolean not null,
  survey_completed boolean not null,
  accreditation_valid boolean not null,
  eligible boolean generated always as (
    entitlement_valid and identity_verified and recorded_requirement_met
    and live_requirements_met and quiz_passed and survey_completed
    and accreditation_valid
  ) stored,
  evidence_manifest_hash text not null,
  signed_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create table public.accreditation_submission_batches (
  id uuid primary key default gen_random_uuid(),
  course_version_id uuid not null references public.course_versions(id),
  accreditation_revision_id uuid not null
    references public.accreditation_decision_revisions(id),
  live_session_id uuid references public.live_sessions(id),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'exported', 'submitted', 'accepted', 'needs_correction', 'rejected')),
  template_version text not null,
  application_idempotency_key uuid not null unique,
  requested_by uuid not null references public.people(id),
  approved_by uuid references public.people(id),
  submitted_by uuid references public.people(id),
  external_submission_reference text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  check (approved_by is null or approved_by <> requested_by),
  check (submitted_by is null or submitted_by <> requested_by)
);

create table public.accreditation_submission_items (
  batch_id uuid not null references public.accreditation_submission_batches(id),
  enrollment_id uuid not null references public.enrollments(id),
  eligibility_snapshot_id uuid references public.eligibility_snapshots(id),
  status text not null default 'included'
    check (status in ('included', 'excluded', 'accepted', 'needs_correction', 'rejected')),
  missing_reasons jsonb not null default '[]'::jsonb,
  primary key (batch_id, enrollment_id)
);

create table private.accreditation_exports (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.accreditation_submission_batches(id),
  encrypted_object_path text not null,
  object_sha256 text not null check (object_sha256 ~ '^[a-f0-9]{64}$'),
  envelope_key jsonb not null,
  row_count integer not null check (row_count >= 0),
  filter_snapshot jsonb not null,
  generated_by uuid not null references public.people(id),
  generated_at timestamptz not null default now()
);

create table private.export_download_capabilities (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references private.accreditation_exports(id),
  actor_id uuid not null references public.people(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at <= created_at + interval '10 minutes')
);

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null unique references public.enrollments(id),
  certificate_kind text not null check (certificate_kind in ('completion', 'accreditation')),
  current_status text not null default 'active'
    check (current_status in ('active', 'submitted', 'credited', 'needs_correction', 'rejected', 'revoked')),
  created_at timestamptz not null default now()
);

create table public.certificate_revisions (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references public.certificates(id),
  revision integer not null check (revision > 0),
  status text not null check (status in (
    'active', 'superseded', 'submitted', 'credited',
    'needs_correction', 'rejected', 'revoked'
  )),
  masked_name_snapshot text not null,
  course_title_snapshot text not null,
  course_version_snapshot integer not null,
  completed_on date not null,
  accreditation_reference_snapshot text,
  accreditation_points_snapshot numeric(6,2),
  accreditation_authority_snapshot text,
  live_session_snapshot jsonb,
  evidence_manifest_hash text not null,
  pdf_object_path text not null,
  pdf_sha256 text not null check (pdf_sha256 ~ '^[a-f0-9]{64}$'),
  verification_token_hash text not null unique
    check (verification_token_hash ~ '^[a-f0-9]{64}$'),
  issued_by uuid not null references public.people(id),
  approved_by uuid references public.people(id),
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_reason text,
  unique (certificate_id, revision),
  check (approved_by is null or approved_by <> issued_by)
);

alter table public.certificates
  add column current_revision_id uuid
  references public.certificate_revisions(id);

create table public.certificate_revocation_requests (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references public.certificates(id),
  requested_by uuid not null references public.people(id),
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create unique index one_pending_certificate_revocation
  on public.certificate_revocation_requests(certificate_id)
  where status = 'pending';

create table public.certificate_revocation_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.certificate_revocation_requests(id),
  reviewer_id uuid not null references public.people(id),
  decision text not null check (decision in ('approve', 'reject')),
  reason text not null,
  created_at timestamptz not null default now(),
  unique (request_id, reviewer_id)
);

create table public.deletion_manifests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references public.people(id),
  pseudonym text not null unique,
  data_classes jsonb not null,
  legal_holds jsonb not null default '[]'::jsonb,
  tombstone_control_plane_reference text not null,
  requested_at timestamptz not null,
  crypto_shredded_at timestamptz,
  completed_at timestamptz,
  approved_by uuid not null references public.people(id),
  second_approved_by uuid not null references public.people(id),
  check (approved_by <> second_approved_by)
);

create table public.archive_manifests (
  id uuid primary key default gen_random_uuid(),
  data_class text not null,
  partition_name text not null,
  object_reference text not null,
  row_count bigint not null check (row_count >= 0),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  recomputed_summary_sha256 text not null,
  reload_verified_at timestamptz,
  signed_at timestamptz not null,
  deleted_hot_at timestamptz,
  unique (data_class, partition_name)
);

create table public.storage_backup_manifests (
  id uuid primary key default gen_random_uuid(),
  bucket_name text not null,
  backup_date date not null,
  object_count bigint not null check (object_count >= 0),
  total_bytes bigint not null check (total_bytes >= 0),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  tombstones_replayed_at timestamptz,
  restore_verified_at timestamptz,
  external_object_reference text not null,
  unique (bucket_name, backup_date)
);

create table public.audit_hash_checkpoints (
  id uuid primary key default gen_random_uuid(),
  sequence_from bigint not null,
  sequence_to bigint not null,
  root_hash text not null check (root_hash ~ '^[a-f0-9]{64}$'),
  signature_reference text not null,
  external_object_reference text not null,
  created_at timestamptz not null default now(),
  unique (sequence_from, sequence_to),
  check (sequence_to >= sequence_from)
);

create trigger eligibility_snapshots_append_only
before update or delete on public.eligibility_snapshots
for each row execute function internal.prevent_append_only_change();
create trigger certificate_revisions_append_only
before update or delete on public.certificate_revisions
for each row execute function internal.prevent_append_only_change();
create trigger deletion_manifests_append_only
before update or delete on public.deletion_manifests
for each row execute function internal.prevent_append_only_change();
create trigger archive_manifests_append_only
before update or delete on public.archive_manifests
for each row execute function internal.prevent_append_only_change();
create trigger backup_manifests_append_only
before update or delete on public.storage_backup_manifests
for each row execute function internal.prevent_append_only_change();
create trigger audit_checkpoints_append_only
before update or delete on public.audit_hash_checkpoints
for each row execute function internal.prevent_append_only_change();
