-- The category assignment migration called the append-only audit helper with
-- two jsonb snapshots. Its current contract accepts an optional organization
-- id followed by one details payload. Recreate the wrapper with the correct
-- signature; no course data changed while launch switches remained closed.

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

revoke all on function internal.author_course_structure_with_category(
  uuid, text, jsonb, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.author_course_structure_with_category(
  uuid, text, jsonb, uuid
) to authenticated;
