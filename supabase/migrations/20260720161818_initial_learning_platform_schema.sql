create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from anon, authenticated;

create type public.course_delivery as enum ('recorded', 'live', 'hybrid');
create type public.course_status as enum ('draft', 'review', 'published', 'archived');
create type public.enrollment_status as enum ('active', 'completed', 'expired', 'refunded');
create type public.order_status as enum ('pending', 'paid', 'failed', 'refunded', 'partially_refunded');
create type public.member_role as enum ('member', 'manager', 'owner');

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'platform_role') = 'admin', false)
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  phone text,
  locale text not null default 'zh-TW',
  timezone text not null default 'Asia/Taipei',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.learner_identifiers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_national_id bytea not null,
  national_id_fingerprint text not null unique,
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on table private.learner_identifiers from anon, authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tax_id text,
  seat_limit integer not null default 1 check (seat_limit > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'member',
  employee_code text,
  joined_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create or replace function private.is_org_admin(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin() or exists (
    select 1 from public.organization_members om
    where om.organization_id = target_organization_id
      and om.user_id = auth.uid()
      and om.role in ('manager', 'owner')
  )
$$;

create or replace function private.shares_organization(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members viewer
    join public.organization_members target using (organization_id)
    where viewer.user_id = auth.uid()
      and viewer.role in ('manager', 'owner')
      and target.user_id = target_user_id
  )
$$;

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  subtitle text,
  description text,
  delivery public.course_delivery not null default 'recorded',
  status public.course_status not null default 'draft',
  price_twd integer not null default 0 check (price_twd >= 0),
  subscription_eligible boolean not null default false,
  accredited boolean not null default false,
  accreditation_number text,
  accreditation_points numeric(5,2) not null default 0 check (accreditation_points >= 0),
  pass_score smallint not null default 80 check (pass_score = 80),
  enforce_single_playback boolean not null default true,
  created_by uuid references auth.users(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.course_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  position integer not null check (position >= 0),
  unique (course_id, position)
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.course_modules(id) on delete cascade,
  title text not null,
  position integer not null check (position >= 0),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  stream_uid text,
  is_preview boolean not null default false,
  playback_speed_locked boolean not null default false,
  seeking_disabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (module_id, position)
);

create table public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  zoom_meeting_id text,
  host_user_id uuid references auth.users(id),
  camera_required_percent numeric(5,2) check (camera_required_percent between 0 and 100),
  camera_required_minutes integer check (camera_required_minutes >= 0),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (camera_required_percent is null or camera_required_minutes is null)
);

create or replace function private.validate_accredited_course_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published' and new.accredited and new.delivery in ('live', 'hybrid') then
    if not exists (
      select 1 from public.live_sessions ls
      where ls.course_id = new.id
        and (ls.camera_required_percent is not null or ls.camera_required_minutes is not null)
    ) then
      raise exception 'Accredited live courses require a camera attendance threshold before publication';
    end if;
  end if;
  return new;
end;
$$;
create trigger validate_accredited_course_publication
before insert or update of status on public.courses
for each row execute function private.validate_accredited_course_publication();

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  organization_id uuid references public.organizations(id),
  status public.enrollment_status not null default 'active',
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  final_result text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (learner_id, course_id, organization_id)
);

create table public.course_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  learner_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid not null references auth.users(id),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, course_id, learner_id)
);

create table public.learning_events (
  id bigint generated always as identity primary key,
  learner_id uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid references public.enrollments(id) on delete set null,
  lesson_ref text not null,
  event_type text not null check (event_type in ('play', 'pause', 'seek_blocked', 'heartbeat', 'presence_requested', 'presence_confirmed', 'presence_expired', 'ended')),
  position_seconds integer not null default 0 check (position_seconds >= 0),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now()
);
create index learning_events_learner_time_idx on public.learning_events (learner_id, occurred_at desc);
create index learning_events_enrollment_idx on public.learning_events (enrollment_id, occurred_at);

create table public.playback_sessions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  learner_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  device_fingerprint text,
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  ended_at timestamptz,
  active boolean not null default true
);
create unique index one_active_playback_per_learner on public.playback_sessions (learner_id) where active;

create table public.playback_segments (
  id uuid primary key default gen_random_uuid(),
  playback_session_id uuid not null references public.playback_sessions(id) on delete cascade,
  segment_number integer not null check (segment_number >= 1),
  started_at timestamptz not null,
  ended_at timestamptz,
  active_seconds integer not null default 0 check (active_seconds between 0 and 900),
  presence_confirmed_at timestamptz,
  counts_toward_completion boolean not null default false,
  unique (playback_session_id, segment_number),
  check (counts_toward_completion = false or presence_confirmed_at is not null)
);

create table public.live_attendance_events (
  id bigint generated always as identity primary key,
  live_session_id uuid not null references public.live_sessions(id) on delete cascade,
  learner_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('joined', 'left', 'camera_on', 'camera_off', 'heartbeat')),
  source text not null default 'zoom_webhook',
  source_event_id text unique,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);
create index live_attendance_session_learner_idx on public.live_attendance_events (live_session_id, learner_id, occurred_at);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  learner_id uuid not null references auth.users(id) on delete cascade,
  score smallint check (score between 0 and 100),
  passed boolean generated always as (score >= 80) stored,
  answers jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  submitted_at timestamptz
);

create table public.satisfaction_responses (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null unique references public.enrollments(id) on delete cascade,
  learner_id uuid not null references auth.users(id) on delete cascade,
  ratings jsonb not null,
  feedback text,
  submitted_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id),
  organization_id uuid references public.organizations(id),
  merchant_trade_no text unique,
  status public.order_status not null default 'pending',
  amount_twd integer not null check (amount_twd >= 0),
  payment_provider text not null default 'ecpay',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  course_id uuid references public.courses(id),
  item_type text not null check (item_type in ('course', 'seat_pack', 'subscription')),
  quantity integer not null default 1 check (quantity > 0),
  unit_price_twd integer not null check (unit_price_twd >= 0)
);

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  source_order_id uuid references public.orders(id),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  check (user_id is not null or organization_id is not null)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  status text not null check (status in ('active', 'expired', 'cancelled')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  auto_renew boolean not null default false check (auto_renew = false),
  created_at timestamptz not null default now(),
  check (user_id is not null or organization_id is not null),
  check (ends_at > starts_at)
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  requested_by uuid not null references auth.users(id),
  amount_twd integer not null check (amount_twd > 0),
  reason text not null,
  status text not null default 'manual_review' check (status in ('manual_review', 'approved', 'rejected', 'paid')),
  automatic boolean not null default false check (automatic = false),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null unique references public.enrollments(id) on delete cascade,
  learner_id uuid not null references auth.users(id) on delete cascade,
  verification_code text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_reason text
);

create table public.accreditation_exports (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  live_session_id uuid references public.live_sessions(id),
  created_by uuid not null references auth.users(id),
  learner_count integer not null check (learner_count >= 0),
  file_path text not null,
  checksum text not null,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  organization_id uuid references public.organizations(id),
  action text not null,
  target_type text not null,
  target_id text not null,
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamptz not null default now()
);

create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (key, value) values
  ('auto_renewal_enabled', 'false'::jsonb),
  ('automatic_refunds_enabled', 'false'::jsonb),
  ('global_pass_score', '80'::jsonb);

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger profiles_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger organizations_updated_at before update on public.organizations for each row execute function private.set_updated_at();
create trigger courses_updated_at before update on public.courses for each row execute function private.set_updated_at();
create trigger enrollments_updated_at before update on public.enrollments for each row execute function private.set_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.raw_user_meta_data ->> 'avatar_url');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.courses enable row level security;
alter table public.course_modules enable row level security;
alter table public.lessons enable row level security;
alter table public.live_sessions enable row level security;
alter table public.enrollments enable row level security;
alter table public.course_assignments enable row level security;
alter table public.learning_events enable row level security;
alter table public.playback_sessions enable row level security;
alter table public.playback_segments enable row level security;
alter table public.live_attendance_events enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.satisfaction_responses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.entitlements enable row level security;
alter table public.subscriptions enable row level security;
alter table public.refunds enable row level security;
alter table public.certificates enable row level security;
alter table public.accreditation_exports enable row level security;
alter table public.audit_events enable row level security;
alter table public.platform_settings enable row level security;

create policy "profiles own or organization admins select" on public.profiles for select to authenticated
using (id = auth.uid() or private.shares_organization(id) or private.is_platform_admin());
create policy "profiles own update" on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy "organization members select organization" on public.organizations for select to authenticated
using (private.is_org_admin(id) or exists (select 1 from public.organization_members om where om.organization_id = id and om.user_id = auth.uid()));
create policy "organization admins update organization" on public.organizations for update to authenticated
using (private.is_org_admin(id)) with check (private.is_org_admin(id));
create policy "platform admins create organizations" on public.organizations for insert to authenticated
with check (private.is_platform_admin());

create policy "members select own organization roster" on public.organization_members for select to authenticated
using (user_id = auth.uid() or private.is_org_admin(organization_id));
create policy "organization admins insert members" on public.organization_members for insert to authenticated
with check (private.is_org_admin(organization_id));
create policy "organization admins update members" on public.organization_members for update to authenticated
using (private.is_org_admin(organization_id)) with check (private.is_org_admin(organization_id));
create policy "organization admins delete members" on public.organization_members for delete to authenticated
using (private.is_org_admin(organization_id));

create policy "published courses are public" on public.courses for select to anon, authenticated
using (status = 'published' or private.is_platform_admin());
create policy "platform admins insert courses" on public.courses for insert to authenticated with check (private.is_platform_admin());
create policy "platform admins update courses" on public.courses for update to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "platform admins delete draft courses" on public.courses for delete to authenticated using (private.is_platform_admin() and status = 'draft');

create policy "published modules are public" on public.course_modules for select to anon, authenticated
using (exists (select 1 from public.courses c where c.id = course_id and (c.status = 'published' or private.is_platform_admin())));
create policy "platform admins manage modules" on public.course_modules for all to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());

create policy "preview or entitled lessons select" on public.lessons for select to anon, authenticated
using (is_preview or private.is_platform_admin() or exists (
  select 1
  from public.course_modules m
  join public.enrollments e on e.course_id = m.course_id
  where m.id = module_id and e.learner_id = auth.uid() and e.status = 'active'
));
create policy "platform admins manage lessons" on public.lessons for all to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());

create policy "published live sessions select" on public.live_sessions for select to authenticated
using (private.is_platform_admin() or exists (
  select 1 from public.enrollments e where e.course_id = course_id and e.learner_id = auth.uid() and e.status = 'active'
));
create policy "platform admins manage live sessions" on public.live_sessions for all to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());

create policy "learners and org admins select enrollments" on public.enrollments for select to authenticated
using (learner_id = auth.uid() or (organization_id is not null and private.is_org_admin(organization_id)) or private.is_platform_admin());
create policy "platform admins insert enrollments" on public.enrollments for insert to authenticated with check (private.is_platform_admin());
create policy "platform admins update enrollments" on public.enrollments for update to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());

create policy "learners and org admins select assignments" on public.course_assignments for select to authenticated
using (learner_id = auth.uid() or private.is_org_admin(organization_id));
create policy "org admins insert assignments" on public.course_assignments for insert to authenticated
with check (private.is_org_admin(organization_id) and assigned_by = auth.uid());
create policy "org admins delete assignments" on public.course_assignments for delete to authenticated using (private.is_org_admin(organization_id));

create policy "learners select own immutable events" on public.learning_events for select to authenticated
using (learner_id = auth.uid() or private.is_platform_admin());
create policy "learners append own immutable events" on public.learning_events for insert to authenticated
with check (learner_id = auth.uid());

create policy "learners select playback sessions" on public.playback_sessions for select to authenticated
using (learner_id = auth.uid() or private.is_platform_admin());
create policy "learners insert playback sessions" on public.playback_sessions for insert to authenticated with check (learner_id = auth.uid());
create policy "learners update playback sessions" on public.playback_sessions for update to authenticated using (learner_id = auth.uid()) with check (learner_id = auth.uid());
create policy "learners select playback segments" on public.playback_segments for select to authenticated
using (exists (select 1 from public.playback_sessions ps where ps.id = playback_session_id and (ps.learner_id = auth.uid() or private.is_platform_admin())));
create policy "learners insert playback segments" on public.playback_segments for insert to authenticated
with check (exists (select 1 from public.playback_sessions ps where ps.id = playback_session_id and ps.learner_id = auth.uid()));

create policy "learners and admins select live attendance" on public.live_attendance_events for select to authenticated
using (learner_id = auth.uid() or private.is_platform_admin());

create policy "learners select own quiz attempts" on public.quiz_attempts for select to authenticated using (learner_id = auth.uid() or private.is_platform_admin());
create policy "learners insert quiz attempts" on public.quiz_attempts for insert to authenticated with check (learner_id = auth.uid());
create policy "learners update unsubmitted quiz attempts" on public.quiz_attempts for update to authenticated
using (learner_id = auth.uid() and submitted_at is null) with check (learner_id = auth.uid());

create policy "learners select satisfaction responses" on public.satisfaction_responses for select to authenticated using (learner_id = auth.uid() or private.is_platform_admin());
create policy "learners insert satisfaction responses" on public.satisfaction_responses for insert to authenticated with check (learner_id = auth.uid());

create policy "buyers and org admins select orders" on public.orders for select to authenticated
using (buyer_id = auth.uid() or (organization_id is not null and private.is_org_admin(organization_id)) or private.is_platform_admin());
create policy "authenticated buyers create pending orders" on public.orders for insert to authenticated
with check (buyer_id = auth.uid() and status = 'pending');

create policy "buyers select order items" on public.order_items for select to authenticated
using (exists (select 1 from public.orders o where o.id = order_id and (o.buyer_id = auth.uid() or private.is_org_admin(o.organization_id) or private.is_platform_admin())));

create policy "owners select entitlements" on public.entitlements for select to authenticated
using (user_id = auth.uid() or (organization_id is not null and private.is_org_admin(organization_id)) or private.is_platform_admin());
create policy "owners select subscriptions" on public.subscriptions for select to authenticated
using (user_id = auth.uid() or (organization_id is not null and private.is_org_admin(organization_id)) or private.is_platform_admin());

create policy "requesters select refunds" on public.refunds for select to authenticated
using (requested_by = auth.uid() or private.is_platform_admin());
create policy "buyers request manual refunds" on public.refunds for insert to authenticated
with check (requested_by = auth.uid() and status = 'manual_review' and automatic = false and exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = auth.uid()));

create policy "learners select certificates" on public.certificates for select to authenticated using (learner_id = auth.uid() or private.is_platform_admin());
create policy "platform admins manage certificates" on public.certificates for all to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "platform admins select exports" on public.accreditation_exports for select to authenticated using (private.is_platform_admin());
create policy "platform admins insert exports" on public.accreditation_exports for insert to authenticated with check (private.is_platform_admin() and created_by = auth.uid());
create policy "platform admins select audit" on public.audit_events for select to authenticated using (private.is_platform_admin());
create policy "platform admins append audit" on public.audit_events for insert to authenticated with check (private.is_platform_admin());
create policy "platform admins read settings" on public.platform_settings for select to authenticated using (private.is_platform_admin());
create policy "platform admins update settings" on public.platform_settings for update to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
