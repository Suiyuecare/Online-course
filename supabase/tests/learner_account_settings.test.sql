begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;

select extensions.plan(26);

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '84000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', '+886900008401', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '84000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', '+886900008402', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

update public.people person
set verified_email = case
      when identity.auth_user_id =
        '84000000-0000-4000-8000-000000000001'
      then 'learner-one@example.com'
      else 'learner-two@example.com'
    end,
    email_verified_at = now()
from public.auth_identities identity
where identity.person_id = person.id
  and identity.auth_user_id in (
    '84000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000002'
  );

insert into public.learner_account_settings (
  person_id,
  current_status_code,
  learning_goal_codes,
  interest_codes
)
select
  identity.person_id,
  'care_professional',
  array['earn_credits']::text[],
  array['daily_care']::text[]
from public.auth_identities identity
where identity.auth_user_id in (
  '84000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000002'
);

insert into public.learner_professional_roles (
  person_id,
  position,
  category_code,
  title_code
)
select
  identity.person_id,
  0,
  'long_term_care',
  'care_worker'
from public.auth_identities identity
where identity.auth_user_id in (
  '84000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000002'
);

insert into private.learner_account_pii (person_id, encrypted_profile)
select identity.person_id, '{"version":1}'::jsonb
from public.auth_identities identity
where identity.auth_user_id =
  '84000000-0000-4000-8000-000000000001';

select extensions.ok(
  not has_table_privilege(
    'anon',
    'public.learner_account_settings',
    'select'
  ),
  'anonymous visitors cannot read learner account settings'
);
select extensions.ok(
  has_table_privilege(
    'authenticated',
    'public.learner_account_settings',
    'select'
  ),
  'authenticated learners can resolve the owner-scoped settings table'
);
select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'public.learner_account_settings',
    'insert'
  ),
  'authenticated learners cannot insert settings directly'
);
select extensions.ok(
  has_table_privilege(
    'authenticated',
    'public.learner_professional_roles',
    'select'
  ),
  'authenticated learners can read their owner-scoped roles'
);
select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'public.learner_professional_roles',
    'update'
  ),
  'authenticated learners cannot update roles directly'
);
select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'private.learner_account_pii',
    'select'
  ),
  'authenticated learners cannot read account PII ciphertext'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.read_own_learner_account_settings()',
    'execute'
  ),
  'authenticated learners can use the safe own-read projection'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.read_own_learner_account_settings()',
    'execute'
  ),
  'anonymous visitors cannot use the own-read projection'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.read_learner_account_pii(uuid)',
    'execute'
  ),
  'authenticated learners cannot call the ciphertext capability'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.read_learner_account_pii(uuid)',
    'execute'
  ),
  'only the server role can call the ciphertext capability'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.upsert_own_learner_account_settings(text,jsonb,text[],text[],jsonb,boolean,bigint)',
    'execute'
  ),
  'authenticated learners cannot bypass the server encryption boundary'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.upsert_learner_account_settings_for_person(uuid,text,jsonb,text[],text[],jsonb,boolean,bigint)',
    'execute'
  ),
  'authenticated learners cannot invoke the service account settings writer'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.upsert_learner_account_settings_for_person(uuid,text,jsonb,text[],text[],jsonb,boolean,bigint)',
    'execute'
  ),
  'only the server role can use the encrypted account settings writer'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'internal.request_person_id()',
    'execute'
  ),
  'authenticated RLS policies can resolve the current person'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'internal.request_person_id()',
    'execute'
  ),
  'anonymous visitors cannot resolve an authenticated person'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '84000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '84000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select extensions.results_eq(
  $$select count(*)::bigint from public.learner_account_settings$$,
  $$values (1::bigint)$$,
  'a learner reads only their own account settings'
);
select extensions.results_eq(
  $$select count(*)::bigint from public.learner_professional_roles$$,
  $$values (1::bigint)$$,
  'a learner reads only their own professional roles'
);
select extensions.is(
  public.read_own_learner_account_settings() ->> 'verifiedEmail',
  'learner-one@example.com',
  'the safe projection returns only the current learner contact status'
);

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'service_role',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);

select extensions.is(
  (
    public.upsert_learner_account_settings_for_person(
      (
        select identity.person_id
        from public.auth_identities identity
        where identity.auth_user_id =
          '84000000-0000-4000-8000-000000000001'
      ),
      'care_professional',
      '[{"category":"medical_health","title":"nurse"}]'::jsonb,
      array['earn_credits', 'care_skills']::text[],
      array['daily_care', 'quality_safety']::text[],
      null,
      false,
      1
    ) ->> 'version'
  ),
  '2',
  'the atomic settings RPC advances the optimistic version'
);
select extensions.throws_ok(
  $$
    select public.upsert_learner_account_settings_for_person(
      (
        select identity.person_id
        from public.auth_identities identity
        where identity.auth_user_id =
          '84000000-0000-4000-8000-000000000001'
      ),
      'care_professional',
      '[{"category":"medical_health","title":"care_worker"}]'::jsonb,
      array['earn_credits']::text[],
      array['daily_care']::text[],
      null,
      false,
      2
    )
  $$,
  'P0001',
  'LEARNER_ACCOUNT_ROLE_INVALID',
  'an invalid category and title pair is rejected'
);
select extensions.throws_ok(
  $$
    select public.upsert_learner_account_settings_for_person(
      (
        select identity.person_id
        from public.auth_identities identity
        where identity.auth_user_id =
          '84000000-0000-4000-8000-000000000001'
      ),
      'care_professional',
      '[{"category":"medical_health","title":"nurse"}]'::jsonb,
      array['earn_credits']::text[],
      array['daily_care']::text[],
      '{"version":1}'::jsonb,
      true,
      2
    )
  $$,
  'P0001',
  'LEARNER_ACCOUNT_SETTINGS_INVALID',
  'a malformed encryption envelope is rejected'
);
select extensions.throws_ok(
  $$
    select public.upsert_learner_account_settings_for_person(
      (
        select identity.person_id
        from public.auth_identities identity
        where identity.auth_user_id =
          '84000000-0000-4000-8000-000000000001'
      ),
      'care_professional',
      '[]'::jsonb,
      '{}'::text[],
      '{}'::text[],
      null,
      false,
      1
    )
  $$,
  'P0001',
  'LEARNER_ACCOUNT_SETTINGS_VERSION_CONFLICT',
  'a stale edit cannot overwrite newer learner settings'
);

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '84000000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '84000000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;

select extensions.results_eq(
  $$select count(*)::bigint from public.learner_account_settings$$,
  $$values (1::bigint)$$,
  'the second learner still sees only their own settings'
);

reset role;
update public.people person
set anonymized_at = now()
from public.auth_identities identity
where identity.person_id = person.id
  and identity.auth_user_id =
    '84000000-0000-4000-8000-000000000001';

select extensions.results_eq(
  $$
    select count(*)::bigint
    from public.learner_account_settings settings
    join public.auth_identities identity
      on identity.person_id = settings.person_id
    where identity.auth_user_id =
      '84000000-0000-4000-8000-000000000001'
  $$,
  $$values (0::bigint)$$,
  'account preferences are purged when the learner is anonymized'
);
select extensions.results_eq(
  $$
    select count(*)::bigint
    from private.learner_account_pii pii
    join public.auth_identities identity
      on identity.person_id = pii.person_id
    where identity.auth_user_id =
      '84000000-0000-4000-8000-000000000001'
  $$,
  $$values (0::bigint)$$,
  'encrypted optional profile data is purged on anonymization'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'service_role',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);

select extensions.throws_ok(
  $$
    select public.upsert_learner_account_settings_for_person(
      (
        select identity.person_id
        from public.auth_identities identity
        where identity.auth_user_id =
          '84000000-0000-4000-8000-000000000001'
      ),
      'care_professional',
      '[]'::jsonb,
      '{}'::text[],
      '{}'::text[],
      null,
      false,
      0
    )
  $$,
  'P0001',
  'LEARNER_ACCOUNT_SETTINGS_IDENTITY_RESTRICTED',
  'an anonymized learner cannot recreate account settings'
);

select * from extensions.finish();
rollback;
