-- Clean-database launch blockers are closed in this forward migration.
-- All newly introduced control-plane tables are server-only. Browser clients
-- receive only the explicitly shaped projections below.

create table public.accreditation_transition_requests (
  id uuid primary key default gen_random_uuid(),
  source_revision_id uuid not null
    references public.accreditation_decision_revisions(id),
  requested_status text not null
    check (requested_status in ('approved', 'rejected', 'expired', 'revoked')),
  approval_reference text,
  points numeric(6,2) check (points is null or points > 0),
  valid_from timestamptz,
  valid_until timestamptz,
  effective_at timestamptz not null,
  retroactive boolean not null default false,
  retroactive_basis text,
  source_document_path text not null,
  source_document_sha256 text not null
    check (source_document_sha256 ~ '^[a-f0-9]{64}$'),
  request_reason text not null,
  requested_by uuid not null references public.people(id),
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected')),
  reviewed_by uuid references public.people(id),
  review_reason text,
  reviewed_at timestamptz,
  materialized_revision_id uuid
    references public.accreditation_decision_revisions(id),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  check (reviewed_by is null or reviewed_by <> requested_by),
  check (valid_until is null or valid_from is null or valid_until > valid_from),
  check (not retroactive or length(trim(coalesce(retroactive_basis, ''))) >= 10),
  check (
    (
      requested_status = 'approved'
      and length(trim(coalesce(approval_reference, ''))) >= 2
      and points is not null
      and valid_from is not null
      and valid_until is not null
    )
    or (
      requested_status <> 'approved'
      and approval_reference is null
      and points is null
      and not retroactive
    )
  ),
  check (
    (
      status = 'pending_review'
      and reviewed_by is null
      and review_reason is null
      and reviewed_at is null
      and materialized_revision_id is null
    )
    or (
      status = 'approved'
      and reviewed_by is not null
      and review_reason is not null
      and reviewed_at is not null
      and materialized_revision_id is not null
    )
    or (
      status = 'rejected'
      and reviewed_by is not null
      and review_reason is not null
      and reviewed_at is not null
      and materialized_revision_id is null
    )
  ),
  unique (requested_by, idempotency_key)
);

create unique index one_pending_accreditation_transition
  on public.accreditation_transition_requests(source_revision_id)
  where status = 'pending_review';

create table public.accreditation_transition_effects (
  id uuid primary key default gen_random_uuid(),
  accreditation_revision_id uuid not null
    references public.accreditation_decision_revisions(id),
  effect_kind text not null check (effect_kind in (
    'approval_fulfillment', 'negative_refund_and_revocation'
  )),
  subject_id uuid not null,
  effect_snapshot jsonb not null,
  applied_at timestamptz not null default now(),
  unique (accreditation_revision_id, effect_kind, subject_id)
);

create table public.operating_setting_change_requests (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null check (setting_key in (
    'legal_approved', 'finance_configured',
    'incident_owner_configured', 'bank_account',
    'finance_high_value_threshold'
  )),
  proposed_value jsonb not null,
  effective_at timestamptz not null,
  requested_by uuid not null references public.people(id),
  request_reason text not null,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected')),
  reviewed_by uuid references public.people(id),
  review_reason text,
  reviewed_at timestamptz,
  materialized_revision_id uuid
    references public.operating_setting_revisions(id),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  check (reviewed_by is null or reviewed_by <> requested_by),
  check (
    (
      status = 'pending_review'
      and reviewed_by is null
      and review_reason is null
      and reviewed_at is null
      and materialized_revision_id is null
    )
    or (
      status = 'approved'
      and reviewed_by is not null
      and review_reason is not null
      and reviewed_at is not null
      and materialized_revision_id is not null
    )
    or (
      status = 'rejected'
      and reviewed_by is not null
      and review_reason is not null
      and reviewed_at is not null
      and materialized_revision_id is null
    )
  ),
  unique (requested_by, idempotency_key)
);

create unique index one_pending_operating_setting_change
  on public.operating_setting_change_requests(setting_key)
  where status = 'pending_review';

create table public.provider_validation_requests (
  id uuid primary key default gen_random_uuid(),
  provider text not null references public.provider_health(provider),
  evidence_reference text not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  test_environment text not null check (test_environment = 'production'),
  tested_at timestamptz not null,
  requested_by uuid not null references public.people(id),
  request_reason text not null,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected')),
  reviewed_by uuid references public.people(id),
  review_reason text,
  reviewed_at timestamptz,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  check (reviewed_by is null or reviewed_by <> requested_by),
  check (
    (
      status = 'pending_review'
      and reviewed_by is null
      and review_reason is null
      and reviewed_at is null
    )
    or (
      status in ('approved', 'rejected')
      and reviewed_by is not null
      and review_reason is not null
      and reviewed_at is not null
    )
  ),
  unique (requested_by, idempotency_key)
);

create unique index one_pending_provider_validation
  on public.provider_validation_requests(provider)
  where status = 'pending_review';

alter table public.accreditation_transition_requests
  enable row level security;
alter table public.accreditation_transition_requests
  force row level security;
alter table public.accreditation_transition_effects
  enable row level security;
alter table public.accreditation_transition_effects
  force row level security;
alter table public.operating_setting_change_requests
  enable row level security;
alter table public.operating_setting_change_requests
  force row level security;
alter table public.provider_validation_requests
  enable row level security;
alter table public.provider_validation_requests
  force row level security;

revoke all on public.accreditation_transition_requests
  from public, anon, authenticated, service_role;
revoke all on public.accreditation_transition_effects
  from public, anon, authenticated, service_role;
revoke all on public.operating_setting_change_requests
  from public, anon, authenticated, service_role;
revoke all on public.provider_validation_requests
  from public, anon, authenticated, service_role;

create or replace function internal.reject_accreditation_revision_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'ACCREDITATION_REVISION_APPEND_ONLY';
end
$$;
revoke all on function internal.reject_accreditation_revision_mutation()
  from public;

create trigger accreditation_revision_append_only
before update or delete on public.accreditation_decision_revisions
for each row execute function internal.reject_accreditation_revision_mutation();

create or replace function internal.create_course_draft(
  submitted_spec jsonb,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  target_course uuid;
  version_id uuid;
  next_version integer;
  delivery text := submitted_spec ->> 'deliveryType';
  module_spec jsonb;
  lesson_spec jsonb;
  component_spec jsonb;
  dependency text;
  module_id uuid;
  component_id uuid;
  component_ids jsonb := '{}'::jsonb;
  live_refund_allocation integer :=
    coalesce((submitted_spec ->> 'liveRefundAllocationTwd')::integer, 0);
  hybrid_live_allocation integer;
  hybrid_recorded_allocation integer;
  accreditation_revision uuid :=
    nullif(submitted_spec ->> 'accreditationRevisionId', '')::uuid;
  accreditation_disclosure text :=
    trim(coalesce(submitted_spec ->> 'accreditationDisclosure', ''));
begin
  if not internal.has_staff_role('course_admin')
     or delivery not in ('recorded', 'live', 'hybrid')
     or coalesce(submitted_spec ->> 'title', '') = ''
     or coalesce(submitted_spec ->> 'summary', '') = ''
     or coalesce(submitted_spec ->> 'description', '') = ''
     or jsonb_typeof(submitted_spec -> 'learningObjectives') <> 'array'
     or jsonb_array_length(submitted_spec -> 'learningObjectives') = 0
     or jsonb_typeof(submitted_spec -> 'modules') <> 'array'
     or (submitted_spec ->> 'priceTwd')::integer < 0
     or (submitted_spec ->> 'recordedRefundAllocationTwd')::integer < 0
     or live_refund_allocation < 0
     or (submitted_spec ->> 'organizationPointPrice')::integer <= 0
     or (submitted_spec ->> 'minimumCompletionDays')::integer <= 0
     or (
       (accreditation_revision is null and accreditation_disclosure <> '')
       or (
         accreditation_revision is not null
         and length(accreditation_disclosure) < 10
       )
     )
     or (
       delivery = 'recorded'
       and (
         live_refund_allocation <> 0
         or (submitted_spec ->> 'recordedRefundAllocationTwd')::integer
           <> (submitted_spec ->> 'priceTwd')::integer
       )
     )
     or (
       delivery = 'live'
       and (
         (submitted_spec ->> 'recordedRefundAllocationTwd')::integer <> 0
         or live_refund_allocation
           <> (submitted_spec ->> 'priceTwd')::integer
       )
     )
     or (delivery = 'hybrid' and live_refund_allocation <> 0)
  then
    raise exception 'COURSE_DRAFT_SPEC_INVALID';
  end if;
  if submitted_spec ->> 'courseId' is null then
    if coalesce(submitted_spec ->> 'slug', '')
       !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    then
      raise exception 'COURSE_SLUG_INVALID';
    end if;
    insert into public.courses (
      slug, internal_title, created_by
    ) values (
      submitted_spec ->> 'slug',
      submitted_spec ->> 'internalTitle',
      actor
    ) returning id into target_course;
    next_version := 1;
  else
    target_course := (submitted_spec ->> 'courseId')::uuid;
    if not exists (
      select 1 from public.courses course
      where course.id = target_course and course.archived_at is null
    ) then raise exception 'COURSE_NOT_FOUND'; end if;
    select coalesce(max(version), 0) + 1 into next_version
    from public.course_versions where course_id = target_course;
  end if;
  if accreditation_revision is not null
     and not exists (
       select 1
       from public.accreditation_decision_revisions revision
       where revision.id = accreditation_revision
         and revision.course_id = target_course
         and revision.status in ('applying', 'approved')
     )
  then
    raise exception 'ACCREDITATION_REVISION_COURSE_MISMATCH';
  end if;
  insert into public.course_versions (
    course_id, version, title, summary, description,
    learning_objectives, delivery_type, price_twd,
    organization_point_price, recorded_refund_allocation_twd,
    live_refund_allocations, equipment_requirements,
    legal_document_id, retention_policy_revision_id,
    minimum_completion_window, commerce_close_at,
    content_available_at, created_by, authoring_idempotency_key
  ) values (
    target_course, next_version, submitted_spec ->> 'title',
    submitted_spec ->> 'summary', submitted_spec ->> 'description',
    submitted_spec -> 'learningObjectives', delivery,
    (submitted_spec ->> 'priceTwd')::integer,
    (submitted_spec ->> 'organizationPointPrice')::integer,
    (submitted_spec ->> 'recordedRefundAllocationTwd')::integer,
    '{}'::jsonb,
    coalesce(submitted_spec ->> 'equipmentRequirements', ''),
    (submitted_spec ->> 'legalDocumentId')::uuid,
    (submitted_spec ->> 'retentionPolicyRevisionId')::uuid,
    ((submitted_spec ->> 'minimumCompletionDays') || ' days')::interval,
    (submitted_spec ->> 'commerceCloseAt')::timestamptz,
    (submitted_spec ->> 'contentAvailableAt')::timestamptz,
    actor, idempotency
  ) returning id into version_id;
  if delivery = 'live' then
    update public.course_versions
    set live_refund_allocations = jsonb_build_object(
      version_id::text, live_refund_allocation
    )
    where id = version_id;
  end if;
  insert into public.course_requirements (
    course_version_id, required_watch_seconds,
    live_presence_percent, live_camera_percent
  ) values (
    version_id,
    (submitted_spec ->> 'requiredWatchSeconds')::integer,
    case when delivery in ('live', 'hybrid')
      then (submitted_spec ->> 'livePresencePercent')::numeric else null end,
    case when delivery in ('live', 'hybrid')
      then (submitted_spec ->> 'liveCameraPercent')::numeric else null end
  );
  insert into public.survey_forms (course_version_id) values (version_id);
  insert into public.question_banks (
    course_version_id, version, created_by
  ) values (version_id, 1, actor);
  if accreditation_revision is not null then
    insert into public.course_version_accreditation (
      course_version_id, accreditation_revision_id, disclosure_snapshot
    ) values (
      version_id, accreditation_revision, accreditation_disclosure
    );
  end if;

  for module_spec in
    select value from jsonb_array_elements(submitted_spec -> 'modules')
  loop
    insert into public.modules (
      course_version_id, title, sort_order
    ) values (
      version_id, module_spec ->> 'title',
      (module_spec ->> 'sortOrder')::integer
    ) returning id into module_id;
    for lesson_spec in
      select value from jsonb_array_elements(module_spec -> 'lessons')
    loop
      insert into public.lessons (
        module_id, title, content_type, preview, sort_order
      ) values (
        module_id, lesson_spec ->> 'title',
        lesson_spec ->> 'contentType',
        coalesce((lesson_spec ->> 'preview')::boolean, false),
        (lesson_spec ->> 'sortOrder')::integer
      );
    end loop;
  end loop;

  if delivery = 'hybrid' then
    if jsonb_array_length(
      coalesce(submitted_spec -> 'hybridComponents', '[]'::jsonb)
    ) < 2 then
      raise exception 'HYBRID_COMPONENTS_REQUIRED';
    end if;
    for component_spec in
      select value from jsonb_array_elements(
        submitted_spec -> 'hybridComponents'
      )
    loop
      insert into public.hybrid_components (
        course_version_id, component_type, title, required,
        sort_order, refund_allocation_twd
      ) values (
        version_id, component_spec ->> 'componentType',
        component_spec ->> 'title',
        coalesce((component_spec ->> 'required')::boolean, true),
        (component_spec ->> 'sortOrder')::integer,
        (component_spec ->> 'refundAllocationTwd')::integer
      ) returning id into component_id;
      component_ids := component_ids || jsonb_build_object(
        component_spec ->> 'sortOrder', component_id
      );
    end loop;
    for component_spec in
      select value from jsonb_array_elements(
        submitted_spec -> 'hybridComponents'
      )
    loop
      for dependency in
        select value #>> '{}'
        from jsonb_array_elements(
          coalesce(component_spec -> 'dependsOnSortOrders', '[]'::jsonb)
        )
      loop
        insert into public.component_prerequisites (
          course_version_id, prerequisite_component_id,
          dependent_component_id
        ) values (
          version_id,
          (component_ids ->> dependency)::uuid,
          (component_ids ->> (component_spec ->> 'sortOrder'))::uuid
        );
      end loop;
    end loop;
    update public.course_versions
    set live_refund_allocations = coalesce((
      select jsonb_object_agg(
        component.id::text, component.refund_allocation_twd
      )
      from public.hybrid_components component
      where component.course_version_id = version_id
        and component.component_type = 'live'
    ), '{}'::jsonb)
    where id = version_id;
    select coalesce(sum(component.refund_allocation_twd), 0)
      into hybrid_live_allocation
    from public.hybrid_components component
    where component.course_version_id = version_id
      and component.component_type = 'live';
    select coalesce(sum(component.refund_allocation_twd), 0)
      into hybrid_recorded_allocation
    from public.hybrid_components component
    where component.course_version_id = version_id
      and component.component_type = 'recorded';
    if (submitted_spec ->> 'recordedRefundAllocationTwd')::integer
         + hybrid_live_allocation
       <> (submitted_spec ->> 'priceTwd')::integer
       or hybrid_recorded_allocation
         <> (submitted_spec ->> 'recordedRefundAllocationTwd')::integer
    then
      raise exception 'REFUND_ALLOCATIONS_DO_NOT_EQUAL_PRICE';
    end if;
  end if;
  perform internal.append_audit_event(
    actor, 'course.draft_created', 'course_version',
    version_id::text, 'versioned draft created', null,
    jsonb_build_object(
      'courseId', target_course,
      'version', next_version,
      'accreditationLinked', accreditation_revision is not null
    )
  );
  return jsonb_build_object(
    'courseId', target_course,
    'courseVersionId', version_id,
    'version', next_version
  );
exception
  when unique_violation then
    select jsonb_build_object(
      'courseId', course_id, 'courseVersionId', id, 'version', version
    ) into submitted_spec
    from public.course_versions
    where authoring_idempotency_key = idempotency;
    if submitted_spec is not null then return submitted_spec; end if;
    raise;
end
$$;
revoke all on function internal.create_course_draft(jsonb, uuid)
  from public;

create or replace function internal.submit_course_version_for_review(
  target_version uuid,
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
  if not internal.has_staff_role('course_admin')
     or length(trim(submitted_reason)) < 10
  then raise exception 'COURSE_SUBMISSION_REJECTED'; end if;
  perform 1
  from public.course_versions version
  where version.id = target_version
    and version.status = 'draft'
    and exists (
      select 1
      from public.course_version_accreditation link
      join public.accreditation_decision_revisions revision
        on revision.id = link.accreditation_revision_id
      where link.course_version_id = version.id
        and revision.course_id = version.course_id
        and revision.status in ('applying', 'approved')
        and length(trim(link.disclosure_snapshot)) >= 10
    )
  for update;
  if not found then
    raise exception 'ACCREDITATION_LINK_REQUIRED_BEFORE_SUBMISSION';
  end if;
  update public.course_versions
  set status = 'in_review', submitted_by = actor, submitted_at = now()
  where id = target_version and status = 'draft';
  if not found then raise exception 'COURSE_DRAFT_REQUIRED'; end if;
  insert into public.course_publication_reviews (
    course_version_id, submitted_by, status, checklist, reason
  ) values (
    target_version, actor, 'pending',
    jsonb_build_object(
      'submittedAt', now(),
      'accreditationLinkVerified', true
    ),
    trim(submitted_reason)
  );
  perform internal.append_audit_event(
    actor, 'course.submitted_for_review', 'course_version',
    target_version::text, trim(submitted_reason), null,
    jsonb_build_object('accreditationLinkVerified', true)
  );
  return true;
end
$$;
revoke all on function internal.submit_course_version_for_review(
  uuid, text
) from public;

create or replace function internal.request_operating_setting_change(
  submitted_key text,
  submitted_value jsonb,
  submitted_effective_at timestamptz,
  submitted_reason text,
  idempotency uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  request_id uuid;
  existing public.operating_setting_change_requests%rowtype;
  normalized_value jsonb;
  account_number text;
  masked_account text;
begin
  if not internal.has_staff_role('platform_admin')
     or submitted_key not in (
       'legal_approved', 'finance_configured',
       'incident_owner_configured', 'bank_account',
       'finance_high_value_threshold'
     )
     or jsonb_typeof(submitted_value) <> 'object'
     or submitted_effective_at is null
     or length(trim(submitted_reason)) < 10
  then
    raise exception 'OPERATING_SETTING_REQUEST_REJECTED';
  end if;

  case submitted_key
    when 'legal_approved' then
      if jsonb_typeof(submitted_value -> 'enabled') <> 'boolean'
         or submitted_value - 'enabled' <> '{}'::jsonb
      then raise exception 'BOOLEAN_SETTING_SPEC_INVALID'; end if;
      normalized_value := jsonb_build_object(
        'enabled', (submitted_value ->> 'enabled')::boolean
      );
    when 'finance_configured' then
      if jsonb_typeof(submitted_value -> 'enabled') <> 'boolean'
         or submitted_value - 'enabled' <> '{}'::jsonb
      then raise exception 'BOOLEAN_SETTING_SPEC_INVALID'; end if;
      normalized_value := jsonb_build_object(
        'enabled', (submitted_value ->> 'enabled')::boolean
      );
    when 'incident_owner_configured' then
      if jsonb_typeof(submitted_value -> 'enabled') <> 'boolean'
         or submitted_value - 'enabled' <> '{}'::jsonb
      then raise exception 'BOOLEAN_SETTING_SPEC_INVALID'; end if;
      normalized_value := jsonb_build_object(
        'enabled', (submitted_value ->> 'enabled')::boolean
      );
    when 'bank_account' then
      account_number := regexp_replace(
        coalesce(submitted_value ->> 'accountNumber', ''),
        '[^0-9]', '', 'g'
      );
      if length(trim(coalesce(submitted_value ->> 'bankName', ''))) < 2
         or coalesce(submitted_value ->> 'bankCode', '') !~ '^[0-9]{3}$'
         or length(trim(coalesce(
           submitted_value ->> 'accountName', ''
         ))) < 2
         or account_number !~ '^[0-9]{5,24}$'
         or submitted_value - 'bankName' - 'bankCode'
           - 'accountName' - 'accountNumber' <> '{}'::jsonb
      then raise exception 'BANK_ACCOUNT_SETTING_SPEC_INVALID'; end if;
      masked_account := repeat(
        '＊', greatest(length(account_number) - 5, 0)
      ) || right(account_number, 5);
      normalized_value := jsonb_build_object(
        'bankName', trim(submitted_value ->> 'bankName'),
        'bankCode', submitted_value ->> 'bankCode',
        'accountName', trim(submitted_value ->> 'accountName'),
        'accountNumber', account_number,
        'maskedAccount', masked_account
      );
    when 'finance_high_value_threshold' then
      if coalesce(submitted_value ->> 'amountTwd', '') !~ '^[0-9]+$'
         or (submitted_value ->> 'amountTwd')::bigint
           not between 1 and 100000000
         or submitted_value - 'amountTwd' <> '{}'::jsonb
      then raise exception 'FINANCE_THRESHOLD_SETTING_SPEC_INVALID'; end if;
      normalized_value := jsonb_build_object(
        'amountTwd', (submitted_value ->> 'amountTwd')::integer
      );
  end case;

  select * into existing
  from public.operating_setting_change_requests request
  where request.requested_by = actor
    and request.idempotency_key = idempotency;
  if found then
    if existing.setting_key <> submitted_key
       or existing.proposed_value <> normalized_value
       or existing.effective_at <> submitted_effective_at
       or existing.request_reason <> trim(submitted_reason)
    then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return existing.id;
  end if;

  insert into public.operating_setting_change_requests (
    setting_key, proposed_value, effective_at, requested_by,
    request_reason, idempotency_key
  ) values (
    submitted_key, normalized_value, submitted_effective_at, actor,
    trim(submitted_reason), idempotency
  ) returning id into request_id;
  perform internal.append_audit_event(
    actor, 'operating_setting.change_requested',
    'operating_setting_change_request', request_id::text,
    trim(submitted_reason), null,
    jsonb_build_object('settingKey', submitted_key)
  );
  return request_id;
end
$$;
revoke all on function internal.request_operating_setting_change(
  text, jsonb, timestamptz, text, uuid
) from public;

create or replace function public.request_operating_setting_change(
  p_setting_key text,
  p_value jsonb,
  p_effective_at timestamptz,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.request_operating_setting_change(
    p_setting_key, p_value, p_effective_at, p_reason, p_idempotency_key
  )
$$;

create or replace function internal.decide_operating_setting_change(
  target_request uuid,
  submitted_decision text,
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
  request_row public.operating_setting_change_requests%rowtype;
  next_revision integer;
  revision_id uuid;
begin
  perform internal.consume_step_up_grant(
    'platform_prerequisite_review',
    target_request::text,
    submitted_nonce_hash
  );
  if not internal.has_staff_role('platform_admin')
     or submitted_decision not in ('approve', 'reject')
     or length(trim(submitted_reason)) < 10
  then raise exception 'OPERATING_SETTING_DECISION_REJECTED'; end if;
  select * into request_row
  from public.operating_setting_change_requests request
  where request.id = target_request
  for update;
  if not found
     or request_row.status <> 'pending_review'
     or request_row.requested_by = actor
  then raise exception 'DISTINCT_OPERATING_SETTING_REVIEWER_REQUIRED'; end if;
  if submitted_decision = 'reject' then
    update public.operating_setting_change_requests
    set status = 'rejected',
        reviewed_by = actor,
        review_reason = trim(submitted_reason),
        reviewed_at = clock_timestamp()
    where id = target_request;
    perform internal.append_audit_event(
      actor, 'operating_setting.change_rejected',
      'operating_setting_change_request', target_request::text,
      trim(submitted_reason), null,
      jsonb_build_object('settingKey', request_row.setting_key)
    );
    return jsonb_build_object(
      'requestId', target_request,
      'status', 'rejected'
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'suiyue:setting:' || request_row.setting_key, 0
  ));
  select coalesce(max(revision), 0) + 1 into next_revision
  from public.operating_setting_revisions setting
  where setting.setting_key = request_row.setting_key;
  update public.operating_setting_revisions setting
  set superseded_at = request_row.effective_at
  where setting.setting_key = request_row.setting_key
    and setting.superseded_at is null
    and setting.effective_at <= request_row.effective_at;
  insert into public.operating_setting_revisions (
    setting_key, revision, value, approved_by, second_approved_by,
    effective_at
  ) values (
    request_row.setting_key, next_revision, request_row.proposed_value,
    request_row.requested_by, actor, request_row.effective_at
  ) returning id into revision_id;
  update public.operating_setting_change_requests
  set status = 'approved',
      reviewed_by = actor,
      review_reason = trim(submitted_reason),
      reviewed_at = clock_timestamp(),
      materialized_revision_id = revision_id
  where id = target_request;
  perform internal.append_audit_event(
    actor, 'operating_setting.change_approved',
    'operating_setting_change_request', target_request::text,
    trim(submitted_reason), null,
    jsonb_build_object(
      'settingKey', request_row.setting_key,
      'revisionId', revision_id
    )
  );
  return jsonb_build_object(
    'requestId', target_request,
    'status', 'approved',
    'revisionId', revision_id
  );
end
$$;
revoke all on function internal.decide_operating_setting_change(
  uuid, text, text, text
) from public;

create or replace function public.decide_operating_setting_change(
  p_request_id uuid,
  p_decision text,
  p_reason text,
  p_nonce_hash text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.decide_operating_setting_change(
    p_request_id, p_decision, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.request_provider_validation(
  submitted_provider text,
  submitted_evidence_reference text,
  submitted_evidence_sha256 text,
  submitted_tested_at timestamptz,
  submitted_reason text,
  idempotency uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  request_id uuid;
  existing public.provider_validation_requests%rowtype;
begin
  if not internal.has_staff_role('platform_admin')
     or not exists (
       select 1 from public.provider_health health
       where health.provider = submitted_provider
     )
     or length(trim(submitted_evidence_reference)) < 3
     or submitted_evidence_sha256 !~ '^[a-f0-9]{64}$'
     or submitted_tested_at is null
     or submitted_tested_at > now() + interval '5 minutes'
     or submitted_tested_at < now() - interval '90 days'
     or length(trim(submitted_reason)) < 10
  then raise exception 'PROVIDER_VALIDATION_REQUEST_REJECTED'; end if;
  select * into existing
  from public.provider_validation_requests request
  where request.requested_by = actor
    and request.idempotency_key = idempotency;
  if found then
    if existing.provider <> submitted_provider
       or existing.evidence_reference <> trim(submitted_evidence_reference)
       or existing.evidence_sha256 <> submitted_evidence_sha256
       or existing.tested_at <> submitted_tested_at
       or existing.request_reason <> trim(submitted_reason)
    then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return existing.id;
  end if;
  insert into public.provider_validation_requests (
    provider, evidence_reference, evidence_sha256, test_environment,
    tested_at, requested_by, request_reason, idempotency_key
  ) values (
    submitted_provider, trim(submitted_evidence_reference),
    submitted_evidence_sha256, 'production', submitted_tested_at,
    actor, trim(submitted_reason), idempotency
  ) returning id into request_id;
  perform internal.append_audit_event(
    actor, 'provider.production_validation_requested',
    'provider_validation_request', request_id::text,
    trim(submitted_reason), null,
    jsonb_build_object(
      'provider', submitted_provider,
      'evidenceSha256', submitted_evidence_sha256
    )
  );
  return request_id;
end
$$;
revoke all on function internal.request_provider_validation(
  text, text, text, timestamptz, text, uuid
) from public;

create or replace function public.request_provider_validation(
  p_provider text,
  p_evidence_reference text,
  p_evidence_sha256 text,
  p_tested_at timestamptz,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.request_provider_validation(
    p_provider, p_evidence_reference, p_evidence_sha256,
    p_tested_at, p_reason, p_idempotency_key
  )
$$;

create or replace function internal.enforce_provider_validation_approval()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.production_validated_at is distinct from old.production_validated_at
     and new.production_validated_at is not null
     and not exists (
       select 1
       from public.provider_validation_requests request
       where request.provider = new.provider
         and request.status = 'approved'
         and request.reviewed_at = new.production_validated_at
     )
  then raise exception 'PROVIDER_VALIDATION_DUAL_CONTROL_REQUIRED'; end if;
  return new;
end
$$;
revoke all on function internal.enforce_provider_validation_approval()
  from public;

create trigger provider_validation_dual_control
before update of production_validated_at on public.provider_health
for each row execute function internal.enforce_provider_validation_approval();

create or replace function internal.decide_provider_validation(
  target_request uuid,
  submitted_decision text,
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
  request_row public.provider_validation_requests%rowtype;
  decision_at timestamptz := clock_timestamp();
begin
  perform internal.consume_step_up_grant(
    'platform_prerequisite_review',
    target_request::text,
    submitted_nonce_hash
  );
  if not internal.has_staff_role('platform_admin')
     or submitted_decision not in ('approve', 'reject')
     or length(trim(submitted_reason)) < 10
  then raise exception 'PROVIDER_VALIDATION_DECISION_REJECTED'; end if;
  select * into request_row
  from public.provider_validation_requests request
  where request.id = target_request
  for update;
  if not found
     or request_row.status <> 'pending_review'
     or request_row.requested_by = actor
  then raise exception 'DISTINCT_PROVIDER_VALIDATION_REVIEWER_REQUIRED'; end if;
  if submitted_decision = 'approve'
     and not exists (
       select 1
       from public.provider_health health
       where health.provider = request_row.provider
         and health.status = 'healthy'
         and health.checked_at >= now() - interval '15 minutes'
         and health.last_success_at is not null
     )
  then raise exception 'PROVIDER_HEALTH_NOT_FRESH'; end if;
  update public.provider_validation_requests
  set status = case submitted_decision
        when 'approve' then 'approved' else 'rejected' end,
      reviewed_by = actor,
      review_reason = trim(submitted_reason),
      reviewed_at = decision_at
  where id = target_request;
  if submitted_decision = 'approve' then
    update public.provider_health
    set production_validated_at = decision_at,
        updated_at = decision_at
    where provider = request_row.provider;
  end if;
  perform internal.append_audit_event(
    actor,
    'provider.production_validation_' || case submitted_decision
      when 'approve' then 'approved' else 'rejected' end,
    'provider_validation_request', target_request::text,
    trim(submitted_reason), null,
    jsonb_build_object(
      'provider', request_row.provider,
      'evidenceSha256', request_row.evidence_sha256
    )
  );
  return jsonb_build_object(
    'requestId', target_request,
    'status', case submitted_decision
      when 'approve' then 'approved' else 'rejected' end,
    'productionValidatedAt', case submitted_decision
      when 'approve' then decision_at else null end
  );
end
$$;
revoke all on function internal.decide_provider_validation(
  uuid, text, text, text
) from public;

create or replace function public.decide_provider_validation(
  p_request_id uuid,
  p_decision text,
  p_reason text,
  p_nonce_hash text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.decide_provider_validation(
    p_request_id, p_decision, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.apply_accreditation_transition_effects(
  target_revision uuid,
  transition_actor uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  revision_row public.accreditation_decision_revisions%rowtype;
  request_row public.accreditation_transition_requests%rowtype;
  source_revision uuid;
  order_row record;
  assignment_row record;
  allocation_row record;
  certificate_row record;
  certificate_revision public.certificate_revisions%rowtype;
  next_certificate_revision uuid;
  refund_case_id uuid;
  order_item_id uuid;
  prior_refund integer;
  remaining_refund integer;
  assignment_reserved_points bigint;
  assignment_consumed_points bigint;
begin
  select * into revision_row
  from public.accreditation_decision_revisions revision
  where revision.id = target_revision;
  if not found then raise exception 'ACCREDITATION_REVISION_NOT_FOUND'; end if;
  select * into request_row
  from public.accreditation_transition_requests request
  where request.materialized_revision_id = target_revision
    and request.status = 'approved';
  if not found then
    raise exception 'ACCREDITATION_TRANSITION_APPROVAL_REQUIRED';
  end if;
  source_revision := request_row.source_revision_id;

  insert into public.accreditation_transition_effects (
    accreditation_revision_id, effect_kind, subject_id, effect_snapshot
  ) values (
    target_revision,
    case revision_row.status
      when 'approved' then 'approval_fulfillment'
      else 'negative_refund_and_revocation'
    end,
    revision_row.course_id,
    jsonb_build_object(
      'sourceRevisionId', source_revision,
      'status', revision_row.status,
      'requestId', request_row.id
    )
  ) on conflict (
    accreditation_revision_id, effect_kind, subject_id
  ) do nothing;
  if not found then return false; end if;

  if revision_row.status = 'approved' then
    update public.entitlements entitlement
    set status = 'active',
        locked_reason = null,
        starts_at = coalesce(entitlement.starts_at, clock_timestamp())
    where entitlement.status = 'locked'
      and entitlement.locked_reason = 'accreditation_not_yet_approved'
      and exists (
        select 1
        from public.course_version_accreditation link
        where link.course_version_id = entitlement.course_version_id
          and link.accreditation_revision_id = target_revision
      );
    update public.orders order_row
    set status = 'paid'
    where order_row.status = 'paid_unfulfilled'
      and exists (
        select 1
        from public.entitlements entitlement
        where entitlement.source_type = 'b2c_order'
          and entitlement.source_id = order_row.id
          and entitlement.status = 'active'
          and exists (
            select 1
            from public.course_version_accreditation link
            where link.course_version_id = entitlement.course_version_id
              and link.accreditation_revision_id = target_revision
          )
      )
      and not exists (
        select 1 from public.reconciliation_cases reconciliation
        where reconciliation.order_id = order_row.id
          and reconciliation.kind = 'capacity_unavailable'
          and reconciliation.status in ('open', 'investigating')
      );
    insert into public.notifications (
      person_id, category, title, body, business_key
    )
    select distinct
      entitlement.person_id,
      'accreditation',
      '課程積分核定已完成',
      '課程權限已依核定結果重新檢查；符合付款與場次條件者現在可開始學習。',
      'accreditation-approved:' || target_revision::text || ':'
        || entitlement.person_id::text
    from public.entitlements entitlement
    where exists (
      select 1
      from public.course_version_accreditation link
      where link.course_version_id = entitlement.course_version_id
        and link.accreditation_revision_id = target_revision
    )
    on conflict (person_id, business_key) do nothing;
  else
    update public.course_versions version
    set status = 'suspended'
    where version.status = 'published'
      and exists (
        select 1
        from public.course_version_accreditation link
        where link.course_version_id = version.id
          and link.accreditation_revision_id = target_revision
      );
    update public.orders order_record
    set status = 'paid_unfulfilled'
    where order_record.status = 'paid'
      and exists (
        select 1
        from public.order_items item
        join public.course_version_accreditation link
          on link.course_version_id = item.course_version_id
        where item.order_id = order_record.id
          and link.accreditation_revision_id = target_revision
      );
    update public.entitlements entitlement
    set status = 'revoked',
        locked_reason = 'accreditation_' || revision_row.status
    where entitlement.status in ('locked', 'active', 'frozen')
      and exists (
        select 1
        from public.course_version_accreditation link
        where link.course_version_id = entitlement.course_version_id
          and link.accreditation_revision_id = target_revision
      );
    update public.enrollments enrollment
    set status = 'revoked'
    where enrollment.status <> 'refunded'
      and exists (
        select 1
        from public.course_version_accreditation link
        where link.course_version_id = enrollment.course_version_id
          and link.accreditation_revision_id = target_revision
      );

    -- Institution points are returned to the same purchased lots. Reserved
    -- allocations are released; already-consumed allocations are compensated.
    -- This never mints points and keeps both the lot and wallet invariants.
    for assignment_row in
      select assignment.*
      from public.organization_assignments assignment
      where assignment.status in (
          'reserved', 'active', 'consumed', 'completed'
        )
        and exists (
          select 1
          from public.course_version_accreditation link
          where link.course_version_id = assignment.course_version_id
            and link.accreditation_revision_id = target_revision
        )
      order by assignment.organization_id, assignment.id
      for update of assignment
    loop
      perform 1
      from public.organization_wallets wallet
      where wallet.organization_id = assignment_row.organization_id
      for update;
      assignment_reserved_points := 0;
      assignment_consumed_points := 0;
      for allocation_row in
        select allocation.*
        from public.assignment_point_allocations allocation
        where allocation.assignment_id = assignment_row.id
          and allocation.status in ('reserved', 'consumed')
        order by allocation.point_lot_id
        for update of allocation
      loop
        perform 1
        from public.point_lots lot
        where lot.id = allocation_row.point_lot_id
        for update;
        if allocation_row.status = 'reserved' then
          update public.point_lots
          set reserved_points = reserved_points - allocation_row.points,
              available_points = available_points + allocation_row.points
          where id = allocation_row.point_lot_id
            and reserved_points >= allocation_row.points;
          if not found then raise exception 'POINT_LEDGER_DRIFT'; end if;
          assignment_reserved_points :=
            assignment_reserved_points + allocation_row.points;
        else
          update public.point_lots
          set consumed_points = consumed_points - allocation_row.points,
              available_points = available_points + allocation_row.points
          where id = allocation_row.point_lot_id
            and consumed_points >= allocation_row.points;
          if not found then raise exception 'POINT_LEDGER_DRIFT'; end if;
          assignment_consumed_points :=
            assignment_consumed_points + allocation_row.points;
        end if;
        update public.assignment_point_allocations
        set status = case allocation_row.status
          when 'reserved' then 'released'
          else 'compensated'
        end
        where id = allocation_row.id
          and status = allocation_row.status;
        insert into public.point_ledger_events (
          organization_id, point_lot_id, event_type, points,
          assignment_id, actor_id, idempotency_key, reason
        ) values (
          assignment_row.organization_id,
          allocation_row.point_lot_id,
          case allocation_row.status
            when 'reserved' then 'released'
            else 'compensated'
          end,
          allocation_row.points, assignment_row.id, transition_actor,
          gen_random_uuid(),
          'accreditation_' || revision_row.status
        );
      end loop;
      if assignment_reserved_points + assignment_consumed_points
           <> assignment_row.point_price_snapshot
      then raise exception 'POINT_LEDGER_DRIFT'; end if;
      update public.organization_wallets
      set reserved_points =
            reserved_points - assignment_reserved_points,
          consumed_points =
            consumed_points - assignment_consumed_points,
          available_points =
            available_points + assignment_reserved_points
              + assignment_consumed_points,
          ledger_version = ledger_version + 1,
          updated_at = clock_timestamp()
      where organization_id = assignment_row.organization_id
        and reserved_points >= assignment_reserved_points
        and consumed_points >= assignment_consumed_points;
      if not found then raise exception 'POINT_WALLET_DRIFT'; end if;
      update public.organization_assignments
      set status = 'refunded',
          released_at = coalesce(released_at, clock_timestamp())
      where id = assignment_row.id;
      update public.live_bookings
      set status = 'released'
      where payer_type = 'organization'
        and payer_source_id = assignment_row.id
        and status in ('held', 'confirmed');
      insert into public.notifications (
        person_id, category, title, body, business_key
      ) values (
        assignment_row.member_person_id,
        'accreditation',
        '機構指派課程積分狀態已變更',
        '課程權限已停止，原指派點數已退回機構錢包；請在網站通知中心查看後續處理。',
        'accreditation-organization-negative:'
          || target_revision::text || ':' || assignment_row.id::text
      )
      on conflict (person_id, business_key) do nothing;
    end loop;

    for order_row in
      select
        orders.id,
        orders.person_id,
        orders.amount_paid_twd
      from public.orders orders
      where orders.amount_paid_twd > 0
        and orders.status = 'paid_unfulfilled'
        and exists (
          select 1
          from public.order_items item
          join public.course_version_accreditation link
            on link.course_version_id = item.course_version_id
          where item.order_id = orders.id
            and link.accreditation_revision_id = target_revision
        )
      order by orders.id
      for update of orders
    loop
      select coalesce(sum(allocation.amount_twd), 0)
        into prior_refund
      from public.refund_allocations allocation
      join public.refund_cases refund
        on refund.id = allocation.refund_case_id
      where refund.order_id = order_row.id
        and refund.status not in ('rejected', 'failed');
      remaining_refund := greatest(
        order_row.amount_paid_twd - prior_refund, 0
      );
      if remaining_refund > 0 then
        refund_case_id := gen_random_uuid();
        select item.id into order_item_id
        from public.order_items item
        where item.order_id = order_row.id
        order by item.created_at, item.id
        limit 1;
        insert into public.refund_cases (
          id, order_id, requested_by, status, basis, reason,
          account_details_ciphertext, usage_snapshot, idempotency_key
        ) values (
          refund_case_id, order_row.id, order_row.person_id, 'submitted',
          'accreditation_failure',
          '積分 revision 已' || case revision_row.status
            when 'rejected' then '退件'
            when 'expired' then '到期'
            else '撤銷' end || '，系統建立全額未履約退款待辦。',
          null,
          jsonb_build_object(
            'accreditationRevisionId', target_revision,
            'transitionStatus', revision_row.status,
            'automatic', true
          ),
          gen_random_uuid()
        );
        insert into public.refund_allocations (
          refund_case_id, order_item_id, scope_type, scope_id,
          amount_twd, calculation_snapshot
        ) values (
          refund_case_id, order_item_id, 'whole_order', null,
          remaining_refund,
          jsonb_build_object(
            'formula', 'remaining_paid_amount',
            'amountPaidTwd', order_row.amount_paid_twd,
            'priorRefundTwd', prior_refund,
            'accreditationRevisionId', target_revision
          )
        );
      end if;
    end loop;

    for certificate_row in
      select
        certificate.id,
        certificate.enrollment_id,
        certificate.current_revision_id
      from public.certificates certificate
      join public.enrollments enrollment
        on enrollment.id = certificate.enrollment_id
      join public.course_version_accreditation link
        on link.course_version_id = enrollment.course_version_id
      where link.accreditation_revision_id = target_revision
        and certificate.current_status <> 'revoked'
      order by certificate.id
      for update of certificate
    loop
      select * into certificate_revision
      from public.certificate_revisions revision
      where revision.id = certificate_row.current_revision_id;
      if found then
        insert into public.certificate_revisions (
          certificate_id, revision, status, masked_name_snapshot,
          course_title_snapshot, course_version_snapshot, completed_on,
          accreditation_reference_snapshot, accreditation_points_snapshot,
          accreditation_authority_snapshot, live_session_snapshot,
          evidence_manifest_hash, pdf_object_path, pdf_sha256,
          verification_token_hash, issued_by, approved_by,
          revoked_at, revocation_reason
        ) values (
          certificate_row.id, certificate_revision.revision + 1, 'revoked',
          certificate_revision.masked_name_snapshot,
          certificate_revision.course_title_snapshot,
          certificate_revision.course_version_snapshot,
          certificate_revision.completed_on,
          certificate_revision.accreditation_reference_snapshot,
          certificate_revision.accreditation_points_snapshot,
          certificate_revision.accreditation_authority_snapshot,
          certificate_revision.live_session_snapshot,
          certificate_revision.evidence_manifest_hash,
          certificate_revision.pdf_object_path,
          certificate_revision.pdf_sha256,
          encode(extensions.digest(
            target_revision::text || ':' || certificate_row.id::text
              || ':' || clock_timestamp()::text,
            'sha256'
          ), 'hex'),
          request_row.requested_by,
          transition_actor,
          clock_timestamp(),
          'accreditation_' || revision_row.status
        ) returning id into next_certificate_revision;
        update public.certificates
        set current_revision_id = next_certificate_revision,
            current_status = 'revoked'
        where id = certificate_row.id;
      end if;
    end loop;

    insert into public.notifications (
      person_id, category, title, body, business_key
    )
    select distinct
      order_record.person_id,
      'accreditation',
      '課程積分狀態已變更',
      '課程已停止履約並建立退款待辦；請在網站通知中心查看後續處理。',
      'accreditation-negative:' || target_revision::text || ':'
        || order_record.person_id::text
    from public.orders order_record
    join public.order_items item on item.order_id = order_record.id
    join public.course_version_accreditation link
      on link.course_version_id = item.course_version_id
    where link.accreditation_revision_id = target_revision
    on conflict (person_id, business_key) do nothing;
  end if;

  perform internal.append_audit_event(
    transition_actor,
    'accreditation.transition_effects_applied',
    'accreditation_revision',
    target_revision::text,
    request_row.review_reason,
    null,
    jsonb_build_object(
      'status', revision_row.status,
      'sourceRevisionId', source_revision
    )
  );
  return true;
end
$$;
revoke all on function internal.apply_accreditation_transition_effects(
  uuid, uuid
) from public;

create or replace function internal.request_accreditation_transition(
  target_source_revision uuid,
  submitted_status text,
  submitted_approval_reference text,
  submitted_points numeric,
  submitted_valid_from timestamptz,
  submitted_valid_until timestamptz,
  submitted_effective_at timestamptz,
  submitted_retroactive boolean,
  submitted_retroactive_basis text,
  submitted_source_document_path text,
  submitted_source_document_sha256 text,
  submitted_reason text,
  idempotency uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  source_row public.accreditation_decision_revisions%rowtype;
  existing public.accreditation_transition_requests%rowtype;
  request_id uuid;
begin
  if not internal.has_staff_role('accreditation_reviewer')
     or submitted_status not in (
       'approved', 'rejected', 'expired', 'revoked'
     )
     or submitted_effective_at is null
     or submitted_effective_at > clock_timestamp() + interval '5 minutes'
     or length(trim(submitted_source_document_path)) < 1
     or submitted_source_document_sha256 !~ '^[a-f0-9]{64}$'
     or length(trim(submitted_reason)) < 10
  then raise exception 'ACCREDITATION_TRANSITION_REQUEST_REJECTED'; end if;
  select * into source_row
  from public.accreditation_decision_revisions revision
  where revision.id = target_source_revision
  for share;
  if not found
     or exists (
       select 1 from public.accreditation_decision_revisions newer
       where newer.course_id = source_row.course_id
         and newer.revision > source_row.revision
     )
     or not (
       (
         source_row.status = 'applying'
         and submitted_status in ('approved', 'rejected', 'expired')
       )
       or (
         source_row.status = 'approved'
         and submitted_status in ('expired', 'revoked')
       )
     )
     or (
       submitted_status = 'expired'
       and (
         source_row.valid_until is null
         or submitted_effective_at < source_row.valid_until
       )
     )
  then raise exception 'ACCREDITATION_TRANSITION_INVALID'; end if;
  if submitted_status = 'approved' and (
       length(trim(coalesce(submitted_approval_reference, ''))) < 2
       or coalesce(submitted_points, 0) <= 0
       or submitted_valid_from is null
       or submitted_valid_until is null
       or submitted_valid_until <= submitted_valid_from
       or submitted_valid_from > submitted_effective_at
       or (
         submitted_retroactive
         and length(trim(coalesce(
           submitted_retroactive_basis, ''
         ))) < 10
       )
     )
  then raise exception 'ACCREDITATION_APPROVAL_SPEC_INVALID'; end if;
  if submitted_status <> 'approved' and (
       submitted_approval_reference is not null
       or submitted_points is not null
       or submitted_retroactive
       or submitted_retroactive_basis is not null
     )
  then raise exception 'ACCREDITATION_NEGATIVE_SPEC_INVALID'; end if;

  select * into existing
  from public.accreditation_transition_requests request
  where request.requested_by = actor
    and request.idempotency_key = idempotency;
  if found then
    if existing.source_revision_id <> target_source_revision
       or existing.requested_status <> submitted_status
       or existing.approval_reference
         is distinct from nullif(trim(submitted_approval_reference), '')
       or existing.points is distinct from submitted_points
       or existing.valid_from is distinct from submitted_valid_from
       or existing.valid_until is distinct from submitted_valid_until
       or existing.effective_at <> submitted_effective_at
       or existing.retroactive <> submitted_retroactive
       or existing.retroactive_basis
         is distinct from nullif(trim(submitted_retroactive_basis), '')
       or existing.source_document_path
         <> trim(submitted_source_document_path)
       or existing.source_document_sha256
         <> submitted_source_document_sha256
       or existing.request_reason <> trim(submitted_reason)
    then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return existing.id;
  end if;

  insert into public.accreditation_transition_requests (
    source_revision_id, requested_status, approval_reference, points,
    valid_from, valid_until, effective_at, retroactive,
    retroactive_basis, source_document_path, source_document_sha256,
    request_reason, requested_by, idempotency_key
  ) values (
    target_source_revision, submitted_status,
    case when submitted_status = 'approved'
      then trim(submitted_approval_reference) else null end,
    case when submitted_status = 'approved'
      then submitted_points else null end,
    case when submitted_status = 'approved'
      then submitted_valid_from else null end,
    case when submitted_status = 'approved'
      then submitted_valid_until else null end,
    submitted_effective_at,
    submitted_status = 'approved' and submitted_retroactive,
    case when submitted_status = 'approved' and submitted_retroactive
      then trim(submitted_retroactive_basis) else null end,
    trim(submitted_source_document_path),
    submitted_source_document_sha256,
    trim(submitted_reason), actor, idempotency
  ) returning id into request_id;
  perform internal.append_audit_event(
    actor, 'accreditation.transition_requested',
    'accreditation_transition_request', request_id::text,
    trim(submitted_reason), null,
    jsonb_build_object(
      'sourceRevisionId', target_source_revision,
      'requestedStatus', submitted_status,
      'sourceDocumentSha256', submitted_source_document_sha256
    )
  );
  return request_id;
end
$$;
revoke all on function internal.request_accreditation_transition(
  uuid, text, text, numeric, timestamptz, timestamptz,
  timestamptz, boolean, text, text, text, text, uuid
) from public;

create or replace function public.request_accreditation_transition(
  p_source_revision_id uuid,
  p_requested_status text,
  p_approval_reference text,
  p_points numeric,
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_effective_at timestamptz,
  p_retroactive boolean,
  p_retroactive_basis text,
  p_source_document_path text,
  p_source_document_sha256 text,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.request_accreditation_transition(
    p_source_revision_id, p_requested_status, p_approval_reference,
    p_points, p_valid_from, p_valid_until, p_effective_at,
    p_retroactive, p_retroactive_basis, p_source_document_path,
    p_source_document_sha256, p_reason, p_idempotency_key
  )
$$;

create or replace function internal.decide_accreditation_transition(
  target_request uuid,
  submitted_decision text,
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
  request_row public.accreditation_transition_requests%rowtype;
  source_row public.accreditation_decision_revisions%rowtype;
  next_revision integer;
  revision_id uuid;
  decision_at timestamptz := clock_timestamp();
begin
  perform internal.consume_step_up_grant(
    'accreditation_result',
    target_request::text,
    submitted_nonce_hash
  );
  if not internal.has_staff_role('accreditation_reviewer')
     or submitted_decision not in ('approve', 'reject')
     or length(trim(submitted_reason)) < 10
  then raise exception 'ACCREDITATION_TRANSITION_DECISION_REJECTED'; end if;
  select * into request_row
  from public.accreditation_transition_requests request
  where request.id = target_request
  for update;
  if not found
     or request_row.status <> 'pending_review'
     or request_row.requested_by = actor
  then raise exception 'DISTINCT_ACCREDITATION_REVIEWER_REQUIRED'; end if;
  select * into source_row
  from public.accreditation_decision_revisions revision
  where revision.id = request_row.source_revision_id
  for share;
  if not found or exists (
    select 1 from public.accreditation_decision_revisions newer
    where newer.course_id = source_row.course_id
      and newer.revision > source_row.revision
  ) then raise exception 'ACCREDITATION_TRANSITION_STALE'; end if;
  if submitted_decision = 'reject' then
    update public.accreditation_transition_requests
    set status = 'rejected',
        reviewed_by = actor,
        review_reason = trim(submitted_reason),
        reviewed_at = decision_at
    where id = target_request;
    perform internal.append_audit_event(
      actor, 'accreditation.transition_rejected',
      'accreditation_transition_request', target_request::text,
      trim(submitted_reason), null,
      jsonb_build_object(
        'sourceRevisionId', source_row.id,
        'requestedStatus', request_row.requested_status
      )
    );
    return jsonb_build_object(
      'requestId', target_request,
      'status', 'rejected'
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'suiyue:accreditation:' || source_row.course_id::text, 0
  ));
  if exists (
    select 1 from public.accreditation_decision_revisions newer
    where newer.course_id = source_row.course_id
      and newer.revision > source_row.revision
  ) then raise exception 'ACCREDITATION_TRANSITION_STALE'; end if;
  select coalesce(max(revision), 0) + 1 into next_revision
  from public.accreditation_decision_revisions revision
  where revision.course_id = source_row.course_id;
  insert into public.accreditation_decision_revisions (
    course_id, organizing_body_id, authority_id, revision, status,
    application_reference, approval_reference, points,
    valid_from, valid_until, effective_at, retroactive,
    retroactive_basis, source_document_path, source_document_sha256,
    review_snapshot, created_by, reviewed_by
  ) values (
    source_row.course_id, source_row.organizing_body_id,
    source_row.authority_id, next_revision, request_row.requested_status,
    source_row.application_reference,
    request_row.approval_reference, request_row.points,
    coalesce(request_row.valid_from, source_row.valid_from),
    coalesce(request_row.valid_until, source_row.valid_until),
    request_row.effective_at, request_row.retroactive,
    request_row.retroactive_basis, request_row.source_document_path,
    request_row.source_document_sha256,
    jsonb_build_object(
      'transitionRequestId', request_row.id,
      'sourceRevisionId', source_row.id,
      'requestReason', request_row.request_reason,
      'reviewReason', trim(submitted_reason),
      'reviewedAt', decision_at
    ),
    request_row.requested_by, actor
  ) returning id into revision_id;
  insert into public.course_version_accreditation (
    course_version_id, accreditation_revision_id,
    disclosure_snapshot, terms_reconfirmed_at
  )
  select
    link.course_version_id, revision_id,
    link.disclosure_snapshot, link.terms_reconfirmed_at
  from public.course_version_accreditation link
  where link.accreditation_revision_id = source_row.id
  on conflict (course_version_id, accreditation_revision_id) do nothing;
  update public.accreditation_transition_requests
  set status = 'approved',
      reviewed_by = actor,
      review_reason = trim(submitted_reason),
      reviewed_at = decision_at,
      materialized_revision_id = revision_id
  where id = target_request;
  perform internal.apply_accreditation_transition_effects(
    revision_id, actor
  );
  perform internal.append_audit_event(
    actor, 'accreditation.transition_approved',
    'accreditation_transition_request', target_request::text,
    trim(submitted_reason), null,
    jsonb_build_object(
      'sourceRevisionId', source_row.id,
      'materializedRevisionId', revision_id,
      'status', request_row.requested_status
    )
  );
  return jsonb_build_object(
    'requestId', target_request,
    'status', 'approved',
    'materializedRevisionId', revision_id,
    'accreditationStatus', request_row.requested_status
  );
end
$$;
revoke all on function internal.decide_accreditation_transition(
  uuid, text, text, text
) from public;

create or replace function public.decide_accreditation_transition(
  p_request_id uuid,
  p_decision text,
  p_reason text,
  p_nonce_hash text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.decide_accreditation_transition(
    p_request_id, p_decision, p_reason, p_nonce_hash
  )
$$;

create or replace function internal.read_launch_control_workspace()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
begin
  if not internal.has_staff_role('platform_admin') then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;
  return jsonb_build_object(
    'settings', (
      with setting_keys(setting_key, label) as (
        values
          ('legal_approved', '法務文件已核准'),
          ('finance_configured', '財務流程已設定'),
          ('incident_owner_configured', '資安事故負責人已設定'),
          ('bank_account', '人工匯款帳戶'),
          ('finance_high_value_threshold', '高額匯款雙人門檻')
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', setting_keys.setting_key,
        'label', setting_keys.label,
        'value', case
          when setting_keys.setting_key = 'bank_account'
            and current_setting.value is not null
          then current_setting.value - 'accountNumber'
          else current_setting.value
        end,
        'effectiveAt', current_setting.effective_at,
        'revision', current_setting.revision
      ) order by setting_keys.setting_key), '[]'::jsonb)
      from setting_keys
      left join lateral (
        select setting.value, setting.effective_at, setting.revision
        from public.operating_setting_revisions setting
        where setting.setting_key = setting_keys.setting_key
          and setting.effective_at <= now()
          and (
            setting.superseded_at is null
            or setting.superseded_at > now()
          )
        order by setting.revision desc
        limit 1
      ) current_setting on true
    ),
    'settingRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', request.id,
        'settingKey', request.setting_key,
        'proposedValue', case
          when request.setting_key = 'bank_account'
          then request.proposed_value - 'accountNumber'
          else request.proposed_value
        end,
        'effectiveAt', request.effective_at,
        'requestReason', request.request_reason,
        'requesterLabel', case
          when length(requester.display_name) < 2 then '管理員'
          else left(requester.display_name, 1)
            || repeat('＊', length(requester.display_name) - 1)
        end,
        'canDecide', request.requested_by <> actor
      ) order by request.created_at, request.id)
      from public.operating_setting_change_requests request
      join public.people requester on requester.id = request.requested_by
      where request.status = 'pending_review'
    ), '[]'::jsonb),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', health.provider,
        'status', health.status,
        'checkedAt', health.checked_at,
        'lastSuccessAt', health.last_success_at,
        'productionValidatedAt', health.production_validated_at
      ) order by health.provider)
      from public.provider_health health
    ), '[]'::jsonb),
    'providerRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', request.id,
        'provider', request.provider,
        'evidenceReference', request.evidence_reference,
        'evidenceSha256', request.evidence_sha256,
        'testedAt', request.tested_at,
        'requestReason', request.request_reason,
        'requesterLabel', case
          when length(requester.display_name) < 2 then '管理員'
          else left(requester.display_name, 1)
            || repeat('＊', length(requester.display_name) - 1)
        end,
        'canDecide', request.requested_by <> actor
      ) order by request.created_at, request.id)
      from public.provider_validation_requests request
      join public.people requester on requester.id = request.requested_by
      where request.status = 'pending_review'
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function internal.read_launch_control_workspace()
  from public;

create or replace function public.read_launch_control_workspace()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_launch_control_workspace()
$$;

create or replace function internal.read_accreditation_operations_workspace()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  can_create_batch boolean := internal.has_staff_role('course_admin');
  can_manage_lifecycle boolean :=
    internal.has_staff_role('accreditation_reviewer');
begin
  if not can_create_batch and not can_manage_lifecycle then
    raise exception 'ACCREDITATION_OPERATIONS_ROLE_REQUIRED';
  end if;
  return jsonb_build_object(
    'canCreateBatch', can_create_batch,
    'canManageLifecycle', can_manage_lifecycle,
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', latest.id,
        'courseId', latest.course_id,
        'courseLabel', course.internal_title,
        'revision', latest.revision,
        'status', latest.status,
        'applicationReference', latest.application_reference,
        'approvalReference', latest.approval_reference,
        'points', latest.points,
        'validFrom', latest.valid_from,
        'validUntil', latest.valid_until,
        'retroactive', latest.retroactive,
        'canRequestTransition',
          can_manage_lifecycle
          and latest.status in ('applying', 'approved')
          and not exists (
            select 1
            from public.accreditation_transition_requests pending
            where pending.source_revision_id = latest.id
              and pending.status = 'pending_review'
          )
      ) order by course.internal_title, latest.revision desc)
      from (
        select distinct on (revision.course_id) revision.*
        from public.accreditation_decision_revisions revision
        order by revision.course_id, revision.revision desc
      ) latest
      join public.courses course on course.id = latest.course_id
      where course.archived_at is null
    ), '[]'::jsonb),
    'transitionRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', request.id,
        'sourceRevisionId', request.source_revision_id,
        'courseLabel', course.internal_title,
        'requestedStatus', request.requested_status,
        'approvalReference', request.approval_reference,
        'points', request.points,
        'validFrom', request.valid_from,
        'validUntil', request.valid_until,
        'effectiveAt', request.effective_at,
        'retroactive', request.retroactive,
        'retroactiveBasis', request.retroactive_basis,
        'sourceDocumentPath', request.source_document_path,
        'sourceDocumentSha256', request.source_document_sha256,
        'requestReason', request.request_reason,
        'requesterLabel', case
          when length(requester.display_name) < 2 then '積分審核員'
          else left(requester.display_name, 1)
            || repeat('＊', length(requester.display_name) - 1)
        end,
        'canDecide',
          can_manage_lifecycle and request.requested_by <> actor
      ) order by request.created_at, request.id)
      from public.accreditation_transition_requests request
      join public.accreditation_decision_revisions source
        on source.id = request.source_revision_id
      join public.courses course on course.id = source.course_id
      join public.people requester on requester.id = request.requested_by
      where request.status = 'pending_review'
    ), '[]'::jsonb),
    'batchCourseOptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'courseVersionId', version.id,
        'label', version.title || '（v' || version.version::text || '）',
        'accreditationRevisionId', current_revision.id,
        'accreditationLabel',
          coalesce(current_revision.approval_reference, '尚未核定'),
        'liveSessions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', session.id,
            'label', session.title || '／'
              || session.starts_at::date::text
          ) order by session.starts_at, session.id)
          from public.live_sessions session
          where session.course_version_id = version.id
            and session.status = 'ended'
        ), '[]'::jsonb)
      ) order by version.title, version.version)
      from public.course_versions version
      join lateral (
        select revision.*
        from public.course_version_accreditation link
        join public.accreditation_decision_revisions revision
          on revision.id = link.accreditation_revision_id
        where link.course_version_id = version.id
        order by revision.revision desc
        limit 1
      ) current_revision on true
      where version.status in ('published', 'suspended')
        and current_revision.status = 'approved'
    ), '[]'::jsonb),
    'batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', batch.id,
        'courseVersionId', batch.course_version_id,
        'courseLabel', version.title,
        'accreditationRevisionId', batch.accreditation_revision_id,
        'liveSessionId', batch.live_session_id,
        'status', batch.status,
        'templateVersion', batch.template_version,
        'externalReference', batch.external_submission_reference,
        'createdAt', batch.created_at,
        'canMarkSubmitted',
          can_manage_lifecycle
          and batch.status = 'exported'
          and batch.requested_by <> actor,
        'canRecordResults',
          can_manage_lifecycle
          and batch.status = 'submitted'
          and batch.requested_by <> actor
          and batch.submitted_by is distinct from actor,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'enrollmentId', item.enrollment_id,
            'learnerLabel', case
              when length(person.display_name) < 2 then '學員'
              else left(person.display_name, 1)
                || repeat('＊', length(person.display_name) - 1)
            end,
            'status', item.status,
            'missingReasons', item.missing_reasons
          ) order by item.enrollment_id)
          from public.accreditation_submission_items item
          join public.enrollments enrollment
            on enrollment.id = item.enrollment_id
          join public.people person on person.id = enrollment.person_id
          where item.batch_id = batch.id
        ), '[]'::jsonb)
      ) order by batch.created_at desc, batch.id desc)
      from public.accreditation_submission_batches batch
      join public.course_versions version
        on version.id = batch.course_version_id
      where batch.created_at >= now() - interval '2 years'
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function internal.read_accreditation_operations_workspace()
  from public;

create or replace function public.read_accreditation_operations_workspace()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_accreditation_operations_workspace()
$$;

revoke all on function public.request_operating_setting_change(
  text, jsonb, timestamptz, text, uuid
) from public, anon;
revoke all on function public.decide_operating_setting_change(
  uuid, text, text, text
) from public, anon;
revoke all on function public.request_provider_validation(
  text, text, text, timestamptz, text, uuid
) from public, anon;
revoke all on function public.decide_provider_validation(
  uuid, text, text, text
) from public, anon;
revoke all on function public.request_accreditation_transition(
  uuid, text, text, numeric, timestamptz, timestamptz,
  timestamptz, boolean, text, text, text, text, uuid
) from public, anon;
revoke all on function public.decide_accreditation_transition(
  uuid, text, text, text
) from public, anon;
revoke all on function public.read_launch_control_workspace()
  from public, anon;
revoke all on function public.read_accreditation_operations_workspace()
  from public, anon;

grant execute on function internal.request_operating_setting_change(
  text, jsonb, timestamptz, text, uuid
) to authenticated;
grant execute on function public.request_operating_setting_change(
  text, jsonb, timestamptz, text, uuid
) to authenticated;
grant execute on function internal.decide_operating_setting_change(
  uuid, text, text, text
) to authenticated;
grant execute on function public.decide_operating_setting_change(
  uuid, text, text, text
) to authenticated;
grant execute on function internal.request_provider_validation(
  text, text, text, timestamptz, text, uuid
) to authenticated;
grant execute on function public.request_provider_validation(
  text, text, text, timestamptz, text, uuid
) to authenticated;
grant execute on function internal.decide_provider_validation(
  uuid, text, text, text
) to authenticated;
grant execute on function public.decide_provider_validation(
  uuid, text, text, text
) to authenticated;
grant execute on function internal.request_accreditation_transition(
  uuid, text, text, numeric, timestamptz, timestamptz,
  timestamptz, boolean, text, text, text, text, uuid
) to authenticated;
grant execute on function public.request_accreditation_transition(
  uuid, text, text, numeric, timestamptz, timestamptz,
  timestamptz, boolean, text, text, text, text, uuid
) to authenticated;
grant execute on function internal.decide_accreditation_transition(
  uuid, text, text, text
) to authenticated;
grant execute on function public.decide_accreditation_transition(
  uuid, text, text, text
) to authenticated;
grant execute on function internal.read_launch_control_workspace()
  to authenticated;
grant execute on function public.read_launch_control_workspace()
  to authenticated;
grant execute on function internal.read_accreditation_operations_workspace()
  to authenticated;
grant execute on function public.read_accreditation_operations_workspace()
  to authenticated;
