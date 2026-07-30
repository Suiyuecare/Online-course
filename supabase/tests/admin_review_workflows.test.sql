begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;

select extensions.plan(21);

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '99400000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', '+886912994001', now(),
    '{}'::jsonb, '{"display_name":"平台管理員"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '99400000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', '+886912994002', now(),
    '{}'::jsonb, '{"display_name":"機構申請人"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '99400000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', '+886912994003', now(),
    '{}'::jsonb, '{"display_name":"課程管理員"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '99400000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', '+886912994004', now(),
    '{}'::jsonb, '{"display_name":"積分審核員"}'::jsonb, now(), now()
  );

select set_config(
  'test.review.platform_admin',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '99400000-0000-4000-8000-000000000001'
  ),
  true
);
select set_config(
  'test.review.applicant',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '99400000-0000-4000-8000-000000000002'
  ),
  true
);
select set_config(
  'test.review.course_admin',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '99400000-0000-4000-8000-000000000003'
  ),
  true
);
select set_config(
  'test.review.accreditation_reviewer',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '99400000-0000-4000-8000-000000000004'
  ),
  true
);

update public.people
set verified_email = 'applicant@example.test',
    email_verified_at = now()
where id = current_setting('test.review.applicant')::uuid;

insert into public.staff_roles (person_id, role)
values
  (
    current_setting('test.review.platform_admin')::uuid,
    'platform_admin'
  ),
  (
    current_setting('test.review.course_admin')::uuid,
    'course_admin'
  ),
  (
    current_setting('test.review.accreditation_reviewer')::uuid,
    'accreditation_reviewer'
  );

insert into public.organizations (
  id, legal_name, tax_id_blind_index, tax_id_last_four,
  contact_person_id, contact_name, contact_email, invoice_email,
  status, application_idempotency_key
) values (
  '99410000-0000-4000-8000-000000000001',
  '歲悅審核測試機構',
  repeat('9', 64),
  '5678',
  current_setting('test.review.applicant')::uuid,
  '機構申請人',
  'applicant@example.test',
  'applicant@example.test',
  'submitted',
  '99410000-0000-4000-8000-000000000002'
);

insert into public.organization_memberships (
  organization_id, person_id, role
) values (
  '99410000-0000-4000-8000-000000000001',
  current_setting('test.review.applicant')::uuid,
  'owner'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.read_organization_application_review(uuid)',
    'execute'
  ),
  'authenticated platform staff can resolve the safe review projection'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.read_organization_application_review(uuid)',
    'execute'
  ),
  'anonymous callers cannot read organization review data'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.review_organization_application(uuid,text,text,uuid)',
    'execute'
  ),
  'authenticated staff can resolve the idempotent review command'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.review_organization_application(uuid,text,text)',
    'execute'
  ),
  'the unbound legacy organization review command is revoked'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.submit_course_version_for_review(uuid,text,uuid)',
    'execute'
  ),
  'course submission exposes only the idempotent command'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.submit_course_version_for_review(uuid,text)',
    'execute'
  ),
  'the legacy unbound course submission command is revoked'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.publish_course_version(uuid,text,text,uuid)',
    'execute'
  ),
  'course publication exposes the request-bound command'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.publish_course_version(uuid,text,text)',
    'execute'
  ),
  'the legacy unbound publication command is revoked'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99400000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '99400000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

set local role authenticated;
select extensions.is(
  public.read_organization_application_review(
    '99410000-0000-4000-8000-000000000001'
  ) ->> 'taxIdMasked',
  '****5678',
  'staff receives only the masked business number'
);
select extensions.ok(
  not (
    public.read_organization_application_review(
      '99410000-0000-4000-8000-000000000001'
    ) ? 'taxIdBlindIndex'
  ),
  'the safe projection does not expose the blind index'
);
select set_config(
  'test.review.organization_response',
  public.review_organization_application(
    '99410000-0000-4000-8000-000000000001',
    'approve',
    '統編唯一且聯絡資料一致，核准機構開通。',
    '99420000-0000-4000-8000-000000000001'
  )::text,
  true
);
select extensions.is(
  current_setting('test.review.organization_response')::jsonb ->> 'status',
  'approved',
  'a platform administrator can approve with a reason'
);
select extensions.is(
  public.review_organization_application(
    '99410000-0000-4000-8000-000000000001',
    'approve',
    '統編唯一且聯絡資料一致，核准機構開通。',
    '99420000-0000-4000-8000-000000000001'
  ),
  current_setting('test.review.organization_response')::jsonb,
  'an exact organization review retry replays its stored response'
);
select extensions.throws_ok(
  $$
    select public.review_organization_application(
      '99410000-0000-4000-8000-000000000001',
      'reject',
      '重複使用相同鍵但改變決定，必須拒絕。',
      '99420000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'IDEMPOTENCY_REQUEST_CONFLICT',
  'an idempotency key cannot be rebound to a different decision'
);
reset role;

insert into public.courses (
  id, slug, internal_title, created_by
) values (
  '99430000-0000-4000-8000-000000000001',
  'admin-review-test-course',
  '後台審核測試課',
  current_setting('test.review.course_admin')::uuid
);
insert into public.course_versions (
  id, course_id, version, title, summary, description,
  delivery_type, status, created_by, submitted_by, submitted_at,
  authoring_idempotency_key
) values (
  '99430000-0000-4000-8000-000000000002',
  '99430000-0000-4000-8000-000000000001',
  1,
  '後台審核網路課程',
  '測試安全退回流程',
  '已建立的內容在退回或駁回後都必須保留。',
  'recorded',
  'in_review',
  current_setting('test.review.course_admin')::uuid,
  current_setting('test.review.course_admin')::uuid,
  now(),
  '99430000-0000-4000-8000-000000000003'
);
insert into public.modules (
  id, course_version_id, title, sort_order
) values (
  '99430000-0000-4000-8000-000000000004',
  '99430000-0000-4000-8000-000000000002',
  '必須保留的課程單元',
  0
);
insert into public.course_publication_reviews (
  id, course_version_id, submitted_by, status, checklist, reason
) values (
  '99430000-0000-4000-8000-000000000005',
  '99430000-0000-4000-8000-000000000002',
  current_setting('test.review.course_admin')::uuid,
  'pending',
  '{"submittedAt":"2026-07-30T03:18:22Z"}'::jsonb,
  '課程內容已完成，送請獨立覆核。'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99400000-0000-4000-8000-000000000004',
    'role', 'authenticated',
    'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '99400000-0000-4000-8000-000000000004',
  true
);
set local role authenticated;
select extensions.is(
  public.read_course_submission_review(
    '99430000-0000-4000-8000-000000000002'
  ) ->> 'canDecide',
  'true',
  'a separate accreditation reviewer can decide the submission'
);
select set_config(
  'test.review.course_response',
  public.review_course_version_submission(
    '99430000-0000-4000-8000-000000000002',
    'return_for_correction',
    '請補充第二章的照護情境與測驗解析後再次送審。',
    '99440000-0000-4000-8000-000000000001'
  )::text,
  true
);
select extensions.is(
  current_setting('test.review.course_response')::jsonb
    ->> 'contentPreserved',
  'true',
  'the review response explicitly confirms content preservation'
);
select extensions.is(
  public.review_course_version_submission(
    '99430000-0000-4000-8000-000000000002',
    'return_for_correction',
    '請補充第二章的照護情境與測驗解析後再次送審。',
    '99440000-0000-4000-8000-000000000001'
  ),
  current_setting('test.review.course_response')::jsonb,
  'an exact course decision retry replays the stored response'
);
select extensions.throws_ok(
  $$
    select public.review_course_version_submission(
      '99430000-0000-4000-8000-000000000002',
      'reject',
      '相同鍵改成駁回決定，資料庫必須拒絕重綁。',
      '99440000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'IDEMPOTENCY_REQUEST_CONFLICT',
  'a course decision idempotency key cannot be rebound'
);
reset role;

select extensions.is(
  (
    select status from public.course_versions
    where id = '99430000-0000-4000-8000-000000000002'
  ),
  'draft',
  'a returned course becomes an editable draft'
);
select extensions.is(
  (
    select count(*)::integer from public.modules
    where course_version_id =
      '99430000-0000-4000-8000-000000000002'
  ),
  1,
  'authored modules remain after the review decision'
);
select extensions.is(
  (
    select checklist ->> 'decision'
    from public.course_publication_reviews
    where id = '99430000-0000-4000-8000-000000000005'
  ),
  'return_for_correction',
  'the append-only review history records the explicit decision'
);
select extensions.ok(
  exists (
    select 1 from public.audit_events
    where action = 'course.returned_for_correction'
      and target_id = '99430000-0000-4000-8000-000000000002'
  ),
  'the course decision appends an audit event'
);

rollback;
