create table public.playback_sessions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  person_id uuid not null references public.people(id),
  lesson_video_version_id uuid not null references public.lesson_video_versions(id),
  session_nonce_hash text not null unique,
  device_hash text not null,
  lease_epoch bigint not null default 1 check (lease_epoch > 0),
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  last_media_position_seconds numeric(12,3),
  last_received_at timestamptz,
  candidate_unconfirmed_seconds integer not null default 0
    check (candidate_unconfirmed_seconds >= 0),
  candidate_origin_lesson_video_version_id uuid
    references public.lesson_video_versions(id),
  candidate_origin_media_position_seconds numeric(12,3)
    check (
      candidate_origin_media_position_seconds is null
      or candidate_origin_media_position_seconds >= 0
    ),
  candidate_event_manifest jsonb not null default '[]'::jsonb
    check (jsonb_typeof(candidate_event_manifest) = 'array'),
  active boolean not null default true,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  check (
    (
      candidate_unconfirmed_seconds = 0
      and candidate_origin_lesson_video_version_id is null
      and candidate_origin_media_position_seconds is null
      and candidate_event_manifest = '[]'::jsonb
    )
    or (
      candidate_unconfirmed_seconds > 0
      and candidate_origin_lesson_video_version_id is not null
      and candidate_origin_media_position_seconds is not null
      and jsonb_array_length(candidate_event_manifest) > 0
    )
  )
);

create unique index one_active_recorded_lease_per_person
  on public.playback_sessions(person_id) where active;

create table public.playback_events (
  id uuid not null default gen_random_uuid(),
  playback_session_id uuid not null references public.playback_sessions(id),
  enrollment_id uuid not null references public.enrollments(id),
  sequence bigint not null check (sequence > 0),
  lease_epoch bigint not null check (lease_epoch > 0),
  media_position_seconds numeric(12,3) not null check (media_position_seconds >= 0),
  playing boolean not null,
  visible boolean not null,
  online boolean not null,
  server_challenge_hash text,
  candidate_seconds integer not null default 0
    check (candidate_seconds between 0 and 17),
  received_at timestamptz not null default now(),
  primary key (id, received_at),
  unique (playback_session_id, sequence, received_at)
) partition by range (received_at);

create table public.playback_events_default
  partition of public.playback_events default;

create index playback_events_enrollment_received
  on public.playback_events(enrollment_id, received_at);
create index playback_events_session_sequence
  on public.playback_events(
    playback_session_id, lease_epoch, sequence, received_at
  );

create table public.presence_challenges (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  playback_session_id uuid not null references public.playback_sessions(id),
  lesson_video_version_id uuid not null
    references public.lesson_video_versions(id),
  token_hash text not null unique,
  block_started_media_position_seconds numeric(12,3) not null,
  block_seconds integer not null check (block_seconds between 1 and 600),
  surplus_candidate_seconds integer not null default 0
    check (surplus_candidate_seconds between 0 and 17),
  surplus_origin_lesson_video_version_id uuid
    references public.lesson_video_versions(id),
  surplus_origin_media_position_seconds numeric(12,3)
    check (
      surplus_origin_media_position_seconds is null
      or surplus_origin_media_position_seconds >= 0
    ),
  event_manifest jsonb not null
    check (
      jsonb_typeof(event_manifest) = 'array'
      and jsonb_array_length(event_manifest) > 0
    ),
  event_manifest_hash text not null
    check (event_manifest_hash ~ '^[a-f0-9]{64}$'),
  surplus_event_manifest jsonb not null default '[]'::jsonb
    check (jsonb_typeof(surplus_event_manifest) = 'array'),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  timed_out_at timestamptz,
  consumed_at timestamptz,
  check (expires_at = issued_at + interval '90 seconds'),
  check (not (confirmed_at is not null and timed_out_at is not null)),
  check (
    (
      surplus_candidate_seconds = 0
      and surplus_origin_lesson_video_version_id is null
      and surplus_origin_media_position_seconds is null
      and surplus_event_manifest = '[]'::jsonb
    )
    or (
      surplus_candidate_seconds > 0
      and surplus_origin_lesson_video_version_id is not null
      and surplus_origin_media_position_seconds is not null
      and jsonb_array_length(surplus_event_manifest) > 0
    )
  )
);

create table public.recorded_rewind_fences (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  lesson_video_version_id uuid not null
    references public.lesson_video_versions(id),
  presence_challenge_id uuid not null unique
    references public.presence_challenges(id),
  rewind_position_seconds numeric(12,3) not null
    check (rewind_position_seconds >= 0),
  claimed_playback_session_id uuid references public.playback_sessions(id),
  claimed_after_sequence bigint,
  baseline_sequence bigint,
  baseline_established_at timestamptz,
  created_at timestamptz not null default now(),
  satisfied_at timestamptz,
  check (
    (
      claimed_playback_session_id is null
      and claimed_after_sequence is null
      and baseline_sequence is null
      and baseline_established_at is null
    )
    or (
      claimed_playback_session_id is not null
      and claimed_after_sequence is not null
      and claimed_after_sequence >= 0
      and (
        (
          baseline_sequence is null
          and baseline_established_at is null
        )
        or (
          baseline_sequence > claimed_after_sequence
          and baseline_established_at is not null
        )
      )
    )
  )
);

create unique index one_pending_rewind_fence_per_enrollment
  on public.recorded_rewind_fences(enrollment_id)
  where satisfied_at is null;

alter table public.playback_sessions
  add column rewind_fence_id uuid
    references public.recorded_rewind_fences(id);

create table public.confirmed_watch_blocks (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  presence_challenge_id uuid not null unique references public.presence_challenges(id),
  confirmation_idempotency_key uuid not null unique,
  seconds integer not null check (seconds between 1 and 600),
  confirmed_at timestamptz not null,
  event_manifest_hash text not null,
  created_at timestamptz not null default now()
);

create table public.progress_summaries (
  enrollment_id uuid primary key references public.enrollments(id),
  confirmed_valid_seconds integer not null default 0 check (confirmed_valid_seconds >= 0),
  candidate_seconds integer not null default 0 check (candidate_seconds >= 0),
  source_event_count bigint not null default 0,
  recomputed_at timestamptz,
  source_manifest_hash text,
  drift_detected_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.learning_events (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  event_type text not null,
  actor_id uuid not null references public.people(id),
  evidence jsonb not null,
  occurred_at timestamptz not null default now()
);

create table public.question_banks (
  id uuid primary key default gen_random_uuid(),
  course_version_id uuid not null unique references public.course_versions(id),
  version integer not null check (version > 0),
  locked_at timestamptz,
  created_by uuid not null references public.people(id),
  created_at timestamptz not null default now()
);

create table public.question_versions (
  id uuid primary key default gen_random_uuid(),
  question_bank_id uuid not null references public.question_banks(id),
  stable_question_id uuid not null,
  version integer not null check (version > 0),
  prompt text not null,
  topic text not null,
  explanation text not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (stable_question_id, version)
);

create unique index one_active_question_sort_per_bank
  on public.question_versions(question_bank_id, sort_order)
  where active;

create table public.question_option_versions (
  id uuid primary key default gen_random_uuid(),
  question_version_id uuid not null references public.question_versions(id),
  stable_option_id uuid not null,
  option_text text not null,
  sort_order integer not null check (sort_order >= 0),
  unique (question_version_id, stable_option_id),
  unique (question_version_id, sort_order)
);

create table private.question_answer_keys (
  question_version_id uuid primary key references public.question_versions(id),
  correct_option_id uuid not null references public.question_option_versions(id)
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  question_bank_id uuid not null references public.question_banks(id),
  attempt_number integer not null check (attempt_number > 0),
  status text not null default 'active'
    check (status in ('active', 'submitted', 'passed', 'failed', 'expired', 'voided')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  score integer check (score between 0 and 100),
  passed boolean,
  voided_by uuid references public.people(id),
  void_reason text,
  idempotency_key uuid not null,
  unique (enrollment_id, attempt_number),
  unique (enrollment_id, idempotency_key),
  check (expires_at = started_at + interval '30 minutes')
);

create table public.quiz_attempt_items (
  id uuid primary key default gen_random_uuid(),
  quiz_attempt_id uuid not null references public.quiz_attempts(id),
  question_version_id uuid not null references public.question_versions(id),
  display_order integer not null check (display_order between 1 and 10),
  option_order_snapshot jsonb not null,
  question_snapshot jsonb not null,
  unique (quiz_attempt_id, question_version_id),
  unique (quiz_attempt_id, display_order)
);

create table public.quiz_responses (
  id uuid primary key default gen_random_uuid(),
  quiz_attempt_item_id uuid not null unique references public.quiz_attempt_items(id),
  selected_option_id uuid not null references public.question_option_versions(id),
  answered_at timestamptz not null default now()
);

create table public.survey_forms (
  id uuid primary key default gen_random_uuid(),
  course_version_id uuid not null unique references public.course_versions(id),
  revision integer not null default 1 check (revision > 0),
  labels jsonb not null default '[
    "內容", "講師", "平台", "實用性", "整體"
  ]'::jsonb,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  check (jsonb_array_length(labels) = 5)
);

create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null unique references public.enrollments(id),
  survey_form_id uuid not null references public.survey_forms(id),
  submitted_at timestamptz not null default now(),
  editable_until timestamptz not null,
  locked_at timestamptz,
  idempotency_key uuid not null,
  check (editable_until = submitted_at + interval '24 hours')
);

create table public.survey_response_revisions (
  id uuid primary key default gen_random_uuid(),
  survey_response_id uuid not null references public.survey_responses(id),
  revision integer not null check (revision in (1, 2)),
  ratings smallint[] not null,
  optional_comment text,
  submitted_at timestamptz not null default now(),
  unique (survey_response_id, revision),
  check (
    cardinality(ratings) = 5
    and ratings <@ array[1,2,3,4,5]::smallint[]
  )
);

create trigger playback_events_append_only
before update or delete on public.playback_events
for each row execute function internal.prevent_append_only_change();
create trigger confirmed_watch_blocks_append_only
before update or delete on public.confirmed_watch_blocks
for each row execute function internal.prevent_append_only_change();
create trigger learning_events_append_only
before update or delete on public.learning_events
for each row execute function internal.prevent_append_only_change();
create trigger quiz_responses_append_only
before update or delete on public.quiz_responses
for each row execute function internal.prevent_append_only_change();
