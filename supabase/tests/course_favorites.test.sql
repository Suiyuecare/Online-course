begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;

select extensions.plan(10);

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '83000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', '+886900008301', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '83000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', '+886900008302', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.courses (
  id, slug, internal_title, created_by
) values (
  '83000000-0000-4000-8000-000000000010',
  'favorite-draft-course',
  '收藏權限測試課',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '83000000-0000-4000-8000-000000000001'
  )
);

insert into public.course_favorites (person_id, course_id)
select
  identity.person_id,
  '83000000-0000-4000-8000-000000000010'
from public.auth_identities identity
where identity.auth_user_id in (
  '83000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000002'
);

select extensions.ok(
  not has_table_privilege('anon', 'public.course_favorites', 'select'),
  'anonymous visitors cannot read favorites'
);
select extensions.ok(
  has_table_privilege('authenticated', 'public.course_favorites', 'select'),
  'authenticated learners can resolve the owner-scoped favorite table'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.course_favorites', 'insert'),
  'authenticated learners cannot insert favorites directly'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.set_own_course_favorite(text,boolean)',
    'execute'
  ),
  'authenticated learners can use the narrow favorite RPC'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.set_own_course_favorite(text,boolean)',
    'execute'
  ),
  'anonymous visitors cannot execute the favorite RPC'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '83000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '83000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select extensions.results_eq(
  $$select count(*)::bigint from public.course_favorites$$,
  $$values (1::bigint)$$,
  'a learner reads only their own favorite'
);
select extensions.throws_ok(
  $$
    select public.set_own_course_favorite(
      'favorite-draft-course',
      true
    )
  $$,
  'P0001',
  'COURSE_NOT_FAVORITABLE',
  'a draft course cannot be added through the favorite RPC'
);
select extensions.is(
  (
    public.set_own_course_favorite(
      'favorite-draft-course',
      false
    ) ->> 'changed'
  ),
  'true',
  'removing an existing favorite is idempotent and succeeds off catalog'
);
select extensions.results_eq(
  $$select count(*)::bigint from public.course_favorites$$,
  $$values (0::bigint)$$,
  'the first learner no longer sees a removed favorite'
);

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '83000000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '83000000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;

select extensions.results_eq(
  $$select count(*)::bigint from public.course_favorites$$,
  $$values (1::bigint)$$,
  'removing one learner favorite does not touch another learner'
);

reset role;
select * from extensions.finish();
rollback;
