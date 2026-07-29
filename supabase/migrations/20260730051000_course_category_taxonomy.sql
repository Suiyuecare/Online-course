-- Make the eight learner-facing course topics authoritative for formal
-- course versions. Category codes are stable API identifiers; translated
-- labels remain presentation data and can change without breaking links.

create table public.course_categories (
  code text primary key check (
    code in (
      'career_foundations',
      'daily_care_skills',
      'complex_care_needs',
      'rehabilitation_home_end_of_life',
      'quality_safety_infection',
      'communication_supervision_management',
      'ethics_rights_cultural_safety',
      'policy_law_workplace_rights'
    )
  ),
  title text not null unique check (length(trim(title)) between 2 and 100),
  description text not null check (
    length(trim(description)) between 10 and 500
  ),
  short_label text not null unique check (
    length(trim(short_label)) between 2 and 30
  ),
  sort_order smallint not null unique check (sort_order between 1 and 8),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.course_categories (
  code, title, description, short_label, sort_order
) values
  (
    'career_foundations',
    '入門、資格與職涯進階',
    '共同訓練、照服員資格，以及居督、照管與個管進階。',
    '入門進階',
    1
  ),
  (
    'daily_care_skills',
    '日常照護與專業技能',
    '營養吞嚥、移位輔具、足部照護、管路與急救技能。',
    '照護技能',
    2
  ),
  (
    'complex_care_needs',
    '失智、身障與特殊需求',
    '失智照護、身障支持、精神照護與家庭照顧者支持。',
    '特殊需求',
    3
  ),
  (
    'rehabilitation_home_end_of_life',
    '復能、居家醫療與善終',
    '復能、延緩失能、居家醫療、安寧與預立醫療。',
    '復能善終',
    4
  ),
  (
    'quality_safety_infection',
    '品質、安全與感染管制',
    '感染、消防、緊急應變、風險管理與職業安全。',
    '品質安全',
    5
  ),
  (
    'communication_supervision_management',
    '溝通、督導與服務管理',
    '跨專業溝通、個案管理、人力督導與資源連結。',
    '督導管理',
    6
  ),
  (
    'ethics_rights_cultural_safety',
    '倫理、人權與文化安全',
    '尊嚴隱私、性別敏感度、原民與多元文化安全。',
    '倫理人權',
    7
  ),
  (
    'policy_law_workplace_rights',
    '政策法規與職場權益',
    '長照法規、個資、消保、勞權與職場安全規範。',
    '政策法規',
    8
  );

alter table public.course_categories enable row level security;
alter table public.course_categories force row level security;

create policy active_course_categories_read
on public.course_categories
for select
to anon, authenticated
using (active);

revoke all on table public.course_categories
  from public, anon, authenticated, service_role;
grant select (
  code, title, description, short_label, sort_order, active
) on public.course_categories
  to anon, authenticated, service_role;

alter table public.course_versions
  add column category_code text
    references public.course_categories(code)
    on update restrict
    on delete restrict;

alter table public.course_versions
  add constraint course_versions_published_category_check
  check (status <> 'published' or category_code is not null);

create index course_versions_category_code_idx
  on public.course_versions(category_code)
  where category_code is not null;

grant select (category_code)
  on public.course_versions to anon, authenticated;

-- Keep the existing draft-authoring implementation intact and place a narrow
-- atomic category guard around it. The original internal capability is no
-- longer directly executable by API roles.
create or replace function internal.create_course_draft_with_category(
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
  category text := submitted_spec ->> 'categoryCode';
  result jsonb;
  target_version uuid;
  previous_category text;
begin
  if category is null
     or not exists (
       select 1
       from public.course_categories candidate
       where candidate.code = category
         and candidate.active
     )
  then
    raise exception 'COURSE_CATEGORY_INVALID';
  end if;

  result := internal.create_course_draft(submitted_spec, idempotency);
  target_version := (result ->> 'courseVersionId')::uuid;

  select version.category_code
    into previous_category
  from public.course_versions version
  where version.id = target_version
  for update;

  if not found then
    raise exception 'COURSE_DRAFT_NOT_FOUND';
  end if;
  if previous_category is not null and previous_category <> category then
    raise exception 'IDEMPOTENCY_REQUEST_CONFLICT';
  end if;
  if previous_category is null then
    update public.course_versions
    set category_code = category
    where id = target_version
      and status = 'draft';
    if not found then
      raise exception 'COURSE_DRAFT_CATEGORY_REJECTED';
    end if;
    perform internal.append_audit_event(
      actor,
      'course.category_assigned',
      'course_version',
      target_version::text,
      'controlled taxonomy category assigned to draft',
      null,
      jsonb_build_object('categoryCode', category)
    );
  end if;

  return result;
end
$$;

revoke all on function internal.create_course_draft(jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function internal.create_course_draft_with_category(jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.create_course_draft_with_category(
  jsonb, uuid
) to authenticated;

create or replace function public.create_course_draft(
  p_spec jsonb,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.create_course_draft_with_category(
    p_spec, p_idempotency_key
  )
$$;

revoke all on function public.create_course_draft(jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_course_draft(jsonb, uuid)
  to authenticated;

create or replace function internal.author_course_structure_with_category(
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
  category text := submitted_spec ->> 'categoryCode';
  result jsonb;
  previous_category text;
begin
  if submitted_operation = 'course_update'
     and (
       category is null
       or not exists (
         select 1
         from public.course_categories candidate
         where candidate.code = category
           and candidate.active
       )
     )
  then
    raise exception 'COURSE_CATEGORY_INVALID';
  end if;

  result := internal.author_course_structure(
    target_version, submitted_operation, submitted_spec, idempotency
  );

  if submitted_operation = 'course_update' then
    select version.category_code
      into previous_category
    from public.course_versions version
    where version.id = target_version
      and version.status = 'draft'
    for update;
    if not found then
      raise exception 'COURSE_DRAFT_CATEGORY_REJECTED';
    end if;
    if previous_category is distinct from category then
      update public.course_versions
      set category_code = category
      where id = target_version
        and status = 'draft';
      perform internal.append_audit_event(
        actor,
        'course.category_changed',
        'course_version',
        target_version::text,
        'controlled taxonomy category changed on draft',
        null,
        jsonb_build_object(
          'previousCategoryCode', previous_category,
          'categoryCode', category
        )
      );
    end if;
  end if;

  return result;
end
$$;

revoke all on function internal.author_course_structure(
  uuid, text, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function internal.author_course_structure_with_category(
  uuid, text, jsonb, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.author_course_structure_with_category(
  uuid, text, jsonb, uuid
) to authenticated;

create or replace function public.author_course_structure(
  p_course_version_id uuid,
  p_operation text,
  p_spec jsonb,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.author_course_structure_with_category(
    p_course_version_id, p_operation, p_spec, p_idempotency_key
  )
$$;

revoke all on function public.author_course_structure(
  uuid, text, jsonb, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.author_course_structure(
  uuid, text, jsonb, uuid
) to authenticated;

create or replace function internal.read_course_category_workspace()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  is_platform_admin boolean := internal.has_staff_role('platform_admin');
begin
  if not internal.has_staff_role('course_admin')
     and not is_platform_admin
  then
    raise exception 'COURSE_ADMIN_REQUIRED';
  end if;

  return jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', category.code,
        'title', category.title,
        'description', category.description,
        'shortLabel', category.short_label,
        'sortOrder', category.sort_order
      ) order by category.sort_order)
      from public.course_categories category
      where category.active
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'courseVersionId', version.id,
        'categoryCode', version.category_code
      ) order by version.title, version.version, version.id)
      from public.course_versions version
      where version.status = 'draft'
        and (
          is_platform_admin
          or version.created_by = actor
        )
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function internal.read_course_category_workspace()
  from public, anon, authenticated, service_role;
grant execute on function internal.read_course_category_workspace()
  to authenticated;

create or replace function public.read_course_category_workspace()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_course_category_workspace()
$$;

revoke all on function public.read_course_category_workspace()
  from public, anon, authenticated, service_role;
grant execute on function public.read_course_category_workspace()
  to authenticated;

-- Append the category projection to the existing view signature so
-- CREATE OR REPLACE remains forward-compatible for API clients.
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
  category.title as category_title
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
    candidate.minimum_completion_window
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
join lateral (
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

revoke all on public.published_course_catalog
  from public, anon, authenticated, service_role;
grant select on public.published_course_catalog
  to anon, authenticated, service_role;
