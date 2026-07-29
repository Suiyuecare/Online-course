begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;

select extensions.plan(20);

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '99000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', '+886912990001', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '99000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', '+886912990002', now(),
    '{}'::jsonb, '{"display_name":"機構負責人"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '99000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', '+886912990003', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

select set_config(
  'test.lifecycle.admin_person_id',
  (
    select person_id::text
    from public.auth_identities
    where auth_user_id = '99000000-0000-4000-8000-000000000001'
  ),
  true
);
select set_config(
  'test.lifecycle.owner_person_id',
  (
    select person_id::text
    from public.auth_identities
    where auth_user_id = '99000000-0000-4000-8000-000000000002'
  ),
  true
);

update public.people
set verified_email = 'owner@example.test',
    email_verified_at = now()
where id = current_setting('test.lifecycle.owner_person_id')::uuid;

insert into public.staff_roles (person_id, role)
values (
  current_setting('test.lifecycle.admin_person_id')::uuid,
  'platform_admin'
);

insert into public.organizations (
  id, legal_name, tax_id_blind_index, contact_person_id,
  invoice_email, status, application_idempotency_key,
  reviewed_by, reviewed_at
) values (
  '99100000-0000-4000-8000-000000000001',
  '歲悅生命週期測試機構',
  repeat('9', 64),
  current_setting('test.lifecycle.owner_person_id')::uuid,
  'owner@example.test',
  'approved',
  '99100000-0000-4000-8000-000000000002',
  current_setting('test.lifecycle.admin_person_id')::uuid,
  now()
);

insert into public.organization_memberships (
  organization_id, person_id, role
) values (
  '99100000-0000-4000-8000-000000000001',
  current_setting('test.lifecycle.owner_person_id')::uuid,
  'owner'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.change_organization_status(uuid,text,text,text,uuid)',
    'execute'
  ),
  'authenticated staff can resolve the guarded lifecycle command'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.change_organization_status(uuid,text,text,text,uuid)',
    'execute'
  ),
  'anonymous clients cannot execute lifecycle changes'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '99000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

set local role authenticated;
select extensions.is(
  jsonb_array_length(
    public.read_organization_lifecycle_controls('生命週期', 10)
  ),
  1,
  'a platform administrator sees the safe lifecycle projection'
);
select extensions.ok(
  not (
    public.read_organization_lifecycle_controls('生命週期', 10)
      -> 0 ? 'taxIdBlindIndex'
  ),
  'the lifecycle projection never returns the tax-id blind index'
);
reset role;

insert into private.step_up_grants (
  actor_id, action, target, nonce_hash, identity_epoch,
  totp_verified_at, expires_at
) values (
  current_setting('test.lifecycle.admin_person_id')::uuid,
  'emergency_suspend',
  '99100000-0000-4000-8000-000000000001',
  repeat('a', 64),
  (
    select identity_epoch
    from public.people
    where id = current_setting('test.lifecycle.admin_person_id')::uuid
  ),
  now(),
  now() + interval '4 minutes'
);

set local role authenticated;
select set_config(
  'test.lifecycle.suspend_response',
  public.change_organization_status(
    '99100000-0000-4000-8000-000000000001',
    'suspend',
    '疑似帳務異常，先暫停新購點及派課等待查核。',
    repeat('a', 64),
    '99200000-0000-4000-8000-000000000001'
  )::text,
  true
);
select extensions.is(
  current_setting('test.lifecycle.suspend_response')::jsonb ->> 'status',
  'suspended',
  'a fresh target-bound step-up suspends the approved organization'
);
reset role;

select extensions.is(
  (
    select status
    from public.organizations
    where id = '99100000-0000-4000-8000-000000000001'
  ),
  'suspended',
  'the persisted organization status is suspended'
);
select extensions.is(
  (
    select count(*)::integer
    from public.audit_events
    where action = 'organization.suspended'
      and target_id = '99100000-0000-4000-8000-000000000001'
  ),
  1,
  'suspension appends exactly one immutable audit event'
);
select extensions.is(
  (
    select count(*)::integer
    from public.notifications
    where person_id =
      current_setting('test.lifecycle.owner_person_id')::uuid
      and category = 'organization'
      and title = '機構培訓功能已暫停'
  ),
  1,
  'the organization owner receives an in-app suspension notice'
);
select extensions.is(
  (
    select count(*)::integer
    from public.notification_outbox outbox
    join public.notifications notification
      on notification.id = outbox.notification_id
    where notification.person_id =
      current_setting('test.lifecycle.owner_person_id')::uuid
      and notification.title = '機構培訓功能已暫停'
  ),
  2,
  'verified organization owners receive SMS and Email outbox work'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99000000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '99000000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;
select extensions.ok(
  not internal.has_organization_role(
    '99100000-0000-4000-8000-000000000001',
    array['owner']
  ),
  'a suspended organization immediately loses B2B mutation authority'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '99000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select extensions.is(
  public.change_organization_status(
    '99100000-0000-4000-8000-000000000001',
    'suspend',
    '疑似帳務異常，先暫停新購點及派課等待查核。',
    repeat('a', 64),
    '99200000-0000-4000-8000-000000000001'
  )::text,
  current_setting('test.lifecycle.suspend_response'),
  'an exact replay returns the completed response without another step-up'
);
reset role;

select extensions.is(
  (
    select count(*)::integer
    from public.audit_events
    where action = 'organization.suspended'
      and target_id = '99100000-0000-4000-8000-000000000001'
  ),
  1,
  'an exact replay does not append another audit event'
);

set local role authenticated;
select extensions.throws_ok(
  $$
    select public.change_organization_status(
      '99100000-0000-4000-8000-000000000001',
      'suspend',
      '使用相同識別碼但換成不同的操作理由，必須拒絕。',
      repeat('a', 64),
      '99200000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'IDEMPOTENCY_REQUEST_CONFLICT',
  'reusing an idempotency key for a different request is rejected'
);
reset role;

insert into private.step_up_grants (
  actor_id, action, target, nonce_hash, identity_epoch,
  totp_verified_at, expires_at
) values (
  current_setting('test.lifecycle.admin_person_id')::uuid,
  'emergency_suspend',
  '99100000-0000-4000-8000-000000000001',
  repeat('b', 64),
  (
    select identity_epoch
    from public.people
    where id = current_setting('test.lifecycle.admin_person_id')::uuid
  ),
  now(),
  now() + interval '4 minutes'
);

set local role authenticated;
select extensions.is(
  public.change_organization_status(
    '99100000-0000-4000-8000-000000000001',
    'reactivate',
    '帳務異常已由兩方確認排除，恢復機構培訓操作。',
    repeat('b', 64),
    '99200000-0000-4000-8000-000000000002'
  ) ->> 'status',
  'approved',
  'a fresh target-bound step-up reactivates a suspended organization'
);
reset role;

select extensions.is(
  (
    select status
    from public.organizations
    where id = '99100000-0000-4000-8000-000000000001'
  ),
  'approved',
  'reactivation persists the exact approved state'
);
select extensions.is(
  (
    select count(*)::integer
    from public.audit_events
    where action = 'organization.reactivated'
      and target_id = '99100000-0000-4000-8000-000000000001'
  ),
  1,
  'reactivation appends its own immutable audit event'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99000000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '99000000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;
select extensions.ok(
  internal.has_organization_role(
    '99100000-0000-4000-8000-000000000001',
    array['owner']
  ),
  'reactivation restores B2B authority to the existing owner'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99000000-0000-4000-8000-000000000003',
    'role', 'authenticated',
    'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '99000000-0000-4000-8000-000000000003',
  true
);
set local role authenticated;
select extensions.throws_ok(
  $$
    select public.read_organization_lifecycle_controls(null, 10)
  $$,
  'P0001',
  'PLATFORM_ADMIN_REQUIRED',
  'a learner cannot read the platform organization lifecycle projection'
);
select extensions.throws_ok(
  $$
    select public.change_organization_status(
      '99100000-0000-4000-8000-000000000001',
      'suspend',
      '一般學員即使猜到機構編號也不能變更狀態。',
      repeat('d', 64),
      '99200000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'ORGANIZATION_STATUS_CHANGE_REJECTED',
  'a learner cannot suspend an organization'
);
reset role;

insert into private.step_up_grants (
  actor_id, action, target, nonce_hash, identity_epoch,
  totp_verified_at, expires_at
) values (
  current_setting('test.lifecycle.admin_person_id')::uuid,
  'emergency_suspend',
  '99100000-0000-4000-8000-000000000001',
  repeat('c', 64),
  (
    select identity_epoch
    from public.people
    where id = current_setting('test.lifecycle.admin_person_id')::uuid
  ),
  now(),
  now() + interval '4 minutes'
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '99000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select extensions.throws_ok(
  $$
    select public.change_organization_status(
      '99100000-0000-4000-8000-000000000001',
      'reactivate',
      '已核准機構不可再次執行復權，避免模糊狀態轉移。',
      repeat('c', 64),
      '99200000-0000-4000-8000-000000000004'
    )
  $$,
  'P0001',
  'ORGANIZATION_STATUS_TRANSITION_REJECTED',
  'an invalid approved-to-approved transition is rejected'
);
reset role;

select extensions.finish();
rollback;
