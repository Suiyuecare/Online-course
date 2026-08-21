-- Google-Form registration pages are informational catalog entries. They do
-- not create a platform order, entitlement, or learner credit record, so they
-- have a deliberately separate review path from paid/internal courses. The
-- existing formal publication implementation remains unchanged.

-- Stored registration targets intentionally contain no query or fragment.
-- This prevents Google Forms entry.* prefill values from persisting personal
-- data in a public catalog URL.
update public.course_versions version
set external_registration_url = regexp_replace(
  version.external_registration_url,
  '[?#].*$',
  ''
)
where version.registration_mode = 'google_form'
  and version.external_registration_url ~ '[?#]';

alter table public.course_versions
  drop constraint if exists course_versions_registration_target_check,
  add constraint course_versions_registration_target_check check (
    (
      registration_mode = 'internal'
      and external_registration_url is null
    )
    or (
      registration_mode = 'google_form'
      and external_registration_url is not null
      and external_registration_url = btrim(external_registration_url)
      and length(external_registration_url) between 1 and 2048
      and (
        external_registration_url ~
          '^https://forms\.gle/[A-Za-z0-9_-]+$'
        or external_registration_url ~
          '^https://docs\.google\.com/forms/d/(?:e/)?[A-Za-z0-9_-]+/viewform$'
      )
    )
  );

create or replace function internal.is_strict_google_form_url(candidate text)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select candidate is not null
    and candidate = btrim(candidate)
    and length(candidate) between 1 and 2048
    and (
      candidate ~ '^https://forms\.gle/[A-Za-z0-9_-]+$'
      or candidate ~
        '^https://docs\.google\.com/forms/d/(?:e/)?[A-Za-z0-9_-]+/viewform$'
    )
$$;

revoke all on function internal.is_strict_google_form_url(text)
  from public, anon, authenticated, service_role;

create or replace function internal.google_form_course_page_is_complete(
  target_version uuid
)
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  version_row public.course_versions%rowtype;
begin
  select version.* into version_row
  from public.course_versions version
  where version.id = target_version;
  if not found
     or version_row.registration_mode <> 'google_form'
     or not internal.is_strict_google_form_url(
       version_row.external_registration_url
     )
     or length(btrim(version_row.registration_cta_label)) not between 2 and 20
     or length(btrim(version_row.title)) not between 2 and 200
     or length(btrim(version_row.summary)) not between 10 and 500
     or length(btrim(version_row.description)) not between 20 and 10000
     or not version_row.has_cover
     or version_row.category_code is null
  then
    return false;
  end if;

  if jsonb_typeof(version_row.learning_objectives) <> 'array'
     or jsonb_array_length(version_row.learning_objectives) < 1
  then
    return false;
  end if;
  if exists (
    select 1
    from jsonb_array_elements(version_row.learning_objectives) objective(value)
    where jsonb_typeof(objective.value) <> 'string'
      or length(btrim(objective.value #>> '{}')) not between 2 and 300
  ) then
    return false;
  end if;
  if not exists (
    select 1
    from public.course_categories category
    where category.code = version_row.category_code
      and category.active
  ) then
    return false;
  end if;
  if not exists (
    select 1
    from public.course_instructors course_instructor
    join public.instructors instructor
      on instructor.id = course_instructor.instructor_id
    where course_instructor.course_version_id = version_row.id
      and instructor.active
      and length(btrim(instructor.display_name)) >= 2
      and length(btrim(instructor.biography)) >= 10
      and length(btrim(instructor.credentials)) >= 5
  ) then
    return false;
  end if;
  return true;
end
$$;

revoke all on function internal.google_form_course_page_is_complete(uuid)
  from public, anon, authenticated, service_role;

create or replace function internal.update_course_registration_settings_guarded(
  target_version uuid,
  submitted_mode text,
  submitted_url text,
  submitted_cta_label text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if submitted_mode = 'google_form'
     and not internal.is_strict_google_form_url(submitted_url)
  then
    raise exception 'COURSE_REGISTRATION_SETTINGS_INVALID';
  end if;
  return internal.update_course_registration_settings(
    target_version,
    submitted_mode,
    submitted_url,
    submitted_cta_label,
    idempotency
  );
end
$$;

revoke all on function internal.update_course_registration_settings(
  uuid, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function internal.update_course_registration_settings_guarded(
  uuid, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.update_course_registration_settings_guarded(
  uuid, text, text, text, uuid
) to authenticated;

create or replace function public.update_course_registration_settings(
  p_course_version_id uuid,
  p_registration_mode text,
  p_external_registration_url text,
  p_registration_cta_label text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.update_course_registration_settings_guarded(
    p_course_version_id,
    p_registration_mode,
    p_external_registration_url,
    p_registration_cta_label,
    p_idempotency_key
  )
$$;

revoke all on function public.update_course_registration_settings(
  uuid, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.update_course_registration_settings(
  uuid, text, text, text, uuid
) to authenticated;

create or replace function
internal.submit_google_form_course_version_for_review_idempotent(
  target_version uuid,
  submitted_reason text,
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
  prior public.idempotency_records%rowtype;
  request_hash text;
  result jsonb;
begin
  if actor is null
     or not internal.has_staff_role('course_admin')
     or target_version is null
     or idempotency is null
     or length(btrim(coalesce(submitted_reason, ''))) not between 10 and 1000
  then
    raise exception 'COURSE_SUBMISSION_REJECTED';
  end if;

  request_hash := internal.canonical_request_hash(jsonb_build_object(
    'courseVersionId', target_version,
    'reason', btrim(submitted_reason),
    'registrationMode', 'google_form'
  ));
  select record.* into prior
  from public.idempotency_records record
  where record.actor_id = actor
    and record.operation = 'google_form_course_submit_review'
    and record.idempotency_key = idempotency
  for update;
  if found then
    if prior.request_hash <> request_hash
       or prior.completed_at is null
       or prior.response_body is null
    then
      raise exception 'IDEMPOTENCY_REQUEST_CONFLICT';
    end if;
    return prior.response_body;
  end if;

  insert into public.idempotency_records (
    actor_id, operation, idempotency_key, request_hash, locked_until
  ) values (
    actor,
    'google_form_course_submit_review',
    idempotency,
    request_hash,
    clock_timestamp() + interval '1 minute'
  )
  on conflict (actor_id, operation, idempotency_key) do nothing;
  if not found then
    raise exception 'IDEMPOTENCY_REQUEST_CONFLICT';
  end if;

  select version.* into version_row
  from public.course_versions version
  where version.id = target_version
  for update;
  if not found
     or version_row.status <> 'draft'
     or version_row.registration_mode <> 'google_form'
     or version_row.created_by <> actor
     or internal.has_exact_staff_role('platform_admin')
     or not internal.google_form_course_page_is_complete(target_version)
  then
    raise exception 'GOOGLE_FORM_COURSE_NOT_READY';
  end if;

  update public.course_versions version
  set status = 'in_review',
      submitted_by = actor,
      submitted_at = clock_timestamp()
  where version.id = target_version
    and version.status = 'draft';
  if not found then
    raise exception 'COURSE_DRAFT_REQUIRED';
  end if;

  insert into public.course_publication_reviews (
    course_version_id, submitted_by, status, checklist, reason
  ) values (
    target_version,
    actor,
    'pending',
    jsonb_build_object(
      'registrationMode', 'google_form',
      'strictGoogleFormUrlVerified', true,
      'corePageContentVerified', true,
      'submittedAt', clock_timestamp()
    ),
    btrim(submitted_reason)
  );

  result := jsonb_build_object(
    'courseVersionId', target_version,
    'submitted', true,
    'status', 'in_review',
    'registrationMode', 'google_form'
  );
  update public.idempotency_records
  set response_status = 200,
      response_body = result,
      completed_at = clock_timestamp(),
      locked_until = null
  where actor_id = actor
    and operation = 'google_form_course_submit_review'
    and idempotency_key = idempotency;
  perform internal.append_audit_event(
    actor,
    'course.submitted_for_review',
    'course_version',
    target_version::text,
    btrim(submitted_reason),
    null,
    jsonb_build_object(
      'registrationMode', 'google_form',
      'strictGoogleFormUrlVerified', true,
      'corePageContentVerified', true
    )
  );
  return result;
end
$$;

revoke all on function
internal.submit_google_form_course_version_for_review_idempotent(
  uuid, text, uuid
) from public, anon, authenticated, service_role;

create or replace function internal.submit_course_version_for_review_dispatch(
  target_version uuid,
  submitted_reason text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  registration_path text;
  author uuid;
begin
  if not internal.has_staff_role('course_admin')
     or internal.has_exact_staff_role('platform_admin')
  then
    raise exception 'COURSE_SUBMISSION_REJECTED';
  end if;
  select version.registration_mode, version.created_by
    into registration_path, author
  from public.course_versions version
  where version.id = target_version
  for update;
  if not found or author is distinct from internal.current_person_id() then
    raise exception 'COURSE_SUBMISSION_REJECTED';
  end if;
  if registration_path = 'google_form' then
    return internal.submit_google_form_course_version_for_review_idempotent(
      target_version, submitted_reason, idempotency
    );
  end if;
  return internal.submit_course_version_for_review_idempotent(
    target_version, submitted_reason, idempotency
  );
end
$$;

revoke all on function internal.submit_course_version_for_review_dispatch(
  uuid, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.submit_course_version_for_review_dispatch(
  uuid, text, uuid
) to authenticated;

-- The formal implementation is owner-only now; authenticated callers must go
-- through the locked dispatcher so registration_mode cannot be raced.
revoke all on function
internal.submit_course_version_for_review_idempotent(uuid, text, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.submit_course_version_for_review(
  p_course_version_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.submit_course_version_for_review_dispatch(
    p_course_version_id,
    p_reason,
    p_idempotency_key
  )
$$;

revoke all on function public.submit_course_version_for_review(
  uuid, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.submit_course_version_for_review(
  uuid, text, uuid
) to authenticated;

create or replace function
internal.publish_google_form_course_version_idempotent(
  target_version uuid,
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
  review_row public.course_publication_reviews%rowtype;
  prior public.idempotency_records%rowtype;
  request_hash text;
  result jsonb;
begin
  if actor is null
     or not internal.has_exact_staff_role('platform_admin')
     or target_version is null
     or idempotency is null
     or length(btrim(coalesce(submitted_reason, ''))) not between 10 and 1000
     or coalesce(submitted_nonce_hash, '') !~ '^[a-f0-9]{64}$'
  then
    raise exception 'EXECUTIVE_APPROVAL_REQUIRED';
  end if;

  request_hash := internal.canonical_request_hash(jsonb_build_object(
    'courseVersionId', target_version,
    'reason', btrim(submitted_reason),
    'stepUpNonceHash', submitted_nonce_hash,
    'registrationMode', 'google_form'
  ));
  select record.* into prior
  from public.idempotency_records record
  where record.actor_id = actor
    and record.operation = 'google_form_course_publish'
    and record.idempotency_key = idempotency
  for update;
  if found then
    if prior.request_hash <> request_hash
       or prior.completed_at is null
       or prior.response_body is null
    then
      raise exception 'IDEMPOTENCY_REQUEST_CONFLICT';
    end if;
    return prior.response_body;
  end if;

  insert into public.idempotency_records (
    actor_id, operation, idempotency_key, request_hash, locked_until
  ) values (
    actor,
    'google_form_course_publish',
    idempotency,
    request_hash,
    clock_timestamp() + interval '1 minute'
  )
  on conflict (actor_id, operation, idempotency_key) do nothing;
  if not found then
    raise exception 'IDEMPOTENCY_REQUEST_CONFLICT';
  end if;

  select version.* into version_row
  from public.course_versions version
  where version.id = target_version
  for update;
  if not found
     or version_row.status <> 'in_review'
     or version_row.registration_mode <> 'google_form'
     or version_row.submitted_by is null
     or version_row.submitted_by = actor
     or not internal.google_form_course_page_is_complete(target_version)
  then
    raise exception 'GOOGLE_FORM_PUBLICATION_REJECTED';
  end if;

  perform internal.consume_step_up_grant(
    'course_publish', target_version::text, submitted_nonce_hash
  );

  select publication.* into review_row
  from public.course_publication_reviews publication
  where publication.course_version_id = target_version
    and publication.status = 'pending'
  order by publication.submitted_at desc, publication.id desc
  limit 1
  for update;
  if not found
     or review_row.submitted_by <> version_row.submitted_by
     or review_row.submitted_by = actor
  then
    raise exception 'COURSE_PENDING_REVIEW_REQUIRED';
  end if;

  update public.course_versions version
  set status = 'published',
      published_by = actor,
      published_at = clock_timestamp()
  where version.id = target_version
    and version.status = 'in_review';
  if not found then
    raise exception 'COURSE_NOT_IN_REVIEW';
  end if;

  update public.course_publication_reviews publication
  set reviewed_by = actor,
      status = 'approved',
      checklist = publication.checklist || jsonb_build_object(
      'registrationMode', 'google_form',
      'strictGoogleFormUrlVerified', true,
      'corePageContentVerified', true,
      'executiveAal2Verified', true,
      'separateReviewerVerified', true
      ),
      reason = btrim(submitted_reason),
      reviewed_at = clock_timestamp()
  where publication.id = review_row.id;

  result := jsonb_build_object(
    'courseVersionId', target_version,
    'published', true,
    'status', 'published',
    'registrationMode', 'google_form'
  );
  update public.idempotency_records
  set response_status = 200,
      response_body = result,
      completed_at = clock_timestamp(),
      locked_until = null
  where actor_id = actor
    and operation = 'google_form_course_publish'
    and idempotency_key = idempotency;
  perform internal.append_audit_event(
    actor,
    'course.published',
    'course_version',
    target_version::text,
    btrim(submitted_reason),
    null,
    jsonb_build_object(
      'registrationMode', 'google_form',
      'strictGoogleFormUrlVerified', true,
      'corePageContentVerified', true,
      'executiveAal2Verified', true,
      'separateReviewerVerified', true
    )
  );
  return result;
end
$$;

revoke all on function
internal.publish_google_form_course_version_idempotent(
  uuid, text, text, uuid
) from public, anon, authenticated, service_role;

create or replace function internal.publish_course_version_as_platform_admin(
  target_version uuid,
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
  registration_path text;
begin
  if not internal.has_exact_staff_role('platform_admin') then
    raise exception 'EXECUTIVE_APPROVAL_REQUIRED';
  end if;
  select version.registration_mode into registration_path
  from public.course_versions version
  where version.id = target_version
  for update;
  if not found then
    raise exception 'COURSE_NOT_IN_REVIEW';
  end if;
  if registration_path = 'google_form' then
    return internal.publish_google_form_course_version_idempotent(
      target_version,
      submitted_reason,
      submitted_nonce_hash,
      idempotency
    );
  end if;
  return internal.publish_course_version_idempotent(
    target_version,
    submitted_reason,
    submitted_nonce_hash,
    idempotency
  );
end
$$;

revoke all on function internal.publish_course_version_as_platform_admin(
  uuid, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.publish_course_version_as_platform_admin(
  uuid, text, text, uuid
) to authenticated;

create or replace function internal.read_course_submission_review(
  target_version uuid
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
  if not (
    internal.has_staff_role('course_admin')
    or internal.has_staff_role('accreditation_reviewer')
  ) then
    raise exception 'COURSE_REVIEW_ROLE_REQUIRED';
  end if;

  select jsonb_build_object(
    'courseVersionId', version.id,
    'slug', course.slug,
    'title', version.title,
    'summary', version.summary,
    'description', version.description,
    'learningObjectives', version.learning_objectives,
    'deliveryType', version.delivery_type,
    'hasCover', version.has_cover,
    'version', version.version,
    'status', version.status,
    'submittedBy', submitter.display_name,
    'submittedAt', version.submitted_at,
    'submissionReason', review.reason,
    'registrationMode', version.registration_mode,
    'externalRegistrationUrl', case
      when version.registration_mode = 'google_form'
        then version.external_registration_url
      else null
    end,
    'registrationCtaLabel', version.registration_cta_label,
    'instructors', coalesce((
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
    ), '[]'::jsonb),
    'canDecide',
      version.status = 'in_review'
      and version.submitted_by is distinct from actor
      and (
        (
          version.registration_mode = 'google_form'
          and internal.has_exact_staff_role('platform_admin')
        )
        or (
          version.registration_mode = 'internal'
          and internal.has_staff_role('accreditation_reviewer')
        )
      ),
    'canPublish',
      version.status = 'in_review'
      and version.submitted_by is distinct from actor
      and internal.has_exact_staff_role('platform_admin')
  )
  into result
  from public.course_versions version
  join public.courses course
    on course.id = version.course_id
  join public.people submitter
    on submitter.id = version.submitted_by
  left join lateral (
    select publication.reason
    from public.course_publication_reviews publication
    where publication.course_version_id = version.id
      and publication.status = 'pending'
    order by publication.submitted_at desc, publication.id desc
    limit 1
  ) review on true
  where version.id = target_version
    and version.status = 'in_review';

  if result is null then
    raise exception 'COURSE_NOT_IN_REVIEW';
  end if;
  return result;
end
$$;

revoke all on function internal.read_course_submission_review(uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.read_course_submission_review(uuid)
  to authenticated;

-- Preserve every commerce/accreditation/legal gate for internal registration.
-- The external branch is catalog-only and cannot be purchased on-platform.
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
      select
        component.id as component_id,
        component.title,
        component.refund_allocation_twd as amount_twd
      from public.hybrid_components component
      where component.course_version_id = version.id
        and component.component_type = 'live'
      union all
      select
        version.id,
        version.title || '（直播）',
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
  ) as first_live_starts_at,
  category.code as category_code,
  category.title as category_title,
  version.registration_mode,
  version.external_registration_url,
  version.registration_cta_label
from public.courses course
join lateral (
  select
    candidate.id,
    candidate.title,
    candidate.summary,
    candidate.description,
    candidate.learning_objectives,
    candidate.category_code,
    candidate.delivery_type,
    candidate.price_twd,
    candidate.organization_point_price,
    candidate.recorded_refund_allocation_twd,
    candidate.live_refund_allocations,
    candidate.has_cover,
    candidate.equipment_requirements,
    candidate.legal_document_id,
    candidate.commerce_close_at,
    candidate.minimum_completion_window,
    candidate.registration_mode,
    candidate.external_registration_url,
    candidate.registration_cta_label
  from public.course_versions candidate
  where candidate.course_id = course.id
    and candidate.status = 'published'
  order by
    candidate.published_at desc nulls last,
    candidate.version desc,
    candidate.id
  limit 1
) version on true
join public.course_categories category
  on category.code = version.category_code
  and category.active
left join lateral (
  select
    decision.status,
    decision.points,
    decision.valid_from,
    decision.valid_until
  from public.course_version_accreditation link
  join public.accreditation_decision_revisions decision
    on decision.id = link.accreditation_revision_id
  where link.course_version_id = version.id
  order by decision.revision desc, decision.id
  limit 1
) accreditation on true
left join public.legal_documents legal
  on legal.id = version.legal_document_id
where course.archived_at is null
  and (
    (
      version.registration_mode = 'internal'
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
      )
    )
    or (
      version.registration_mode = 'google_form'
      and version.external_registration_url is not null
      and version.external_registration_url =
        btrim(version.external_registration_url)
      and length(version.external_registration_url) between 1 and 2048
      and (
        version.external_registration_url ~
          '^https://forms\.gle/[A-Za-z0-9_-]+$'
        or version.external_registration_url ~
          '^https://docs\.google\.com/forms/d/(?:e/)?[A-Za-z0-9_-]+/viewform$'
      )
      and length(btrim(version.registration_cta_label)) between 2 and 20
      and length(btrim(version.title)) between 2 and 200
      and length(btrim(version.summary)) between 10 and 500
      and length(btrim(version.description)) between 20 and 10000
      and version.has_cover
      and case
        when jsonb_typeof(version.learning_objectives) = 'array' then
          jsonb_array_length(version.learning_objectives) >= 1
          and not exists (
            select 1
            from jsonb_array_elements(
              version.learning_objectives
            ) objective(value)
            where jsonb_typeof(objective.value) <> 'string'
              or length(btrim(objective.value #>> '{}'))
                not between 2 and 300
          )
        else false
      end
      and exists (
        select 1
        from public.course_instructors course_instructor
        join public.instructors instructor
          on instructor.id = course_instructor.instructor_id
        where course_instructor.course_version_id = version.id
          and instructor.active
          and length(btrim(instructor.display_name)) >= 2
          and length(btrim(instructor.biography)) >= 10
          and length(btrim(instructor.credentials)) >= 5
      )
    )
  );

revoke all on public.published_course_catalog
  from public, anon, authenticated, service_role;
grant select on public.published_course_catalog
  to anon, authenticated, service_role;

-- External registration can never be converted into a platform order by
-- calling the RPC directly. Lock the authoritative version before delegating
-- to the unchanged coupon/order implementation.
create or replace function internal.create_b2c_order_guarded(
  course_version uuid,
  legal_acceptance uuid,
  live_selections jsonb,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  registration_path text;
begin
  select version.registration_mode into registration_path
  from public.course_versions version
  where version.id = course_version
  for share;
  if not found or registration_path <> 'internal' then
    raise exception 'EXTERNAL_REGISTRATION_REQUIRED';
  end if;
  return internal.create_b2c_order(
    course_version,
    legal_acceptance,
    live_selections,
    idempotency
  );
end
$$;

revoke all on function internal.create_b2c_order(
  uuid, uuid, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function internal.create_b2c_order_guarded(
  uuid, uuid, jsonb, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.create_b2c_order_guarded(
  uuid, uuid, jsonb, uuid
) to authenticated;

create or replace function public.create_b2c_order(
  p_course_version_id uuid,
  p_legal_acceptance_id uuid,
  p_live_selections jsonb,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.create_b2c_order_guarded(
    p_course_version_id,
    p_legal_acceptance_id,
    p_live_selections,
    p_idempotency_key
  )
$$;

revoke all on function public.create_b2c_order(
  uuid, uuid, jsonb, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_b2c_order(
  uuid, uuid, jsonb, uuid
) to authenticated;

create or replace function internal.create_b2c_order_with_coupon_guarded(
  course_version uuid,
  legal_acceptance uuid,
  live_selections jsonb,
  coupon_claim uuid,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  registration_path text;
begin
  select version.registration_mode into registration_path
  from public.course_versions version
  where version.id = course_version
  for share;
  if not found or registration_path <> 'internal' then
    raise exception 'EXTERNAL_REGISTRATION_REQUIRED';
  end if;
  return internal.create_b2c_order_with_coupon(
    course_version,
    legal_acceptance,
    live_selections,
    coupon_claim,
    idempotency
  );
end
$$;

revoke all on function internal.create_b2c_order_with_coupon(
  uuid, uuid, jsonb, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function internal.create_b2c_order_with_coupon_guarded(
  uuid, uuid, jsonb, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.create_b2c_order_with_coupon_guarded(
  uuid, uuid, jsonb, uuid, uuid
) to authenticated;

create or replace function public.create_b2c_order_with_coupon(
  p_course_version_id uuid,
  p_legal_acceptance_id uuid,
  p_live_selections jsonb,
  p_coupon_claim_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.create_b2c_order_with_coupon_guarded(
    p_course_version_id,
    p_legal_acceptance_id,
    p_live_selections,
    p_coupon_claim_id,
    p_idempotency_key
  )
$$;

revoke all on function public.create_b2c_order_with_coupon(
  uuid, uuid, jsonb, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_b2c_order_with_coupon(
  uuid, uuid, jsonb, uuid, uuid
) to authenticated;

create or replace function internal.sync_own_learner_cart_guarded(
  submitted_operation text,
  submitted_course_version_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if submitted_operation is null
     or submitted_operation not in ('merge', 'add', 'remove')
     or cardinality(coalesce(
       submitted_course_version_ids,
       '{}'::uuid[]
     )) > 100
     or array_position(coalesce(
       submitted_course_version_ids,
       '{}'::uuid[]
     ), null) is not null
     or (
       submitted_operation in ('add', 'remove')
       and cardinality(coalesce(
         submitted_course_version_ids,
         '{}'::uuid[]
       )) <> 1
     )
  then
    raise exception 'LEARNER_CART_INVALID';
  end if;
  if submitted_operation in ('add', 'merge') and exists (
    select 1
    from public.course_versions version
    where version.id = any(coalesce(
      submitted_course_version_ids,
      '{}'::uuid[]
    ))
      and version.registration_mode <> 'internal'
  ) then
    raise exception 'EXTERNAL_REGISTRATION_REQUIRED';
  end if;
  return internal.sync_own_learner_cart(
    submitted_operation,
    submitted_course_version_ids
  );
end
$$;

revoke all on function internal.sync_own_learner_cart(text, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function internal.sync_own_learner_cart_guarded(text, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function internal.sync_own_learner_cart_guarded(text, uuid[])
  to authenticated;

create or replace function public.sync_own_learner_cart(
  p_operation text,
  p_course_version_ids uuid[]
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.sync_own_learner_cart_guarded(
    p_operation,
    p_course_version_ids
  )
$$;

revoke all on function public.sync_own_learner_cart(text, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.sync_own_learner_cart(text, uuid[])
  to authenticated;

create or replace function internal.present_legal_contract_guarded(
  target_course_version uuid,
  device_hash text,
  request_ip inet
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  registration_path text;
begin
  select version.registration_mode into registration_path
  from public.course_versions version
  where version.id = target_course_version
  for share;
  if not found or registration_path <> 'internal' then
    raise exception 'COURSE_CONTRACT_UNAVAILABLE';
  end if;
  return internal.present_legal_contract(
    target_course_version,
    device_hash,
    request_ip
  );
end
$$;

revoke all on function internal.present_legal_contract(uuid, text, inet)
  from public, anon, authenticated, service_role;
revoke all on function internal.present_legal_contract_guarded(
  uuid, text, inet
) from public, anon, authenticated, service_role;
grant execute on function internal.present_legal_contract_guarded(
  uuid, text, inet
) to authenticated;

create or replace function public.present_legal_contract(
  p_course_version_id uuid,
  p_device_hash text,
  p_request_ip inet
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.present_legal_contract_guarded(
    p_course_version_id,
    p_device_hash,
    p_request_ip
  )
$$;

revoke all on function public.present_legal_contract(uuid, text, inet)
  from public, anon, authenticated, service_role;
grant execute on function public.present_legal_contract(uuid, text, inet)
  to authenticated;

-- Organization point assignment is also a commerce path. Keep both the
-- single-member compatibility RPC and the batch RPC for internal courses,
-- but never let a Google-Form catalog entry reserve points or create an
-- entitlement/enrollment.
create or replace function internal.assign_organization_course_guarded(
  target_organization uuid,
  target_member uuid,
  target_course_version uuid,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  registration_path text;
begin
  select version.registration_mode into registration_path
  from public.course_versions version
  where version.id = target_course_version
  for share;
  if not found or registration_path <> 'internal' then
    raise exception 'EXTERNAL_REGISTRATION_REQUIRED';
  end if;
  return internal.assign_organization_course(
    target_organization,
    target_member,
    target_course_version,
    idempotency
  );
end
$$;

revoke all on function internal.assign_organization_course(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function internal.assign_organization_course_guarded(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.assign_organization_course_guarded(
  uuid, uuid, uuid, uuid
) to authenticated;

create or replace function public.assign_organization_course(
  p_organization_id uuid,
  p_member_person_id uuid,
  p_course_version_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.assign_organization_course_guarded(
    p_organization_id,
    p_member_person_id,
    p_course_version_id,
    p_idempotency_key
  )
$$;

revoke all on function public.assign_organization_course(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.assign_organization_course(
  uuid, uuid, uuid, uuid
) to authenticated;

create or replace function internal.batch_assign_organization_course_guarded(
  target_organization uuid,
  target_members uuid[],
  target_course_version uuid,
  target_live_session uuid,
  target_completion_due_at timestamptz,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  registration_path text;
begin
  select version.registration_mode into registration_path
  from public.course_versions version
  where version.id = target_course_version
  for share;
  if not found or registration_path <> 'internal' then
    raise exception 'EXTERNAL_REGISTRATION_REQUIRED';
  end if;
  return internal.batch_assign_organization_course(
    target_organization,
    target_members,
    target_course_version,
    target_live_session,
    target_completion_due_at,
    idempotency
  );
end
$$;

revoke all on function internal.batch_assign_organization_course(
  uuid, uuid[], uuid, uuid, timestamptz, uuid
) from public, anon, authenticated, service_role;
revoke all on function internal.batch_assign_organization_course_guarded(
  uuid, uuid[], uuid, uuid, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.batch_assign_organization_course_guarded(
  uuid, uuid[], uuid, uuid, timestamptz, uuid
) to authenticated;

create or replace function public.batch_assign_organization_course(
  p_organization_id uuid,
  p_member_person_ids uuid[],
  p_course_version_id uuid,
  p_live_session_id uuid,
  p_completion_due_at timestamptz,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.batch_assign_organization_course_guarded(
    p_organization_id,
    p_member_person_ids,
    p_course_version_id,
    p_live_session_id,
    p_completion_due_at,
    p_idempotency_key
  )
$$;

revoke all on function public.batch_assign_organization_course(
  uuid, uuid[], uuid, uuid, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.batch_assign_organization_course(
  uuid, uuid[], uuid, uuid, timestamptz, uuid
) to authenticated;
