begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(20);

select extensions.results_eq(
  $$
    select count(*)::bigint
    from public.course_categories
    where active
  $$,
  $$values (8::bigint)$$,
  'the controlled taxonomy contains exactly eight active categories'
);

select extensions.results_eq(
  $$
    select code
    from public.course_categories
    order by sort_order
  $$,
  $$
    values
      ('career_foundations'::text),
      ('daily_care_skills'::text),
      ('complex_care_needs'::text),
      ('rehabilitation_home_end_of_life'::text),
      ('quality_safety_infection'::text),
      ('communication_supervision_management'::text),
      ('ethics_rights_cultural_safety'::text),
      ('policy_law_workplace_rights'::text)
  $$,
  'category codes and display order are stable'
);

select extensions.results_eq(
  $$
    select array_agg(sort_order order by sort_order)
    from public.course_categories
  $$,
  $$values (array[1,2,3,4,5,6,7,8]::smallint[])$$,
  'the eight categories have one deterministic display position each'
);

select extensions.ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'course_categories'
  ),
  'the category table enables and forces RLS'
);

select extensions.ok(
  has_column_privilege(
    'anon', 'public.course_categories', 'code', 'select'
  )
  and has_column_privilege(
    'anon', 'public.course_categories', 'title', 'select'
  )
  and has_column_privilege(
    'anon', 'public.course_categories', 'description', 'select'
  )
  and has_column_privilege(
    'anon', 'public.course_categories', 'short_label', 'select'
  )
  and has_column_privilege(
    'anon', 'public.course_categories', 'sort_order', 'select'
  )
  and has_column_privilege(
    'anon', 'public.course_categories', 'active', 'select'
  ),
  'anonymous catalog visitors can resolve only category presentation columns'
);

select extensions.ok(
  has_column_privilege(
    'authenticated', 'public.course_categories', 'code', 'select'
  )
  and has_column_privilege(
    'authenticated', 'public.course_categories', 'title', 'select'
  )
  and has_column_privilege(
    'authenticated', 'public.course_categories', 'description', 'select'
  )
  and has_column_privilege(
    'authenticated', 'public.course_categories', 'short_label', 'select'
  )
  and has_column_privilege(
    'authenticated', 'public.course_categories', 'sort_order', 'select'
  )
  and has_column_privilege(
    'authenticated', 'public.course_categories', 'active', 'select'
  ),
  'authenticated learners can resolve category presentation data'
);

select extensions.ok(
  not has_table_privilege('anon', 'public.course_categories', 'insert')
  and not has_table_privilege('anon', 'public.course_categories', 'update')
  and not has_table_privilege('anon', 'public.course_categories', 'delete'),
  'anonymous clients cannot mutate the controlled taxonomy'
);

select extensions.ok(
  not has_table_privilege(
    'authenticated', 'public.course_categories', 'insert'
  )
  and not has_table_privilege(
    'authenticated', 'public.course_categories', 'update'
  )
  and not has_table_privilege(
    'authenticated', 'public.course_categories', 'delete'
  ),
  'authenticated clients cannot mutate the controlled taxonomy'
);

select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.course_versions'::regclass
      and constraint_row.contype = 'f'
      and pg_get_constraintdef(constraint_row.oid)
        like '%(category_code) REFERENCES course_categories(code)%'
  ),
  'course version category codes reference the controlled taxonomy'
);

select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.course_versions'::regclass
      and constraint_row.conname =
        'course_versions_published_category_check'
      and position(
        'status <> ''published''::text'
        in pg_get_constraintdef(constraint_row.oid)
      ) > 0
      and position(
        'category_code IS NOT NULL'
        in pg_get_constraintdef(constraint_row.oid)
      ) > 0
  ),
  'a published course version cannot omit its category'
);

select extensions.ok(
  (
    select count(*) = 2
      and bool_and(
        column_name in ('category_code', 'category_title')
      )
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'published_course_catalog'
      and column_name in ('category_code', 'category_title')
  ),
  'the formal catalog projects both stable code and learner-facing title'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'internal.create_course_draft(jsonb,uuid)',
    'execute'
  ),
  'authenticated clients cannot bypass the category-aware draft wrapper'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'internal.author_course_structure(uuid,text,jsonb,uuid)',
    'execute'
  ),
  'authenticated clients cannot bypass category-aware draft editing'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.create_course_draft(jsonb,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.author_course_structure(uuid,text,jsonb,uuid)',
    'execute'
  ),
  'course admins retain the public authoring RPC surface'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.create_course_draft(jsonb,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.author_course_structure(uuid,text,jsonb,uuid)',
    'execute'
  ),
  'anonymous clients cannot author categorized courses'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.read_course_category_workspace()',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.read_course_category_workspace()',
    'execute'
  ),
  'only authenticated staff can resolve the category authoring workspace'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'internal.create_course_draft_with_category(jsonb,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'internal.author_course_structure_with_category(uuid,text,jsonb,uuid)',
    'execute'
  ),
  'public invoker facades can reach only the category-aware capabilities'
);

select extensions.ok(
  has_column_privilege(
    'anon', 'public.course_versions', 'category_code', 'select'
  )
  and has_column_privilege(
    'authenticated',
    'public.course_versions',
    'category_code',
    'select'
  ),
  'catalog roles have only the category column needed by the invoker view'
);

select extensions.ok(
  (
    select relation.reloptions @> array['security_invoker=true']::text[]
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'published_course_catalog'
  )
  and has_table_privilege(
    'anon', 'public.published_course_catalog', 'select'
  ),
  'the categorized catalog remains a readable security-invoker view'
);

select extensions.results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'course_categories'
      and policy.cmd = 'SELECT'
      and policy.roles @> array['anon','authenticated']::name[]
      and policy.qual = 'active'
  $$,
  $$values (1::bigint)$$,
  'one narrow active-category read policy covers both catalog roles'
);

select * from extensions.finish();
rollback;
