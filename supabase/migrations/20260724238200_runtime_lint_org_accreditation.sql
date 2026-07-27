-- Forward-only runtime lint corrections.
-- Each replacement starts from the latest effective function body and changes
-- only PL/pgSQL identifiers that collide with SQL columns or aliases.
-- PostgreSQL has no built-in jsonb_object_length(jsonb), so publication
-- validation counts jsonb_object_keys directly.

create or replace function internal.publish_course_version(
  target_version uuid,
  review_reason text,
  submitted_nonce_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  version_row public.course_versions%rowtype;
  requirement_row public.course_requirements%rowtype;
  decision_row public.accreditation_decision_revisions%rowtype;
  question_count integer;
  live_allocation_total integer;
  component_count integer;
  visited_count integer;
begin
  perform internal.consume_step_up_grant(
    'course_publish', target_version::text, submitted_nonce_hash
  );
  if not internal.has_staff_role('accreditation_reviewer')
     or length(trim(review_reason)) < 10
  then
    raise exception 'ACCREDITATION_REVIEWER_REQUIRED';
  end if;
  select * into version_row
  from public.course_versions where id = target_version for update;
  if not found or version_row.status <> 'in_review' then
    raise exception 'COURSE_NOT_IN_REVIEW';
  end if;
  if version_row.submitted_by is null or version_row.submitted_by = actor then
    raise exception 'SEPARATE_REVIEWER_REQUIRED';
  end if;
  if version_row.price_twd is null
     or version_row.organization_point_price is null
     or version_row.legal_document_id is null
     or version_row.retention_policy_revision_id is null
     or version_row.minimum_completion_window is null
     or version_row.commerce_close_at is null
  then
    raise exception 'COURSE_PUBLICATION_FIELDS_MISSING';
  end if;
  if not exists (
    select 1 from public.legal_documents legal
    where legal.id = version_row.legal_document_id
      and legal.approved_by_legal
      and legal.effective_at <= now()
      and (legal.superseded_at is null or legal.superseded_at > now())
  ) then
    raise exception 'LEGAL_REVISION_NOT_APPROVED';
  end if;
  if not exists (
    select 1 from public.retention_policy_revisions retention
    where retention.id = version_row.retention_policy_revision_id
      and retention.effective_at <= now()
      and length(trim(retention.legal_basis)) >= 10
  ) then
    raise exception 'RETENTION_POLICY_NOT_EFFECTIVE';
  end if;
  if not internal.setting_is_true('legal_approved')
     or not internal.setting_is_true('finance_configured')
     or not internal.setting_is_true('incident_owner_configured')
     or not exists (
       select 1 from public.operating_setting_revisions setting
       where setting.setting_key = 'bank_account'
         and setting.effective_at <= now()
         and (
           setting.superseded_at is null
           or setting.superseded_at > now()
         )
         and setting.value ->> 'bankName' is not null
         and setting.value ->> 'bankCode' is not null
         and setting.value ->> 'accountName' is not null
         and setting.value ->> 'accountNumber' is not null
         and setting.value ->> 'maskedAccount' is not null
     )
     or not exists (
       select 1 from public.operating_setting_revisions setting
       where setting.setting_key = 'finance_high_value_threshold'
         and setting.effective_at <= now()
         and (
           setting.superseded_at is null
           or setting.superseded_at > now()
         )
         and coalesce((setting.value ->> 'amountTwd')::integer, 0) > 0
         and setting.second_approved_by is not null
     )
  then
    raise exception 'OPERATING_CONFIGURATION_INCOMPLETE';
  end if;
  select coalesce(sum(value::integer), 0) into live_allocation_total
  from jsonb_each_text(version_row.live_refund_allocations);
  if version_row.price_twd <>
       version_row.recorded_refund_allocation_twd + live_allocation_total
  then
    raise exception 'REFUND_ALLOCATIONS_DO_NOT_EQUAL_PRICE';
  end if;
  if (
       version_row.delivery_type = 'recorded'
       and (
         version_row.recorded_refund_allocation_twd <> version_row.price_twd
         or (
           select count(*)::integer
           from jsonb_object_keys(version_row.live_refund_allocations)
         ) <> 0
       )
     )
     or (
       version_row.delivery_type = 'live'
       and (
         version_row.recorded_refund_allocation_twd <> 0
         or (
           select count(*)::integer
           from jsonb_object_keys(version_row.live_refund_allocations)
         ) <> 1
         or not (
           version_row.live_refund_allocations
             ? version_row.id::text
         )
       )
     )
     or (
       version_row.delivery_type = 'hybrid'
       and (
         exists (
           select 1
           from public.hybrid_components component
           where component.course_version_id = version_row.id
             and component.component_type = 'live'
             and not (
               version_row.live_refund_allocations
                 ? component.id::text
             )
         )
         or exists (
           select 1
           from jsonb_object_keys(
             version_row.live_refund_allocations
           ) as allocation_keys(allocation_key)
           where not exists (
             select 1
             from public.hybrid_components component
             where component.course_version_id = version_row.id
               and component.component_type = 'live'
               and component.id::text = allocation_key
           )
         )
       )
     )
  then
    raise exception 'REFUND_ALLOCATION_SCOPE_INVALID';
  end if;

  select * into requirement_row
  from public.course_requirements
  where course_version_id = target_version;
  if not found
     or (version_row.delivery_type in ('recorded', 'hybrid')
       and requirement_row.required_watch_seconds <= 0)
     or requirement_row.live_presence_percent is null
       and version_row.delivery_type in ('live', 'hybrid')
     or requirement_row.live_camera_percent is null
       and version_row.delivery_type in ('live', 'hybrid')
  then
    raise exception 'COMPLETION_REQUIREMENTS_MISSING';
  end if;

  select count(*) into question_count
  from public.question_banks bank
  join public.question_versions question
    on question.question_bank_id = bank.id and question.active
  where bank.course_version_id = target_version;
  if question_count < 20 then raise exception 'QUESTION_BANK_TOO_SMALL'; end if;
  if not exists (
    select 1
    from public.course_instructors course_instructor
    join public.instructors instructor
      on instructor.id = course_instructor.instructor_id
    where course_instructor.course_version_id = target_version
      and instructor.active
      and length(trim(instructor.display_name)) >= 2
      and length(trim(instructor.credentials)) >= 5
  ) then
    raise exception 'ACTIVE_QUALIFIED_INSTRUCTOR_REQUIRED';
  end if;
  if exists (
    select 1 from public.course_materials material
    where material.course_version_id = target_version
      and (
        material.scan_status <> 'safe'
        or material.promoted_object_path is null
      )
  ) then
    raise exception 'COURSE_MATERIAL_NOT_SAFE';
  end if;
  if version_row.delivery_type in ('recorded', 'hybrid')
     and version_row.title not like '%網路課程%'
  then
    raise exception 'RECORDED_TITLE_REQUIREMENT';
  end if;
  if version_row.delivery_type in ('recorded', 'hybrid')
     and exists (
       select 1
       from public.modules module
       join public.lessons lesson on lesson.module_id = module.id
       left join public.lesson_video_versions lvv
         on lvv.lesson_id = lesson.id and lvv.active
       left join public.video_assets asset
         on asset.id = lvv.video_asset_id
       where module.course_version_id = target_version
         and lesson.content_type = 'video'
         and (
           asset.id is null or asset.status <> 'ready'
           or not asset.require_signed_urls
           or asset.master_backup_reference is null
         )
     )
  then
    raise exception 'VIDEO_NOT_READY_OR_BACKED_UP';
  end if;

  select decision.* into decision_row
  from public.course_version_accreditation link
  join public.accreditation_decision_revisions decision
    on decision.id = link.accreditation_revision_id
  where link.course_version_id = target_version
  order by decision.revision desc limit 1;
  if not found
     or decision_row.course_id <> version_row.course_id
     or decision_row.status not in ('applying', 'approved')
     or decision_row.valid_from is null
     or decision_row.valid_until is null
     or (
       decision_row.status = 'applying'
       and coalesce(trim(decision_row.application_reference), '') = ''
     )
     or (
       decision_row.status = 'approved'
       and (
         coalesce(trim(decision_row.approval_reference), '') = ''
         or decision_row.points is null
       )
     )
     or version_row.commerce_close_at >
       decision_row.valid_until - version_row.minimum_completion_window
  then
    raise exception 'ACCREDITATION_WINDOW_INVALID';
  end if;
  if not exists (
    select 1
    from public.organizing_bodies organizer
    join public.accreditation_authorities authority
      on authority.id = decision_row.authority_id
    where organizer.id = decision_row.organizing_body_id
      and organizer.active
      and authority.active
      and organizer.qualification_valid_from
        <= decision_row.valid_from::date
      and (
        organizer.qualification_valid_until is null
        or organizer.qualification_valid_until
          >= decision_row.valid_until::date
      )
      and length(trim(organizer.qualification_reference)) >= 3
      and length(trim(organizer.contact_name)) >= 2
      and length(trim(organizer.contact_email)) >= 3
      and length(trim(authority.submission_method)) >= 3
      and length(trim(authority.contact_name)) >= 2
      and length(trim(authority.contact_email)) >= 3
  ) then
    raise exception 'ACCREDITATION_PARTIES_NOT_QUALIFIED';
  end if;
  if not exists (
    select 1 from public.provider_health health
    where health.provider in ('managed_kms', 'malware_scanner')
      and health.status = 'healthy'
      and health.production_validated_at is not null
    having count(*) = 2
  ) then
    raise exception 'CORE_PROVIDER_HEALTH_REQUIRED';
  end if;
  if version_row.delivery_type in ('recorded', 'hybrid')
     and not exists (
       select 1 from public.provider_health health
       where health.provider = 'cloudflare_stream'
         and health.status = 'healthy'
         and health.production_validated_at is not null
     )
  then
    raise exception 'STREAM_PROVIDER_HEALTH_REQUIRED';
  end if;
  if version_row.delivery_type in ('live', 'hybrid')
     and not exists (
       select 1 from public.provider_health health
       where health.provider in ('zoom_oauth', 'zoom_meeting_sdk')
         and health.status = 'healthy'
         and health.production_validated_at is not null
       having count(*) = 2
     )
  then
    raise exception 'ZOOM_PROVIDER_HEALTH_REQUIRED';
  end if;

  if version_row.delivery_type in ('live', 'hybrid') and exists (
    select 1
    from public.live_sessions session
    where session.course_version_id = target_version
      and (
        session.title not like '%線上同步課程%'
        or session.starts_at < decision_row.valid_from
        or session.ends_at > decision_row.valid_until
        or session.booking_close_at >= session.starts_at
        or session.status <> 'scheduled'
        or session.locked_break_seconds <> coalesce((
          select sum(extract(epoch from
            (formal_break.ends_at - formal_break.starts_at)
          ))::integer
          from public.live_breaks formal_break
          where formal_break.live_session_id = session.id
            and formal_break.locked_at is not null
        ), 0)
        or exists (
          select 1
          from public.live_breaks formal_break
          where formal_break.live_session_id = session.id
            and (
              formal_break.locked_at is null
              or formal_break.starts_at < session.starts_at
              or formal_break.ends_at > session.ends_at
            )
        )
        or (
          select count(*) from public.live_session_assistants assistant
          where assistant.live_session_id = session.id
            and assistant.role in ('assistant', 'cohost')
        ) < internal.required_live_assistants(session.learner_capacity)
        or session.learner_capacity
          > session.verified_zoom_total_capacity
            - session.host_seats - session.cohost_seats
            - session.reserved_support_seats
            - internal.required_live_assistants(session.learner_capacity)
      )
  ) then
    raise exception 'LIVE_SESSION_PUBLICATION_INVALID';
  end if;
  if version_row.delivery_type in ('live', 'hybrid') and (
    not exists (
      select 1 from public.live_sessions session
      where session.course_version_id = target_version
        and session.status = 'scheduled'
    )
    or exists (
      select 1 from public.live_sessions session
      where session.course_version_id = target_version
        and session.status = 'scheduled'
        and (
          not exists (
            select 1 from public.zoom_host_reservations reservation
            where reservation.live_session_id = session.id
              and reservation.status = 'confirmed'
          )
          or not exists (
            select 1 from private.zoom_meetings meeting
            where meeting.live_session_id = session.id
              and meeting.meeting_number <> ''
              and meeting.encrypted_passcode <> '{}'::jsonb
          )
        )
    )
    or (
      version_row.delivery_type = 'hybrid'
      and exists (
        select 1 from public.hybrid_components component
        where component.course_version_id = target_version
          and component.required and component.component_type = 'live'
          and not exists (
            select 1 from public.live_sessions session
            where session.hybrid_component_id = component.id
              and session.status = 'scheduled'
          )
      )
    )
  ) then
    raise exception 'SCHEDULED_LIVE_SESSION_REQUIRED';
  end if;

  if version_row.delivery_type = 'hybrid' then
    select count(*) into component_count
    from public.hybrid_components
    where course_version_id = target_version;
    if component_count < 2 or not exists (
      select 1 from public.hybrid_components
      where course_version_id = target_version and required
        and component_type = 'recorded'
    ) or not exists (
      select 1 from public.hybrid_components
      where course_version_id = target_version and required
        and component_type = 'live'
    ) then
      raise exception 'HYBRID_REQUIRED_COMPONENTS_MISSING';
    end if;
    if exists (
      select 1
      from public.component_prerequisites edge
      join public.hybrid_components source
        on source.id = edge.prerequisite_component_id
      join public.hybrid_components target
        on target.id = edge.dependent_component_id
      where edge.course_version_id = target_version
        and (
          source.course_version_id <> target_version
          or target.course_version_id <> target_version
        )
    ) then
      raise exception 'HYBRID_CROSS_VERSION_EDGE';
    end if;
    with recursive walk(id, path, cycle) as (
      select component.id, array[component.id], false
      from public.hybrid_components component
      where component.course_version_id = target_version
        and not exists (
          select 1 from public.component_prerequisites edge
          where edge.course_version_id = target_version
            and edge.dependent_component_id = component.id
        )
      union all
      select edge.dependent_component_id,
        walk.path || edge.dependent_component_id,
        edge.dependent_component_id = any(walk.path)
      from walk
      join public.component_prerequisites edge
        on edge.prerequisite_component_id = walk.id
        and edge.course_version_id = target_version
      where not walk.cycle
    )
    select count(distinct id) into visited_count from walk where not cycle;
    if visited_count <> component_count then
      raise exception 'HYBRID_GRAPH_CYCLE_OR_UNREACHABLE';
    end if;
  end if;

  update public.course_versions
    set status = 'published', published_by = actor, published_at = now()
    where id = target_version;
  update public.course_requirements set locked_at = now()
    where course_version_id = target_version;
  update public.question_banks set locked_at = now()
    where course_version_id = target_version;
  update public.survey_forms set locked_at = now()
    where course_version_id = target_version;
  insert into public.course_publication_reviews (
    course_version_id, submitted_by, reviewed_by, status,
    checklist, reason, reviewed_at
  ) values (
    target_version, version_row.submitted_by, actor, 'approved',
    jsonb_build_object(
      'questionCount', question_count,
      'accreditationRevision', decision_row.id,
      'legalDocument', version_row.legal_document_id,
      'retentionPolicy', version_row.retention_policy_revision_id
    ),
    review_reason, now()
  );
  perform internal.append_audit_event(
    actor, 'course.published', 'course_version', target_version::text,
    review_reason, null, '{}'::jsonb
  );
  return true;
end
$$;

create or replace function internal.manage_organization_member(
  target_organization uuid,
  target_person uuid,
  submitted_role text,
  submitted_active boolean,
  submitted_employee_number text,
  submitted_department text,
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
  actor_membership public.organization_memberships%rowtype;
  target_membership public.organization_memberships%rowtype;
  prior_event public.organization_member_events%rowtype;
  request_hash text := internal.canonical_request_hash(jsonb_build_object(
    'organizationId', target_organization,
    'personId', target_person,
    'role', submitted_role,
    'active', submitted_active,
    'employeeNumber', trim(coalesce(submitted_employee_number, '')),
    'department', trim(coalesce(submitted_department, '')),
    'reason', trim(coalesce(submitted_reason, ''))
  ));
  next_revision integer;
  result jsonb;
  completed_assignment record;
begin
  select membership.* into actor_membership
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.organization_id
  where membership.organization_id = target_organization
    and membership.person_id = actor
    and membership.active
    and organization.status = 'approved'
  for update of membership;
  if not found
     or actor_membership.role not in ('owner', 'training_manager')
  then raise exception 'ORGANIZATION_MANAGER_REQUIRED'; end if;

  select * into prior_event
  from public.organization_member_events event
  where event.actor_person_id = actor
    and event.idempotency_key = idempotency;
  if found then
    if prior_event.request_hash <> request_hash
    then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object(
      'organizationId', target_organization,
      'personId', target_person,
      'role', prior_event.resulting_role,
      'active', prior_event.resulting_active,
      'lifecycleRevision', prior_event.lifecycle_revision,
      'replayed', true
    );
  end if;

  select * into target_membership
  from public.organization_memberships membership
  where membership.organization_id = target_organization
    and membership.person_id = target_person
  for update;
  if not found
     or submitted_role not in (
       'owner', 'training_manager', 'finance', 'member'
     )
     or length(trim(coalesce(submitted_employee_number, ''))) > 100
     or length(trim(coalesce(submitted_department, ''))) > 100
     or length(trim(coalesce(submitted_reason, ''))) < 10
     or length(trim(coalesce(submitted_reason, ''))) > 2000
     or (
       actor_membership.role = 'training_manager'
       and (
         target_membership.role <> 'member'
         or submitted_role <> 'member'
       )
     )
  then raise exception 'ORGANIZATION_MEMBER_CHANGE_REJECTED'; end if;

  if target_membership.active and not submitted_active then
    if exists (
      select 1
      from public.organization_assignments assignment
      where assignment.organization_id = target_organization
        and assignment.member_person_id = target_person
        and assignment.status in ('reserved', 'active', 'consumed')
    )
    then raise exception 'ACTIVE_OR_UNSETTLED_ASSIGNMENT_BLOCKS_OFFBOARDING';
    end if;
    if exists (
      select 1
      from public.live_bookings booking
      join public.organization_assignments assignment
        on booking.payer_type = 'organization'
       and booking.payer_source_id = assignment.id
      where assignment.organization_id = target_organization
        and assignment.member_person_id = target_person
        and booking.status in ('held', 'confirmed')
    )
    then raise exception 'ACTIVE_LIVE_BOOKING_BLOCKS_OFFBOARDING'; end if;

    next_revision := target_membership.lifecycle_revision + 1;
    for completed_assignment in
      select item.id
      from public.organization_assignments item
      where item.organization_id = target_organization
        and item.member_person_id = target_person
        and item.status = 'completed'
        and internal.organization_assignment_has_consumption_proof(item.id)
        and exists (
          select 1
          from public.entitlements entitlement
          join public.enrollments enrollment
            on enrollment.entitlement_id = entitlement.id
          where entitlement.source_type = 'organization_assignment'
            and entitlement.source_id = item.id
            and entitlement.person_id = item.member_person_id
            and entitlement.course_version_id = item.course_version_id
            and entitlement.status in ('active', 'frozen', 'expired')
            and enrollment.person_id = item.member_person_id
            and enrollment.course_version_id = item.course_version_id
            and enrollment.status in ('completed', 'submitted', 'credited')
            and enrollment.completed_at is not null
        )
      order by item.created_at, item.id
    loop
      insert into public.organization_assignment_outcome_snapshots (
        assignment_id, organization_id, member_person_id,
        membership_lifecycle_revision, outcome, live_attendance,
        visibility_cutoff_at, captured_by
      ) values (
        completed_assignment.id, target_organization, target_person, next_revision,
        coalesce(
          internal.organization_assignment_current_outcome(completed_assignment.id),
          '{}'::jsonb
        ),
        internal.organization_assignment_live_attendance(completed_assignment.id),
        clock_timestamp(), actor
      );
    end loop;
  elsif target_membership.active is distinct from submitted_active then
    next_revision := target_membership.lifecycle_revision + 1;
  else
    next_revision := target_membership.lifecycle_revision;
  end if;

  update public.organization_memberships
  set role = submitted_role,
      active = submitted_active,
      employee_number =
        nullif(trim(coalesce(submitted_employee_number, '')), ''),
      department = nullif(trim(coalesce(submitted_department, '')), ''),
      lifecycle_revision = next_revision,
      left_at = case
        when submitted_active then null
        else coalesce(left_at, clock_timestamp())
      end
  where id = target_membership.id;

  insert into public.organization_member_events (
    organization_id, member_person_id, actor_person_id,
    previous_role, resulting_role, previous_active, resulting_active,
    lifecycle_revision, reason, idempotency_key, request_hash
  ) values (
    target_organization, target_person, actor,
    target_membership.role, submitted_role,
    target_membership.active, submitted_active,
    next_revision, trim(submitted_reason), idempotency, request_hash
  );
  perform internal.append_audit_event(
    actor, 'organization.member_changed', 'organization_membership',
    target_membership.id::text, trim(submitted_reason),
    target_organization,
    jsonb_build_object(
      'previousRole', target_membership.role,
      'resultingRole', submitted_role,
      'previousActive', target_membership.active,
      'resultingActive', submitted_active,
      'lifecycleRevision', next_revision
    )
  );
  result := jsonb_build_object(
    'organizationId', target_organization,
    'personId', target_person,
    'role', submitted_role,
    'active', submitted_active,
    'lifecycleRevision', next_revision,
    'replayed', false
  );
  return result;
end
$$;

create or replace function internal.create_accreditation_submission_batch(
  target_course_version uuid,
  target_accreditation_revision uuid,
  target_live_session uuid,
  submitted_template_version text,
  target_supersedes_batch uuid,
  idempotency uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  created_batch_id uuid;
  version_row public.course_versions%rowtype;
  prior_batch public.accreditation_submission_batches%rowtype;
  existing_batch public.accreditation_submission_batches%rowtype;
begin
  if not internal.has_staff_role('course_admin')
     or length(trim(submitted_template_version)) not between 1 and 100
  then
    raise exception 'ACCREDITATION_BATCH_REJECTED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'suiyue:accreditation-batch-idempotency:' || idempotency::text, 0
  ));
  select * into existing_batch
  from public.accreditation_submission_batches batch
  where batch.application_idempotency_key = idempotency;
  if found then
    if existing_batch.requested_by <> actor
       or existing_batch.course_version_id <> target_course_version
       or existing_batch.accreditation_revision_id
         <> target_accreditation_revision
       or existing_batch.live_session_id
         is distinct from target_live_session
       or existing_batch.supersedes_batch_id
         is distinct from target_supersedes_batch
       or existing_batch.template_version
         <> trim(submitted_template_version)
    then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return existing_batch.id;
  end if;

  select * into version_row
  from public.course_versions version
  where version.id = target_course_version;
  if not found then raise exception 'ACCREDITATION_BATCH_REJECTED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'suiyue:accreditation:' || version_row.course_id::text, 0
  ));
  select * into existing_batch
  from public.accreditation_submission_batches batch
  where batch.application_idempotency_key = idempotency
  for update;
  if found then
    if existing_batch.requested_by <> actor
       or existing_batch.course_version_id <> target_course_version
       or existing_batch.accreditation_revision_id
         <> target_accreditation_revision
       or existing_batch.live_session_id
         is distinct from target_live_session
       or existing_batch.supersedes_batch_id
         is distinct from target_supersedes_batch
       or existing_batch.template_version
         <> trim(submitted_template_version)
    then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return existing_batch.id;
  end if;
  select * into version_row
  from public.course_versions version
  where version.id = target_course_version
    and version.status = 'published'
  for share;
  if not found
     or not internal.accreditation_submission_scope_is_valid(
       target_course_version,
       target_accreditation_revision,
       target_live_session,
       clock_timestamp()
     )
  then raise exception 'ACCREDITATION_BATCH_SCOPE_INVALID'; end if;

  if target_supersedes_batch is not null then
    select * into prior_batch
    from public.accreditation_submission_batches batch
    where batch.id = target_supersedes_batch
    for update;
    if not found
       or prior_batch.status <> 'needs_correction'
       or prior_batch.isolated_at is not null
       or prior_batch.course_version_id <> target_course_version
       or prior_batch.accreditation_revision_id
         <> target_accreditation_revision
       or prior_batch.live_session_id
         is distinct from target_live_session
       or exists (
         select 1
         from public.accreditation_submission_batches child
         where child.supersedes_batch_id = target_supersedes_batch
       )
    then
      raise exception 'ACCREDITATION_CORRECTION_LINEAGE_INVALID';
    end if;
  end if;

  insert into public.accreditation_submission_batches (
    course_version_id, accreditation_revision_id, live_session_id,
    template_version, application_idempotency_key, requested_by,
    supersedes_batch_id
  ) values (
    target_course_version, target_accreditation_revision,
    target_live_session, trim(submitted_template_version),
    idempotency, actor, target_supersedes_batch
  ) returning id into created_batch_id;

  insert into public.accreditation_submission_items (
    batch_id, enrollment_id, eligibility_snapshot_id,
    live_booking_id, status, missing_reasons
  )
  select
    created_batch_id,
    enrollment.id,
    snapshot.id,
    target_booking.id,
    case
      when coalesce(snapshot.eligible, false)
        and (
          (
            target_supersedes_batch is null
            and enrollment.status = 'completed'
            and not exists (
              select 1
              from public.accreditation_submission_claims prior_claim
              where prior_claim.enrollment_id = enrollment.id
                and prior_claim.status in (
                  'active', 'accepted', 'needs_correction', 'rejected'
                )
            )
            and not exists (
              select 1
              from public.accreditation_submission_items prior_item
              where prior_item.enrollment_id = enrollment.id
                and prior_item.status = 'accepted'
            )
          )
          or (
            target_supersedes_batch is not null
            and enrollment.status = 'needs_correction'
            and exists (
              select 1
              from public.accreditation_submission_items prior_item
              join public.accreditation_submission_claims prior_claim
                on prior_claim.batch_id = prior_item.batch_id
               and prior_claim.enrollment_id = prior_item.enrollment_id
              where prior_item.batch_id = target_supersedes_batch
                and prior_item.enrollment_id = enrollment.id
                and prior_item.status = 'needs_correction'
                and prior_claim.status = 'needs_correction'
                and prior_item.live_booking_id
                  is not distinct from target_booking.id
                and prior_claim.live_booking_id
                  is not distinct from target_booking.id
            )
            and not exists (
              select 1
              from public.accreditation_submission_claims competing_claim
              where competing_claim.enrollment_id = enrollment.id
                and competing_claim.status in ('active', 'accepted')
            )
          )
        )
        and not exists (
          select 1
          from public.certificates certificate
          where certificate.enrollment_id = enrollment.id
            and certificate.current_status in ('credited', 'revoked')
        )
        and exists (
          select 1
          from public.certificates certificate
          where certificate.enrollment_id = enrollment.id
            and certificate.current_status in (
              'active', 'needs_correction'
            )
        )
      then 'included'
      else 'excluded'
    end,
    to_jsonb(array_remove(array[
      case when snapshot.id is null
        then 'eligibility_snapshot_missing' end,
      case when snapshot.id is not null and not snapshot.entitlement_valid
        then 'entitlement_invalid' end,
      case when snapshot.id is not null and not snapshot.identity_verified
        then 'identity_unverified' end,
      case when snapshot.id is not null
        and not snapshot.recorded_requirement_met
        then 'recorded_requirement_missing' end,
      case when snapshot.id is not null
        and not snapshot.live_requirements_met
        then 'live_requirement_missing' end,
      case when snapshot.id is not null and not snapshot.quiz_passed
        then 'quiz_not_passed' end,
      case when snapshot.id is not null and not snapshot.survey_completed
        then 'survey_missing' end,
      case when snapshot.id is not null and not snapshot.accreditation_valid
        then 'accreditation_invalid' end,
      case
        when target_supersedes_batch is null
          and enrollment.status <> 'completed'
        then 'enrollment_not_completed'
      end,
      case
        when target_supersedes_batch is not null
          and enrollment.status <> 'needs_correction'
        then 'enrollment_not_waiting_for_correction'
      end,
      case when exists (
        select 1
        from public.accreditation_submission_claims prior_claim
        where prior_claim.enrollment_id = enrollment.id
          and prior_claim.status = 'active'
      ) then 'active_submission_claim_exists' end,
      case when enrollment.status = 'credited'
        or exists (
          select 1
          from public.accreditation_submission_claims prior_claim
          where prior_claim.enrollment_id = enrollment.id
            and prior_claim.status = 'accepted'
        )
        or exists (
          select 1
          from public.accreditation_submission_items prior_item
          where prior_item.enrollment_id = enrollment.id
            and prior_item.status = 'accepted'
        )
      then 'already_credited_or_accepted' end,
      case
        when target_supersedes_batch is null
          and exists (
            select 1
            from public.accreditation_submission_claims prior_claim
            where prior_claim.enrollment_id = enrollment.id
              and prior_claim.status in ('needs_correction', 'rejected')
          )
        then 'prior_submission_requires_lineage'
      end,
      case
        when target_supersedes_batch is not null
          and not exists (
            select 1
            from public.accreditation_submission_items prior_item
            join public.accreditation_submission_claims prior_claim
              on prior_claim.batch_id = prior_item.batch_id
             and prior_claim.enrollment_id = prior_item.enrollment_id
            where prior_item.batch_id = target_supersedes_batch
              and prior_item.enrollment_id = enrollment.id
              and prior_item.status = 'needs_correction'
              and prior_claim.status = 'needs_correction'
              and prior_item.live_booking_id
                is not distinct from target_booking.id
              and prior_claim.live_booking_id
                is not distinct from target_booking.id
          )
        then 'correction_lineage_missing'
      end,
      case when exists (
        select 1
        from public.certificates certificate
        where certificate.enrollment_id = enrollment.id
          and certificate.current_status = 'revoked'
      ) then 'certificate_revoked' end,
      case when not exists (
        select 1
        from public.certificates certificate
        where certificate.enrollment_id = enrollment.id
          and certificate.current_status in (
            'active', 'needs_correction'
          )
      ) then 'certificate_not_submittable' end,
      case when target_live_session is not null
        and target_booking.id is null
        then 'target_live_booking_not_qualified' end
    ], null))
  from public.enrollments enrollment
  left join lateral (
    select eligibility.*
    from public.eligibility_snapshots eligibility
    where eligibility.enrollment_id = enrollment.id
      and eligibility.accreditation_revision_id =
        target_accreditation_revision
    order by eligibility.created_at desc, eligibility.id desc
    limit 1
  ) snapshot on true
  left join lateral (
    select booking.id
    from public.live_bookings booking
    join public.live_sessions session
      on session.id = booking.live_session_id
    join public.attendance_summaries attendance
      on attendance.live_booking_id = booking.id
    where booking.enrollment_id = enrollment.id
      and booking.course_version_id = target_course_version
      and booking.live_session_id = target_live_session
      and booking.status = 'attended'
      and session.course_version_id = target_course_version
      and session.status = 'ended'
      and attendance.qualified
      and attendance.quarantined_at is null
      and booking.id = any(coalesce(
        snapshot.required_live_booking_ids, '{}'::uuid[]
      ))
      and (
        (
          version_row.delivery_type = 'live'
          and booking.live_component_id is null
          and session.hybrid_component_id is null
        )
        or (
          version_row.delivery_type = 'hybrid'
          and booking.live_component_id is not null
          and session.hybrid_component_id = booking.live_component_id
          and exists (
            select 1
            from public.hybrid_components component
            where component.id = booking.live_component_id
              and component.course_version_id = target_course_version
              and component.component_type = 'live'
              and component.required
          )
        )
      )
    order by booking.id
    limit 1
  ) target_booking on target_live_session is not null
  where enrollment.course_version_id = target_course_version
    and (
      target_live_session is null
      or target_booking.id is not null
    )
    and (
      target_supersedes_batch is null
      or exists (
        select 1
        from public.accreditation_submission_items prior_item
        where prior_item.batch_id = target_supersedes_batch
          and prior_item.enrollment_id = enrollment.id
          and prior_item.status = 'needs_correction'
      )
    );

  if not internal.lock_and_validate_accreditation_submission_items(created_batch_id)
  then
    raise exception 'ACCREDITATION_BATCH_ITEM_SCOPE_INVALID';
  end if;

  if target_supersedes_batch is not null then
    perform claim.id
    from public.accreditation_submission_claims claim
    join public.accreditation_submission_items item
      on item.enrollment_id = claim.enrollment_id
     and item.batch_id = created_batch_id
     and item.status = 'included'
    where claim.batch_id = target_supersedes_batch
      and claim.status = 'needs_correction'
    order by claim.enrollment_id
    for update of claim;
    if exists (
      select 1
      from public.accreditation_submission_items item
      where item.batch_id = created_batch_id
        and item.status = 'included'
        and not exists (
          select 1
          from public.accreditation_submission_claims claim
          where claim.batch_id = target_supersedes_batch
            and claim.enrollment_id = item.enrollment_id
            and claim.status = 'needs_correction'
            and claim.live_booking_id
              is not distinct from item.live_booking_id
        )
    ) then
      raise exception 'ACCREDITATION_CORRECTION_CLAIM_MISSING';
    end if;
    insert into public.accreditation_submission_claim_events (
      claim_id, batch_id, previous_status, next_status,
      actor_person_id, reason
    )
    select
      claim.id, claim.batch_id, 'needs_correction', 'superseded',
      actor, 'correction batch superseded the prior claim'
    from public.accreditation_submission_claims claim
    join public.accreditation_submission_items item
      on item.enrollment_id = claim.enrollment_id
     and item.batch_id = created_batch_id
     and item.status = 'included'
    where claim.batch_id = target_supersedes_batch
      and claim.status = 'needs_correction';
    update public.accreditation_submission_claims claim
    set status = 'superseded',
        resolved_at = coalesce(resolved_at, clock_timestamp())
    where claim.batch_id = target_supersedes_batch
      and claim.status = 'needs_correction'
      and exists (
        select 1
        from public.accreditation_submission_items item
        where item.batch_id = created_batch_id
          and item.enrollment_id = claim.enrollment_id
          and item.status = 'included'
          and item.live_booking_id
            is not distinct from claim.live_booking_id
      );
  end if;

  insert into public.accreditation_submission_claims (
    batch_id, enrollment_id, accreditation_revision_id,
    eligibility_snapshot_id, live_booking_id,
    supersedes_claim_id, status
  )
  select
    item.batch_id, item.enrollment_id, target_accreditation_revision,
    item.eligibility_snapshot_id, item.live_booking_id,
    case when target_supersedes_batch is null then null else (
      select claim.id
      from public.accreditation_submission_claims claim
      where claim.batch_id = target_supersedes_batch
        and claim.enrollment_id = item.enrollment_id
        and claim.status = 'superseded'
        and claim.live_booking_id
          is not distinct from item.live_booking_id
    ) end,
    'active'
  from public.accreditation_submission_items item
  where item.batch_id = created_batch_id
    and item.status = 'included'
    and item.eligibility_snapshot_id is not null;

  insert into public.accreditation_submission_claim_events (
    claim_id, batch_id, previous_status, next_status,
    actor_person_id, reason
  )
  select
    claim.id, claim.batch_id, null, 'active',
    actor, case when target_supersedes_batch is null
      then 'eligibility snapshot claimed for a new submission'
      else 'eligibility snapshot claimed for correction resubmission'
    end
  from public.accreditation_submission_claims claim
  where claim.batch_id = created_batch_id;

  perform internal.append_audit_event(
    actor, 'accreditation.batch_created', 'submission_batch',
    created_batch_id::text, case when target_supersedes_batch is null
      then 'eligibility preview and active claims created'
      else 'correction lineage and active claims created'
    end,
    null,
    jsonb_build_object(
      'courseVersionId', target_course_version,
      'liveSessionId', target_live_session,
      'supersedesBatchId', target_supersedes_batch,
      'activeClaimCount', (
        select count(*)
        from public.accreditation_submission_claims claim
        where claim.batch_id = created_batch_id
          and claim.status = 'active'
      )
    )
  );
  return created_batch_id;
end
$$;

create or replace function internal.create_organization_invitation(
  target_organization uuid,
  phone_ciphertext jsonb,
  phone_blind_index text,
  invitation_token_hash text,
  invitation_role text,
  employee_name text,
  employee_number text,
  department text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  invitation_id uuid;
  invitation_expires_at timestamptz;
  actor_role text;
  existing_invitation public.organization_invitations%rowtype;
begin
  select membership.role into actor_role
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.organization_id
  where membership.organization_id = target_organization
    and membership.person_id = actor
    and membership.active
    and organization.status = 'approved'
  for update of membership;
  if actor_role not in ('owner', 'training_manager') then
    raise exception 'ORGANIZATION_MANAGER_REQUIRED';
  end if;
  if phone_blind_index !~ '^[a-f0-9]{64}$'
     or invitation_token_hash !~ '^[a-f0-9]{64}$'
     or invitation_role not in ('training_manager', 'finance', 'member')
     or (actor_role = 'training_manager' and invitation_role <> 'member')
  then
    raise exception 'ORGANIZATION_INVITATION_INVALID';
  end if;
  select * into existing_invitation
  from public.organization_invitations invitation
  where invitation.invited_by = actor
    and invitation.idempotency_key = idempotency
  for update;
  if found then
    if existing_invitation.organization_id <> target_organization
       or existing_invitation.phone_blind_index <> phone_blind_index
       or existing_invitation.role <> invitation_role
    then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object(
      'invitationId', existing_invitation.id,
      'expiresAt', existing_invitation.expires_at
    );
  end if;
  invitation_expires_at := now() + interval '7 days';
  insert into public.organization_invitations (
    organization_id, phone_ciphertext, phone_blind_index, token_hash,
    role, employee_name, employee_number, department, invited_by,
    idempotency_key, expires_at
  ) values (
    target_organization, phone_ciphertext, phone_blind_index,
    invitation_token_hash, invitation_role, nullif(trim(employee_name), ''),
    nullif(trim(employee_number), ''), nullif(trim(department), ''),
    actor, idempotency, invitation_expires_at
  )
  on conflict on constraint
    organization_invitations_organization_id_phone_blind_index_key
  do update set
    phone_ciphertext = excluded.phone_ciphertext,
    token_hash = excluded.token_hash,
    role = excluded.role,
    employee_name = excluded.employee_name,
    employee_number = excluded.employee_number,
    department = excluded.department,
    invited_by = excluded.invited_by,
    idempotency_key = excluded.idempotency_key,
    expires_at = excluded.expires_at,
    accepted_at = null,
    revoked_at = null,
    reversible_phone_purged_at = null,
    created_at = now()
  returning id into invitation_id;
  insert into public.durable_jobs (job_type, business_key, payload)
  values (
    'organization_invitation_sms',
    'organization-invitation:' || invitation_id::text || ':'
      || idempotency::text,
    jsonb_build_object('invitationId', invitation_id)
  );
  perform internal.append_audit_event(
    actor, 'organization.invitation_created', 'organization_invitation',
    invitation_id::text, 'phone invitation', target_organization,
    jsonb_build_object('role', invitation_role)
  );
  return jsonb_build_object(
    'invitationId', invitation_id,
    'expiresAt', invitation_expires_at
  );
end
$$;

create or replace function internal.start_email_verification(
  normalized_email text,
  submitted_code_hmac text,
  request_ip inet
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  input_normalized_email alias for $1;
  actor uuid := internal.current_person_id();
  challenge_id uuid;
  recent_count integer;
begin
  if input_normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+$'
     or submitted_code_hmac !~ '^[a-f0-9]{64}$'
  then
    raise exception 'EMAIL_VERIFICATION_INVALID';
  end if;
  select count(*) into recent_count
  from private.email_verification_challenges challenge
  where challenge.person_id = actor
    and challenge.created_at > now() - interval '1 hour';
  if recent_count >= 5 then raise exception 'EMAIL_VERIFICATION_RATE_LIMIT'; end if;
  update private.email_verification_challenges
  set replaced_at = now()
  where person_id = actor
    and lower(private.email_verification_challenges.normalized_email)
      = lower(input_normalized_email)
    and consumed_at is null
    and replaced_at is null;
  insert into private.email_verification_challenges (
    person_id, normalized_email, code_hmac, expires_at, request_ip
  ) values (
    actor, lower(input_normalized_email),
    submitted_code_hmac,
    now() + interval '10 minutes', request_ip
  ) returning id into challenge_id;
  return challenge_id;
end
$$;

create or replace function internal.confirm_email_verification(
  normalized_email text,
  submitted_code_hmac text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  input_normalized_email alias for $1;
  actor uuid := internal.current_person_id();
  challenge private.email_verification_challenges%rowtype;
begin
  select * into challenge
  from private.email_verification_challenges
  where person_id = actor
    and lower(private.email_verification_challenges.normalized_email)
      = lower(input_normalized_email)
    and consumed_at is null
    and replaced_at is null
  order by created_at desc limit 1
  for update;
  if not found or challenge.expires_at <= now() then
    raise exception 'EMAIL_VERIFICATION_EXPIRED';
  end if;
  if challenge.code_hmac <> submitted_code_hmac then
    update private.email_verification_challenges
    set error_count = error_count + 1,
        replaced_at = case when error_count + 1 >= 5 then now() end
    where id = challenge.id;
    return false;
  end if;
  update private.email_verification_challenges
  set consumed_at = now() where id = challenge.id;
  update public.people
  set verified_email = lower(input_normalized_email),
      email_verified_at = now()
  where id = actor;
  perform internal.append_audit_event(
    actor, 'identity.email_verified', 'person', actor::text,
    'contact email verification', null, '{}'::jsonb
  );
  return true;
end
$$;

create or replace function internal.manage_question_draft(
  target_version uuid,
  submitted_operation text,
  submitted_spec jsonb,
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
  question_id uuid;
  option_id uuid;
  correct_option uuid;
  option_text text;
  option_index integer := 0;
  requested_count integer;
  existing_count integer;
  ordered_item record;
  result jsonb;
  calculated_request_hash text;
begin
  if not internal.has_staff_role('course_admin')
     or submitted_operation not in (
       'question_update', 'question_delete', 'question_reorder'
     )
     or jsonb_typeof(submitted_spec) <> 'object'
  then raise exception 'QUESTION_DRAFT_OPERATION_REJECTED'; end if;
  select bank.id into bank_id
  from public.question_banks bank
  join public.course_versions version
    on version.id = bank.course_version_id
  where bank.course_version_id = target_version
    and bank.locked_at is null
    and version.status = 'draft'
    and (
      version.created_by = actor
      or internal.has_staff_role('platform_admin')
    )
  for update of bank;
  if bank_id is null then raise exception 'QUESTION_BANK_LOCKED'; end if;

  calculated_request_hash := encode(extensions.digest(
    target_version::text || '|' || submitted_operation || '|'
      || submitted_spec::text,
    'sha256'
  ), 'hex');
  insert into public.idempotency_records (
    actor_id, operation, idempotency_key, request_hash, locked_until
  ) values (
    actor, 'question_draft:' || submitted_operation, idempotency,
    calculated_request_hash, clock_timestamp() + interval '1 minute'
  )
  on conflict (actor_id, operation, idempotency_key) do nothing;
  if not found then
    select record.response_body into result
    from public.idempotency_records record
    where record.actor_id = actor
      and record.operation = 'question_draft:' || submitted_operation
      and record.idempotency_key = idempotency
      and record.request_hash = calculated_request_hash
      and record.completed_at is not null;
    if result is null then raise exception 'IDEMPOTENCY_REQUEST_CONFLICT'; end if;
    return result;
  end if;

  if submitted_operation = 'question_update' then
    question_id := (submitted_spec ->> 'questionId')::uuid;
    if length(trim(coalesce(submitted_spec ->> 'prompt', ''))) < 5
       or length(trim(coalesce(submitted_spec ->> 'topic', ''))) < 2
       or length(trim(coalesce(submitted_spec ->> 'explanation', ''))) < 5
       or jsonb_typeof(submitted_spec -> 'options') <> 'array'
       or jsonb_array_length(submitted_spec -> 'options') <> 4
       or coalesce(submitted_spec ->> 'correctIndex', '') !~ '^[0-3]$'
       or not exists (
         select 1 from public.question_versions question
         where question.id = question_id
           and question.question_bank_id = bank_id
           and question.active
       )
    then raise exception 'QUESTION_SPEC_INVALID'; end if;
    update public.question_versions
    set prompt = trim(submitted_spec ->> 'prompt'),
        topic = trim(submitted_spec ->> 'topic'),
        explanation = trim(submitted_spec ->> 'explanation')
    where id = question_id
      and question_bank_id = bank_id
      and active;
    delete from private.question_answer_keys
    where question_version_id = question_id;
    delete from public.question_option_versions
    where question_version_id = question_id;
    for option_text in
      select value #>> '{}'
      from jsonb_array_elements(submitted_spec -> 'options')
    loop
      if length(trim(option_text)) < 1 then
        raise exception 'QUESTION_OPTION_INVALID';
      end if;
      insert into public.question_option_versions (
        question_version_id, stable_option_id, option_text, sort_order
      ) values (
        question_id, gen_random_uuid(), trim(option_text), option_index
      ) returning id into option_id;
      if option_index =
           (submitted_spec ->> 'correctIndex')::integer
      then correct_option := option_id; end if;
      option_index := option_index + 1;
    end loop;
    insert into private.question_answer_keys (
      question_version_id, correct_option_id
    ) values (question_id, correct_option);
    result := jsonb_build_object('questionId', question_id);
  elsif submitted_operation = 'question_delete' then
    question_id := (submitted_spec ->> 'questionId')::uuid;
    if not exists (
      select 1 from public.question_versions question
      where question.id = question_id
        and question.question_bank_id = bank_id
        and question.active
    ) then raise exception 'QUESTION_NOT_FOUND'; end if;
    delete from private.question_answer_keys
    where question_version_id = question_id;
    delete from public.question_option_versions
    where question_version_id = question_id;
    delete from public.question_versions
    where id = question_id and question_bank_id = bank_id;
    result := jsonb_build_object('questionId', question_id);
  else
    if jsonb_typeof(submitted_spec -> 'orderedIds') <> 'array'
    then raise exception 'QUESTION_ORDER_INVALID'; end if;
    requested_count := jsonb_array_length(submitted_spec -> 'orderedIds');
    select count(*) into existing_count
    from public.question_versions question
    where question.question_bank_id = bank_id and question.active;
    if requested_count <> existing_count
       or (
         select count(distinct value #>> '{}')
         from jsonb_array_elements(submitted_spec -> 'orderedIds')
       ) <> existing_count
       or exists (
         select 1
         from jsonb_array_elements(submitted_spec -> 'orderedIds') item
         where not exists (
           select 1 from public.question_versions question
           where question.id = (item.value #>> '{}')::uuid
             and question.question_bank_id = bank_id
             and question.active
         )
       )
    then raise exception 'QUESTION_ORDER_INVALID'; end if;
    update public.question_versions
    set sort_order = sort_order + 1000000
    where question_bank_id = bank_id and active;
    for ordered_item in
      select value #>> '{}' as item_id, ordinality - 1 as position
      from jsonb_array_elements(submitted_spec -> 'orderedIds')
        with ordinality
    loop
      update public.question_versions
      set sort_order = ordered_item.position
      where id = ordered_item.item_id::uuid
        and question_bank_id = bank_id
        and active;
    end loop;
    result := jsonb_build_object(
      'orderedIds', submitted_spec -> 'orderedIds'
    );
  end if;

  update public.idempotency_records
  set response_status = 200,
      response_body = result,
      completed_at = clock_timestamp(),
      locked_until = null
  where actor_id = actor
    and operation = 'question_draft:' || submitted_operation
    and idempotency_key = idempotency;
  perform internal.append_audit_event(
    actor, 'course.' || submitted_operation,
    'course_version', target_version::text,
    'draft-only question authoring', null, result
  );
  return result;
end
$$;

create or replace function internal.author_course_structure(
  target_version uuid,
  submitted_operation text,
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
  calculated_request_hash text;
  result jsonb;
  instructor_id uuid;
  target_module_id uuid;
  created_id uuid;
  target_lesson_id uuid;
  target_instructor_id uuid;
  upload_row public.upload_quarantine%rowtype;
  next_sort integer;
  requested_count integer;
  existing_count integer;
  ordered_item record;
  version_row public.course_versions%rowtype;
  component_spec jsonb;
  hybrid_live_total integer := 0;
  hybrid_recorded_total integer := 0;
  dependency_id text;
begin
  if not internal.has_staff_role('course_admin')
     or submitted_operation not in (
       'instructor', 'lesson', 'material', 'cover',
       'course_update',
       'module_update', 'module_delete', 'module_reorder',
       'lesson_update', 'lesson_delete', 'lesson_reorder',
       'instructor_update', 'instructor_delete', 'instructor_reorder'
     )
     or jsonb_typeof(submitted_spec) <> 'object'
     or not exists (
       select 1 from public.course_versions version
       where version.id = target_version
         and version.status = 'draft'
         and (
           version.created_by = actor
           or internal.has_staff_role('platform_admin')
         )
     )
  then raise exception 'COURSE_STRUCTURE_AUTHORING_REJECTED'; end if;
  calculated_request_hash := encode(
    extensions.digest(
      target_version::text || '|' || submitted_operation || '|'
        || submitted_spec::text,
      'sha256'
    ),
    'hex'
  );
  insert into public.idempotency_records (
    actor_id, operation, idempotency_key, request_hash, locked_until
  ) values (
    actor, 'course_structure:' || submitted_operation, idempotency,
    calculated_request_hash, now() + interval '1 minute'
  )
  on conflict (actor_id, operation, idempotency_key) do nothing;
  if not found then
    select record.response_body into result
    from public.idempotency_records record
    where record.actor_id = actor
      and record.operation = 'course_structure:' || submitted_operation
      and record.idempotency_key = idempotency
      and record.request_hash = calculated_request_hash
      and record.completed_at is not null;
    if result is null then raise exception 'IDEMPOTENCY_REQUEST_CONFLICT'; end if;
    return result;
  end if;
  if submitted_operation = 'course_update' then
    select * into version_row
    from public.course_versions version
    where version.id = target_version
      and version.status = 'draft'
    for update;
    if length(trim(coalesce(submitted_spec ->> 'title', ''))) < 2
       or length(trim(coalesce(submitted_spec ->> 'summary', ''))) < 10
       or length(trim(coalesce(submitted_spec ->> 'description', ''))) < 20
       or jsonb_typeof(submitted_spec -> 'learningObjectives') <> 'array'
       or jsonb_array_length(
         submitted_spec -> 'learningObjectives'
       ) < 1
       or coalesce(submitted_spec ->> 'priceTwd', '') !~ '^[0-9]+$'
       or coalesce(
         submitted_spec ->> 'organizationPointPrice', ''
       ) !~ '^[1-9][0-9]*$'
       or coalesce(
         submitted_spec ->> 'recordedRefundAllocationTwd', ''
       ) !~ '^[0-9]+$'
       or coalesce(
         submitted_spec ->> 'minimumCompletionDays', ''
       ) !~ '^[1-9][0-9]*$'
       or coalesce(
         submitted_spec ->> 'requiredWatchSeconds', ''
       ) !~ '^[0-9]+$'
       or nullif(submitted_spec ->> 'legalDocumentId', '') is null
       or nullif(
         submitted_spec ->> 'retentionPolicyRevisionId', ''
       ) is null
       or nullif(
         submitted_spec ->> 'accreditationRevisionId', ''
       ) is null
       or length(trim(coalesce(
         submitted_spec ->> 'accreditationDisclosure', ''
       ))) < 10
       or nullif(submitted_spec ->> 'commerceCloseAt', '') is null
       or nullif(submitted_spec ->> 'contentAvailableAt', '') is null
    then raise exception 'COURSE_UPDATE_SPEC_INVALID'; end if;
    if not exists (
         select 1 from public.legal_documents legal
         where legal.id =
           (submitted_spec ->> 'legalDocumentId')::uuid
           and legal.approved_by_legal
       )
       or not exists (
         select 1 from public.retention_policy_revisions retention
         where retention.id =
           (submitted_spec ->> 'retentionPolicyRevisionId')::uuid
       )
       or not exists (
         select 1
         from public.accreditation_decision_revisions accreditation
         where accreditation.id =
           (submitted_spec ->> 'accreditationRevisionId')::uuid
           and accreditation.course_id = version_row.course_id
           and accreditation.status in ('applying', 'approved')
       )
    then raise exception 'COURSE_UPDATE_PREREQUISITE_INVALID'; end if;
    if version_row.delivery_type in ('live', 'hybrid')
       and (
         coalesce(
           submitted_spec ->> 'livePresencePercent', ''
         ) !~ '^[0-9]+(?:\.[0-9]+)?$'
         or coalesce(
           submitted_spec ->> 'liveCameraPercent', ''
         ) !~ '^[0-9]+(?:\.[0-9]+)?$'
         or (submitted_spec ->> 'livePresencePercent')::numeric
           not between 80 and 100
         or (submitted_spec ->> 'liveCameraPercent')::numeric
           not between 80 and 100
       )
    then raise exception 'COURSE_LIVE_THRESHOLD_INVALID'; end if;

    if version_row.delivery_type = 'recorded' then
      if (submitted_spec ->> 'recordedRefundAllocationTwd')::integer
           <> (submitted_spec ->> 'priceTwd')::integer
         or (
           submitted_spec ? 'hybridComponents'
           and jsonb_array_length(
             submitted_spec -> 'hybridComponents'
           ) <> 0
         )
      then raise exception 'COURSE_REFUND_ALLOCATION_INVALID'; end if;
    elsif version_row.delivery_type = 'live' then
      if (submitted_spec ->> 'recordedRefundAllocationTwd')::integer <> 0
      then raise exception 'COURSE_REFUND_ALLOCATION_INVALID'; end if;
    else
      if jsonb_typeof(submitted_spec -> 'hybridComponents') <> 'array'
      then raise exception 'HYBRID_COMPONENTS_REQUIRED'; end if;
      requested_count :=
        jsonb_array_length(submitted_spec -> 'hybridComponents');
      select count(*) into existing_count
      from public.hybrid_components component
      where component.course_version_id = target_version;
      if requested_count <> existing_count
         or requested_count < 2
         or (
           select count(distinct item.value ->> 'componentId')
           from jsonb_array_elements(
             submitted_spec -> 'hybridComponents'
           ) item
         ) <> existing_count
         or exists (
           select 1
           from jsonb_array_elements(
             submitted_spec -> 'hybridComponents'
           ) item
           where not exists (
             select 1 from public.hybrid_components component
             where component.id =
                 (item.value ->> 'componentId')::uuid
               and component.course_version_id = target_version
           )
         )
      then raise exception 'HYBRID_COMPONENT_SET_IMMUTABLE'; end if;
      update public.hybrid_components
      set sort_order = sort_order + 1000000
      where course_version_id = target_version;
      for component_spec in
        select value
        from jsonb_array_elements(
          submitted_spec -> 'hybridComponents'
        )
        order by (value ->> 'sortOrder')::integer
      loop
        if length(trim(coalesce(component_spec ->> 'title', ''))) < 2
           or coalesce(
             component_spec ->> 'sortOrder', ''
           ) !~ '^[0-9]+$'
           or coalesce(
             component_spec ->> 'refundAllocationTwd', ''
           ) !~ '^[0-9]+$'
           or jsonb_typeof(
             component_spec -> 'dependsOnComponentIds'
           ) <> 'array'
        then raise exception 'HYBRID_COMPONENT_SPEC_INVALID'; end if;
        update public.hybrid_components component
        set title = trim(component_spec ->> 'title'),
            required = coalesce(
              (component_spec ->> 'required')::boolean, true
            ),
            sort_order = (component_spec ->> 'sortOrder')::integer,
            refund_allocation_twd =
              (component_spec ->> 'refundAllocationTwd')::integer
        where component.id =
            (component_spec ->> 'componentId')::uuid
          and component.course_version_id = target_version;
      end loop;
      delete from public.component_prerequisites
      where course_version_id = target_version;
      for component_spec in
        select value
        from jsonb_array_elements(
          submitted_spec -> 'hybridComponents'
        )
      loop
        for dependency_id in
          select value #>> '{}'
          from jsonb_array_elements(
            component_spec -> 'dependsOnComponentIds'
          )
        loop
          if dependency_id =
               component_spec ->> 'componentId'
             or not exists (
               select 1 from public.hybrid_components component
               where component.id = dependency_id::uuid
                 and component.course_version_id = target_version
             )
          then raise exception 'HYBRID_DEPENDENCY_INVALID'; end if;
          insert into public.component_prerequisites (
            course_version_id, prerequisite_component_id,
            dependent_component_id
          ) values (
            target_version, dependency_id::uuid,
            (component_spec ->> 'componentId')::uuid
          );
        end loop;
      end loop;
      select coalesce(sum(component.refund_allocation_twd), 0)
        into hybrid_live_total
      from public.hybrid_components component
      where component.course_version_id = target_version
        and component.component_type = 'live';
      select coalesce(sum(component.refund_allocation_twd), 0)
        into hybrid_recorded_total
      from public.hybrid_components component
      where component.course_version_id = target_version
        and component.component_type = 'recorded';
      if (submitted_spec ->> 'recordedRefundAllocationTwd')::integer
           + hybrid_live_total
         <> (submitted_spec ->> 'priceTwd')::integer
         or hybrid_recorded_total
           <> (submitted_spec ->> 'recordedRefundAllocationTwd')::integer
      then raise exception 'COURSE_REFUND_ALLOCATION_INVALID'; end if;
    end if;

    update public.course_versions
    set title = trim(submitted_spec ->> 'title'),
        summary = trim(submitted_spec ->> 'summary'),
        description = trim(submitted_spec ->> 'description'),
        learning_objectives = submitted_spec -> 'learningObjectives',
        price_twd = (submitted_spec ->> 'priceTwd')::integer,
        organization_point_price =
          (submitted_spec ->> 'organizationPointPrice')::integer,
        recorded_refund_allocation_twd =
          (submitted_spec ->> 'recordedRefundAllocationTwd')::integer,
        live_refund_allocations = case version_row.delivery_type
          when 'recorded' then '{}'::jsonb
          when 'live' then jsonb_build_object(
            target_version::text,
            (submitted_spec ->> 'priceTwd')::integer
          )
          else coalesce((
            select jsonb_object_agg(
              component.id::text,
              component.refund_allocation_twd
            )
            from public.hybrid_components component
            where component.course_version_id = target_version
              and component.component_type = 'live'
          ), '{}'::jsonb)
        end,
        equipment_requirements = coalesce(
          submitted_spec ->> 'equipmentRequirements', ''
        ),
        legal_document_id =
          (submitted_spec ->> 'legalDocumentId')::uuid,
        retention_policy_revision_id =
          (submitted_spec ->> 'retentionPolicyRevisionId')::uuid,
        minimum_completion_window = (
          (submitted_spec ->> 'minimumCompletionDays') || ' days'
        )::interval,
        commerce_close_at =
          (submitted_spec ->> 'commerceCloseAt')::timestamptz,
        content_available_at =
          (submitted_spec ->> 'contentAvailableAt')::timestamptz
    where id = target_version and status = 'draft';
    update public.course_requirements
    set required_watch_seconds =
          (submitted_spec ->> 'requiredWatchSeconds')::integer,
        live_presence_percent = case
          when version_row.delivery_type in ('live', 'hybrid')
            then (submitted_spec ->> 'livePresencePercent')::numeric
          else null end,
        live_camera_percent = case
          when version_row.delivery_type in ('live', 'hybrid')
            then (submitted_spec ->> 'liveCameraPercent')::numeric
          else null end
    where course_version_id = target_version
      and locked_at is null;
    delete from public.course_version_accreditation
    where course_version_id = target_version;
    insert into public.course_version_accreditation (
      course_version_id, accreditation_revision_id,
      disclosure_snapshot
    ) values (
      target_version,
      (submitted_spec ->> 'accreditationRevisionId')::uuid,
      trim(submitted_spec ->> 'accreditationDisclosure')
    );
    result := jsonb_build_object('courseVersionId', target_version);
  elsif submitted_operation = 'module_update' then
    if length(trim(coalesce(submitted_spec ->> 'title', ''))) < 2
    then raise exception 'MODULE_SPEC_INVALID'; end if;
    update public.modules module
    set title = trim(submitted_spec ->> 'title')
    where module.id = (submitted_spec ->> 'moduleId')::uuid
      and module.course_version_id = target_version
    returning module.id into created_id;
    if created_id is null then raise exception 'MODULE_NOT_FOUND'; end if;
    result := jsonb_build_object('moduleId', created_id);
  elsif submitted_operation = 'module_delete' then
    select module.id into target_module_id
    from public.modules module
    where module.id = (submitted_spec ->> 'moduleId')::uuid
      and module.course_version_id = target_version
    for update;
    if target_module_id is null then raise exception 'MODULE_NOT_FOUND'; end if;
    update public.course_materials material
    set lesson_id = null
    where material.lesson_id in (
      select lesson.id from public.lessons lesson
      where lesson.module_id = target_module_id
    );
    delete from public.lesson_video_versions video
    using public.lessons lesson
    where lesson.id = video.lesson_id
      and lesson.module_id = target_module_id;
    delete from public.lessons lesson
    where lesson.module_id = target_module_id;
    delete from public.modules module where module.id = target_module_id;
    result := jsonb_build_object('moduleId', target_module_id);
  elsif submitted_operation = 'module_reorder' then
    if jsonb_typeof(submitted_spec -> 'orderedIds') <> 'array'
    then raise exception 'MODULE_ORDER_INVALID'; end if;
    requested_count := jsonb_array_length(submitted_spec -> 'orderedIds');
    select count(*) into existing_count
    from public.modules module
    where module.course_version_id = target_version;
    if requested_count <> existing_count
       or (
         select count(distinct value #>> '{}')
         from jsonb_array_elements(submitted_spec -> 'orderedIds')
       ) <> existing_count
       or exists (
         select 1
         from jsonb_array_elements(submitted_spec -> 'orderedIds') item
         where not exists (
           select 1 from public.modules module
           where module.id = (item.value #>> '{}')::uuid
             and module.course_version_id = target_version
         )
       )
    then raise exception 'MODULE_ORDER_INVALID'; end if;
    update public.modules
    set sort_order = sort_order + 1000000
    where course_version_id = target_version;
    for ordered_item in
      select value #>> '{}' as item_id, ordinality - 1 as position
      from jsonb_array_elements(submitted_spec -> 'orderedIds')
        with ordinality
    loop
      update public.modules
      set sort_order = ordered_item.position
      where id = ordered_item.item_id::uuid
        and course_version_id = target_version;
    end loop;
    result := jsonb_build_object(
      'orderedIds', submitted_spec -> 'orderedIds'
    );
  elsif submitted_operation = 'lesson_update' then
    if length(trim(coalesce(submitted_spec ->> 'title', ''))) < 2
       or submitted_spec ->> 'contentType'
         not in ('video', 'material', 'quiz', 'survey')
    then raise exception 'LESSON_SPEC_INVALID'; end if;
    update public.lessons lesson
    set title = trim(submitted_spec ->> 'title'),
        content_type = submitted_spec ->> 'contentType',
        preview = coalesce(
          (submitted_spec ->> 'preview')::boolean, false
        )
    from public.modules module
    where lesson.id = (submitted_spec ->> 'lessonId')::uuid
      and module.id = lesson.module_id
      and module.course_version_id = target_version
    returning lesson.id into created_id;
    if created_id is null then raise exception 'LESSON_NOT_FOUND'; end if;
    result := jsonb_build_object('lessonId', created_id);
  elsif submitted_operation = 'lesson_delete' then
    select lesson.id into target_lesson_id
    from public.lessons lesson
    join public.modules module on module.id = lesson.module_id
    where lesson.id = (submitted_spec ->> 'lessonId')::uuid
      and module.course_version_id = target_version
    for update of lesson;
    if target_lesson_id is null then raise exception 'LESSON_NOT_FOUND'; end if;
    update public.course_materials
    set lesson_id = null where lesson_id = target_lesson_id;
    delete from public.lesson_video_versions
    where lesson_id = target_lesson_id;
    delete from public.lessons where id = target_lesson_id;
    result := jsonb_build_object('lessonId', target_lesson_id);
  elsif submitted_operation = 'lesson_reorder' then
    target_module_id := (submitted_spec ->> 'moduleId')::uuid;
    if jsonb_typeof(submitted_spec -> 'orderedIds') <> 'array'
       or not exists (
         select 1 from public.modules module
         where module.id = target_module_id
           and module.course_version_id = target_version
       )
    then raise exception 'LESSON_ORDER_INVALID'; end if;
    requested_count := jsonb_array_length(submitted_spec -> 'orderedIds');
    select count(*) into existing_count
    from public.lessons lesson
    where lesson.module_id = target_module_id;
    if requested_count <> existing_count
       or (
         select count(distinct value #>> '{}')
         from jsonb_array_elements(submitted_spec -> 'orderedIds')
       ) <> existing_count
       or exists (
         select 1
         from jsonb_array_elements(submitted_spec -> 'orderedIds') item
         where not exists (
           select 1 from public.lessons lesson
           where lesson.id = (item.value #>> '{}')::uuid
             and lesson.module_id = target_module_id
         )
       )
    then raise exception 'LESSON_ORDER_INVALID'; end if;
    update public.lessons
    set sort_order = sort_order + 1000000
    where module_id = target_module_id;
    for ordered_item in
      select value #>> '{}' as item_id, ordinality - 1 as position
      from jsonb_array_elements(submitted_spec -> 'orderedIds')
        with ordinality
    loop
      update public.lessons
      set sort_order = ordered_item.position
      where id = ordered_item.item_id::uuid
        and module_id = target_module_id;
    end loop;
    result := jsonb_build_object(
      'moduleId', target_module_id,
      'orderedIds', submitted_spec -> 'orderedIds'
    );
  elsif submitted_operation = 'instructor_update' then
    target_instructor_id :=
      (submitted_spec ->> 'instructorId')::uuid;
    if length(trim(coalesce(submitted_spec ->> 'displayName', ''))) < 2
       or length(trim(coalesce(submitted_spec ->> 'biography', ''))) < 10
       or length(trim(coalesce(submitted_spec ->> 'credentials', ''))) < 5
       or not exists (
         select 1 from public.course_instructors link
         where link.course_version_id = target_version
           and link.instructor_id = target_instructor_id
       )
       or exists (
         select 1
         from public.course_instructors link
         join public.course_versions version
           on version.id = link.course_version_id
         where link.instructor_id = target_instructor_id
           and version.id <> target_version
           and version.status <> 'draft'
       )
    then raise exception 'INSTRUCTOR_PROFILE_IMMUTABLE'; end if;
    update public.instructors
    set display_name = trim(submitted_spec ->> 'displayName'),
        biography = trim(submitted_spec ->> 'biography'),
        credentials = trim(submitted_spec ->> 'credentials')
    where id = target_instructor_id;
    result := jsonb_build_object('instructorId', target_instructor_id);
  elsif submitted_operation = 'instructor_delete' then
    target_instructor_id :=
      (submitted_spec ->> 'instructorId')::uuid;
    delete from public.course_instructors
    where course_version_id = target_version
      and instructor_id = target_instructor_id;
    if not found then raise exception 'INSTRUCTOR_NOT_FOUND'; end if;
    result := jsonb_build_object('instructorId', target_instructor_id);
  elsif submitted_operation = 'instructor_reorder' then
    if jsonb_typeof(submitted_spec -> 'orderedIds') <> 'array'
    then raise exception 'INSTRUCTOR_ORDER_INVALID'; end if;
    requested_count := jsonb_array_length(submitted_spec -> 'orderedIds');
    select count(*) into existing_count
    from public.course_instructors link
    where link.course_version_id = target_version;
    if requested_count <> existing_count
       or (
         select count(distinct value #>> '{}')
         from jsonb_array_elements(submitted_spec -> 'orderedIds')
       ) <> existing_count
       or exists (
         select 1
         from jsonb_array_elements(submitted_spec -> 'orderedIds') item
         where not exists (
           select 1 from public.course_instructors link
           where link.instructor_id = (item.value #>> '{}')::uuid
             and link.course_version_id = target_version
         )
       )
    then raise exception 'INSTRUCTOR_ORDER_INVALID'; end if;
    update public.course_instructors
    set sort_order = sort_order + 1000000
    where course_version_id = target_version;
    for ordered_item in
      select value #>> '{}' as item_id, ordinality - 1 as position
      from jsonb_array_elements(submitted_spec -> 'orderedIds')
        with ordinality
    loop
      update public.course_instructors
      set sort_order = ordered_item.position
      where instructor_id = ordered_item.item_id::uuid
        and course_version_id = target_version;
    end loop;
    result := jsonb_build_object(
      'orderedIds', submitted_spec -> 'orderedIds'
    );
  elsif submitted_operation = 'instructor' then
    if length(trim(coalesce(submitted_spec ->> 'displayName', ''))) < 2
       or length(trim(coalesce(submitted_spec ->> 'biography', ''))) < 10
       or length(trim(coalesce(submitted_spec ->> 'credentials', ''))) < 5
       or (
         submitted_spec ->> 'personId' is not null
         and not exists (
           select 1 from public.people person
           where person.id = (submitted_spec ->> 'personId')::uuid
             and person.anonymized_at is null
         )
       )
    then raise exception 'INSTRUCTOR_PROFILE_INVALID'; end if;
    insert into public.instructors (
      person_id, display_name, biography, credentials
    ) values (
      (submitted_spec ->> 'personId')::uuid,
      trim(submitted_spec ->> 'displayName'),
      trim(submitted_spec ->> 'biography'),
      trim(submitted_spec ->> 'credentials')
    ) returning id into instructor_id;
    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.course_instructors where course_version_id = target_version;
    insert into public.course_instructors (
      course_version_id, instructor_id, sort_order
    ) values (target_version, instructor_id, next_sort);
    result := jsonb_build_object('instructorId', instructor_id);
  elsif submitted_operation = 'lesson' then
    if length(trim(coalesce(submitted_spec ->> 'lessonTitle', ''))) < 2
       or submitted_spec ->> 'contentType'
         not in ('video', 'material', 'quiz', 'survey')
    then raise exception 'LESSON_SPEC_INVALID'; end if;
    if submitted_spec ->> 'moduleId' is null then
      if length(trim(coalesce(submitted_spec ->> 'moduleTitle', ''))) < 2
      then raise exception 'MODULE_TITLE_REQUIRED'; end if;
      select coalesce(max(sort_order), -1) + 1 into next_sort
      from public.modules where course_version_id = target_version;
      insert into public.modules (
        course_version_id, title, sort_order
      ) values (
        target_version, trim(submitted_spec ->> 'moduleTitle'), next_sort
      ) returning id into target_module_id;
    else
      select module.id into target_module_id from public.modules module
      where module.id = (submitted_spec ->> 'moduleId')::uuid
        and module.course_version_id = target_version;
      if target_module_id is null then raise exception 'MODULE_NOT_FOUND'; end if;
    end if;
    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.lessons lesson
    where lesson.module_id = target_module_id;
    insert into public.lessons (
      module_id, title, content_type, preview, sort_order
    ) values (
      target_module_id, trim(submitted_spec ->> 'lessonTitle'),
      submitted_spec ->> 'contentType',
      coalesce((submitted_spec ->> 'preview')::boolean, false),
      next_sort
    ) returning id into created_id;
    result := jsonb_build_object(
      'moduleId', target_module_id, 'lessonId', created_id
    );
  else
    select * into upload_row from public.upload_quarantine upload
    where upload.id = (submitted_spec ->> 'uploadId')::uuid
      and upload.owner_person_id = actor
      and upload.purpose = 'course_material'
      and upload.status = 'promoted'
    for update;
    if not found then raise exception 'SAFE_COURSE_UPLOAD_REQUIRED'; end if;
    if submitted_operation = 'cover' then
      if upload_row.detected_mime not in ('image/jpeg', 'image/png')
      then raise exception 'COURSE_COVER_IMAGE_REQUIRED'; end if;
      update public.course_versions
      set cover_path = upload_row.promoted_object_path,
          has_cover = true
      where id = target_version and status = 'draft';
      result := jsonb_build_object(
        'coverPath', upload_row.promoted_object_path
      );
    else
      if length(trim(coalesce(submitted_spec ->> 'title', ''))) < 2
         or (
           submitted_spec ->> 'lessonId' is not null
           and not exists (
             select 1
             from public.lessons lesson
             join public.modules module on module.id = lesson.module_id
             where lesson.id = (submitted_spec ->> 'lessonId')::uuid
               and module.course_version_id = target_version
           )
         )
      then raise exception 'COURSE_MATERIAL_SPEC_INVALID'; end if;
      insert into public.course_materials (
        course_version_id, lesson_id, title, quarantine_object_path,
        promoted_object_path, scan_status, content_sha256, created_by
      ) values (
        target_version, (submitted_spec ->> 'lessonId')::uuid,
        trim(submitted_spec ->> 'title'), upload_row.object_path,
        upload_row.promoted_object_path, 'safe',
        upload_row.content_sha256, actor
      ) returning id into created_id;
      result := jsonb_build_object('courseMaterialId', created_id);
    end if;
  end if;
  update public.idempotency_records
  set response_status = 200, response_body = result,
      completed_at = now(), locked_until = null
  where actor_id = actor
    and operation = 'course_structure:' || submitted_operation
    and idempotency_key = idempotency;
  perform internal.append_audit_event(
    actor, 'course.' || submitted_operation || '_authored',
    'course_version', target_version::text,
    'draft-only versioned course authoring', null, result
  );
  return result;
end
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
  refundable_order record;
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

    for refundable_order in
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
      where refund.order_id = refundable_order.id
        and refund.status not in ('rejected', 'failed');
      remaining_refund := greatest(
        refundable_order.amount_paid_twd - prior_refund, 0
      );
      if remaining_refund > 0 then
        refund_case_id := gen_random_uuid();
        select item.id into order_item_id
        from public.order_items item
        where item.order_id = refundable_order.id
        order by item.created_at, item.id
        limit 1;
        insert into public.refund_cases (
          id, order_id, requested_by, status, basis, reason,
          account_details_ciphertext, usage_snapshot, idempotency_key
        ) values (
          refund_case_id, refundable_order.id, refundable_order.person_id, 'submitted',
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
            'amountPaidTwd', refundable_order.amount_paid_twd,
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

revoke all on function internal.publish_course_version(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function internal.publish_course_version(uuid, text, text)
  to authenticated;

revoke all on function internal.manage_organization_member(
  uuid, uuid, text, boolean, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.manage_organization_member(
  uuid, uuid, text, boolean, text, text, text, uuid
) to authenticated;

revoke all on function internal.create_accreditation_submission_batch(
  uuid, uuid, uuid, text, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.create_accreditation_submission_batch(
  uuid, uuid, uuid, text, uuid, uuid
) to authenticated;

revoke all on function internal.create_organization_invitation(
  uuid, jsonb, text, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.create_organization_invitation(
  uuid, jsonb, text, text, text, text, text, text, uuid
) to authenticated;

revoke all on function internal.start_email_verification(text, text, inet)
  from public, anon, authenticated, service_role;
grant execute on function internal.start_email_verification(text, text, inet)
  to authenticated;

revoke all on function internal.confirm_email_verification(text, text)
  from public, anon, authenticated, service_role;
grant execute on function internal.confirm_email_verification(text, text)
  to authenticated;

revoke all on function internal.manage_question_draft(
  uuid, text, jsonb, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.manage_question_draft(
  uuid, text, jsonb, uuid
) to authenticated;

revoke all on function internal.author_course_structure(
  uuid, text, jsonb, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.author_course_structure(
  uuid, text, jsonb, uuid
) to authenticated;

revoke all on function internal.apply_accreditation_transition_effects(
  uuid, uuid
) from public, anon, authenticated, service_role;
