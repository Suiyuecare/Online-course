-- Complete the non-provider staff review paths.
-- Ordered after the complete pre-launch schema chain.
--
-- This migration deliberately keeps submitted course content in place when a
-- reviewer returns or rejects a submission. It also moves request
-- idempotency into the transaction boundary instead of merely requiring a
-- header at the HTTP edge.

alter table public.organizations
  add column tax_id_last_four text,
  add constraint organization_tax_id_last_four_format
    check (
      tax_id_last_four is null
      or tax_id_last_four ~ '^[0-9]{4}$'
    );

create or replace function internal.apply_for_organization_v2(
  submitted_legal_name text,
  submitted_tax_index text,
  submitted_tax_last_four text,
  submitted_invoice_email text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  applicant public.people%rowtype;
  prior public.idempotency_records%rowtype;
  request_hash text;
  result jsonb;
  organization_id uuid;
begin
  if length(trim(coalesce(submitted_legal_name, ''))) < 2
     or length(trim(submitted_legal_name)) > 200
     or submitted_tax_index !~ '^[a-f0-9]{64}$'
     or submitted_tax_last_four !~ '^[0-9]{4}$'
     or length(trim(coalesce(submitted_invoice_email, ''))) > 320
     or submitted_invoice_email
       !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  then
    raise exception 'ORGANIZATION_APPLICATION_INVALID';
  end if;

  select person.* into applicant
  from public.people person
  where person.id = actor
    and person.email_verified_at is not null
    and lower(person.verified_email) =
      lower(trim(submitted_invoice_email))
  for share;
  if not found then
    raise exception 'VERIFIED_ORGANIZATION_EMAIL_REQUIRED';
  end if;

  request_hash := internal.canonical_request_hash(jsonb_build_object(
    'legalName', trim(submitted_legal_name),
    'taxIdBlindIndex', submitted_tax_index,
    'taxIdLastFour', submitted_tax_last_four,
    'invoiceEmail', lower(trim(submitted_invoice_email))
  ));
  select record.* into prior
  from public.idempotency_records record
  where record.actor_id = actor
    and record.operation = 'organization_application_v2'
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
    actor, 'organization_application_v2', idempotency, request_hash,
    clock_timestamp() + interval '1 minute'
  )
  on conflict (actor_id, operation, idempotency_key) do nothing;
  if not found then
    select record.* into prior
    from public.idempotency_records record
    where record.actor_id = actor
      and record.operation = 'organization_application_v2'
      and record.idempotency_key = idempotency
    for update;
    if not found
       or prior.request_hash <> request_hash
       or prior.completed_at is null
       or prior.response_body is null
    then
      raise exception 'IDEMPOTENCY_REQUEST_CONFLICT';
    end if;
    return prior.response_body;
  end if;

  if exists (
    select 1
    from public.organizations organization
    where organization.tax_id_blind_index = submitted_tax_index
  ) then
    raise exception 'ORGANIZATION_ALREADY_EXISTS_CONTACT_SUPPORT';
  end if;

  insert into public.organizations (
    legal_name,
    tax_id_blind_index,
    tax_id_last_four,
    contact_person_id,
    contact_name,
    contact_email,
    invoice_email,
    application_idempotency_key
  ) values (
    trim(submitted_legal_name),
    submitted_tax_index,
    submitted_tax_last_four,
    actor,
    coalesce(
      nullif(trim(applicant.display_name), ''),
      '機構申請人'
    ),
    lower(trim(submitted_invoice_email)),
    lower(trim(submitted_invoice_email)),
    idempotency
  )
  returning id into organization_id;

  insert into public.organization_memberships (
    organization_id, person_id, role
  ) values (
    organization_id, actor, 'owner'
  );

  result := jsonb_build_object(
    'organizationId', organization_id,
    'status', 'submitted'
  );
  update public.idempotency_records
  set response_status = 200,
      response_body = result,
      completed_at = clock_timestamp(),
      locked_until = null
  where actor_id = actor
    and operation = 'organization_application_v2'
    and idempotency_key = idempotency;

  perform internal.append_audit_event(
    actor,
    'organization.applied',
    'organization',
    organization_id::text,
    'organization application submitted',
    organization_id,
    jsonb_build_object(
      'taxIdMasked', '****' || submitted_tax_last_four,
      'contactEmailVerified', true
    )
  );
  return result;
end
$$;

revoke all on function internal.apply_for_organization_v2(
  text, text, text, text, uuid
) from public, anon, authenticated, service_role;

create or replace function public.apply_for_organization_v2(
  p_legal_name text,
  p_tax_id_blind_index text,
  p_tax_id_last_four text,
  p_invoice_email text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.apply_for_organization_v2(
    p_legal_name,
    p_tax_id_blind_index,
    p_tax_id_last_four,
    p_invoice_email,
    p_idempotency_key
  )
$$;

revoke all on function public.apply_for_organization_v2(
  text, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.apply_for_organization_v2(
  text, text, text, text, uuid
) to authenticated;
grant execute on function public.apply_for_organization_v2(
  text, text, text, text, uuid
) to authenticated;

-- Prevent a browser client from bypassing the v2 application request binding.
revoke all on function public.apply_for_organization(
  text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function internal.apply_for_organization(
  text, text, text, uuid
) from public, anon, authenticated, service_role;

create or replace function internal.read_organization_application_review(
  target_organization uuid
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
  if not internal.has_staff_role('platform_admin') then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;

  select jsonb_build_object(
    'organizationId', organization.id,
    'legalName', organization.legal_name,
    'taxIdMasked', case
      when organization.tax_id_last_four is null
        then '已驗證（歷史申請未保存尾碼）'
      else '****' || organization.tax_id_last_four
    end,
    'contactName', coalesce(
      nullif(trim(organization.contact_name), ''),
      contact.display_name,
      '未提供'
    ),
    'contactEmailMasked', case
      when coalesce(
        nullif(trim(organization.contact_email), ''),
        contact.verified_email
      ) is null then '未提供'
      else
        left(split_part(coalesce(
          nullif(trim(organization.contact_email), ''),
          contact.verified_email
        ), '@', 1), 1)
        || '•••@'
        || split_part(coalesce(
          nullif(trim(organization.contact_email), ''),
          contact.verified_email
        ), '@', 2)
    end,
    'invoiceEmailMasked',
      left(split_part(organization.invoice_email, '@', 1), 1)
      || '•••@'
      || split_part(organization.invoice_email, '@', 2),
    'status', organization.status,
    'submittedAt', organization.created_at,
    'canReview',
      organization.status = 'submitted'
      and organization.contact_person_id is distinct from actor
  )
  into result
  from public.organizations organization
  left join public.people contact
    on contact.id = organization.contact_person_id
  where organization.id = target_organization;

  if result is null then
    raise exception 'ORGANIZATION_APPLICATION_NOT_FOUND';
  end if;
  return result;
end
$$;

revoke all on function internal.read_organization_application_review(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.read_organization_application_review(
  p_organization_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_organization_application_review(p_organization_id)
$$;

revoke all on function public.read_organization_application_review(uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.read_organization_application_review(uuid)
  to authenticated;
grant execute on function public.read_organization_application_review(uuid)
  to authenticated;

create or replace function
internal.review_organization_application_idempotent(
  target_organization uuid,
  submitted_decision text,
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
  prior public.idempotency_records%rowtype;
  request_hash text;
  result jsonb;
begin
  if not internal.has_staff_role('platform_admin') then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;
  if submitted_decision not in ('approve', 'reject')
     or length(trim(coalesce(submitted_reason, ''))) < 10
     or length(trim(submitted_reason)) > 1000
  then
    raise exception 'ORGANIZATION_REVIEW_INVALID';
  end if;
  if exists (
    select 1
    from public.organizations organization
    where organization.id = target_organization
      and organization.contact_person_id = actor
  ) then
    raise exception 'SEPARATE_REVIEWER_REQUIRED';
  end if;

  request_hash := internal.canonical_request_hash(jsonb_build_object(
    'organizationId', target_organization,
    'decision', submitted_decision,
    'reason', trim(submitted_reason)
  ));
  select record.* into prior
  from public.idempotency_records record
  where record.actor_id = actor
    and record.operation = 'organization_application_review'
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
    'organization_application_review',
    idempotency,
    request_hash,
    clock_timestamp() + interval '1 minute'
  )
  on conflict (actor_id, operation, idempotency_key) do nothing;
  if not found then
    raise exception 'IDEMPOTENCY_REQUEST_CONFLICT';
  end if;

  result := internal.review_organization_application(
    target_organization,
    submitted_decision,
    trim(submitted_reason)
  );
  update public.idempotency_records
  set response_status = 200,
      response_body = result,
      completed_at = clock_timestamp(),
      locked_until = null
  where actor_id = actor
    and operation = 'organization_application_review'
    and idempotency_key = idempotency;
  return result;
end
$$;

revoke all on function
internal.review_organization_application_idempotent(
  uuid, text, text, uuid
) from public, anon, authenticated, service_role;

create or replace function public.review_organization_application(
  p_organization_id uuid,
  p_decision text,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.review_organization_application_idempotent(
    p_organization_id,
    p_decision,
    p_reason,
    p_idempotency_key
  )
$$;

revoke all on function public.review_organization_application(
  uuid, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.review_organization_application(
  uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function internal.review_organization_application(
  uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function
internal.review_organization_application_idempotent(
  uuid, text, text, uuid
) to authenticated;
grant execute on function public.review_organization_application(
  uuid, text, text, uuid
) to authenticated;

create or replace function
internal.submit_course_version_for_review_idempotent(
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
  prior public.idempotency_records%rowtype;
  request_hash text;
  result jsonb;
begin
  if not internal.has_staff_role('course_admin')
     or length(trim(coalesce(submitted_reason, ''))) < 10
     or length(trim(submitted_reason)) > 1000
  then
    raise exception 'COURSE_SUBMISSION_REJECTED';
  end if;

  request_hash := internal.canonical_request_hash(jsonb_build_object(
    'courseVersionId', target_version,
    'reason', trim(submitted_reason)
  ));
  select record.* into prior
  from public.idempotency_records record
  where record.actor_id = actor
    and record.operation = 'course_submit_review'
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
    'course_submit_review',
    idempotency,
    request_hash,
    clock_timestamp() + interval '1 minute'
  )
  on conflict (actor_id, operation, idempotency_key) do nothing;
  if not found then
    raise exception 'IDEMPOTENCY_REQUEST_CONFLICT';
  end if;

  perform internal.submit_course_version_for_review(
    target_version,
    trim(submitted_reason)
  );
  result := jsonb_build_object(
    'courseVersionId', target_version,
    'submitted', true,
    'status', 'in_review'
  );
  update public.idempotency_records
  set response_status = 200,
      response_body = result,
      completed_at = clock_timestamp(),
      locked_until = null
  where actor_id = actor
    and operation = 'course_submit_review'
    and idempotency_key = idempotency;
  return result;
end
$$;

revoke all on function
internal.submit_course_version_for_review_idempotent(
  uuid, text, uuid
) from public, anon, authenticated, service_role;

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
  select internal.submit_course_version_for_review_idempotent(
    p_course_version_id,
    p_reason,
    p_idempotency_key
  )
$$;

revoke all on function public.submit_course_version_for_review(
  uuid, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.submit_course_version_for_review(
  uuid, text
) from public, anon, authenticated, service_role;
revoke all on function internal.submit_course_version_for_review(
  uuid, text
) from public, anon, authenticated, service_role;
grant execute on function
internal.submit_course_version_for_review_idempotent(
  uuid, text, uuid
) to authenticated;
grant execute on function public.submit_course_version_for_review(
  uuid, text, uuid
) to authenticated;

create or replace function internal.publish_course_version_idempotent(
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
  prior public.idempotency_records%rowtype;
  request_hash text;
  result jsonb;
begin
  if not internal.has_staff_role('accreditation_reviewer')
     or length(trim(coalesce(submitted_reason, ''))) < 10
     or length(trim(submitted_reason)) > 1000
     or submitted_nonce_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'ACCREDITATION_REVIEWER_REQUIRED';
  end if;

  request_hash := internal.canonical_request_hash(jsonb_build_object(
    'courseVersionId', target_version,
    'reason', trim(submitted_reason),
    'stepUpNonceHash', submitted_nonce_hash
  ));
  select record.* into prior
  from public.idempotency_records record
  where record.actor_id = actor
    and record.operation = 'course_publish'
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
    'course_publish',
    idempotency,
    request_hash,
    clock_timestamp() + interval '1 minute'
  )
  on conflict (actor_id, operation, idempotency_key) do nothing;
  if not found then
    raise exception 'IDEMPOTENCY_REQUEST_CONFLICT';
  end if;

  perform internal.publish_course_version(
    target_version,
    trim(submitted_reason),
    submitted_nonce_hash
  );
  result := jsonb_build_object(
    'courseVersionId', target_version,
    'published', true,
    'status', 'published'
  );
  update public.idempotency_records
  set response_status = 200,
      response_body = result,
      completed_at = clock_timestamp(),
      locked_until = null
  where actor_id = actor
    and operation = 'course_publish'
    and idempotency_key = idempotency;
  return result;
end
$$;

revoke all on function internal.publish_course_version_idempotent(
  uuid, text, text, uuid
) from public, anon, authenticated, service_role;

create or replace function public.publish_course_version(
  p_course_version_id uuid,
  p_reason text,
  p_nonce_hash text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.publish_course_version_idempotent(
    p_course_version_id,
    p_reason,
    p_nonce_hash,
    p_idempotency_key
  )
$$;

revoke all on function public.publish_course_version(
  uuid, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.publish_course_version(
  uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function internal.publish_course_version(
  uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function internal.publish_course_version_idempotent(
  uuid, text, text, uuid
) to authenticated;
grant execute on function public.publish_course_version(
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
    'title', version.title,
    'version', version.version,
    'status', version.status,
    'submittedBy', submitter.display_name,
    'submittedAt', version.submitted_at,
    'submissionReason', review.reason,
    'canDecide',
      version.status = 'in_review'
      and version.submitted_by is distinct from actor
      and internal.has_staff_role('accreditation_reviewer')
  )
  into result
  from public.course_versions version
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

create or replace function public.read_course_submission_review(
  p_course_version_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_course_submission_review(p_course_version_id)
$$;

revoke all on function public.read_course_submission_review(uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.read_course_submission_review(uuid)
  to authenticated;
grant execute on function public.read_course_submission_review(uuid)
  to authenticated;

create or replace function internal.review_course_version_submission(
  target_version uuid,
  submitted_decision text,
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
  review_row public.course_publication_reviews%rowtype;
  prior public.idempotency_records%rowtype;
  request_hash text;
  audit_action text;
  result jsonb;
begin
  if not internal.has_staff_role('accreditation_reviewer')
     or submitted_decision not in (
       'return_for_correction', 'reject'
     )
     or length(trim(coalesce(submitted_reason, ''))) < 10
     or length(trim(submitted_reason)) > 1000
  then
    raise exception 'COURSE_REVIEW_DECISION_INVALID';
  end if;

  request_hash := internal.canonical_request_hash(jsonb_build_object(
    'courseVersionId', target_version,
    'decision', submitted_decision,
    'reason', trim(submitted_reason)
  ));
  select record.* into prior
  from public.idempotency_records record
  where record.actor_id = actor
    and record.operation = 'course_review_decision'
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
    'course_review_decision',
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
     or version_row.submitted_by is null
     or version_row.submitted_by = actor
  then
    raise exception 'COURSE_REVIEW_DECISION_REJECTED';
  end if;

  select publication.* into review_row
  from public.course_publication_reviews publication
  where publication.course_version_id = target_version
    and publication.status = 'pending'
  order by publication.submitted_at desc, publication.id desc
  limit 1
  for update;
  if not found then
    raise exception 'COURSE_PENDING_REVIEW_REQUIRED';
  end if;

  update public.course_publication_reviews
  set reviewed_by = actor,
      status = 'rejected',
      checklist = checklist || jsonb_build_object(
        'decision', submitted_decision,
        'contentPreserved', true,
        'decidedAt', clock_timestamp()
      ),
      reason = trim(submitted_reason),
      reviewed_at = clock_timestamp()
  where id = review_row.id;

  -- Returning to draft makes every authored row editable again. No module,
  -- lesson, material, question, instructor, or accreditation link is removed.
  update public.course_versions
  set status = 'draft',
      submitted_by = null,
      submitted_at = null
  where id = target_version;

  audit_action := case submitted_decision
    when 'return_for_correction'
      then 'course.returned_for_correction'
    else 'course.review_rejected'
  end;
  perform internal.append_audit_event(
    actor,
    audit_action,
    'course_version',
    target_version::text,
    trim(submitted_reason),
    null,
    jsonb_build_object(
      'publicationReviewId', review_row.id,
      'decision', submitted_decision,
      'contentPreserved', true
    )
  );

  result := jsonb_build_object(
    'courseVersionId', target_version,
    'decision', submitted_decision,
    'status', 'draft',
    'contentPreserved', true
  );
  update public.idempotency_records
  set response_status = 200,
      response_body = result,
      completed_at = clock_timestamp(),
      locked_until = null
  where actor_id = actor
    and operation = 'course_review_decision'
    and idempotency_key = idempotency;
  return result;
end
$$;

revoke all on function internal.review_course_version_submission(
  uuid, text, text, uuid
) from public, anon, authenticated, service_role;

create or replace function public.review_course_version_submission(
  p_course_version_id uuid,
  p_decision text,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.review_course_version_submission(
    p_course_version_id,
    p_decision,
    p_reason,
    p_idempotency_key
  )
$$;

revoke all on function public.review_course_version_submission(
  uuid, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.review_course_version_submission(
  uuid, text, text, uuid
) to authenticated;
grant execute on function public.review_course_version_submission(
  uuid, text, text, uuid
) to authenticated;
