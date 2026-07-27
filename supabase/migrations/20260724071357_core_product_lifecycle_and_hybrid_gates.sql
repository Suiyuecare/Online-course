-- Product integrity close-out:
-- 1. component-scoped hybrid progress and runtime prerequisite gates
-- 2. learner-owned B2C live-session replacement
-- 3. deterministic course-version lifecycle and catalog resolution

alter table public.hybrid_components
  add column recorded_required_watch_seconds integer not null default 0
    check (recorded_required_watch_seconds >= 0);

alter table public.hybrid_components
  add constraint hybrid_component_recorded_minutes_match_type
  check (
    (component_type = 'recorded')
    or recorded_required_watch_seconds = 0
  );

alter table public.lessons
  add column hybrid_component_id uuid
    references public.hybrid_components(id);

create index lessons_hybrid_component_lookup
  on public.lessons(hybrid_component_id)
  where hybrid_component_id is not null;

create table public.hybrid_configuration_revisions (
  id uuid primary key default gen_random_uuid(),
  course_version_id uuid not null references public.course_versions(id),
  configured_by uuid not null references public.people(id),
  idempotency_key uuid not null,
  configuration_snapshot jsonb not null
    check (jsonb_typeof(configuration_snapshot) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique (configured_by, idempotency_key)
);

create table public.live_booking_change_events (
  id uuid primary key default gen_random_uuid(),
  live_booking_id uuid not null references public.live_bookings(id),
  person_id uuid not null references public.people(id),
  previous_live_session_id uuid not null references public.live_sessions(id),
  replacement_live_session_id uuid not null references public.live_sessions(id),
  reason_kind text not null
    check (reason_kind in (
      'learner_change', 'provider_cancellation', 'paid_unfulfilled_recovery'
    )),
  idempotency_key uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  unique (person_id, idempotency_key)
);

create index live_booking_change_events_booking_time
  on public.live_booking_change_events(live_booking_id, occurred_at desc);

alter table public.hybrid_configuration_revisions enable row level security;
alter table public.live_booking_change_events enable row level security;
alter table public.hybrid_configuration_revisions force row level security;
alter table public.live_booking_change_events force row level security;

create trigger hybrid_configuration_revisions_append_only
before update or delete on public.hybrid_configuration_revisions
for each row execute function internal.prevent_append_only_change();
create trigger live_booking_change_events_append_only
before update or delete on public.live_booking_change_events
for each row execute function internal.prevent_append_only_change();

revoke all on public.hybrid_configuration_revisions
  from public, anon, authenticated;
revoke all on public.live_booking_change_events
  from public, anon, authenticated;
grant select, insert on public.hybrid_configuration_revisions
  to service_role;
grant select, insert on public.live_booking_change_events
  to service_role;

create or replace function internal.guard_lesson_hybrid_component()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  lesson_course_version uuid;
  component_row public.hybrid_components%rowtype;
  delivery text;
begin
  select module.course_version_id, version.delivery_type
    into lesson_course_version, delivery
  from public.modules module
  join public.course_versions version on version.id = module.course_version_id
  where module.id = new.module_id;

  if new.hybrid_component_id is null then
    return new;
  end if;
  if new.content_type <> 'video' or delivery <> 'hybrid' then
    raise exception 'HYBRID_COMPONENT_VIDEO_ONLY';
  end if;

  select * into component_row
  from public.hybrid_components component
  where component.id = new.hybrid_component_id;
  if not found
     or component_row.course_version_id <> lesson_course_version
     or component_row.component_type <> 'recorded'
  then
    raise exception 'HYBRID_LESSON_COMPONENT_MISMATCH';
  end if;
  return new;
end
$$;
revoke all on function internal.guard_lesson_hybrid_component()
  from public, anon, authenticated;

create trigger lesson_hybrid_component_guard
before insert or update of module_id, content_type, hybrid_component_id
on public.lessons
for each row execute function internal.guard_lesson_hybrid_component();

create or replace function internal.hybrid_component_confirmed_seconds(
  target_enrollment uuid,
  target_component uuid
)
returns integer
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select coalesce(sum(
    (manifest_entry.value ->> 'creditedSeconds')::integer
  ), 0)::integer
  from public.confirmed_watch_blocks block
  join public.presence_challenges challenge
    on challenge.id = block.presence_challenge_id
    and challenge.enrollment_id = block.enrollment_id
    and challenge.event_manifest_hash = block.event_manifest_hash
    and challenge.event_manifest_hash = encode(
      extensions.digest(challenge.event_manifest::text, 'sha256'), 'hex'
    )
  cross join lateral jsonb_array_elements(
    challenge.event_manifest
  ) manifest_entry(value)
  join public.lesson_video_versions video
    on video.id =
      (manifest_entry.value ->> 'videoVersionId')::uuid
  join public.lessons lesson on lesson.id = video.lesson_id
  join public.enrollments enrollment
    on enrollment.id = block.enrollment_id
  join public.hybrid_components component
    on component.id = target_component
  where block.enrollment_id = target_enrollment
    and lesson.hybrid_component_id = target_component
    and component.course_version_id = enrollment.course_version_id
    and component.component_type = 'recorded'
$$;
revoke all on function
  internal.hybrid_component_confirmed_seconds(uuid, uuid)
  from public, anon, authenticated;

create or replace function internal.hybrid_component_is_complete(
  target_enrollment uuid,
  target_component uuid
)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select coalesce((
    select case component.component_type
      when 'recorded' then
        internal.hybrid_component_confirmed_seconds(
          enrollment.id, component.id
        ) >= component.recorded_required_watch_seconds
      else exists (
        select 1
        from public.live_bookings booking
        join public.live_sessions session
          on session.id = booking.live_session_id
        join public.attendance_summaries attendance
          on attendance.live_booking_id = booking.id
        where booking.enrollment_id = enrollment.id
          and booking.live_component_id = component.id
          and booking.status in ('confirmed', 'attended')
          and session.status = 'ended'
          and attendance.qualified
          and attendance.quarantined_at is null
      )
    end
    from public.enrollments enrollment
    join public.hybrid_components component
      on component.course_version_id = enrollment.course_version_id
    where enrollment.id = target_enrollment
      and component.id = target_component
  ), false)
$$;
revoke all on function internal.hybrid_component_is_complete(uuid, uuid)
  from public, anon, authenticated;

create or replace function internal.hybrid_component_prerequisites_met(
  target_enrollment uuid,
  target_component uuid
)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select coalesce((
    select not exists (
      select 1
      from public.component_prerequisites edge
      where edge.course_version_id = enrollment.course_version_id
        and edge.dependent_component_id = target_component
        and not internal.hybrid_component_is_complete(
          enrollment.id, edge.prerequisite_component_id
        )
    )
    from public.enrollments enrollment
    join public.hybrid_components component
      on component.id = target_component
      and component.course_version_id = enrollment.course_version_id
    where enrollment.id = target_enrollment
  ), false)
$$;
revoke all on function
  internal.hybrid_component_prerequisites_met(uuid, uuid)
  from public, anon, authenticated;

create or replace function internal.hybrid_required_components_complete(
  target_enrollment uuid
)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select coalesce((
    select case version.delivery_type
      when 'hybrid' then not exists (
        select 1
        from public.hybrid_components component
        where component.course_version_id = enrollment.course_version_id
          and component.required
          and not internal.hybrid_component_is_complete(
            enrollment.id, component.id
          )
      )
      else true
    end
    from public.enrollments enrollment
    join public.course_versions version
      on version.id = enrollment.course_version_id
    where enrollment.id = target_enrollment
  ), false)
$$;
revoke all on function
  internal.hybrid_required_components_complete(uuid)
  from public, anon, authenticated;

create or replace function internal.assert_hybrid_lesson_access(
  target_enrollment uuid,
  lesson_video_version uuid
)
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  delivery text;
  component_id uuid;
begin
  select version.delivery_type, lesson.hybrid_component_id
    into delivery, component_id
  from public.lesson_video_versions video
  join public.lessons lesson on lesson.id = video.lesson_id
  join public.modules module on module.id = lesson.module_id
  join public.course_versions version on version.id = module.course_version_id
  join public.enrollments enrollment
    on enrollment.course_version_id = version.id
  join public.entitlements entitlement
    on entitlement.id = enrollment.entitlement_id
  where video.id = lesson_video_version
    and enrollment.id = target_enrollment
    and enrollment.person_id = actor
    and enrollment.status = 'active'
    and entitlement.status = 'active';
  if not found then
    raise exception 'PLAYBACK_NOT_AUTHORIZED';
  end if;
  if delivery = 'hybrid' then
    if component_id is null then
      raise exception 'HYBRID_LESSON_COMPONENT_UNCONFIGURED';
    end if;
    if not internal.hybrid_component_prerequisites_met(
      target_enrollment, component_id
    ) then
      raise exception 'HYBRID_COMPONENT_PREREQUISITES_INCOMPLETE';
    end if;
  end if;
  return true;
end
$$;
revoke all on function internal.assert_hybrid_lesson_access(uuid, uuid)
  from public, anon, authenticated;

create or replace function internal.assert_live_component_access(
  target_enrollment uuid,
  target_component uuid
)
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  delivery text;
begin
  select version.delivery_type into delivery
  from public.enrollments enrollment
  join public.course_versions version
    on version.id = enrollment.course_version_id
  where enrollment.id = target_enrollment;
  if delivery = 'hybrid' then
    if target_component is null
       or not exists (
         select 1
         from public.hybrid_components component
         join public.enrollments enrollment
           on enrollment.course_version_id = component.course_version_id
         where enrollment.id = target_enrollment
           and component.id = target_component
           and component.component_type = 'live'
       )
    then
      raise exception 'HYBRID_LIVE_COMPONENT_UNCONFIGURED';
    end if;
    if not internal.hybrid_component_prerequisites_met(
      target_enrollment, target_component
    ) then
      raise exception 'HYBRID_COMPONENT_PREREQUISITES_INCOMPLETE';
    end if;
  end if;
  return true;
end
$$;
revoke all on function internal.assert_live_component_access(uuid, uuid)
  from public, anon, authenticated;

create or replace function internal.configure_hybrid_learning_graph(
  target_version uuid,
  component_specs jsonb,
  lesson_mappings jsonb,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  version_row public.course_versions%rowtype;
  requirement_seconds integer;
  existing_revision public.hybrid_configuration_revisions%rowtype;
  configuration jsonb := jsonb_build_object(
    'components', component_specs,
    'lessonMappings', lesson_mappings
  );
  component_item jsonb;
  mapping_item jsonb;
  recorded_component_count integer;
  video_lesson_count integer;
  required_component_total integer;
begin
  if not internal.has_staff_role('course_admin')
     or jsonb_typeof(component_specs) <> 'array'
     or jsonb_typeof(lesson_mappings) <> 'array'
  then
    raise exception 'HYBRID_CONFIGURATION_REJECTED';
  end if;

  select * into existing_revision
  from public.hybrid_configuration_revisions revision
  where revision.configured_by = actor
    and revision.idempotency_key = idempotency;
  if found then
    if existing_revision.course_version_id <> target_version
       or existing_revision.configuration_snapshot is distinct from
         configuration
    then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object(
      'courseVersionId', target_version,
      'configurationRevisionId', existing_revision.id
    );
  end if;

  select * into version_row
  from public.course_versions version
  where version.id = target_version
  for update;
  if not found
     or version_row.status <> 'draft'
     or version_row.delivery_type <> 'hybrid'
     or (
       version_row.created_by <> actor
       and not internal.has_staff_role('platform_admin')
     )
  then
    raise exception 'HYBRID_DRAFT_REQUIRED';
  end if;

  select requirement.required_watch_seconds into requirement_seconds
  from public.course_requirements requirement
  where requirement.course_version_id = target_version
    and requirement.locked_at is null
  for update;
  if requirement_seconds is null or requirement_seconds <= 0 then
    raise exception 'HYBRID_TOTAL_WATCH_REQUIREMENT_INVALID';
  end if;

  select count(*) into recorded_component_count
  from public.hybrid_components component
  where component.course_version_id = target_version
    and component.component_type = 'recorded';
  if recorded_component_count = 0
     or jsonb_array_length(component_specs) <> recorded_component_count
     or (
       select count(distinct item.value ->> 'componentId')
       from jsonb_array_elements(component_specs) item
     ) <> recorded_component_count
     or exists (
       select 1
       from jsonb_array_elements(component_specs) item
       where coalesce(item.value ->> 'requiredWatchSeconds', '')
               !~ '^[0-9]+$'
          or not exists (
            select 1
            from public.hybrid_components component
            where component.id =
                (item.value ->> 'componentId')::uuid
              and component.course_version_id = target_version
              and component.component_type = 'recorded'
          )
     )
  then
    raise exception 'HYBRID_COMPONENT_REQUIREMENTS_INVALID';
  end if;

  select coalesce(sum(
    case when component.required
      then (item.value ->> 'requiredWatchSeconds')::integer
      else 0
    end
  ), 0)::integer into required_component_total
  from jsonb_array_elements(component_specs) item
  join public.hybrid_components component
    on component.id = (item.value ->> 'componentId')::uuid;
  if required_component_total <> requirement_seconds
     or exists (
       select 1
       from jsonb_array_elements(component_specs) item
       join public.hybrid_components component
         on component.id = (item.value ->> 'componentId')::uuid
       where component.required
         and (item.value ->> 'requiredWatchSeconds')::integer <= 0
     )
  then
    raise exception 'HYBRID_TOTAL_WATCH_REQUIREMENT_MISMATCH';
  end if;

  for component_item in
    select value from jsonb_array_elements(component_specs)
  loop
    update public.hybrid_components component
    set recorded_required_watch_seconds =
      (component_item ->> 'requiredWatchSeconds')::integer
    where component.id = (component_item ->> 'componentId')::uuid
      and component.course_version_id = target_version
      and component.component_type = 'recorded';
  end loop;

  select count(*) into video_lesson_count
  from public.modules module
  join public.lessons lesson on lesson.module_id = module.id
  where module.course_version_id = target_version
    and lesson.content_type = 'video'
    and lesson.archived_at is null;
  if video_lesson_count = 0
     or jsonb_array_length(lesson_mappings) <> video_lesson_count
     or (
       select count(distinct item.value ->> 'lessonId')
       from jsonb_array_elements(lesson_mappings) item
     ) <> video_lesson_count
     or exists (
       select 1
       from jsonb_array_elements(lesson_mappings) item
       where not exists (
         select 1
         from public.lessons lesson
         join public.modules module on module.id = lesson.module_id
         join public.hybrid_components component
           on component.id =
             (item.value ->> 'componentId')::uuid
         where lesson.id = (item.value ->> 'lessonId')::uuid
           and lesson.content_type = 'video'
           and lesson.archived_at is null
           and module.course_version_id = target_version
           and component.course_version_id = target_version
           and component.component_type = 'recorded'
       )
     )
  then
    raise exception 'HYBRID_LESSON_MAPPING_INVALID';
  end if;

  update public.lessons lesson
  set hybrid_component_id = null
  from public.modules module
  where module.id = lesson.module_id
    and module.course_version_id = target_version
    and lesson.content_type = 'video';
  for mapping_item in
    select value from jsonb_array_elements(lesson_mappings)
  loop
    update public.lessons lesson
    set hybrid_component_id =
      (mapping_item ->> 'componentId')::uuid
    from public.modules module
    where lesson.id = (mapping_item ->> 'lessonId')::uuid
      and module.id = lesson.module_id
      and module.course_version_id = target_version;
  end loop;

  if exists (
    select 1
    from public.hybrid_components component
    where component.course_version_id = target_version
      and component.component_type = 'recorded'
      and component.required
      and not exists (
        select 1
        from public.lessons lesson
        join public.modules module on module.id = lesson.module_id
        where module.course_version_id = target_version
          and lesson.hybrid_component_id = component.id
          and lesson.content_type = 'video'
          and lesson.archived_at is null
      )
  ) then
    raise exception 'HYBRID_REQUIRED_COMPONENT_HAS_NO_VIDEO';
  end if;

  insert into public.hybrid_configuration_revisions (
    course_version_id, configured_by, idempotency_key,
    configuration_snapshot
  ) values (
    target_version, actor, idempotency, configuration
  ) returning * into existing_revision;
  perform internal.append_audit_event(
    actor, 'course.hybrid_graph_configured', 'course_version',
    target_version::text,
    'component-scoped minutes and lesson mapping configured',
    null,
    jsonb_build_object(
      'configurationRevisionId', existing_revision.id,
      'recordedComponentCount', recorded_component_count,
      'videoLessonCount', video_lesson_count,
      'requiredWatchSeconds', requirement_seconds
    )
  );
  return jsonb_build_object(
    'courseVersionId', target_version,
    'configurationRevisionId', existing_revision.id
  );
end
$$;
revoke all on function internal.configure_hybrid_learning_graph(
  uuid, jsonb, jsonb, uuid
) from public, anon, authenticated;
grant execute on function internal.configure_hybrid_learning_graph(
  uuid, jsonb, jsonb, uuid
) to authenticated;

create or replace function public.configure_hybrid_learning_graph(
  p_course_version_id uuid,
  p_component_requirements jsonb,
  p_lesson_mappings jsonb,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.configure_hybrid_learning_graph(
    p_course_version_id, p_component_requirements,
    p_lesson_mappings, p_idempotency_key
  )
$$;
revoke all on function public.configure_hybrid_learning_graph(
  uuid, jsonb, jsonb, uuid
) from public, anon;
grant execute on function public.configure_hybrid_learning_graph(
  uuid, jsonb, jsonb, uuid
) to authenticated;

create or replace function internal.validate_hybrid_before_publish()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  global_required_seconds integer;
  scoped_required_seconds integer;
begin
  if new.status <> 'published'
     or old.status = 'published'
     or new.delivery_type <> 'hybrid'
  then
    return new;
  end if;

  select requirement.required_watch_seconds
    into global_required_seconds
  from public.course_requirements requirement
  where requirement.course_version_id = new.id;
  select coalesce(sum(component.recorded_required_watch_seconds), 0)::integer
    into scoped_required_seconds
  from public.hybrid_components component
  where component.course_version_id = new.id
    and component.component_type = 'recorded'
    and component.required;

  if global_required_seconds is null
     or global_required_seconds <= 0
     or scoped_required_seconds <> global_required_seconds
     or exists (
       select 1
       from public.hybrid_components component
       where component.course_version_id = new.id
         and component.component_type = 'recorded'
         and component.required
         and (
           component.recorded_required_watch_seconds <= 0
           or not exists (
             select 1
             from public.lessons lesson
             join public.modules module on module.id = lesson.module_id
             where module.course_version_id = new.id
               and lesson.hybrid_component_id = component.id
               and lesson.content_type = 'video'
               and lesson.archived_at is null
           )
         )
     )
     or exists (
       select 1
       from public.lessons lesson
       join public.modules module on module.id = lesson.module_id
       where module.course_version_id = new.id
         and lesson.content_type = 'video'
         and lesson.archived_at is null
         and lesson.hybrid_component_id is null
     )
  then
    raise exception 'HYBRID_COMPONENT_CONFIGURATION_INCOMPLETE';
  end if;
  return new;
end
$$;
revoke all on function internal.validate_hybrid_before_publish()
  from public, anon, authenticated;

create trigger validate_hybrid_publish_transition
before update of status on public.course_versions
for each row execute function internal.validate_hybrid_before_publish();

-- Keep every existing authorization path, including provider URL refreshes,
-- behind the same component graph gate. Renamed implementations are private
-- implementation details and are deliberately not executable by API roles.
alter function internal.authorize_recorded_playback(uuid, uuid)
  rename to authorize_recorded_playback_without_hybrid_gate;
revoke all on function
  internal.authorize_recorded_playback_without_hybrid_gate(uuid, uuid)
  from public, anon, authenticated, service_role;

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
  perform internal.assert_hybrid_lesson_access(
    target_enrollment, lesson_video_version
  );
  return internal.authorize_recorded_playback_without_hybrid_gate(
    target_enrollment, lesson_video_version
  );
end
$$;
revoke all on function internal.authorize_recorded_playback(uuid, uuid)
  from public, anon;
grant execute on function internal.authorize_recorded_playback(uuid, uuid)
  to authenticated, service_role;

alter function internal.issue_live_join_lease(uuid, text, uuid)
  rename to issue_live_join_lease_without_hybrid_gate;
revoke all on function
  internal.issue_live_join_lease_without_hybrid_gate(uuid, text, uuid)
  from public, anon, authenticated, service_role;

create or replace function internal.issue_live_join_lease(
  target_session uuid,
  submitted_device_hash text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  actor uuid := internal.current_person_id();
  target_enrollment uuid;
  target_component uuid;
begin
  select booking.enrollment_id, booking.live_component_id
    into target_enrollment, target_component
  from public.live_bookings booking
  where booking.live_session_id = target_session
    and booking.person_id = actor
    and booking.status = 'confirmed';
  if target_enrollment is null then
    raise exception 'LIVE_BOOKING_REQUIRED';
  end if;
  perform internal.assert_live_component_access(
    target_enrollment, target_component
  );
  return internal.issue_live_join_lease_without_hybrid_gate(
    target_session, submitted_device_hash, idempotency
  );
end
$$;
revoke all on function internal.issue_live_join_lease(uuid, text, uuid)
  from public, anon;
grant execute on function internal.issue_live_join_lease(uuid, text, uuid)
  to authenticated;

alter function internal.record_live_check_event(uuid, text, boolean, uuid)
  rename to record_live_check_event_without_hybrid_gate;
revoke all on function
  internal.record_live_check_event_without_hybrid_gate(
    uuid, text, boolean, uuid
  ) from public, anon, authenticated, service_role;

create or replace function internal.record_live_check_event(
  target_session uuid,
  event_kind text,
  device_checked boolean,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  actor uuid := internal.current_person_id();
  target_enrollment uuid;
  target_component uuid;
begin
  select booking.enrollment_id, booking.live_component_id
    into target_enrollment, target_component
  from public.live_bookings booking
  where booking.live_session_id = target_session
    and booking.person_id = actor
    and booking.status = 'confirmed';
  if target_enrollment is null then
    raise exception 'LIVE_BOOKING_REQUIRED';
  end if;
  perform internal.assert_live_component_access(
    target_enrollment, target_component
  );
  return internal.record_live_check_event_without_hybrid_gate(
    target_session, event_kind, device_checked, idempotency
  );
end
$$;
revoke all on function internal.record_live_check_event(
  uuid, text, boolean, uuid
) from public, anon;
grant execute on function internal.record_live_check_event(
  uuid, text, boolean, uuid
) to authenticated;

alter function internal.select_assignment_live_session(
  uuid, uuid, uuid, uuid
) rename to select_assignment_live_session_without_hybrid_gate;
revoke all on function
  internal.select_assignment_live_session_without_hybrid_gate(
    uuid, uuid, uuid, uuid
  ) from public, anon, authenticated, service_role;

create or replace function internal.select_assignment_live_session(
  target_assignment uuid,
  target_session uuid,
  target_component uuid,
  idempotency uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  target_enrollment uuid;
begin
  select enrollment.id into target_enrollment
  from public.entitlements entitlement
  join public.enrollments enrollment
    on enrollment.entitlement_id = entitlement.id
  where entitlement.source_type = 'organization_assignment'
    and entitlement.source_id = target_assignment;
  if target_enrollment is null then
    raise exception 'ASSIGNMENT_ENROLLMENT_REQUIRED';
  end if;
  perform internal.assert_live_component_access(
    target_enrollment, target_component
  );
  return internal.select_assignment_live_session_without_hybrid_gate(
    target_assignment, target_session, target_component, idempotency
  );
end
$$;
revoke all on function internal.select_assignment_live_session(
  uuid, uuid, uuid, uuid
) from public, anon;
grant execute on function internal.select_assignment_live_session(
  uuid, uuid, uuid, uuid
) to authenticated;

alter function internal.change_assignment_live_session(uuid, uuid, uuid)
  rename to change_assignment_live_session_without_hybrid_gate;
revoke all on function
  internal.change_assignment_live_session_without_hybrid_gate(
    uuid, uuid, uuid
  ) from public, anon, authenticated, service_role;

create or replace function internal.change_assignment_live_session(
  target_booking uuid,
  replacement_session uuid,
  idempotency uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  target_enrollment uuid;
  target_component uuid;
begin
  select booking.enrollment_id, booking.live_component_id
    into target_enrollment, target_component
  from public.live_bookings booking
  where booking.id = target_booking;
  if target_enrollment is null then
    raise exception 'ASSIGNMENT_ENROLLMENT_REQUIRED';
  end if;
  perform internal.assert_live_component_access(
    target_enrollment, target_component
  );
  return internal.change_assignment_live_session_without_hybrid_gate(
    target_booking, replacement_session, idempotency
  );
end
$$;
revoke all on function internal.change_assignment_live_session(
  uuid, uuid, uuid
) from public, anon;
grant execute on function internal.change_assignment_live_session(
  uuid, uuid, uuid
) to authenticated;

alter function internal.start_quiz_attempt(uuid, uuid)
  rename to start_quiz_attempt_without_hybrid_gate;
revoke all on function
  internal.start_quiz_attempt_without_hybrid_gate(uuid, uuid)
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
  if not internal.hybrid_required_components_complete(target_enrollment) then
    raise exception 'HYBRID_REQUIRED_COMPONENTS_INCOMPLETE';
  end if;
  return internal.start_quiz_attempt_without_hybrid_gate(
    target_enrollment, idempotency
  );
end
$$;
revoke all on function internal.start_quiz_attempt(uuid, uuid)
  from public, anon;
grant execute on function internal.start_quiz_attempt(uuid, uuid)
  to authenticated;

create or replace function public.read_completion_render_context(
  p_enrollment_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
begin
  if not internal.hybrid_required_components_complete(p_enrollment_id) then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'hybrid_required_components_incomplete'
    );
  end if;
  return internal.read_completion_render_context(p_enrollment_id);
end
$$;
revoke all on function public.read_completion_render_context(uuid)
  from public, anon, authenticated;
grant execute on function public.read_completion_render_context(uuid)
  to service_role;
grant execute on function
  internal.hybrid_required_components_complete(uuid)
  to service_role;

create or replace function public.finalize_completion_and_certificate(
  p_enrollment_id uuid,
  p_pdf_object_path text,
  p_pdf_sha256 text,
  p_verification_token_hash text,
  p_issuing_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
begin
  if not internal.hybrid_required_components_complete(p_enrollment_id) then
    raise exception 'HYBRID_REQUIRED_COMPONENTS_INCOMPLETE';
  end if;
  return internal.finalize_completion_and_certificate(
    p_enrollment_id, p_pdf_object_path, p_pdf_sha256,
    p_verification_token_hash, p_issuing_actor_id
  );
end
$$;
revoke all on function public.finalize_completion_and_certificate(
  uuid, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.finalize_completion_and_certificate(
  uuid, text, text, text, uuid
) to service_role;

create or replace function internal.b2c_replacement_sessions(
  target_booking uuid,
  target_person uuid
)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', replacement.id,
    'title', replacement.title,
    'startsAt', replacement.starts_at,
    'endsAt', replacement.ends_at,
    'bookingCloseAt', replacement.booking_close_at
  ) order by replacement.starts_at, replacement.id), '[]'::jsonb)
  from public.live_bookings booking
  join public.orders orders
    on booking.payer_type = 'b2c'
    and orders.id = booking.payer_source_id
  join public.live_sessions replacement
    on replacement.course_version_id = booking.course_version_id
    and replacement.hybrid_component_id is not distinct from
      booking.live_component_id
  where booking.id = target_booking
    and booking.person_id = target_person
    and orders.person_id = target_person
    and orders.status in ('paid', 'paid_unfulfilled')
    and booking.status in ('confirmed', 'cancelled', 'released')
    and replacement.id <> booking.live_session_id
    and replacement.status in ('scheduled', 'open')
    and replacement.booking_close_at > clock_timestamp()
    and replacement.starts_at > clock_timestamp() + interval '24 hours'
    and (
      select count(*)
      from public.live_bookings occupied
      where occupied.live_session_id = replacement.id
        and (
          occupied.status in ('confirmed', 'attended')
          or (
            occupied.status = 'held'
            and occupied.hold_expires_at > clock_timestamp()
          )
        )
    ) < replacement.learner_capacity
$$;
revoke all on function internal.b2c_replacement_sessions(uuid, uuid)
  from public, anon, authenticated;

create or replace function internal.read_learner_runtime_gates(
  target_enrollment uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  enrollment_row public.enrollments%rowtype;
  entitlement_status text;
  version_row public.course_versions%rowtype;
begin
  select enrollment.* into enrollment_row
  from public.enrollments enrollment
  where enrollment.id = target_enrollment
    and enrollment.person_id = actor;
  if not found then
    raise exception 'LEARNER_WORKSPACE_NOT_AUTHORIZED';
  end if;
  select entitlement.status into entitlement_status
  from public.entitlements entitlement
  where entitlement.id = enrollment_row.entitlement_id;
  select * into version_row
  from public.course_versions version
  where version.id = enrollment_row.course_version_id;

  return jsonb_build_object(
    'components', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', component.id,
        'confirmedSeconds', case component.component_type
          when 'recorded' then
            internal.hybrid_component_confirmed_seconds(
              enrollment_row.id, component.id
            )
          else 0
        end,
        'requiredSeconds', component.recorded_required_watch_seconds,
        'completed', internal.hybrid_component_is_complete(
          enrollment_row.id, component.id
        ),
        'prerequisitesComplete',
          internal.hybrid_component_prerequisites_met(
            enrollment_row.id, component.id
          )
      ) order by component.sort_order, component.id)
      from public.hybrid_components component
      where component.course_version_id = enrollment_row.course_version_id
    ), '[]'::jsonb),
    'lessonAccess', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lessonId', lesson.id,
        'componentId', lesson.hybrid_component_id,
        'locked',
          enrollment_row.status not in ('active', 'completed')
          or entitlement_status <> 'active'
          or (
            version_row.delivery_type = 'hybrid'
            and lesson.content_type = 'video'
            and (
              lesson.hybrid_component_id is null
              or not internal.hybrid_component_prerequisites_met(
                enrollment_row.id, lesson.hybrid_component_id
              )
            )
          )
          or (
            version_row.delivery_type = 'hybrid'
            and lesson.content_type in ('quiz', 'survey')
            and not internal.hybrid_required_components_complete(
              enrollment_row.id
            )
          ),
        'lockReason', case
          when enrollment_row.status not in ('active', 'completed')
            or entitlement_status <> 'active'
            then '修課權限目前不可使用'
          when version_row.delivery_type = 'hybrid'
            and lesson.content_type = 'video'
            and lesson.hybrid_component_id is null
            then '此影片尚未完成混合課元件設定'
          when version_row.delivery_type = 'hybrid'
            and lesson.content_type = 'video'
            and not internal.hybrid_component_prerequisites_met(
              enrollment_row.id, lesson.hybrid_component_id
            )
            then '請先完成前置課程元件'
          when version_row.delivery_type = 'hybrid'
            and lesson.content_type in ('quiz', 'survey')
            and not internal.hybrid_required_components_complete(
              enrollment_row.id
            )
            then '請先完成所有必修錄播與直播元件'
          else null
        end
      ) order by module.sort_order, lesson.sort_order, lesson.id)
      from public.modules module
      join public.lessons lesson on lesson.module_id = module.id
      where module.course_version_id = enrollment_row.course_version_id
        and lesson.archived_at is null
    ), '[]'::jsonb),
    'bookingAccess', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bookingId', booking.id,
        'canChange',
          booking.status in ('confirmed', 'cancelled')
          and (
            booking.status = 'cancelled'
            or clock_timestamp() < booking.change_locked_at
          )
          and session.starts_at > clock_timestamp()
          and (
            version_row.delivery_type <> 'hybrid'
            or internal.hybrid_component_prerequisites_met(
              enrollment_row.id, booking.live_component_id
            )
          ),
        'canJoin',
          booking.status = 'confirmed'
          and session.status in ('open', 'in_progress')
          and clock_timestamp() between
            session.starts_at - interval '30 minutes'
            and session.ends_at + interval '30 minutes'
          and (
            version_row.delivery_type <> 'hybrid'
            or internal.hybrid_component_prerequisites_met(
              enrollment_row.id, booking.live_component_id
            )
          ),
        'replacementSessions',
          internal.b2c_replacement_sessions(booking.id, actor)
      ) order by session.starts_at, booking.id)
      from public.live_bookings booking
      join public.live_sessions session
        on session.id = booking.live_session_id
      where booking.enrollment_id = enrollment_row.id
        and booking.person_id = actor
        and booking.payer_type = 'b2c'
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function internal.read_learner_runtime_gates(uuid)
  from public, anon, authenticated;
grant execute on function internal.read_learner_runtime_gates(uuid)
  to authenticated;

create or replace function public.read_learner_runtime_gates(
  p_enrollment_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_learner_runtime_gates(p_enrollment_id)
$$;
revoke all on function public.read_learner_runtime_gates(uuid)
  from public, anon;
grant execute on function public.read_learner_runtime_gates(uuid)
  to authenticated;

create or replace function internal.change_b2c_live_session(
  target_booking uuid,
  replacement_session uuid,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  booking_row public.live_bookings%rowtype;
  order_row public.orders%rowtype;
  source_session public.live_sessions%rowtype;
  replacement public.live_sessions%rowtype;
  prior_event public.live_booking_change_events%rowtype;
  occupied_count integer;
  reason_kind text;
  decision_status text;
  entitlement_status text;
  entitlement_id uuid;
  new_enrollment_id uuid;
  all_components_ready boolean := false;
  notification_id uuid;
begin
  select * into prior_event
  from public.live_booking_change_events event
  where event.person_id = actor
    and event.idempotency_key = idempotency;
  if found then
    if prior_event.live_booking_id <> target_booking
       or prior_event.replacement_live_session_id <> replacement_session
    then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object(
      'bookingId', prior_event.live_booking_id,
      'liveSessionId', prior_event.replacement_live_session_id,
      'reasonKind', prior_event.reason_kind,
      'replayed', true
    );
  end if;

  -- Fixed lock order matches payment fulfillment: order -> booking ->
  -- lexically ordered session advisory locks -> session rows.
  select orders.* into order_row
  from public.live_bookings booking
  join public.orders orders
    on booking.payer_type = 'b2c'
    and orders.id = booking.payer_source_id
  where booking.id = target_booking
    and booking.person_id = actor
    and orders.person_id = actor
  for update of orders;
  if not found then
    raise exception 'B2C_LIVE_BOOKING_NOT_FOUND';
  end if;

  select * into booking_row
  from public.live_bookings booking
  where booking.id = target_booking
    and booking.person_id = actor
    and booking.payer_type = 'b2c'
    and booking.payer_source_id = order_row.id
  for update;
  if not found
     or replacement_session = booking_row.live_session_id
     or (
       booking_row.status = 'confirmed'
       and (
         order_row.status <> 'paid'
         or clock_timestamp() >= booking_row.change_locked_at
       )
     )
     or (
       booking_row.status = 'cancelled'
       and order_row.status not in ('paid', 'paid_unfulfilled')
     )
     or (
       booking_row.status = 'released'
       and order_row.status <> 'paid_unfulfilled'
     )
     or booking_row.status not in ('confirmed', 'cancelled', 'released')
     or exists (
       select 1 from public.live_join_leases lease
       where lease.live_booking_id = booking_row.id and lease.active
     )
     or exists (
       select 1 from public.check_events event
       where event.live_booking_id = booking_row.id
     )
     or exists (
       select 1 from public.attendance_summaries summary
       where summary.live_booking_id = booking_row.id
     )
  then
    raise exception 'B2C_LIVE_SESSION_CHANGE_LOCKED';
  end if;

  if booking_row.live_session_id::text < replacement_session::text then
    perform pg_advisory_xact_lock(hashtextextended(
      'suiyue:live-capacity:' || booking_row.live_session_id::text, 0
    ));
    perform pg_advisory_xact_lock(hashtextextended(
      'suiyue:live-capacity:' || replacement_session::text, 0
    ));
  else
    perform pg_advisory_xact_lock(hashtextextended(
      'suiyue:live-capacity:' || replacement_session::text, 0
    ));
    perform pg_advisory_xact_lock(hashtextextended(
      'suiyue:live-capacity:' || booking_row.live_session_id::text, 0
    ));
  end if;
  perform session.id
  from public.live_sessions session
  where session.id in (booking_row.live_session_id, replacement_session)
  order by session.id
  for update;

  select * into source_session
  from public.live_sessions session
  where session.id = booking_row.live_session_id;
  select * into replacement
  from public.live_sessions session
  where session.id = replacement_session
    and session.course_version_id = booking_row.course_version_id
    and session.hybrid_component_id is not distinct from
      booking_row.live_component_id
    and session.status in ('scheduled', 'open')
    and session.booking_close_at > clock_timestamp()
    and session.starts_at > clock_timestamp() + interval '24 hours';
  if not found then
    raise exception 'B2C_REPLACEMENT_SESSION_INVALID';
  end if;

  if booking_row.status = 'cancelled'
     and source_session.status <> 'cancelled'
  then
    raise exception 'B2C_CANCELLATION_REMEDY_INVALID';
  end if;
  if booking_row.enrollment_id is not null then
    perform internal.assert_live_component_access(
      booking_row.enrollment_id, booking_row.live_component_id
    );
  elsif order_row.status <> 'paid_unfulfilled' then
    raise exception 'B2C_ENROLLMENT_REQUIRED';
  end if;

  perform internal.release_expired_live_holds(replacement.id, 1000);
  select count(*) into occupied_count
  from public.live_bookings occupied
  where occupied.live_session_id = replacement.id
    and (
      occupied.status in ('confirmed', 'attended')
      or (
        occupied.status = 'held'
        and occupied.hold_expires_at > clock_timestamp()
      )
    );
  if occupied_count >= replacement.learner_capacity then
    raise exception 'B2C_REPLACEMENT_SESSION_FULL';
  end if;

  reason_kind := case
    when order_row.status = 'paid_unfulfilled'
      then 'paid_unfulfilled_recovery'
    when booking_row.status = 'cancelled'
      then 'provider_cancellation'
    else 'learner_change'
  end;
  update public.live_bookings
  set live_session_id = replacement.id,
      status = 'confirmed',
      hold_expires_at = null,
      change_locked_at = replacement.starts_at - interval '24 hours'
  where id = booking_row.id;

  if order_row.status = 'paid_unfulfilled' then
    select not exists (
      select 1
      from public.live_bookings sibling
      where sibling.payer_type = 'b2c'
        and sibling.payer_source_id = order_row.id
        and sibling.status not in ('confirmed', 'attended')
    ) into all_components_ready;
    if all_components_ready then
      select decision.status into decision_status
      from public.order_items item
      join public.course_version_accreditation link
        on link.course_version_id = item.course_version_id
      join public.accreditation_decision_revisions decision
        on decision.id = link.accreditation_revision_id
      where item.order_id = order_row.id
      order by decision.revision desc
      limit 1;
      entitlement_status := case
        when decision_status = 'approved' then 'active'
        else 'locked'
      end;
      insert into public.entitlements (
        person_id, course_version_id, source_type, source_id,
        status, locked_reason, starts_at
      ) values (
        actor, booking_row.course_version_id, 'b2c_order', order_row.id,
        entitlement_status,
        case when entitlement_status = 'locked'
          then 'accreditation_not_yet_approved' end,
        case when entitlement_status = 'active'
          then clock_timestamp() end
      )
      on conflict (person_id, course_version_id, source_type, source_id)
      do update set
        status = excluded.status,
        locked_reason = excluded.locked_reason,
        starts_at = coalesce(public.entitlements.starts_at, excluded.starts_at)
      returning id into entitlement_id;
      insert into public.enrollments (
        person_id, course_version_id, entitlement_id
      ) values (
        actor, booking_row.course_version_id, entitlement_id
      )
      on conflict (entitlement_id) do update
      set person_id = excluded.person_id
      returning id into new_enrollment_id;
      update public.live_bookings
      set enrollment_id = new_enrollment_id
      where payer_type = 'b2c'
        and payer_source_id = order_row.id
        and status in ('confirmed', 'attended');
      update public.orders
      set status = 'paid'
      where id = order_row.id and status = 'paid_unfulfilled';
      update public.reconciliation_cases
      set status = 'resolved',
          resolved_at = clock_timestamp(),
          reason = reason || '; learner selected replacement sessions'
      where order_id = order_row.id
        and kind = 'capacity_unavailable'
        and status in ('open', 'investigating');
      insert into public.payment_events (
        order_id, event_type, amount_twd, actor_id,
        idempotency_key, event_data
      ) values (
        order_row.id, 'fulfillment_recovered', null, actor,
        idempotency,
        jsonb_build_object(
          'enrollmentId', new_enrollment_id,
          'replacementSessionId', replacement.id
        )
      );
    end if;
  end if;

  insert into public.live_booking_change_events (
    live_booking_id, person_id, previous_live_session_id,
    replacement_live_session_id, reason_kind, idempotency_key
  ) values (
    booking_row.id, actor, booking_row.live_session_id,
    replacement.id, reason_kind, idempotency
  );
  insert into public.notifications (
    person_id, category, title, body, business_key
  ) values (
    actor, 'live', '直播場次已更換',
    '新場次已確認；請重新下載行事曆，開課前再完成設備檢查。',
    'b2c-live-change:' || booking_row.id::text || ':' ||
      replacement.id::text
  )
  on conflict (person_id, business_key) do update
  set title = excluded.title, body = excluded.body
  returning id into notification_id;
  perform internal.append_audit_event(
    actor, 'live_booking.b2c_session_changed', 'live_booking',
    booking_row.id::text, reason_kind, null,
    jsonb_build_object(
      'previousLiveSessionId', booking_row.live_session_id,
      'replacementLiveSessionId', replacement.id,
      'orderId', order_row.id,
      'paidUnfulfilledRecovered', all_components_ready
    )
  );
  return jsonb_build_object(
    'bookingId', booking_row.id,
    'liveSessionId', replacement.id,
    'reasonKind', reason_kind,
    'orderStatus', case
      when all_components_ready then 'paid'
      else order_row.status
    end,
    'replayed', false
  );
end
$$;
revoke all on function internal.change_b2c_live_session(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function internal.change_b2c_live_session(
  uuid, uuid, uuid
) to authenticated;

create or replace function public.change_b2c_live_session(
  p_live_booking_id uuid,
  p_replacement_session_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.change_b2c_live_session(
    p_live_booking_id, p_replacement_session_id, p_idempotency_key
  )
$$;
revoke all on function public.change_b2c_live_session(
  uuid, uuid, uuid
) from public, anon;
grant execute on function public.change_b2c_live_session(
  uuid, uuid, uuid
) to authenticated;

alter function internal.read_own_order(uuid)
  rename to read_own_order_without_live_repairs;
revoke all on function internal.read_own_order_without_live_repairs(uuid)
  from public, anon, authenticated, service_role;

create or replace function internal.read_own_order(target_order uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, internal
as $$
declare
  actor uuid := internal.current_person_id();
  result jsonb;
begin
  result := internal.read_own_order_without_live_repairs(target_order);
  return result || jsonb_build_object(
    'liveBookingRepairs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bookingId', booking.id,
        'sessionId', session.id,
        'title', session.title,
        'status', booking.status,
        'startsAt', session.starts_at,
        'endsAt', session.ends_at,
        'changeLockedAt', booking.change_locked_at,
        'canChange',
          (
            booking.status = 'cancelled'
            and session.status = 'cancelled'
            and orders.status in ('paid', 'paid_unfulfilled')
          )
          or (
            booking.status = 'released'
            and orders.status = 'paid_unfulfilled'
          ),
        'replacementSessions',
          internal.b2c_replacement_sessions(booking.id, actor)
      ) order by session.starts_at, booking.id)
      from public.orders orders
      join public.live_bookings booking
        on booking.payer_type = 'b2c'
        and booking.payer_source_id = orders.id
      join public.live_sessions session
        on session.id = booking.live_session_id
      where orders.id = target_order
        and orders.person_id = actor
        and booking.person_id = actor
        and (
          (orders.status = 'paid_unfulfilled'
            and booking.status in ('released', 'cancelled'))
          or (orders.status = 'paid'
            and booking.status = 'cancelled'
            and session.status = 'cancelled')
        )
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function internal.read_own_order(uuid)
  from public, anon;
grant execute on function internal.read_own_order(uuid)
  to authenticated;

create unique index one_published_version_per_course
  on public.course_versions(course_id)
  where status = 'published';

create table public.course_version_lifecycle_transitions (
  id uuid primary key default gen_random_uuid(),
  course_version_id uuid not null references public.course_versions(id),
  actor_person_id uuid not null references public.people(id),
  transition_action text not null
    check (transition_action in (
      'stop_sale', 'suspend', 'resume', 'archive'
    )),
  previous_status text not null,
  next_status text not null,
  reason text not null,
  idempotency_key uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  unique (actor_person_id, idempotency_key)
);
alter table public.course_version_lifecycle_transitions
  enable row level security;
alter table public.course_version_lifecycle_transitions
  force row level security;
create trigger course_version_lifecycle_transitions_append_only
before update or delete on public.course_version_lifecycle_transitions
for each row execute function internal.prevent_append_only_change();
revoke all on public.course_version_lifecycle_transitions
  from public, anon, authenticated;
grant select, insert on public.course_version_lifecycle_transitions
  to service_role;

create or replace function internal.transition_course_version_lifecycle(
  target_version uuid,
  submitted_action text,
  submitted_reason text,
  submitted_nonce_hash text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  version_row public.course_versions%rowtype;
  existing_transition public.course_version_lifecycle_transitions%rowtype;
  next_status text;
  decision public.accreditation_decision_revisions%rowtype;
begin
  if submitted_action not in ('stop_sale', 'suspend', 'resume', 'archive')
     or length(trim(submitted_reason)) < 10
     or (
       not internal.has_staff_role('accreditation_reviewer')
       and not internal.has_staff_role('platform_admin')
     )
  then
    raise exception 'COURSE_LIFECYCLE_REJECTED';
  end if;
  select * into existing_transition
  from public.course_version_lifecycle_transitions transition
  where transition.actor_person_id = actor
    and transition.idempotency_key = idempotency;
  if found then
    if existing_transition.course_version_id <> target_version
       or existing_transition.transition_action <> submitted_action
    then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object(
      'courseVersionId', target_version,
      'status', existing_transition.next_status,
      'replayed', true
    );
  end if;

  perform internal.consume_step_up_grant(
    'course_publish', target_version::text, submitted_nonce_hash
  );
  select * into version_row
  from public.course_versions version
  where version.id = target_version;
  if not found then
    raise exception 'COURSE_VERSION_NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'suiyue:course-lifecycle:' || version_row.course_id::text, 0
  ));
  select * into version_row
  from public.course_versions version
  where version.id = target_version
  for update;

  if submitted_action = 'stop_sale' then
    if version_row.status <> 'published'
       or version_row.commerce_close_at <= clock_timestamp()
    then
      raise exception 'COURSE_STOP_SALE_REJECTED';
    end if;
    next_status := 'published';
    update public.course_versions
    set commerce_close_at = clock_timestamp()
    where id = target_version and status = 'published';
  elsif submitted_action = 'suspend' then
    if version_row.status <> 'published' then
      raise exception 'COURSE_SUSPEND_REJECTED';
    end if;
    next_status := 'suspended';
    update public.course_versions
    set status = 'suspended'
    where id = target_version and status = 'published';
  elsif submitted_action = 'resume' then
    if version_row.status <> 'suspended'
       or version_row.commerce_close_at <= clock_timestamp()
       or exists (
         select 1
         from public.course_versions current_version
         where current_version.course_id = version_row.course_id
           and current_version.id <> version_row.id
           and current_version.status = 'published'
       )
       or not exists (
         select 1
         from public.legal_documents legal
         where legal.id = version_row.legal_document_id
           and legal.approved_by_legal
           and legal.effective_at <= clock_timestamp()
           and (
             legal.superseded_at is null
             or legal.superseded_at > clock_timestamp()
           )
       )
    then
      raise exception 'COURSE_RESUME_REJECTED';
    end if;
    select accreditation.* into decision
    from public.course_version_accreditation link
    join public.accreditation_decision_revisions accreditation
      on accreditation.id = link.accreditation_revision_id
    where link.course_version_id = target_version
    order by accreditation.revision desc
    limit 1;
    if not found
       or decision.status not in ('applying', 'approved')
       or decision.valid_from > clock_timestamp()
       or decision.valid_until <= clock_timestamp()
         + version_row.minimum_completion_window
    then
      raise exception 'COURSE_RESUME_ACCREDITATION_INVALID';
    end if;
    next_status := 'published';
    update public.course_versions
    set status = 'published'
    where id = target_version and status = 'suspended';
  else
    if version_row.status <> 'suspended' then
      raise exception 'COURSE_ARCHIVE_REJECTED';
    end if;
    next_status := 'archived';
    update public.course_versions
    set status = 'archived'
    where id = target_version and status = 'suspended';
  end if;

  insert into public.course_version_lifecycle_transitions (
    course_version_id, actor_person_id, transition_action,
    previous_status, next_status, reason, idempotency_key
  ) values (
    target_version, actor, submitted_action,
    version_row.status, next_status, trim(submitted_reason), idempotency
  );
  perform internal.append_audit_event(
    actor, 'course.lifecycle_' || submitted_action, 'course_version',
    target_version::text, trim(submitted_reason), null,
    jsonb_build_object(
      'previousStatus', version_row.status,
      'nextStatus', next_status,
      'commerceCloseAt', case
        when submitted_action = 'stop_sale'
          then clock_timestamp()
        else version_row.commerce_close_at
      end
    )
  );
  return jsonb_build_object(
    'courseVersionId', target_version,
    'status', next_status,
    'replayed', false
  );
end
$$;
revoke all on function internal.transition_course_version_lifecycle(
  uuid, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function internal.transition_course_version_lifecycle(
  uuid, text, text, text, uuid
) to authenticated;

create or replace function public.transition_course_version_lifecycle(
  p_course_version_id uuid,
  p_action text,
  p_reason text,
  p_nonce_hash text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.transition_course_version_lifecycle(
    p_course_version_id, p_action, p_reason,
    p_nonce_hash, p_idempotency_key
  )
$$;
revoke all on function public.transition_course_version_lifecycle(
  uuid, text, text, text, uuid
) from public, anon;
grant execute on function public.transition_course_version_lifecycle(
  uuid, text, text, text, uuid
) to authenticated;

create or replace function internal.read_course_product_controls()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  is_platform_admin boolean := internal.has_staff_role('platform_admin');
  is_reviewer boolean := internal.has_staff_role('accreditation_reviewer');
begin
  if not internal.has_staff_role('course_admin')
     and not is_platform_admin
     and not is_reviewer
  then
    raise exception 'COURSE_STAFF_REQUIRED';
  end if;
  return jsonb_build_object(
    'lifecycleVersions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', version.id,
        'courseId', course.id,
        'slug', course.slug,
        'title', version.title,
        'version', version.version,
        'status', version.status,
        'commerceCloseAt', version.commerce_close_at,
        'publishedAt', version.published_at,
        'canStopSale', version.status = 'published'
          and version.commerce_close_at > clock_timestamp(),
        'canSuspend', version.status = 'published',
        'canResume', version.status = 'suspended'
          and version.commerce_close_at > clock_timestamp()
          and not exists (
            select 1
            from public.course_versions current_version
            where current_version.course_id = version.course_id
              and current_version.id <> version.id
              and current_version.status = 'published'
          ),
        'canArchive', version.status = 'suspended'
      ) order by course.internal_title, version.version desc, version.id)
      from public.course_versions version
      join public.courses course on course.id = version.course_id
      where version.status in ('published', 'suspended', 'archived')
        and (is_platform_admin or is_reviewer)
    ), '[]'::jsonb),
    'hybridConfigurations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'courseVersionId', version.id,
        'components', coalesce((
          select jsonb_agg(jsonb_build_object(
            'componentId', component.id,
            'requiredWatchSeconds',
              component.recorded_required_watch_seconds
          ) order by component.sort_order, component.id)
          from public.hybrid_components component
          where component.course_version_id = version.id
            and component.component_type = 'recorded'
        ), '[]'::jsonb),
        'lessonMappings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'lessonId', lesson.id,
            'componentId', lesson.hybrid_component_id
          ) order by module.sort_order, lesson.sort_order, lesson.id)
          from public.modules module
          join public.lessons lesson on lesson.module_id = module.id
          where module.course_version_id = version.id
            and lesson.content_type = 'video'
            and lesson.archived_at is null
        ), '[]'::jsonb)
      ) order by version.created_at, version.id)
      from public.course_versions version
      where version.status = 'draft'
        and version.delivery_type = 'hybrid'
        and (is_platform_admin or version.created_by = actor)
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function internal.read_course_product_controls()
  from public, anon, authenticated;
grant execute on function internal.read_course_product_controls()
  to authenticated;

create or replace function public.read_course_product_controls()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_course_product_controls()
$$;
revoke all on function public.read_course_product_controls()
  from public, anon;
grant execute on function public.read_course_product_controls()
  to authenticated;

-- Off-sale, suspended, and archived versions remain visible only to the
-- learner who still owns an active entitlement. This policy is deliberately
-- authenticated-only and does not relax catalog or checkout predicates.
create policy learner_owned_course_versions_read
on public.course_versions
for select to authenticated
using (
  exists (
    select 1
    from public.enrollments enrollment
    join public.entitlements entitlement
      on entitlement.id = enrollment.entitlement_id
    where enrollment.course_version_id = course_versions.id
      and enrollment.person_id = internal.request_person_id()
      and enrollment.status not in ('rejected', 'revoked', 'refunded')
      and entitlement.person_id = enrollment.person_id
      and entitlement.status = 'active'
  )
);
create policy learner_booked_live_sessions_read
on public.live_sessions
for select to authenticated
using (
  exists (
    select 1
    from public.live_bookings booking
    join public.enrollments enrollment
      on enrollment.id = booking.enrollment_id
    join public.entitlements entitlement
      on entitlement.id = enrollment.entitlement_id
    where booking.live_session_id = live_sessions.id
      and booking.person_id = internal.request_person_id()
      and enrollment.person_id = booking.person_id
      and enrollment.status not in ('rejected', 'revoked', 'refunded')
      and entitlement.status = 'active'
  )
);

-- The invoker catalog must be able to evaluate every selected/filtered
-- column itself. Historical accreditation states are non-sensitive public
-- metadata; exposing them lets the view reject a latest revoked/expired
-- revision instead of incorrectly falling back to an older approval.
drop policy if exists catalog_accreditation_read
  on public.accreditation_decision_revisions;
create policy catalog_accreditation_read
on public.accreditation_decision_revisions
for select to anon, authenticated
using (
  exists (
    select 1
    from public.course_version_accreditation link
    join public.course_versions version
      on version.id = link.course_version_id
    where link.accreditation_revision_id =
        accreditation_decision_revisions.id
      and version.status = 'published'
      and version.commerce_close_at > clock_timestamp()
  )
);
create policy catalog_hybrid_components_read
on public.hybrid_components
for select to anon, authenticated
using (
  exists (
    select 1
    from public.course_versions version
    where version.id = hybrid_components.course_version_id
      and version.status = 'published'
      and version.commerce_close_at > clock_timestamp()
  )
);
grant select (
  minimum_completion_window, legal_document_id
) on public.course_versions to anon, authenticated;
grant select (revision)
  on public.accreditation_decision_revisions to anon, authenticated;
grant select (superseded_at)
  on public.legal_documents to anon, authenticated;
grant select (
  id, course_version_id, component_type, title, refund_allocation_twd
) on public.hybrid_components to anon, authenticated;

create or replace view public.published_course_catalog
with (security_invoker = true)
as
select
  course.slug,
  version.id as course_version_id,
  version.title,
  version.summary,
  version.description,
  version.learning_objectives,
  version.delivery_type,
  version.price_twd,
  version.organization_point_price,
  version.recorded_refund_allocation_twd,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'componentId', allocation.component_id,
      'title', allocation.title,
      'amountTwd', allocation.amount_twd
    ) order by allocation.title, allocation.component_id)
    from (
      select component.id as component_id,
        component.title,
        component.refund_allocation_twd as amount_twd
      from public.hybrid_components component
      where component.course_version_id = version.id
        and component.component_type = 'live'
      union all
      select version.id, version.title || '（直播）',
        coalesce(
          (version.live_refund_allocations ->> version.id::text)::integer,
          0
        )
      where version.delivery_type = 'live'
    ) allocation
  ), '[]'::jsonb) as live_refund_allocations,
  accreditation.status as accreditation_status,
  accreditation.points as accreditation_points,
  version.has_cover,
  version.equipment_requirements,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', instructor.display_name,
      'biography', instructor.biography,
      'credentials', instructor.credentials
    ) order by course_instructor.sort_order, instructor.id)
    from public.course_instructors course_instructor
    join public.instructors instructor
      on instructor.id = course_instructor.instructor_id
    where course_instructor.course_version_id = version.id
      and instructor.active
  ), '[]'::jsonb) as instructors,
  legal.id as legal_document_id,
  legal.content_sha256 as legal_document_sha256,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', session.id,
      'componentId', session.hybrid_component_id,
      'title', session.title,
      'startsAt', session.starts_at,
      'endsAt', session.ends_at,
      'bookingCloseAt', session.booking_close_at
    ) order by session.starts_at, session.id)
    from public.live_sessions session
    where session.course_version_id = version.id
      and session.status in ('scheduled', 'open')
      and session.booking_close_at > clock_timestamp()
  ), '[]'::jsonb) as live_sessions,
  (
    select min(session.starts_at)
    from public.live_sessions session
    where session.course_version_id = version.id
      and session.status in ('scheduled', 'open')
  ) as first_live_starts_at
from public.courses course
join lateral (
  select candidate.*
  from public.course_versions candidate
  where candidate.course_id = course.id
    and candidate.status = 'published'
  order by candidate.published_at desc nulls last,
    candidate.version desc, candidate.id
  limit 1
) version on true
join lateral (
  select decision.*
  from public.course_version_accreditation link
  join public.accreditation_decision_revisions decision
    on decision.id = link.accreditation_revision_id
  where link.course_version_id = version.id
  order by decision.revision desc, decision.id
  limit 1
) accreditation on true
join public.legal_documents legal
  on legal.id = version.legal_document_id
where course.archived_at is null
  and version.commerce_close_at > clock_timestamp()
  and accreditation.status in ('applying', 'approved')
  and accreditation.valid_from <= clock_timestamp()
  and accreditation.valid_until >
    clock_timestamp() + version.minimum_completion_window
  and legal.approved_by_legal
  and legal.effective_at <= clock_timestamp()
  and (
    legal.superseded_at is null
    or legal.superseded_at > clock_timestamp()
  );

revoke all on public.published_course_catalog from public;
grant select on public.published_course_catalog to anon, authenticated;
