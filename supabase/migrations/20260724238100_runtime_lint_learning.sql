-- Forward-only repairs for hosted plpgsql_check errors in recorded learning,
-- quizzes, and live attendance. Extension functions are schema-qualified
-- because hosted Supabase installs pgcrypto in the extensions schema.

create or replace function internal.authorize_recorded_playback_without_hybrid_gate(
  target_enrollment uuid,
  lesson_video_version uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  enrollment_row public.enrollments%rowtype;
  asset_uid text;
  asset_duration_seconds integer;
  session_id uuid;
  next_epoch bigint;
  nonce text;
  challenge_row public.presence_challenges%rowtype;
  candidate_source public.playback_sessions%rowtype;
  resume_source public.playback_sessions%rowtype;
  resumed_challenge_token text;
  resumed_candidate_seconds integer := 0;
  candidate_origin_video_version_id uuid;
  candidate_origin_position numeric;
  candidate_manifest jsonb := '[]'::jsonb;
  challenge_origin_lesson_id uuid;
  challenge_timed_out boolean := false;
  rewind_fence public.recorded_rewind_fences%rowtype;
  rewind_position numeric;
  resume_position numeric;
begin
  if not internal.feature_is_open('recorded_playback') then
    raise exception 'RECORDED_PLAYBACK_CLOSED';
  end if;
  select enrollment.* into enrollment_row
  from public.lesson_video_versions lvv
  join public.lessons lesson on lesson.id = lvv.lesson_id
  join public.modules module on module.id = lesson.module_id
  join public.enrollments enrollment
    on enrollment.course_version_id = module.course_version_id
  join public.entitlements entitlement
    on entitlement.id = enrollment.entitlement_id
  join public.course_version_accreditation cva
    on cva.course_version_id = module.course_version_id
  join public.accreditation_decision_revisions decision
    on decision.id = cva.accreditation_revision_id
  where lvv.id = lesson_video_version
    and lvv.active
    and enrollment.id = target_enrollment
    and enrollment.person_id = actor
    and enrollment.status = 'active'
    and entitlement.status = 'active'
    and not exists (
      select 1
      from public.refund_cases refund_case
      join public.refund_allocations allocation
        on allocation.refund_case_id = refund_case.id
      where refund_case.order_id = entitlement.source_id
        and entitlement.source_type = 'b2c_order'
        and refund_case.status not in ('rejected', 'failed')
        and allocation.scope_type in ('recorded', 'whole_order')
    )
    and exists (
      select 1
      from private.accreditation_identity_profiles profile
      where profile.person_id = actor
        and profile.status in ('submitted', 'verified', 'needs_correction')
        and enrollment.identity_profile_confirmed_at is not null
        and enrollment.identity_profile_revision_confirmed =
          profile.profile_revision
    )
    and decision.status = 'approved'
    and decision.valid_from <= now()
    and decision.valid_until > now()
  order by decision.revision desc
  limit 1;
  if not found then
    raise exception 'PLAYBACK_NOT_AUTHORIZED';
  end if;

  select asset.provider_uid, asset.duration_seconds
    into asset_uid, asset_duration_seconds
  from public.lesson_video_versions lvv
  join public.video_assets asset on asset.id = lvv.video_asset_id
  where lvv.id = lesson_video_version
    and asset.status = 'ready'
    and asset.require_signed_urls
    and asset.duration_seconds > 0;
  if asset_uid is null or asset_duration_seconds is null then
    raise exception 'VIDEO_NOT_READY';
  end if;

  -- Serialize device takeover with all other starts for the same enrollment.
  perform 1
  from public.enrollments
  where id = enrollment_row.id
  for update;

  select challenge.* into challenge_row
  from public.presence_challenges challenge
  where challenge.enrollment_id = enrollment_row.id
    and challenge.consumed_at is null
    and challenge.confirmed_at is null
    and challenge.timed_out_at is null
  order by challenge.issued_at
  limit 1
  for update;
  if found and clock_timestamp() >= challenge_row.expires_at then
    update public.presence_challenges
    set timed_out_at = clock_timestamp(),
        consumed_at = clock_timestamp()
    where id = challenge_row.id
      and consumed_at is null;
    challenge_timed_out := true;
    candidate_origin_video_version_id :=
      challenge_row.lesson_video_version_id;
    candidate_origin_position :=
      challenge_row.block_started_media_position_seconds;
    select lvv.lesson_id into challenge_origin_lesson_id
    from public.lesson_video_versions lvv
    where lvv.id = challenge_row.lesson_video_version_id;
    rewind_position := case
      when challenge_row.lesson_video_version_id = lesson_video_version
        then challenge_row.block_started_media_position_seconds
      else null
    end;
    insert into public.recorded_rewind_fences (
      enrollment_id, lesson_video_version_id,
      presence_challenge_id, rewind_position_seconds
    ) values (
      enrollment_row.id, challenge_row.lesson_video_version_id,
      challenge_row.id,
      challenge_row.block_started_media_position_seconds
    )
    on conflict (enrollment_id)
      where satisfied_at is null do nothing;
    challenge_row.id := null;
  end if;

  -- Candidate minutes are scoped to the enrollment, not the video. The latest
  -- source is moved to the newly issued lease so that several short lessons can
  -- together reach the ten-minute presence checkpoint.
  select session.* into candidate_source
  from public.playback_sessions session
  where session.enrollment_id = enrollment_row.id
    and session.candidate_unconfirmed_seconds > 0
  order by session.active desc, session.lease_epoch desc
  limit 1
  for update;
  if candidate_source.id is not null
     and challenge_row.id is null
     and not challenge_timed_out
  then
    resumed_candidate_seconds :=
      candidate_source.candidate_unconfirmed_seconds;
    candidate_origin_video_version_id :=
      candidate_source.candidate_origin_lesson_video_version_id;
    candidate_origin_position :=
      candidate_source.candidate_origin_media_position_seconds;
    candidate_manifest := candidate_source.candidate_event_manifest;
  end if;

  -- Resume media position is video-specific and deliberately independent of
  -- the enrollment-wide candidate-minute carry.
  select session.* into resume_source
  from public.playback_sessions session
  where session.enrollment_id = enrollment_row.id
    and session.lesson_video_version_id = lesson_video_version
    and session.last_media_position_seconds is not null
  order by session.last_received_at desc nulls last,
    session.lease_epoch desc
  limit 1;
  if resume_source.id is not null then
    resume_position := resume_source.last_media_position_seconds;
  end if;
  if challenge_timed_out
     and candidate_origin_video_version_id = lesson_video_version
  then
    resume_position := candidate_origin_position;
  end if;
  select fence.* into rewind_fence
  from public.recorded_rewind_fences fence
  where fence.enrollment_id = enrollment_row.id
    and fence.satisfied_at is null
  order by fence.created_at
  limit 1
  for update;
  if rewind_fence.id is not null then
    if rewind_fence.lesson_video_version_id <> lesson_video_version then
      select lvv.lesson_id into challenge_origin_lesson_id
      from public.lesson_video_versions lvv
      where lvv.id = rewind_fence.lesson_video_version_id;
      update public.playback_sessions
      set active = false,
          closed_at = coalesce(closed_at, clock_timestamp()),
          candidate_unconfirmed_seconds = 0,
          candidate_origin_lesson_video_version_id = null,
          candidate_origin_media_position_seconds = null,
          candidate_event_manifest = '[]'::jsonb
      where enrollment_id = enrollment_row.id;
      return jsonb_build_object(
        'rewind_origin_required', true,
        'enrollment_id', enrollment_row.id,
        'video_uid', null,
        'duration_seconds', null,
        'playback_session_id', null,
        'lease_epoch', null,
        'candidate_seconds', 0,
        'challenge_required', false,
        'challenge_token', null,
        'challenge_expires_at', null,
        'challenge_timed_out', challenge_timed_out,
        'challenge_origin_lesson_id', challenge_origin_lesson_id,
        'challenge_origin_video_version_id',
          rewind_fence.lesson_video_version_id,
        'challenge_origin_position_seconds',
          rewind_fence.rewind_position_seconds,
        'rewind_fence_active', true,
        'rewind_to_seconds', rewind_fence.rewind_position_seconds,
        'resume_at_seconds', null,
        'watermark_text', null
      );
    end if;
    resume_position := rewind_fence.rewind_position_seconds;
    rewind_position := rewind_fence.rewind_position_seconds;
  end if;

  select coalesce(max(lease_epoch), 0) + 1 into next_epoch
  from public.playback_sessions where person_id = actor;
  update public.playback_sessions
    set active = false, closed_at = now()
    where person_id = actor and active;
  nonce := rtrim(
    translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'),
    '='
  );
  insert into public.playback_sessions (
    enrollment_id, person_id, lesson_video_version_id,
    session_nonce_hash, device_hash, lease_epoch,
    candidate_unconfirmed_seconds, last_media_position_seconds,
    candidate_origin_lesson_video_version_id,
    candidate_origin_media_position_seconds,
    candidate_event_manifest, rewind_fence_id
  ) values (
    enrollment_row.id, actor, lesson_video_version,
    encode(extensions.digest(nonce, 'sha256'), 'hex'),
    'server-issued', next_epoch,
    case when challenge_row.id is null
      then resumed_candidate_seconds
      else challenge_row.block_seconds
        + challenge_row.surplus_candidate_seconds end,
    resume_position,
    case
      when challenge_row.id is not null
        then challenge_row.lesson_video_version_id
      when resumed_candidate_seconds > 0
        then candidate_origin_video_version_id
      else null
    end,
    case
      when challenge_row.id is not null
        then challenge_row.block_started_media_position_seconds
      when resumed_candidate_seconds > 0
        then candidate_origin_position
      else null
    end,
    case when challenge_row.id is not null
      then challenge_row.event_manifest
        || challenge_row.surplus_event_manifest
      else candidate_manifest
    end,
    rewind_fence.id
  )
  returning id into session_id;
  if rewind_fence.id is not null then
    update public.recorded_rewind_fences
    set claimed_playback_session_id = session_id,
        claimed_after_sequence = 0,
        baseline_sequence = null,
        baseline_established_at = null
    where id = rewind_fence.id
      and satisfied_at is null;
  end if;

  if challenge_row.id is not null then
    resumed_challenge_token := rtrim(
      translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'),
      '='
    );
    resumed_candidate_seconds := challenge_row.block_seconds
      + challenge_row.surplus_candidate_seconds;
    candidate_origin_video_version_id :=
      challenge_row.lesson_video_version_id;
    candidate_origin_position :=
      challenge_row.block_started_media_position_seconds;
    select lvv.lesson_id into challenge_origin_lesson_id
    from public.lesson_video_versions lvv
    where lvv.id = challenge_row.lesson_video_version_id;
    rewind_position := case
      when challenge_row.lesson_video_version_id = lesson_video_version
        then challenge_row.block_started_media_position_seconds
      else null
    end;
    update public.presence_challenges
    set token_hash = encode(
          extensions.digest(resumed_challenge_token, 'sha256'), 'hex'
        )
    where id = challenge_row.id
      and consumed_at is null
      and clock_timestamp() < expires_at;
  end if;
  update public.playback_sessions
  set candidate_unconfirmed_seconds = 0,
      candidate_origin_lesson_video_version_id = null,
      candidate_origin_media_position_seconds = null,
      candidate_event_manifest = '[]'::jsonb
  where enrollment_id = enrollment_row.id
    and id <> session_id;
  if challenge_origin_lesson_id is null
     and candidate_origin_video_version_id is not null
  then
    select lvv.lesson_id into challenge_origin_lesson_id
    from public.lesson_video_versions lvv
    where lvv.id = candidate_origin_video_version_id;
  end if;

  return jsonb_build_object(
    'rewind_origin_required', false,
    'enrollment_id', enrollment_row.id,
    'video_uid', asset_uid,
    'duration_seconds', asset_duration_seconds,
    'playback_session_id', session_id,
    'lease_epoch', next_epoch,
    'candidate_seconds', resumed_candidate_seconds,
    'challenge_required', challenge_row.id is not null,
    'challenge_token', resumed_challenge_token,
    'challenge_expires_at', case
      when challenge_row.id is not null then challenge_row.expires_at
      else null
    end,
    'challenge_timed_out', challenge_timed_out,
    'challenge_origin_lesson_id', challenge_origin_lesson_id,
    'challenge_origin_video_version_id',
      candidate_origin_video_version_id,
    'challenge_origin_position_seconds', candidate_origin_position,
    'rewind_fence_active', rewind_fence.id is not null,
    'rewind_to_seconds', rewind_position,
    'resume_at_seconds', resume_position,
    'watermark_text', coalesce(
      (select display_name from public.people where id = actor),
      '歲悅學員'
    )
  );
end
$$;

revoke all on function
  internal.authorize_recorded_playback_without_hybrid_gate(uuid, uuid)
  from public, anon, authenticated, service_role;

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
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  session_row public.playback_sessions%rowtype;
  received_delta numeric;
  media_delta numeric;
  accepted_seconds integer := 0;
  confirmed_seconds integer := 0;
  required_seconds integer;
  block_target integer;
  total_candidate_seconds integer;
  surplus_candidate_seconds integer := 0;
  token text;
  challenge_id uuid;
  rewind_position numeric;
  pending_challenge public.presence_challenges%rowtype;
  origin_video_version_id uuid;
  origin_lesson_id uuid;
  origin_position numeric;
  previous_playing boolean := false;
  previous_visible boolean := false;
  previous_online boolean := false;
  challenge_expires_at timestamptz;
  rewind_fence public.recorded_rewind_fences%rowtype;
  playback_event_id uuid;
  playback_event_received_at timestamptz;
  accepted_event_entry jsonb;
  challenge_manifest jsonb;
  surplus_manifest jsonb := '[]'::jsonb;
  complete_candidate_manifest jsonb;
  manifest_split jsonb;
begin
  select * into session_row
  from public.playback_sessions
  where id = playback_session
    and enrollment_id = target_enrollment
  for update;
  if not found
     or session_row.person_id <> actor
     or not session_row.active
     or session_row.lease_epoch <> reported_lease_epoch
     or reported_sequence <> session_row.last_sequence + 1
  then
    raise exception 'PLAYBACK_LEASE_REJECTED';
  end if;
  if not internal.feature_is_open('recorded_playback')
     or not exists (
       select 1
       from public.enrollments enrollment
       join public.entitlements entitlement
         on entitlement.id = enrollment.entitlement_id
       join public.lesson_video_versions lvv
         on lvv.id = session_row.lesson_video_version_id
       join public.lessons lesson on lesson.id = lvv.lesson_id
       join public.modules module on module.id = lesson.module_id
       join public.course_version_accreditation cva
         on cva.course_version_id = module.course_version_id
       join public.accreditation_decision_revisions decision
         on decision.id = cva.accreditation_revision_id
       where enrollment.id = session_row.enrollment_id
         and enrollment.person_id = actor
         and enrollment.course_version_id = module.course_version_id
         and enrollment.status = 'active'
         and entitlement.status = 'active'
         and lvv.active
         and decision.status = 'approved'
         and decision.valid_from <= now()
         and decision.valid_until > now()
         and exists (
           select 1
           from private.accreditation_identity_profiles profile
           where profile.person_id = actor
             and profile.status in (
               'submitted', 'verified', 'needs_correction'
             )
             and enrollment.identity_profile_confirmed_at is not null
             and enrollment.identity_profile_revision_confirmed =
               profile.profile_revision
         )
         and not exists (
           select 1
           from public.refund_cases refund_case
           join public.refund_allocations allocation
             on allocation.refund_case_id = refund_case.id
           where refund_case.order_id = entitlement.source_id
             and entitlement.source_type = 'b2c_order'
             and refund_case.status not in ('rejected', 'failed')
             and allocation.scope_type in ('recorded', 'whole_order')
         )
     )
  then
    raise exception 'PLAYBACK_ENTITLEMENT_REVOKED';
  end if;
  if session_row.last_sequence > 0 then
    select event.playing, event.visible, event.online
      into previous_playing, previous_visible, previous_online
    from public.playback_events event
    where event.playback_session_id = session_row.id
      and event.sequence = session_row.last_sequence
      and event.lease_epoch = session_row.lease_epoch
    order by event.received_at desc
    limit 1;
  end if;
  if session_row.rewind_fence_id is not null then
    select fence.* into rewind_fence
    from public.recorded_rewind_fences fence
    where fence.id = session_row.rewind_fence_id
      and fence.enrollment_id = session_row.enrollment_id
      and fence.lesson_video_version_id =
        session_row.lesson_video_version_id
      and fence.claimed_playback_session_id = session_row.id
      and fence.satisfied_at is null
    for update;
    if rewind_fence.id is not null
       and rewind_fence.baseline_sequence is null
       and (
         media_position < rewind_fence.rewind_position_seconds
         or media_position > rewind_fence.rewind_position_seconds + 3
       )
    then
      raise exception 'REWIND_FENCE_POSITION_REQUIRED';
    end if;
  end if;

  select challenge.* into pending_challenge
  from public.presence_challenges challenge
  where challenge.enrollment_id = session_row.enrollment_id
    and challenge.consumed_at is null
    and challenge.confirmed_at is null
    and challenge.timed_out_at is null
  order by challenge.issued_at
  limit 1
  for update;
  if found and clock_timestamp() >= pending_challenge.expires_at then
    origin_video_version_id :=
      pending_challenge.lesson_video_version_id;
    origin_position :=
      pending_challenge.block_started_media_position_seconds;
    select lvv.lesson_id into origin_lesson_id
    from public.lesson_video_versions lvv
    where lvv.id = origin_video_version_id;
    rewind_position := case
      when origin_video_version_id = session_row.lesson_video_version_id
        then origin_position
      else null
    end;
    update public.presence_challenges
      set timed_out_at = clock_timestamp(),
          consumed_at = clock_timestamp()
      where id = pending_challenge.id
        and consumed_at is null;
    insert into public.recorded_rewind_fences (
      enrollment_id, lesson_video_version_id,
      presence_challenge_id, rewind_position_seconds
    ) values (
      session_row.enrollment_id,
      pending_challenge.lesson_video_version_id,
      pending_challenge.id,
      pending_challenge.block_started_media_position_seconds
    )
    on conflict (enrollment_id)
      where satisfied_at is null do nothing;
    if pending_challenge.lesson_video_version_id =
         session_row.lesson_video_version_id
    then
      select fence.* into rewind_fence
      from public.recorded_rewind_fences fence
      where fence.enrollment_id = session_row.enrollment_id
        and fence.lesson_video_version_id =
          session_row.lesson_video_version_id
        and fence.satisfied_at is null
      order by fence.created_at
      limit 1
      for update;
      update public.recorded_rewind_fences
      set claimed_playback_session_id = session_row.id,
          claimed_after_sequence = reported_sequence,
          baseline_sequence = null,
          baseline_established_at = null
      where id = rewind_fence.id;
    end if;
    insert into public.playback_events (
      playback_session_id, enrollment_id, sequence, lease_epoch,
      media_position_seconds, playing, visible, online, candidate_seconds
    ) values (
      session_row.id, session_row.enrollment_id, reported_sequence,
      reported_lease_epoch, coalesce(rewind_position, media_position), false,
      is_visible, is_online, 0
    );
    update public.playback_sessions
      set last_sequence = reported_sequence,
          last_media_position_seconds =
            coalesce(rewind_position, media_position),
          last_received_at = clock_timestamp(),
          candidate_unconfirmed_seconds = 0,
          candidate_origin_lesson_video_version_id = null,
          candidate_origin_media_position_seconds = null,
          candidate_event_manifest = '[]'::jsonb,
          rewind_fence_id = case
            when rewind_fence.id is not null
              then rewind_fence.id
            else rewind_fence_id
          end
      where id = session_row.id;
    update public.playback_sessions
      set candidate_unconfirmed_seconds = 0,
          candidate_origin_lesson_video_version_id = null,
          candidate_origin_media_position_seconds = null,
          candidate_event_manifest = '[]'::jsonb
      where enrollment_id = session_row.enrollment_id
        and id <> session_row.id;
    return jsonb_build_object(
      'candidateSeconds', 0,
      'confirmedSeconds', coalesce((
        select confirmed_valid_seconds
        from public.progress_summaries
        where enrollment_id = session_row.enrollment_id
      ), 0),
      'challengeRequired', false,
      'challengeToken', null,
      'challengeExpiresAt', pending_challenge.expires_at,
      'challengeTimedOut', true,
      'rewindToSeconds', rewind_position,
      'originLessonId', origin_lesson_id,
      'originVideoVersionId', origin_video_version_id,
      'originPositionSeconds', origin_position
    );
  end if;

  if pending_challenge.id is not null then
    if challenge_token is null
       or encode(
         extensions.digest(challenge_token, 'sha256'), 'hex'
       ) <> pending_challenge.token_hash
    then
      raise exception 'PRESENCE_CHALLENGE_TOKEN_REQUIRED';
    end if;
    insert into public.playback_events (
      playback_session_id, enrollment_id, sequence, lease_epoch,
      media_position_seconds, playing, visible, online,
      server_challenge_hash, candidate_seconds
    ) values (
      session_row.id, session_row.enrollment_id, reported_sequence,
      reported_lease_epoch, media_position, false, is_visible, is_online,
      pending_challenge.token_hash, 0
    );
    update public.playback_sessions
    set last_sequence = reported_sequence,
        last_media_position_seconds = media_position,
        last_received_at = clock_timestamp()
    where id = session_row.id;
    origin_video_version_id :=
      pending_challenge.lesson_video_version_id;
    origin_position :=
      pending_challenge.block_started_media_position_seconds;
    select lvv.lesson_id into origin_lesson_id
    from public.lesson_video_versions lvv
    where lvv.id = origin_video_version_id;
    return jsonb_build_object(
      'candidateSeconds', pending_challenge.block_seconds
        + pending_challenge.surplus_candidate_seconds,
      'confirmedSeconds', coalesce((
        select confirmed_valid_seconds
        from public.progress_summaries
        where enrollment_id = session_row.enrollment_id
      ), 0),
      'challengeRequired', true,
      'challengeToken', challenge_token,
      'challengeExpiresAt', pending_challenge.expires_at,
      'challengeTimedOut', false,
      'rewindToSeconds', case
        when origin_video_version_id =
          session_row.lesson_video_version_id
        then origin_position
        else null
      end,
      'originLessonId', origin_lesson_id,
      'originVideoVersionId', origin_video_version_id,
      'originPositionSeconds', origin_position
    );
  end if;

  if session_row.last_received_at is not null
     and previous_playing and previous_visible and previous_online
     and is_playing and is_visible and is_online
  then
    received_delta := extract(
      epoch from (clock_timestamp() - session_row.last_received_at)
    );
    media_delta := media_position - session_row.last_media_position_seconds;
    if received_delta > 0 and received_delta <= 45
       and media_delta >= 0
       and media_delta <= received_delta + 3
    then
      accepted_seconds := floor(least(received_delta, media_delta, 17));
    end if;
  end if;

  insert into public.playback_events (
    playback_session_id, enrollment_id, sequence, lease_epoch,
    media_position_seconds, playing, visible, online,
    server_challenge_hash, candidate_seconds
  ) values (
    session_row.id, session_row.enrollment_id, reported_sequence,
    reported_lease_epoch, media_position, is_playing, is_visible, is_online,
    case when challenge_token is null then null
      else encode(extensions.digest(challenge_token, 'sha256'), 'hex') end,
    accepted_seconds
  ) returning id, received_at
    into playback_event_id, playback_event_received_at;
  if accepted_seconds > 0 then
    accepted_event_entry := jsonb_build_object(
      'eventId', playback_event_id,
      'playbackSessionId', session_row.id,
      'sequence', reported_sequence,
      'leaseEpoch', reported_lease_epoch,
      'videoVersionId', session_row.lesson_video_version_id,
      'mediaPositionSeconds', media_position,
      'receivedAt', playback_event_received_at,
      'eventCandidateSeconds', accepted_seconds,
      'creditedSeconds', accepted_seconds
    );
  end if;
  if accepted_seconds > 0 then
    perform internal.consume_organization_assignment_for_enrollment(
      session_row.enrollment_id,
      'first_server_validated_recorded_segment'
    );
  end if;
  update public.playback_sessions
    set last_sequence = reported_sequence,
        last_media_position_seconds = media_position,
        last_received_at = clock_timestamp(),
        candidate_unconfirmed_seconds =
          candidate_unconfirmed_seconds + accepted_seconds,
        candidate_origin_lesson_video_version_id = case
          when candidate_unconfirmed_seconds = 0
               and accepted_seconds > 0
            then session_row.lesson_video_version_id
          else candidate_origin_lesson_video_version_id
        end,
        candidate_origin_media_position_seconds = case
          when candidate_unconfirmed_seconds = 0
               and accepted_seconds > 0
            then greatest(media_position - accepted_seconds, 0)
          else candidate_origin_media_position_seconds
        end,
        candidate_event_manifest = case
          when accepted_seconds > 0
            then candidate_event_manifest
              || jsonb_build_array(accepted_event_entry)
          else candidate_event_manifest
        end
    where id = session_row.id;
  if rewind_fence.id is not null
     and rewind_fence.baseline_sequence is null
  then
    update public.recorded_rewind_fences
    set baseline_sequence = reported_sequence,
        baseline_established_at = clock_timestamp()
    where id = rewind_fence.id
      and claimed_playback_session_id = session_row.id
      and claimed_after_sequence < reported_sequence
      and baseline_sequence is null
      and satisfied_at is null;
  end if;
  if accepted_seconds > 0
     and rewind_fence.id is not null
     and rewind_fence.baseline_sequence is not null
  then
    update public.recorded_rewind_fences
    set satisfied_at = clock_timestamp()
    where id = rewind_fence.id
      and claimed_playback_session_id = session_row.id
      and satisfied_at is null;
    update public.playback_sessions
    set rewind_fence_id = null
    where id = session_row.id
      and rewind_fence_id = rewind_fence.id;
  end if;

  select coalesce(summary.confirmed_valid_seconds, 0)
    into confirmed_seconds
  from public.progress_summaries summary
  where summary.enrollment_id = session_row.enrollment_id;
  if not found then confirmed_seconds := 0; end if;

  select requirement.required_watch_seconds into required_seconds
  from public.enrollments enrollment
  join public.course_requirements requirement
    on requirement.course_version_id = enrollment.course_version_id
  where enrollment.id = session_row.enrollment_id;

  block_target := least(600, greatest(required_seconds - confirmed_seconds, 0));
  total_candidate_seconds :=
    session_row.candidate_unconfirmed_seconds + accepted_seconds;
  if block_target > 0
     and total_candidate_seconds >= block_target
     and not exists (
       select 1 from public.presence_challenges challenge
       where challenge.enrollment_id = session_row.enrollment_id
         and challenge.consumed_at is null
         and challenge.timed_out_at is null
     )
  then
    surplus_candidate_seconds :=
      greatest(total_candidate_seconds - block_target, 0);
    complete_candidate_manifest := session_row.candidate_event_manifest;
    if accepted_seconds > 0 then
      complete_candidate_manifest :=
        complete_candidate_manifest || jsonb_build_array(
          accepted_event_entry
        );
    end if;
    manifest_split := internal.split_candidate_manifest(
      complete_candidate_manifest, block_target
    );
    challenge_manifest := manifest_split -> 'blockManifest';
    surplus_manifest := manifest_split -> 'surplusManifest';
    if coalesce((
         select sum((entry.value ->> 'creditedSeconds')::integer)
         from jsonb_array_elements(challenge_manifest) entry(value)
       ), 0) <> block_target
       or coalesce((
         select sum((entry.value ->> 'creditedSeconds')::integer)
         from jsonb_array_elements(surplus_manifest) entry(value)
       ), 0) <> surplus_candidate_seconds
    then
      raise exception 'CANDIDATE_MANIFEST_SPLIT_DRIFT';
    end if;
    origin_video_version_id := coalesce(
      session_row.candidate_origin_lesson_video_version_id,
      session_row.lesson_video_version_id
    );
    origin_position := coalesce(
      session_row.candidate_origin_media_position_seconds,
      greatest(media_position - accepted_seconds, 0)
    );
    select lvv.lesson_id into origin_lesson_id
    from public.lesson_video_versions lvv
    where lvv.id = origin_video_version_id;
    token := rtrim(
      translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'),
      '='
    );
    insert into public.presence_challenges (
      enrollment_id, playback_session_id, lesson_video_version_id,
      token_hash,
      block_started_media_position_seconds, block_seconds,
      surplus_candidate_seconds,
      surplus_origin_lesson_video_version_id,
      surplus_origin_media_position_seconds,
      event_manifest, event_manifest_hash, surplus_event_manifest,
      issued_at, expires_at
    ) values (
      session_row.enrollment_id, session_row.id,
      origin_video_version_id,
      encode(extensions.digest(token, 'sha256'), 'hex'),
      origin_position, block_target,
      surplus_candidate_seconds,
      case when surplus_candidate_seconds > 0
        then (surplus_manifest -> 0 ->> 'videoVersionId')::uuid
        else null end,
      case when surplus_candidate_seconds > 0
        then greatest(
          (surplus_manifest -> 0 ->> 'mediaPositionSeconds')::numeric
            - (surplus_manifest -> 0 ->> 'creditedSeconds')::integer,
          0
        )
        else null end,
      challenge_manifest,
      encode(
        extensions.digest(challenge_manifest::text, 'sha256'),
        'hex'
      ),
      surplus_manifest,
      statement_timestamp(), statement_timestamp() + interval '90 seconds'
    ) returning id, expires_at
      into challenge_id, challenge_expires_at;
  end if;

  return jsonb_build_object(
    'candidateSeconds',
      total_candidate_seconds,
    'confirmedSeconds', confirmed_seconds,
    'challengeRequired', challenge_id is not null,
    'challengeToken', token,
    'challengeExpiresAt', challenge_expires_at,
    'challengeTimedOut', false,
    'originLessonId', origin_lesson_id,
    'originVideoVersionId', origin_video_version_id,
    'originPositionSeconds', origin_position
  );
end
$$;

revoke all on function internal.record_playback_heartbeat(
  uuid, uuid, bigint, bigint, numeric, boolean, boolean, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function internal.record_playback_heartbeat(
  uuid, uuid, bigint, bigint, numeric, boolean, boolean, boolean, text
) to authenticated;

create or replace function internal.issue_live_join_lease_without_hybrid_gate(
  target_session uuid,
  submitted_device_hash text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  booking_row public.live_bookings%rowtype;
  session_row public.live_sessions%rowtype;
  existing_lease public.live_join_leases%rowtype;
  meeting_row private.zoom_meetings%rowtype;
  lease_id uuid;
  next_epoch bigint;
  learner_count integer;
  assistant_count integer;
  synthetic_email text;
  provider_customer_key text;
  display_name text;
begin
  if submitted_device_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'DEVICE_HASH_REJECTED';
  end if;
  if not internal.feature_is_open('zoom_join') then
    raise exception 'ZOOM_JOIN_CLOSED';
  end if;
  if not exists (
    select 1 from public.provider_health health
    where health.provider in ('zoom_oauth', 'zoom_meeting_sdk')
      and health.status = 'healthy'
      and health.production_validated_at is not null
    having count(*) = 2
  ) then
    raise exception 'ZOOM_PROVIDER_UNHEALTHY';
  end if;

  select booking.* into booking_row
  from public.live_bookings booking
  where booking.live_session_id = target_session
    and booking.person_id = actor
    and booking.status = 'confirmed'
    and not exists (
      select 1
      from public.refund_cases refund_case
      join public.refund_allocations allocation
        on allocation.refund_case_id = refund_case.id
      where booking.payer_type = 'b2c'
        and refund_case.order_id = booking.payer_source_id
        and refund_case.status not in ('rejected', 'failed')
        and (
          allocation.scope_type = 'whole_order'
          or (
            allocation.scope_type = 'live_component'
            and allocation.scope_id =
              coalesce(booking.live_component_id, booking.course_version_id)
          )
        )
    )
  for update;
  if not found then raise exception 'LIVE_BOOKING_REQUIRED'; end if;
  if length(booking_row.customer_key) > 36
     or booking_row.customer_key !~ '^[A-Za-z0-9_-]+$'
  then
    raise exception 'ZOOM_CUSTOMER_KEY_INVALID';
  end if;
  if not exists (
    select 1
    from private.accreditation_identity_profiles profile
    join public.enrollments enrollment
      on enrollment.person_id = profile.person_id
    where enrollment.id = booking_row.enrollment_id
      and enrollment.person_id = actor
      and enrollment.identity_profile_confirmed_at is not null
      and enrollment.identity_profile_revision_confirmed =
        profile.profile_revision
      and profile.person_id = actor
      and profile.status in ('submitted', 'verified', 'needs_correction')
  ) then
    raise exception 'ACCREDITATION_IDENTITY_PROFILE_REQUIRED';
  end if;

  select * into session_row from public.live_sessions
  where id = target_session for update;
  if session_row.status not in ('open', 'in_progress')
     or now() < session_row.starts_at - interval '30 minutes'
     or now() > session_row.ends_at + interval '30 minutes'
  then
    raise exception 'LIVE_JOIN_WINDOW_CLOSED';
  end if;
  select * into meeting_row
  from private.zoom_meetings
  where live_session_id = target_session;
  if not found then raise exception 'ZOOM_MEETING_NOT_CONFIGURED'; end if;
  select coalesce(person.display_name, '歲悅學員') into display_name
  from public.people person
  where person.id = actor;

  -- A network retry with the same key returns the exact same provider saga.
  -- It never registers a second participant or rotates credentials.
  select * into existing_lease
  from public.live_join_leases lease
  where lease.live_booking_id = booking_row.id
    and lease.person_id = actor
    and lease.issuance_idempotency_key = idempotency
  for update;
  if found then
    if existing_lease.device_hash <> submitted_device_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if not existing_lease.active
       or existing_lease.credential_expires_at <= now()
    then
      raise exception 'JOIN_LEASE_EXPIRED_OR_ABORTED';
    end if;
    return jsonb_build_object(
      'leaseId', existing_lease.id,
      'meetingNumber', meeting_row.meeting_number,
      'encryptedPasscode', meeting_row.encrypted_passcode,
      'syntheticEmail', existing_lease.synthetic_email,
      'displayName', display_name,
      'customerKey', existing_lease.provider_customer_key,
      'expiresAt', existing_lease.credential_expires_at,
      'providerStatus', existing_lease.provider_status,
      'lastHeartbeatSequence', existing_lease.last_heartbeat_sequence,
      'replayed', true
    );
  end if;

  select count(*) into learner_count
  from public.live_bookings
  where live_session_id = target_session
    and status in ('confirmed', 'attended');
  select count(*) into assistant_count
  from public.live_session_assistants
  where live_session_id = target_session
    and role = 'assistant'
    and confirmed_present_at is not null;
  if assistant_count < internal.required_live_assistants(learner_count) then
    raise exception 'LIVE_ASSISTANTS_INSUFFICIENT';
  end if;
  if learner_count + session_row.host_seats + session_row.cohost_seats
       + assistant_count + session_row.reserved_support_seats
     > session_row.verified_zoom_total_capacity
  then
    raise exception 'ZOOM_TOTAL_CAPACITY_EXCEEDED';
  end if;

  select * into existing_lease
  from public.live_join_leases
  where live_booking_id = booking_row.id
    and active
  for update;
  if found then
    -- A replacement is safe only after the prior registrant is revoked and:
    -- (a) a bound participant has authoritative left/removed evidence, or
    -- (b) no participant ever joined and the credential has expired.
    if existing_lease.provider_status = 'pending'
       or existing_lease.created_at > now() - interval '30 seconds'
       or existing_lease.old_registrant_revoked_at is null
       or (
         existing_lease.zoom_participant_uuid is not null
         and existing_lease.old_participant_removed_at is null
       )
       or (
         existing_lease.zoom_participant_uuid is null
         and existing_lease.credential_expires_at > now()
       )
    then
      raise exception 'OLD_ZOOM_CREDENTIAL_NOT_REVOKED';
    end if;
  end if;
  select * into existing_lease
  from public.live_join_leases lease
  where lease.live_booking_id = booking_row.id
    and not lease.active
    and lease.provider_status in ('registered', 'revoked', 'failed')
    and (
      lease.old_registrant_revoked_at is null
      or (
        lease.zoom_participant_uuid is not null
        and lease.old_participant_removed_at is null
      )
      or (
        lease.zoom_participant_uuid is null
        and lease.credential_expires_at > now()
      )
    )
  order by lease.lease_epoch desc
  limit 1
  for update;
  if found then
    raise exception 'OLD_ZOOM_CREDENTIAL_NOT_REVOKED';
  end if;

  select coalesce(max(lease_epoch), 0) + 1 into next_epoch
  from public.live_join_leases where live_booking_id = booking_row.id;
  update public.live_join_leases
    set active = false
    where live_booking_id = booking_row.id and active;
  synthetic_email := encode(extensions.gen_random_bytes(16), 'hex')
    || '@zoom-id.suiyuecare.com';
  provider_customer_key := encode(extensions.gen_random_bytes(16), 'hex');
  insert into public.live_join_leases (
    live_booking_id, person_id, lease_epoch, issuance_idempotency_key,
    device_hash, provider_customer_key,
    synthetic_email, credential_expires_at, active, provider_status
  ) values (
    booking_row.id, actor, next_epoch, idempotency, submitted_device_hash,
    provider_customer_key, synthetic_email,
    now() + interval '30 minutes', true, 'pending'
  ) returning id into lease_id;

  insert into public.durable_jobs (
    job_type, business_key, payload, available_at
  ) values (
    'live_join_lease_expiry',
    'live-join-lease-expiry:' || lease_id::text,
    jsonb_build_object(
      'leaseId', lease_id,
      'personId', actor,
      'liveSessionId', target_session
    ),
    now() + interval '30 minutes'
  );
  return jsonb_build_object(
    'leaseId', lease_id,
    'meetingNumber', meeting_row.meeting_number,
    'encryptedPasscode', meeting_row.encrypted_passcode,
    'syntheticEmail', synthetic_email,
    'displayName', display_name,
    'customerKey', provider_customer_key,
    'expiresAt', now() + interval '30 minutes',
    'providerStatus', 'pending',
    'lastHeartbeatSequence', 0,
    'replayed', false
  );
end
$$;

revoke all on function
  internal.issue_live_join_lease_without_hybrid_gate(uuid, text, uuid)
  from public, anon, authenticated, service_role;

create or replace function internal.select_assignment_live_session_without_hybrid_gate(
  target_assignment uuid,
  target_session uuid,
  target_component uuid,
  idempotency uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  assignment_row public.organization_assignments%rowtype;
  session_row public.live_sessions%rowtype;
  target_enrollment uuid;
  booking_id uuid;
  booking_count integer;
begin
  select * into assignment_row
  from public.organization_assignments
  where id = target_assignment for update;
  if not found
     or assignment_row.status not in ('reserved', 'active')
     or (
       assignment_row.member_person_id <> actor
       and not internal.has_organization_role(
         assignment_row.organization_id,
         array['owner', 'training_manager']
       )
     )
  then raise exception 'ASSIGNMENT_SESSION_SELECTION_REJECTED'; end if;
  select * into session_row from public.live_sessions
  where id = target_session
    and course_version_id = assignment_row.course_version_id
    and status in ('scheduled', 'open')
    and booking_close_at > now()
    and internal.business_days_between(now(), starts_at) >= 3
  for update;
  if not found then raise exception 'LIVE_SESSION_NOT_BOOKABLE'; end if;
  if target_component is not null and not exists (
    select 1 from public.hybrid_components component
    where component.id = target_component
      and component.course_version_id = assignment_row.course_version_id
      and component.component_type = 'live'
      and session_row.hybrid_component_id = component.id
  ) then raise exception 'ASSIGNMENT_COMPONENT_MISMATCH'; end if;
  perform internal.release_expired_live_holds(target_session, 1000);
  select count(*) into booking_count from public.live_bookings
  where live_session_id = target_session
    and (
      status in ('confirmed', 'attended')
      or (status = 'held' and hold_expires_at > clock_timestamp())
    );
  if booking_count >= session_row.learner_capacity then
    raise exception 'LIVE_SESSION_FULL';
  end if;
  select enrollment.id into target_enrollment
  from public.enrollments enrollment
  join public.entitlements entitlement
    on entitlement.id = enrollment.entitlement_id
  where entitlement.source_type = 'organization_assignment'
    and entitlement.source_id = target_assignment;
  insert into public.live_bookings (
    person_id, enrollment_id, course_version_id, live_component_id,
    live_session_id, payer_type, payer_source_id, status,
    customer_key, change_locked_at, idempotency_key
  ) values (
    assignment_row.member_person_id, target_enrollment,
    assignment_row.course_version_id, target_component,
    target_session, 'organization', target_assignment, 'confirmed',
    rtrim(
      translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'),
      '='
    ),
    session_row.starts_at - interval '24 hours', idempotency
  ) returning id into booking_id;
  update public.organization_assignments set status = 'active'
    where id = target_assignment and status = 'reserved';
  perform internal.append_audit_event(
    actor, 'organization.assignment_session_selected', 'live_booking',
    booking_id::text, 'organization assignment booked live session',
    assignment_row.organization_id,
    jsonb_build_object('liveSessionId', target_session)
  );
  return booking_id;
end
$$;

revoke all on function
  internal.select_assignment_live_session_without_hybrid_gate(
    uuid, uuid, uuid, uuid
  ) from public, anon, authenticated, service_role;

create or replace function internal.start_quiz_attempt_without_hybrid_gate(
  target_enrollment uuid,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  bank_id uuid;
  bank_count integer;
  attempt_id uuid;
  attempt_number integer;
  attempt_expiry timestamptz;
  selected_question record;
  display_order integer := 0;
  response_questions jsonb;
begin
  if not exists (
    select 1
    from public.enrollments enrollment
    join public.entitlements entitlement on entitlement.id = enrollment.entitlement_id
    where enrollment.id = target_enrollment
      and enrollment.person_id = actor
      and enrollment.status = 'active'
      and entitlement.status = 'active'
  ) then
    raise exception 'QUIZ_NOT_AUTHORIZED';
  end if;
  if exists (
    select 1 from public.quiz_attempts
    where enrollment_id = target_enrollment and status = 'passed'
  ) then
    raise exception 'QUIZ_ALREADY_PASSED';
  end if;

  select bank.id, count(question_version.id)
    into bank_id, bank_count
  from public.enrollments enrollment
  join public.question_banks bank
    on bank.course_version_id = enrollment.course_version_id
  left join public.question_versions question_version
    on question_version.question_bank_id = bank.id
   and question_version.active
  where enrollment.id = target_enrollment
  group by bank.id;
  if bank_count < 20 then
    raise exception 'QUESTION_BANK_TOO_SMALL';
  end if;

  select id, expires_at into attempt_id, attempt_expiry
  from public.quiz_attempts
  where enrollment_id = target_enrollment and idempotency_key = idempotency;
  if found then
    select coalesce(jsonb_agg(item.question_snapshot order by item.display_order), '[]'::jsonb)
      into response_questions
    from public.quiz_attempt_items item
    where item.quiz_attempt_id = attempt_id;
    return jsonb_build_object(
      'attemptId', attempt_id,
      'expiresAt', attempt_expiry,
      'questions', response_questions
    );
  end if;

  select coalesce(max(existing.attempt_number), 0) + 1
    into attempt_number
  from public.quiz_attempts existing
  where existing.enrollment_id = target_enrollment;
  attempt_expiry := statement_timestamp() + interval '30 minutes';
  insert into public.quiz_attempts (
    enrollment_id, question_bank_id, attempt_number, status,
    started_at, expires_at, idempotency_key
  ) values (
    target_enrollment, bank_id, attempt_number, 'active',
    statement_timestamp(), attempt_expiry, idempotency
  ) returning id into attempt_id;

  for selected_question in
    select q.id, q.prompt, q.topic
    from public.question_versions q
    where q.question_bank_id = bank_id and q.active
    order by random()
    limit 10
  loop
    display_order := display_order + 1;
    insert into public.quiz_attempt_items (
      quiz_attempt_id, question_version_id, display_order,
      option_order_snapshot, question_snapshot
    )
    select
      attempt_id,
      selected_question.id,
      display_order,
      jsonb_agg(option_data.id order by option_data.random_order),
      jsonb_build_object(
        'itemId', gen_random_uuid(),
        'prompt', selected_question.prompt,
        'topic', selected_question.topic,
        'options', jsonb_agg(
          jsonb_build_object(
            'id', option_data.id,
            'text', option_data.option_text
          ) order by option_data.random_order
        )
      )
    from (
      select option.id, option.option_text, random() as random_order
      from public.question_option_versions option
      where option.question_version_id = selected_question.id
    ) option_data;
  end loop;

  -- Return the stored item ids while keeping answer keys in private schema.
  select jsonb_agg(
    item.question_snapshot
      || jsonb_build_object('itemId', item.id)
    order by item.display_order
  ) into response_questions
  from public.quiz_attempt_items item
  where item.quiz_attempt_id = attempt_id;
  return jsonb_build_object(
    'attemptId', attempt_id,
    'expiresAt', attempt_expiry,
    'questions', response_questions
  );
end
$$;

revoke all on function
  internal.start_quiz_attempt_without_hybrid_gate(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function internal.submit_quiz_attempt(
  target_attempt uuid,
  submitted_responses jsonb,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  attempt_row public.quiz_attempts%rowtype;
  submitted_response record;
  correct_count integer;
  final_score integer;
  final_passed boolean;
  weak_topics jsonb;
  response_count integer;
begin
  select attempt.* into attempt_row
  from public.quiz_attempts attempt
  join public.enrollments enrollment on enrollment.id = attempt.enrollment_id
  where attempt.id = target_attempt and enrollment.person_id = actor
  for update of attempt;
  if not found then raise exception 'QUIZ_NOT_AUTHORIZED'; end if;
  if attempt_row.status in ('passed', 'failed', 'submitted') then
    return jsonb_build_object(
      'score', attempt_row.score,
      'passed', attempt_row.passed,
      'topics', '[]'::jsonb
    );
  end if;
  if attempt_row.status <> 'active' or clock_timestamp() > attempt_row.expires_at then
    update public.quiz_attempts set status = 'expired'
      where id = attempt_row.id;
    raise exception 'QUIZ_TIMEOUT';
  end if;
  if coalesce(pg_catalog.jsonb_typeof(submitted_responses), 'null') <> 'object' then
    raise exception 'TEN_RESPONSES_REQUIRED';
  end if;
  select count(*)::integer into response_count
  from pg_catalog.jsonb_object_keys(submitted_responses);
  if response_count <> 10 then
    raise exception 'TEN_RESPONSES_REQUIRED';
  end if;

  for submitted_response in
    select key::uuid as item_id, value #>> '{}' as option_id
    from jsonb_each(submitted_responses)
  loop
    insert into public.quiz_responses (
      quiz_attempt_item_id, selected_option_id
    )
    select item.id, submitted_response.option_id::uuid
    from public.quiz_attempt_items item
    join public.question_option_versions option
      on option.id = submitted_response.option_id::uuid
      and option.question_version_id = item.question_version_id
    where item.id = submitted_response.item_id
      and item.quiz_attempt_id = attempt_row.id;
    if not found then raise exception 'QUIZ_RESPONSE_REJECTED'; end if;
  end loop;

  select count(*) filter (
    where answer.correct_option_id = response.selected_option_id
  ) into correct_count
  from public.quiz_attempt_items item
  join public.quiz_responses response
    on response.quiz_attempt_item_id = item.id
  join private.question_answer_keys answer
    on answer.question_version_id = item.question_version_id
  where item.quiz_attempt_id = attempt_row.id;

  final_score := correct_count * 10;
  final_passed := final_score >= 80;
  update public.quiz_attempts
    set status = case when final_passed then 'passed' else 'failed' end,
        submitted_at = clock_timestamp(),
        score = final_score,
        passed = final_passed
    where id = attempt_row.id;

  select coalesce(jsonb_agg(distinct question.topic), '[]'::jsonb)
    into weak_topics
  from public.quiz_attempt_items item
  join public.quiz_responses response
    on response.quiz_attempt_item_id = item.id
  join public.question_versions question
    on question.id = item.question_version_id
  join private.question_answer_keys answer
    on answer.question_version_id = question.id
  where item.quiz_attempt_id = attempt_row.id
    and answer.correct_option_id <> response.selected_option_id;

  perform internal.append_audit_event(
    actor, 'quiz.submitted', 'quiz_attempt', attempt_row.id::text,
    'server-side grading', null,
    jsonb_build_object('score', final_score, 'passed', final_passed)
  );
  if final_passed then
    insert into public.durable_jobs (job_type, business_key, payload)
    values (
      'completion_evaluate',
      'completion-evaluate:' || attempt_row.enrollment_id::text,
      jsonb_build_object('enrollmentId', attempt_row.enrollment_id)
    )
    on conflict (business_key) do update
    set status = 'pending', available_at = now(), last_error = null,
        attempt_count = 0, completed_at = null;
  end if;
  return jsonb_build_object(
    'score', final_score,
    'passed', final_passed,
    'topics', weak_topics
  );
end
$$;

revoke all on function internal.submit_quiz_attempt(uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.submit_quiz_attempt(uuid, jsonb, uuid)
  to authenticated;

create or replace function internal.settle_live_attendance(target_session uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  session_row public.live_sessions%rowtype;
  booking record;
  effective_seconds integer;
  camera_seconds integer;
  denominator integer;
  device_ok boolean;
  checked_in_ok boolean;
  checked_out_ok boolean;
  actual_locked_break_seconds integer;
  computed_qualified boolean;
  summary_manifest_hash text;
  settled_summary_id uuid;
  next_revision integer;
  approved_presence_delta integer;
  approved_camera_delta integer;
  approved_correction_manifest jsonb;
  prior_booking_qualified boolean;
  settled integer := 0;
begin
  if auth.role() <> 'service_role'
     and not internal.has_staff_role('course_admin')
  then raise exception 'ATTENDANCE_SETTLEMENT_AUTHORITY_REQUIRED'; end if;
  select * into session_row from public.live_sessions
  where id = target_session for update;
  if not found
     or session_row.status <> 'ended'
     or now() < session_row.evidence_settles_at
  then
    raise exception 'EVIDENCE_SETTLEMENT_NOT_READY';
  end if;
  if exists (
    select 1
    from public.live_bookings live_booking
    join public.live_join_leases lease
      on lease.live_booking_id = live_booking.id
    where live_booking.live_session_id = target_session
      and lease.duplicate_anomaly_at is not null
  ) then
    insert into public.live_evidence_events (
      live_session_id, event_type, occurred_at, evidence
    )
    select
      target_session, 'provider_anomaly', now(),
      jsonb_build_object(
        'reason', 'unresolved_duplicate_participant',
        'settlementBlocked', true
      )
    where not exists (
      select 1
      from public.live_evidence_events evidence
      where evidence.live_session_id = target_session
        and evidence.event_type = 'provider_anomaly'
        and evidence.evidence ->> 'reason' =
          'unresolved_duplicate_participant'
    );
    update public.live_sessions
    set status = 'reconciling'
    where id = target_session;
    return 0;
  end if;
  select coalesce(sum(
    extract(epoch from (formal_break.ends_at - formal_break.starts_at))
  ), 0)::integer
  into actual_locked_break_seconds
  from public.live_breaks formal_break
  where formal_break.live_session_id = target_session
    and formal_break.locked_at is not null;
  if actual_locked_break_seconds <> session_row.locked_break_seconds then
    raise exception 'LOCKED_BREAK_MANIFEST_MISMATCH';
  end if;
  denominator := session_row.scheduled_teaching_seconds
    - actual_locked_break_seconds;

  for booking in
    select
      lb.id,
      lb.customer_key,
      lb.enrollment_id,
      (
        select request.id
        from public.live_join_leases lease
        join public.provider_anomaly_resolution_requests request
          on request.live_join_lease_id = lease.id
        join public.provider_anomaly_resolution_decisions decision
          on decision.resolution_request_id = request.id
         and decision.decision = 'approve'
        where lease.live_booking_id = lb.id
        order by decision.decided_at desc, request.id desc
        limit 1
      ) as provider_resolution_request_id,
      exists (
        select 1
        from public.live_join_leases lease
        join public.provider_anomaly_resolution_requests request
          on request.live_join_lease_id = lease.id
         and request.resolution_kind = 'disqualify_booking'
        join public.provider_anomaly_resolution_decisions decision
          on decision.resolution_request_id = request.id
         and decision.decision = 'approve'
        where lease.live_booking_id = lb.id
      ) as provider_disqualified
    from public.live_bookings lb
    where lb.live_session_id = target_session
      and lb.status in ('confirmed', 'attended')
    order by lb.id
  loop
    select coalesce((
      select summary.qualified
      from public.attendance_summaries summary
      where summary.live_booking_id = booking.id
    ), false) into prior_booking_qualified;
    with authoritative_bounds as (
      select least(
        session_row.ends_at,
        coalesce((
          select min(evidence.occurred_at)
          from public.live_evidence_events evidence
          where evidence.live_session_id = target_session
            and evidence.event_type = 'actual_ended'
        ), session_row.ends_at)
      ) as presence_ends_at
    ),
    ordered_heartbeats as (
      select
        heartbeat.join_lease_id,
        lease.provider_customer_key,
        heartbeat.received_at as segment_end,
        lag(heartbeat.received_at) over (
          partition by heartbeat.join_lease_id
          order by heartbeat.received_at, heartbeat.sequence
        ) as previous_received_at,
        heartbeat.camera_on,
        lag(heartbeat.camera_on) over (
          partition by heartbeat.join_lease_id
          order by heartbeat.received_at, heartbeat.sequence
        ) as previous_camera_on
      from public.live_client_heartbeats heartbeat
      join public.live_join_leases lease
        on lease.id = heartbeat.join_lease_id
      where heartbeat.live_session_id = target_session
        and lease.live_booking_id = booking.id
        and lease.duplicate_anomaly_at is null
        and heartbeat.received_at >= session_row.starts_at
        and heartbeat.received_at <= session_row.ends_at
    ),
    candidate_segments as (
      select
        join_lease_id,
        provider_customer_key,
        greatest(
          previous_received_at,
          segment_end - interval '15 seconds',
          session_row.starts_at
        ) as segment_start,
        least(segment_end, bounds.presence_ends_at) as segment_end,
        camera_on and coalesce(previous_camera_on, false) as camera_on
      from ordered_heartbeats
      cross join authoritative_bounds bounds
      where previous_received_at is not null
        and segment_end > previous_received_at
        and segment_end - previous_received_at <= interval '45 seconds'
        and greatest(
          previous_received_at,
          segment_end - interval '15 seconds',
          session_row.starts_at
        ) < least(segment_end, bounds.presence_ends_at)
    ),
    provider_evidenced_segments as (
      select
        segment.segment_start,
        segment.segment_end,
        segment.camera_on
      from candidate_segments segment
      where exists (
        select 1
        from public.zoom_participant_events joined
        where joined.live_session_id = target_session
          and joined.customer_key = segment.provider_customer_key
          and joined.participant_uuid is not null
          and joined.provider_event_type like '%participant_joined'
          and joined.provider_occurrence_at <= segment.segment_start
          and not exists (
            select 1
            from public.zoom_participant_events departed
            where departed.live_session_id = target_session
              and departed.customer_key = segment.provider_customer_key
              and departed.participant_uuid = joined.participant_uuid
              and departed.provider_event_type like '%participant_left'
              and departed.provider_occurrence_at
                between joined.provider_occurrence_at
                  and segment.segment_end
          )
          and 1 = (
            select count(distinct active_join.participant_uuid)
            from public.zoom_participant_events active_join
            where active_join.live_session_id = target_session
              and active_join.customer_key =
                segment.provider_customer_key
              and active_join.participant_uuid is not null
              and active_join.provider_event_type like
                '%participant_joined'
              and active_join.provider_occurrence_at
                <= segment.segment_start
              and not exists (
                select 1
                from public.zoom_participant_events active_left
                where active_left.live_session_id = target_session
                  and active_left.customer_key =
                    segment.provider_customer_key
                  and active_left.participant_uuid =
                    active_join.participant_uuid
                  and active_left.provider_event_type like
                    '%participant_left'
                  and active_left.provider_occurrence_at
                    between active_join.provider_occurrence_at
                      and segment.segment_start
              )
          )
      )
    ),
    -- PostgreSQL multiranges merge overlapping reconnect/takeover segments in
    -- one pass. This has the same no-double-count and conservative camera-off
    -- semantics as per-second expansion without generating millions of rows.
    provider_range_sets as (
      select
        coalesce(
          range_agg(tstzrange(
            segment_start, segment_end, '[)'
          )),
          '{}'::tstzmultirange
        ) as presence_ranges,
        coalesce(
          range_agg(tstzrange(
            segment_start, segment_end, '[)'
          )) filter (where not camera_on),
          '{}'::tstzmultirange
        ) as camera_off_ranges
      from provider_evidenced_segments
    ),
    break_range_set as (
      select coalesce(
        range_agg(tstzrange(
          formal_break.starts_at, formal_break.ends_at, '[)'
        )),
        '{}'::tstzmultirange
      ) as break_ranges
      from public.live_breaks formal_break
      where formal_break.live_session_id = target_session
        and formal_break.locked_at is not null
    ),
    final_ranges as (
      select
        provider.presence_ranges
          * (
            tstzmultirange(tstzrange(
              session_row.starts_at, session_row.ends_at, '[)'
            )) - breaks.break_ranges
          ) as effective_ranges,
        (
          provider.presence_ranges - provider.camera_off_ranges
        ) * (
          tstzmultirange(tstzrange(
            session_row.starts_at, session_row.ends_at, '[)'
          )) - breaks.break_ranges
        ) as camera_ranges
      from provider_range_sets provider
      cross join break_range_set breaks
    )
    select
      least(coalesce((
        select sum(extract(epoch from (
          upper(range_item.value) - lower(range_item.value)
        )))::integer
        from final_ranges,
          unnest(final_ranges.effective_ranges) as range_item(value)
      ), 0), denominator),
      least(coalesce((
        select sum(extract(epoch from (
          upper(range_item.value) - lower(range_item.value)
        )))::integer
        from final_ranges,
          unnest(final_ranges.camera_ranges) as range_item(value)
      ), 0), denominator)
      into effective_seconds, camera_seconds
    ;
    effective_seconds := coalesce(effective_seconds, 0);
    camera_seconds := least(coalesce(camera_seconds, 0), effective_seconds);
    if booking.provider_disqualified then
      effective_seconds := 0;
      camera_seconds := 0;
    end if;
    select
      coalesce(sum(correction.presence_seconds_delta), 0)::integer,
      coalesce(sum(correction.camera_seconds_delta), 0)::integer,
      coalesce(jsonb_agg(jsonb_build_object(
        'correctionId', correction.id,
        'decisionId', decision.id,
        'presenceSecondsDelta', correction.presence_seconds_delta,
        'cameraSecondsDelta', correction.camera_seconds_delta,
        'proposedBy', correction.proposed_by,
        'decidedBy', decision.decided_by,
        'decision', decision.decision,
        'decidedAt', decision.decided_at
      ) order by decision.decided_at, correction.id), '[]'::jsonb)
    into approved_presence_delta, approved_camera_delta,
      approved_correction_manifest
    from public.attendance_summaries prior_summary
    join public.attendance_corrections correction
      on correction.attendance_summary_id = prior_summary.id
    join public.attendance_correction_decisions decision
      on decision.attendance_correction_id = correction.id
     and decision.decision = 'approve'
    where prior_summary.live_booking_id = booking.id;
    if not booking.provider_disqualified then
      effective_seconds := greatest(
        0,
        least(
          denominator,
          effective_seconds + approved_presence_delta
        )
      );
      camera_seconds := greatest(
        0,
        least(
          effective_seconds,
          camera_seconds + approved_camera_delta
        )
      );
    end if;

    select
      exists (
        select 1 from public.check_events check_event
        where check_event.live_booking_id = booking.id
          and check_event.event_type = 'check_in'
      ),
      exists (
        select 1 from public.check_events check_event
        where check_event.live_booking_id = booking.id
          and check_event.event_type = 'check_out'
      ),
      exists (
        select 1 from public.check_events check_event
        where check_event.live_booking_id = booking.id
          and check_event.event_type = 'check_in'
          and check_event.device_test_passed
      )
      into checked_in_ok, checked_out_ok, device_ok;

    computed_qualified :=
      not booking.provider_disqualified
      and device_ok and checked_in_ok and checked_out_ok
      and effective_seconds::numeric * 100 / denominator
        >= session_row.presence_threshold
      and camera_seconds::numeric * 100 / denominator
        >= session_row.camera_threshold;
    select encode(extensions.digest(
      booking.id::text || ':' || effective_seconds::text || ':'
      || camera_seconds::text || ':' || denominator::text || ':'
      || device_ok::text || ':' || checked_in_ok::text || ':'
      || checked_out_ok::text || ':' || computed_qualified::text || ':'
      || booking.provider_disqualified::text || ':'
      || coalesce(
        booking.provider_resolution_request_id::text, 'initial'
      ) || ':approved-corrections:'
      || approved_correction_manifest::text || ':provider:'
      || coalesce((
        select string_agg(
          provider_event.canonical_fingerprint || ':'
            || extract(
              epoch from provider_event.provider_occurrence_at
            )::text,
          '|' order by provider_event.provider_occurrence_at,
            provider_event.ingest_sequence
        )
        from public.zoom_participant_events provider_event
        where provider_event.live_session_id = target_session
          and provider_event.customer_key = booking.customer_key
      ), '') || ':heartbeat:'
      || coalesce((
        select string_agg(
          heartbeat.id::text || ':' || heartbeat.sequence::text || ':'
            || extract(epoch from heartbeat.received_at)::text || ':'
            || heartbeat.camera_on::text || ':'
            || heartbeat.device_test_passed::text,
          '|' order by heartbeat.received_at, heartbeat.sequence,
            heartbeat.id
        )
        from public.live_client_heartbeats heartbeat
        join public.live_join_leases lease
          on lease.id = heartbeat.join_lease_id
        where lease.live_booking_id = booking.id
      ), '') || ':checks:'
      || coalesce((
        select string_agg(
          check_event.id::text || ':' || check_event.event_type || ':'
            || extract(epoch from check_event.occurred_at)::text || ':'
            || check_event.device_test_passed::text,
          '|' order by check_event.occurred_at, check_event.id
        )
        from public.check_events check_event
        where check_event.live_booking_id = booking.id
      ), '') || ':session-evidence:'
      || coalesce((
        select string_agg(
          evidence.id::text || ':' || evidence.event_type || ':'
            || extract(epoch from evidence.occurred_at)::text || ':'
            || evidence.evidence::text,
          '|' order by evidence.occurred_at, evidence.id
        )
        from public.live_evidence_events evidence
        where evidence.live_session_id = target_session
      ), ''),
      'sha256'
    ), 'hex') into summary_manifest_hash;

    insert into public.attendance_summaries (
      live_booking_id, denominator_seconds, effective_presence_seconds,
      camera_seconds, presence_percent, camera_percent,
      device_check_passed, checked_in, checked_out, qualified,
      source_manifest_hash, settled_at
    ) values (
      booking.id, denominator, effective_seconds, camera_seconds,
      round(effective_seconds::numeric * 100 / denominator, 3),
      round(camera_seconds::numeric * 100 / denominator, 3),
      device_ok, checked_in_ok, checked_out_ok,
      computed_qualified, summary_manifest_hash,
      now()
    ) on conflict (live_booking_id) do update
    set denominator_seconds = excluded.denominator_seconds,
        effective_presence_seconds =
          excluded.effective_presence_seconds,
        camera_seconds = excluded.camera_seconds,
        presence_percent = excluded.presence_percent,
        camera_percent = excluded.camera_percent,
        device_check_passed = excluded.device_check_passed,
        checked_in = excluded.checked_in,
        checked_out = excluded.checked_out,
        qualified = excluded.qualified,
        source_manifest_hash = excluded.source_manifest_hash,
        settled_at = excluded.settled_at,
        quarantined_at = null,
        quarantine_reason = null,
        corrected_at = case
          when public.attendance_summaries.source_manifest_hash
            is distinct from excluded.source_manifest_hash
          then clock_timestamp()
          else public.attendance_summaries.corrected_at
        end
    returning id into settled_summary_id;
    select coalesce(max(revision.revision), 0) + 1
    into next_revision
    from public.attendance_summary_revisions revision
    where revision.attendance_summary_id = settled_summary_id;
    insert into public.attendance_summary_revisions (
      attendance_summary_id, revision, denominator_seconds,
      effective_presence_seconds, camera_seconds, presence_percent,
      camera_percent, device_check_passed, checked_in, checked_out,
      qualified, source_manifest_hash, source_kind,
      provider_anomaly_resolution_request_id
    ) values (
      settled_summary_id, next_revision, denominator,
      effective_seconds, camera_seconds,
      round(effective_seconds::numeric * 100 / denominator, 3),
      round(camera_seconds::numeric * 100 / denominator, 3),
      device_ok, checked_in_ok, checked_out_ok, computed_qualified,
      summary_manifest_hash,
      case
        when booking.provider_resolution_request_id is null
          then 'initial_settlement'
        else 'provider_anomaly_recompute'
      end,
      booking.provider_resolution_request_id
    )
    on conflict (attendance_summary_id, source_manifest_hash)
      do nothing;
    if booking.provider_resolution_request_id is not null
       and booking.enrollment_id is not null
       and prior_booking_qualified
       and not computed_qualified
       and internal.live_booking_is_required(booking.id)
       and not internal.enrollment_live_requirements_met(
         booking.enrollment_id
       )
    then
      perform internal.revoke_certificate_for_provider_anomaly(
        booking.enrollment_id,
        booking.provider_resolution_request_id
      );
    end if;
    update public.live_bookings set status = 'attended'
    where id = booking.id and status = 'confirmed';
    insert into public.durable_jobs (
      job_type, business_key, payload
    )
    select
      'completion_evaluate',
      'completion-evaluate:' || live_booking.enrollment_id::text,
      jsonb_build_object('enrollmentId', live_booking.enrollment_id)
    from public.live_bookings live_booking
    join public.enrollments enrollment
      on enrollment.id = live_booking.enrollment_id
    where live_booking.id = booking.id
      and live_booking.enrollment_id is not null
      and enrollment.status = 'active'
      and internal.enrollment_live_requirements_met(enrollment.id)
      and not exists (
        select 1
        from public.certificates certificate
        where certificate.enrollment_id = enrollment.id
      )
    on conflict (business_key) do update
    set status = 'pending', available_at = now(), last_error = null,
        attempt_count = 0, completed_at = null;
    settled := settled + 1;
  end loop;
  return settled;
end
$$;

revoke all on function internal.settle_live_attendance(uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.settle_live_attendance(uuid)
  to authenticated, service_role;
