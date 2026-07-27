begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;

select extensions.plan(48);

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '91000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', '+886911000001', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '91000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', '+886911000002', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '91000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', '+886911000003', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '91000000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', '+886911000004', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '91000000-0000-4000-8000-000000000005',
    'authenticated', 'authenticated', '+886911000005', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '91000000-0000-4000-8000-000000000006',
    'authenticated', 'authenticated', '+886911000006', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.organizations (
  id, legal_name, tax_id_blind_index, invoice_email, status,
  application_idempotency_key
) values
  (
    '92000000-0000-4000-8000-000000000001',
    '角色生命週期甲機構', repeat('c', 64), 'a@example.test', 'approved',
    '92000000-0000-4000-8000-000000000011'
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    '角色生命週期乙機構', repeat('d', 64), 'b@example.test', 'approved',
    '92000000-0000-4000-8000-000000000012'
  );

insert into public.organization_memberships (
  organization_id, person_id, role
) values
  (
    '92000000-0000-4000-8000-000000000001',
    (
      select person_id from public.auth_identities
      where auth_user_id = '91000000-0000-4000-8000-000000000001'
    ),
    'owner'
  ),
  (
    '92000000-0000-4000-8000-000000000001',
    (
      select person_id from public.auth_identities
      where auth_user_id = '91000000-0000-4000-8000-000000000002'
    ),
    'training_manager'
  ),
  (
    '92000000-0000-4000-8000-000000000001',
    (
      select person_id from public.auth_identities
      where auth_user_id = '91000000-0000-4000-8000-000000000003'
    ),
    'member'
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    (
      select person_id from public.auth_identities
      where auth_user_id = '91000000-0000-4000-8000-000000000004'
    ),
    'owner'
  );

insert into public.staff_roles (person_id, role) values
  (
    (
      select person_id from public.auth_identities
      where auth_user_id = '91000000-0000-4000-8000-000000000001'
    ),
    'course_admin'
  ),
  (
    (
      select person_id from public.auth_identities
      where auth_user_id = '91000000-0000-4000-8000-000000000005'
    ),
    'support'
  ),
  (
    (
      select person_id from public.auth_identities
      where auth_user_id = '91000000-0000-4000-8000-000000000006'
    ),
    'instructor'
  );

insert into public.legal_documents (
  id, kind, revision, content_sha256, object_path,
  approved_by_legal, effective_at
) values (
  '94000000-0000-4000-8000-000000000001',
  'b2b_contract', 940001, repeat('e', 64),
  'legal/test-role-org-support', true, now() - interval '10 days'
);

insert into public.legal_acceptances (
  id, person_id, legal_document_id,
  first_presented_at, second_confirmed_at,
  first_ip, second_ip, first_device_hash, second_device_hash,
  document_hash_snapshot
) values (
  '94000000-0000-4000-8000-000000000002',
  (
    select person_id from public.auth_identities
    where auth_user_id = '91000000-0000-4000-8000-000000000001'
  ),
  '94000000-0000-4000-8000-000000000001',
  now() - interval '4 days', now(),
  '127.0.0.1', '127.0.0.1', 'test-device-1', 'test-device-2',
  repeat('e', 64)
);

insert into public.courses (
  id, slug, internal_title, created_by
) values (
  '94000000-0000-4000-8000-000000000003',
  'role-org-support-test', '角色機構客服狀態測試',
  (
    select person_id from public.auth_identities
    where auth_user_id = '91000000-0000-4000-8000-000000000001'
  )
);

insert into public.course_versions (
  id, course_id, version, title, summary, description,
  delivery_type, status, organization_point_price,
  created_by, authoring_idempotency_key
) values (
  '94000000-0000-4000-8000-000000000004',
  '94000000-0000-4000-8000-000000000003',
  1, '機構完成狀態測試課程', '機構完成狀態測試摘要',
  '驗證 authoritative completion 與離職成果快照。',
  'live', 'draft', 10,
  (
    select person_id from public.auth_identities
    where auth_user_id = '91000000-0000-4000-8000-000000000001'
  ),
  '94000000-0000-4000-8000-000000000005'
);

insert into public.course_requirements (
  course_version_id, required_watch_seconds
) values ('94000000-0000-4000-8000-000000000004', 0);

insert into public.organization_wallets (
  organization_id, reserved_points
) values ('92000000-0000-4000-8000-000000000001', 10);

insert into public.point_topups (
  id, organization_id, requested_by, status,
  points, amount_due_twd, amount_paid_twd,
  legal_acceptance_id, transfer_due_at, idempotency_key, paid_at
) values (
  '94000000-0000-4000-8000-000000000006',
  '92000000-0000-4000-8000-000000000001',
  (
    select person_id from public.auth_identities
    where auth_user_id = '91000000-0000-4000-8000-000000000001'
  ),
  'paid', 10, 10, 10,
  '94000000-0000-4000-8000-000000000002',
  now() + interval '1 day',
  '94000000-0000-4000-8000-000000000007', now()
);

insert into public.point_lots (
  id, organization_id, point_topup_id, purchased_points,
  available_points, reserved_points, purchased_at
) values (
  '94000000-0000-4000-8000-000000000008',
  '92000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000006',
  10, 0, 10, now()
);

insert into public.organization_assignments (
  id, organization_id, member_person_id, course_version_id,
  assigned_by, status, point_price_snapshot, idempotency_key
) values (
  '94000000-0000-4000-8000-000000000009',
  '92000000-0000-4000-8000-000000000001',
  (
    select person_id from public.auth_identities
    where auth_user_id = '91000000-0000-4000-8000-000000000003'
  ),
  '94000000-0000-4000-8000-000000000004',
  (
    select person_id from public.auth_identities
    where auth_user_id = '91000000-0000-4000-8000-000000000001'
  ),
  'active', 10,
  '94000000-0000-4000-8000-000000000010'
);

insert into public.assignment_point_allocations (
  assignment_id, point_lot_id, points, status
) values (
  '94000000-0000-4000-8000-000000000009',
  '94000000-0000-4000-8000-000000000008',
  10, 'reserved'
);

insert into public.entitlements (
  id, person_id, course_version_id, source_type, source_id,
  status, starts_at
) values (
  '94000000-0000-4000-8000-000000000011',
  (
    select person_id from public.auth_identities
    where auth_user_id = '91000000-0000-4000-8000-000000000003'
  ),
  '94000000-0000-4000-8000-000000000004',
  'organization_assignment',
  '94000000-0000-4000-8000-000000000009',
  'active', now()
);

insert into public.enrollments (
  id, person_id, course_version_id, entitlement_id, status
) values (
  '94000000-0000-4000-8000-000000000012',
  (
    select person_id from public.auth_identities
    where auth_user_id = '91000000-0000-4000-8000-000000000003'
  ),
  '94000000-0000-4000-8000-000000000004',
  '94000000-0000-4000-8000-000000000011',
  'active'
);

insert into public.live_sessions (
  id, course_version_id, title, status,
  starts_at, ends_at, booking_close_at,
  learner_capacity, verified_zoom_total_capacity,
  scheduled_teaching_seconds, evidence_settles_at,
  application_idempotency_key, created_by
) values (
  '94000000-0000-4000-8000-000000000013',
  '94000000-0000-4000-8000-000000000004',
  '機構直播指派生命週期測試場', 'draft',
  now() + interval '5 minutes', now() + interval '65 minutes',
  now() - interval '1 minute',
  50, 100, 3600, now() + interval '24 hours 65 minutes',
  '94000000-0000-4000-8000-000000000014',
  (
    select person_id from public.auth_identities
    where auth_user_id = '91000000-0000-4000-8000-000000000001'
  )
);

insert into public.live_bookings (
  id, person_id, enrollment_id, course_version_id,
  live_session_id, payer_type, payer_source_id, status,
  customer_key, change_locked_at, idempotency_key
) values (
  '94000000-0000-4000-8000-000000000015',
  (
    select person_id from public.auth_identities
    where auth_user_id = '91000000-0000-4000-8000-000000000003'
  ),
  '94000000-0000-4000-8000-000000000012',
  '94000000-0000-4000-8000-000000000004',
  '94000000-0000-4000-8000-000000000013',
  'organization', '94000000-0000-4000-8000-000000000009',
  'confirmed', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
  now() - interval '23 hours 55 minutes',
  '94000000-0000-4000-8000-000000000016'
);

select extensions.throws_ok(
  $$
    update public.organization_assignments
    set status = 'completed'
    where id = '94000000-0000-4000-8000-000000000009'
  $$,
  'P0001',
  'AUTHORITATIVE_ASSIGNMENT_COMPLETION_REQUIRED',
  'assignment cannot self-declare completion before enrollment completion'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000003',
    'role', 'authenticated', 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000003',
  true
);
set local role authenticated;

select extensions.is(
  (
    public.record_live_check_event(
      '94000000-0000-4000-8000-000000000013',
      'check_in', true,
      '94000000-0000-4000-8000-000000000017'
    ) ->> 'replayed'
  )::boolean,
  false,
  'formal live check-in consumes an active organization assignment'
);
select extensions.is(
  (
    public.record_live_check_event(
      '94000000-0000-4000-8000-000000000013',
      'check_in', true,
      '94000000-0000-4000-8000-000000000018'
    ) ->> 'replayed'
  )::boolean,
  true,
  'a repeated live check-in is a replay and does not consume twice'
);
reset role;

select extensions.is(
  (
    select status from public.organization_assignments
    where id = '94000000-0000-4000-8000-000000000009'
  ),
  'consumed',
  'active live assignment advances to consumed at first formal check-in'
);
select extensions.is(
  (
    select count(*)::integer
    from public.point_ledger_events
    where assignment_id = '94000000-0000-4000-8000-000000000009'
      and event_type = 'consumed'
  ),
  1,
  'formal live check-in creates exactly one funding ledger event'
);
select extensions.is(
  (
    select coalesce(sum(points), 0)::bigint
    from public.point_ledger_events
    where assignment_id = '94000000-0000-4000-8000-000000000009'
      and event_type = 'consumed'
  ),
  10::bigint,
  'funding ledger evidence exactly matches the assignment price'
);
select extensions.ok(
  (
    select wallet.reserved_points = 0
      and wallet.consumed_points = 10
    from public.organization_wallets wallet
    where wallet.organization_id =
      '92000000-0000-4000-8000-000000000001'
  ),
  'organization wallet moves the live assignment points exactly once'
);
select extensions.ok(
  internal.organization_assignment_has_consumption_proof(
    '94000000-0000-4000-8000-000000000009'
  ),
  'allocation and append-only ledger jointly prove funded consumption'
);

select extensions.lives_ok(
  $$
    update public.enrollments
    set status = 'completed', completed_at = now()
    where id = '94000000-0000-4000-8000-000000000012'
  $$,
  'authoritative enrollment completion synchronizes the funded assignment'
);

select extensions.is(
  (
    select status from public.organization_assignments
    where id = '94000000-0000-4000-8000-000000000009'
  ),
  'completed',
  'consumed assignment becomes completed only from authoritative completion'
);

update public.live_bookings
set status = 'attended'
where id = '94000000-0000-4000-8000-000000000015';

select extensions.throws_ok(
  $$
    update public.organization_memberships
    set active = false, left_at = now()
    where organization_id = '92000000-0000-4000-8000-000000000001'
      and role = 'owner'
  $$,
  'P0001',
  'ACTIVE_ORGANIZATION_OWNER_REQUIRED',
  'database rejects deactivating the last active organization owner'
);

select extensions.lives_ok(
  $$
    insert into public.instructors (
      person_id, display_name, biography, credentials
    ) values (
      (
        select person_id from public.auth_identities
        where auth_user_id = '91000000-0000-4000-8000-000000000006'
      ),
      '有效講師', '足以通過資料庫檢核的公開講師簡介',
      '長期照顧專業講師'
    )
  $$,
  'an active instructor-role person can own an instructor profile'
);

select extensions.throws_ok(
  $$
    insert into public.instructors (
      person_id, display_name, biography, credentials
    ) values (
      (
        select person_id from public.auth_identities
        where auth_user_id = '91000000-0000-4000-8000-000000000003'
      ),
      '一般成員', '一般成員不能偽裝成為平台的有效講師',
      '沒有講師角色'
    )
  $$,
  'P0001',
  'ACTIVE_INSTRUCTOR_ROLE_REQUIRED',
  'an ordinary person cannot be bound to an active instructor profile'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;

select extensions.throws_ok(
  $$
    select public.manage_organization_member(
      '92000000-0000-4000-8000-000000000001',
      (
        select person_id from public.auth_identities
        where auth_user_id = '91000000-0000-4000-8000-000000000003'
      ),
      'finance', true, '', '', '培訓管理員不得晉升財務角色',
      '93000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'ORGANIZATION_MEMBER_CHANGE_REJECTED',
  'training manager cannot promote a member to finance'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select extensions.lives_ok(
  $$
    select public.bind_course_instructor(
      '94000000-0000-4000-8000-000000000004',
      (
        select id from public.staff_roles
        where role = 'instructor' and active
        limit 1
      ),
      'AB', '0123456789|ABCDEFGHIJ', 'CRED5',
      '93000000-0000-4000-8000-000000000006'
    )
  $$,
  'instructor binding accepts the first complete canonical payload'
);
select extensions.throws_ok(
  $$
    select public.bind_course_instructor(
      '94000000-0000-4000-8000-000000000004',
      (
        select id from public.staff_roles
        where role = 'instructor' and active
        limit 1
      ),
      'AB|0123456789', 'ABCDEFGHIJ', 'CRED5',
      '93000000-0000-4000-8000-000000000006'
    )
  $$,
  'P0001',
  'IDEMPOTENCY_REQUEST_CONFLICT',
  'canonical instructor hash rejects a delimiter cross-field collision'
);
select extensions.lives_ok(
  $$
    select public.update_organization_profile(
      '92000000-0000-4000-8000-000000000001',
      '王小姐', 'contact@example.test', 'invoice@example.test',
      '歲悅機構', '台北|三樓',
      '93000000-0000-4000-8000-000000000007'
    )
  $$,
  'organization profile accepts the first complete canonical payload'
);
select extensions.throws_ok(
  $$
    select public.update_organization_profile(
      '92000000-0000-4000-8000-000000000001',
      '王小姐', 'contact@example.test', 'invoice@example.test',
      '歲悅機構|台北', '三樓',
      '93000000-0000-4000-8000-000000000007'
    )
  $$,
  'P0001',
  'IDEMPOTENCY_REQUEST_CONFLICT',
  'canonical organization hash rejects a delimiter cross-field collision'
);

select extensions.lives_ok(
  $$
    select public.manage_organization_member(
      '92000000-0000-4000-8000-000000000001',
      (
        select person_id from public.auth_identities
        where auth_user_id = '91000000-0000-4000-8000-000000000003'
      ),
      'member', false, '', '', '完成機構出資課程後辦理離職',
      '93000000-0000-4000-8000-000000000005'
    )
  $$,
  'completed funded assignment no longer blocks member offboarding'
);
select extensions.is(
  (
    select count(*)::integer
    from public.organization_assignment_outcome_snapshots
    where assignment_id = '94000000-0000-4000-8000-000000000009'
  ),
  1,
  'offboarding freezes only the authoritative funded completion outcome'
);
select extensions.throws_ok(
  $$
    select public.manage_organization_member(
      '92000000-0000-4000-8000-000000000001',
      (
        select person_id from public.auth_identities
        where auth_user_id = '91000000-0000-4000-8000-000000000003'
      ),
      'member', false, '', '變造部門', '完成機構出資課程後辦理離職',
      '93000000-0000-4000-8000-000000000005'
    )
  $$,
  'P0001',
  'IDEMPOTENCY_KEY_REUSED',
  'member-management idempotency binds the complete canonical request'
);

select extensions.lives_ok(
  $$
    select public.create_support_case(
      'organization', '機構客服測試案件',
      '請協助確認機構工作台顯示狀態',
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000002'
    )
  $$,
  'organization owner can create an organization-scoped support case'
);
select extensions.is(
  jsonb_array_length(public.read_support_center() -> 'cases'),
  1,
  'case creator can read the scoped support thread'
);
select extensions.is(
  public.read_support_center() -> 'cases' -> 0 ->> 'summary',
  '機構客服測試案件',
  'customer sees the original support summary'
);
select extensions.is(
  public.read_support_center()
    -> 'cases' -> 0 -> 'messages' -> 0 ->> 'body',
  '請協助確認機構工作台顯示狀態',
  'customer sees the original support message'
);
select extensions.throws_ok(
  $$
    select public.create_support_case(
      'organization', '同鍵不同客服主旨',
      '請協助確認機構工作台顯示狀態',
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000002'
    )
  $$,
  'P0001',
  'IDEMPOTENCY_KEY_REUSED',
  'case-creation idempotency binds the complete canonical request'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;
select extensions.is(
  jsonb_array_length(public.read_support_center() -> 'cases'),
  1,
  'active organization manager can read the organization support thread'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select extensions.lives_ok(
  $$
    select public.manage_organization_member(
      '92000000-0000-4000-8000-000000000001',
      (
        select person_id from public.auth_identities
        where auth_user_id = '91000000-0000-4000-8000-000000000002'
      ),
      'training_manager', false, '', '',
      '組織角色生命週期離職測試',
      '93000000-0000-4000-8000-000000000004'
    )
  $$,
  'owner can offboard a manager without unsettled funded activity'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;
select extensions.is(
  jsonb_array_length(public.read_support_center() -> 'cases'),
  0,
  'offboarded manager loses access to organization support threads'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000004',
    'role', 'authenticated', 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000004',
  true
);
set local role authenticated;
select extensions.is(
  jsonb_array_length(public.read_support_center() -> 'cases'),
  0,
  'another organization cannot read the first tenant support case'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000005',
    'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000005',
  true
);
set local role authenticated;

select extensions.ok(
  public.authorize_exact_staff_role('support'),
  'active AAL2 support role passes exact-role authorization'
);
select extensions.ok(
  not public.authorize_exact_staff_role('accreditation_reviewer'),
  'support cannot escalate to accreditation reviewer'
);
select extensions.is(
  (
    public.read_support_queue()
      -> 'cases' -> 0 ->> 'canReadThread'
  )::boolean,
  false,
  'unassigned support queue exposes no thread'
);
select extensions.is(
  public.read_support_queue()
    -> 'cases' -> 0 ->> 'safePreview',
  '機構培訓案件；內容需透過安全補件流程',
  'support queue exposes only the server-generated structured preview'
);
select extensions.ok(
  position(
    '機構客服測試案件' in public.read_support_queue()::text
  ) = 0
    and position(
      '請協助確認機構工作台顯示狀態'
      in public.read_support_queue()::text
    ) = 0,
  'support queue never returns raw customer summary or message text'
);
select extensions.lives_ok(
  $$
    select public.act_on_support_case(
      (select id from public.support_cases limit 1),
      'assign',
      (
        select id from public.staff_roles
        where role = 'support' and active
        limit 1
      ),
      null, null, null, '客服自領測試案件',
      '93000000-0000-4000-8000-000000000003'
    )
  $$,
  'support can atomically claim a masked queue case'
);
select extensions.is(
  jsonb_array_length(
    public.read_support_queue() -> 'cases' -> 0 -> 'messages'
  ),
  1,
  'only the assigned support agent receives the case thread'
);
select extensions.is(
  public.read_support_queue()
    -> 'cases' -> 0 -> 'messages' -> 0 ->> 'body',
  '客戶內容需透過安全補件流程',
  'assigned support still receives a fixed placeholder for customer text'
);
select extensions.throws_ok(
  $$
    select public.act_on_support_case(
      (select id from public.support_cases limit 1),
      'assign',
      (
        select id from public.staff_roles
        where role = 'support' and active
        limit 1
      ),
      null, null, null, '同鍵改寫客服處理原因',
      '93000000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'IDEMPOTENCY_KEY_REUSED',
  'support-action idempotency binds the complete canonical request'
);
reset role;

select extensions.is(
  internal.redact_support_text(
    'foo@example.test / 0912-345-678 / A123456789 / '
      || 'A812345678 / 1234-5678-9012 / 照服員 CW-98765'
  ),
  '[已遮罩電子郵件] / [已遮罩行動電話] / '
    || '[已遮罩身分識別碼] / [已遮罩居留識別碼] / '
    || '[已遮罩帳號或長數字] / [已遮罩長照人員識別碼]',
  'support redaction masks separated email, phone, ID, account, and worker IDs'
);
select extensions.throws_ok(
  $$
    delete from public.support_cases
  $$,
  'P0001',
  'SUPPORT_CASE_DELETE_FORBIDDEN',
  'support case identity and history cannot be deleted'
);
select extensions.throws_ok(
  $$
    update public.support_cases
    set status = 'investigating'
  $$,
  'P0001',
  'SUPPORT_CASE_EVENT_REQUIRED',
  'support case status projection requires a matching event transaction'
);
select extensions.throws_ok(
  $$
    update public.support_case_messages
    set body = '不可覆寫'
  $$,
  'P0001',
  'APPEND_ONLY_TABLE',
  'support messages are append-only'
);
select extensions.ok(
  not has_table_privilege(
    'authenticated', 'public.support_case_messages', 'select'
  ),
  'browser roles have no direct support message table read'
);
select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'public.organization_assignment_outcome_snapshots',
    'update'
  ),
  'browser roles cannot mutate offboarding outcome snapshots'
);
select extensions.ok(
  not has_function_privilege(
    'anon', 'public.read_support_queue()', 'execute'
  ),
  'anonymous role cannot execute the support queue wrapper'
);
select extensions.ok(
  has_function_privilege(
    'authenticated', 'public.read_support_queue()', 'execute'
  ),
  'authenticated role receives the explicit support queue wrapper grant'
);
select extensions.lives_ok(
  $$
    do $system_case$
    declare
      generated_reference text;
    begin
      insert into public.support_cases (kind, summary)
      values ('live_session_cancelled', '系統建立的直播取消客服案件')
      returning public_reference into generated_reference;
      if generated_reference !~ '^SUP-[A-F0-9]{12}$' then
        raise exception 'SUPPORT_REFERENCE_DEFAULT_MISSING';
      end if;
    end
    $system_case$
  $$,
  'system-created support cases receive a safe reference default'
);

select * from extensions.finish();
rollback;
