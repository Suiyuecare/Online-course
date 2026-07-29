-- A purchased recorded or hybrid course can be sold before its scheduled
-- content release. The browser may show a countdown, but every learning
-- mutation remains server-authoritative and fail-closed until release.

grant select (content_available_at)
  on public.course_versions to authenticated;

create or replace function internal.require_content_release_before_publish()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'published'
     and new.delivery_type in ('recorded', 'hybrid')
     and new.content_available_at is null
  then
    raise exception 'COURSE_CONTENT_RELEASE_REQUIRED';
  end if;
  return new;
end
$$;
revoke all on function internal.require_content_release_before_publish()
  from public, anon, authenticated, service_role;

create trigger require_content_release_before_publish
before insert or update of status, delivery_type, content_available_at
on public.course_versions
for each row execute function
  internal.require_content_release_before_publish();

create or replace function internal.assert_enrollment_content_available(
  target_enrollment uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  actor uuid := internal.current_person_id();
  release_at timestamptz;
begin
  select version.content_available_at into release_at
  from public.enrollments enrollment
  join public.entitlements entitlement
    on entitlement.id = enrollment.entitlement_id
  join public.course_versions version
    on version.id = enrollment.course_version_id
  where enrollment.id = target_enrollment
    and enrollment.person_id = actor
    and enrollment.status not in ('rejected', 'revoked', 'refunded')
    and entitlement.person_id = actor
    and entitlement.status = 'active';

  if not found then
    raise exception 'LEARNER_WORKSPACE_NOT_AUTHORIZED';
  end if;
  if release_at is not null and release_at > clock_timestamp() then
    raise exception 'COURSE_CONTENT_NOT_AVAILABLE';
  end if;
end
$$;
revoke all on function
  internal.assert_enrollment_content_available(uuid)
  from public, anon, authenticated, service_role;

alter function internal.authorize_recorded_playback(uuid, uuid)
  rename to authorize_recorded_playback_without_content_release_gate;
revoke all on function
  internal.authorize_recorded_playback_without_content_release_gate(
    uuid, uuid
  ) from public, anon, authenticated, service_role;

create or replace function internal.authorize_recorded_playback(
  target_enrollment uuid,
  lesson_video_version uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
begin
  perform internal.assert_enrollment_content_available(target_enrollment);
  return internal.authorize_recorded_playback_without_content_release_gate(
    target_enrollment, lesson_video_version
  );
end
$$;
revoke all on function internal.authorize_recorded_playback(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.authorize_recorded_playback(uuid, uuid)
  to authenticated, service_role;

alter function internal.record_playback_heartbeat(
  uuid, uuid, bigint, bigint, numeric, boolean, boolean, boolean, text
) rename to record_playback_heartbeat_without_content_release_gate;
revoke all on function
  internal.record_playback_heartbeat_without_content_release_gate(
    uuid, uuid, bigint, bigint, numeric, boolean, boolean, boolean, text
  ) from public, anon, authenticated, service_role;

create or replace function internal.record_playback_heartbeat(
  target_enrollment uuid,
  playback_session uuid,
  reported_lease_epoch bigint,
  reported_sequence bigint,
  media_position numeric,
  is_playing boolean,
  is_visible boolean,
  is_online boolean,
  challenge_token text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
begin
  perform internal.assert_enrollment_content_available(target_enrollment);
  return internal.record_playback_heartbeat_without_content_release_gate(
    target_enrollment, playback_session, reported_lease_epoch,
    reported_sequence, media_position, is_playing, is_visible, is_online,
    challenge_token
  );
end
$$;
revoke all on function internal.record_playback_heartbeat(
  uuid, uuid, bigint, bigint, numeric, boolean, boolean, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function internal.record_playback_heartbeat(
  uuid, uuid, bigint, bigint, numeric, boolean, boolean, boolean, text
) to authenticated;

alter function internal.confirm_presence_challenge(uuid, text, uuid)
  rename to confirm_presence_challenge_without_content_release_gate;
revoke all on function
  internal.confirm_presence_challenge_without_content_release_gate(
    uuid, text, uuid
  ) from public, anon, authenticated, service_role;

create or replace function internal.confirm_presence_challenge(
  target_enrollment uuid,
  plain_token text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
begin
  perform internal.assert_enrollment_content_available(target_enrollment);
  return internal.confirm_presence_challenge_without_content_release_gate(
    target_enrollment, plain_token, idempotency
  );
end
$$;
revoke all on function internal.confirm_presence_challenge(
  uuid, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.confirm_presence_challenge(
  uuid, text, uuid
) to authenticated;

alter function internal.start_quiz_attempt(uuid, uuid)
  rename to start_quiz_attempt_without_content_release_gate;
revoke all on function
  internal.start_quiz_attempt_without_content_release_gate(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function internal.start_quiz_attempt(
  target_enrollment uuid,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, internal
as $$
begin
  perform internal.assert_enrollment_content_available(target_enrollment);
  return internal.start_quiz_attempt_without_content_release_gate(
    target_enrollment, idempotency
  );
end
$$;
revoke all on function internal.start_quiz_attempt(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.start_quiz_attempt(uuid, uuid)
  to authenticated;

alter function internal.submit_quiz_attempt(uuid, jsonb, uuid)
  rename to submit_quiz_attempt_without_content_release_gate;
revoke all on function
  internal.submit_quiz_attempt_without_content_release_gate(
    uuid, jsonb, uuid
  ) from public, anon, authenticated, service_role;

create or replace function internal.submit_quiz_attempt(
  target_attempt uuid,
  submitted_responses jsonb,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, internal
as $$
declare
  target_enrollment uuid;
begin
  select attempt.enrollment_id into target_enrollment
  from public.quiz_attempts attempt
  where attempt.id = target_attempt;
  if target_enrollment is null then
    raise exception 'QUIZ_NOT_AUTHORIZED';
  end if;
  perform internal.assert_enrollment_content_available(target_enrollment);
  return internal.submit_quiz_attempt_without_content_release_gate(
    target_attempt, submitted_responses, idempotency
  );
end
$$;
revoke all on function internal.submit_quiz_attempt(uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.submit_quiz_attempt(uuid, jsonb, uuid)
  to authenticated;

alter function internal.submit_survey(uuid, integer[], text, uuid)
  rename to submit_survey_without_content_release_gate;
revoke all on function
  internal.submit_survey_without_content_release_gate(
    uuid, integer[], text, uuid
  ) from public, anon, authenticated, service_role;

create or replace function internal.submit_survey(
  target_enrollment uuid,
  submitted_ratings integer[],
  submitted_comment text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
begin
  perform internal.assert_enrollment_content_available(target_enrollment);
  return internal.submit_survey_without_content_release_gate(
    target_enrollment, submitted_ratings, submitted_comment, idempotency
  );
end
$$;
revoke all on function internal.submit_survey(
  uuid, integer[], text, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.submit_survey(
  uuid, integer[], text, uuid
) to authenticated;

alter function internal.read_learner_runtime_gates(uuid)
  rename to read_learner_runtime_gates_without_content_release_gate;
revoke all on function
  internal.read_learner_runtime_gates_without_content_release_gate(uuid)
  from public, anon, authenticated, service_role;

create or replace function internal.read_learner_runtime_gates(
  target_enrollment uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, internal
as $$
declare
  actor uuid := internal.current_person_id();
  release_at timestamptz;
  content_available boolean;
  gates jsonb;
  locked_lessons jsonb;
begin
  select version.content_available_at into release_at
  from public.enrollments enrollment
  join public.entitlements entitlement
    on entitlement.id = enrollment.entitlement_id
  join public.course_versions version
    on version.id = enrollment.course_version_id
  where enrollment.id = target_enrollment
    and enrollment.person_id = actor
    and enrollment.status not in ('rejected', 'revoked', 'refunded')
    and entitlement.person_id = actor
    and entitlement.status = 'active';
  if not found then
    raise exception 'LEARNER_WORKSPACE_NOT_AUTHORIZED';
  end if;

  content_available :=
    release_at is null or release_at <= clock_timestamp();
  gates :=
    internal.read_learner_runtime_gates_without_content_release_gate(
      target_enrollment
    );

  if not content_available then
    select coalesce(
      jsonb_agg(
        lesson || jsonb_build_object(
          'locked', true,
          'lockReason', '課程尚未開放，請依開課倒數時間再回來'
        )
      ),
      '[]'::jsonb
    ) into locked_lessons
    from jsonb_array_elements(
      coalesce(gates -> 'lessonAccess', '[]'::jsonb)
    ) lesson;
    gates := jsonb_set(gates, '{lessonAccess}', locked_lessons, true);
  end if;

  return gates || jsonb_build_object(
    'contentAvailableAt', release_at,
    'contentAvailable', content_available
  );
end
$$;
revoke all on function internal.read_learner_runtime_gates(uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.read_learner_runtime_gates(uuid)
  to authenticated;

create or replace function internal.read_learner_course_material_reference(
  target_material uuid,
  target_person uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'COURSE_MATERIAL_SERVICE_REQUIRED';
  end if;
  select jsonb_build_object(
    'objectPath', material.promoted_object_path,
    'detectedMime', upload.detected_mime,
    'contentSha256', material.content_sha256
  ) into result
  from public.course_materials material
  join public.course_versions version
    on version.id = material.course_version_id
  join public.enrollments enrollment
    on enrollment.course_version_id = material.course_version_id
  join public.entitlements entitlement
    on entitlement.id = enrollment.entitlement_id
  join public.upload_quarantine upload
    on upload.promoted_object_path = material.promoted_object_path
  where material.id = target_material
    and enrollment.person_id = target_person
    and enrollment.status in ('active', 'completed')
    and entitlement.status = 'active'
    and (
      version.content_available_at is null
      or version.content_available_at <= clock_timestamp()
    )
    and material.scan_status = 'safe'
    and material.promoted_object_path is not null
    and upload.status = 'promoted'
    and upload.detected_mime is not null;
  if result is null then
    raise exception 'COURSE_MATERIAL_NOT_AUTHORIZED';
  end if;
  return result;
end
$$;
revoke all on function internal.read_learner_course_material_reference(
  uuid, uuid
) from public, anon, authenticated;

-- Append release metadata to the learner projections so both the dashboard
-- and the narrow RLS fallback can render an honest countdown.
create or replace view public.learner_dashboard
with (security_invoker = true)
as
select
  enrollment.id as enrollment_id,
  version.title as course_title,
  version.delivery_type,
  enrollment.status as enrollment_status,
  coalesce(progress.confirmed_valid_seconds, 0) as confirmed_valid_seconds,
  coalesce(requirement.required_watch_seconds, 0) as required_seconds,
  (
    select min(session.starts_at)
    from public.live_bookings booking
    join public.live_sessions session
      on session.id = booking.live_session_id
    where booking.enrollment_id = enrollment.id
      and (
        booking.status = 'confirmed'
        or (
          booking.status = 'held'
          and booking.hold_expires_at > clock_timestamp()
        )
      )
      and session.starts_at > now()
  ) as next_live_starts_at,
  case
    when exists (
      select 1
      from public.live_bookings booking
      join public.attendance_summaries attendance
        on attendance.live_booking_id = booking.id
      where booking.enrollment_id = enrollment.id
        and attendance.quarantined_at is not null
    ) then 'needs_correction'
    else certificate.current_status
  end as certificate_status,
  certificate.id as certificate_id,
  version.id as course_version_id,
  course.slug as course_slug,
  enrollment.completed_at,
  version.has_cover,
  enrollment.completion_due_at,
  version.content_available_at
from public.enrollments enrollment
join public.course_versions version
  on version.id = enrollment.course_version_id
join public.courses course
  on course.id = version.course_id
left join public.progress_summaries progress
  on progress.enrollment_id = enrollment.id
left join public.course_requirements requirement
  on requirement.course_version_id = version.id
left join public.certificates certificate
  on certificate.enrollment_id = enrollment.id;

grant select on public.learner_dashboard to authenticated;

create or replace view public.learner_course_access
with (security_invoker = true)
as
select
  enrollment.id as enrollment_id,
  version.title as course_title,
  version.delivery_type,
  (
    select lesson_video.id
    from public.modules module
    join public.lessons lesson on lesson.module_id = module.id
    join public.lesson_video_versions lesson_video
      on lesson_video.lesson_id = lesson.id
    where module.course_version_id = version.id
      and lesson_video.active
    order by module.sort_order, lesson.sort_order
    limit 1
  ) as first_lesson_video_version_id,
  enrollment.status as enrollment_status,
  version.content_available_at
from public.enrollments enrollment
join public.course_versions version
  on version.id = enrollment.course_version_id
join public.entitlements entitlement
  on entitlement.id = enrollment.entitlement_id
where entitlement.status = 'active';

grant select on public.learner_course_access to authenticated;
