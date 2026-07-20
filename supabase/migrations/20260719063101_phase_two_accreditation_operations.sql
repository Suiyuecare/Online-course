-- 歲悅學苑第二階段：正式錄播積分課、加密報名資料、資格審核與送審匯出。

alter table public.courses drop constraint if exists courses_pass_score_check;
alter table public.courses
  add constraint courses_pass_score_check check (pass_score between 60 and 100),
  add column if not exists organizer_name text not null default '歲悅學苑',
  add column if not exists accreditation_authority text,
  add column if not exists accreditation_category text,
  add column if not exists accreditation_status text not null default 'not_submitted'
    check (accreditation_status in ('not_submitted', 'preparing', 'submitted', 'approved', 'rejected', 'expired')),
  add column if not exists accreditation_valid_from date,
  add column if not exists accreditation_valid_until date,
  add column if not exists registration_requirements jsonb not null default '{}'::jsonb,
  add constraint courses_accreditation_dates_check
    check (accreditation_valid_until is null or accreditation_valid_from is null or accreditation_valid_until >= accreditation_valid_from);

-- 舊欄位是固定以 80 分產生；第二階段改為依每門課 pass_score 由伺服器判定。
alter table public.quiz_attempts drop column if exists passed;
alter table public.quiz_attempts add column passed boolean not null default false;
update public.quiz_attempts qa
set passed = coalesce(qa.score, 0) >= c.pass_score
from public.enrollments e
join public.courses c on c.id = e.course_id
where e.id = qa.enrollment_id;

create table public.accreditation_registrations (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null unique references public.enrollments(id) on delete cascade,
  learner_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'needs_correction', 'verified', 'rejected')),
  personnel_category text not null,
  national_id_masked text not null,
  submitted_at timestamptz,
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  correction_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (learner_id, course_id)
);
create index accreditation_registrations_course_status_idx
  on public.accreditation_registrations (course_id, status, updated_at desc);

create table public.lesson_progress (
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  learner_id uuid not null references auth.users(id) on delete cascade,
  valid_watch_seconds integer not null default 0 check (valid_watch_seconds >= 0),
  last_position_seconds integer not null default 0 check (last_position_seconds >= 0),
  updated_at timestamptz not null default now(),
  primary key (enrollment_id, lesson_id)
);
insert into public.lesson_progress (enrollment_id, lesson_id, learner_id, valid_watch_seconds, last_position_seconds)
select e.id, e.last_lesson_id, e.learner_id, least(e.valid_watch_seconds, l.duration_seconds), e.last_position_seconds
from public.enrollments e join public.lessons l on l.id = e.last_lesson_id
where e.last_lesson_id is not null
on conflict do nothing;

create table private.learner_accreditation_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  national_id_fingerprint text not null unique,
  encrypted_payload text not null,
  encryption_version smallint not null default 1 check (encryption_version > 0),
  updated_at timestamptz not null default now()
);
revoke all on table private.learner_accreditation_profiles from public, anon, authenticated;

create or replace function public.store_accreditation_profile(
  target_user_id uuid,
  target_fingerprint text,
  target_encrypted_payload text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.learner_accreditation_profiles (user_id, national_id_fingerprint, encrypted_payload)
  values (target_user_id, target_fingerprint, target_encrypted_payload)
  on conflict (user_id) do update set
    national_id_fingerprint = excluded.national_id_fingerprint,
    encrypted_payload = excluded.encrypted_payload,
    encryption_version = private.learner_accreditation_profiles.encryption_version + 1,
    updated_at = now();
end;
$$;

create or replace function public.get_accreditation_profile(target_user_id uuid)
returns table (user_id uuid, encrypted_payload text, encryption_version smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.encrypted_payload, p.encryption_version
  from private.learner_accreditation_profiles p
  where p.user_id = target_user_id
$$;

revoke all on function public.store_accreditation_profile(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_accreditation_profile(uuid) from public, anon, authenticated;
grant execute on function public.store_accreditation_profile(uuid, text, text) to service_role;
grant execute on function public.get_accreditation_profile(uuid) to service_role;

alter table public.certificates
  add column if not exists certificate_kind text not null default 'completion'
    check (certificate_kind in ('completion', 'accreditation')),
  add column if not exists accreditation_number_snapshot text,
  add column if not exists accreditation_points_snapshot numeric(5,2),
  add column if not exists accreditation_authority_snapshot text;

alter table public.accreditation_registrations enable row level security;
alter table public.lesson_progress enable row level security;
create policy "learners read own accreditation registration"
  on public.accreditation_registrations for select to authenticated
  using (learner_id = (select auth.uid()) or private.is_platform_staff());
create policy "learners read own lesson progress"
  on public.lesson_progress for select to authenticated
  using (learner_id = (select auth.uid()) or private.is_platform_staff());

-- 報名與審核都經由伺服器驗證後寫入，前端不直接新增或修改。
grant select on public.accreditation_registrations to authenticated;
grant select on public.lesson_progress to authenticated;
grant all on public.accreditation_registrations to service_role;
grant all on public.lesson_progress to service_role;
grant all on private.learner_accreditation_profiles to service_role;

create trigger accreditation_registrations_updated_at
before update on public.accreditation_registrations
for each row execute function private.set_updated_at();

create or replace function private.validate_accredited_recorded_course_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published' and new.accredited then
    if new.accreditation_status <> 'approved'
      or nullif(trim(coalesce(new.accreditation_number, '')), '') is null
      or new.accreditation_points <= 0 then
      raise exception 'Accredited courses require approved status, approval number and points before publication';
    end if;
    if not exists (select 1 from public.quiz_questions q where q.course_id = new.id and q.active)
      or coalesce((select sum(q.points) from public.quiz_questions q where q.course_id = new.id and q.active), 0) <> 100 then
      raise exception 'Accredited courses require an active quiz worth exactly 100 points before publication';
    end if;
  end if;
  return new;
end;
$$;
create trigger validate_accredited_recorded_course_publication
before insert or update of status, accredited, accreditation_status, accreditation_number, accreditation_points
on public.courses
for each row execute function private.validate_accredited_recorded_course_publication();

grant select on public.courses, public.course_modules, public.lessons,
  public.quiz_questions, public.quiz_options to anon, authenticated;
grant all on public.courses, public.course_modules, public.lessons,
  public.quiz_questions, public.quiz_options, public.accreditation_exports to service_role;

create or replace function public.duplicate_course_as_draft(source_course_id uuid, target_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source public.courses%rowtype;
  new_course_id uuid;
  old_module record;
  new_module_id uuid;
  old_lesson record;
  old_question record;
  new_question_id uuid;
  old_option record;
begin
  select * into source from public.courses where id = source_course_id;
  if source.id is null then raise exception 'COURSE_NOT_FOUND'; end if;

  insert into public.courses (
    slug, title, subtitle, description, delivery, status, price_twd, subscription_eligible,
    accredited, accreditation_points, pass_score, enforce_single_playback, created_by,
    version, satisfaction_required, completion_percent, organizer_name,
    accreditation_status, registration_requirements
  ) values (
    left(source.slug, 80) || '-copy-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    left(source.title || '（副本）', 120), source.subtitle, source.description, source.delivery, 'draft',
    source.price_twd, false, source.accredited, source.accreditation_points, source.pass_score,
    source.enforce_single_playback, target_actor_id, source.version + 1, source.satisfaction_required,
    source.completion_percent, source.organizer_name, 'not_submitted', source.registration_requirements
  ) returning id into new_course_id;

  for old_module in select * from public.course_modules where course_id = source_course_id order by position loop
    insert into public.course_modules (course_id, title, position)
    values (new_course_id, old_module.title, old_module.position) returning id into new_module_id;
    for old_lesson in select * from public.lessons where module_id = old_module.id order by position loop
      insert into public.lessons (module_id, title, position, duration_seconds, is_preview, playback_speed_locked, seeking_disabled)
      values (new_module_id, old_lesson.title, old_lesson.position, old_lesson.duration_seconds,
        old_lesson.is_preview, old_lesson.playback_speed_locked, old_lesson.seeking_disabled);
    end loop;
  end loop;

  for old_question in select * from public.quiz_questions where course_id = source_course_id order by position loop
    insert into public.quiz_questions (course_id, prompt, explanation, position, points, active)
    values (new_course_id, old_question.prompt, old_question.explanation, old_question.position, old_question.points, old_question.active)
    returning id into new_question_id;
    for old_option in select * from public.quiz_options where question_id = old_question.id order by position loop
      insert into public.quiz_options (question_id, label, is_correct, position)
      values (new_question_id, old_option.label, old_option.is_correct, old_option.position);
    end loop;
  end loop;

  insert into public.audit_events (actor_id, action, target_type, target_id, after_data)
  values (target_actor_id, 'course.duplicated', 'course', new_course_id::text, jsonb_build_object('source_course_id', source_course_id));
  return new_course_id;
end;
$$;
revoke all on function public.duplicate_course_as_draft(uuid, uuid) from public, anon, authenticated;
grant execute on function public.duplicate_course_as_draft(uuid, uuid) to service_role;

create or replace function public.credit_lesson_progress(
  target_enrollment_id uuid,
  target_lesson_id uuid,
  target_position_seconds integer,
  target_credit_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_enrollment public.enrollments%rowtype;
  lesson_duration integer;
  course_duration integer;
  credited_total integer;
begin
  if target_credit_seconds < 0 or target_credit_seconds > 900 then raise exception 'INVALID_CREDIT_SECONDS'; end if;
  select e.* into target_enrollment from public.enrollments e where e.id = target_enrollment_id for update;
  select l.duration_seconds into lesson_duration
  from public.lessons l join public.course_modules m on m.id = l.module_id
  where l.id = target_lesson_id and m.course_id = target_enrollment.course_id;
  if lesson_duration is null then raise exception 'LESSON_ENROLLMENT_MISMATCH'; end if;

  insert into public.lesson_progress (enrollment_id, lesson_id, learner_id, valid_watch_seconds, last_position_seconds)
  values (target_enrollment_id, target_lesson_id, target_enrollment.learner_id,
    least(lesson_duration, target_credit_seconds), least(lesson_duration, greatest(0, target_position_seconds)))
  on conflict (enrollment_id, lesson_id) do update set
    valid_watch_seconds = least(lesson_duration, public.lesson_progress.valid_watch_seconds + excluded.valid_watch_seconds),
    last_position_seconds = excluded.last_position_seconds,
    updated_at = now();

  select coalesce(sum(lp.valid_watch_seconds), 0) into credited_total
  from public.lesson_progress lp where lp.enrollment_id = target_enrollment_id;
  select coalesce(sum(l.duration_seconds), 0) into course_duration
  from public.course_modules m join public.lessons l on l.module_id = m.id
  where m.course_id = target_enrollment.course_id and not l.is_preview;
  update public.enrollments set
    valid_watch_seconds = credited_total,
    progress_percent = least(100, round(credited_total::numeric / greatest(1, course_duration) * 100)::integer),
    last_position_seconds = least(lesson_duration, greatest(0, target_position_seconds)),
    last_lesson_id = target_lesson_id,
    updated_at = now()
  where id = target_enrollment_id;
end;
$$;
revoke all on function public.credit_lesson_progress(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.credit_lesson_progress(uuid, uuid, integer, integer) to service_role;
