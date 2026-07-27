-- Forward-only quality, quiz-attempt invalidation, and public-preview gates.
-- This migration intentionally leaves Zoom and the locked core lifecycle
-- migration untouched.

create table public.quiz_attempt_invalidation_requests (
  id uuid primary key default gen_random_uuid(),
  quiz_attempt_id uuid not null unique references public.quiz_attempts(id),
  requested_by uuid not null references public.people(id),
  reason text not null check (length(trim(reason)) between 10 and 1000),
  idempotency_key uuid not null unique,
  created_at timestamptz not null default clock_timestamp()
);

create table public.quiz_attempt_invalidation_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique
    references public.quiz_attempt_invalidation_requests(id),
  reviewer_id uuid not null references public.people(id),
  decision text not null check (decision in ('approve', 'reject')),
  reason text not null check (length(trim(reason)) between 10 and 1000),
  idempotency_key uuid not null,
  request_hash text not null
    check (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (reviewer_id, idempotency_key)
);

create table public.organization_assignment_outcome_corrections (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null
    references public.organization_assignments(id),
  enrollment_id uuid not null references public.enrollments(id),
  membership_lifecycle_revision integer not null
    check (membership_lifecycle_revision >= 0),
  source_kind text not null check (source_kind in (
    'quiz_attempt_invalidation', 'certificate_revocation'
  )),
  source_id uuid not null,
  correction jsonb not null check (
    jsonb_typeof(correction) = 'object'
    and correction ? 'quizScore'
    and correction ? 'quizPassed'
    and correction ? 'certificateStatus'
  ),
  actor_person_id uuid not null references public.people(id),
  reason text not null check (length(trim(reason)) between 10 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  unique (assignment_id, source_kind, source_id)
);

create index organization_outcome_corrections_lifecycle_idx
on public.organization_assignment_outcome_corrections (
  assignment_id,
  membership_lifecycle_revision,
  created_at desc,
  id desc
);

alter table public.survey_response_revisions
  add constraint survey_optional_comment_length
  check (
    optional_comment is null
    or length(optional_comment) <= 2000
  );

create trigger quiz_attempt_invalidation_requests_append_only
before update or delete on public.quiz_attempt_invalidation_requests
for each row execute function internal.prevent_append_only_change();

create trigger quiz_attempt_invalidation_decisions_append_only
before update or delete on public.quiz_attempt_invalidation_decisions
for each row execute function internal.prevent_append_only_change();

create trigger organization_outcome_corrections_append_only
before update or delete
on public.organization_assignment_outcome_corrections
for each row execute function internal.prevent_append_only_change();

alter table public.quiz_attempt_invalidation_requests
  enable row level security;
alter table public.quiz_attempt_invalidation_requests
  force row level security;
alter table public.quiz_attempt_invalidation_decisions
  enable row level security;
alter table public.quiz_attempt_invalidation_decisions
  force row level security;
alter table public.organization_assignment_outcome_corrections
  enable row level security;
alter table public.organization_assignment_outcome_corrections
  force row level security;

revoke all on table public.quiz_attempt_invalidation_requests
  from public, anon, authenticated, service_role;
revoke all on table public.quiz_attempt_invalidation_decisions
  from public, anon, authenticated, service_role;
revoke all on table public.organization_assignment_outcome_corrections
  from public, anon, authenticated, service_role;

create or replace function internal.masked_person_label(
  submitted_name text,
  fallback_label text
)
returns text
language sql
security definer
immutable
set search_path = pg_catalog
as $$
  select case
    when length(trim(coalesce(submitted_name, ''))) < 2
      then fallback_label
    else left(trim(submitted_name), 1)
      || repeat('＊', greatest(length(trim(submitted_name)) - 1, 1))
  end
$$;
revoke all on function internal.masked_person_label(text, text)
  from public;

create or replace function internal.append_organization_quality_correction(
  target_enrollment uuid,
  submitted_source_kind text,
  target_source uuid,
  submitted_actor uuid,
  submitted_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  assignment_identifier uuid;
  membership_revision integer;
  correction_identifier uuid;
begin
  if submitted_source_kind not in (
       'quiz_attempt_invalidation', 'certificate_revocation'
     )
     or submitted_actor is null
     or length(trim(coalesce(submitted_reason, ''))) not between 10 and 1000
  then
    raise exception 'ORGANIZATION_QUALITY_CORRECTION_REJECTED';
  end if;

  -- Serialize quality corrections with offboarding/reactivation. If a
  -- correction wins the membership lock first, the subsequent offboarding
  -- snapshot includes the corrected authoritative state. If offboarding wins,
  -- the correction is bound to that new inactive lifecycle revision.
  select assignment.id, membership.lifecycle_revision
  into assignment_identifier, membership_revision
  from public.enrollments enrollment
  join public.entitlements entitlement
    on entitlement.id = enrollment.entitlement_id
   and entitlement.source_type = 'organization_assignment'
  join public.organization_assignments assignment
    on assignment.id = entitlement.source_id
   and assignment.member_person_id = enrollment.person_id
   and assignment.course_version_id = enrollment.course_version_id
  join public.organization_memberships membership
    on membership.organization_id = assignment.organization_id
   and membership.person_id = assignment.member_person_id
  where enrollment.id = target_enrollment
  for update of membership;
  if not found then return null; end if;

  insert into public.organization_assignment_outcome_corrections (
    assignment_id, enrollment_id, membership_lifecycle_revision,
    source_kind, source_id,
    correction, actor_person_id, reason
  )
  select
    assignment_identifier,
    enrollment.id,
    membership_revision,
    submitted_source_kind,
    target_source,
    jsonb_build_object(
      'quizScore', (
        select attempt.score
        from public.quiz_attempts attempt
        where attempt.enrollment_id = enrollment.id
          and attempt.submitted_at is not null
          and attempt.status <> 'voided'
        order by attempt.attempt_number desc, attempt.id
        limit 1
      ),
      'quizPassed', exists (
        select 1
        from public.quiz_attempts attempt
        where attempt.enrollment_id = enrollment.id
          and attempt.status = 'passed'
          and attempt.score >= 80
      ),
      'certificateStatus', (
        select certificate.current_status
        from public.certificates certificate
        where certificate.enrollment_id = enrollment.id
      )
    ),
    submitted_actor,
    trim(submitted_reason)
  from public.enrollments enrollment
  where enrollment.id = target_enrollment
  on conflict (assignment_id, source_kind, source_id) do nothing
  returning id into correction_identifier;

  if correction_identifier is null then
    select correction.id into correction_identifier
    from public.organization_assignment_outcome_corrections correction
    where correction.assignment_id = assignment_identifier
      and correction.source_kind = submitted_source_kind
      and correction.source_id = target_source;
  end if;
  return correction_identifier;
end
$$;
revoke all on function internal.append_organization_quality_correction(
  uuid, text, uuid, uuid, text
) from public, anon, authenticated, service_role;

create or replace function internal.read_public_course_outline(
  target_course_version uuid
)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select case
    when not exists (
      select 1
      from public.published_course_catalog catalog
      where catalog.course_version_id = target_course_version
    ) then jsonb_build_object('modules', '[]'::jsonb)
    else jsonb_build_object(
      'modules',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', module.id,
            'title', module.title,
            'durationSeconds', coalesce((
              select sum(coalesce(video.duration_seconds, 0))::integer
              from public.lessons module_lesson
              left join lateral (
                select asset.duration_seconds
                from public.lesson_video_versions video_version
                join public.video_assets asset
                  on asset.id = video_version.video_asset_id
                where video_version.lesson_id = module_lesson.id
                  and video_version.active
                  and asset.archived_at is null
                order by video_version.version desc, video_version.id
                limit 1
              ) video on true
              where module_lesson.module_id = module.id
                and module_lesson.archived_at is null
            ), 0),
            'lessons', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', case
                    when lesson.preview
                      and lesson.content_type = 'video'
                      and video.status = 'ready'
                      and video.require_signed_urls
                    then lesson.id
                    else null
                  end,
                  'title', lesson.title,
                  'type', lesson.content_type,
                  'durationSeconds', video.duration_seconds,
                  'preview', coalesce(
                    lesson.preview
                      and lesson.content_type = 'video'
                      and video.status = 'ready'
                      and video.require_signed_urls,
                    false
                  )
                )
                order by lesson.sort_order, lesson.id
              )
              from public.lessons lesson
              left join lateral (
                select
                  asset.duration_seconds,
                  asset.status,
                  asset.require_signed_urls
                from public.lesson_video_versions video_version
                join public.video_assets asset
                  on asset.id = video_version.video_asset_id
                where video_version.lesson_id = lesson.id
                  and video_version.active
                  and asset.archived_at is null
                order by video_version.version desc, video_version.id
                limit 1
              ) video on true
              where lesson.module_id = module.id
                and lesson.archived_at is null
            ), '[]'::jsonb)
          )
          order by module.sort_order, module.id
        )
        from public.modules module
        where module.course_version_id = target_course_version
      ), '[]'::jsonb)
    )
  end
$$;
revoke all on function internal.read_public_course_outline(uuid)
  from public;

create or replace function public.read_public_course_outline(
  p_course_version_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_public_course_outline(p_course_version_id)
$$;

create or replace function internal.authorize_public_course_preview(
  target_course_version uuid,
  target_lesson uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  preview_asset record;
begin
  if auth.role() <> 'service_role' then
    raise exception 'PREVIEW_SERVICE_AUTHORITY_REQUIRED';
  end if;

  select
    asset.provider_uid,
    asset.duration_seconds
  into preview_asset
  from public.published_course_catalog catalog
  join public.modules module
    on module.course_version_id = catalog.course_version_id
  join public.lessons lesson
    on lesson.module_id = module.id
  join lateral (
    select asset.*
    from public.lesson_video_versions video_version
    join public.video_assets asset
      on asset.id = video_version.video_asset_id
    where video_version.lesson_id = lesson.id
      and video_version.active
    order by video_version.version desc, video_version.id
    limit 1
  ) asset on true
  where catalog.course_version_id = target_course_version
    and lesson.id = target_lesson
    and lesson.archived_at is null
    and lesson.content_type = 'video'
    and lesson.preview
    and asset.status = 'ready'
    and asset.archived_at is null
    and asset.duration_seconds > 0
    and asset.require_signed_urls;

  if not found then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if not exists (
    select 1
    from public.provider_health health
    where health.provider = 'cloudflare_stream'
      and health.status = 'healthy'
      and health.production_validated_at is not null
  ) then
    return jsonb_build_object('status', 'provider_unavailable');
  end if;
  return jsonb_build_object(
    'status', 'authorized',
    'courseVersionId', target_course_version,
    'lessonId', target_lesson,
    'videoUid', preview_asset.provider_uid,
    'durationSeconds', preview_asset.duration_seconds
  );
end
$$;
revoke all on function internal.authorize_public_course_preview(uuid, uuid)
  from public;

create or replace function public.authorize_public_course_preview(
  p_course_version_id uuid,
  p_lesson_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.authorize_public_course_preview(
    p_course_version_id, p_lesson_id
  )
$$;

create or replace function internal.read_certificate_revocation_workspace(
  submitted_search text default null,
  submitted_limit integer default 50
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  normalized_search text :=
    nullif(trim(coalesce(submitted_search, '')), '');
  result jsonb;
begin
  if not internal.has_staff_role('accreditation_reviewer')
     or submitted_limit not between 1 and 100
     or length(coalesce(normalized_search, '')) > 200
  then
    raise exception 'CERTIFICATE_REVOCATION_WORKSPACE_REJECTED';
  end if;

  select jsonb_build_object(
    'certificateOptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'certificateId', option_row.certificate_id,
        'learnerLabel', option_row.learner_label,
        'courseTitle', option_row.course_title,
        'certificateKind', option_row.certificate_kind,
        'currentStatus', option_row.current_status,
        'issuedAt', option_row.issued_at
      ) order by option_row.issued_at desc, option_row.certificate_id)
      from (
        select
          certificate.id as certificate_id,
          internal.masked_person_label(person.display_name, '學員')
            as learner_label,
          version.title as course_title,
          certificate.certificate_kind,
          certificate.current_status,
          revision.issued_at
        from public.certificates certificate
        join public.enrollments enrollment
          on enrollment.id = certificate.enrollment_id
        join public.people person on person.id = enrollment.person_id
        join public.course_versions version
          on version.id = enrollment.course_version_id
        join public.certificate_revisions revision
          on revision.id = certificate.current_revision_id
        where certificate.current_status <> 'revoked'
          and not exists (
            select 1
            from public.certificate_revocation_requests pending
            where pending.certificate_id = certificate.id
              and pending.status = 'pending'
          )
          and (
            normalized_search is null
            or version.title ilike '%' || normalized_search || '%'
            or coalesce(person.display_name, '')
              ilike '%' || normalized_search || '%'
          )
        order by revision.issued_at desc, certificate.id
        limit submitted_limit
      ) option_row
    ), '[]'::jsonb),
    'pendingRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'requestId', request_row.request_id,
        'certificateId', request_row.certificate_id,
        'learnerLabel', request_row.learner_label,
        'courseTitle', request_row.course_title,
        'certificateKind', request_row.certificate_kind,
        'currentStatus', request_row.current_status,
        'requestedByLabel', request_row.requested_by_label,
        'reason', request_row.reason,
        'createdAt', request_row.created_at,
        'canDecide', request_row.requested_by <> actor
      ) order by request_row.created_at, request_row.request_id)
      from (
        select
          request.id as request_id,
          request.certificate_id,
          request.requested_by,
          internal.masked_person_label(person.display_name, '學員')
            as learner_label,
          version.title as course_title,
          certificate.certificate_kind,
          certificate.current_status,
          internal.masked_person_label(requester.display_name, '積分審核員')
            as requested_by_label,
          request.reason,
          request.created_at
        from public.certificate_revocation_requests request
        join public.certificates certificate
          on certificate.id = request.certificate_id
        join public.enrollments enrollment
          on enrollment.id = certificate.enrollment_id
        join public.people person on person.id = enrollment.person_id
        join public.people requester on requester.id = request.requested_by
        join public.course_versions version
          on version.id = enrollment.course_version_id
        where request.status = 'pending'
          and certificate.current_status <> 'revoked'
          and (
            normalized_search is null
            or version.title ilike '%' || normalized_search || '%'
            or coalesce(person.display_name, '')
              ilike '%' || normalized_search || '%'
          )
        order by request.created_at, request.id
        limit submitted_limit
      ) request_row
    ), '[]'::jsonb)
  ) into result;
  return result;
end
$$;
revoke all on function internal.read_certificate_revocation_workspace(
  text, integer
) from public;

create or replace function public.read_certificate_revocation_workspace(
  p_search text default null,
  p_limit integer default 50
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_certificate_revocation_workspace(p_search, p_limit)
$$;

create or replace function internal.request_certificate_revocation(
  target_certificate uuid,
  submitted_reason text,
  idempotency uuid,
  submitted_nonce_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  prior public.idempotency_records%rowtype;
  request_hash text;
  claim_identifier uuid;
  request_identifier uuid;
begin
  if not internal.has_staff_role('accreditation_reviewer')
     or target_certificate is null
     or idempotency is null
     or length(trim(coalesce(submitted_reason, '')))
       not between 10 and 1000
  then
    raise exception 'CERTIFICATE_REVOCATION_REQUEST_REJECTED';
  end if;
  request_hash := encode(extensions.digest(
    jsonb_build_object(
      'certificateId', target_certificate,
      'reason', trim(submitted_reason)
    )::text,
    'sha256'
  ), 'hex');

  select record.* into prior
  from public.idempotency_records record
  where record.actor_id = actor
    and record.operation = 'certificate_revocation_request_v2'
    and record.idempotency_key = idempotency
  for update;
  if found then
    if prior.request_hash <> request_hash
       or prior.response_body is null
       or coalesce(prior.response_body ->> 'requestId', '')
         !~ '^[0-9a-f-]{36}$'
    then raise exception 'IDEMPOTENCY_REQUEST_CONFLICT'; end if;
    return (prior.response_body ->> 'requestId')::uuid;
  end if;

  perform internal.consume_step_up_grant(
    'certificate_revoke', target_certificate::text, submitted_nonce_hash
  );
  if not exists (
    select 1
    from public.certificates certificate
    where certificate.id = target_certificate
      and certificate.current_status <> 'revoked'
  ) then
    raise exception 'CERTIFICATE_REVOCATION_REQUEST_REJECTED';
  end if;

  insert into public.idempotency_records (
    actor_id, operation, idempotency_key, request_hash, locked_until
  ) values (
    actor, 'certificate_revocation_request_v2', idempotency,
    request_hash, clock_timestamp() + interval '2 minutes'
  )
  on conflict (actor_id, operation, idempotency_key) do nothing
  returning id into claim_identifier;
  if claim_identifier is null then
    select record.* into prior
    from public.idempotency_records record
    where record.actor_id = actor
      and record.operation = 'certificate_revocation_request_v2'
      and record.idempotency_key = idempotency
    for update;
    if not found
       or prior.request_hash <> request_hash
       or prior.response_body is null
       or coalesce(prior.response_body ->> 'requestId', '')
         !~ '^[0-9a-f-]{36}$'
    then raise exception 'IDEMPOTENCY_REQUEST_CONFLICT'; end if;
    return (prior.response_body ->> 'requestId')::uuid;
  end if;

  insert into public.certificate_revocation_requests (
    certificate_id, requested_by, reason, idempotency_key
  ) values (
    target_certificate, actor, trim(submitted_reason), idempotency
  ) returning id into request_identifier;
  perform internal.append_audit_event(
    actor, 'certificate.revocation_requested',
    'certificate_revocation_request', request_identifier::text,
    trim(submitted_reason), null,
    jsonb_build_object('certificateId', target_certificate)
  );
  update public.idempotency_records
  set response_status = 200,
      response_body = jsonb_build_object('requestId', request_identifier),
      completed_at = clock_timestamp(),
      locked_until = null
  where id = claim_identifier;
  return request_identifier;
end
$$;
revoke all on function internal.request_certificate_revocation(
  uuid, text, uuid, text
) from public, anon, service_role;

create or replace function public.request_certificate_revocation(
  p_certificate_id uuid,
  p_reason text,
  p_idempotency_key uuid,
  p_nonce_hash text
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.request_certificate_revocation(
    p_certificate_id, p_reason, p_idempotency_key, p_nonce_hash
  )
$$;

revoke all on function public.decide_certificate_revocation(
  uuid, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function internal.decide_certificate_revocation(
  uuid, text, text, text
) from public, anon, authenticated, service_role;

create or replace function internal.decide_certificate_revocation(
  target_request uuid,
  submitted_decision text,
  submitted_reason text,
  idempotency uuid,
  submitted_nonce_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  prior public.idempotency_records%rowtype;
  request_hash text;
  claim_identifier uuid;
  request_row public.certificate_revocation_requests%rowtype;
  certificate_row public.certificates%rowtype;
  revision_row public.certificate_revisions%rowtype;
  next_revision_id uuid;
  resulting_status text;
begin
  if not internal.has_staff_role('accreditation_reviewer')
     or target_request is null
     or idempotency is null
     or submitted_decision not in ('approve', 'reject')
     or length(trim(coalesce(submitted_reason, '')))
       not between 10 and 1000
  then
    raise exception 'CERTIFICATE_REVOCATION_DECISION_REJECTED';
  end if;
  request_hash := encode(extensions.digest(
    jsonb_build_object(
      'requestId', target_request,
      'decision', submitted_decision,
      'reason', trim(submitted_reason)
    )::text,
    'sha256'
  ), 'hex');

  select record.* into prior
  from public.idempotency_records record
  where record.actor_id = actor
    and record.operation = 'certificate_revocation_decision_v2'
    and record.idempotency_key = idempotency
  for update;
  if found then
    if prior.request_hash <> request_hash
       or coalesce(prior.response_body ->> 'status', '')
         not in ('approved', 'rejected')
    then raise exception 'IDEMPOTENCY_REQUEST_CONFLICT'; end if;
    return prior.response_body ->> 'status';
  end if;

  perform internal.consume_step_up_grant(
    'certificate_revoke', target_request::text, submitted_nonce_hash
  );
  insert into public.idempotency_records (
    actor_id, operation, idempotency_key, request_hash, locked_until
  ) values (
    actor, 'certificate_revocation_decision_v2', idempotency,
    request_hash, clock_timestamp() + interval '2 minutes'
  )
  on conflict (actor_id, operation, idempotency_key) do nothing
  returning id into claim_identifier;
  if claim_identifier is null then
    select record.* into prior
    from public.idempotency_records record
    where record.actor_id = actor
      and record.operation = 'certificate_revocation_decision_v2'
      and record.idempotency_key = idempotency
    for update;
    if not found
       or prior.request_hash <> request_hash
       or coalesce(prior.response_body ->> 'status', '')
         not in ('approved', 'rejected')
    then raise exception 'IDEMPOTENCY_REQUEST_CONFLICT'; end if;
    return prior.response_body ->> 'status';
  end if;

  select request.* into request_row
  from public.certificate_revocation_requests request
  where request.id = target_request
  for update;
  if not found
     or request_row.status <> 'pending'
     or request_row.requested_by = actor
  then raise exception 'DISTINCT_CERTIFICATE_REVIEWER_REQUIRED'; end if;

  insert into public.certificate_revocation_decisions (
    request_id, reviewer_id, decision, reason
  ) values (
    target_request, actor, submitted_decision, trim(submitted_reason)
  );
  if submitted_decision = 'reject' then
    resulting_status := 'rejected';
    update public.certificate_revocation_requests
    set status = resulting_status, decided_at = clock_timestamp()
    where id = target_request;
  else
    select certificate.* into certificate_row
    from public.certificates certificate
    where certificate.id = request_row.certificate_id
    for update;
    if not found or certificate_row.current_status = 'revoked' then
      raise exception 'CERTIFICATE_ALREADY_REVOKED';
    end if;
    select revision.* into revision_row
    from public.certificate_revisions revision
    where revision.id = certificate_row.current_revision_id;
    if not found then raise exception 'CERTIFICATE_REVISION_REQUIRED'; end if;

    insert into public.certificate_revisions (
      certificate_id, revision, status, masked_name_snapshot,
      course_title_snapshot, course_version_snapshot, completed_on,
      accreditation_reference_snapshot, accreditation_points_snapshot,
      accreditation_authority_snapshot, live_session_snapshot,
      evidence_manifest_hash, pdf_object_path, pdf_sha256,
      verification_token_hash, issued_by, approved_by,
      revoked_at, revocation_reason
    ) values (
      certificate_row.id, revision_row.revision + 1, 'revoked',
      revision_row.masked_name_snapshot, revision_row.course_title_snapshot,
      revision_row.course_version_snapshot, revision_row.completed_on,
      revision_row.accreditation_reference_snapshot,
      revision_row.accreditation_points_snapshot,
      revision_row.accreditation_authority_snapshot,
      revision_row.live_session_snapshot,
      revision_row.evidence_manifest_hash, revision_row.pdf_object_path,
      revision_row.pdf_sha256,
      encode(extensions.digest(
        target_request::text || ':' || gen_random_uuid()::text
          || ':' || clock_timestamp()::text,
        'sha256'
      ), 'hex'),
      request_row.requested_by, actor, clock_timestamp(),
      trim(submitted_reason)
    ) returning id into next_revision_id;
    update public.certificates
    set current_revision_id = next_revision_id,
        current_status = 'revoked'
    where id = certificate_row.id;
    update public.enrollments
    set status = 'revoked'
    where id = certificate_row.enrollment_id
      and status in (
        'completed', 'submitted', 'credited', 'needs_correction'
      );
    resulting_status := 'approved';
    update public.certificate_revocation_requests
    set status = resulting_status, decided_at = clock_timestamp()
    where id = target_request;
    perform internal.append_organization_quality_correction(
      certificate_row.enrollment_id,
      'certificate_revocation',
      target_request,
      actor,
      submitted_reason
    );
    insert into public.notifications (
      person_id, category, title, body, business_key
    )
    select
      enrollment.person_id, 'certificate', '證明狀態已撤銷',
      '證明歷史仍保留；公開查驗頁會顯示目前撤銷狀態。',
      'certificate-revoked:' || certificate_row.id::text
    from public.enrollments enrollment
    where enrollment.id = certificate_row.enrollment_id
    on conflict (person_id, business_key) do nothing;
  end if;

  perform internal.append_audit_event(
    actor, 'certificate.revocation_' || resulting_status,
    'certificate_revocation_request', target_request::text,
    trim(submitted_reason), null,
    jsonb_build_object(
      'certificateId', request_row.certificate_id,
      'revisionId', next_revision_id
    )
  );
  update public.idempotency_records
  set response_status = 200,
      response_body = jsonb_build_object('status', resulting_status),
      completed_at = clock_timestamp(),
      locked_until = null
  where id = claim_identifier;
  return resulting_status;
end
$$;
revoke all on function internal.decide_certificate_revocation(
  uuid, text, text, uuid, text
) from public, anon, service_role;

create or replace function public.decide_certificate_revocation(
  p_request_id uuid,
  p_decision text,
  p_reason text,
  p_idempotency_key uuid,
  p_nonce_hash text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.decide_certificate_revocation(
    p_request_id, p_decision, p_reason, p_idempotency_key, p_nonce_hash
  )
$$;

create or replace function internal.read_survey_investigation_workspace(
  submitted_search text default null,
  submitted_cursor text default null,
  submitted_limit integer default 50
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  normalized_search text :=
    nullif(trim(coalesce(submitted_search, '')), '');
  cursor_identifier uuid;
  cursor_submitted_at timestamptz;
  result jsonb;
begin
  if not internal.has_staff_role('platform_admin')
     or submitted_limit not between 1 and 100
     or length(coalesce(normalized_search, '')) > 200
  then
    raise exception 'SURVEY_INVESTIGATION_WORKSPACE_REJECTED';
  end if;
  if submitted_cursor is not null then
    if submitted_cursor !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then
      raise exception 'SURVEY_INVESTIGATION_CURSOR_REJECTED';
    end if;
    cursor_identifier := submitted_cursor::uuid;
    select latest.submitted_at into cursor_submitted_at
    from public.survey_responses response
    join lateral (
      select revision.submitted_at
      from public.survey_response_revisions revision
      where revision.survey_response_id = response.id
      order by revision.revision desc
      limit 1
    ) latest on true
    where response.id = cursor_identifier;
    if not found then
      raise exception 'SURVEY_INVESTIGATION_CURSOR_REJECTED';
    end if;
  end if;

  with candidates as (
    select
      response.id,
      version.title as course_title,
      latest.revision,
      round((
        latest.ratings[1] + latest.ratings[2] + latest.ratings[3]
          + latest.ratings[4] + latest.ratings[5]
      )::numeric / 5, 2) as average_rating,
      coalesce(length(trim(latest.optional_comment)) > 0, false)
        as has_comment,
      latest.submitted_at,
      row_number() over (
        order by latest.submitted_at desc, response.id desc
      ) as row_number
    from public.survey_responses response
    join public.enrollments enrollment
      on enrollment.id = response.enrollment_id
    join public.course_versions version
      on version.id = enrollment.course_version_id
    join lateral (
      select revision.*
      from public.survey_response_revisions revision
      where revision.survey_response_id = response.id
      order by revision.revision desc
      limit 1
    ) latest on true
    where (
      cursor_submitted_at is null
      or (latest.submitted_at, response.id)
        < (cursor_submitted_at, cursor_identifier)
    )
      and (
        normalized_search is null
        or version.title ilike '%' || normalized_search || '%'
      )
    order by latest.submitted_at desc, response.id desc
    limit submitted_limit + 1
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'surveyResponseId', candidate.id,
      'courseTitle', candidate.course_title,
      'revision', candidate.revision,
      'averageRating', candidate.average_rating,
      'hasComment', candidate.has_comment,
      'submittedAt', candidate.submitted_at
    ) order by candidate.row_number)
      filter (where candidate.row_number <= submitted_limit), '[]'::jsonb),
    'nextCursor', case
      when max(candidate.row_number) > submitted_limit
        then (array_agg(candidate.id order by candidate.row_number))[
          submitted_limit
        ]::text
      else null
    end
  ) into result
  from candidates candidate;
  return result;
end
$$;
revoke all on function internal.read_survey_investigation_workspace(
  text, text, integer
) from public;

create or replace function public.read_survey_investigation_workspace(
  p_search text default null,
  p_cursor text default null,
  p_limit integer default 50
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_survey_investigation_workspace(
    p_search, p_cursor, p_limit
  )
$$;

revoke all on function public.read_survey_investigation(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function internal.read_survey_investigation(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function internal.read_survey_investigation(
  target_response uuid,
  submitted_reason text,
  submitted_nonce_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  result jsonb;
begin
  perform internal.consume_step_up_grant(
    'pii_decrypt', target_response::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('platform_admin')
     or length(trim(submitted_reason)) not between 10 and 1000
  then
    raise exception 'SURVEY_INVESTIGATION_REJECTED';
  end if;
  select jsonb_build_object(
    'surveyResponseId', response.id,
    'courseTitle', version.title,
    'revision', revision.revision,
    'ratings', revision.ratings,
    'comment', revision.optional_comment,
    'submittedAt', revision.submitted_at
  ) into result
  from public.survey_responses response
  join public.enrollments enrollment
    on enrollment.id = response.enrollment_id
  join public.course_versions version
    on version.id = enrollment.course_version_id
  join lateral (
    select candidate.*
    from public.survey_response_revisions candidate
    where candidate.survey_response_id = response.id
    order by candidate.revision desc
    limit 1
  ) revision on true
  where response.id = target_response;
  if result is null then
    raise exception 'SURVEY_RESPONSE_NOT_FOUND';
  end if;
  perform internal.append_audit_event(
    actor, 'survey.raw_investigation_read', 'survey_response',
    target_response::text, trim(submitted_reason), null,
    jsonb_build_object('fields', array['ratings', 'optional_comment'])
  );
  return result;
end
$$;
revoke all on function internal.read_survey_investigation(uuid, text, text)
  from public;

create or replace function public.read_survey_investigation(
  p_survey_response_id uuid,
  p_reason text,
  p_nonce_hash text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.read_survey_investigation(
    p_survey_response_id, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.read_quiz_attempt_invalidation_workspace()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  result jsonb;
begin
  if not internal.has_staff_role('accreditation_reviewer') then
    raise exception 'QUIZ_INVALIDATION_REVIEWER_REQUIRED';
  end if;
  select jsonb_build_object(
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', attempt_row.id,
        'enrollmentId', attempt_row.enrollment_id,
        'learnerLabel', attempt_row.learner_label,
        'courseLabel', attempt_row.course_label,
        'attemptNumber', attempt_row.attempt_number,
        'status', attempt_row.status,
        'score', attempt_row.score,
        'passingScore', 80,
        'submittedAt', attempt_row.submitted_at,
        'hasOpenRequest', attempt_row.has_open_request
      ) order by attempt_row.submitted_at desc, attempt_row.id)
      from (
        select
          attempt.id,
          attempt.enrollment_id,
          internal.masked_person_label(person.display_name, '學員')
            as learner_label,
          version.title as course_label,
          attempt.attempt_number,
          attempt.status,
          attempt.score,
          attempt.submitted_at,
          exists (
            select 1
            from public.quiz_attempt_invalidation_requests request
            left join public.quiz_attempt_invalidation_decisions decision
              on decision.request_id = request.id
            where request.quiz_attempt_id = attempt.id
              and decision.id is null
          ) as has_open_request
        from public.quiz_attempts attempt
        join public.enrollments enrollment
          on enrollment.id = attempt.enrollment_id
        join public.people person on person.id = enrollment.person_id
        join public.course_versions version
          on version.id = enrollment.course_version_id
        where attempt.submitted_at is not null
          and attempt.status in ('passed', 'failed', 'submitted')
        order by attempt.submitted_at desc, attempt.id
        limit 200
      ) attempt_row
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', request_row.id,
        'quizAttemptId', request_row.quiz_attempt_id,
        'learnerLabel', request_row.learner_label,
        'courseLabel', request_row.course_label,
        'attemptNumber', request_row.attempt_number,
        'score', request_row.score,
        'status', request_row.status,
        'requestedAt', request_row.requested_at,
        'requesterLabel', request_row.requester_label,
        'requestReason', request_row.request_reason,
        'decidedAt', request_row.decided_at,
        'decidedByLabel', request_row.decided_by_label,
        'decisionReason', request_row.decision_reason,
        'canReview', request_row.status = 'pending'
          and request_row.requested_by <> actor
      ) order by request_row.requested_at desc, request_row.id)
      from (
        select
          request.id,
          request.quiz_attempt_id,
          request.requested_by,
          internal.masked_person_label(person.display_name, '學員')
            as learner_label,
          version.title as course_label,
          attempt.attempt_number,
          attempt.score,
          case decision.decision
            when 'approve' then 'approved'
            when 'reject' then 'rejected'
            else 'pending'
          end as status,
          request.created_at as requested_at,
          internal.masked_person_label(
            requester.display_name, '積分審核員'
          ) as requester_label,
          request.reason as request_reason,
          decision.created_at as decided_at,
          case when decision.id is null then null else
            internal.masked_person_label(
              reviewer.display_name, '積分審核員'
            )
          end as decided_by_label,
          decision.reason as decision_reason
        from public.quiz_attempt_invalidation_requests request
        join public.quiz_attempts attempt
          on attempt.id = request.quiz_attempt_id
        join public.enrollments enrollment
          on enrollment.id = attempt.enrollment_id
        join public.people person on person.id = enrollment.person_id
        join public.people requester on requester.id = request.requested_by
        join public.course_versions version
          on version.id = enrollment.course_version_id
        left join public.quiz_attempt_invalidation_decisions decision
          on decision.request_id = request.id
        left join public.people reviewer
          on reviewer.id = decision.reviewer_id
        order by request.created_at desc, request.id
        limit 200
      ) request_row
    ), '[]'::jsonb)
  ) into result;
  return result;
end
$$;
revoke all on function
  internal.read_quiz_attempt_invalidation_workspace()
  from public;

create or replace function public.read_quiz_attempt_invalidation_workspace()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_quiz_attempt_invalidation_workspace()
$$;

create or replace function internal.request_quiz_attempt_invalidation(
  target_attempt uuid,
  submitted_reason text,
  idempotency uuid,
  submitted_nonce_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  existing_request public.quiz_attempt_invalidation_requests%rowtype;
  request_identifier uuid;
begin
  perform internal.consume_step_up_grant(
    'accreditation_result', target_attempt::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('accreditation_reviewer')
     or length(trim(submitted_reason)) not between 10 and 1000
  then
    raise exception 'QUIZ_INVALIDATION_REQUEST_REJECTED';
  end if;

  select request.* into existing_request
  from public.quiz_attempt_invalidation_requests request
  where request.idempotency_key = idempotency;
  if found then
    if existing_request.quiz_attempt_id <> target_attempt
       or existing_request.requested_by <> actor
       or existing_request.reason <> trim(submitted_reason)
    then
      raise exception 'QUIZ_INVALIDATION_IDEMPOTENCY_REPLAY_MISMATCH';
    end if;
    return existing_request.id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'suiyue:quiz-invalidation:' || target_attempt::text, 0
  ));
  if not exists (
    select 1
    from public.quiz_attempts attempt
    where attempt.id = target_attempt
      and attempt.submitted_at is not null
      and attempt.status in ('passed', 'failed', 'submitted')
  ) or exists (
    select 1
    from public.quiz_attempt_invalidation_requests request
    where request.quiz_attempt_id = target_attempt
  ) then
    raise exception 'QUIZ_INVALIDATION_REQUEST_REJECTED';
  end if;

  insert into public.quiz_attempt_invalidation_requests (
    quiz_attempt_id, requested_by, reason, idempotency_key
  ) values (
    target_attempt, actor, trim(submitted_reason), idempotency
  ) returning id into request_identifier;
  perform internal.append_audit_event(
    actor, 'quiz_attempt.invalidation_requested',
    'quiz_attempt_invalidation_request', request_identifier::text,
    trim(submitted_reason), null,
    jsonb_build_object('quizAttemptId', target_attempt)
  );
  return request_identifier;
end
$$;
revoke all on function internal.request_quiz_attempt_invalidation(
  uuid, text, uuid, text
) from public;

create or replace function public.request_quiz_attempt_invalidation(
  p_quiz_attempt_id uuid,
  p_reason text,
  p_idempotency_key uuid,
  p_nonce_hash text
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.request_quiz_attempt_invalidation(
    p_quiz_attempt_id, p_reason, p_idempotency_key, p_nonce_hash
  )
$$;

create or replace function internal.revoke_certificate_for_quiz_invalidation(
  target_enrollment uuid,
  target_request uuid,
  requesting_actor uuid,
  reviewing_actor uuid,
  submitted_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  certificate_row public.certificates%rowtype;
  revision_row public.certificate_revisions%rowtype;
  next_revision_id uuid;
begin
  select certificate.* into certificate_row
  from public.certificates certificate
  where certificate.enrollment_id = target_enrollment
    and certificate.current_status in (
      'active', 'submitted', 'credited', 'needs_correction'
    )
  for update;
  if not found then
    return null;
  end if;
  select revision.* into revision_row
  from public.certificate_revisions revision
  where revision.id = certificate_row.current_revision_id;
  if not found or revision_row.status = 'revoked' then
    return null;
  end if;
  insert into public.certificate_revisions (
    certificate_id, revision, status, masked_name_snapshot,
    course_title_snapshot, course_version_snapshot, completed_on,
    accreditation_reference_snapshot, accreditation_points_snapshot,
    accreditation_authority_snapshot, live_session_snapshot,
    evidence_manifest_hash, pdf_object_path, pdf_sha256,
    verification_token_hash, issued_by, approved_by,
    revoked_at, revocation_reason
  ) values (
    certificate_row.id, revision_row.revision + 1, 'revoked',
    revision_row.masked_name_snapshot, revision_row.course_title_snapshot,
    revision_row.course_version_snapshot, revision_row.completed_on,
    revision_row.accreditation_reference_snapshot,
    revision_row.accreditation_points_snapshot,
    revision_row.accreditation_authority_snapshot,
    revision_row.live_session_snapshot,
    revision_row.evidence_manifest_hash, revision_row.pdf_object_path,
    revision_row.pdf_sha256,
    encode(extensions.digest(
      target_request::text || ':' || gen_random_uuid()::text
        || ':' || clock_timestamp()::text,
      'sha256'
    ), 'hex'),
    requesting_actor, reviewing_actor, clock_timestamp(),
    trim(submitted_reason)
  ) returning id into next_revision_id;
  update public.certificates
  set current_revision_id = next_revision_id,
      current_status = 'revoked'
  where id = certificate_row.id;
  return certificate_row.id;
end
$$;
revoke all on function
  internal.revoke_certificate_for_quiz_invalidation(
    uuid, uuid, uuid, uuid, text
  ) from public;

create or replace function internal.decide_quiz_attempt_invalidation(
  target_request uuid,
  submitted_decision text,
  submitted_reason text,
  idempotency uuid,
  submitted_nonce_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  request_row public.quiz_attempt_invalidation_requests%rowtype;
  prior_decision public.quiz_attempt_invalidation_decisions%rowtype;
  attempt_row public.quiz_attempts%rowtype;
  request_hash text;
  quiz_eligible_before boolean;
  quiz_eligible_after boolean;
  authoritative_completion_before boolean;
  completion_eligible_before boolean;
  completion_eligible_after boolean;
  revoked_certificate_id uuid;
begin
  if not internal.has_staff_role('accreditation_reviewer')
     or idempotency is null
     or submitted_decision not in ('approve', 'reject')
     or length(trim(submitted_reason)) not between 10 and 1000
  then
    raise exception 'QUIZ_INVALIDATION_DECISION_REJECTED';
  end if;
  request_hash := encode(extensions.digest(
    jsonb_build_object(
      'requestId', target_request,
      'decision', submitted_decision,
      'reason', trim(submitted_reason)
    )::text,
    'sha256'
  ), 'hex');
  select decision.* into prior_decision
  from public.quiz_attempt_invalidation_decisions decision
  where decision.reviewer_id = actor
    and decision.idempotency_key = idempotency;
  if found then
    if prior_decision.request_id <> target_request
       or prior_decision.request_hash <> request_hash
       or prior_decision.decision <> submitted_decision
       or prior_decision.reason <> trim(submitted_reason)
    then
      raise exception 'QUIZ_INVALIDATION_IDEMPOTENCY_REPLAY_MISMATCH';
    end if;
    return case prior_decision.decision
      when 'approve' then 'approved' else 'rejected'
    end;
  end if;

  perform internal.consume_step_up_grant(
    'accreditation_result', target_request::text, submitted_nonce_hash
  );
  select request.* into request_row
  from public.quiz_attempt_invalidation_requests request
  where request.id = target_request
  for update;
  if not found
     or request_row.requested_by = actor
  then
    raise exception 'DISTINCT_QUIZ_INVALIDATION_REVIEWER_REQUIRED';
  end if;
  select decision.* into prior_decision
  from public.quiz_attempt_invalidation_decisions decision
  where decision.request_id = target_request;
  if found then
    if prior_decision.reviewer_id = actor
       and prior_decision.idempotency_key = idempotency
       and prior_decision.request_hash = request_hash
       and prior_decision.decision = submitted_decision
       and prior_decision.reason = trim(submitted_reason)
    then
      return case prior_decision.decision
        when 'approve' then 'approved' else 'rejected'
      end;
    end if;
    raise exception 'QUIZ_INVALIDATION_ALREADY_DECIDED';
  end if;
  select attempt.* into attempt_row
  from public.quiz_attempts attempt
  where attempt.id = request_row.quiz_attempt_id
  for update;
  if not found or attempt_row.status not in (
    'passed', 'failed', 'submitted'
  ) then
    raise exception 'QUIZ_INVALIDATION_ATTEMPT_NOT_DECIDABLE';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'suiyue:quiz-invalidation-enrollment:'
      || attempt_row.enrollment_id::text,
    0
  ));
  perform 1
  from public.enrollments enrollment
  where enrollment.id = attempt_row.enrollment_id
  for update;
  if not found then
    raise exception 'QUIZ_INVALIDATION_ENROLLMENT_REQUIRED';
  end if;

  insert into public.quiz_attempt_invalidation_decisions (
    request_id, reviewer_id, decision, reason,
    idempotency_key, request_hash
  ) values (
    target_request, actor, submitted_decision, trim(submitted_reason),
    idempotency, request_hash
  );
  if submitted_decision = 'reject' then
    perform internal.append_audit_event(
      actor, 'quiz_attempt.invalidation_rejected',
      'quiz_attempt_invalidation_request', target_request::text,
      trim(submitted_reason), null,
      jsonb_build_object('quizAttemptId', attempt_row.id)
    );
    return 'rejected';
  end if;

  select exists (
    select 1
    from public.quiz_attempts attempt
    where attempt.enrollment_id = attempt_row.enrollment_id
      and attempt.status = 'passed'
      and attempt.score >= 80
  ) into quiz_eligible_before;
  select
    enrollment.status in (
      'completed', 'submitted', 'credited', 'needs_correction'
    )
    or coalesce((
      select snapshot.eligible
      from public.eligibility_snapshots snapshot
      where snapshot.enrollment_id = enrollment.id
      order by snapshot.created_at desc, snapshot.id desc
      limit 1
    ), false)
    or exists (
      select 1
      from public.certificates certificate
      where certificate.enrollment_id = enrollment.id
        and certificate.current_status in (
          'active', 'submitted', 'credited', 'needs_correction'
        )
    )
  into authoritative_completion_before
  from public.enrollments enrollment
  where enrollment.id = attempt_row.enrollment_id;
  completion_eligible_before :=
    authoritative_completion_before and quiz_eligible_before;

  update public.quiz_attempts
  set status = 'voided',
      voided_by = actor,
      void_reason = trim(submitted_reason)
  where id = attempt_row.id;

  select exists (
    select 1
    from public.quiz_attempts attempt
    where attempt.enrollment_id = attempt_row.enrollment_id
      and attempt.status = 'passed'
      and attempt.score >= 80
  ) into quiz_eligible_after;
  completion_eligible_after :=
    authoritative_completion_before and quiz_eligible_after;

  if completion_eligible_before and not completion_eligible_after then
    insert into public.eligibility_snapshots (
      enrollment_id, accreditation_revision_id, authoritative_date,
      entitlement_valid, identity_verified, recorded_requirement_met,
      live_requirements_met, quiz_passed, survey_completed,
      accreditation_valid, evidence_manifest_hash, signed_snapshot
    )
    select
      snapshot.enrollment_id, snapshot.accreditation_revision_id,
      snapshot.authoritative_date, snapshot.entitlement_valid,
      snapshot.identity_verified, snapshot.recorded_requirement_met,
      snapshot.live_requirements_met, false,
      snapshot.survey_completed, snapshot.accreditation_valid,
      encode(extensions.digest(
        snapshot.evidence_manifest_hash || ':' || target_request::text,
        'sha256'
      ), 'hex'),
      snapshot.signed_snapshot || jsonb_build_object(
        'quizAttemptInvalidationRequestId', target_request,
        'quizAttemptId', attempt_row.id,
        'quizPassed', false,
        'causalTransition', 'completion_true_to_false'
      )
    from public.eligibility_snapshots snapshot
    where snapshot.enrollment_id = attempt_row.enrollment_id
    order by snapshot.created_at desc, snapshot.id desc
    limit 1;

    update public.enrollments
    set status = 'active',
        completed_at = null,
        submitted_at = null,
        credited_at = null
    where id = attempt_row.enrollment_id
      and status in (
        'completed', 'submitted', 'credited', 'needs_correction'
      );

    revoked_certificate_id :=
      internal.revoke_certificate_for_quiz_invalidation(
        attempt_row.enrollment_id, target_request,
        request_row.requested_by, actor, submitted_reason
      );
    insert into public.notifications (
      person_id, category, title, body, business_key
    )
    select
      enrollment.person_id, 'quiz', '測驗結果已作廢',
      '本次測驗經雙人覆核後已作廢；你可以重新應試。原因：'
        || trim(submitted_reason),
      'quiz-invalidation-approved:' || target_request::text
    from public.enrollments enrollment
    where enrollment.id = attempt_row.enrollment_id
      on conflict (person_id, business_key) do nothing;
  end if;

  perform internal.append_organization_quality_correction(
    attempt_row.enrollment_id,
    'quiz_attempt_invalidation',
    target_request,
    actor,
    submitted_reason
  );
  perform internal.append_audit_event(
    actor, 'quiz_attempt.invalidation_approved',
    'quiz_attempt_invalidation_request', target_request::text,
    trim(submitted_reason), null,
    jsonb_build_object(
      'quizAttemptId', attempt_row.id,
      'enrollmentId', attempt_row.enrollment_id,
      'quizEligibleBefore', quiz_eligible_before,
      'quizEligibleAfter', quiz_eligible_after,
      'completionEligibleBefore', completion_eligible_before,
      'completionEligibleAfter', completion_eligible_after,
      'certificateRevokedId', revoked_certificate_id
    )
  );
  return 'approved';
end
$$;
revoke all on function internal.decide_quiz_attempt_invalidation(
  uuid, text, text, uuid, text
) from public;

create or replace function public.decide_quiz_attempt_invalidation(
  p_request_id uuid,
  p_decision text,
  p_reason text,
  p_idempotency_key uuid,
  p_nonce_hash text
)
returns text
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.decide_quiz_attempt_invalidation(
    p_request_id, p_decision, p_reason, p_idempotency_key, p_nonce_hash
  )
$$;

create or replace function internal.read_my_quiz_attempt_invalidation_statuses(
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
  result jsonb;
begin
  if not exists (
    select 1
    from public.enrollments enrollment
    where enrollment.id = target_enrollment
      and enrollment.person_id = actor
  ) then
    raise exception 'QUIZ_INVALIDATION_STATUS_NOT_AUTHORIZED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'attemptId', attempt.id,
    'attemptNumber', attempt.attempt_number,
    'score', attempt.score,
    'status', attempt.status,
    'requestStatus', case
      when request.id is null then null
      when decision.decision = 'approve' then 'approved'
      when decision.decision = 'reject' then 'rejected'
      else 'pending'
    end,
    'requestedAt', request.created_at,
    'decidedAt', decision.created_at,
    'reason', case
      when decision.id is not null then decision.reason
      else request.reason
    end
  ) order by attempt.attempt_number desc), '[]'::jsonb)
  into result
  from public.quiz_attempts attempt
  left join public.quiz_attempt_invalidation_requests request
    on request.quiz_attempt_id = attempt.id
  left join public.quiz_attempt_invalidation_decisions decision
    on decision.request_id = request.id
  where attempt.enrollment_id = target_enrollment;
  return result;
end
$$;
revoke all on function
  internal.read_my_quiz_attempt_invalidation_statuses(uuid)
  from public;

create or replace function public.read_my_quiz_attempt_invalidation_statuses(
  p_enrollment_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_my_quiz_attempt_invalidation_statuses(
    p_enrollment_id
  )
$$;

create or replace function internal.organization_assignment_current_outcome(
  target_assignment uuid
)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'progressPercent', least(100, case
      when requirement.required_watch_seconds = 0 then 100
      else round(
        coalesce(progress.confirmed_valid_seconds, 0)::numeric
          * 100 / requirement.required_watch_seconds
      )::integer
    end),
    'validMinutes',
      floor(coalesce(progress.confirmed_valid_seconds, 0) / 60.0)::integer,
    'quizScore', (
      select attempt.score
      from public.quiz_attempts attempt
      where attempt.enrollment_id = enrollment.id
        and attempt.submitted_at is not null
        and attempt.status <> 'voided'
      order by attempt.attempt_number desc
      limit 1
    ),
    'quizPassed', coalesce((
      select attempt.passed
      from public.quiz_attempts attempt
      where attempt.enrollment_id = enrollment.id
        and attempt.submitted_at is not null
        and attempt.status <> 'voided'
      order by attempt.attempt_number desc
      limit 1
    ), false),
    'completionStatus', coalesce(enrollment.status, 'not_started'),
    'enrollmentStatus', coalesce(enrollment.status, 'not_started'),
    'accreditationStatus', coalesce(accreditation.status, 'not_started'),
    'certificateStatus', case
      when exists (
        select 1
        from public.live_bookings booking
        join public.attendance_summaries attendance
          on attendance.live_booking_id = booking.id
        where booking.enrollment_id = enrollment.id
          and attendance.quarantined_at is not null
      ) then 'needs_correction'
      else certificate.current_status
    end,
    'completedAt', enrollment.completed_at
  )
  from public.organization_assignments assignment
  join public.course_versions version
    on version.id = assignment.course_version_id
  join public.course_requirements requirement
    on requirement.course_version_id = version.id
  left join public.entitlements entitlement
    on entitlement.source_type = 'organization_assignment'
   and entitlement.source_id = assignment.id
  left join public.enrollments enrollment
    on enrollment.entitlement_id = entitlement.id
  left join public.progress_summaries progress
    on progress.enrollment_id = enrollment.id
  left join public.certificates certificate
    on certificate.enrollment_id = enrollment.id
  left join lateral (
    select decision.status
    from public.course_version_accreditation link
    join public.accreditation_decision_revisions decision
      on decision.id = link.accreditation_revision_id
    where link.course_version_id = version.id
    order by decision.revision desc
    limit 1
  ) accreditation on true
  where assignment.id = target_assignment
$$;
revoke all on function internal.organization_assignment_current_outcome(uuid)
  from public;

create or replace function internal.organization_assignment_visible_outcome(
  target_assignment uuid
)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select case
    when membership.active then
      internal.organization_assignment_current_outcome(assignment.id)
    else
      coalesce(snapshot.outcome, jsonb_build_object(
        'progressPercent', 0,
        'validMinutes', 0,
        'quizScore', null,
        'quizPassed', false,
        'completionStatus', 'historical_unavailable',
        'enrollmentStatus', 'historical_unavailable',
        'accreditationStatus', 'historical_unavailable',
        'certificateStatus', null,
        'completedAt', null
      )) || coalesce(correction.correction, '{}'::jsonb)
  end
  from public.organization_assignments assignment
  join public.organization_memberships membership
    on membership.organization_id = assignment.organization_id
   and membership.person_id = assignment.member_person_id
  left join lateral (
    select
      stored.outcome,
      stored.membership_lifecycle_revision,
      stored.visibility_cutoff_at
    from public.organization_assignment_outcome_snapshots stored
    where stored.assignment_id = assignment.id
    order by stored.membership_lifecycle_revision desc,
      stored.captured_at desc, stored.id desc
    limit 1
  ) snapshot on true
  left join lateral (
    select stored.correction
    from public.organization_assignment_outcome_corrections stored
    where stored.assignment_id = assignment.id
      and stored.membership_lifecycle_revision =
        snapshot.membership_lifecycle_revision
      and stored.created_at >= snapshot.visibility_cutoff_at
    order by stored.created_at desc, stored.id desc
    limit 1
  ) correction on true
  where assignment.id = target_assignment
$$;
revoke all on function internal.organization_assignment_visible_outcome(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.read_public_course_outline(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.authorize_public_course_preview(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.request_certificate_revocation(
  uuid, text, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.decide_certificate_revocation(
  uuid, text, text, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.read_certificate_revocation_workspace(
  text, integer
) from public, anon, authenticated, service_role;
revoke all on function public.read_survey_investigation_workspace(
  text, text, integer
) from public, anon, authenticated, service_role;
revoke all on function public.read_survey_investigation(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function
  public.read_quiz_attempt_invalidation_workspace()
  from public, anon, authenticated, service_role;
revoke all on function public.request_quiz_attempt_invalidation(
  uuid, text, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.decide_quiz_attempt_invalidation(
  uuid, text, text, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function
  public.read_my_quiz_attempt_invalidation_statuses(uuid)
  from public, anon, authenticated, service_role;

grant execute on function internal.read_public_course_outline(uuid)
  to anon, authenticated;
grant execute on function public.read_public_course_outline(uuid)
  to anon, authenticated;
grant execute on function
  internal.authorize_public_course_preview(uuid, uuid)
  to service_role;
grant execute on function
  public.authorize_public_course_preview(uuid, uuid)
  to service_role;
grant execute on function internal.request_certificate_revocation(
  uuid, text, uuid, text
) to authenticated;
grant execute on function public.request_certificate_revocation(
  uuid, text, uuid, text
) to authenticated;
grant execute on function internal.decide_certificate_revocation(
  uuid, text, text, uuid, text
) to authenticated;
grant execute on function public.decide_certificate_revocation(
  uuid, text, text, uuid, text
) to authenticated;
grant execute on function
  internal.read_certificate_revocation_workspace(text, integer)
  to authenticated;
grant execute on function
  public.read_certificate_revocation_workspace(text, integer)
  to authenticated;
grant execute on function
  internal.read_survey_investigation_workspace(text, text, integer)
  to authenticated;
grant execute on function
  public.read_survey_investigation_workspace(text, text, integer)
  to authenticated;
grant execute on function
  internal.read_survey_investigation(uuid, text, text)
  to authenticated;
grant execute on function
  public.read_survey_investigation(uuid, text, text)
  to authenticated;
grant execute on function
  internal.read_quiz_attempt_invalidation_workspace()
  to authenticated;
grant execute on function
  public.read_quiz_attempt_invalidation_workspace()
  to authenticated;
grant execute on function internal.request_quiz_attempt_invalidation(
  uuid, text, uuid, text
) to authenticated;
grant execute on function public.request_quiz_attempt_invalidation(
  uuid, text, uuid, text
) to authenticated;
grant execute on function internal.decide_quiz_attempt_invalidation(
  uuid, text, text, uuid, text
) to authenticated;
grant execute on function public.decide_quiz_attempt_invalidation(
  uuid, text, text, uuid, text
) to authenticated;
grant execute on function
  internal.read_my_quiz_attempt_invalidation_statuses(uuid)
  to authenticated;
grant execute on function
  public.read_my_quiz_attempt_invalidation_statuses(uuid)
  to authenticated;
