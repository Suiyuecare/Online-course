begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;

select extensions.plan(18);

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '97000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', '+886912970001', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '97000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', '+886912970002', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '97000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', '+886912970003', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '97000000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', '+886912970004', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

select set_config(
  'test.batch.owner_person_id',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '97000000-0000-4000-8000-000000000001'
  ),
  true
);
select set_config(
  'test.batch.member_one_person_id',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '97000000-0000-4000-8000-000000000002'
  ),
  true
);
select set_config(
  'test.batch.member_two_person_id',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '97000000-0000-4000-8000-000000000003'
  ),
  true
);
select set_config(
  'test.batch.other_owner_person_id',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '97000000-0000-4000-8000-000000000004'
  ),
  true
);
select set_config(
  'test.batch.completion_due_at',
  (clock_timestamp() + interval '30 days')::text,
  true
);

insert into public.organizations (
  id, legal_name, tax_id_blind_index, invoice_email, status,
  application_idempotency_key
) values
  (
    '97100000-0000-4000-8000-000000000001',
    '批次派課甲機構', repeat('a', 64), 'batch-a@example.test',
    'approved', '97100000-0000-4000-8000-000000000011'
  ),
  (
    '97100000-0000-4000-8000-000000000002',
    '批次派課乙機構', repeat('b', 64), 'batch-b@example.test',
    'approved', '97100000-0000-4000-8000-000000000012'
  );

insert into public.organization_memberships (
  organization_id, person_id, role
) values
  (
    '97100000-0000-4000-8000-000000000001',
    current_setting('test.batch.owner_person_id')::uuid,
    'owner'
  ),
  (
    '97100000-0000-4000-8000-000000000001',
    current_setting('test.batch.member_one_person_id')::uuid,
    'member'
  ),
  (
    '97100000-0000-4000-8000-000000000001',
    current_setting('test.batch.member_two_person_id')::uuid,
    'member'
  ),
  (
    '97100000-0000-4000-8000-000000000002',
    current_setting('test.batch.other_owner_person_id')::uuid,
    'owner'
  );

insert into public.legal_documents (
  id, kind, revision, content_sha256, object_path,
  approved_by_legal, effective_at
) values (
  '97200000-0000-4000-8000-000000000001',
  'b2b_contract', 972001, repeat('c', 64),
  'legal/test-organization-batch', true, now() - interval '10 days'
);

insert into public.legal_acceptances (
  id, person_id, legal_document_id,
  first_presented_at, second_confirmed_at,
  first_ip, second_ip, first_device_hash, second_device_hash,
  document_hash_snapshot
) values (
  '97200000-0000-4000-8000-000000000002',
  current_setting('test.batch.owner_person_id')::uuid,
  '97200000-0000-4000-8000-000000000001',
  now() - interval '4 days', now(),
  '127.0.0.1', '127.0.0.1', 'batch-device-1', 'batch-device-2',
  repeat('c', 64)
);

insert into public.courses (
  id, slug, internal_title, created_by
) values (
  '97200000-0000-4000-8000-000000000003',
  'organization-batch-assignment-test',
  '機構批次派課測試',
  current_setting('test.batch.owner_person_id')::uuid
);

set local session_replication_role = replica;
insert into public.course_versions (
  id, course_id, version, title, summary, description,
  delivery_type, status, organization_point_price,
  commerce_close_at, created_by, authoring_idempotency_key
) values (
  '97200000-0000-4000-8000-000000000004',
  '97200000-0000-4000-8000-000000000003',
  1, '批次派課錄播課', '驗證批次派課',
  '驗證點數、跨機構、冪等與完成期限。',
  'recorded', 'published', 10, now() + interval '365 days',
  current_setting('test.batch.owner_person_id')::uuid,
  '97200000-0000-4000-8000-000000000005'
);
set local session_replication_role = origin;

insert into public.organization_wallets (
  organization_id, available_points
) values ('97100000-0000-4000-8000-000000000001', 25);

insert into public.point_topups (
  id, organization_id, requested_by, status,
  points, amount_due_twd, amount_paid_twd,
  legal_acceptance_id, transfer_due_at, idempotency_key, paid_at
) values (
  '97200000-0000-4000-8000-000000000006',
  '97100000-0000-4000-8000-000000000001',
  current_setting('test.batch.owner_person_id')::uuid,
  'paid', 25, 25, 25,
  '97200000-0000-4000-8000-000000000002',
  now() + interval '1 day',
  '97200000-0000-4000-8000-000000000007',
  now()
);

insert into public.point_lots (
  id, organization_id, point_topup_id, purchased_points,
  available_points, purchased_at
) values (
  '97200000-0000-4000-8000-000000000008',
  '97100000-0000-4000-8000-000000000001',
  '97200000-0000-4000-8000-000000000006',
  25, 25, now()
);

insert into public.operating_setting_revisions (
  setting_key, revision, value, approved_by, effective_at
) values
  (
    'legal_approved', 972001, '{"enabled":true}'::jsonb,
    current_setting('test.batch.owner_person_id')::uuid,
    now() - interval '1 day'
  ),
  (
    'finance_configured', 972001, '{"enabled":true}'::jsonb,
    current_setting('test.batch.owner_person_id')::uuid,
    now() - interval '1 day'
  ),
  (
    'incident_owner_configured', 972001, '{"enabled":true}'::jsonb,
    current_setting('test.batch.owner_person_id')::uuid,
    now() - interval '1 day'
  );

update public.feature_switches
set enabled = true,
    approved_at = now() - interval '1 day',
    approved_by = current_setting('test.batch.owner_person_id')::uuid,
    suspended_at = null,
    suspended_by = null,
    reason = 'pgTAP organization batch assignment'
where name = 'organization_assignment';

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.batch_assign_organization_course(uuid,uuid[],uuid,uuid,timestamptz,uuid)',
    'execute'
  ),
  'authenticated managers receive the explicit batch wrapper grant'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.batch_assign_organization_course(uuid,uuid[],uuid,uuid,timestamptz,uuid)',
    'execute'
  ),
  'anonymous clients cannot execute organization batch assignment'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '97000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select set_config(
  'test.batch.first_response',
  public.batch_assign_organization_course(
    '97100000-0000-4000-8000-000000000001',
    array[
      current_setting('test.batch.member_one_person_id')::uuid,
      current_setting('test.batch.other_owner_person_id')::uuid,
      current_setting('test.batch.member_two_person_id')::uuid
    ],
    '97200000-0000-4000-8000-000000000004',
    null,
    current_setting('test.batch.completion_due_at')::timestamptz,
    '97300000-0000-4000-8000-000000000001'
  )::text,
  true
);

select extensions.is(
  (
    current_setting('test.batch.first_response')::jsonb
      ->> 'succeededCount'
  )::integer,
  2,
  'two valid organization members are assigned'
);
select extensions.is(
  (
    current_setting('test.batch.first_response')::jsonb
      ->> 'failedCount'
  )::integer,
  1,
  'one cross-tenant member fails without rolling back valid rows'
);
select extensions.is(
  current_setting('test.batch.first_response')::jsonb
    -> 'results' -> 1 ->> 'errorCode',
  'ORGANIZATION_MEMBER_REQUIRED',
  'the cross-tenant row returns a safe per-row error'
);
select extensions.is(
  (
    current_setting('test.batch.first_response')::jsonb
      ->> 'reservedPoints'
  )::bigint,
  20::bigint,
  'only successful rows reserve points'
);

reset role;
select extensions.is(
  (
    select count(*)::integer
    from public.organization_assignments assignment
    where assignment.organization_id =
      '97100000-0000-4000-8000-000000000001'
  ),
  2,
  'exactly two assignment records are created'
);
select extensions.ok(
  (
    select wallet.available_points = 5
      and wallet.reserved_points = 20
    from public.organization_wallets wallet
    where wallet.organization_id =
      '97100000-0000-4000-8000-000000000001'
  ),
  'wallet totals reflect only successful rows'
);
select extensions.is(
  (
    select count(*)::integer
    from public.enrollments enrollment
    where enrollment.completion_due_at =
      current_setting('test.batch.completion_due_at')::timestamptz
  ),
  2,
  'each successful enrollment stores the requested deadline'
);

set local role authenticated;
select extensions.is(
  public.batch_assign_organization_course(
    '97100000-0000-4000-8000-000000000001',
    array[
      current_setting('test.batch.member_one_person_id')::uuid,
      current_setting('test.batch.other_owner_person_id')::uuid,
      current_setting('test.batch.member_two_person_id')::uuid
    ],
    '97200000-0000-4000-8000-000000000004',
    null,
    current_setting('test.batch.completion_due_at')::timestamptz,
    '97300000-0000-4000-8000-000000000001'
  )::text,
  current_setting('test.batch.first_response'),
  'an identical idempotent replay returns the original row results'
);
reset role;

select extensions.is(
  (
    select count(*)::integer
    from public.organization_assignments assignment
    where assignment.organization_id =
      '97100000-0000-4000-8000-000000000001'
  ),
  2,
  'an idempotent replay creates no extra assignments'
);

set local role authenticated;
select extensions.throws_ok(
  $$
    select public.batch_assign_organization_course(
      '97100000-0000-4000-8000-000000000001',
      array[
        current_setting('test.batch.member_two_person_id')::uuid,
        current_setting('test.batch.member_one_person_id')::uuid
      ],
      '97200000-0000-4000-8000-000000000004',
      null,
      current_setting('test.batch.completion_due_at')::timestamptz,
      '97300000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'IDEMPOTENCY_REQUEST_CONFLICT',
  'reusing the batch key for a different payload is rejected'
);

select extensions.is(
  public.batch_assign_organization_course(
    '97100000-0000-4000-8000-000000000001',
    array[current_setting('test.batch.owner_person_id')::uuid],
    '97200000-0000-4000-8000-000000000004',
    null,
    null,
    '97300000-0000-4000-8000-000000000002'
  ) -> 'results' -> 0 ->> 'errorCode',
  'INSUFFICIENT_POINTS',
  'insufficient points fail only that member row'
);
reset role;

select extensions.ok(
  (
    select wallet.available_points = 5
      and wallet.reserved_points = 20
    from public.organization_wallets wallet
    where wallet.organization_id =
      '97100000-0000-4000-8000-000000000001'
  ),
  'a failed row leaves wallet totals unchanged'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '97000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;
select extensions.is(
  (
    select dashboard.completion_due_at
    from public.learner_dashboard dashboard
    limit 1
  ),
  current_setting('test.batch.completion_due_at')::timestamptz,
  'the assigned learner sees the organization completion deadline'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '97000000-0000-4000-8000-000000000004',
    'role', 'authenticated', 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000004',
  true
);
set local role authenticated;
select extensions.throws_ok(
  $$
    select public.batch_assign_organization_course(
      '97100000-0000-4000-8000-000000000001',
      array[current_setting('test.batch.member_one_person_id')::uuid],
      '97200000-0000-4000-8000-000000000004',
      null, null,
      '97300000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'ORGANIZATION_MANAGER_REQUIRED',
  'a manager from another organization cannot operate the target wallet'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '97000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select extensions.throws_ok(
  $$
    select public.batch_assign_organization_course(
      '97100000-0000-4000-8000-000000000001',
      array[current_setting('test.batch.owner_person_id')::uuid],
      '97200000-0000-4000-8000-000000000004',
      null,
      clock_timestamp() - interval '1 minute',
      '97300000-0000-4000-8000-000000000004'
    )
  $$,
  'P0001',
  'COMPLETION_DEADLINE_INVALID',
  'a past completion deadline is rejected before any row mutation'
);
reset role;

select extensions.is(
  (
    select count(*)::integer
    from public.point_ledger_events event
    where event.organization_id =
      '97100000-0000-4000-8000-000000000001'
      and event.event_type = 'reserved'
  ),
  2,
  'append-only point evidence exists exactly once per successful row'
);

select * from extensions.finish();
rollback;
