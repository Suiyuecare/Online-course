create table public.organizing_bodies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  qualification_reference text not null,
  qualification_valid_from date not null,
  qualification_valid_until date,
  contact_name text not null,
  contact_email text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.accreditation_authorities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  submission_method text not null,
  contact_name text not null,
  contact_email text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.instructors (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references public.people(id),
  display_name text not null,
  biography text not null,
  credentials text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  internal_title text not null,
  created_by uuid not null references public.people(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.course_versions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  version integer not null check (version > 0),
  title text not null,
  summary text not null,
  description text not null,
  learning_objectives jsonb not null default '[]'::jsonb,
  delivery_type text not null check (delivery_type in ('recorded', 'live', 'hybrid')),
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'published', 'suspended', 'archived')),
  price_twd integer check (price_twd is null or price_twd >= 0),
  organization_point_price integer
    check (organization_point_price is null or organization_point_price > 0),
  recorded_refund_allocation_twd integer not null default 0
    check (recorded_refund_allocation_twd >= 0),
  live_refund_allocations jsonb not null default '{}'::jsonb,
  cover_path text,
  has_cover boolean not null default false,
  equipment_requirements text not null default '',
  legal_document_id uuid references public.legal_documents(id),
  retention_policy_revision_id uuid
    references public.retention_policy_revisions(id),
  minimum_completion_window interval,
  commerce_close_at timestamptz,
  content_available_at timestamptz,
  created_by uuid not null references public.people(id),
  submitted_by uuid references public.people(id),
  published_by uuid references public.people(id),
  submitted_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  authoring_idempotency_key uuid not null unique,
  unique (course_id, version),
  check (price_twd is null or price_twd >= recorded_refund_allocation_twd)
);

create table public.course_instructors (
  course_version_id uuid not null references public.course_versions(id),
  instructor_id uuid not null references public.instructors(id),
  sort_order integer not null check (sort_order >= 0),
  primary key (course_version_id, instructor_id)
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  course_version_id uuid not null references public.course_versions(id),
  title text not null,
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (course_version_id, sort_order)
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules(id),
  title text not null,
  content_type text not null check (content_type in ('video', 'material', 'quiz', 'survey')),
  preview boolean not null default false,
  sort_order integer not null check (sort_order >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (module_id, sort_order)
);

create table public.video_assets (
  id uuid primary key default gen_random_uuid(),
  provider_uid text not null unique,
  status text not null default 'uploading'
    check (status in ('uploading', 'processing', 'ready', 'failed', 'archived')),
  require_signed_urls boolean not null default true,
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  master_backup_reference text,
  provider_payload jsonb not null default '{}'::jsonb,
  failure_reason text,
  application_idempotency_key uuid not null unique,
  uploaded_by uuid not null references public.people(id),
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  archived_at timestamptz,
  check (status <> 'ready' or master_backup_reference is not null)
);

create table public.lesson_video_versions (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id),
  video_asset_id uuid not null references public.video_assets(id),
  version integer not null check (version > 0),
  active boolean not null default true,
  created_by uuid not null references public.people(id),
  created_at timestamptz not null default now(),
  unique (lesson_id, version)
);

create table public.course_materials (
  id uuid primary key default gen_random_uuid(),
  course_version_id uuid not null references public.course_versions(id),
  lesson_id uuid references public.lessons(id),
  title text not null,
  quarantine_object_path text not null,
  promoted_object_path text,
  scan_status text not null default 'quarantined'
    check (scan_status in ('quarantined', 'scanning', 'safe', 'rejected', 'failed')),
  content_sha256 text not null,
  created_by uuid not null references public.people(id),
  created_at timestamptz not null default now()
);

create table public.course_requirements (
  course_version_id uuid primary key references public.course_versions(id),
  required_watch_seconds integer not null default 0
    check (required_watch_seconds >= 0),
  quiz_question_count integer not null default 10
    check (quiz_question_count = 10),
  quiz_pass_percent integer not null default 80
    check (quiz_pass_percent = 80),
  quiz_duration_minutes integer not null default 30
    check (quiz_duration_minutes = 30),
  survey_required boolean not null default true,
  live_presence_percent numeric(5,2)
    check (live_presence_percent is null or live_presence_percent >= 80),
  live_camera_percent numeric(5,2)
    check (live_camera_percent is null or live_camera_percent >= 80),
  locked_at timestamptz
);

create table public.hybrid_components (
  id uuid primary key default gen_random_uuid(),
  course_version_id uuid not null references public.course_versions(id),
  component_type text not null check (component_type in ('recorded', 'live')),
  title text not null,
  required boolean not null default true,
  sort_order integer not null check (sort_order >= 0),
  refund_allocation_twd integer not null check (refund_allocation_twd >= 0),
  created_at timestamptz not null default now(),
  unique (course_version_id, sort_order)
);

create table public.component_prerequisites (
  course_version_id uuid not null references public.course_versions(id),
  prerequisite_component_id uuid not null references public.hybrid_components(id),
  dependent_component_id uuid not null references public.hybrid_components(id),
  primary key (prerequisite_component_id, dependent_component_id),
  check (prerequisite_component_id <> dependent_component_id)
);

create table public.accreditation_decision_revisions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  organizing_body_id uuid not null references public.organizing_bodies(id),
  authority_id uuid not null references public.accreditation_authorities(id),
  revision integer not null check (revision > 0),
  status text not null
    check (status in ('draft', 'applying', 'approved', 'rejected', 'expired', 'revoked')),
  application_reference text,
  approval_reference text,
  points numeric(6,2) check (points is null or points > 0),
  valid_from timestamptz,
  valid_until timestamptz,
  effective_at timestamptz not null,
  retroactive boolean not null default false,
  retroactive_basis text,
  source_document_path text not null,
  source_document_sha256 text not null check (source_document_sha256 ~ '^[a-f0-9]{64}$'),
  review_snapshot jsonb not null,
  created_by uuid not null references public.people(id),
  reviewed_by uuid references public.people(id),
  created_at timestamptz not null default now(),
  unique (course_id, revision),
  check (reviewed_by is null or reviewed_by <> created_by),
  check (valid_until is null or valid_from is null or valid_until > valid_from),
  check (not retroactive or retroactive_basis is not null)
);

create table public.course_version_accreditation (
  course_version_id uuid not null references public.course_versions(id),
  accreditation_revision_id uuid not null references public.accreditation_decision_revisions(id),
  disclosure_snapshot text not null,
  terms_reconfirmed_at timestamptz,
  primary key (course_version_id, accreditation_revision_id)
);

create table public.course_publication_reviews (
  id uuid primary key default gen_random_uuid(),
  course_version_id uuid not null references public.course_versions(id),
  submitted_by uuid not null references public.people(id),
  reviewed_by uuid references public.people(id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  checklist jsonb not null,
  reason text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check (reviewed_by is null or reviewed_by <> submitted_by)
);

create or replace function internal.reject_published_course_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status in ('published', 'suspended', 'archived') then
    if new.course_id <> old.course_id
       or new.version <> old.version
       or new.price_twd is distinct from old.price_twd
       or new.organization_point_price is distinct from old.organization_point_price
       or new.recorded_refund_allocation_twd <> old.recorded_refund_allocation_twd
       or new.live_refund_allocations <> old.live_refund_allocations
       or new.legal_document_id is distinct from old.legal_document_id
    then
      raise exception 'PUBLISHED_VERSION_IMMUTABLE';
    end if;
  end if;
  return new;
end
$$;

create trigger immutable_published_course_version
before update on public.course_versions
for each row execute function internal.reject_published_course_mutation();
