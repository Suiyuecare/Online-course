-- Restore the anonymous catalog without broadening browser table or schema
-- privileges. The catalog view remains a security-invoker projection over
-- explicitly granted columns. Two public RPC facades run as a dedicated
-- no-login capability role whose only privileged operation is invoking the
-- corresponding internal reader.

do $roles$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'suiyue_catalog_owner'
  ) then
    create role suiyue_catalog_owner nologin noinherit;
  elsif exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'suiyue_catalog_owner'
      and (
        rolcanlogin
        or rolinherit
        or rolsuper
        or rolcreaterole
        or rolcreatedb
        or rolreplication
        or rolbypassrls
      )
  ) or exists (
    select 1
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles member_role
      on member_role.oid = membership.member
    where member_role.rolname = 'suiyue_catalog_owner'
  ) or exists (
    select 1
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles granted_role
      on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles member_role
      on member_role.oid = membership.member
    where granted_role.rolname = 'suiyue_catalog_owner'
      and (
        member_role.rolname <> 'postgres'
        or membership.admin_option
      )
  ) then
    raise exception 'SUIYUE_CATALOG_OWNER_SECURITY_CONTRACT_CHANGED';
  end if;
end
$roles$;

grant suiyue_catalog_owner to postgres;

revoke all privileges on all tables in schema public
  from suiyue_catalog_owner;
revoke all privileges on all sequences in schema public
  from suiyue_catalog_owner;
revoke all on schema public, internal from suiyue_catalog_owner;
grant usage on schema public, internal to suiyue_catalog_owner;

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
  ) as first_live_starts_at
from public.courses course
join lateral (
  select
    candidate.id,
    candidate.title,
    candidate.summary,
    candidate.description,
    candidate.learning_objectives,
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

revoke all on function internal.read_public_course_outline(uuid)
  from public, anon, authenticated, service_role;
revoke all on function internal.read_public_course_readiness(uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.read_public_course_outline(uuid)
  to suiyue_catalog_owner;
grant execute on function internal.read_public_course_readiness(uuid)
  to suiyue_catalog_owner;

grant create on schema public to suiyue_catalog_owner;

create or replace function public.read_public_course_outline(
  p_course_version_id uuid
)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, internal
as $$
  select internal.read_public_course_outline(p_course_version_id)
$$;

alter function public.read_public_course_outline(uuid)
  owner to suiyue_catalog_owner;

create or replace function public.read_public_course_readiness(
  p_course_version_id uuid
)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, internal
as $$
  select internal.read_public_course_readiness(p_course_version_id)
$$;

alter function public.read_public_course_readiness(uuid)
  owner to suiyue_catalog_owner;

revoke create on schema public from suiyue_catalog_owner;

revoke all on function public.read_public_course_outline(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.read_public_course_readiness(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_public_course_outline(uuid)
  to anon, authenticated;
grant execute on function public.read_public_course_readiness(uuid)
  to anon, authenticated;
