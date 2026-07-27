-- Forward-only runtime lint correction for course instructor authoring.
-- Keep the already-applied 238200 migration immutable. Rebuild the current
-- function definition only when every expected identifier is present exactly
-- once, so an unexpected upstream definition fails closed.

do $migration$
declare
  target_function regprocedure :=
    to_regprocedure(
      'internal.author_course_structure(uuid,text,jsonb,uuid)'
    );
  function_definition text;
  updated_definition text;
  old_needles constant text[] := array[
    E'\n  instructor_id uuid;',
    ') returning id into instructor_id;',
    ') values (target_version, instructor_id, next_sort);',
    'result := jsonb_build_object(''instructorId'', instructor_id);'
  ];
  new_needles constant text[] := array[
    E'\n  created_instructor_id uuid;',
    ') returning id into created_instructor_id;',
    ') values (target_version, created_instructor_id, next_sort);',
    'result := jsonb_build_object(''instructorId'', created_instructor_id);'
  ];
  needle_index integer;
  old_count integer;
  new_count integer;
  old_total integer := 0;
  is_security_definer boolean;
  function_config text[];
begin
  if target_function is null then
    raise exception
      'EXPECTED_FUNCTION_MISSING: internal.author_course_structure';
  end if;

  select
    pg_get_functiondef(function.oid),
    function.prosecdef,
    function.proconfig
  into
    function_definition,
    is_security_definer,
    function_config
  from pg_proc function
  where function.oid = target_function;

  if not is_security_definer
     or not coalesce(
       function_config @> array['search_path=pg_catalog, public'],
       false
     )
  then
    raise exception
      'FUNCTION_SECURITY_CONTRACT_CHANGED: internal.author_course_structure';
  end if;

  for needle_index in 1..array_length(old_needles, 1)
  loop
    old_count :=
      (
        length(function_definition)
        - length(replace(
          function_definition,
          old_needles[needle_index],
          ''
        ))
      ) / length(old_needles[needle_index]);
    new_count :=
      (
        length(function_definition)
        - length(replace(
          function_definition,
          new_needles[needle_index],
          ''
        ))
      ) / length(new_needles[needle_index]);

    if old_count not in (0, 1)
       or new_count not in (0, 1)
       or old_count + new_count <> 1
    then
      raise exception
        'COURSE_INSTRUCTOR_IDENTIFIER_GUARD_FAILED at replacement %',
        needle_index;
    end if;
    old_total := old_total + old_count;
  end loop;

  if old_total not in (0, array_length(old_needles, 1)) then
    raise exception
      'COURSE_INSTRUCTOR_IDENTIFIER_PARTIAL_STATE';
  end if;

  if old_total = array_length(old_needles, 1) then
    updated_definition := function_definition;
    for needle_index in 1..array_length(old_needles, 1)
    loop
      updated_definition := replace(
        updated_definition,
        old_needles[needle_index],
        new_needles[needle_index]
      );
    end loop;
    execute updated_definition;
  end if;
end
$migration$;

revoke all on function internal.author_course_structure(
  uuid, text, jsonb, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.author_course_structure(
  uuid, text, jsonb, uuid
) to authenticated;
