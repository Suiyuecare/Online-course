begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(30);

select extensions.ok(
  has_function_privilege(
    'anon',
    'public.read_public_course_outline(uuid)',
    'execute'
  ),
  'anonymous catalog visitors can read only the narrow course outline'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.authorize_public_course_preview(uuid,uuid)',
    'execute'
  ),
  'anonymous callers cannot mint preview authorization directly'
);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.authorize_public_course_preview(uuid,uuid)',
    'execute'
  ),
  'only the server route can request preview authorization'
);

select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'public.quiz_attempt_invalidation_requests',
    'select'
  ),
  'browser roles cannot read invalidation requests directly'
);

select extensions.ok(
  not has_table_privilege(
    'service_role',
    'public.quiz_attempt_invalidation_requests',
    'select'
  ),
  'service role must use narrow invalidation RPCs'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.read_quiz_attempt_invalidation_workspace()',
    'execute'
  ),
  'authenticated staff can enter the role-checked invalidation workspace'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.read_my_quiz_attempt_invalidation_statuses(uuid)',
    'execute'
  ),
  'learners can call the ownership-checked invalidation status projection'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.read_survey_investigation(uuid,text)',
    'execute'
  ),
  'the survey investigation overload without fresh step-up is disabled'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.read_survey_investigation(uuid,text,text)',
    'execute'
  ),
  'the fresh-step-up survey investigation overload is available'
);

select extensions.results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_trigger trigger
    join pg_catalog.pg_class relation
      on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'quiz_attempt_invalidation_requests',
        'quiz_attempt_invalidation_decisions'
      )
      and trigger.tgname like '%_append_only'
      and not trigger.tgisinternal
  $$,
  array[2::bigint],
  'both quiz invalidation records are append-only'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.request_certificate_revocation(uuid,text,uuid,text)',
    'execute'
  ),
  'anonymous callers have no implicit PUBLIC certificate-revocation execute'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.decide_certificate_revocation(uuid,text,text,text)',
    'execute'
  ),
  'the legacy non-idempotent certificate decision overload is disabled'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.decide_certificate_revocation(uuid,text,text,uuid,text)',
    'execute'
  ),
  'authenticated reviewers use the idempotent certificate decision overload'
);

select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'public.organization_assignment_outcome_corrections',
    'select'
  ),
  'organization quality corrections are available only through projections'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns column_definition
    where column_definition.table_schema = 'public'
      and column_definition.table_name =
        'organization_assignment_outcome_corrections'
      and column_definition.column_name =
        'membership_lifecycle_revision'
      and column_definition.data_type = 'integer'
      and column_definition.is_nullable = 'NO'
  ),
  'organization quality corrections are bound to a membership lifecycle'
);

select extensions.ok(
  to_regclass(
    'public.organization_outcome_corrections_lifecycle_idx'
  ) is not null,
  'lifecycle-scoped correction lookup has a supporting index'
);

select extensions.ok(
  position(
    'for update of membership'
    in lower(pg_get_functiondef(
      'internal.append_organization_quality_correction(uuid,text,uuid,uuid,text)'
        ::regprocedure
    ))
  ) > 0,
  'correction append serializes with membership lifecycle changes'
);

select extensions.ok(
  position(
    'stored.membership_lifecycle_revision ='
    in lower(pg_get_functiondef(
      'internal.organization_assignment_visible_outcome(uuid)'
        ::regprocedure
    ))
  ) > 0
  and position(
    'stored.created_at >= snapshot.visibility_cutoff_at'
    in lower(pg_get_functiondef(
      'internal.organization_assignment_visible_outcome(uuid)'
        ::regprocedure
    ))
  ) > 0,
  'inactive projection applies only post-cutoff corrections for its lifecycle'
);

select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_roles role
    where role.rolname = 'suiyue_catalog_owner'
      and not role.rolcanlogin
      and not role.rolinherit
      and not role.rolsuper
      and not role.rolcreaterole
      and not role.rolcreatedb
      and not role.rolreplication
      and not role.rolbypassrls
      and not exists (
        select 1
        from pg_catalog.pg_auth_members membership
        where membership.member = role.oid
      )
      and not exists (
        select 1
        from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles member_role
          on member_role.oid = membership.member
        where membership.roleid = role.oid
          and (
            member_role.rolname <> 'postgres'
            or membership.admin_option
          )
      )
  ),
  'the catalog capability owner has no ambient or delegable privileges'
);

select extensions.results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles owner
      on owner.oid = procedure.proowner
    where namespace.nspname = 'public'
      and procedure.proname in (
        'read_public_course_outline',
        'read_public_course_readiness'
      )
      and procedure.prosecdef
      and procedure.proconfig @>
        array['search_path=pg_catalog, internal']::text[]
      and owner.rolname = 'suiyue_catalog_owner'
  $$,
  array[2::bigint],
  'both public catalog facades use the restricted capability owner'
);

select extensions.ok(
  has_schema_privilege('suiyue_catalog_owner', 'internal', 'usage')
  and not has_schema_privilege(
    'suiyue_catalog_owner', 'public', 'create'
  )
  and not has_table_privilege(
    'suiyue_catalog_owner', 'public.course_versions', 'select'
  )
  and not has_table_privilege(
    'suiyue_catalog_owner', 'public.provider_health', 'select'
  )
  and has_function_privilege(
    'suiyue_catalog_owner',
    'internal.read_public_course_outline(uuid)',
    'execute'
  )
  and has_function_privilege(
    'suiyue_catalog_owner',
    'internal.read_public_course_readiness(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'suiyue_catalog_owner',
    'internal.publish_course_version(uuid,text,text)',
    'execute'
  ),
  'the catalog owner has only the two internal read capabilities'
);

select extensions.ok(
  not has_table_privilege(
    'anon', 'public.course_versions', 'select'
  )
  and not has_schema_privilege('anon', 'internal', 'usage'),
  'anonymous catalog access does not gain table or internal-schema access'
);

select extensions.ok(
  not has_table_privilege(
    'authenticated', 'public.course_versions', 'select'
  ),
  'authenticated catalog access retains column-level course grants'
);

select extensions.ok(
  not has_function_privilege(
    'anon', 'internal.read_public_course_outline(uuid)', 'execute'
  )
  and not has_function_privilege(
    'anon', 'internal.read_public_course_readiness(uuid)', 'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'internal.read_public_course_outline(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'internal.read_public_course_readiness(uuid)',
    'execute'
  ),
  'browser roles cannot bypass the public catalog facades'
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
    'service_role', 'public.published_course_catalog', 'select'
  ),
  'the catalog remains security-invoker and available to its server route'
);

select extensions.ok(
  has_function_privilege(
    'anon', 'public.read_public_course_outline(uuid)', 'execute'
  )
  and has_function_privilege(
    'anon', 'public.read_public_course_readiness(uuid)', 'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.read_public_course_outline(uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.read_public_course_readiness(uuid)',
    'execute'
  ),
  'browser roles can execute only the public catalog facades'
);

grant usage on schema extensions to anon;
grant execute on all functions in schema extensions to anon;
grant usage on schema extensions to service_role;
grant execute on all functions in schema extensions to service_role;
set local role anon;

select extensions.lives_ok(
  $$
    select
      slug, course_version_id, title, summary, description,
      learning_objectives, delivery_type, price_twd,
      recorded_refund_allocation_twd, live_refund_allocations,
      organization_point_price, accreditation_status,
      accreditation_points, has_cover, equipment_requirements,
      instructors, first_live_starts_at, legal_document_id,
      legal_document_sha256, live_sessions
    from public.published_course_catalog
    order by title
    limit 1
  $$,
  'anonymous visitors can evaluate the exact frontend catalog projection'
);

select extensions.results_eq(
  $$
    select public.read_public_course_outline(
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  $$,
  $$values (jsonb_build_object('modules', '[]'::jsonb))$$,
  'an unknown course has an empty public outline without a permission error'
);

select extensions.results_eq(
  $$
    select public.read_public_course_readiness(
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  $$,
  $$
    values (jsonb_build_object(
      'purchaseReady', false,
      'reasons', jsonb_build_array('此課程目前未開放報名。')
    ))
  $$,
  'an unknown course fails purchase readiness without a permission error'
);

reset role;

set local role service_role;

select extensions.lives_ok(
  $$
    select course_version_id
    from public.published_course_catalog
    order by course_version_id
    limit 1
  $$,
  'the server cover route can evaluate the security-invoker catalog'
);

reset role;

select * from extensions.finish();
rollback;
