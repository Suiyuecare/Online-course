-- 歲悅學苑封閉試營運核心：角色、影音版本、付款冪等、測驗題庫與伺服器權威事件。

create type public.video_asset_status as enum ('uploading', 'processing', 'ready', 'failed', 'archived');

create or replace function private.is_platform_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'platform_role') in ('admin', 'support'), false)
$$;

alter table public.courses
  add column if not exists version integer not null default 1 check (version > 0),
  add column if not exists satisfaction_required boolean not null default true,
  add column if not exists completion_percent smallint not null default 90 check (completion_percent between 1 and 100);

alter table public.enrollments
  add column if not exists valid_watch_seconds integer not null default 0 check (valid_watch_seconds >= 0),
  add column if not exists progress_percent smallint not null default 0 check (progress_percent between 0 and 100),
  add column if not exists last_position_seconds integer not null default 0 check (last_position_seconds >= 0),
  add column if not exists last_lesson_id uuid references public.lessons(id),
  add column if not exists quiz_passed boolean not null default false,
  add column if not exists satisfaction_completed boolean not null default false;

create table public.video_assets (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  stream_uid text not null unique,
  status public.video_asset_status not null default 'uploading',
  original_filename text not null,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes > 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  error_code text,
  error_message text,
  created_by uuid references auth.users(id),
  ready_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, version)
);
create index video_assets_lesson_status_idx on public.video_assets (lesson_id, status, version desc);

alter table public.lessons add column if not exists active_video_asset_id uuid references public.video_assets(id) on delete restrict;

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  prompt text not null,
  explanation text,
  position integer not null check (position >= 0),
  points smallint not null default 20 check (points > 0),
  active boolean not null default true,
  unique (course_id, position)
);

create table public.quiz_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  label text not null,
  is_correct boolean not null default false,
  position integer not null check (position >= 0),
  unique (question_id, position)
);

alter table public.quiz_attempts
  add column if not exists attempt_number integer not null default 1 check (attempt_number > 0),
  add column if not exists graded_at timestamptz;
create unique index if not exists quiz_attempt_number_unique on public.quiz_attempts (enrollment_id, attempt_number);

alter table public.orders
  add column if not exists checkout_idempotency_key text unique,
  add column if not exists provider_trade_no text,
  add column if not exists payment_type text,
  add column if not exists payment_message text;

create table public.payment_events (
  id bigint generated always as identity primary key,
  provider text not null default 'ecpay',
  provider_event_key text not null unique,
  merchant_trade_no text not null,
  event_type text not null check (event_type in ('callback_received', 'payment_confirmed', 'payment_rejected', 'refund_recorded')),
  verified boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);
create index payment_events_trade_no_idx on public.payment_events (merchant_trade_no, received_at desc);

create unique index if not exists one_active_entitlement_per_user_course
  on public.entitlements (user_id, course_id) where active and user_id is not null;
create unique index if not exists one_individual_enrollment_per_course
  on public.enrollments (learner_id, course_id) where organization_id is null;

create table public.presence_challenges (
  id uuid primary key default gen_random_uuid(),
  playback_session_id uuid not null references public.playback_sessions(id) on delete cascade,
  segment_number integer not null check (segment_number > 0),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  expired_at timestamptz,
  unique (playback_session_id, segment_number),
  check (expires_at > requested_at)
);

create or replace function private.prevent_lesson_history_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.playback_sessions ps where ps.lesson_id = old.id) then
    raise exception 'Lessons with learning history cannot be deleted; archive or create a new version';
  end if;
  return old;
end;
$$;
create trigger prevent_lesson_history_delete before delete on public.lessons
for each row execute function private.prevent_lesson_history_delete();

create or replace function private.validate_recorded_course_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and new.delivery in ('recorded', 'hybrid') then
    if not exists (
      select 1 from public.course_modules m join public.lessons l on l.module_id = m.id
      where m.course_id = new.id and l.is_preview = false
    ) or exists (
      select 1 from public.course_modules m join public.lessons l on l.module_id = m.id
      left join public.video_assets va on va.id = l.active_video_asset_id and va.status = 'ready'
      where m.course_id = new.id and l.is_preview = false and va.id is null
    ) then
      raise exception 'Recorded courses require a ready active video for every paid lesson before publication';
    end if;
  end if;
  return new;
end;
$$;
create trigger validate_recorded_course_publication before insert or update of status on public.courses
for each row execute function private.validate_recorded_course_publication();

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
declare target_order public.orders%rowtype; target_course_id uuid; enrollment_id uuid;
begin
  insert into public.payment_events (provider_event_key, merchant_trade_no, event_type, verified, payload)
  values (target_event_key, target_trade_no, 'callback_received', true, target_payload)
  on conflict (provider_event_key) do nothing;

  select * into target_order from public.orders where merchant_trade_no = target_trade_no for update;
  if target_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if target_order.status = 'paid' then return target_order.id; end if;
  if target_order.status <> 'pending' then raise exception 'ORDER_NOT_PAYABLE'; end if;

  update public.orders set status = 'paid', paid_at = now(), provider_trade_no = target_provider_trade_no,
    payment_type = target_payment_type, payment_message = target_message where id = target_order.id;
  select oi.course_id into target_course_id from public.order_items oi where oi.order_id = target_order.id and oi.item_type = 'course' limit 1;
  if target_course_id is null then raise exception 'COURSE_ITEM_NOT_FOUND'; end if;

  insert into public.entitlements (user_id, course_id, source_order_id, active)
  values (target_order.buyer_id, target_course_id, target_order.id, true)
  on conflict (user_id, course_id) where active and user_id is not null do nothing;

  insert into public.enrollments (learner_id, course_id, status, started_at)
  values (target_order.buyer_id, target_course_id, 'active', now())
  on conflict (learner_id, course_id) where organization_id is null do update set status = 'active', updated_at = now()
  returning id into enrollment_id;

  insert into public.payment_events (provider_event_key, merchant_trade_no, event_type, verified, payload)
  values (target_event_key || ':paid', target_trade_no, 'payment_confirmed', true, target_payload)
  on conflict (provider_event_key) do nothing;
  insert into public.audit_events (actor_id, action, target_type, target_id, after_data)
  values (target_order.buyer_id, 'payment.confirmed', 'order', target_order.id::text, jsonb_build_object('provider', 'ecpay'));
  return target_order.id;
end;
$$;
revoke all on function public.apply_ecpay_paid_order(text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_ecpay_paid_order(text,text,text,text,text,jsonb) to service_role;

alter table public.video_assets enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_options enable row level security;
alter table public.payment_events enable row level security;
alter table public.presence_challenges enable row level security;

drop policy if exists "learners append own immutable events" on public.learning_events;
drop policy if exists "learners insert playback sessions" on public.playback_sessions;
drop policy if exists "learners update playback sessions" on public.playback_sessions;
drop policy if exists "learners insert playback segments" on public.playback_segments;
drop policy if exists "learners insert quiz attempts" on public.quiz_attempts;
drop policy if exists "learners update unsubmitted quiz attempts" on public.quiz_attempts;
drop policy if exists "learners insert satisfaction responses" on public.satisfaction_responses;
drop policy if exists "authenticated buyers create pending orders" on public.orders;

create policy "staff read video assets" on public.video_assets for select to authenticated using (private.is_platform_staff());
create policy "admins manage video assets" on public.video_assets for all to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "published quiz questions are readable" on public.quiz_questions for select to authenticated using (active and exists (select 1 from public.courses c where c.id = course_id and c.status = 'published'));
create policy "admins manage quiz questions" on public.quiz_questions for all to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "admins manage quiz options" on public.quiz_options for all to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "staff read payment events" on public.payment_events for select to authenticated using (private.is_platform_staff());
create policy "learners read own presence" on public.presence_challenges for select to authenticated using (exists (select 1 from public.playback_sessions ps where ps.id = playback_session_id and ps.learner_id = auth.uid()) or private.is_platform_staff());

create policy "support reads enrollments" on public.enrollments for select to authenticated using (private.is_platform_staff());
create policy "support reads orders" on public.orders for select to authenticated using (private.is_platform_staff());
create policy "support reads events" on public.learning_events for select to authenticated using (private.is_platform_staff());
create policy "support reads audit" on public.audit_events for select to authenticated using (private.is_platform_staff());

insert into public.platform_settings (key, value) values
  ('closed_beta_enabled', 'true'::jsonb),
  ('presence_interval_preview_seconds', '120'::jsonb),
  ('presence_interval_production_seconds', '900'::jsonb),
  ('live_courses_enabled', 'false'::jsonb),
  ('enterprise_enabled', 'false'::jsonb),
  ('subscriptions_enabled', 'false'::jsonb)
on conflict (key) do update set value = excluded.value;

-- 課程先以 draft 建立；Cloudflare 影片 ready 並設為 active 後，管理員才可發布。
insert into public.courses (id, slug, title, subtitle, description, delivery, status, price_twd, accredited, pass_score, completion_percent)
values ('d1111111-1111-4111-8111-111111111111', 'dementia-care-pilot', '失智照護入門：看見行為背後的需要',
  '用 6 分鐘理解失智者的日常感受', '封閉試營運非積分測試課。', 'recorded', 'draft', 100, false, 80, 90)
on conflict (slug) do nothing;
insert into public.course_modules (id, course_id, title, position)
values ('d2222222-2222-4222-8222-222222222222', 'd1111111-1111-4111-8111-111111111111', '測試課程', 0)
on conflict (course_id, position) do nothing;
insert into public.lessons (id, module_id, title, position, duration_seconds, is_preview)
values ('d3333333-3333-4333-8333-333333333333', 'd2222222-2222-4222-8222-222222222222', '從心感受失智者的日常', 0, 360, false)
on conflict (module_id, position) do nothing;

insert into public.quiz_questions (id, course_id, prompt, explanation, position, points) values
  ('e1000000-0000-4000-8000-000000000001', 'd1111111-1111-4111-8111-111111111111', '當失智長輩重複說「我要回家」時，較合適的第一步是？', '先回應感受，能降低焦慮並建立安全感。', 0, 20),
  ('e1000000-0000-4000-8000-000000000002', 'd1111111-1111-4111-8111-111111111111', '面對失智者的行為，照顧者應優先思考什麼？', '行為可能是在傳達尚未被滿足的需要。', 1, 20),
  ('e1000000-0000-4000-8000-000000000003', 'd1111111-1111-4111-8111-111111111111', '哪一種溝通方式較能保留失智者的尊嚴？', '簡短、尊重、一次說一件事，通常更容易理解。', 2, 20),
  ('e1000000-0000-4000-8000-000000000004', 'd1111111-1111-4111-8111-111111111111', '當對方情緒升高時，照顧者可以怎麼做？', '放慢速度與降低刺激，比爭辯對錯更能幫助情緒穩定。', 3, 20),
  ('e1000000-0000-4000-8000-000000000005', 'd1111111-1111-4111-8111-111111111111', '這堂封閉測試課完成後會取得什麼？', '測試課只發歲悅學苑完課證明，不標示長照積分。', 4, 20)
on conflict (course_id, position) do nothing;

insert into public.quiz_options (id, question_id, label, is_correct, position) values
  ('f1010000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','立刻糾正他現在就在家',false,0),
  ('f1010000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001','先回應「你是不是很想家、很不安心？」',true,1),
  ('f1010000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000001','完全不回應',false,2),
  ('f1020000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','他是不是故意搗蛋',false,0),
  ('f1020000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002','行為背後可能有什麼需要',true,1),
  ('f1020000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000002','如何讓他立刻停止',false,2),
  ('f1030000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000003','一次給很多指令，節省時間',false,0),
  ('f1030000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003','用簡短句子，一次說一件事',true,1),
  ('f1030000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000003','在其他人面前責備',false,2),
  ('f1040000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000004','提高音量壓過對方',false,0),
  ('f1040000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000004','放慢速度、降低刺激並保持安全距離',true,1),
  ('f1040000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000004','持續爭辯誰對誰錯',false,2),
  ('f1050000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000005','長照積分證書',false,0),
  ('f1050000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000005','歲悅學苑完課證明',true,1),
  ('f1050000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000005','醫事人員執照',false,2)
on conflict (question_id, position) do nothing;

create trigger video_assets_updated_at before update on public.video_assets for each row execute function private.set_updated_at();

-- 2026 新專案不再自動把新資料表暴露到 Data API，權限必須明確授予。
grant usage on schema public to anon, authenticated, service_role;
grant all privileges on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

grant select on public.courses, public.course_modules, public.lessons to anon;
grant select on public.profiles, public.organizations, public.organization_members,
  public.courses, public.course_modules, public.lessons, public.live_sessions,
  public.enrollments, public.course_assignments, public.learning_events,
  public.playback_sessions, public.playback_segments, public.live_attendance_events,
  public.quiz_attempts, public.satisfaction_responses, public.orders, public.order_items,
  public.entitlements, public.subscriptions, public.refunds, public.certificates,
  public.accreditation_exports, public.audit_events, public.platform_settings,
  public.video_assets, public.quiz_questions, public.presence_challenges, public.payment_events
to authenticated;
grant update (full_name, avatar_url, phone, locale, timezone) on public.profiles to authenticated;
