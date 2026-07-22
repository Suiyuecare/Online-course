-- 歲悅學苑第三階段：免 Zoom 帳號直播場次、座位保留、簽到退與出席稽核。

alter table public.live_sessions
  add column if not exists status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'open', 'ended', 'cancelled')),
  add column if not exists instructor_name text not null default '',
  add column if not exists capacity integer not null default 50 check (capacity between 1 and 1000),
  add column if not exists host_plan_capacity integer not null default 100 check (host_plan_capacity between 1 and 1000),
  add column if not exists break_intervals jsonb not null default '[]'::jsonb,
  add column if not exists zoom_meeting_uuid text,
  add column if not exists zoom_host_id text,
  add column if not exists zoom_status text not null default 'not_created'
    check (zoom_status in ('not_created', 'creating', 'ready', 'failed', 'cancelled')),
  add column if not exists join_opens_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add constraint live_sessions_capacity_plan_check check (capacity <= host_plan_capacity),
  add constraint live_sessions_camera_threshold_check check (camera_required_percent between 0 and 100);

-- 第三階段統一採百分比門檻；先清除舊版分鐘門檻，避免舊有互斥 constraint 阻擋 migration。
update public.live_sessions
set camera_required_minutes = null,
    camera_required_percent = coalesce(camera_required_percent, 80);
alter table public.live_sessions alter column camera_required_percent set default 80;
create trigger live_sessions_updated_at before update on public.live_sessions
for each row execute function private.set_updated_at();

create or replace function private.validate_accredited_course_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and new.accredited and new.delivery in ('live', 'hybrid') then
    if not exists (
      select 1 from public.live_sessions ls where ls.course_id = new.id
        and ls.zoom_status = 'ready' and ls.status in ('scheduled', 'open')
        and ls.camera_required_percent between 1 and 100
    ) then
      raise exception 'Accredited live courses require a scheduled Zoom session and camera threshold before publication';
    end if;
  end if;
  return new;
end;
$$;

create table private.live_session_zoom_credentials (
  live_session_id uuid primary key references public.live_sessions(id) on delete cascade,
  meeting_number text not null unique,
  encrypted_passcode text not null,
  encryption_version smallint not null default 1 check (encryption_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on table private.live_session_zoom_credentials from public, anon, authenticated;
grant all on table private.live_session_zoom_credentials to service_role;

alter table public.order_items add column if not exists live_session_id uuid references public.live_sessions(id);
alter table public.entitlements add column if not exists live_session_id uuid references public.live_sessions(id);
alter table public.enrollments add column if not exists live_session_id uuid references public.live_sessions(id);
alter table public.accreditation_registrations drop constraint if exists accreditation_registrations_learner_id_course_id_key;

drop index if exists public.one_active_entitlement_per_user_course;
drop index if exists public.one_individual_enrollment_per_course;
alter table public.enrollments drop constraint if exists enrollments_learner_id_course_id_organization_id_key;
create unique index one_active_recorded_entitlement
  on public.entitlements (user_id, course_id) where active and user_id is not null and live_session_id is null;
create unique index one_active_live_entitlement
  on public.entitlements (user_id, live_session_id) where active and user_id is not null and live_session_id is not null;
create unique index one_individual_recorded_enrollment
  on public.enrollments (learner_id, course_id) where organization_id is null and live_session_id is null;
create unique index one_individual_live_enrollment
  on public.enrollments (learner_id, live_session_id) where organization_id is null and live_session_id is not null;

create table public.live_session_bookings (
  id uuid primary key default gen_random_uuid(),
  live_session_id uuid not null references public.live_sessions(id),
  learner_id uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid references public.enrollments(id),
  source_order_id uuid references public.orders(id),
  status text not null default 'held'
    check (status in ('held', 'confirmed', 'transferred', 'refunded', 'cancelled', 'expired')),
  customer_key text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  held_until timestamptz not null default (now() + interval '15 minutes'),
  confirmed_at timestamptz,
  transferred_from uuid references public.live_session_bookings(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_live_booking_per_learner_session
  on public.live_session_bookings (live_session_id, learner_id)
  where status in ('held', 'confirmed');
create index live_bookings_session_status_idx
  on public.live_session_bookings (live_session_id, status, held_until);
create trigger live_session_bookings_updated_at before update on public.live_session_bookings
for each row execute function private.set_updated_at();

create table public.zoom_webhook_events (
  id bigint generated always as identity primary key,
  event_key text not null unique,
  event_type text not null,
  live_session_id uuid references public.live_sessions(id),
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  payload jsonb not null
);

alter table public.live_attendance_events drop constraint if exists live_attendance_events_event_type_check;
alter table public.live_attendance_events
  add column if not exists booking_id uuid references public.live_session_bookings(id),
  add constraint live_attendance_events_event_type_check
    check (event_type in ('joined', 'left', 'camera_on', 'camera_off', 'heartbeat', 'check_in', 'check_out', 'equipment_failed', 'exception_requested'));

create table public.live_attendance_summaries (
  booking_id uuid primary key references public.live_session_bookings(id) on delete cascade,
  live_session_id uuid not null references public.live_sessions(id),
  learner_id uuid not null references auth.users(id) on delete cascade,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  online_seconds integer not null default 0 check (online_seconds >= 0),
  camera_seconds integer not null default 0 check (camera_seconds >= 0),
  required_seconds integer not null default 0 check (required_seconds >= 0),
  camera_percent numeric(7,4) not null default 0 check (camera_percent between 0 and 100),
  attendance_status text not null default 'pending'
    check (attendance_status in ('pending', 'qualified', 'needs_review', 'disqualified')),
  reasons jsonb not null default '[]'::jsonb,
  last_calculated_at timestamptz not null default now()
);

create table public.live_attendance_adjustments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.live_session_bookings(id),
  actor_id uuid not null references auth.users(id),
  decision text not null check (decision in ('maintain_disqualified', 'manual_correction')),
  camera_seconds_delta integer not null default 0,
  check_in_override boolean,
  check_out_override boolean,
  reason text not null check (length(trim(reason)) >= 5),
  created_at timestamptz not null default now()
);

create table public.live_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.live_session_bookings(id),
  kind text not null check (kind in ('purchase_confirmation', 'reminder_24h', 'reminder_1h')),
  provider_message_id text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'suppressed')),
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (booking_id, kind)
);

alter table public.certificates
  add column if not exists live_session_id uuid references public.live_sessions(id),
  add column if not exists live_session_date_snapshot date,
  add column if not exists attendance_threshold_snapshot numeric(5,2);

create or replace function private.prevent_append_only_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'APPEND_ONLY_RECORD'; end;
$$;
create trigger zoom_webhook_events_append_only before update or delete on public.zoom_webhook_events
for each row execute function private.prevent_append_only_mutation();
create trigger live_attendance_events_append_only before update or delete on public.live_attendance_events
for each row execute function private.prevent_append_only_mutation();
create trigger live_attendance_adjustments_append_only before update or delete on public.live_attendance_adjustments
for each row execute function private.prevent_append_only_mutation();

create or replace function public.reserve_live_seat(
  target_session_id uuid,
  target_learner_id uuid,
  target_order_id uuid
)
returns public.live_session_bookings
language plpgsql security definer set search_path = '' as $$
declare session_row public.live_sessions%rowtype; booking public.live_session_bookings; occupied integer;
begin
  select * into session_row from public.live_sessions where id = target_session_id for update;
  if session_row.id is null then raise exception 'LIVE_SESSION_NOT_FOUND'; end if;
  if session_row.status <> 'open' then raise exception 'LIVE_SESSION_NOT_OPEN'; end if;
  if session_row.starts_at <= now() then raise exception 'LIVE_SESSION_ALREADY_STARTED'; end if;
  update public.live_session_bookings set status = 'expired'
    where live_session_id = target_session_id and status = 'held' and held_until <= now();
  select count(*) into occupied from public.live_session_bookings
    where live_session_id = target_session_id and (status = 'confirmed' or (status = 'held' and held_until > now()));
  select * into booking from public.live_session_bookings
    where live_session_id = target_session_id and learner_id = target_learner_id and status in ('held','confirmed') limit 1;
  if booking.id is not null and booking.status = 'confirmed' then return booking; end if;
  if booking.id is not null then
    update public.live_session_bookings set source_order_id = target_order_id,
      held_until = now() + interval '15 minutes', updated_at = now()
      where id = booking.id returning * into booking;
    return booking;
  end if;
  if occupied >= session_row.capacity then raise exception 'LIVE_SESSION_FULL'; end if;
  insert into public.live_session_bookings (live_session_id, learner_id, source_order_id)
  values (target_session_id, target_learner_id, target_order_id) returning * into booking;
  return booking;
end;
$$;
revoke all on function public.reserve_live_seat(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_live_seat(uuid, uuid, uuid) to service_role;

create or replace function public.transfer_live_booking(
  source_booking_id uuid,
  target_session_id uuid
)
returns public.live_session_bookings
language plpgsql security definer set search_path = '' as $$
declare source_booking public.live_session_bookings%rowtype; source_session public.live_sessions%rowtype;
  target_session public.live_sessions%rowtype; occupied integer; new_booking public.live_session_bookings;
begin
  select * into source_booking from public.live_session_bookings where id = source_booking_id for update;
  if source_booking.id is null or source_booking.status not in ('confirmed','cancelled') then raise exception 'BOOKING_NOT_TRANSFERABLE'; end if;
  select * into source_session from public.live_sessions where id = source_booking.live_session_id;
  select * into target_session from public.live_sessions where id = target_session_id for update;
  if target_session.id is null or target_session.course_id <> source_session.course_id
    or target_session.status not in ('scheduled','open') or target_session.starts_at <= now()
    then raise exception 'INVALID_TRANSFER_SESSION'; end if;
  if exists (select 1 from public.live_session_bookings where live_session_id = target_session_id
    and learner_id = source_booking.learner_id and status in ('held','confirmed')) then raise exception 'TARGET_BOOKING_EXISTS'; end if;
  update public.live_session_bookings set status = 'expired' where live_session_id = target_session_id and status = 'held' and held_until <= now();
  select count(*) into occupied from public.live_session_bookings where live_session_id = target_session_id
    and (status = 'confirmed' or (status = 'held' and held_until > now()));
  if occupied >= target_session.capacity then raise exception 'TARGET_SESSION_FULL'; end if;
  update public.live_session_bookings set status = 'transferred' where id = source_booking.id;
  update public.enrollments set live_session_id = target_session_id, status = 'active', updated_at = now()
    where id = source_booking.enrollment_id;
  update public.entitlements set live_session_id = target_session_id
    where source_order_id = source_booking.source_order_id and user_id = source_booking.learner_id and active;
  insert into public.live_session_bookings (live_session_id, learner_id, enrollment_id, source_order_id, status, confirmed_at, transferred_from)
    values (target_session_id, source_booking.learner_id, source_booking.enrollment_id, source_booking.source_order_id, 'confirmed', now(), source_booking.id)
    returning * into new_booking;
  insert into public.live_attendance_summaries (booking_id, live_session_id, learner_id)
    values (new_booking.id, target_session_id, source_booking.learner_id);
  return new_booking;
end;
$$;
revoke all on function public.transfer_live_booking(uuid,uuid) from public, anon, authenticated;
grant execute on function public.transfer_live_booking(uuid,uuid) to service_role;

create or replace function public.store_live_zoom_credentials(
  target_session_id uuid, target_meeting_number text, target_encrypted_passcode text
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into private.live_session_zoom_credentials (live_session_id, meeting_number, encrypted_passcode)
  values (target_session_id, target_meeting_number, target_encrypted_passcode)
  on conflict (live_session_id) do update set meeting_number = excluded.meeting_number,
    encrypted_passcode = excluded.encrypted_passcode,
    encryption_version = private.live_session_zoom_credentials.encryption_version + 1,
    updated_at = now();
end;
$$;
create or replace function public.get_live_zoom_credentials(target_session_id uuid)
returns table (meeting_number text, encrypted_passcode text)
language sql stable security definer set search_path = '' as $$
  select z.meeting_number, z.encrypted_passcode from private.live_session_zoom_credentials z
  where z.live_session_id = target_session_id
$$;
revoke all on function public.store_live_zoom_credentials(uuid,text,text) from public, anon, authenticated;
revoke all on function public.get_live_zoom_credentials(uuid) from public, anon, authenticated;
grant execute on function public.store_live_zoom_credentials(uuid,text,text) to service_role;
grant execute on function public.get_live_zoom_credentials(uuid) to service_role;

create or replace function public.apply_ecpay_paid_order(
  target_trade_no text,
  target_provider_trade_no text,
  target_payment_type text,
  target_message text,
  target_event_key text,
  target_payload jsonb
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  target_order public.orders%rowtype;
  target_course_id uuid;
  target_live_session_id uuid;
  target_booking public.live_session_bookings%rowtype;
  target_enrollment_id uuid;
begin
  insert into public.payment_events (provider_event_key, merchant_trade_no, event_type, verified, payload)
  values (target_event_key, target_trade_no, 'callback_received', true, target_payload)
  on conflict (provider_event_key) do nothing;
  select * into target_order from public.orders where merchant_trade_no = target_trade_no for update;
  if target_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if target_order.status = 'paid' then return target_order.id; end if;
  if target_order.status <> 'pending' then raise exception 'ORDER_NOT_PAYABLE'; end if;
  select oi.course_id, oi.live_session_id into target_course_id, target_live_session_id
  from public.order_items oi where oi.order_id = target_order.id and oi.item_type = 'course' limit 1;
  if target_course_id is null then raise exception 'COURSE_ITEM_NOT_FOUND'; end if;
  if target_live_session_id is not null then
    if not exists (select 1 from public.live_sessions where id = target_live_session_id and status = 'open')
      then raise exception 'LIVE_SESSION_NOT_OPEN'; end if;
    select * into target_booking from public.live_session_bookings
      where source_order_id = target_order.id and live_session_id = target_live_session_id for update;
    if target_booking.id is null or target_booking.status <> 'held' or target_booking.held_until <= now()
      then raise exception 'LIVE_SEAT_HOLD_EXPIRED'; end if;
  end if;
  update public.orders set status = 'paid', paid_at = now(), provider_trade_no = target_provider_trade_no,
    payment_type = target_payment_type, payment_message = target_message where id = target_order.id;
  insert into public.entitlements (user_id, course_id, live_session_id, source_order_id, active)
  values (target_order.buyer_id, target_course_id, target_live_session_id, target_order.id, true)
  on conflict do nothing;
  insert into public.enrollments (learner_id, course_id, live_session_id, status, started_at)
  values (target_order.buyer_id, target_course_id, target_live_session_id, 'active', now())
  on conflict do nothing returning id into target_enrollment_id;
  if target_enrollment_id is null then
    select id into target_enrollment_id from public.enrollments where learner_id = target_order.buyer_id
      and course_id = target_course_id and live_session_id is not distinct from target_live_session_id
      and organization_id is null limit 1;
  end if;
  if target_live_session_id is not null then
    update public.live_session_bookings set status = 'confirmed', confirmed_at = now(),
      enrollment_id = target_enrollment_id where id = target_booking.id;
    insert into public.live_attendance_summaries (booking_id, live_session_id, learner_id)
      values (target_booking.id, target_live_session_id, target_order.buyer_id) on conflict do nothing;
  end if;
  insert into public.payment_events (provider_event_key, merchant_trade_no, event_type, verified, payload)
  values (target_event_key || ':paid', target_trade_no, 'payment_confirmed', true, target_payload)
  on conflict (provider_event_key) do nothing;
  insert into public.audit_events (actor_id, action, target_type, target_id, after_data)
  values (target_order.buyer_id, 'payment.confirmed', 'order', target_order.id::text,
    jsonb_build_object('provider', 'ecpay', 'live_session_id', target_live_session_id));
  return target_order.id;
end;
$$;
revoke all on function public.apply_ecpay_paid_order(text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_ecpay_paid_order(text,text,text,text,text,jsonb) to service_role;

alter table public.live_session_bookings enable row level security;
alter table public.zoom_webhook_events enable row level security;
alter table public.live_attendance_summaries enable row level security;
alter table public.live_attendance_adjustments enable row level security;
alter table public.live_email_deliveries enable row level security;

create policy "learners read own live bookings" on public.live_session_bookings for select to authenticated
  using (learner_id = (select auth.uid()) or private.is_platform_staff());
create policy "learners read own live summary" on public.live_attendance_summaries for select to authenticated
  using (learner_id = (select auth.uid()) or private.is_platform_staff());
create policy "staff read live adjustments" on public.live_attendance_adjustments for select to authenticated
  using (private.is_platform_staff());
create policy "admins append live adjustments" on public.live_attendance_adjustments for insert to authenticated
  with check (private.is_platform_admin() and actor_id = (select auth.uid()));
create policy "staff read zoom events" on public.zoom_webhook_events for select to authenticated
  using (private.is_platform_staff());
create policy "staff read email deliveries" on public.live_email_deliveries for select to authenticated
  using (private.is_platform_staff());

drop policy if exists "published live sessions select" on public.live_sessions;
create policy "booked learners and staff read live sessions" on public.live_sessions for select to authenticated
  using (private.is_platform_staff() or exists (
    select 1 from public.live_session_bookings b
    where b.live_session_id = id and b.learner_id = (select auth.uid()) and b.status = 'confirmed'
  ));
drop policy if exists "learners and admins select live attendance" on public.live_attendance_events;
create policy "learners and staff read live attendance" on public.live_attendance_events for select to authenticated
  using (learner_id = (select auth.uid()) or private.is_platform_staff());

grant select on public.live_sessions, public.live_session_bookings,
  public.live_attendance_events, public.live_attendance_summaries to authenticated;
grant select on public.zoom_webhook_events, public.live_attendance_adjustments,
  public.live_email_deliveries to authenticated;
grant all on public.live_sessions, public.live_session_bookings, public.zoom_webhook_events,
  public.live_attendance_events, public.live_attendance_summaries,
  public.live_attendance_adjustments, public.live_email_deliveries to service_role;
grant usage, select on sequence public.zoom_webhook_events_id_seq to service_role;

insert into public.platform_settings (key, value) values
  ('live_courses_enabled', 'false'::jsonb),
  ('live_check_in_open_minutes', '30'::jsonb),
  ('live_check_in_close_minutes', '15'::jsonb),
  ('live_check_out_open_minutes', '15'::jsonb),
  ('live_check_out_close_minutes', '30'::jsonb),
  ('live_heartbeat_seconds', '15'::jsonb),
  ('live_heartbeat_gap_seconds', '45'::jsonb)
on conflict (key) do update set value = excluded.value;
