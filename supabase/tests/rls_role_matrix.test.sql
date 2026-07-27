begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;

select extensions.plan(28);

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', '+886900000001', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', '+886900000002', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', '+886900000003', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', '+886900000004', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000005',
    'authenticated', 'authenticated', '+886900000005', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.notifications (
  id, person_id, category, title, body, business_key
) values
  (
    '20000000-0000-4000-8000-000000000001',
    (
      select person_id from public.auth_identities
      where auth_user_id = '10000000-0000-4000-8000-000000000001'
    ),
    'test', '自己的通知', '只應由本人看到', 'rls-own-notification'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    (
      select person_id from public.auth_identities
      where auth_user_id = '10000000-0000-4000-8000-000000000002'
    ),
    'test', '他人的通知', '不得跨人看到', 'rls-other-notification'
  );

insert into public.organizations (
  id, legal_name, tax_id_blind_index, invoice_email, status,
  application_idempotency_key
) values
  (
    '30000000-0000-4000-8000-000000000001',
    '甲測試機構', repeat('a', 64), 'finance-a@example.test', 'approved',
    '31000000-0000-4000-8000-000000000001'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '乙測試機構', repeat('b', 64), 'finance-b@example.test', 'approved',
    '31000000-0000-4000-8000-000000000002'
  );

insert into public.organization_memberships (
  organization_id, person_id, role
) values
  (
    '30000000-0000-4000-8000-000000000001',
    (
      select person_id from public.auth_identities
      where auth_user_id = '10000000-0000-4000-8000-000000000001'
    ),
    'owner'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    (
      select person_id from public.auth_identities
      where auth_user_id = '10000000-0000-4000-8000-000000000002'
    ),
    'owner'
  );

insert into public.organization_wallets (organization_id, available_points)
values
  ('30000000-0000-4000-8000-000000000001', 1000),
  ('30000000-0000-4000-8000-000000000002', 2000);

insert into public.staff_roles (person_id, role) values
  (
    (
      select person_id from public.auth_identities
      where auth_user_id = '10000000-0000-4000-8000-000000000003'
    ),
    'support'
  ),
  (
    (
      select person_id from public.auth_identities
      where auth_user_id = '10000000-0000-4000-8000-000000000004'
    ),
    'finance'
  ),
  (
    (
      select person_id from public.auth_identities
      where auth_user_id = '10000000-0000-4000-8000-000000000005'
    ),
    'course_admin'
  );

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select extensions.results_eq(
  $$select count(*)::bigint from public.notifications$$,
  $$values (1::bigint)$$,
  'learner can read exactly their own notification'
);
select extensions.results_eq(
  $$select count(*)::bigint from public.notifications
    where id = '20000000-0000-4000-8000-000000000002'$$,
  $$values (0::bigint)$$,
  'learner cannot read another learner notification'
);
select extensions.results_eq(
  $$with changed as (
      update public.notifications set read_at = now()
      where id = '20000000-0000-4000-8000-000000000002'
      returning 1
    ) select count(*)::bigint from changed$$,
  $$values (0::bigint)$$,
  'learner cannot mark another learner notification as read'
);
select extensions.results_eq(
  $$select count(*)::bigint from public.organizations$$,
  $$values (1::bigint)$$,
  'organization owner sees only their organization'
);
select extensions.results_eq(
  $$select count(*)::bigint from public.organizations
    where id = '30000000-0000-4000-8000-000000000002'$$,
  $$values (0::bigint)$$,
  'organization owner cannot read another tenant'
);
select extensions.results_eq(
  $$select count(*)::bigint from public.organization_wallets$$,
  $$values (1::bigint)$$,
  'organization owner sees only their wallet'
);
select extensions.results_eq(
  $$select count(*)::bigint from public.organization_wallets
    where organization_id = '30000000-0000-4000-8000-000000000002'$$,
  $$values (0::bigint)$$,
  'organization owner cannot read another tenant wallet'
);

reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000003',
    'role', 'authenticated',
    'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000003',
  true
);
set local role authenticated;
select extensions.ok(
  public.authorize_staff_action('support', 'read', 'masked-queue'),
  'support can access support authority'
);
select extensions.ok(
  not public.authorize_staff_action('finance', 'read', 'finance-queue'),
  'support cannot escalate to finance'
);
select extensions.ok(
  not public.authorize_staff_action('course_admin', 'write', 'course'),
  'support cannot escalate to course admin'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000004',
    'role', 'authenticated',
    'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000004',
  true
);
set local role authenticated;
select extensions.ok(
  public.authorize_staff_action('finance', 'read', 'finance-queue'),
  'finance can access finance authority'
);
select extensions.ok(
  public.authorize_staff_action('support', 'read', 'masked-queue'),
  'finance inherits masked support authority'
);
select extensions.ok(
  not public.authorize_staff_action('course_admin', 'write', 'course'),
  'finance cannot escalate to course admin'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '10000000-0000-4000-8000-000000000005',
    'role', 'authenticated',
    'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000005',
  true
);
set local role authenticated;
select extensions.ok(
  public.authorize_staff_action('course_admin', 'write', 'course'),
  'course admin can access course authority'
);
select extensions.ok(
  public.authorize_staff_action('support', 'read', 'masked-queue'),
  'course admin inherits masked support authority'
);
select extensions.ok(
  not public.authorize_staff_action('finance', 'read', 'finance-queue'),
  'course admin cannot escalate to finance'
);
reset role;

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.ingest_provider_event(text,text,text,text,timestamptz,jsonb,text)',
    'execute'
  ),
  'authenticated cannot execute service-only provider ingestion'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.ingest_provider_event(text,text,text,text,timestamptz,jsonb,text)',
    'execute'
  ),
  'service role can execute provider ingestion'
);
select extensions.ok(
  not has_table_privilege(
    'authenticated', 'public.provider_events', 'select'
  ),
  'authenticated cannot select provider evidence'
);
select extensions.ok(
  has_table_privilege('service_role', 'public.provider_events', 'select'),
  'service role can read provider evidence'
);
select extensions.ok(
  has_schema_privilege('authenticated', 'internal', 'usage'),
  'authenticated can resolve explicitly granted internal RPCs'
);
select extensions.ok(
  has_function_privilege(
    'authenticated', 'public.require_current_person()', 'execute'
  ),
  'authenticated can execute public current-person preflight'
);
select extensions.ok(
  has_function_privilege(
    'authenticated', 'internal.require_current_person()', 'execute'
  ),
  'authenticated can execute exact internal current-person RPC'
);
select extensions.ok(
  not has_schema_privilege('anon', 'internal', 'usage'),
  'anon cannot resolve internal RPCs'
);
select extensions.ok(
  not has_function_privilege(
    'anon', 'public.require_current_person()', 'execute'
  ),
  'anon cannot execute public current-person preflight'
);
select extensions.ok(
  not has_function_privilege(
    'anon', 'internal.require_current_person()', 'execute'
  ),
  'anon cannot execute internal current-person RPC'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.record_worker_heartbeat(text,boolean)',
    'execute'
  ),
  'service role can execute public worker heartbeat'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'internal.record_worker_heartbeat(text,boolean)',
    'execute'
  ),
  'service role can execute exact internal worker heartbeat'
);

select * from extensions.finish();
rollback;
