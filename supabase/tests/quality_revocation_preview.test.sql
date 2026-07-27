begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(18);

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

select * from extensions.finish();
rollback;
