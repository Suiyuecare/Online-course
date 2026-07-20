-- 歲悅學苑第四階段：企業申請、企業購課、名額帳本、課程指派、電子發票與跨機構隔離。
-- 所有會改變權限、付款、名額或邀請狀態的 RPC 僅開放 service_role；瀏覽器端只讀經 RLS 篩選的資料。

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- 機構申請、聯絡與成員資料
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column if not exists status text not null default 'submitted',
  add column if not exists contact_name text not null default '',
  add column if not exists contact_phone text,
  add column if not exists invoice_title text,
  add column if not exists invoice_email text,
  add column if not exists submitted_at timestamptz not null default now(),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists review_note text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists rejection_reason text,
  add constraint organizations_status_check
    check (status in ('submitted', 'approved', 'rejected', 'suspended')),
  add constraint organizations_tax_id_format_check
    check (tax_id is null or tax_id ~ '^[0-9]{8}$'),
  add constraint organizations_invoice_email_check
    check (invoice_email is null or invoice_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');

-- 第四階段上線前已存在的機構視為舊流程已審核，避免 migration
-- 將現行企業客戶誤降為待審核；之後的新申請仍由 RPC 建為 submitted。
update public.organizations
set status = 'approved',
    submitted_at = coalesce(submitted_at, created_at),
    reviewed_at = coalesce(reviewed_at, created_at),
    approved_at = coalesce(approved_at, created_at)
where status = 'submitted' and active;

update public.organizations
set status = 'suspended',
    submitted_at = coalesce(submitted_at, created_at),
    reviewed_at = coalesce(reviewed_at, created_at)
where status = 'submitted' and not active;

create unique index organizations_tax_id_unique
  on public.organizations (tax_id)
  where tax_id is not null;
create index organizations_reviewed_by_idx
  on public.organizations (reviewed_by)
  where reviewed_by is not null;
create index organizations_approved_by_idx
  on public.organizations (approved_by)
  where approved_by is not null;

alter table public.organization_members
  add column if not exists department text;

-- RLS 角色判斷必須以 auth.users 的即時 app_metadata 為準，不能信任可能尚未
-- 刷新的 JWT；機構管理權也只在機構已核准且仍啟用時成立。
create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.raw_app_meta_data ->> 'platform_role' = 'admin'
  )
$$;

create or replace function private.is_platform_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.raw_app_meta_data ->> 'platform_role' in ('admin', 'support')
  )
$$;

create or replace function private.is_active_org_manager(
  target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin() or exists (
    select 1
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
    where om.organization_id = target_organization_id
      and om.user_id = auth.uid()
      and om.role in ('manager', 'owner')
      and o.status = 'approved'
      and o.active
  )
$$;

-- 保留舊 policy 所使用的函數名稱，但收緊為相同的即時、有效機構判斷。
create or replace function private.is_org_admin(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_org_manager(target_organization_id)
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
    join public.organizations o on o.id = viewer.organization_id
    where viewer.user_id = auth.uid()
      and viewer.role in ('manager', 'owner')
      and target.user_id = target_user_id
      and o.status = 'approved'
      and o.active
  )
$$;

revoke all on function private.is_platform_admin() from public, anon, authenticated;
revoke all on function private.is_platform_staff() from public, anon, authenticated;
revoke all on function private.is_active_org_manager(uuid) from public, anon, authenticated;
revoke all on function private.is_org_admin(uuid) from public, anon, authenticated;
revoke all on function private.shares_organization(uuid) from public, anon, authenticated;
-- anon 的既有公開課程 policy 會呼叫 is_platform_admin()；private schema 本身仍未暴露。
grant execute on function private.is_platform_admin() to anon, authenticated, service_role;
grant execute on function private.is_platform_staff() to authenticated, service_role;
grant execute on function private.is_active_org_manager(uuid) to authenticated, service_role;
grant execute on function private.is_org_admin(uuid) to authenticated, service_role;
grant execute on function private.shares_organization(uuid) to authenticated, service_role;

create or replace function private.is_org_owner(
  target_organization_id uuid,
  target_actor_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = coalesce(target_actor_id, auth.uid())
      and u.raw_app_meta_data ->> 'platform_role' = 'admin'
  ) or exists (
    select 1
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
    where om.organization_id = target_organization_id
      and om.user_id = coalesce(target_actor_id, auth.uid())
      and om.role = 'owner'
      and o.status = 'approved'
      and o.active
  )
$$;

create or replace function private.is_org_manager(
  target_organization_id uuid,
  target_actor_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = coalesce(target_actor_id, auth.uid())
      and u.raw_app_meta_data ->> 'platform_role' = 'admin'
  ) or exists (
    select 1
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
    where om.organization_id = target_organization_id
      and om.user_id = coalesce(target_actor_id, auth.uid())
      and om.role in ('manager', 'owner')
      and o.status = 'approved'
      and o.active
  )
$$;

revoke all on function private.is_org_owner(uuid, uuid) from public, anon, authenticated;
revoke all on function private.is_org_manager(uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_org_owner(uuid, uuid) to service_role;
grant execute on function private.is_org_manager(uuid, uuid) to service_role;

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  email_normalized text generated always as (lower(btrim(email))) stored,
  invitee_name text,
  full_name text generated always as (invitee_name) stored,
  employee_code text,
  department text,
  role public.member_role not null default 'member',
  token_hash text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  invited_by uuid not null references auth.users(id),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (role in ('member', 'manager')),
  check (token_hash ~ '^[0-9a-f]{64}$'),
  check (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  check (expires_at > created_at)
);
create unique index organization_invitations_one_pending_email
  on public.organization_invitations (organization_id, email_normalized)
  where status = 'pending';
create index organization_invitations_expiry_idx
  on public.organization_invitations (status, expires_at);
create index organization_invitations_invited_by_idx
  on public.organization_invitations (invited_by);
create index organization_invitations_accepted_by_idx
  on public.organization_invitations (accepted_by)
  where accepted_by is not null;
create trigger organization_invitations_updated_at
before update on public.organization_invitations
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 企業級距價格與訂單／發票快照
-- ---------------------------------------------------------------------------

create table public.course_price_tiers (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  min_quantity integer not null check (min_quantity > 0),
  max_quantity integer check (max_quantity is null or max_quantity >= min_quantity),
  unit_price_twd integer not null check (unit_price_twd >= 0),
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > effective_at),
  unique (course_id, min_quantity, effective_at)
);
alter table public.course_price_tiers
  add constraint course_price_tiers_no_active_overlap
  exclude using gist (
    course_id with =,
    int4range(min_quantity, max_quantity, '[]') with &&,
    tstzrange(effective_at, expires_at, '[)') with &&
  ) where (active);
create index course_price_tiers_lookup_idx
  on public.course_price_tiers (course_id, active, effective_at, expires_at, min_quantity desc);
create trigger course_price_tiers_updated_at
before update on public.course_price_tiers
for each row execute function private.set_updated_at();

alter table public.orders
  add column if not exists order_kind text not null default 'individual_course',
  add column if not exists invoice_title text,
  add column if not exists invoice_tax_id text,
  add column if not exists invoice_email text,
  add column if not exists pricing_tier_id uuid references public.course_price_tiers(id),
  add constraint orders_order_kind_check
    check (order_kind in ('individual_course', 'enterprise_seat_pack')),
  add constraint orders_invoice_tax_id_format_check
    check (invoice_tax_id is null or invoice_tax_id ~ '^[0-9]{8}$'),
  add constraint orders_invoice_email_format_check
    check (invoice_email is null or invoice_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');

alter table public.order_items
  add column if not exists pricing_tier_id uuid references public.course_price_tiers(id),
  add column if not exists tier_min_quantity_snapshot integer,
  add column if not exists tier_max_quantity_snapshot integer,
  add column if not exists tier_effective_from_snapshot timestamptz,
  add column if not exists tier_effective_until_snapshot timestamptz,
  add column if not exists seat_valid_days_snapshot integer not null default 365
    check (seat_valid_days_snapshot between 1 and 3650),
  add column if not exists line_total_twd integer generated always as (quantity * unit_price_twd) stored;

create index enterprise_orders_organization_idx
  on public.orders (organization_id, created_at desc)
  where organization_id is not null;
create index enterprise_orders_pricing_tier_idx
  on public.orders (pricing_tier_id)
  where pricing_tier_id is not null;
create index enterprise_order_items_pricing_tier_idx
  on public.order_items (pricing_tier_id)
  where pricing_tier_id is not null;
create unique index enterprise_orders_provider_trade_no_unique
  on public.orders (provider_trade_no)
  where provider_trade_no is not null;

create or replace function private.populate_enterprise_order_item_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  order_row public.orders%rowtype;
  tier_row public.course_price_tiers%rowtype;
begin
  if new.item_type <> 'seat_pack' then return new; end if;
  select * into order_row from public.orders where id = new.order_id;
  if order_row.order_kind <> 'enterprise_seat_pack' or order_row.pricing_tier_id is null then
    raise exception 'ENTERPRISE_ORDER_PRICING_TIER_REQUIRED';
  end if;
  select * into tier_row from public.course_price_tiers where id = order_row.pricing_tier_id;
  if tier_row.id is null or tier_row.course_id <> new.course_id
    or not tier_row.active or tier_row.effective_at > now()
    or (tier_row.expires_at is not null and tier_row.expires_at <= now())
    or new.quantity < tier_row.min_quantity
    or (tier_row.max_quantity is not null and new.quantity > tier_row.max_quantity)
    or new.unit_price_twd <> tier_row.unit_price_twd then
    raise exception 'ENTERPRISE_PRICE_TIER_INVALID';
  end if;
  new.pricing_tier_id := tier_row.id;
  new.tier_min_quantity_snapshot := tier_row.min_quantity;
  new.tier_max_quantity_snapshot := tier_row.max_quantity;
  new.tier_effective_from_snapshot := tier_row.effective_at;
  new.tier_effective_until_snapshot := tier_row.expires_at;
  return new;
end;
$$;
create trigger populate_enterprise_order_item_snapshot
before insert or update of quantity, unit_price_twd, pricing_tier_id on public.order_items
for each row execute function private.populate_enterprise_order_item_snapshot();

-- ---------------------------------------------------------------------------
-- 企業名額批次、指派與 append-only 名額帳本
-- ---------------------------------------------------------------------------

create table public.enterprise_seat_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  course_id uuid not null references public.courses(id),
  source_order_id uuid not null references public.orders(id),
  order_item_id uuid not null unique references public.order_items(id),
  pricing_tier_id uuid references public.course_price_tiers(id),
  purchased_quantity integer not null check (purchased_quantity > 0),
  total_quantity integer not null check (total_quantity >= 0),
  available_quantity integer not null default 0 check (available_quantity >= 0),
  unit_price_twd integer not null check (unit_price_twd >= 0),
  purchased_at timestamptz not null default now(),
  valid_until timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'expired', 'refunded', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (total_quantity <= purchased_quantity),
  check (available_quantity <= total_quantity),
  check (valid_until > purchased_at)
);
create index enterprise_seat_lots_org_course_idx
  on public.enterprise_seat_lots (organization_id, course_id, status, valid_until);
create index enterprise_seat_lots_course_idx
  on public.enterprise_seat_lots (course_id, status, valid_until);
create index enterprise_seat_lots_source_order_idx
  on public.enterprise_seat_lots (source_order_id);
create index enterprise_seat_lots_pricing_tier_idx
  on public.enterprise_seat_lots (pricing_tier_id)
  where pricing_tier_id is not null;
create index enterprise_seat_lots_expiry_idx
  on public.enterprise_seat_lots (status, valid_until)
  where status = 'active';
create trigger enterprise_seat_lots_updated_at
before update on public.enterprise_seat_lots
for each row execute function private.set_updated_at();

create table public.enterprise_seat_allocations (
  id uuid primary key default gen_random_uuid(),
  seat_lot_id uuid not null references public.enterprise_seat_lots(id),
  organization_id uuid not null references public.organizations(id),
  course_id uuid not null references public.courses(id),
  learner_id uuid not null references auth.users(id) on delete cascade,
  live_session_id uuid references public.live_sessions(id),
  booking_id uuid references public.live_session_bookings(id),
  enrollment_id uuid references public.enrollments(id),
  entitlement_id uuid references public.entitlements(id),
  status text not null default 'assigned'
    check (status in ('assigned', 'consumed', 'released', 'expired', 'refunded')),
  due_at timestamptz,
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index enterprise_one_active_unselected_or_recorded_allocation
  on public.enterprise_seat_allocations (organization_id, course_id, learner_id)
  where status in ('assigned', 'consumed') and live_session_id is null;
create unique index enterprise_one_active_live_session_allocation
  on public.enterprise_seat_allocations (organization_id, live_session_id, learner_id)
  where status in ('assigned', 'consumed') and live_session_id is not null;
create index enterprise_allocations_member_idx
  on public.enterprise_seat_allocations (organization_id, learner_id, status, due_at);
create index enterprise_allocations_learner_idx
  on public.enterprise_seat_allocations (learner_id, status, due_at);
create index enterprise_allocations_lot_idx
  on public.enterprise_seat_allocations (seat_lot_id, status);
create index enterprise_allocations_course_idx
  on public.enterprise_seat_allocations (course_id, status);
create unique index enterprise_allocations_booking_idx
  on public.enterprise_seat_allocations (booking_id)
  where booking_id is not null;
create index enterprise_allocations_enrollment_idx
  on public.enterprise_seat_allocations (enrollment_id)
  where enrollment_id is not null;
create index enterprise_allocations_entitlement_idx
  on public.enterprise_seat_allocations (entitlement_id)
  where entitlement_id is not null;
create index enterprise_allocations_live_session_idx
  on public.enterprise_seat_allocations (live_session_id, status)
  where live_session_id is not null;
create index enterprise_playback_sessions_enrollment_idx
  on public.playback_sessions (enrollment_id, id);
create index enterprise_live_attendance_booking_event_idx
  on public.live_attendance_events (booking_id, event_type, occurred_at)
  where booking_id is not null;
create trigger enterprise_seat_allocations_updated_at
before update on public.enterprise_seat_allocations
for each row execute function private.set_updated_at();

-- 企業直播簽到與改場／釋出／到期共用 lot → allocation → booking 鎖序。
-- 這是 DB 端最後一道防線，避免 API 先查 booking 後才 insert 的 TOCTOU。
create or replace function private.validate_enterprise_live_check_in()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  inferred_lot_id uuid;
  booking_order_kind text;
  booking_enrollment_id uuid;
  lot_row public.enterprise_seat_lots%rowtype;
  allocation_row public.enterprise_seat_allocations%rowtype;
  booking_row public.live_session_bookings%rowtype;
begin
  if new.event_type <> 'check_in' then return new; end if;
  if new.booking_id is null then raise exception 'LIVE_CHECK_IN_BOOKING_REQUIRED'; end if;

  select b.enrollment_id, o.order_kind
  into booking_enrollment_id, booking_order_kind
  from public.live_session_bookings b
  left join public.orders o on o.id = b.source_order_id
  where b.id = new.booking_id;

  select a.seat_lot_id into inferred_lot_id
  from public.enterprise_seat_allocations a
  where a.booking_id = new.booking_id
  limit 1;
  if inferred_lot_id is null and booking_order_kind = 'enterprise_seat_pack' then
    select l.id into inferred_lot_id
    from public.live_session_bookings b
    join public.enterprise_seat_lots l on l.source_order_id = b.source_order_id
    where b.id = new.booking_id
    order by l.id
    limit 1;
  end if;
  if inferred_lot_id is null then return new; end if;

  select * into lot_row
  from public.enterprise_seat_lots
  where id = inferred_lot_id
  for update;
  select * into allocation_row
  from public.enterprise_seat_allocations a
  where a.seat_lot_id = inferred_lot_id
    and a.learner_id = new.learner_id
    and (
      a.booking_id = new.booking_id
      or (booking_enrollment_id is not null and a.enrollment_id = booking_enrollment_id)
    )
  order by (a.booking_id = new.booking_id) desc, a.created_at desc, a.id
  limit 1
  for update;
  select * into booking_row
  from public.live_session_bookings
  where id = new.booking_id
  for update;

  if booking_row.id is null or allocation_row.id is null
    or booking_order_kind is distinct from 'enterprise_seat_pack'
    or booking_row.status <> 'confirmed'
    or allocation_row.status not in ('assigned', 'consumed')
    or allocation_row.booking_id is distinct from booking_row.id
    or allocation_row.live_session_id is distinct from booking_row.live_session_id
    or allocation_row.live_session_id is distinct from new.live_session_id
    or allocation_row.learner_id is distinct from booking_row.learner_id
    or allocation_row.learner_id is distinct from new.learner_id then
    raise exception 'ENTERPRISE_LIVE_CHECK_IN_STALE_BOOKING';
  end if;
  if allocation_row.status = 'assigned'
    and (
      lot_row.status <> 'active'
      or lot_row.valid_until <= statement_timestamp()
    ) then raise exception 'ENTERPRISE_SEAT_LOT_EXPIRED'; end if;
  return new;
end;
$$;

drop trigger if exists validate_enterprise_live_check_in on public.live_attendance_events;
create trigger validate_enterprise_live_check_in
before insert on public.live_attendance_events
for each row execute function private.validate_enterprise_live_check_in();

-- 防止播放 API 在釋出前先讀到 entitlement，卻在釋出交易後才新增 session。
create or replace function private.validate_enterprise_playback_start()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  inferred_lot_id uuid;
  lot_row public.enterprise_seat_lots%rowtype;
  allocation_row public.enterprise_seat_allocations%rowtype;
begin
  select a.seat_lot_id into inferred_lot_id
  from public.enterprise_seat_allocations a
  where a.enrollment_id = new.enrollment_id
  order by (a.status in ('assigned', 'consumed')) desc, a.created_at desc, a.id
  limit 1;
  if inferred_lot_id is null then return new; end if;

  select * into lot_row
  from public.enterprise_seat_lots
  where id = inferred_lot_id
  for update;
  select * into allocation_row
  from public.enterprise_seat_allocations a
  where a.enrollment_id = new.enrollment_id
    and a.seat_lot_id = inferred_lot_id
  order by (a.status in ('assigned', 'consumed')) desc, a.created_at desc, a.id
  limit 1
  for update;
  if allocation_row.id is null
    or allocation_row.status not in ('assigned', 'consumed')
    or allocation_row.learner_id is distinct from new.learner_id then
    raise exception 'ENTERPRISE_PLAYBACK_ALLOCATION_INACTIVE';
  end if;
  if allocation_row.status = 'assigned'
    and (
      lot_row.status <> 'active'
      or lot_row.valid_until <= statement_timestamp()
    ) then raise exception 'ENTERPRISE_SEAT_LOT_EXPIRED'; end if;
  return new;
end;
$$;

drop trigger if exists validate_enterprise_playback_start on public.playback_sessions;
create trigger validate_enterprise_playback_start
before insert on public.playback_sessions
for each row execute function private.validate_enterprise_playback_start();

create or replace function private.validate_enterprise_live_session_reschedule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.starts_at is not distinct from old.starts_at then return new; end if;
  if exists (
    select 1
    from public.enterprise_seat_allocations a
    join public.enterprise_seat_lots l on l.id = a.seat_lot_id
    where a.live_session_id = old.id
      and a.status in ('assigned', 'consumed')
      and l.valid_until < new.starts_at
  ) then raise exception 'ENTERPRISE_LIVE_SESSION_EXCEEDS_SEAT_VALIDITY'; end if;
  return new;
end;
$$;

drop trigger if exists validate_enterprise_live_session_reschedule on public.live_sessions;
create trigger validate_enterprise_live_session_reschedule
before update of starts_at on public.live_sessions
for each row execute function private.validate_enterprise_live_session_reschedule();

create table public.enterprise_seat_events (
  id bigint generated always as identity primary key,
  seat_lot_id uuid not null references public.enterprise_seat_lots(id),
  organization_id uuid not null references public.organizations(id),
  allocation_id uuid references public.enterprise_seat_allocations(id),
  event_type text not null
    check (event_type in (
      'available', 'assigned', 'consumed', 'released', 'expired', 'refunded', 'correction'
    )),
  quantity integer not null check (quantity > 0),
  available_delta integer not null,
  idempotency_key text not null unique,
  actor_id uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (
    (event_type in ('available', 'released') and available_delta = quantity)
    or (event_type in ('assigned', 'refunded') and available_delta = -quantity)
    or (event_type = 'expired' and available_delta between -quantity and 0)
    or (event_type = 'consumed' and available_delta = 0)
    or (event_type = 'correction' and abs(available_delta::bigint) = quantity::bigint)
  )
);
create index enterprise_seat_events_lot_time_idx
  on public.enterprise_seat_events (seat_lot_id, occurred_at, id);
create index enterprise_seat_events_allocation_idx
  on public.enterprise_seat_events (allocation_id, occurred_at)
  where allocation_id is not null;
create index enterprise_seat_events_organization_idx
  on public.enterprise_seat_events (organization_id, occurred_at desc);

create or replace function private.apply_enterprise_seat_event_balance()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  lot_row public.enterprise_seat_lots%rowtype;
  next_available integer;
  next_total integer;
begin
  select * into lot_row
  from public.enterprise_seat_lots
  where id = new.seat_lot_id
  for update;

  if lot_row.id is null then
    raise exception 'ENTERPRISE_SEAT_LOT_NOT_FOUND';
  end if;
  if new.organization_id <> lot_row.organization_id then
    raise exception 'ENTERPRISE_SEAT_EVENT_ORGANIZATION_MISMATCH';
  end if;

  next_available := lot_row.available_quantity + new.available_delta;
  next_total := lot_row.total_quantity
    - case when new.event_type = 'refunded' then new.quantity else 0 end;

  if next_total < 0 or next_available < 0 or next_available > next_total then
    raise exception 'ENTERPRISE_SEAT_BALANCE_INVALID';
  end if;

  update public.enterprise_seat_lots
  set available_quantity = next_available,
      total_quantity = next_total,
      updated_at = now()
  where id = new.seat_lot_id;

  return new;
end;
$$;
create trigger enterprise_seat_events_apply_balance
after insert on public.enterprise_seat_events
for each row execute function private.apply_enterprise_seat_event_balance();

create trigger enterprise_seat_events_append_only
before update or delete on public.enterprise_seat_events
for each row execute function private.prevent_append_only_mutation();
drop trigger if exists audit_events_append_only on public.audit_events;
create trigger audit_events_append_only
before update or delete on public.audit_events
for each row execute function private.prevent_append_only_mutation();
drop trigger if exists payment_events_append_only on public.payment_events;
alter table public.payment_events
  drop constraint if exists payment_events_event_type_check;
alter table public.payment_events
  add constraint payment_events_event_type_check
  check (event_type in (
    'callback_received', 'payment_confirmed', 'payment_rejected',
    'refund_recorded', 'fulfillment_exception'
  ));
create trigger payment_events_append_only
before update or delete on public.payment_events
for each row execute function private.prevent_append_only_mutation();

-- Enterprise active_seconds 不允許直接更新；必須經下方的原子 RPC。
create or replace function private.guard_enterprise_playback_seconds_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_enrollment_id uuid;
begin
  if new.active_seconds <= old.active_seconds then return new; end if;
  select ps.enrollment_id into target_enrollment_id
  from public.playback_sessions ps
  where ps.id = new.playback_session_id;
  if exists (
    select 1 from public.enterprise_seat_allocations a
    where a.enrollment_id = target_enrollment_id
  ) and coalesce(
    current_setting('app.enterprise_playback_segment_id', true), ''
  ) <> new.id::text then
    raise exception 'USE_ENTERPRISE_PLAYBACK_SECONDS_RPC';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_enterprise_playback_seconds_update on public.playback_segments;
create trigger guard_enterprise_playback_seconds_update
before update of active_seconds on public.playback_segments
for each row execute function private.guard_enterprise_playback_seconds_update();

create or replace function public.update_playback_segment_active_seconds(
  target_segment_id uuid,
  target_learner_id uuid,
  target_next_active_seconds integer
)
returns public.playback_segments
language plpgsql
security definer
set search_path = ''
as $$
declare
  segment_row public.playback_segments%rowtype;
  session_row public.playback_sessions%rowtype;
  allocation_row public.enterprise_seat_allocations%rowtype;
  lot_row public.enterprise_seat_lots%rowtype;
  inferred_lot_id uuid;
begin
  if target_next_active_seconds is null
    or target_next_active_seconds < 0
    or target_next_active_seconds > 900 then
    raise exception 'INVALID_PLAYBACK_ACTIVE_SECONDS';
  end if;

  select ps.* into session_row
  from public.playback_segments segment
  join public.playback_sessions ps on ps.id = segment.playback_session_id
  where segment.id = target_segment_id;
  if session_row.id is null or session_row.learner_id <> target_learner_id then
    raise exception 'PLAYBACK_SEGMENT_NOT_FOUND';
  end if;
  select a.seat_lot_id into inferred_lot_id
  from public.enterprise_seat_allocations a
  where a.enrollment_id = session_row.enrollment_id
  order by (a.status = 'assigned') desc, (a.status = 'consumed') desc,
    a.created_at desc, a.id
  limit 1;

  if inferred_lot_id is not null then
    select * into lot_row
    from public.enterprise_seat_lots
    where id = inferred_lot_id
    for update;
    select * into allocation_row
    from public.enterprise_seat_allocations a
    where a.enrollment_id = session_row.enrollment_id
      and a.seat_lot_id = inferred_lot_id
    order by (a.status = 'assigned') desc, (a.status = 'consumed') desc,
      a.created_at desc, a.id
    limit 1
    for update;
  end if;

  select * into session_row
  from public.playback_sessions
  where id = session_row.id
  for update;
  select * into segment_row
  from public.playback_segments
  where id = target_segment_id
  for update;
  if session_row.id is null or segment_row.id is null
    or segment_row.playback_session_id <> session_row.id
    or session_row.learner_id <> target_learner_id
    or not session_row.active
    or segment_row.ended_at is not null then
    raise exception 'PLAYBACK_SEGMENT_INACTIVE';
  end if;
  if target_next_active_seconds < segment_row.active_seconds
    or target_next_active_seconds - segment_row.active_seconds > 20 then
    raise exception 'INVALID_PLAYBACK_ACTIVE_SECONDS_TRANSITION';
  end if;
  if target_next_active_seconds = segment_row.active_seconds then return segment_row; end if;

  if inferred_lot_id is not null then
    if allocation_row.id is null
      or allocation_row.learner_id <> target_learner_id
      or allocation_row.enrollment_id is distinct from session_row.enrollment_id
      or allocation_row.status not in ('assigned', 'consumed') then
      raise exception 'ENTERPRISE_PLAYBACK_ALLOCATION_INACTIVE';
    end if;
    if allocation_row.status = 'assigned' then
      if lot_row.status <> 'active' or lot_row.valid_until <= statement_timestamp() then
        raise exception 'ENTERPRISE_SEAT_LOT_EXPIRED';
      end if;
      update public.enterprise_seat_allocations
      set status = 'consumed', consumed_at = statement_timestamp(), updated_at = now()
      where id = allocation_row.id
      returning * into allocation_row;
      insert into public.enterprise_seat_events (
        seat_lot_id, organization_id, allocation_id, event_type, quantity,
        available_delta, idempotency_key, actor_id, metadata
      ) values (
        allocation_row.seat_lot_id, allocation_row.organization_id,
        allocation_row.id, 'consumed', 1, 0,
        'enterprise-allocation:' || allocation_row.id::text || ':consumed',
        target_learner_id,
        jsonb_build_object('source', 'first_effective_playback', 'segment_id', target_segment_id)
      );
      insert into public.audit_events (
        actor_id, organization_id, action, target_type, target_id, after_data
      ) values (
        target_learner_id, allocation_row.organization_id,
        'enterprise.seat_consumed', 'enterprise_seat_allocation',
        allocation_row.id::text,
        jsonb_build_object(
          'course_id', allocation_row.course_id,
          'learner_id', allocation_row.learner_id,
          'source', 'first_effective_playback',
          'segment_id', target_segment_id
        )
      );
    end if;
  end if;

  perform pg_catalog.set_config(
    'app.enterprise_playback_segment_id', target_segment_id::text, true
  );
  update public.playback_segments
  set active_seconds = target_next_active_seconds
  where id = segment_row.id
  returning * into segment_row;
  perform pg_catalog.set_config('app.enterprise_playback_segment_id', '', true);
  return segment_row;
end;
$$;

create unique index one_active_enterprise_recorded_entitlement
  on public.entitlements (organization_id, user_id, course_id)
  where active and organization_id is not null and user_id is not null and live_session_id is null;
create unique index one_active_enterprise_live_entitlement
  on public.entitlements (organization_id, user_id, live_session_id)
  where active and organization_id is not null and user_id is not null and live_session_id is not null;
create unique index one_enterprise_recorded_enrollment
  on public.enrollments (organization_id, learner_id, course_id)
  where organization_id is not null and live_session_id is null;
create unique index one_enterprise_live_enrollment
  on public.enrollments (organization_id, learner_id, live_session_id)
  where organization_id is not null and live_session_id is not null;

-- 退款後重購會沿用原 enrollment，但舊證明必須永久保留為 revoked。
-- 因此只限制同一 enrollment 同時最多一張有效證明，允許重新完成後發新證明。
alter table public.certificates
  drop constraint if exists certificates_enrollment_id_key;
create unique index one_active_certificate_per_enrollment
  on public.certificates (enrollment_id)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- 電子發票、通知與企業部分退款
-- ---------------------------------------------------------------------------

create table public.invoice_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  order_id uuid not null references public.orders(id),
  refund_id uuid references public.refunds(id),
  parent_invoice_id uuid references public.invoice_records(id),
  record_type text not null default 'invoice'
    check (record_type in ('invoice', 'allowance', 'void')),
  status text not null default 'pending'
    check (status in ('pending', 'issued', 'failed', 'voided', 'allowance_issued')),
  idempotency_key text not null unique,
  provider_invoice_no text,
  invoice_number text,
  invoice_date date,
  allowance_number text,
  allowance_status text not null default 'none'
    check (allowance_status in (
      'none', 'processing', 'pending_consent', 'issued', 'failed', 'ambiguous'
    )),
  allowance_amount_twd integer not null default 0 check (allowance_amount_twd >= 0),
  allowance_date date,
  allowance_expires_at timestamptz,
  allowance_claim_token uuid,
  allowance_claimed_at timestamptz,
  allowance_lease_expires_at timestamptz,
  allowance_last_claim_token_hash text,
  allowance_manual_reconciliation_required boolean not null default false,
  allowance_reconciliation_outcome text
    check (allowance_reconciliation_outcome is null or allowance_reconciliation_outcome in (
      'confirmed_not_issued', 'confirmed_issued'
    )),
  allowance_reconciled_at timestamptz,
  allowance_reconciled_by uuid references auth.users(id),
  allowance_reconciliation_reason text,
  remaining_allowance_twd integer not null default 0 check (remaining_allowance_twd >= 0),
  buyer_title text not null,
  buyer_tax_id text not null check (buyer_tax_id ~ '^[0-9]{8}$'),
  buyer_email text not null,
  amount_twd integer not null check (amount_twd >= 0),
  details jsonb not null default '{}'::jsonb,
  provider_response jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_message text,
  next_retry_at timestamptz,
  issued_at timestamptz,
  voided_at timestamptz,
  allowance_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (buyer_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  check (
    (
      allowance_status = 'processing'
      and allowance_claim_token is not null
      and allowance_claimed_at is not null
      and allowance_lease_expires_at is not null
    ) or (
      allowance_status <> 'processing'
      and allowance_claim_token is null
      and allowance_claimed_at is null
      and allowance_lease_expires_at is null
    )
  ),
  check (
    allowance_last_claim_token_hash is null
    or allowance_last_claim_token_hash ~ '^[0-9a-f]{64}$'
  ),
  check (
    allowance_status <> 'ambiguous'
    or allowance_manual_reconciliation_required
  )
);
create unique index invoice_records_one_invoice_per_order
  on public.invoice_records (order_id)
  where record_type = 'invoice';
create unique index invoice_records_one_allowance_per_refund
  on public.invoice_records (refund_id)
  where record_type = 'allowance' and refund_id is not null;
create unique index invoice_records_provider_invoice_no_unique
  on public.invoice_records (provider_invoice_no)
  where provider_invoice_no is not null;
create unique index invoice_records_invoice_number_unique
  on public.invoice_records (invoice_number)
  where invoice_number is not null;
create unique index invoice_records_allowance_number_unique
  on public.invoice_records (allowance_number)
  where allowance_number is not null;
create index invoice_records_retry_idx
  on public.invoice_records (status, next_retry_at)
  where status in ('pending', 'failed');
create index invoice_records_allowance_claim_idx
  on public.invoice_records (allowance_status, next_retry_at, allowance_lease_expires_at)
  where record_type = 'allowance'
    and allowance_status in ('none', 'processing', 'failed');
create index invoice_records_organization_idx
  on public.invoice_records (organization_id, created_at desc);
create index invoice_records_parent_idx
  on public.invoice_records (parent_invoice_id)
  where parent_invoice_id is not null;
create index invoice_records_reconciled_by_idx
  on public.invoice_records (allowance_reconciled_by)
  where allowance_reconciled_by is not null;
create index invoice_records_order_idx
  on public.invoice_records (order_id, created_at desc);
create trigger invoice_records_updated_at
before update on public.invoice_records
for each row execute function private.set_updated_at();

create or replace function private.initialize_invoice_allowance_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.record_type = 'invoice' and new.remaining_allowance_twd = 0 then
    new.remaining_allowance_twd := new.amount_twd;
  elsif new.record_type = 'allowance' and new.allowance_amount_twd = 0 then
    new.allowance_amount_twd := new.amount_twd;
  end if;
  return new;
end;
$$;
create trigger initialize_invoice_allowance_totals
before insert on public.invoice_records
for each row execute function private.initialize_invoice_allowance_totals();

alter table public.refunds
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists seat_lot_id uuid references public.enterprise_seat_lots(id),
  add column if not exists seat_quantity integer check (seat_quantity is null or seat_quantity > 0),
  add column if not exists approved_quantity integer check (approved_quantity is null or approved_quantity >= 0),
  add column if not exists unit_price_twd integer check (unit_price_twd is null or unit_price_twd >= 0),
  add column if not exists invoice_record_id uuid references public.invoice_records(id),
  add column if not exists decided_by uuid references auth.users(id),
  add column if not exists decision_reason text,
  add column if not exists provider_refund_id text,
  add column if not exists paid_at timestamptz,
  add column if not exists request_idempotency_key uuid,
  add column if not exists refund_scope text not null default 'individual'
    check (refund_scope in ('individual', 'enterprise_seats')),
  add constraint refunds_approved_quantity_check
    check (approved_quantity is null or seat_quantity is null or approved_quantity <= seat_quantity),
  add constraint refunds_enterprise_amount_check
    check (
      refund_scope <> 'enterprise_seats'
      or (
        organization_id is not null and seat_lot_id is not null
        and seat_quantity is not null and unit_price_twd is not null
        and amount_twd = seat_quantity * unit_price_twd
      )
    ),
  add constraint refunds_enterprise_paid_provider_check
    check (
      refund_scope <> 'enterprise_seats'
      or status <> 'paid'
      or nullif(btrim(provider_refund_id), '') is not null
    );

create unique index enterprise_refunds_provider_refund_id_unique
  on public.refunds (provider_refund_id)
  where provider_refund_id is not null;
create unique index enterprise_refunds_request_idempotency_unique
  on public.refunds (request_idempotency_key)
  where refund_scope = 'enterprise_seats'
    and request_idempotency_key is not null;

create table public.enterprise_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  invitation_id uuid references public.organization_invitations(id),
  allocation_id uuid references public.enterprise_seat_allocations(id),
  invoice_record_id uuid references public.invoice_records(id),
  reference_id text,
  kind text not null check (kind in (
    'organization_submitted', 'organization_approved', 'organization_rejected',
    'organization_review', 'organization_suspended',
    'invitation', 'assignment', 'live_session',
    'due_7d', 'due_1d', 'deadline', 'completion', 'invoice', 'refund'
  )),
  recipient_email text not null,
  idempotency_key text not null unique,
  provider_message_id text,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'suppressed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  check (recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);
create index enterprise_email_deliveries_retry_idx
  on public.enterprise_email_deliveries (status, next_attempt_at)
  where status in ('pending', 'failed');
create index enterprise_email_deliveries_organization_idx
  on public.enterprise_email_deliveries (organization_id, created_at desc);
create index enterprise_email_deliveries_allocation_idx
  on public.enterprise_email_deliveries (allocation_id)
  where allocation_id is not null;
create index enterprise_email_deliveries_invitation_idx
  on public.enterprise_email_deliveries (invitation_id)
  where invitation_id is not null;
create index enterprise_email_deliveries_invoice_idx
  on public.enterprise_email_deliveries (invoice_record_id)
  where invoice_record_id is not null;

create index organization_members_user_idx
  on public.organization_members (user_id, organization_id);
create index enterprise_refunds_organization_idx
  on public.refunds (organization_id, created_at desc)
  where organization_id is not null;
create index enterprise_refunds_seat_lot_idx
  on public.refunds (seat_lot_id, status)
  where seat_lot_id is not null;
create index enterprise_refunds_invoice_record_idx
  on public.refunds (invoice_record_id)
  where invoice_record_id is not null;

-- ---------------------------------------------------------------------------
-- Service-role-only RPC：申請機構與接受邀請
-- ---------------------------------------------------------------------------

create or replace function public.submit_organization_application(
  target_actor_id uuid,
  target_name text,
  target_tax_id text,
  target_contact_name text,
  target_contact_phone text,
  target_invoice_email text
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization_row public.organizations%rowtype;
  normalized_tax_id text := btrim(target_tax_id);
  normalized_email text := lower(btrim(target_invoice_email));
begin
  -- 同一申請人以 auth.users row 序列化，鎖後才重查 membership，避免
  -- 兩個並行申請都在尚未建立 owner membership 時各自建立一個機構。
  perform 1
  from auth.users u
  where u.id = target_actor_id
  for update;
  if not found then raise exception 'ACTOR_NOT_FOUND'; end if;
  if exists (
    select 1 from public.organization_members om where om.user_id = target_actor_id
  ) then raise exception 'ORGANIZATION_MEMBERSHIP_EXISTS'; end if;
  if length(btrim(target_name)) < 2 or length(btrim(target_contact_name)) < 2 then
    raise exception 'ORGANIZATION_CONTACT_REQUIRED';
  end if;
  if normalized_tax_id !~ '^[0-9]{8}$' then
    raise exception 'INVALID_TAX_ID';
  end if;
  if normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_INVOICE_EMAIL';
  end if;
  if exists (select 1 from public.organizations where tax_id = normalized_tax_id) then
    raise exception 'ORGANIZATION_TAX_ID_EXISTS';
  end if;

  insert into public.organizations (
    name, tax_id, active, status, contact_name, contact_phone,
    invoice_title, invoice_email, submitted_at
  ) values (
    btrim(target_name), normalized_tax_id, false, 'submitted',
    btrim(target_contact_name), nullif(btrim(target_contact_phone), ''),
    btrim(target_name), normalized_email, now()
  ) returning * into organization_row;

  insert into public.organization_members (organization_id, user_id, role)
  values (organization_row.id, target_actor_id, 'owner');

  insert into public.audit_events (actor_id, organization_id, action, target_type, target_id, after_data)
  values (
    target_actor_id, organization_row.id, 'organization.submitted', 'organization',
    organization_row.id::text,
    jsonb_build_object('status', 'submitted', 'tax_id_last4', right(normalized_tax_id, 4))
  );

  return organization_row;
end;
$$;

create or replace function public.accept_organization_invitation(
  target_token_hash text,
  target_actor_id uuid,
  target_actor_email text
)
returns public.organization_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_row public.organization_invitations%rowtype;
  member_row public.organization_members%rowtype;
  inviter_is_current_owner boolean;
begin
  select * into invitation_row
  from public.organization_invitations
  where token_hash = lower(btrim(target_token_hash))
  for update;

  if invitation_row.id is null then raise exception 'INVITATION_NOT_FOUND'; end if;
  if invitation_row.status <> 'pending' then raise exception 'INVITATION_NOT_PENDING'; end if;
  if invitation_row.expires_at <= now() then raise exception 'INVITATION_EXPIRED'; end if;
  if invitation_row.email_normalized <> lower(btrim(target_actor_email)) then
    raise exception 'INVITATION_EMAIL_MISMATCH';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = target_actor_id
      and lower(coalesce(u.email, '')) = invitation_row.email_normalized
  ) then
    raise exception 'ACTOR_EMAIL_NOT_VERIFIED';
  end if;
  if not exists (
    select 1 from public.organizations
    where id = invitation_row.organization_id and status = 'approved' and active
  ) then
    raise exception 'ORGANIZATION_NOT_ACTIVE';
  end if;
  inviter_is_current_owner := private.is_org_owner(
    invitation_row.organization_id,
    invitation_row.invited_by
  );
  if invitation_row.role = 'manager'
    and not inviter_is_current_owner then
    raise exception 'OWNER_REQUIRED_FOR_MANAGER_INVITATION';
  end if;

  insert into public.organization_members as existing_member (
    organization_id, user_id, role, employee_code, department
  ) values (
    invitation_row.organization_id, target_actor_id, invitation_row.role,
    invitation_row.employee_code, invitation_row.department
  )
  on conflict (organization_id, user_id) do update
  set role = case
        when existing_member.role = 'owner' then existing_member.role
        when existing_member.role = 'manager'
          and not inviter_is_current_owner then existing_member.role
        else excluded.role
      end,
      employee_code = case
        when existing_member.role = 'owner' then existing_member.employee_code
        when existing_member.role = 'manager'
          and not inviter_is_current_owner then existing_member.employee_code
        else coalesce(excluded.employee_code, existing_member.employee_code)
      end,
      department = case
        when existing_member.role = 'owner' then existing_member.department
        when existing_member.role = 'manager'
          and not inviter_is_current_owner then existing_member.department
        else coalesce(excluded.department, existing_member.department)
      end
  returning * into member_row;

  update public.organization_invitations
  set status = 'accepted', accepted_by = target_actor_id, accepted_at = now(), updated_at = now()
  where id = invitation_row.id;

  insert into public.audit_events (actor_id, organization_id, action, target_type, target_id, after_data)
  values (
    target_actor_id, invitation_row.organization_id, 'organization.invitation_accepted',
    'organization_invitation', invitation_row.id::text,
    jsonb_build_object('member_role', member_row.role)
  );

  return member_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-role-only RPC：直播選場／改場
-- ---------------------------------------------------------------------------

create or replace function public.select_enterprise_live_session(
  target_allocation_id uuid,
  target_session_id uuid,
  target_actor_id uuid
)
returns public.enterprise_seat_allocations
language plpgsql
security definer
set search_path = ''
as $$
declare
  allocation_row public.enterprise_seat_allocations%rowtype;
  lot_row public.enterprise_seat_lots%rowtype;
  target_session public.live_sessions%rowtype;
  source_session public.live_sessions%rowtype;
  new_booking public.live_session_bookings%rowtype;
  occupied integer;
  actor_is_admin boolean;
  enrollment_ref uuid;
  entitlement_ref uuid;
  allocation_lot_id uuid;
begin
  select a.seat_lot_id into allocation_lot_id
  from public.enterprise_seat_allocations a
  where a.id = target_allocation_id;
  if allocation_lot_id is null then raise exception 'ENTERPRISE_ALLOCATION_NOT_FOUND'; end if;
  select * into lot_row
  from public.enterprise_seat_lots
  where id = allocation_lot_id
  for update;
  select * into allocation_row
  from public.enterprise_seat_allocations
  where id = target_allocation_id
  for update;
  if allocation_row.id is null then raise exception 'ENTERPRISE_ALLOCATION_NOT_FOUND'; end if;
  if allocation_row.seat_lot_id <> lot_row.id then raise exception 'ENTERPRISE_ALLOCATION_CHANGED'; end if;
  if allocation_row.status <> 'assigned' then raise exception 'ENTERPRISE_ALLOCATION_NOT_CHANGEABLE'; end if;
  enrollment_ref := allocation_row.enrollment_id;
  entitlement_ref := allocation_row.entitlement_id;

  if lot_row.status <> 'active' or lot_row.valid_until <= now() then
    raise exception 'ENTERPRISE_SEAT_LOT_EXPIRED';
  end if;

  select exists (
    select 1 from auth.users u
    where u.id = target_actor_id and u.raw_app_meta_data ->> 'platform_role' = 'admin'
  ) into actor_is_admin;
  if not actor_is_admin
    and not private.is_org_manager(allocation_row.organization_id, target_actor_id) then
    raise exception 'ENTERPRISE_MANAGER_REQUIRED';
  end if;
  if not actor_is_admin and not exists (
    select 1 from public.organizations o
    where o.id = allocation_row.organization_id and o.status = 'approved' and o.active
  ) then raise exception 'ORGANIZATION_NOT_ACTIVE'; end if;

  -- 企業選場與個人訂單付款履約共用同一個 learner row lock。
  -- 這個粗粒度鎖讓雙方在鎖後重查權限，避免同一場次雙重履約。
  perform 1
  from auth.users u
  where u.id = allocation_row.learner_id
  for update;
  if not found then raise exception 'LEARNER_NOT_FOUND'; end if;

  -- 來源與目標場次一律依 UUID 排序先取鎖，避免兩筆改場互鎖。
  perform 1
  from public.live_sessions
  where id in (target_session_id, allocation_row.live_session_id)
  order by id
  for update;
  select * into target_session
  from public.live_sessions
  where id = target_session_id;
  if target_session.id is null
    or target_session.course_id <> allocation_row.course_id
    or target_session.status not in ('scheduled', 'open')
    or target_session.starts_at <= now()
    or target_session.starts_at > lot_row.valid_until then
    raise exception 'INVALID_ENTERPRISE_LIVE_SESSION';
  end if;

  if allocation_row.live_session_id is not null then
    select * into source_session
    from public.live_sessions
    where id = allocation_row.live_session_id;
    perform 1
    from public.live_session_bookings
    where id = allocation_row.booking_id
    for update;
    if not actor_is_admin and source_session.starts_at <= now() + interval '24 hours' then
      raise exception 'ENTERPRISE_LIVE_CHANGE_CUTOFF_24_HOURS';
    end if;
    if exists (
      select 1 from public.live_attendance_events e
      where e.booking_id = allocation_row.booking_id
        and e.event_type in ('check_in', 'joined', 'heartbeat')
    ) or exists (
      select 1 from public.live_attendance_summaries s
      where s.booking_id = allocation_row.booking_id and s.checked_in_at is not null
    ) then
      raise exception 'ENTERPRISE_LIVE_ATTENDANCE_ALREADY_STARTED';
    end if;
  end if;

  if exists (
    select 1 from public.live_session_bookings b
    where b.live_session_id = target_session_id
      and b.learner_id = allocation_row.learner_id
      and b.status in ('held', 'confirmed')
      and b.id is distinct from allocation_row.booking_id
  ) or exists (
    select 1 from public.entitlements e
    where e.user_id = allocation_row.learner_id
      and e.live_session_id = target_session_id
      and e.active
      and e.id is distinct from allocation_row.entitlement_id
  ) then
    raise exception 'LEARNER_ALREADY_HAS_TARGET_SESSION';
  end if;

  if allocation_row.live_session_id = target_session_id then return allocation_row; end if;

  update public.live_session_bookings
  set status = 'expired', updated_at = now()
  where live_session_id = target_session_id and status = 'held' and held_until <= now();
  select count(*) into occupied
  from public.live_session_bookings
  where live_session_id = target_session_id
    and (status = 'confirmed' or (status = 'held' and held_until > now()));
  if occupied >= target_session.capacity then raise exception 'TARGET_SESSION_FULL'; end if;

  if allocation_row.booking_id is not null then
    update public.live_session_bookings
    set status = 'transferred', updated_at = now()
    where id = allocation_row.booking_id;
  end if;

  if enrollment_ref is null then
    if exists (
      select 1 from public.enrollments e
      where e.organization_id = allocation_row.organization_id
        and e.learner_id = allocation_row.learner_id
        and e.live_session_id = target_session_id
    ) then raise exception 'TARGET_ENTERPRISE_ENROLLMENT_EXISTS'; end if;
    insert into public.enrollments (
      learner_id, course_id, organization_id, live_session_id, status
    ) values (
      allocation_row.learner_id, allocation_row.course_id,
      allocation_row.organization_id, target_session_id, 'active'
    ) returning id into enrollment_ref;
  else
    update public.enrollments
    set live_session_id = target_session_id, status = 'active', updated_at = now()
    where id = enrollment_ref;
  end if;

  if entitlement_ref is null then
    insert into public.entitlements (
      user_id, organization_id, course_id, live_session_id, source_order_id, active
    ) values (
      allocation_row.learner_id, allocation_row.organization_id,
      allocation_row.course_id, target_session_id, lot_row.source_order_id, true
    ) returning id into entitlement_ref;
  else
    update public.entitlements
    set live_session_id = target_session_id, active = true
    where id = entitlement_ref;
  end if;

  insert into public.live_session_bookings (
    live_session_id, learner_id, enrollment_id, source_order_id,
    status, confirmed_at, transferred_from
  ) values (
    target_session_id, allocation_row.learner_id, enrollment_ref,
    lot_row.source_order_id, 'confirmed', now(), allocation_row.booking_id
  ) returning * into new_booking;
  insert into public.live_attendance_summaries (booking_id, live_session_id, learner_id)
  values (new_booking.id, target_session_id, allocation_row.learner_id)
  on conflict (booking_id) do nothing;

  update public.enterprise_seat_allocations
  set live_session_id = target_session_id,
      booking_id = new_booking.id,
      enrollment_id = enrollment_ref,
      entitlement_id = entitlement_ref,
      updated_at = now()
  where id = allocation_row.id
  returning * into allocation_row;

  insert into public.audit_events (actor_id, organization_id, action, target_type, target_id, after_data)
  values (
    target_actor_id, allocation_row.organization_id, 'enterprise.live_session_selected',
    'enterprise_seat_allocation', allocation_row.id::text,
    jsonb_build_object('live_session_id', target_session_id, 'booking_id', new_booking.id)
  );
  return allocation_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-role-only RPC：錄播／直播指派、釋放與消耗
-- ---------------------------------------------------------------------------

create or replace function public.assign_enterprise_seat(
  target_lot_id uuid,
  target_learner_id uuid,
  target_due_at timestamptz,
  target_live_session_id uuid,
  target_actor_id uuid
)
returns public.enterprise_seat_allocations
language plpgsql
security definer
set search_path = ''
as $$
declare
  lot_row public.enterprise_seat_lots%rowtype;
  course_row public.courses%rowtype;
  allocation_row public.enterprise_seat_allocations%rowtype;
  ledger_available integer;
  reserved_refund_quantity integer;
  enrollment_ref uuid;
  entitlement_ref uuid;
begin
  select * into lot_row
  from public.enterprise_seat_lots
  where id = target_lot_id
  for update;
  if lot_row.id is null then raise exception 'ENTERPRISE_SEAT_LOT_NOT_FOUND'; end if;
  if lot_row.status <> 'active' or lot_row.valid_until <= now() then
    raise exception 'ENTERPRISE_SEAT_LOT_EXPIRED';
  end if;
  if not private.is_org_manager(lot_row.organization_id, target_actor_id) then
    raise exception 'ENTERPRISE_MANAGER_REQUIRED';
  end if;
  if not exists (
    select 1 from public.organizations o
    where o.id = lot_row.organization_id and o.status = 'approved' and o.active
  ) then raise exception 'ORGANIZATION_NOT_ACTIVE'; end if;
  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = lot_row.organization_id and om.user_id = target_learner_id
  ) then raise exception 'LEARNER_NOT_ORGANIZATION_MEMBER'; end if;
  if target_due_at is not null and (target_due_at <= now() or target_due_at > lot_row.valid_until) then
    raise exception 'INVALID_ENTERPRISE_DUE_AT';
  end if;
  select * into course_row from public.courses where id = lot_row.course_id;
  if course_row.delivery not in ('recorded', 'live') then
    raise exception 'ENTERPRISE_HYBRID_NOT_SUPPORTED';
  end if;

  -- 與個人付款 callback 使用相同履約序列化鎖。鎖後才重查
  -- entitlement，使先完成的一方成為唯一履約來源。
  perform 1
  from auth.users u
  where u.id = target_learner_id
  for update;
  if not found then raise exception 'LEARNER_NOT_FOUND'; end if;

  if course_row.delivery = 'recorded' and target_live_session_id is not null then
    raise exception 'RECORDED_COURSE_CANNOT_SELECT_LIVE_SESSION';
  end if;
  if course_row.delivery = 'recorded' and exists (
    select 1 from public.entitlements e
    where e.user_id = target_learner_id
      and e.course_id = lot_row.course_id
      and e.live_session_id is null
      and e.active
  ) then raise exception 'LEARNER_ALREADY_ENTITLED_TO_RECORDED_COURSE'; end if;
  if course_row.delivery = 'recorded' and exists (
    select 1 from public.enterprise_seat_allocations a
    where a.organization_id = lot_row.organization_id
      and a.course_id = lot_row.course_id
      and a.learner_id = target_learner_id
      and a.status in ('assigned', 'consumed')
  ) then raise exception 'ENTERPRISE_COURSE_ALREADY_ALLOCATED'; end if;
  if course_row.delivery = 'live' and exists (
    select 1 from public.enterprise_seat_allocations a
    where a.organization_id = lot_row.organization_id
      and a.course_id = lot_row.course_id
      and a.learner_id = target_learner_id
      and a.status = 'assigned'
      and (
        a.live_session_id is null
        or (target_live_session_id is not null and a.live_session_id = target_live_session_id)
      )
  ) then raise exception 'ENTERPRISE_LIVE_SESSION_ALREADY_ALLOCATED'; end if;

  select coalesce(sum(available_delta), 0)::integer into ledger_available
  from public.enterprise_seat_events
  where seat_lot_id = lot_row.id;
  if ledger_available <> lot_row.available_quantity then
    raise exception 'ENTERPRISE_SEAT_LEDGER_OUT_OF_SYNC';
  end if;
  select coalesce(sum(r.seat_quantity), 0)::integer into reserved_refund_quantity
  from public.refunds r
  where r.seat_lot_id = lot_row.id
    and r.refund_scope = 'enterprise_seats'
    and r.status in ('manual_review', 'approved');
  if lot_row.available_quantity - reserved_refund_quantity < 1 then
    raise exception 'NO_AVAILABLE_ENTERPRISE_SEATS';
  end if;

  insert into public.enterprise_seat_allocations (
    seat_lot_id, organization_id, course_id, learner_id,
    due_at, assigned_by, status
  ) values (
    lot_row.id, lot_row.organization_id, lot_row.course_id, target_learner_id,
    target_due_at, target_actor_id, 'assigned'
  ) returning * into allocation_row;

  insert into public.enterprise_seat_events (
    seat_lot_id, organization_id, allocation_id, event_type, quantity, available_delta,
    idempotency_key, actor_id
  ) values (
    lot_row.id, lot_row.organization_id, allocation_row.id, 'assigned', 1, -1,
    'enterprise-allocation:' || allocation_row.id::text || ':assigned', target_actor_id
  );

  if course_row.delivery = 'recorded' then
    insert into public.course_assignments (
      organization_id, course_id, learner_id, assigned_by, due_at
    ) values (
      lot_row.organization_id, lot_row.course_id, target_learner_id,
      target_actor_id, target_due_at
    )
    on conflict (organization_id, course_id, learner_id) do update
    set assigned_by = excluded.assigned_by, due_at = excluded.due_at;

    insert into public.enrollments (
      learner_id, course_id, organization_id, status
    ) values (
      target_learner_id, lot_row.course_id, lot_row.organization_id, 'active'
    )
    on conflict (organization_id, learner_id, course_id)
      where organization_id is not null and live_session_id is null
    do update set status = 'active', expires_at = null, failure_reason = null, updated_at = now()
    returning id into enrollment_ref;

    insert into public.entitlements (
      user_id, organization_id, course_id, source_order_id, active
    ) values (
      target_learner_id, lot_row.organization_id, lot_row.course_id,
      lot_row.source_order_id, true
    ) returning id into entitlement_ref;

    update public.enterprise_seat_allocations
    set enrollment_id = enrollment_ref,
        entitlement_id = entitlement_ref,
        updated_at = now()
    where id = allocation_row.id
    returning * into allocation_row;
  elsif target_live_session_id is not null then
    allocation_row := public.select_enterprise_live_session(
      allocation_row.id, target_live_session_id, target_actor_id
    );
  end if;

  insert into public.audit_events (actor_id, organization_id, action, target_type, target_id, after_data)
  values (
    target_actor_id, lot_row.organization_id, 'enterprise.seat_assigned',
    'enterprise_seat_allocation', allocation_row.id::text,
    jsonb_build_object('course_id', lot_row.course_id, 'learner_id', target_learner_id)
  );
  return allocation_row;
end;
$$;

create or replace function public.release_enterprise_seat(
  target_allocation_id uuid,
  target_actor_id uuid
)
returns public.enterprise_seat_allocations
language plpgsql
security definer
set search_path = ''
as $$
declare
  allocation_row public.enterprise_seat_allocations%rowtype;
  lot_row public.enterprise_seat_lots%rowtype;
  course_row public.courses%rowtype;
  session_row public.live_sessions%rowtype;
  actor_is_admin boolean;
  allocation_lot_id uuid;
begin
  select a.seat_lot_id into allocation_lot_id
  from public.enterprise_seat_allocations a
  where a.id = target_allocation_id;
  if allocation_lot_id is null then raise exception 'ENTERPRISE_ALLOCATION_NOT_FOUND'; end if;
  select * into lot_row
  from public.enterprise_seat_lots
  where id = allocation_lot_id
  for update;
  select * into allocation_row
  from public.enterprise_seat_allocations
  where id = target_allocation_id
  for update;
  if allocation_row.id is null then raise exception 'ENTERPRISE_ALLOCATION_NOT_FOUND'; end if;
  if allocation_row.seat_lot_id <> lot_row.id then raise exception 'ENTERPRISE_ALLOCATION_CHANGED'; end if;
  if allocation_row.status <> 'assigned' then raise exception 'ENTERPRISE_ALLOCATION_NOT_RELEASABLE'; end if;
  if lot_row.status <> 'active' or lot_row.valid_until <= now() then
    raise exception 'ENTERPRISE_SEAT_LOT_EXPIRED';
  end if;
  select exists (
    select 1 from auth.users u
    where u.id = target_actor_id and u.raw_app_meta_data ->> 'platform_role' = 'admin'
  ) into actor_is_admin;
  if not actor_is_admin
    and not private.is_org_manager(allocation_row.organization_id, target_actor_id) then
    raise exception 'ENTERPRISE_MANAGER_REQUIRED';
  end if;
  select * into course_row from public.courses where id = allocation_row.course_id;

  if course_row.delivery = 'recorded' then
    -- 先鎖定現有播放列；heartbeat 對 segment 的更新會與釋出串行化。
    perform 1
    from public.playback_sessions ps
    where ps.enrollment_id = allocation_row.enrollment_id
    order by ps.id
    for update;
    perform 1
    from public.playback_segments segment
    join public.playback_sessions ps on ps.id = segment.playback_session_id
    where ps.enrollment_id = allocation_row.enrollment_id
    order by segment.id
    for update of segment;
    if exists (
      select 1 from public.enrollments e
      where e.id = allocation_row.enrollment_id
        and (e.valid_watch_seconds > 0 or e.progress_percent > 0)
    ) or exists (
      select 1 from public.lesson_progress lp
      where lp.enrollment_id = allocation_row.enrollment_id
        and lp.valid_watch_seconds > 0
    ) or exists (
      select 1
      from public.playback_segments segment
      join public.playback_sessions ps on ps.id = segment.playback_session_id
      where ps.enrollment_id = allocation_row.enrollment_id
        and segment.active_seconds > 0
    ) or exists (
      select 1 from public.certificates c where c.enrollment_id = allocation_row.enrollment_id
    ) then raise exception 'ENTERPRISE_RECORDED_LEARNING_ALREADY_STARTED'; end if;
  elsif allocation_row.live_session_id is not null then
    select * into session_row
    from public.live_sessions
    where id = allocation_row.live_session_id
    for update;
    perform 1
    from public.live_session_bookings
    where id = allocation_row.booking_id
    for update;
    if not actor_is_admin and session_row.starts_at <= now() + interval '24 hours' then
      raise exception 'ENTERPRISE_LIVE_CHANGE_CUTOFF_24_HOURS';
    end if;
    if exists (
      select 1 from public.live_attendance_events e
      where e.booking_id = allocation_row.booking_id
        and e.event_type in ('check_in', 'joined', 'heartbeat')
    ) or exists (
      select 1 from public.live_attendance_summaries s
      where s.booking_id = allocation_row.booking_id and s.checked_in_at is not null
    ) or exists (
      select 1 from public.certificates c where c.enrollment_id = allocation_row.enrollment_id
    ) then raise exception 'ENTERPRISE_LIVE_ATTENDANCE_ALREADY_STARTED'; end if;
    update public.live_session_bookings
    set status = 'cancelled', updated_at = now()
    where id = allocation_row.booking_id;
  end if;

  update public.playback_segments segment
  set ended_at = coalesce(segment.ended_at, now())
  from public.playback_sessions ps
  where ps.id = segment.playback_session_id
    and ps.enrollment_id = allocation_row.enrollment_id
    and segment.ended_at is null;
  update public.playback_sessions
  set active = false, ended_at = coalesce(ended_at, now())
  where enrollment_id = allocation_row.enrollment_id and active;
  update public.entitlements set active = false where id = allocation_row.entitlement_id;
  update public.enrollments
  set status = 'expired', failure_reason = 'enterprise_seat_released', updated_at = now()
  where id = allocation_row.enrollment_id;
  delete from public.course_assignments
  where organization_id = allocation_row.organization_id
    and course_id = allocation_row.course_id
    and learner_id = allocation_row.learner_id;

  update public.enterprise_seat_allocations
  set status = 'released', released_at = now(), updated_at = now()
  where id = allocation_row.id
  returning * into allocation_row;
  insert into public.enterprise_seat_events (
    seat_lot_id, organization_id, allocation_id, event_type, quantity, available_delta,
    idempotency_key, actor_id
  ) values (
    lot_row.id, lot_row.organization_id, allocation_row.id, 'released', 1, 1,
    'enterprise-allocation:' || allocation_row.id::text || ':released', target_actor_id
  );
  insert into public.audit_events (actor_id, organization_id, action, target_type, target_id, after_data)
  values (
    target_actor_id, allocation_row.organization_id, 'enterprise.seat_released',
    'enterprise_seat_allocation', allocation_row.id::text,
    jsonb_build_object('course_id', allocation_row.course_id, 'learner_id', allocation_row.learner_id)
  );
  return allocation_row;
end;
$$;

create or replace function public.consume_enterprise_seat(
  target_allocation_id uuid,
  target_actor_id uuid
)
returns public.enterprise_seat_allocations
language plpgsql
security definer
set search_path = ''
as $$
declare
  allocation_row public.enterprise_seat_allocations%rowtype;
  course_row public.courses%rowtype;
  allocation_lot_id uuid;
begin
  select a.seat_lot_id into allocation_lot_id
  from public.enterprise_seat_allocations a
  where a.id = target_allocation_id;
  if allocation_lot_id is null then raise exception 'ENTERPRISE_ALLOCATION_NOT_FOUND'; end if;
  perform 1 from public.enterprise_seat_lots where id = allocation_lot_id for update;
  select * into allocation_row
  from public.enterprise_seat_allocations
  where id = target_allocation_id
  for update;
  if allocation_row.id is null then raise exception 'ENTERPRISE_ALLOCATION_NOT_FOUND'; end if;
  if allocation_row.seat_lot_id <> allocation_lot_id then raise exception 'ENTERPRISE_ALLOCATION_CHANGED'; end if;
  if allocation_row.status = 'consumed' then return allocation_row; end if;
  if allocation_row.status <> 'assigned' then raise exception 'ENTERPRISE_ALLOCATION_NOT_CONSUMABLE'; end if;
  if target_actor_id <> allocation_row.learner_id
    and not private.is_org_manager(allocation_row.organization_id, target_actor_id) then
    raise exception 'ENTERPRISE_ALLOCATION_ACCESS_DENIED';
  end if;
  select * into course_row from public.courses where id = allocation_row.course_id;

  if course_row.delivery = 'recorded' then
    if not exists (
      select 1 from public.enrollments e
      where e.id = allocation_row.enrollment_id
        and (e.valid_watch_seconds > 0 or e.progress_percent > 0)
    ) and not exists (
      select 1 from public.lesson_progress lp
      where lp.enrollment_id = allocation_row.enrollment_id
        and lp.valid_watch_seconds > 0
    ) and not exists (
      select 1
      from public.playback_segments segment
      join public.playback_sessions ps on ps.id = segment.playback_session_id
      where ps.enrollment_id = allocation_row.enrollment_id
        and segment.active_seconds > 0
    ) then raise exception 'RECORDED_LEARNING_NOT_STARTED'; end if;
  else
    perform 1
    from public.live_session_bookings
    where id = allocation_row.booking_id
    for update;
    if allocation_row.live_session_id is null or not exists (
      select 1 from public.live_attendance_events e
      where e.booking_id = allocation_row.booking_id and e.event_type = 'check_in'
    ) then raise exception 'LIVE_CHECK_IN_REQUIRED'; end if;
  end if;

  update public.enterprise_seat_allocations
  set status = 'consumed', consumed_at = now(), updated_at = now()
  where id = allocation_row.id
  returning * into allocation_row;
  insert into public.enterprise_seat_events (
    seat_lot_id, organization_id, allocation_id, event_type, quantity, available_delta,
    idempotency_key, actor_id
  ) values (
    allocation_row.seat_lot_id, allocation_row.organization_id,
    allocation_row.id, 'consumed', 1, 0,
    'enterprise-allocation:' || allocation_row.id::text || ':consumed', target_actor_id
  );
  insert into public.audit_events (actor_id, organization_id, action, target_type, target_id, after_data)
  values (
    target_actor_id, allocation_row.organization_id, 'enterprise.seat_consumed',
    'enterprise_seat_allocation', allocation_row.id::text,
    jsonb_build_object('course_id', allocation_row.course_id, 'learner_id', allocation_row.learner_id)
  );
  return allocation_row;
end;
$$;

create or replace function public.correct_enterprise_seat_lot(
  target_lot_id uuid,
  target_available_delta integer,
  target_actor_id uuid,
  target_reason text
)
returns public.enterprise_seat_lots
language plpgsql
security definer
set search_path = ''
as $$
declare
  lot_row public.enterprise_seat_lots%rowtype;
  ledger_available integer;
  reserved_refund_quantity integer;
  allocated_quantity integer;
  maximum_available integer;
  next_available integer;
  correction_event_key text := 'enterprise-correction:' || gen_random_uuid()::text;
begin
  if not exists (
    select 1 from auth.users u
    where u.id = target_actor_id and u.raw_app_meta_data ->> 'platform_role' = 'admin'
  ) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  if target_available_delta is null or target_available_delta = 0
    or abs(target_available_delta::bigint) > 1000000
    or target_reason is null or length(btrim(target_reason)) < 5 then
    raise exception 'INVALID_ENTERPRISE_SEAT_CORRECTION';
  end if;

  select * into lot_row
  from public.enterprise_seat_lots
  where id = target_lot_id
  for update;
  if lot_row.id is null then raise exception 'ENTERPRISE_SEAT_LOT_NOT_FOUND'; end if;
  if lot_row.status in ('refunded', 'cancelled') then
    raise exception 'ENTERPRISE_SEAT_LOT_NOT_CORRECTABLE';
  end if;
  select coalesce(sum(e.available_delta), 0)::integer into ledger_available
  from public.enterprise_seat_events e
  where e.seat_lot_id = lot_row.id;
  if ledger_available <> lot_row.available_quantity then
    raise exception 'ENTERPRISE_SEAT_LEDGER_OUT_OF_SYNC';
  end if;
  select coalesce(sum(r.seat_quantity), 0)::integer into reserved_refund_quantity
  from public.refunds r
  where r.seat_lot_id = lot_row.id
    and r.refund_scope = 'enterprise_seats'
    and r.status in ('manual_review', 'approved');
  select count(*)::integer into allocated_quantity
  from public.enterprise_seat_allocations a
  where a.seat_lot_id = lot_row.id
    and a.status in ('assigned', 'consumed');

  maximum_available := lot_row.total_quantity - allocated_quantity;
  next_available := lot_row.available_quantity + target_available_delta;
  if next_available < reserved_refund_quantity
    or next_available < 0
    or next_available > maximum_available then
    raise exception 'ENTERPRISE_SEAT_CORRECTION_BREAKS_INVARIANT';
  end if;

  insert into public.enterprise_seat_events (
    seat_lot_id, organization_id, event_type, quantity, available_delta,
    idempotency_key, actor_id, metadata
  ) values (
    lot_row.id, lot_row.organization_id, 'correction',
    abs(target_available_delta), target_available_delta,
    correction_event_key, target_actor_id,
    jsonb_build_object(
      'reason', btrim(target_reason),
      'before_available', lot_row.available_quantity,
      'after_available', next_available,
      'reserved_refund_quantity', reserved_refund_quantity,
      'allocated_quantity', allocated_quantity
    )
  );
  select * into lot_row from public.enterprise_seat_lots where id = target_lot_id;
  insert into public.audit_events (
    actor_id, organization_id, action, target_type, target_id, before_data, after_data
  ) values (
    target_actor_id, lot_row.organization_id, 'enterprise.seat_lot_corrected',
    'enterprise_seat_lot', lot_row.id::text,
    jsonb_build_object('available_quantity', next_available - target_available_delta),
    jsonb_build_object(
      'available_quantity', next_available,
      'delta', target_available_delta,
      'reason', btrim(target_reason),
      'event_key', correction_event_key
    )
  );
  return lot_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-role-only RPC：到期批次（Cron 使用）
-- ---------------------------------------------------------------------------

create or replace function public.expire_enterprise_seat_lots(
  target_now timestamptz default now()
)
returns table (
  seat_lot_id uuid,
  expired_available_quantity integer,
  expired_allocation_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  lot_row public.enterprise_seat_lots%rowtype;
  allocation_row public.enterprise_seat_allocations%rowtype;
  course_delivery public.course_delivery;
  available_to_expire integer;
  current_available integer;
  reserved_refund_quantity integer;
  expiry_batch bigint;
  allocation_count integer;
  has_started boolean;
begin
  for lot_row in
    select l.*
    from public.enterprise_seat_lots l
    where l.valid_until <= target_now
      and (
        l.status = 'active'
        or (
          l.status = 'expired' and l.available_quantity > 0
          and not exists (
            select 1 from public.refunds r
            where r.seat_lot_id = l.id
              and r.refund_scope = 'enterprise_seats'
              and r.status in ('manual_review', 'approved')
          )
        )
      )
    order by l.id
    for update skip locked
  loop
    allocation_count := 0;
    select c.delivery into course_delivery from public.courses c where c.id = lot_row.course_id;

    for allocation_row in
      select a.*
      from public.enterprise_seat_allocations a
      where a.seat_lot_id = lot_row.id and a.status = 'assigned'
      order by a.id
      for update
    loop
      if course_delivery = 'recorded' then
        perform 1
        from public.playback_sessions ps
        where ps.enrollment_id = allocation_row.enrollment_id
        order by ps.id
        for update;
        perform 1
        from public.playback_segments segment
        join public.playback_sessions ps on ps.id = segment.playback_session_id
        where ps.enrollment_id = allocation_row.enrollment_id
        order by segment.id
        for update of segment;
        select exists (
          select 1 from public.enrollments e
          where e.id = allocation_row.enrollment_id
            and (e.valid_watch_seconds > 0 or e.progress_percent > 0)
        ) or exists (
          select 1 from public.lesson_progress lp
          where lp.enrollment_id = allocation_row.enrollment_id
            and lp.valid_watch_seconds > 0
        ) or exists (
          select 1
          from public.playback_segments segment
          join public.playback_sessions ps on ps.id = segment.playback_session_id
          where ps.enrollment_id = allocation_row.enrollment_id
            and segment.active_seconds > 0
        ) into has_started;
      else
        perform 1
        from public.live_session_bookings
        where id = allocation_row.booking_id
        for update;
        select exists (
          select 1 from public.live_attendance_events e
          where e.booking_id = allocation_row.booking_id and e.event_type = 'check_in'
        ) into has_started;
      end if;

      if has_started then
        update public.enterprise_seat_allocations
        set status = 'consumed', consumed_at = target_now, updated_at = now()
        where id = allocation_row.id;
        insert into public.enterprise_seat_events (
          seat_lot_id, organization_id, allocation_id, event_type, quantity, available_delta,
          idempotency_key, metadata
        ) values (
          lot_row.id, lot_row.organization_id, allocation_row.id, 'consumed', 1, 0,
          'enterprise-allocation:' || allocation_row.id::text || ':consumed-at-expiry',
          jsonb_build_object('expired_at', target_now)
        ) on conflict (idempotency_key) do nothing;
        continue;
      end if;

      update public.playback_segments segment
      set ended_at = coalesce(segment.ended_at, target_now)
      from public.playback_sessions ps
      where ps.id = segment.playback_session_id
        and ps.enrollment_id = allocation_row.enrollment_id
        and segment.ended_at is null;
      update public.playback_sessions
      set active = false, ended_at = coalesce(ended_at, target_now)
      where enrollment_id = allocation_row.enrollment_id and active;
      update public.entitlements set active = false where id = allocation_row.entitlement_id;
      update public.enrollments
      set status = 'expired', failure_reason = 'enterprise_seat_expired', updated_at = now()
      where id = allocation_row.enrollment_id;
      update public.live_session_bookings
      set status = 'expired', updated_at = now()
      where id = allocation_row.booking_id and status in ('held', 'confirmed');
      delete from public.course_assignments
      where organization_id = allocation_row.organization_id
        and course_id = allocation_row.course_id
        and learner_id = allocation_row.learner_id;
      update public.enterprise_seat_allocations
      set status = 'expired', expired_at = target_now, updated_at = now()
      where id = allocation_row.id;
      insert into public.enterprise_seat_events (
        seat_lot_id, organization_id, allocation_id, event_type, quantity, available_delta,
        idempotency_key, metadata
      ) values (
        lot_row.id, lot_row.organization_id, allocation_row.id, 'expired', 1, 0,
        'enterprise-allocation:' || allocation_row.id::text || ':expired',
        jsonb_build_object('expired_at', target_now)
      ) on conflict (idempotency_key) do nothing;
      allocation_count := allocation_count + 1;
    end loop;

    select l.available_quantity into current_available
    from public.enterprise_seat_lots l where l.id = lot_row.id for update;
    select coalesce(sum(r.seat_quantity), 0)::integer into reserved_refund_quantity
    from public.refunds r
    where r.seat_lot_id = lot_row.id
      and r.refund_scope = 'enterprise_seats'
      and r.status in ('manual_review', 'approved');
    if reserved_refund_quantity > current_available then
      raise exception 'ENTERPRISE_REFUND_RESERVATION_EXCEEDS_AVAILABLE';
    end if;
    available_to_expire := current_available - reserved_refund_quantity;
    if available_to_expire > 0 then
      select count(*)::bigint + 1 into expiry_batch
      from public.enterprise_seat_events e
      where e.seat_lot_id = lot_row.id
        and e.event_type = 'expired'
        and e.allocation_id is null;
      insert into public.enterprise_seat_events (
        seat_lot_id, organization_id, event_type, quantity, available_delta,
        idempotency_key, metadata
      ) values (
        lot_row.id, lot_row.organization_id, 'expired',
        available_to_expire, -available_to_expire,
        'enterprise-seat-lot:' || lot_row.id::text || ':expired-batch:' || expiry_batch::text,
        jsonb_build_object('expired_at', target_now)
      ) on conflict (idempotency_key) do nothing;
    end if;
    update public.enterprise_seat_lots
    set status = 'expired', updated_at = now()
    where id = lot_row.id;
    insert into public.audit_events (organization_id, action, target_type, target_id, after_data)
    values (
      lot_row.organization_id, 'enterprise.seat_lot_expired', 'enterprise_seat_lot',
      lot_row.id::text,
      jsonb_build_object(
        'available_quantity', available_to_expire,
        'reserved_refund_quantity', reserved_refund_quantity,
        'allocation_count', allocation_count,
        'expired_at', target_now
      )
    );

    seat_lot_id := lot_row.id;
    expired_available_quantity := available_to_expire;
    expired_allocation_count := allocation_count;
    return next;
  end loop;
end;
$$;

create or replace function public.expire_enterprise_seats()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare expired_count integer;
begin
  select count(*)::integer into expired_count
  from public.expire_enterprise_seat_lots(now());
  return expired_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-role-only RPC：企業部分退款與發票折讓待辦
-- ---------------------------------------------------------------------------

drop function if exists public.request_enterprise_refund(uuid, integer, text, uuid);
create or replace function public.request_enterprise_refund(
  target_order_id uuid,
  target_seat_quantity integer,
  target_reason text,
  target_actor_id uuid,
  target_request_idempotency_key uuid
)
returns public.refunds
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.orders%rowtype;
  lot_row public.enterprise_seat_lots%rowtype;
  refund_row public.refunds%rowtype;
  reserved_refund_quantity integer;
  normalized_reason text := btrim(target_reason);
begin
  if target_request_idempotency_key is null
    or target_seat_quantity is null
    or target_seat_quantity not between 1 and 10000
    or target_reason is null
    or length(normalized_reason) not between 5 and 500 then
    raise exception 'INVALID_ENTERPRISE_REFUND_REQUEST';
  end if;

  -- 同一 request key 先以 transaction advisory lock 序列化；即使兩個請求
  -- 指向不同訂單，也不會落入 partial unique index 的競態例外。
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_request_idempotency_key::text, 724052821)
  );

  select * into order_row
  from public.orders
  where id = target_order_id
  for update;
  if order_row.id is null or order_row.order_kind <> 'enterprise_seat_pack' then
    raise exception 'ENTERPRISE_ORDER_NOT_FOUND';
  end if;
  if not private.is_org_manager(order_row.organization_id, target_actor_id) then
    raise exception 'ENTERPRISE_MANAGER_REQUIRED';
  end if;

  select * into refund_row
  from public.refunds
  where request_idempotency_key = target_request_idempotency_key
    and refund_scope = 'enterprise_seats';
  if refund_row.id is not null then
    if refund_row.refund_scope <> 'enterprise_seats'
      or refund_row.order_id is distinct from order_row.id
      or refund_row.organization_id is distinct from order_row.organization_id
      or refund_row.requested_by is distinct from target_actor_id
      or refund_row.seat_quantity is distinct from target_seat_quantity
      or refund_row.reason is distinct from normalized_reason then
      raise exception 'ENTERPRISE_REFUND_IDEMPOTENCY_SNAPSHOT_MISMATCH';
    end if;

    select * into lot_row
    from public.enterprise_seat_lots
    where id = refund_row.seat_lot_id
    for update;
    select * into refund_row
    from public.refunds
    where id = refund_row.id
    for update;
    if lot_row.id is null
      or lot_row.source_order_id is distinct from order_row.id
      or refund_row.request_idempotency_key is distinct from target_request_idempotency_key
      or refund_row.refund_scope <> 'enterprise_seats'
      or refund_row.order_id is distinct from order_row.id
      or refund_row.organization_id is distinct from order_row.organization_id
      or refund_row.requested_by is distinct from target_actor_id
      or refund_row.seat_quantity is distinct from target_seat_quantity
      or refund_row.reason is distinct from normalized_reason
      or refund_row.unit_price_twd is distinct from lot_row.unit_price_twd
      or refund_row.amount_twd is distinct from target_seat_quantity * lot_row.unit_price_twd then
      raise exception 'ENTERPRISE_REFUND_IDEMPOTENCY_SNAPSHOT_MISMATCH';
    end if;
    return refund_row;
  end if;

  if order_row.status not in ('paid', 'partially_refunded') then
    raise exception 'ENTERPRISE_ORDER_NOT_REFUNDABLE';
  end if;
  select * into lot_row
  from public.enterprise_seat_lots
  where source_order_id = order_row.id
  for update;
  select coalesce(sum(r.seat_quantity), 0)::integer into reserved_refund_quantity
  from public.refunds r
  where r.seat_lot_id = lot_row.id
    and r.refund_scope = 'enterprise_seats'
    and r.status in ('manual_review', 'approved');
  if lot_row.id is null or lot_row.status <> 'active'
    or lot_row.available_quantity - reserved_refund_quantity < target_seat_quantity then
    raise exception 'INSUFFICIENT_UNUSED_ENTERPRISE_SEATS';
  end if;

  insert into public.refunds (
    order_id, requested_by, amount_twd, reason, status, automatic,
    organization_id, seat_lot_id, seat_quantity, approved_quantity,
    unit_price_twd, refund_scope, request_idempotency_key
  ) values (
    order_row.id, target_actor_id, target_seat_quantity * lot_row.unit_price_twd,
    normalized_reason, 'manual_review', false, order_row.organization_id,
    lot_row.id, target_seat_quantity, null, lot_row.unit_price_twd,
    'enterprise_seats', target_request_idempotency_key
  ) returning * into refund_row;
  insert into public.audit_events (actor_id, organization_id, action, target_type, target_id, after_data)
  values (
    target_actor_id, order_row.organization_id, 'enterprise.refund_requested',
    'refund', refund_row.id::text,
    jsonb_build_object(
      'seat_quantity', target_seat_quantity,
      'amount_twd', refund_row.amount_twd,
      'request_idempotency_key', target_request_idempotency_key
    )
  );
  return refund_row;
end;
$$;

create or replace function public.decide_enterprise_refund(
  target_refund_id uuid,
  target_actor_id uuid,
  target_decision text,
  target_reason text
)
returns public.refunds
language plpgsql
security definer
set search_path = ''
as $$
declare
  refund_row public.refunds%rowtype;
  order_row public.orders%rowtype;
  lot_row public.enterprise_seat_lots%rowtype;
  refund_order_id uuid;
  refund_lot_id uuid;
  normalized_reason text := btrim(target_reason);
  expected_approved_quantity integer;
begin
  if not exists (
    select 1 from auth.users u
    where u.id = target_actor_id
      and u.raw_app_meta_data ->> 'platform_role' = 'admin'
  ) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  if target_decision is null
    or target_decision not in ('approved', 'rejected')
    or target_reason is null
    or length(normalized_reason) not between 5 and 500 then
    raise exception 'INVALID_ENTERPRISE_REFUND_DECISION';
  end if;

  select r.order_id, r.seat_lot_id into refund_order_id, refund_lot_id
  from public.refunds r
  where r.id = target_refund_id
    and r.refund_scope = 'enterprise_seats';
  if refund_order_id is null or refund_lot_id is null then
    raise exception 'ENTERPRISE_REFUND_NOT_FOUND';
  end if;

  -- 與 request/apply 固定使用 order → lot → refund，狀態 CAS 與 audit
  -- 會在同一資料庫交易完成或一併回滾。
  select * into order_row
  from public.orders
  where id = refund_order_id
  for update;
  select * into lot_row
  from public.enterprise_seat_lots
  where id = refund_lot_id
  for update;
  select * into refund_row
  from public.refunds
  where id = target_refund_id
  for update;
  if order_row.id is null or lot_row.id is null or refund_row.id is null
    or refund_row.refund_scope <> 'enterprise_seats'
    or refund_row.order_id is distinct from order_row.id
    or refund_row.seat_lot_id is distinct from lot_row.id
    or refund_row.organization_id is distinct from order_row.organization_id
    or lot_row.source_order_id is distinct from order_row.id then
    raise exception 'ENTERPRISE_REFUND_CHANGED';
  end if;
  if refund_row.status <> 'manual_review' then
    raise exception 'ENTERPRISE_REFUND_ALREADY_DECIDED';
  end if;
  expected_approved_quantity := case
    when target_decision = 'approved' then refund_row.seat_quantity
    else 0
  end;

  insert into public.audit_events (
    actor_id, organization_id, action, target_type, target_id,
    before_data, after_data
  ) values (
    target_actor_id, refund_row.organization_id,
    'enterprise.refund_decision_requested', 'refund', refund_row.id::text,
    jsonb_build_object('status', refund_row.status),
    jsonb_build_object('decision', target_decision, 'reason', normalized_reason)
  );

  update public.refunds
  set status = target_decision,
      approved_quantity = expected_approved_quantity,
      decided_by = target_actor_id,
      decision_reason = normalized_reason,
      decided_at = now()
  where id = refund_row.id and status = 'manual_review'
  returning * into refund_row;
  if refund_row.id is null then
    raise exception 'ENTERPRISE_REFUND_ALREADY_DECIDED';
  end if;

  insert into public.audit_events (
    actor_id, organization_id, action, target_type, target_id,
    before_data, after_data
  ) values (
    target_actor_id, refund_row.organization_id,
    'enterprise.refund_' || target_decision, 'refund', refund_row.id::text,
    jsonb_build_object('status', 'manual_review'),
    jsonb_build_object(
      'status', target_decision,
      'reason', normalized_reason,
      'approved_quantity', refund_row.approved_quantity
    )
  );
  return refund_row;
end;
$$;

create or replace function public.apply_enterprise_refund(
  target_refund_id uuid,
  target_actor_id uuid,
  target_provider_refund_id text,
  target_decision_reason text
)
returns public.refunds
language plpgsql
security definer
set search_path = ''
as $$
declare
  refund_row public.refunds%rowtype;
  lot_row public.enterprise_seat_lots%rowtype;
  order_row public.orders%rowtype;
  original_invoice public.invoice_records%rowtype;
  allowance_record public.invoice_records%rowtype;
  total_refunded integer;
  refund_order_id uuid;
  refund_lot_id uuid;
begin
  if not exists (
    select 1 from auth.users u
    where u.id = target_actor_id and u.raw_app_meta_data ->> 'platform_role' = 'admin'
  ) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  if length(btrim(target_decision_reason)) < 5 then raise exception 'REFUND_DECISION_REASON_REQUIRED'; end if;
  if nullif(btrim(target_provider_refund_id), '') is null then
    raise exception 'PROVIDER_REFUND_ID_REQUIRED';
  end if;

  select r.order_id, r.seat_lot_id into refund_order_id, refund_lot_id
  from public.refunds r where r.id = target_refund_id;
  if refund_order_id is null or refund_lot_id is null then
    raise exception 'ENTERPRISE_REFUND_NOT_FOUND';
  end if;
  -- 所有退款流程固定依 order → lot → refund 取鎖，避免付款與退款互鎖。
  select * into order_row
  from public.orders
  where id = refund_order_id
  for update;
  select * into lot_row
  from public.enterprise_seat_lots
  where id = refund_lot_id
  for update;
  select * into refund_row
  from public.refunds
  where id = target_refund_id
  for update;
  if refund_row.id is null or refund_row.refund_scope <> 'enterprise_seats' then
    raise exception 'ENTERPRISE_REFUND_NOT_FOUND';
  end if;
  if refund_row.status = 'paid' then
    if refund_row.provider_refund_id is distinct from btrim(target_provider_refund_id) then
      raise exception 'REFUND_REPLAY_PROVIDER_MISMATCH';
    end if;
    return refund_row;
  end if;
  if refund_row.status <> 'approved' then
    raise exception 'ENTERPRISE_REFUND_NOT_APPLICABLE';
  end if;
  if refund_row.order_id <> order_row.id or refund_row.seat_lot_id <> lot_row.id then
    raise exception 'ENTERPRISE_REFUND_CHANGED';
  end if;
  if lot_row.available_quantity < refund_row.seat_quantity then
    raise exception 'INSUFFICIENT_UNUSED_ENTERPRISE_SEATS';
  end if;

  insert into public.enterprise_seat_events (
    seat_lot_id, organization_id, event_type, quantity, available_delta,
    idempotency_key, actor_id, metadata
  ) values (
    lot_row.id, lot_row.organization_id, 'refunded',
    refund_row.seat_quantity, -refund_row.seat_quantity,
    'enterprise-refund:' || refund_row.id::text, target_actor_id,
    jsonb_build_object('refund_id', refund_row.id)
  );
  update public.enterprise_seat_lots
  set status = case when total_quantity = 0 then 'refunded' else status end,
      updated_at = now()
  where id = lot_row.id;

  update public.refunds
  set status = 'paid', approved_quantity = seat_quantity,
      decided_by = target_actor_id, decision_reason = btrim(target_decision_reason),
      decided_at = now(), provider_refund_id = btrim(target_provider_refund_id),
      paid_at = now()
  where id = refund_row.id
  returning * into refund_row;

  select coalesce(sum(r.amount_twd), 0)::integer into total_refunded
  from public.refunds r
  where r.order_id = order_row.id and r.status = 'paid';
  update public.orders
  set status = case
        when total_refunded >= amount_twd then 'refunded'::public.order_status
        else 'partially_refunded'::public.order_status
      end,
      updated_at = now()
  where id = order_row.id;

  select * into original_invoice
  from public.invoice_records
  where order_id = order_row.id and record_type = 'invoice'
  for update;
  if original_invoice.id is not null then
    insert into public.invoice_records (
      organization_id, order_id, refund_id, parent_invoice_id, record_type,
      status, idempotency_key, allowance_status, allowance_amount_twd,
      allowance_expires_at,
      buyer_title, buyer_tax_id, buyer_email, amount_twd, details
    ) values (
      order_row.organization_id, order_row.id, refund_row.id, original_invoice.id,
      'allowance', 'failed', 'allowance:refund:' || refund_row.id::text,
      'failed', refund_row.amount_twd, null,
      original_invoice.buyer_title, original_invoice.buyer_tax_id,
      original_invoice.buyer_email, refund_row.amount_twd,
      jsonb_build_object('seat_quantity', refund_row.seat_quantity, 'unit_price_twd', refund_row.unit_price_twd)
    )
    on conflict (refund_id) where record_type = 'allowance' and refund_id is not null
    do nothing
    returning * into allowance_record;
    update public.refunds
    set invoice_record_id = coalesce(
      allowance_record.id,
      (select ir.id from public.invoice_records ir
       where ir.refund_id = refund_row.id and ir.record_type = 'allowance' limit 1)
    )
    where id = refund_row.id
    returning * into refund_row;
    if allowance_record.id is not null then
      update public.invoice_records
      set next_retry_at = now(),
          error_message = 'ALLOWANCE_ISSUANCE_QUEUED',
          updated_at = now()
      where id = allowance_record.id
      returning * into allowance_record;
      insert into public.audit_events (
        actor_id, organization_id, action, target_type, target_id, after_data
      ) values (
        target_actor_id, allowance_record.organization_id,
        'enterprise.allowance_queued', 'invoice_record', allowance_record.id::text,
        jsonb_build_object(
          'refund_id', refund_row.id,
          'allowance_amount_twd', allowance_record.allowance_amount_twd,
          'next_retry_at', allowance_record.next_retry_at
        )
      );
    end if;
  end if;

  insert into public.payment_events (
    provider_event_key, merchant_trade_no, event_type, verified, payload
  ) values (
    'enterprise-refund:' || refund_row.id::text,
    order_row.merchant_trade_no, 'refund_recorded', true,
    jsonb_build_object('refund_id', refund_row.id, 'amount_twd', refund_row.amount_twd)
  ) on conflict (provider_event_key) do nothing;
  insert into public.audit_events (actor_id, organization_id, action, target_type, target_id, after_data)
  values (
    target_actor_id, order_row.organization_id, 'enterprise.refund_applied',
    'refund', refund_row.id::text,
    jsonb_build_object('seat_quantity', refund_row.seat_quantity, 'amount_twd', refund_row.amount_twd)
  );
  return refund_row;
end;
$$;

-- 舊的兩參數版本無法強制金流商退款編號，明確移除避免繞過冪等驗證。
drop function if exists public.apply_enterprise_refund(uuid, uuid);

-- ---------------------------------------------------------------------------
-- Service-role-only RPC：折讓外部呼叫 claim / complete / fail outbox。
-- ---------------------------------------------------------------------------

create or replace function public.claim_enterprise_allowance(
  target_invoice_record_id uuid,
  target_actor_id uuid
)
returns public.invoice_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowance_row public.invoice_records%rowtype;
  parent_invoice_id uuid;
  claim_token uuid := gen_random_uuid();
begin
  if not exists (
    select 1 from auth.users u
    where u.id = target_actor_id and u.raw_app_meta_data ->> 'platform_role' = 'admin'
  ) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;

  select ir.parent_invoice_id into parent_invoice_id
  from public.invoice_records ir
  where ir.id = target_invoice_record_id and ir.record_type = 'allowance';
  if parent_invoice_id is null then raise exception 'ENTERPRISE_ALLOWANCE_NOT_FOUND'; end if;
  perform 1
  from public.invoice_records parent
  where parent.id = parent_invoice_id
    and parent.record_type = 'invoice'
    and parent.status = 'issued'
  for share;
  if not found then raise exception 'ISSUED_PARENT_INVOICE_REQUIRED'; end if;

  select * into allowance_row
  from public.invoice_records
  where id = target_invoice_record_id
  for update;
  if allowance_row.id is null
    or allowance_row.record_type <> 'allowance'
    or allowance_row.parent_invoice_id is distinct from parent_invoice_id
    or allowance_row.allowance_status not in ('none', 'failed')
    or allowance_row.allowance_manual_reconciliation_required
    or allowance_row.allowance_number is not null then
    raise exception 'ENTERPRISE_ALLOWANCE_NOT_CLAIMABLE';
  end if;
  if allowance_row.allowance_status = 'failed'
    and allowance_row.next_retry_at is not null
    and allowance_row.next_retry_at > now() then
    raise exception 'ENTERPRISE_ALLOWANCE_RETRY_NOT_DUE';
  end if;

  update public.invoice_records
  set status = 'pending',
      allowance_status = 'processing',
      allowance_claim_token = claim_token,
      allowance_claimed_at = now(),
      allowance_lease_expires_at = now() + interval '5 minutes',
      allowance_last_claim_token_hash = null,
      allowance_manual_reconciliation_required = false,
      attempt_count = attempt_count + 1,
      next_retry_at = null,
      error_message = null,
      updated_at = now()
  where id = allowance_row.id
  returning * into allowance_row;

  insert into public.audit_events (
    actor_id, organization_id, action, target_type, target_id, after_data
  ) values (
    target_actor_id, allowance_row.organization_id, 'enterprise.allowance_claimed',
    'invoice_record', allowance_row.id::text,
    jsonb_build_object(
      'attempt_count', allowance_row.attempt_count,
      'lease_expires_at', allowance_row.allowance_lease_expires_at
    )
  );
  return allowance_row;
end;
$$;

create or replace function public.complete_enterprise_allowance(
  target_invoice_record_id uuid,
  target_claim_token uuid,
  target_actor_id uuid,
  target_allowance_number text,
  target_allowance_expires_at timestamptz,
  target_provider_response jsonb
)
returns public.invoice_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowance_row public.invoice_records%rowtype;
  normalized_allowance_number text := btrim(target_allowance_number);
begin
  if not exists (
    select 1 from auth.users u
    where u.id = target_actor_id and u.raw_app_meta_data ->> 'platform_role' = 'admin'
  ) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  if target_claim_token is null or nullif(normalized_allowance_number, '') is null
    or target_allowance_expires_at is null or target_allowance_expires_at <= now() then
    raise exception 'INVALID_ENTERPRISE_ALLOWANCE_RESULT';
  end if;

  select * into allowance_row
  from public.invoice_records
  where id = target_invoice_record_id
  for update;
  if allowance_row.id is null or allowance_row.record_type <> 'allowance' then
    raise exception 'ENTERPRISE_ALLOWANCE_NOT_FOUND';
  end if;
  if allowance_row.allowance_status in ('pending_consent', 'issued')
    and allowance_row.allowance_number = normalized_allowance_number
    and allowance_row.allowance_last_claim_token_hash = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(target_claim_token::text, 'UTF8')),
      'hex'
    ) then
    return allowance_row;
  end if;
  if allowance_row.allowance_status <> 'processing'
    or allowance_row.allowance_claim_token is distinct from target_claim_token then
    raise exception 'ENTERPRISE_ALLOWANCE_CLAIM_MISMATCH';
  end if;

  update public.invoice_records
  set status = 'pending',
      allowance_status = 'pending_consent',
      allowance_number = normalized_allowance_number,
      allowance_expires_at = target_allowance_expires_at,
      allowance_last_claim_token_hash = pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(target_claim_token::text, 'UTF8')),
        'hex'
      ),
      allowance_claim_token = null,
      allowance_claimed_at = null,
      allowance_lease_expires_at = null,
      allowance_manual_reconciliation_required = false,
      provider_response = coalesce(target_provider_response, '{}'::jsonb),
      next_retry_at = null,
      error_message = null,
      updated_at = now()
  where id = allowance_row.id
  returning * into allowance_row;

  insert into public.audit_events (
    actor_id, organization_id, action, target_type, target_id, after_data
  ) values (
    target_actor_id, allowance_row.organization_id, 'enterprise.allowance_provider_accepted',
    'invoice_record', allowance_row.id::text,
    jsonb_build_object(
      'allowance_number', allowance_row.allowance_number,
      'allowance_expires_at', allowance_row.allowance_expires_at
    )
  );
  return allowance_row;
end;
$$;

create or replace function public.fail_enterprise_allowance(
  target_invoice_record_id uuid,
  target_claim_token uuid,
  target_actor_id uuid,
  target_error_message text,
  target_ambiguous boolean,
  target_provider_response jsonb
)
returns public.invoice_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowance_row public.invoice_records%rowtype;
  next_allowance_status text;
begin
  if not exists (
    select 1 from auth.users u
    where u.id = target_actor_id and u.raw_app_meta_data ->> 'platform_role' = 'admin'
  ) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  if target_claim_token is null or target_ambiguous is null
    or target_error_message is null or length(btrim(target_error_message)) < 3 then
    raise exception 'INVALID_ENTERPRISE_ALLOWANCE_FAILURE';
  end if;
  next_allowance_status := case when target_ambiguous then 'ambiguous' else 'failed' end;

  select * into allowance_row
  from public.invoice_records
  where id = target_invoice_record_id
  for update;
  if allowance_row.id is null or allowance_row.record_type <> 'allowance' then
    raise exception 'ENTERPRISE_ALLOWANCE_NOT_FOUND';
  end if;
  if allowance_row.allowance_status = next_allowance_status
    and allowance_row.allowance_last_claim_token_hash = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(target_claim_token::text, 'UTF8')),
      'hex'
    ) then
    return allowance_row;
  end if;
  if allowance_row.allowance_status <> 'processing'
    or allowance_row.allowance_claim_token is distinct from target_claim_token then
    raise exception 'ENTERPRISE_ALLOWANCE_CLAIM_MISMATCH';
  end if;

  update public.invoice_records
  set status = 'failed',
      allowance_status = next_allowance_status,
      allowance_last_claim_token_hash = pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(target_claim_token::text, 'UTF8')),
        'hex'
      ),
      allowance_claim_token = null,
      allowance_claimed_at = null,
      allowance_lease_expires_at = null,
      allowance_manual_reconciliation_required = target_ambiguous,
      provider_response = coalesce(target_provider_response, '{}'::jsonb),
      next_retry_at = case when target_ambiguous then null else now() + interval '5 minutes' end,
      error_message = left(btrim(target_error_message), 1000),
      updated_at = now()
  where id = allowance_row.id
  returning * into allowance_row;

  insert into public.audit_events (
    actor_id, organization_id, action, target_type, target_id, after_data
  ) values (
    target_actor_id, allowance_row.organization_id,
    case when target_ambiguous
      then 'enterprise.allowance_ambiguous'
      else 'enterprise.allowance_failed'
    end,
    'invoice_record', allowance_row.id::text,
    jsonb_build_object(
      'attempt_count', allowance_row.attempt_count,
      'manual_reconciliation_required', target_ambiguous,
      'error', allowance_row.error_message
    )
  );
  return allowance_row;
end;
$$;

create or replace function public.expire_enterprise_allowance_claims(
  target_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowance_row public.invoice_records%rowtype;
  expired_count integer := 0;
begin
  for allowance_row in
    select ir.*
    from public.invoice_records ir
    where ir.record_type = 'allowance'
      and ir.allowance_status = 'processing'
      and ir.allowance_lease_expires_at <= target_now
    order by ir.id
    for update skip locked
  loop
    update public.invoice_records
    set status = 'failed',
        allowance_status = 'ambiguous',
        allowance_last_claim_token_hash = pg_catalog.encode(
          pg_catalog.sha256(pg_catalog.convert_to(allowance_row.allowance_claim_token::text, 'UTF8')),
          'hex'
        ),
        allowance_claim_token = null,
        allowance_claimed_at = null,
        allowance_lease_expires_at = null,
        allowance_manual_reconciliation_required = true,
        next_retry_at = null,
        error_message = 'ALLOWANCE_CLAIM_LEASE_EXPIRED',
        updated_at = now()
    where id = allowance_row.id;
    insert into public.audit_events (
      organization_id, action, target_type, target_id, after_data
    ) values (
      allowance_row.organization_id, 'enterprise.allowance_claim_expired_ambiguous',
      'invoice_record', allowance_row.id::text,
      jsonb_build_object('lease_expired_at', allowance_row.allowance_lease_expires_at)
    );
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$;

create or replace function public.reconcile_enterprise_allowance(
  target_invoice_record_id uuid,
  target_actor_id uuid,
  target_outcome text,
  target_reason text,
  target_invoice_number text,
  target_allowance_number text,
  target_allowance_at timestamptz,
  target_remaining_allowance_twd integer,
  target_provider_response jsonb
)
returns public.invoice_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowance_row public.invoice_records%rowtype;
  parent_row public.invoice_records%rowtype;
  parent_id uuid;
  issued_sibling_total integer;
  expected_remaining integer;
  reconciled_remaining integer;
  normalized_invoice_number text := nullif(btrim(target_invoice_number), '');
  normalized_allowance_number text := nullif(btrim(target_allowance_number), '');
begin
  if not exists (
    select 1 from auth.users u
    where u.id = target_actor_id and u.raw_app_meta_data ->> 'platform_role' = 'admin'
  ) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  if target_outcome not in ('confirmed_not_issued', 'confirmed_issued')
    or target_reason is null or length(btrim(target_reason)) < 5
    or target_provider_response is null
    or pg_catalog.jsonb_typeof(target_provider_response) <> 'object'
    or target_provider_response = '{}'::jsonb then
    raise exception 'INVALID_ENTERPRISE_ALLOWANCE_RECONCILIATION';
  end if;
  if target_outcome = 'confirmed_issued' and (
    normalized_invoice_number is null
    or normalized_allowance_number is null
    or target_allowance_at is null
    or target_remaining_allowance_twd is null
    or target_remaining_allowance_twd < 0
  ) then raise exception 'INVALID_CONFIRMED_ALLOWANCE_RESULT'; end if;
  if target_outcome = 'confirmed_not_issued' and (
    normalized_allowance_number is not null
    or target_allowance_at is not null
    or (
      target_remaining_allowance_twd is not null
      and target_remaining_allowance_twd < 0
    )
  ) then raise exception 'INVALID_NOT_ISSUED_ALLOWANCE_RESULT'; end if;

  select ir.parent_invoice_id into parent_id
  from public.invoice_records ir
  where ir.id = target_invoice_record_id and ir.record_type = 'allowance';
  if parent_id is null then raise exception 'ENTERPRISE_ALLOWANCE_NOT_FOUND'; end if;
  -- 同一發票的多筆折讓一律 parent → allowance 取鎖，並串行驗證剩餘額度。
  select * into parent_row
  from public.invoice_records
  where id = parent_id
  for update;
  select * into allowance_row
  from public.invoice_records
  where id = target_invoice_record_id
  for update;
  if parent_row.id is null or parent_row.record_type <> 'invoice'
    or parent_row.status <> 'issued'
    or (
      normalized_invoice_number is not null
      and parent_row.invoice_number is distinct from normalized_invoice_number
    )
    or allowance_row.id is null or allowance_row.record_type <> 'allowance'
    or allowance_row.parent_invoice_id is distinct from parent_row.id then
    raise exception 'ENTERPRISE_ALLOWANCE_PARENT_MISMATCH';
  end if;
  normalized_invoice_number := parent_row.invoice_number;

  -- 已完成的人工「確認已折讓」重送，僅核對當時保存的不可變事實後返回。
  -- 先於 sibling 總額重算，避免較晚折讓使較早的冪等重送失敗。
  if target_outcome = 'confirmed_issued' then
    if target_allowance_at > now() + interval '5 minutes'
      or (target_allowance_at at time zone 'Asia/Taipei')::date < parent_row.invoice_date then
      raise exception 'INVALID_CONFIRMED_ALLOWANCE_RESULT';
    end if;
    if allowance_row.allowance_status = 'issued' then
      if allowance_row.status <> 'allowance_issued'
        or allowance_row.allowance_reconciliation_outcome is distinct from 'confirmed_issued'
        or allowance_row.allowance_number is distinct from normalized_allowance_number
        or allowance_row.allowance_date is distinct from
          (target_allowance_at at time zone 'Asia/Taipei')::date
        or allowance_row.allowance_at is distinct from target_allowance_at
        or allowance_row.remaining_allowance_twd is distinct from target_remaining_allowance_twd then
        raise exception 'ENTERPRISE_ALLOWANCE_RECONCILIATION_MISMATCH';
      end if;
      return allowance_row;
    end if;
  end if;

  select coalesce(sum(ir.allowance_amount_twd), 0)::integer into issued_sibling_total
  from public.invoice_records ir
  where ir.parent_invoice_id = parent_row.id
    and ir.record_type = 'allowance'
    and ir.id <> allowance_row.id
    and ir.allowance_status = 'issued';

  if target_outcome = 'confirmed_not_issued' then
    expected_remaining := parent_row.amount_twd - issued_sibling_total;
    reconciled_remaining := expected_remaining;
    if (
      target_remaining_allowance_twd is not null
      and target_remaining_allowance_twd <> expected_remaining
    )
      or not (
        (
          allowance_row.allowance_status = 'ambiguous'
          and allowance_row.allowance_manual_reconciliation_required
        ) or (
          allowance_row.allowance_status = 'pending_consent'
          and allowance_row.allowance_expires_at is not null
          and allowance_row.allowance_expires_at <= now()
        ) or (
          allowance_row.allowance_status = 'failed'
          and allowance_row.allowance_reconciliation_outcome = 'confirmed_not_issued'
        )
      ) then
      raise exception 'ENTERPRISE_ALLOWANCE_NOT_RECONCILABLE_AS_NOT_ISSUED';
    end if;
    if allowance_row.allowance_status = 'failed'
      and allowance_row.allowance_reconciliation_outcome = 'confirmed_not_issued' then
      return allowance_row;
    end if;

    update public.invoice_records
    set status = 'failed',
        allowance_status = 'failed',
        allowance_number = null,
        allowance_expires_at = null,
        allowance_claim_token = null,
        allowance_claimed_at = null,
        allowance_lease_expires_at = null,
        allowance_manual_reconciliation_required = false,
        remaining_allowance_twd = expected_remaining,
        allowance_reconciliation_outcome = 'confirmed_not_issued',
        allowance_reconciled_at = now(),
        allowance_reconciled_by = target_actor_id,
        allowance_reconciliation_reason = btrim(target_reason),
        provider_response = target_provider_response,
        next_retry_at = now(),
        error_message = 'PROVIDER_CONFIRMED_NOT_ISSUED',
        updated_at = now()
    where id = allowance_row.id
    returning * into allowance_row;
  else
    expected_remaining := parent_row.amount_twd
      - issued_sibling_total - allowance_row.allowance_amount_twd;
    reconciled_remaining := target_remaining_allowance_twd;
    if expected_remaining < 0 or target_remaining_allowance_twd <> expected_remaining then
      raise exception 'ENTERPRISE_ALLOWANCE_REMAINING_AMOUNT_MISMATCH';
    end if;
    if not (
      (
        allowance_row.allowance_status = 'ambiguous'
        and allowance_row.allowance_manual_reconciliation_required
      ) or allowance_row.allowance_status = 'pending_consent'
    ) then raise exception 'ENTERPRISE_ALLOWANCE_NOT_RECONCILABLE_AS_ISSUED'; end if;
    if allowance_row.allowance_number is not null
      and allowance_row.allowance_number <> normalized_allowance_number then
      raise exception 'ENTERPRISE_ALLOWANCE_NUMBER_MISMATCH';
    end if;

    update public.invoice_records
    set status = 'allowance_issued',
        allowance_status = 'issued',
        allowance_number = normalized_allowance_number,
        allowance_date = (target_allowance_at at time zone 'Asia/Taipei')::date,
        allowance_at = target_allowance_at,
        remaining_allowance_twd = target_remaining_allowance_twd,
        allowance_claim_token = null,
        allowance_claimed_at = null,
        allowance_lease_expires_at = null,
        allowance_manual_reconciliation_required = false,
        allowance_reconciliation_outcome = 'confirmed_issued',
        allowance_reconciled_at = now(),
        allowance_reconciled_by = target_actor_id,
        allowance_reconciliation_reason = btrim(target_reason),
        provider_response = target_provider_response,
        next_retry_at = null,
        error_message = null,
        updated_at = now()
    where id = allowance_row.id
    returning * into allowance_row;
  end if;

  insert into public.audit_events (
    actor_id, organization_id, action, target_type, target_id, after_data
  ) values (
    target_actor_id, allowance_row.organization_id, 'enterprise.allowance_reconciled',
    'invoice_record', allowance_row.id::text,
    jsonb_build_object(
      'outcome', target_outcome,
      'reason', btrim(target_reason),
      'invoice_number', normalized_invoice_number,
      'allowance_number', allowance_row.allowance_number,
      'remaining_allowance_twd', reconciled_remaining,
      'issued_sibling_total_twd', issued_sibling_total
    )
  );
  return allowance_row;
end;
$$;

-- 已通過綠界 CheckMacValue 的 callback 才可呼叫；資料庫仍會重新驗證
-- parent、折讓號碼、本地日期與剩餘金額，並把狀態與 audit 原子寫入。
create or replace function public.apply_verified_enterprise_allowance_callback(
  target_invoice_record_id uuid,
  target_invoice_number text,
  target_allowance_number text,
  target_allowance_at timestamptz,
  target_allowance_local_date date,
  target_remaining_allowance_twd integer,
  target_provider_response jsonb
)
returns public.invoice_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowance_row public.invoice_records%rowtype;
  parent_row public.invoice_records%rowtype;
  parent_id uuid;
  issued_sibling_total integer;
  expected_remaining integer;
  normalized_invoice_number text := upper(btrim(target_invoice_number));
  normalized_allowance_number text := btrim(target_allowance_number);
  previous_allowance_status text;
begin
  if target_invoice_record_id is null
    or target_invoice_number is null
    or target_allowance_number is null
    or normalized_invoice_number !~ '^[A-Z]{2}[0-9]{8}$'
    or normalized_allowance_number !~ '^[0-9]{16}$'
    or target_allowance_at is null
    or target_allowance_local_date is null
    or target_remaining_allowance_twd is null
    or target_remaining_allowance_twd < 0
    or target_provider_response is null
    or pg_catalog.jsonb_typeof(target_provider_response) <> 'object'
    or target_provider_response = '{}'::jsonb then
    raise exception 'INVALID_ENTERPRISE_ALLOWANCE_CALLBACK';
  end if;
  if target_allowance_at > now() + interval '5 minutes'
    or (target_allowance_at at time zone 'Asia/Taipei')::date
      is distinct from target_allowance_local_date then
    raise exception 'INVALID_ENTERPRISE_ALLOWANCE_CALLBACK_DATE';
  end if;

  select ir.parent_invoice_id into parent_id
  from public.invoice_records ir
  where ir.id = target_invoice_record_id
    and ir.record_type = 'allowance';
  if parent_id is null then raise exception 'ENTERPRISE_ALLOWANCE_NOT_FOUND'; end if;

  -- 同一 parent 的 callback 依 parent → 全部 allowance UUID 排序取鎖；
  -- sibling 剩餘額計算與狀態轉移因此不會互相超扣。
  select * into parent_row
  from public.invoice_records
  where id = parent_id
  for update;
  perform 1
  from public.invoice_records ir
  where ir.parent_invoice_id = parent_id
    and ir.record_type = 'allowance'
  order by ir.id
  for update;
  select * into allowance_row
  from public.invoice_records
  where id = target_invoice_record_id
  for update;

  if parent_row.id is null
    or parent_row.record_type <> 'invoice'
    or parent_row.status <> 'issued'
    or parent_row.invoice_number is distinct from normalized_invoice_number
    or parent_row.invoice_date is null
    or target_allowance_local_date < parent_row.invoice_date
    or allowance_row.id is null
    or allowance_row.record_type <> 'allowance'
    or allowance_row.parent_invoice_id is distinct from parent_row.id
    or allowance_row.order_id is distinct from parent_row.order_id
    or allowance_row.organization_id is distinct from parent_row.organization_id
    or allowance_row.refund_id is null then
    raise exception 'ENTERPRISE_ALLOWANCE_CALLBACK_PARENT_MISMATCH';
  end if;
  if allowance_row.allowance_number is not null
    and allowance_row.allowance_number <> normalized_allowance_number then
    raise exception 'ENTERPRISE_ALLOWANCE_CALLBACK_NUMBER_MISMATCH';
  end if;

  -- 已發出的折讓以當時保存的 provider 事實做冪等驗證。必須在重算目前
  -- sibling 總額之前返回；否則之後新發出的折讓會讓舊 callback 重送誤判。
  if allowance_row.allowance_status = 'issued' then
    if allowance_row.status <> 'allowance_issued'
      or allowance_row.allowance_number is distinct from normalized_allowance_number
      or allowance_row.allowance_date is distinct from target_allowance_local_date
      or allowance_row.allowance_at is distinct from target_allowance_at
      or allowance_row.remaining_allowance_twd is distinct from target_remaining_allowance_twd then
      raise exception 'ENTERPRISE_ALLOWANCE_CALLBACK_REPLAY_MISMATCH';
    end if;
    return allowance_row;
  end if;
  if allowance_row.status <> 'pending'
    or allowance_row.allowance_status <> 'pending_consent'
    or allowance_row.allowance_number is distinct from normalized_allowance_number then
    raise exception 'ENTERPRISE_ALLOWANCE_CALLBACK_STATE_MISMATCH';
  end if;
  if allowance_row.allowance_reconciliation_outcome is not null then
    raise exception 'ENTERPRISE_ALLOWANCE_CALLBACK_RECONCILIATION_CONFLICT';
  end if;

  select coalesce(sum(ir.allowance_amount_twd), 0)::integer
  into issued_sibling_total
  from public.invoice_records ir
  where ir.parent_invoice_id = parent_row.id
    and ir.record_type = 'allowance'
    and ir.id <> allowance_row.id
    and ir.allowance_status = 'issued';
  expected_remaining := parent_row.amount_twd
    - issued_sibling_total - allowance_row.allowance_amount_twd;
  if expected_remaining < 0
    or target_remaining_allowance_twd <> expected_remaining then
    raise exception 'ENTERPRISE_ALLOWANCE_CALLBACK_AMOUNT_MISMATCH';
  end if;

  previous_allowance_status := allowance_row.allowance_status;
  update public.invoice_records
  set status = 'allowance_issued',
      allowance_status = 'issued',
      allowance_number = normalized_allowance_number,
      allowance_date = target_allowance_local_date,
      allowance_at = target_allowance_at,
      allowance_expires_at = null,
      allowance_last_claim_token_hash = case
        when allowance_claim_token is not null then pg_catalog.encode(
          pg_catalog.sha256(
            pg_catalog.convert_to(allowance_claim_token::text, 'UTF8')
          ),
          'hex'
        )
        else allowance_last_claim_token_hash
      end,
      allowance_claim_token = null,
      allowance_claimed_at = null,
      allowance_lease_expires_at = null,
      allowance_manual_reconciliation_required = false,
      remaining_allowance_twd = target_remaining_allowance_twd,
      provider_response = target_provider_response,
      next_retry_at = null,
      error_message = null,
      updated_at = now()
  where id = allowance_row.id
    and allowance_status <> 'issued'
  returning * into allowance_row;
  if allowance_row.id is null then
    raise exception 'ENTERPRISE_ALLOWANCE_CALLBACK_STATE_CHANGED';
  end if;

  insert into public.audit_events (
    organization_id, action, target_type, target_id, before_data, after_data
  ) values (
    allowance_row.organization_id,
    'enterprise.invoice_allowance_issued',
    'invoice_record', allowance_row.id::text,
    jsonb_build_object('allowance_status', previous_allowance_status),
    jsonb_build_object(
      'refund_id', allowance_row.refund_id,
      'invoice_number', normalized_invoice_number,
      'allowance_number', normalized_allowance_number,
      'allowance_date', target_allowance_local_date,
      'remaining_amount_twd', target_remaining_allowance_twd,
      'verified_callback', true,
      'issued_sibling_total_twd', issued_sibling_total
    )
  );
  return allowance_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-role-only RPC：企業結帳快照與唯一 order_item 在同一交易建立。
-- ---------------------------------------------------------------------------

create or replace function public.create_enterprise_checkout_order(
  target_buyer_id uuid,
  target_organization_id uuid,
  target_course_id uuid,
  target_quantity integer,
  target_pricing_tier_id uuid,
  target_invoice_title text,
  target_invoice_tax_id text,
  target_invoice_email text,
  target_checkout_idempotency_key text,
  target_merchant_trade_no text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization_row public.organizations%rowtype;
  course_row public.courses%rowtype;
  tier_row public.course_price_tiers%rowtype;
  order_row public.orders%rowtype;
  item_row public.order_items%rowtype;
  item_count integer;
  expected_amount bigint;
  normalized_email text := lower(btrim(target_invoice_email));
  normalized_tax_id text := btrim(target_invoice_tax_id);
  normalized_idempotency_key text := btrim(target_checkout_idempotency_key);
  normalized_trade_no text := btrim(target_merchant_trade_no);
begin
  if not private.is_org_manager(target_organization_id, target_buyer_id) then
    raise exception 'ENTERPRISE_MANAGER_REQUIRED';
  end if;
  if target_invoice_title is null
    or normalized_email is null
    or normalized_idempotency_key is null
    or normalized_trade_no is null
    or length(btrim(target_invoice_title)) not between 2 and 60
    or normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(normalized_email) > 80
    or normalized_idempotency_key = ''
    or normalized_trade_no = '' then
    raise exception 'INVALID_ENTERPRISE_CHECKOUT';
  end if;
  if target_quantity is null or target_quantity not between 1 and 1000 then
    raise exception 'INVALID_ENTERPRISE_QUANTITY';
  end if;

  -- 已建立的同一冪等鍵只核對不可變快照；不再要求級距目前仍在生效期。
  select * into order_row
  from public.orders
  where checkout_idempotency_key = normalized_idempotency_key
  for update;
  if order_row.id is not null then
    select count(*)::integer into item_count
    from public.order_items
    where order_id = order_row.id;
    if item_count <> 1 then raise exception 'IDEMPOTENCY_ORDER_INCOMPLETE'; end if;
    select * into item_row from public.order_items where order_id = order_row.id;
    if order_row.buyer_id <> target_buyer_id
      or order_row.organization_id is distinct from target_organization_id
      or order_row.order_kind <> 'enterprise_seat_pack'
      or order_row.payment_provider <> 'ecpay'
      or order_row.pricing_tier_id is distinct from target_pricing_tier_id
      or order_row.invoice_title is distinct from btrim(target_invoice_title)
      or order_row.invoice_tax_id is distinct from normalized_tax_id
      or order_row.invoice_email is distinct from normalized_email
      or item_row.course_id is distinct from target_course_id
      or item_row.item_type <> 'seat_pack'
      or item_row.quantity <> target_quantity
      or item_row.pricing_tier_id is distinct from target_pricing_tier_id
      or item_row.tier_min_quantity_snapshot is null
      or order_row.amount_twd is distinct from item_row.line_total_twd then
      raise exception 'IDEMPOTENCY_SNAPSHOT_MISMATCH';
    end if;
    return order_row;
  end if;

  select * into organization_row
  from public.organizations
  where id = target_organization_id
  for key share;
  if organization_row.id is null or organization_row.status <> 'approved' or not organization_row.active then
    raise exception 'ORGANIZATION_NOT_ACTIVE';
  end if;
  if organization_row.tax_id is distinct from normalized_tax_id then
    raise exception 'INVOICE_TAX_ID_MISMATCH';
  end if;
  select * into course_row
  from public.courses
  where id = target_course_id
  for key share;
  if course_row.id is null or course_row.status <> 'published'
    or course_row.delivery not in ('recorded', 'live') then
    raise exception 'COURSE_NOT_FOR_ENTERPRISE';
  end if;

  select * into tier_row
  from public.course_price_tiers
  where id = target_pricing_tier_id
  for key share;
  if tier_row.id is null or tier_row.course_id <> target_course_id
    or not tier_row.active or tier_row.effective_at > now()
    or (tier_row.expires_at is not null and tier_row.expires_at <= now())
    or target_quantity < tier_row.min_quantity
    or (tier_row.max_quantity is not null and target_quantity > tier_row.max_quantity) then
    raise exception 'ENTERPRISE_PRICE_TIER_INVALID';
  end if;
  expected_amount := tier_row.unit_price_twd::bigint * target_quantity::bigint;
  if expected_amount > 5000000 then raise exception 'ENTERPRISE_ORDER_AMOUNT_TOO_HIGH'; end if;

  insert into public.orders (
    buyer_id, organization_id, merchant_trade_no, checkout_idempotency_key,
    status, amount_twd, payment_provider, order_kind,
    invoice_title, invoice_tax_id, invoice_email, pricing_tier_id
  ) values (
    target_buyer_id, target_organization_id, normalized_trade_no,
    normalized_idempotency_key, 'pending', expected_amount::integer, 'ecpay',
    'enterprise_seat_pack', btrim(target_invoice_title), normalized_tax_id,
    normalized_email, tier_row.id
  )
  on conflict (checkout_idempotency_key) do nothing
  returning * into order_row;

  if order_row.id is not null then
    insert into public.order_items (
      order_id, course_id, item_type, quantity, unit_price_twd
    ) values (
      order_row.id, target_course_id, 'seat_pack', target_quantity,
      tier_row.unit_price_twd
    ) returning * into item_row;
    insert into public.audit_events (
      actor_id, organization_id, action, target_type, target_id, after_data
    ) values (
      target_buyer_id, target_organization_id, 'enterprise.checkout_created',
      'order', order_row.id::text,
      jsonb_build_object(
        'course_id', target_course_id, 'quantity', target_quantity,
        'unit_price_twd', tier_row.unit_price_twd,
        'amount_twd', expected_amount, 'pricing_tier_id', tier_row.id
      )
    );
    return order_row;
  end if;

  -- 唯一鍵衝突會等待另一交易完成；重新取鎖後只接受完全相同的快照。
  select * into order_row
  from public.orders
  where checkout_idempotency_key = normalized_idempotency_key
  for update;
  if order_row.id is null then raise exception 'ENTERPRISE_ORDER_IDEMPOTENCY_CONFLICT'; end if;
  select count(*)::integer into item_count
  from public.order_items
  where order_id = order_row.id;
  if item_count <> 1 then raise exception 'IDEMPOTENCY_ORDER_INCOMPLETE'; end if;
  select * into item_row
  from public.order_items
  where order_id = order_row.id;
  if order_row.buyer_id <> target_buyer_id
    or order_row.organization_id is distinct from target_organization_id
    or order_row.order_kind <> 'enterprise_seat_pack'
    or order_row.payment_provider <> 'ecpay'
    or order_row.pricing_tier_id is distinct from target_pricing_tier_id
    or order_row.invoice_title is distinct from btrim(target_invoice_title)
    or order_row.invoice_tax_id is distinct from normalized_tax_id
    or order_row.invoice_email is distinct from normalized_email
    or item_row.course_id is distinct from target_course_id
    or item_row.item_type <> 'seat_pack'
    or item_row.quantity <> target_quantity
    or item_row.pricing_tier_id is distinct from target_pricing_tier_id
    or item_row.tier_min_quantity_snapshot is null
    or order_row.amount_twd is distinct from item_row.line_total_twd then
    raise exception 'IDEMPOTENCY_SNAPSHOT_MISMATCH';
  end if;
  return order_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 綠界付款確認：個人課程維持第三階段邏輯；企業 seat_pack 原子建立 lot、ledger 與發票待辦。
-- ---------------------------------------------------------------------------

create or replace function public.apply_ecpay_paid_order(
  target_trade_no text,
  target_provider_trade_no text,
  target_payment_type text,
  target_message text,
  target_event_key text,
  target_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_order public.orders%rowtype;
  target_item public.order_items%rowtype;
  target_tier public.course_price_tiers%rowtype;
  target_course_id uuid;
  target_live_session_id uuid;
  target_booking public.live_session_bookings%rowtype;
  target_enrollment_id uuid;
  target_enrollment_status public.enrollment_status;
  target_lot public.enterprise_seat_lots%rowtype;
  fulfillment_exception_reason text;
  item_count integer;
begin
  if nullif(btrim(target_trade_no), '') is null
    or nullif(btrim(target_provider_trade_no), '') is null
    or nullif(btrim(target_event_key), '') is null then
    raise exception 'INVALID_PAYMENT_CONFIRMATION_IDENTIFIERS';
  end if;
  insert into public.payment_events (provider_event_key, merchant_trade_no, event_type, verified, payload)
  values (target_event_key, target_trade_no, 'callback_received', true, target_payload)
  on conflict (provider_event_key) do nothing;
  if not exists (
    select 1 from public.payment_events pe
    where pe.provider_event_key = target_event_key
      and pe.merchant_trade_no = target_trade_no
      and pe.event_type = 'callback_received'
      and pe.verified
  ) then raise exception 'PAYMENT_EVENT_KEY_CONFLICT'; end if;

  select * into target_order
  from public.orders
  where merchant_trade_no = target_trade_no
  for update;
  if target_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if target_order.status in ('paid', 'partially_refunded', 'refunded') then
    if target_order.provider_trade_no is distinct from btrim(target_provider_trade_no) then
      raise exception 'PAYMENT_REPLAY_PROVIDER_MISMATCH';
    end if;
    return target_order.id;
  end if;
  if target_order.status <> 'pending' then raise exception 'ORDER_NOT_PAYABLE'; end if;

  select count(*)::integer into item_count
  from public.order_items where order_id = target_order.id;
  if item_count <> 1 then raise exception 'ORDER_REQUIRES_EXACTLY_ONE_ITEM'; end if;
  select * into target_item
  from public.order_items
  where order_id = target_order.id
  for update;

  if target_order.order_kind = 'enterprise_seat_pack' then
    if target_item.item_type <> 'seat_pack'
      or target_order.organization_id is null
      or target_item.course_id is null
      or target_order.pricing_tier_id is null
      or target_item.pricing_tier_id is distinct from target_order.pricing_tier_id then
      raise exception 'INVALID_ENTERPRISE_ORDER';
    end if;
    -- 購買資格已由原子 checkout RPC 寫入快照前驗證。付款後才被降權或停權
    -- 不可讓已扣款回調無法入帳；停權機構仍會由名額操作 RPC 的 active 檢查阻擋使用。
    if target_order.invoice_title is null or target_order.invoice_tax_id is null
      or target_order.invoice_email is null then
      raise exception 'ENTERPRISE_INVOICE_SNAPSHOT_REQUIRED';
    end if;

    select * into target_tier
    from public.course_price_tiers
    where id = target_order.pricing_tier_id
    for share;
    if target_tier.id is null
      or target_tier.course_id <> target_item.course_id
      or target_item.tier_min_quantity_snapshot is null
      or target_item.quantity < target_item.tier_min_quantity_snapshot
      or (
        target_item.tier_max_quantity_snapshot is not null
        and target_item.quantity > target_item.tier_max_quantity_snapshot
      )
      or target_order.amount_twd <> target_item.line_total_twd
      or target_item.pricing_tier_id is distinct from target_tier.id then
      raise exception 'ENTERPRISE_PRICE_SNAPSHOT_INVALID';
    end if;

    update public.orders
    set status = 'paid', paid_at = now(), provider_trade_no = btrim(target_provider_trade_no),
        payment_type = target_payment_type, payment_message = target_message
    where id = target_order.id;

    insert into public.enterprise_seat_lots (
      organization_id, course_id, source_order_id, order_item_id, pricing_tier_id,
      purchased_quantity, total_quantity, available_quantity, unit_price_twd,
      purchased_at, valid_until, status
    ) values (
      target_order.organization_id, target_item.course_id, target_order.id, target_item.id,
      target_order.pricing_tier_id, target_item.quantity, target_item.quantity, 0,
      target_item.unit_price_twd, now(),
      now() + make_interval(days => target_item.seat_valid_days_snapshot), 'active'
    ) returning * into target_lot;
    insert into public.enterprise_seat_events (
      seat_lot_id, organization_id, event_type, quantity, available_delta,
      idempotency_key, actor_id, metadata
    ) values (
      target_lot.id, target_lot.organization_id, 'available',
      target_item.quantity, target_item.quantity,
      target_event_key || ':enterprise-seat-lot', target_order.buyer_id,
      jsonb_build_object('order_id', target_order.id, 'course_id', target_item.course_id)
    );
    insert into public.invoice_records (
      organization_id, order_id, record_type, status, idempotency_key,
      buyer_title, buyer_tax_id, buyer_email, amount_twd, details
    ) values (
      target_order.organization_id, target_order.id, 'invoice', 'pending',
      'invoice:order:' || target_order.id::text,
      target_order.invoice_title, target_order.invoice_tax_id,
      lower(target_order.invoice_email), target_order.amount_twd,
      jsonb_build_object(
        'course_id', target_item.course_id,
        'quantity', target_item.quantity,
        'unit_price_twd', target_item.unit_price_twd,
        'pricing_tier_id', target_order.pricing_tier_id
      )
    );
  else
    if target_item.item_type <> 'course' or target_item.course_id is null then
      raise exception 'COURSE_ITEM_NOT_FOUND';
    end if;
    target_course_id := target_item.course_id;
    target_live_session_id := target_item.live_session_id;
    if target_order.amount_twd <> target_item.line_total_twd then
      raise exception 'ORDER_AMOUNT_MISMATCH';
    end if;

    -- 金流已扣款的 verified callback 必須先入帳；直播狀態與 hold 逾時改走履約異常。
    update public.orders
    set status = 'paid', paid_at = now(), provider_trade_no = btrim(target_provider_trade_no),
        payment_type = target_payment_type, payment_message = target_message
    where id = target_order.id;

    -- 先將已驗證付款入帳，再與企業指派共用 learner row lock做履約。
    -- 若企業權限先完成，保留 paid 並改寫履約異常，不重複開權。
    perform 1
    from auth.users u
    where u.id = target_order.buyer_id
    for update;
    if not found then fulfillment_exception_reason := 'BUYER_NOT_FOUND'; end if;

    if target_live_session_id is not null then
      perform 1
      from public.live_sessions
      where id = target_live_session_id
      for update;
      if not exists (
        select 1 from public.live_sessions
        where id = target_live_session_id and status = 'open'
      ) then fulfillment_exception_reason := 'LIVE_SESSION_NOT_OPEN'; end if;
      select * into target_booking
      from public.live_session_bookings
      where source_order_id = target_order.id and live_session_id = target_live_session_id
      for update;
      if target_booking.id is null or target_booking.status <> 'held'
        or target_booking.held_until <= now() then
        fulfillment_exception_reason := coalesce(
          fulfillment_exception_reason,
          'LIVE_SEAT_HOLD_EXPIRED'
        );
      end if;
    end if;

    if target_live_session_id is null and exists (
      select 1 from public.entitlements e
      where e.user_id = target_order.buyer_id
        and e.course_id = target_course_id
        and e.live_session_id is null
        and e.active
    ) then
      fulfillment_exception_reason := 'ALREADY_ENTITLED';
    elsif target_live_session_id is not null and (
      exists (
        select 1 from public.entitlements e
        where e.user_id = target_order.buyer_id
          and e.live_session_id = target_live_session_id
          and e.active
      ) or exists (
        select 1 from public.live_session_bookings b
        where b.learner_id = target_order.buyer_id
          and b.live_session_id = target_live_session_id
          and b.status in ('held', 'confirmed')
          and b.id is distinct from target_booking.id
      )
    ) then
      fulfillment_exception_reason := 'ALREADY_ENTITLED';
    end if;

    if fulfillment_exception_reason is null then
      insert into public.entitlements (user_id, course_id, live_session_id, source_order_id, active)
      values (target_order.buyer_id, target_course_id, target_live_session_id, target_order.id, true)
      on conflict do nothing;
      insert into public.enrollments (learner_id, course_id, live_session_id, status, started_at)
      values (target_order.buyer_id, target_course_id, target_live_session_id, 'active', now())
      on conflict do nothing
      returning id into target_enrollment_id;
      if target_enrollment_id is null then
        select id, status into target_enrollment_id, target_enrollment_status
        from public.enrollments
        where learner_id = target_order.buyer_id
          and course_id = target_course_id
          and live_session_id is not distinct from target_live_session_id
          and organization_id is null
        limit 1
        for update;

        if target_enrollment_id is null then
          raise exception 'INDIVIDUAL_ENROLLMENT_CONFLICT_NOT_FOUND';
        end if;

        -- 個人退款保留 enrollment、原始事件、測驗 attempt 與 revoked 證明做稽核。
        -- 重購只重置目前修課狀態與可變彙總；舊 attempt 不再讓 quiz_passed 成立，
        -- 新作答會接續 attempt_number。滿意度回覆則清除，要求重新填寫。
        if target_enrollment_status = 'refunded' then
          -- 與 heartbeat 固定使用 session → segment 鎖序，避免退款後殘留的
          -- 播放工作階段在重置交易完成後又把舊秒數寫回。
          perform 1
          from public.playback_sessions ps
          where ps.enrollment_id = target_enrollment_id
          order by ps.id
          for update;
          perform 1
          from public.playback_segments segment
          join public.playback_sessions ps on ps.id = segment.playback_session_id
          where ps.enrollment_id = target_enrollment_id
          order by segment.id
          for update of segment;
          update public.playback_segments segment
          set ended_at = coalesce(segment.ended_at, now())
          from public.playback_sessions ps
          where ps.id = segment.playback_session_id
            and ps.enrollment_id = target_enrollment_id
            and segment.ended_at is null;
          update public.playback_sessions
          set active = false, ended_at = coalesce(ended_at, now())
          where enrollment_id = target_enrollment_id and active;

          delete from public.lesson_progress
          where enrollment_id = target_enrollment_id;
          delete from public.satisfaction_responses
          where enrollment_id = target_enrollment_id;
          -- 若舊版人工退款流程曾在 enrollment 已改 refunded 後中斷，
          -- 於重購交易補齊證明撤銷，避免舊證明被誤認為本次完成成果。
          update public.certificates
          set revoked_at = coalesce(revoked_at, now()),
              revocation_reason = coalesce(revocation_reason, '課程訂單已退款')
          where enrollment_id = target_enrollment_id
            and revoked_at is null;
          update public.enrollments
          set status = 'active',
              started_at = now(),
              completed_at = null,
              expires_at = null,
              final_result = null,
              failure_reason = null,
              valid_watch_seconds = 0,
              progress_percent = 0,
              last_position_seconds = 0,
              last_lesson_id = null,
              quiz_passed = false,
              satisfaction_completed = false,
              updated_at = now()
          where id = target_enrollment_id;
          insert into public.audit_events (
            actor_id, action, target_type, target_id, before_data, after_data
          ) values (
            target_order.buyer_id,
            'payment.individual_enrollment_reactivated',
            'enrollment',
            target_enrollment_id::text,
            jsonb_build_object('status', 'refunded'),
            jsonb_build_object(
              'status', 'active',
              'order_id', target_order.id,
              'learning_reset', true,
              'quiz_status_reset', true,
              'satisfaction_reset', true,
              'revoked_certificates_preserved', true
            )
          );
        end if;
      end if;
      if target_live_session_id is not null then
        update public.live_session_bookings
        set status = 'confirmed', confirmed_at = now(), enrollment_id = target_enrollment_id
        where id = target_booking.id;
        insert into public.live_attendance_summaries (booking_id, live_session_id, learner_id)
        values (target_booking.id, target_live_session_id, target_order.buyer_id)
        on conflict (booking_id) do nothing;
      end if;
    else
      update public.live_session_bookings
      set status = 'expired', updated_at = now()
      where id = target_booking.id and status = 'held';
      insert into public.payment_events (
        provider_event_key, merchant_trade_no, event_type, verified, payload
      ) values (
        target_event_key || ':fulfillment-exception', target_trade_no,
        'fulfillment_exception', true,
        jsonb_build_object(
          'order_id', target_order.id,
          'live_session_id', target_live_session_id,
          'reason', fulfillment_exception_reason,
          'resolution', 'refund_or_manual_transfer_required'
        )
      ) on conflict (provider_event_key) do nothing;
      insert into public.audit_events (
        actor_id, action, target_type, target_id, after_data
      ) values (
        target_order.buyer_id, 'payment.fulfillment_exception', 'order',
        target_order.id::text,
        jsonb_build_object(
          'live_session_id', target_live_session_id,
          'reason', fulfillment_exception_reason,
          'payment_status', 'paid',
          'resolution', 'refund_or_manual_transfer_required'
        )
      );
    end if;
  end if;

  insert into public.payment_events (provider_event_key, merchant_trade_no, event_type, verified, payload)
  values (target_event_key || ':paid', target_trade_no, 'payment_confirmed', true, target_payload)
  on conflict (provider_event_key) do nothing;
  insert into public.audit_events (actor_id, organization_id, action, target_type, target_id, after_data)
  values (
    target_order.buyer_id, target_order.organization_id, 'payment.confirmed', 'order',
    target_order.id::text,
    jsonb_build_object(
      'provider', 'ecpay', 'order_kind', target_order.order_kind,
      'live_session_id', target_live_session_id, 'seat_lot_id', target_lot.id
    )
  );
  return target_order.id;
end;
$$;

-- Phase 3 的通用轉場函式不知道 enterprise allocation；強制企業 booking
-- 改走 select_enterprise_live_session，避免 booking 與名額帳本分歧。
create or replace function public.transfer_live_booking(
  source_booking_id uuid,
  target_session_id uuid
)
returns public.live_session_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_booking public.live_session_bookings%rowtype;
  source_session public.live_sessions%rowtype;
  target_session public.live_sessions%rowtype;
  new_booking public.live_session_bookings%rowtype;
  occupied integer;
begin
  select * into source_booking
  from public.live_session_bookings
  where id = source_booking_id;
  if source_booking.id is null then raise exception 'BOOKING_NOT_TRANSFERABLE'; end if;
  if exists (
    select 1 from public.enterprise_seat_allocations a
    where a.booking_id = source_booking.id
  ) or exists (
    select 1 from public.orders o
    where o.id = source_booking.source_order_id
      and o.order_kind = 'enterprise_seat_pack'
  ) then raise exception 'USE_ENTERPRISE_TRANSFER_RPC'; end if;

  select * into source_booking
  from public.live_session_bookings
  where id = source_booking_id
  for update;
  if source_booking.id is null or source_booking.status not in ('confirmed', 'cancelled') then
    raise exception 'BOOKING_NOT_TRANSFERABLE';
  end if;
  -- 鎖後再驗一次不可變訂單類型，避免競態繞過 guard。
  if exists (
    select 1 from public.enterprise_seat_allocations a
    where a.booking_id = source_booking.id
  ) or exists (
    select 1 from public.orders o
    where o.id = source_booking.source_order_id
      and o.order_kind = 'enterprise_seat_pack'
  ) then raise exception 'USE_ENTERPRISE_TRANSFER_RPC'; end if;

  select * into source_session
  from public.live_sessions
  where id = source_booking.live_session_id;
  select * into target_session
  from public.live_sessions
  where id = target_session_id
  for update;
  if target_session.id is null or target_session.course_id <> source_session.course_id
    or target_session.status not in ('scheduled', 'open')
    or target_session.starts_at <= now() then
    raise exception 'INVALID_TRANSFER_SESSION';
  end if;
  if exists (
    select 1 from public.live_session_bookings
    where live_session_id = target_session_id
      and learner_id = source_booking.learner_id
      and status in ('held', 'confirmed')
  ) then raise exception 'TARGET_BOOKING_EXISTS'; end if;
  update public.live_session_bookings
  set status = 'expired'
  where live_session_id = target_session_id
    and status = 'held' and held_until <= now();
  select count(*) into occupied
  from public.live_session_bookings
  where live_session_id = target_session_id
    and (status = 'confirmed' or (status = 'held' and held_until > now()));
  if occupied >= target_session.capacity then raise exception 'TARGET_SESSION_FULL'; end if;

  update public.live_session_bookings
  set status = 'transferred'
  where id = source_booking.id;
  update public.enrollments
  set live_session_id = target_session_id, status = 'active', updated_at = now()
  where id = source_booking.enrollment_id;
  update public.entitlements
  set live_session_id = target_session_id
  where source_order_id = source_booking.source_order_id
    and user_id = source_booking.learner_id and active;
  insert into public.live_session_bookings (
    live_session_id, learner_id, enrollment_id, source_order_id,
    status, confirmed_at, transferred_from
  ) values (
    target_session_id, source_booking.learner_id, source_booking.enrollment_id,
    source_booking.source_order_id, 'confirmed', now(), source_booking.id
  ) returning * into new_booking;
  insert into public.live_attendance_summaries (
    booking_id, live_session_id, learner_id
  ) values (
    new_booking.id, target_session_id, source_booking.learner_id
  );
  return new_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS：瀏覽器只可讀取同機構或本人資料；客服原始個資由 server route 遮罩後提供。
-- ---------------------------------------------------------------------------

alter table public.organization_invitations enable row level security;
alter table public.course_price_tiers enable row level security;
alter table public.enterprise_seat_lots enable row level security;
alter table public.enterprise_seat_allocations enable row level security;
alter table public.enterprise_seat_events enable row level security;
alter table public.invoice_records enable row level security;
alter table public.enterprise_email_deliveries enable row level security;

drop policy if exists "organization admins update organization" on public.organizations;
drop policy if exists "organization admins insert members" on public.organization_members;
drop policy if exists "organization admins update members" on public.organization_members;
drop policy if exists "organization admins delete members" on public.organization_members;

create policy "organization managers read invitations"
on public.organization_invitations for select to authenticated
using (private.is_active_org_manager(organization_id));

create policy "published enterprise tiers are readable"
on public.course_price_tiers for select to authenticated
using (
  private.is_platform_admin()
  or (
    active and effective_at <= now()
    and (expires_at is null or expires_at > now())
    and exists (
      select 1 from public.courses c
      where c.id = course_id and c.status = 'published'
    )
  )
);

create policy "organization managers read seat lots"
on public.enterprise_seat_lots for select to authenticated
using (private.is_active_org_manager(organization_id));

create policy "learners and organization managers read allocations"
on public.enterprise_seat_allocations for select to authenticated
using (learner_id = (select auth.uid()) or private.is_active_org_manager(organization_id));

create policy "active organization managers read seat events"
on public.enterprise_seat_events for select to authenticated
using (private.is_active_org_manager(organization_id));

create policy "organization managers read invoices"
on public.invoice_records for select to authenticated
using (private.is_active_org_manager(organization_id));

create policy "organization managers read enterprise email status"
on public.enterprise_email_deliveries for select to authenticated
using (private.is_active_org_manager(organization_id));

-- 舊 policy 允許企業訂單買受人與企業退款申請人即使機構已停權仍以「本人」
-- 身分讀取；個人訂單／退款保留本人讀取，企業資料則一律要求有效機構管理權。
drop policy if exists "buyers and org admins select orders" on public.orders;
create policy "individual buyers and active organization managers read orders"
on public.orders for select to authenticated
using (
  private.is_platform_admin()
  or (order_kind = 'individual_course' and buyer_id = (select auth.uid()))
  or (
    order_kind = 'enterprise_seat_pack'
    and organization_id is not null
    and private.is_active_org_manager(organization_id)
  )
);

drop policy if exists "buyers select order items" on public.order_items;
create policy "individual buyers and active organization managers read order items"
on public.order_items for select to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_id
      and (
        private.is_platform_admin()
        or (o.order_kind = 'individual_course' and o.buyer_id = (select auth.uid()))
        or (
          o.order_kind = 'enterprise_seat_pack'
          and o.organization_id is not null
          and private.is_active_org_manager(o.organization_id)
        )
      )
  )
);

drop policy if exists "requesters select refunds" on public.refunds;
create policy "individual requesters and admins read refunds"
on public.refunds for select to authenticated
using (
  private.is_platform_admin()
  or (refund_scope = 'individual' and requested_by = (select auth.uid()))
);

create policy "organization managers read enterprise refunds"
on public.refunds for select to authenticated
using (
  refund_scope = 'enterprise_seats'
  and organization_id is not null
  and private.is_active_org_manager(organization_id)
);

drop policy if exists "support reads orders" on public.orders;
drop policy if exists "staff read individual orders and admins read all orders" on public.orders;

drop policy if exists "staff read payment events" on public.payment_events;
create policy "platform admins read payment event status"
on public.payment_events for select to authenticated
using (private.is_platform_admin());

-- 舊階段的 is_platform_staff() 同時含 support，會讓客服 token 繞過遮罩 DTO
-- 直接透過 Data API 讀取原始學習、Zoom、簽到與稽核資料；此處統一收旂。
drop policy if exists "staff read video assets" on public.video_assets;

drop policy if exists "learners read own presence" on public.presence_challenges;
create policy "learners and admins read presence"
on public.presence_challenges for select to authenticated
using (
  private.is_platform_admin()
  or exists (
    select 1 from public.playback_sessions ps
    where ps.id = playback_session_id and ps.learner_id = (select auth.uid())
  )
);

drop policy if exists "support reads enrollments" on public.enrollments;
drop policy if exists "support reads events" on public.learning_events;
drop policy if exists "support reads audit" on public.audit_events;

drop policy if exists "learners read own accreditation registration"
on public.accreditation_registrations;
create policy "learners and admins read accreditation registration"
on public.accreditation_registrations for select to authenticated
using (learner_id = (select auth.uid()) or private.is_platform_admin());

drop policy if exists "learners read own lesson progress" on public.lesson_progress;
create policy "learners and admins read lesson progress"
on public.lesson_progress for select to authenticated
using (learner_id = (select auth.uid()) or private.is_platform_admin());

drop policy if exists "learners read own live bookings" on public.live_session_bookings;
create policy "learners and admins read live bookings"
on public.live_session_bookings for select to authenticated
using (learner_id = (select auth.uid()) or private.is_platform_admin());

drop policy if exists "learners read own live summary" on public.live_attendance_summaries;
create policy "learners and admins read own live summary"
on public.live_attendance_summaries for select to authenticated
using (learner_id = (select auth.uid()) or private.is_platform_admin());

drop policy if exists "staff read live adjustments" on public.live_attendance_adjustments;
create policy "admins read live adjustments"
on public.live_attendance_adjustments for select to authenticated
using (private.is_platform_admin());

drop policy if exists "staff read zoom events" on public.zoom_webhook_events;
create policy "admins read zoom events"
on public.zoom_webhook_events for select to authenticated
using (private.is_platform_admin());

drop policy if exists "staff read email deliveries" on public.live_email_deliveries;
create policy "admins read live email deliveries"
on public.live_email_deliveries for select to authenticated
using (private.is_platform_admin());

drop policy if exists "booked learners and staff read live sessions" on public.live_sessions;
create policy "booked learners and admins read live sessions"
on public.live_sessions for select to authenticated
using (
  private.is_platform_admin()
  or exists (
    select 1 from public.live_session_bookings b
    where b.live_session_id = id
      and b.learner_id = (select auth.uid())
      and b.status = 'confirmed'
  )
);

drop policy if exists "learners and staff read live attendance" on public.live_attendance_events;
create policy "learners and admins read live attendance"
on public.live_attendance_events for select to authenticated
using (learner_id = (select auth.uid()) or private.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 2026 Data API 明確 GRANT；無任何新表允許 anon 或 authenticated 直接寫入。
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

grant select on public.course_price_tiers,
  public.enterprise_seat_lots, public.enterprise_seat_allocations,
  public.enterprise_seat_events,
  public.enterprise_email_deliveries
to authenticated;
grant select on public.organization_members,
  public.orders, public.order_items, public.refunds
to authenticated;
revoke select on public.organizations from authenticated;
grant select (
  id, name, seat_limit, active, status, submitted_at,
  reviewed_at, approved_at, created_at, updated_at
) on public.organizations to authenticated;
revoke all on table public.payment_events from anon, authenticated;
grant select (
  id, provider, provider_event_key, merchant_trade_no,
  event_type, verified, received_at
) on public.payment_events to authenticated;
revoke all on table public.invoice_records from anon, authenticated;
grant select (
  id, organization_id, order_id, refund_id, parent_invoice_id,
  record_type, status, provider_invoice_no, invoice_number, invoice_date,
  allowance_number, allowance_status, allowance_amount_twd, allowance_date,
  allowance_expires_at, allowance_manual_reconciliation_required,
  remaining_allowance_twd, buyer_title, buyer_tax_id, buyer_email,
  amount_twd, details, attempt_count, error_message, next_retry_at,
  issued_at, voided_at, allowance_at, created_at, updated_at
) on public.invoice_records to authenticated;
revoke all on table public.organization_invitations from anon, authenticated;
grant select (
  id, organization_id, email, email_normalized, full_name, invitee_name,
  employee_code, department, role, status, expires_at, invited_by,
  accepted_by, accepted_at, revoked_at, created_at, updated_at
) on public.organization_invitations to authenticated;

grant all on public.organization_invitations, public.course_price_tiers,
  public.enterprise_seat_lots, public.enterprise_seat_allocations,
  public.enterprise_seat_events, public.invoice_records,
  public.enterprise_email_deliveries, public.organizations,
  public.organization_members, public.orders, public.order_items, public.refunds
to service_role;
grant usage, select on sequence public.enterprise_seat_events_id_seq to service_role;

-- 新增／取代的 SECURITY DEFINER 函數全部撤銷 PUBLIC、anon、authenticated。
revoke all on function public.submit_organization_application(uuid, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.accept_organization_invitation(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.update_playback_segment_active_seconds(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.select_enterprise_live_session(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.assign_enterprise_seat(uuid, uuid, timestamptz, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.release_enterprise_seat(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.consume_enterprise_seat(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.correct_enterprise_seat_lot(uuid, integer, uuid, text)
  from public, anon, authenticated;
revoke all on function public.expire_enterprise_seat_lots(timestamptz)
  from public, anon, authenticated;
revoke all on function public.expire_enterprise_seats()
  from public, anon, authenticated;
revoke all on function public.request_enterprise_refund(uuid, integer, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.decide_enterprise_refund(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.apply_enterprise_refund(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.claim_enterprise_allowance(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_enterprise_allowance(uuid, uuid, uuid, text, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function public.fail_enterprise_allowance(uuid, uuid, uuid, text, boolean, jsonb)
  from public, anon, authenticated;
revoke all on function public.expire_enterprise_allowance_claims(timestamptz)
  from public, anon, authenticated;
revoke all on function public.reconcile_enterprise_allowance(uuid, uuid, text, text, text, text, timestamptz, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.apply_verified_enterprise_allowance_callback(uuid, text, text, timestamptz, date, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.create_enterprise_checkout_order(uuid, uuid, uuid, integer, uuid, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.apply_ecpay_paid_order(text, text, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.transfer_live_booking(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.submit_organization_application(uuid, text, text, text, text, text)
  to service_role;
grant execute on function public.accept_organization_invitation(text, uuid, text)
  to service_role;
grant execute on function public.update_playback_segment_active_seconds(uuid, uuid, integer)
  to service_role;
grant execute on function public.select_enterprise_live_session(uuid, uuid, uuid)
  to service_role;
grant execute on function public.assign_enterprise_seat(uuid, uuid, timestamptz, uuid, uuid)
  to service_role;
grant execute on function public.release_enterprise_seat(uuid, uuid)
  to service_role;
grant execute on function public.consume_enterprise_seat(uuid, uuid)
  to service_role;
grant execute on function public.correct_enterprise_seat_lot(uuid, integer, uuid, text)
  to service_role;
grant execute on function public.expire_enterprise_seat_lots(timestamptz)
  to service_role;
grant execute on function public.expire_enterprise_seats()
  to service_role;
grant execute on function public.request_enterprise_refund(uuid, integer, text, uuid, uuid)
  to service_role;
grant execute on function public.decide_enterprise_refund(uuid, uuid, text, text)
  to service_role;
grant execute on function public.apply_enterprise_refund(uuid, uuid, text, text)
  to service_role;
grant execute on function public.claim_enterprise_allowance(uuid, uuid)
  to service_role;
grant execute on function public.complete_enterprise_allowance(uuid, uuid, uuid, text, timestamptz, jsonb)
  to service_role;
grant execute on function public.fail_enterprise_allowance(uuid, uuid, uuid, text, boolean, jsonb)
  to service_role;
grant execute on function public.expire_enterprise_allowance_claims(timestamptz)
  to service_role;
grant execute on function public.reconcile_enterprise_allowance(uuid, uuid, text, text, text, text, timestamptz, integer, jsonb)
  to service_role;
grant execute on function public.apply_verified_enterprise_allowance_callback(uuid, text, text, timestamptz, date, integer, jsonb)
  to service_role;
grant execute on function public.create_enterprise_checkout_order(uuid, uuid, uuid, integer, uuid, text, text, text, text, text)
  to service_role;
grant execute on function public.apply_ecpay_paid_order(text, text, text, text, text, jsonb)
  to service_role;
grant execute on function public.transfer_live_booking(uuid, uuid)
  to service_role;

insert into public.platform_settings (key, value) values
  ('enterprise_enabled', 'false'::jsonb),
  ('enterprise_invitation_expiry_days', '7'::jsonb),
  ('enterprise_seat_valid_days', '365'::jsonb),
  ('enterprise_live_change_cutoff_hours', '24'::jsonb),
  ('enterprise_deadline_reminder_days', '[7, 1]'::jsonb)
on conflict (key) do update set value = excluded.value;
