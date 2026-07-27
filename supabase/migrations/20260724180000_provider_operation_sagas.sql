-- Provider side effects need a durable receipt before the surrounding business
-- transaction can be finalized. This forward migration closes the
-- provider-success / database-finalize-failure replay window.

create table public.provider_operation_receipts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in (
    'cloudflare_stream', 'zoom', 'resend', 'twilio', 'identity_recovery'
  )),
  operation text not null check (
    operation <> '' and length(operation) <= 100
  ),
  business_key text not null check (
    business_key <> '' and length(business_key) <= 500
  ),
  provider_reference text check (
    provider_reference is null or length(provider_reference) <= 500
  ),
  response_fingerprint text not null check (
    response_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  response_payload jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (provider, operation, business_key)
);

alter table public.provider_operation_receipts enable row level security;
alter table public.provider_operation_receipts force row level security;
create trigger provider_operation_receipts_append_only
before update or delete on public.provider_operation_receipts
for each row execute function internal.prevent_append_only_change();

revoke all on public.provider_operation_receipts
  from public, anon, authenticated, service_role;
grant select, insert on public.provider_operation_receipts to service_role;

create or replace function internal.record_provider_operation_receipt(
  submitted_provider text,
  submitted_operation text,
  submitted_business_key text,
  submitted_provider_reference text,
  submitted_response_fingerprint text,
  submitted_response_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  receipt public.provider_operation_receipts%rowtype;
  inserted_count integer := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or submitted_provider not in (
       'cloudflare_stream', 'zoom', 'resend', 'twilio', 'identity_recovery'
     )
     or submitted_operation = ''
     or length(submitted_operation) > 100
     or submitted_business_key = ''
     or length(submitted_business_key) > 500
     or submitted_response_fingerprint !~ '^[a-f0-9]{64}$'
     or submitted_response_payload is null
  then
    raise exception 'PROVIDER_RECEIPT_REJECTED';
  end if;

  insert into public.provider_operation_receipts (
    provider, operation, business_key, provider_reference,
    response_fingerprint, response_payload
  ) values (
    submitted_provider, submitted_operation, submitted_business_key,
    nullif(submitted_provider_reference, ''),
    submitted_response_fingerprint, submitted_response_payload
  )
  on conflict (provider, operation, business_key) do nothing;
  get diagnostics inserted_count = row_count;

  select * into receipt
  from public.provider_operation_receipts
  where provider = submitted_provider
    and operation = submitted_operation
    and business_key = submitted_business_key;

  if receipt.provider_reference is distinct from
       nullif(submitted_provider_reference, '')
     or receipt.response_fingerprint <> submitted_response_fingerprint
     or receipt.response_payload <> submitted_response_payload
  then
    raise exception 'PROVIDER_RECEIPT_REPLAY_MISMATCH';
  end if;

  return jsonb_build_object(
    'providerReference', receipt.provider_reference,
    'responsePayload', receipt.response_payload,
    'recordedAt', receipt.created_at,
    'reused', inserted_count = 0
  );
end
$$;
revoke all on function internal.record_provider_operation_receipt(
  text, text, text, text, text, jsonb
) from public;

create or replace function public.record_provider_operation_receipt(
  p_provider text,
  p_operation text,
  p_business_key text,
  p_provider_reference text,
  p_response_fingerprint text,
  p_response_payload jsonb
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.record_provider_operation_receipt(
    p_provider, p_operation, p_business_key, p_provider_reference,
    p_response_fingerprint, p_response_payload
  )
$$;

create or replace function internal.read_provider_operation_receipt(
  submitted_provider text,
  submitted_operation text,
  submitted_business_key text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  receipt public.provider_operation_receipts%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'PROVIDER_RECEIPT_SERVICE_REQUIRED';
  end if;
  select * into receipt
  from public.provider_operation_receipts
  where provider = submitted_provider
    and operation = submitted_operation
    and business_key = submitted_business_key;
  if not found then return null; end if;
  return jsonb_build_object(
    'providerReference', receipt.provider_reference,
    'responsePayload', receipt.response_payload,
    'recordedAt', receipt.created_at
  );
end
$$;
revoke all on function internal.read_provider_operation_receipt(
  text, text, text
) from public;

create or replace function public.read_provider_operation_receipt(
  p_provider text,
  p_operation text,
  p_business_key text
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_provider_operation_receipt(
    p_provider, p_operation, p_business_key
  )
$$;

revoke all on function public.record_provider_operation_receipt(
  text, text, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.read_provider_operation_receipt(
  text, text, text
) from public, anon, authenticated;
grant execute on function internal.record_provider_operation_receipt(
  text, text, text, text, text, jsonb
) to service_role;
grant execute on function public.record_provider_operation_receipt(
  text, text, text, text, text, jsonb
) to service_role;
grant execute on function internal.read_provider_operation_receipt(
  text, text, text
) to service_role;
grant execute on function public.read_provider_operation_receipt(
  text, text, text
) to service_role;

create table public.stream_upload_intents (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id),
  created_by uuid not null references public.people(id),
  idempotency_key uuid not null,
  max_duration_seconds integer not null
    check (max_duration_seconds between 60 and 28800),
  status text not null default 'prepared'
    check (status in ('prepared', 'registered', 'failed')),
  provider_uid text,
  video_asset_id uuid references public.video_assets(id),
  provider_request_claim_id uuid,
  provider_request_claimed_at timestamptz,
  failure_reason text,
  expires_at timestamptz not null default clock_timestamp() + interval '20 minutes',
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (created_by, idempotency_key),
  check (
    (status = 'registered' and provider_uid is not null and video_asset_id is not null)
    or status <> 'registered'
  )
);

alter table public.stream_upload_intents enable row level security;
alter table public.stream_upload_intents force row level security;
revoke all on public.stream_upload_intents
  from public, anon, authenticated, service_role;
grant select on public.stream_upload_intents to service_role;

create or replace function internal.prepare_stream_upload_intent(
  target_lesson uuid,
  submitted_max_duration_seconds integer,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  intent public.stream_upload_intents%rowtype;
begin
  if not internal.has_staff_role('course_admin')
     or submitted_max_duration_seconds not between 60 and 28800
  then
    raise exception 'STREAM_UPLOAD_INTENT_REJECTED';
  end if;

  select * into intent
  from public.stream_upload_intents
  where created_by = actor and idempotency_key = idempotency
  for update;
  if found then
    if intent.lesson_id <> target_lesson
       or intent.max_duration_seconds <> submitted_max_duration_seconds
    then
      raise exception 'STREAM_UPLOAD_INTENT_REPLAY_MISMATCH';
    end if;
    return jsonb_build_object(
      'intentId', intent.id,
      'status', intent.status,
      'providerUid', intent.provider_uid,
      'videoAssetId', intent.video_asset_id,
      'expiresAt', intent.expires_at,
      'reused', true
    );
  end if;

  perform 1
  from public.lessons lesson
  join public.modules module on module.id = lesson.module_id
  join public.course_versions version
    on version.id = module.course_version_id
  where lesson.id = target_lesson
    and lesson.content_type = 'video'
    and version.status = 'draft'
  for update of lesson;
  if not found then raise exception 'DRAFT_VIDEO_LESSON_REQUIRED'; end if;

  insert into public.stream_upload_intents (
    lesson_id, created_by, idempotency_key, max_duration_seconds
  ) values (
    target_lesson, actor, idempotency, submitted_max_duration_seconds
  ) returning * into intent;

  return jsonb_build_object(
    'intentId', intent.id,
    'status', intent.status,
    'providerUid', null,
    'videoAssetId', null,
    'expiresAt', intent.expires_at,
    'reused', false
  );
end
$$;
revoke all on function internal.prepare_stream_upload_intent(
  uuid, integer, uuid
) from public;

create or replace function public.prepare_stream_upload_intent(
  p_lesson_id uuid,
  p_max_duration_seconds integer,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.prepare_stream_upload_intent(
    p_lesson_id, p_max_duration_seconds, p_idempotency_key
  )
$$;

create or replace function internal.finalize_stream_upload_intent(
  target_intent uuid,
  submitted_provider_uid text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  intent public.stream_upload_intents%rowtype;
  asset_id uuid;
  lesson_video_id uuid;
  next_version integer;
begin
  select * into intent
  from public.stream_upload_intents
  where id = target_intent and created_by = actor
  for update;
  if not found or not internal.has_staff_role('course_admin') then
    raise exception 'STREAM_UPLOAD_INTENT_FINALIZE_REJECTED';
  end if;
  if intent.status = 'registered' then
    if intent.provider_uid <> submitted_provider_uid then
      raise exception 'STREAM_UPLOAD_INTENT_REPLAY_MISMATCH';
    end if;
    return jsonb_build_object(
      'videoAssetId', intent.video_asset_id,
      'providerUid', intent.provider_uid,
      'reused', true
    );
  end if;
  if intent.status <> 'prepared'
     or intent.expires_at <= clock_timestamp()
     or intent.provider_request_claim_id is null
     or submitted_provider_uid = ''
     or length(submitted_provider_uid) > 200
  then
    raise exception 'STREAM_UPLOAD_INTENT_FINALIZE_REJECTED';
  end if;
  perform 1
  from public.lessons lesson
  join public.modules module on module.id = lesson.module_id
  join public.course_versions version
    on version.id = module.course_version_id
  where lesson.id = intent.lesson_id
    and lesson.content_type = 'video'
    and version.status = 'draft'
  for update of lesson;
  if not found then raise exception 'DRAFT_VIDEO_LESSON_REQUIRED'; end if;
  if not exists (
    select 1
    from public.provider_operation_receipts receipt
    where receipt.provider = 'cloudflare_stream'
      and receipt.operation = 'direct_upload'
      and receipt.business_key =
        'stream-direct-upload:' || intent.id::text
      and receipt.provider_reference = submitted_provider_uid
      and receipt.response_payload ->> 'uid' = submitted_provider_uid
  ) then
    raise exception 'STREAM_UPLOAD_PROVIDER_RECEIPT_REQUIRED';
  end if;

  insert into public.video_assets (
    provider_uid, status, require_signed_urls, provider_payload,
    application_idempotency_key, uploaded_by
  ) values (
    submitted_provider_uid, 'uploading', true,
    jsonb_build_object('providerReady', false),
    intent.idempotency_key, actor
  ) returning id into asset_id;

  select coalesce(max(video.version), 0) + 1 into next_version
  from public.lesson_video_versions video
  where video.lesson_id = intent.lesson_id;
  update public.lesson_video_versions
  set active = false
  where lesson_id = intent.lesson_id and active;
  insert into public.lesson_video_versions (
    lesson_id, video_asset_id, version, active, created_by
  ) values (
    intent.lesson_id, asset_id, next_version, true, actor
  ) returning id into lesson_video_id;

  update public.stream_upload_intents
  set status = 'registered',
      provider_uid = submitted_provider_uid,
      video_asset_id = asset_id,
      completed_at = clock_timestamp()
  where id = intent.id;

  perform internal.append_audit_event(
    actor, 'stream.direct_upload_registered', 'video_asset',
    asset_id::text, 'provider receipt attached to prepared upload intent',
    null, jsonb_build_object(
      'intentId', intent.id,
      'lessonId', intent.lesson_id,
      'lessonVideoVersionId', lesson_video_id
    )
  );
  return jsonb_build_object(
    'videoAssetId', asset_id,
    'providerUid', submitted_provider_uid,
    'reused', false
  );
end
$$;
revoke all on function internal.finalize_stream_upload_intent(
  uuid, text
) from public;

create or replace function public.finalize_stream_upload_intent(
  p_intent_id uuid,
  p_provider_uid text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.finalize_stream_upload_intent(
    p_intent_id, p_provider_uid
  )
$$;

create or replace function internal.fail_stream_upload_intent(
  target_intent uuid,
  submitted_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
begin
  update public.stream_upload_intents
  set status = 'failed',
      failure_reason = left(coalesce(nullif(submitted_reason, ''), 'provider failure'), 500),
      completed_at = clock_timestamp()
  where id = target_intent
    and created_by = actor
    and status = 'prepared'
    and not exists (
      select 1
      from public.provider_operation_receipts receipt
      where receipt.provider = 'cloudflare_stream'
        and receipt.operation = 'direct_upload'
        and receipt.business_key =
          'stream-direct-upload:' || target_intent::text
    );
  if not found then raise exception 'STREAM_UPLOAD_INTENT_FAILURE_REJECTED'; end if;
  return true;
end
$$;
revoke all on function internal.fail_stream_upload_intent(
  uuid, text
) from public;

create or replace function public.fail_stream_upload_intent(
  p_intent_id uuid,
  p_reason text
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.fail_stream_upload_intent(p_intent_id, p_reason)
$$;

revoke all on function public.prepare_stream_upload_intent(
  uuid, integer, uuid
) from public, anon;
revoke all on function public.finalize_stream_upload_intent(
  uuid, text
) from public, anon;
revoke all on function public.fail_stream_upload_intent(
  uuid, text
) from public, anon;
grant execute on function internal.prepare_stream_upload_intent(
  uuid, integer, uuid
) to authenticated, service_role;
grant execute on function public.prepare_stream_upload_intent(
  uuid, integer, uuid
) to authenticated, service_role;
grant execute on function internal.finalize_stream_upload_intent(
  uuid, text
) to authenticated, service_role;
grant execute on function public.finalize_stream_upload_intent(
  uuid, text
) to authenticated, service_role;
grant execute on function internal.fail_stream_upload_intent(
  uuid, text
) to authenticated, service_role;
grant execute on function public.fail_stream_upload_intent(
  uuid, text
) to authenticated, service_role;

create or replace function internal.claim_stream_upload_provider_request(
  target_intent uuid,
  submitted_claim_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  actor uuid := internal.current_person_id();
  intent public.stream_upload_intents%rowtype;
begin
  if not internal.has_staff_role('course_admin') then
    raise exception 'STREAM_UPLOAD_PROVIDER_CLAIM_REJECTED';
  end if;
  select * into intent
  from public.stream_upload_intents
  where id = target_intent and created_by = actor
  for update;
  if not found
     or intent.status <> 'prepared'
     or intent.expires_at <= clock_timestamp()
  then
    raise exception 'STREAM_UPLOAD_PROVIDER_CLAIM_REJECTED';
  end if;
  if intent.provider_request_claim_id is null then
    update public.stream_upload_intents
    set provider_request_claim_id = submitted_claim_id,
        provider_request_claimed_at = clock_timestamp()
    where id = intent.id;
    return jsonb_build_object('claimed', true, 'reused', false);
  end if;
  if intent.provider_request_claim_id = submitted_claim_id then
    return jsonb_build_object('claimed', true, 'reused', true);
  end if;
  return jsonb_build_object(
    'claimed', false,
    'reused', true,
    'claimedAt', intent.provider_request_claimed_at
  );
end
$$;
revoke all on function internal.claim_stream_upload_provider_request(
  uuid, uuid
) from public;

create or replace function public.claim_stream_upload_provider_request(
  p_intent_id uuid,
  p_claim_id uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.claim_stream_upload_provider_request(
    p_intent_id, p_claim_id
  )
$$;
revoke all on function public.claim_stream_upload_provider_request(
  uuid, uuid
) from public, anon;
grant execute on function internal.claim_stream_upload_provider_request(
  uuid, uuid
) to authenticated, service_role;
grant execute on function public.claim_stream_upload_provider_request(
  uuid, uuid
) to authenticated, service_role;

create or replace function internal.lease_due_jobs_filtered(
  worker_id text,
  job_limit integer,
  excluded_job_types text[],
  allowed_job_types text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  leased jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or worker_id = ''
     or job_limit not between 1 and 100
  then
    raise exception 'WORKER_SERVICE_AUTHORITY_REQUIRED';
  end if;
  with candidates as (
    select id
    from public.durable_jobs
    where status in ('pending', 'retry')
      and available_at <= now()
      and (lease_expires_at is null or lease_expires_at < now())
      and (
        case
          when internal.setting_is_true('maintenance_mode') then
            job_type = any(array[
              'provider_event_process',
              'live_join_lease_expiry',
              'quarantine_scan'
            ]::text[])
          when allowed_job_types is not null then
            job_type = any(allowed_job_types)
          else
            not (
              job_type = any(
                coalesce(excluded_job_types, array[]::text[])
              )
            )
        end
      )
    order by available_at, created_at
    for update skip locked
    limit job_limit
  ), updated as (
    update public.durable_jobs job
    set status = 'leased',
        lease_owner = worker_id,
        lease_expires_at = now() + interval '5 minutes',
        attempt_count = attempt_count + 1
    from candidates
    where job.id = candidates.id
    returning job.id, job.job_type, job.business_key, job.payload
  )
  select coalesce(jsonb_agg(to_jsonb(updated)), '[]'::jsonb)
  into leased from updated;
  return leased;
end
$$;
revoke all on function internal.lease_due_jobs_filtered(
  text, integer, text[], text[]
) from public;

create or replace function public.lease_due_jobs_filtered(
  p_worker_id text,
  p_limit integer,
  p_excluded_job_types text[],
  p_allowed_job_types text[] default null
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.lease_due_jobs_filtered(
    p_worker_id, p_limit, p_excluded_job_types, p_allowed_job_types
  )
$$;

revoke all on function public.lease_due_jobs_filtered(
  text, integer, text[], text[]
) from public, anon, authenticated;
grant execute on function internal.lease_due_jobs_filtered(
  text, integer, text[], text[]
) to service_role;
grant execute on function public.lease_due_jobs_filtered(
  text, integer, text[], text[]
) to service_role;

-- Refreshes a signed playback URL without trusting the browser's entitlement
-- claim. The active lease must still belong to the caller, then the complete
-- authorization routine runs again. That routine rejects revoked/refunded
-- access and rotates the playback lease atomically.
create or replace function internal.refresh_recorded_playback(
  target_enrollment uuid,
  current_playback_session uuid,
  reported_lease_epoch bigint,
  lesson_video_version uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  actor uuid := internal.current_person_id();
begin
  perform 1
  from public.playback_sessions session
  where session.id = current_playback_session
    and session.enrollment_id = target_enrollment
    and session.person_id = actor
    and session.lesson_video_version_id = lesson_video_version
    and session.lease_epoch = reported_lease_epoch
    and session.active
    and session.closed_at is null
  for update;
  if not found then raise exception 'PLAYBACK_REFRESH_NOT_AUTHORIZED'; end if;

  return internal.authorize_recorded_playback(
    target_enrollment, lesson_video_version
  );
end
$$;
revoke all on function internal.refresh_recorded_playback(
  uuid, uuid, bigint, uuid
) from public;

create or replace function public.refresh_recorded_playback(
  p_enrollment_id uuid,
  p_playback_session_id uuid,
  p_lease_epoch bigint,
  p_lesson_video_version_id uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.refresh_recorded_playback(
    p_enrollment_id, p_playback_session_id, p_lease_epoch,
    p_lesson_video_version_id
  )
$$;

revoke all on function public.refresh_recorded_playback(
  uuid, uuid, bigint, uuid
) from public, anon;
grant execute on function internal.refresh_recorded_playback(
  uuid, uuid, bigint, uuid
) to authenticated, service_role;
grant execute on function public.refresh_recorded_playback(
  uuid, uuid, bigint, uuid
) to authenticated, service_role;
