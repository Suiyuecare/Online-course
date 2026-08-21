begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;

select extensions.plan(39);

select extensions.results_eq(
  $$
    select column_name::text collate "C"
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'course_versions'
      and column_name in (
        'registration_mode',
        'external_registration_url',
        'registration_cta_label'
      )
    order by column_name::text collate "C"
  $$,
  $$
    values
      ('external_registration_url'::text collate "C"),
      ('registration_cta_label'::text collate "C"),
      ('registration_mode'::text collate "C")
  $$,
  'course versions store all three registration settings'
);

select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.course_versions'::regclass
      and constraint_row.conname =
        'course_versions_registration_target_check'
      and position(
        'external_registration_url IS NOT NULL'
        in pg_get_constraintdef(constraint_row.oid)
      ) > 0
  ),
  'Google Form mode requires a non-null URL at the table boundary'
);

select extensions.results_eq(
  $$
    select column_name::text collate "C"
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'published_course_catalog'
      and column_name in (
        'registration_mode',
        'external_registration_url',
        'registration_cta_label'
      )
    order by column_name::text collate "C"
  $$,
  $$
    values
      ('external_registration_url'::text collate "C"),
      ('registration_cta_label'::text collate "C"),
      ('registration_mode'::text collate "C")
  $$,
  'the public catalog projects exactly the three registration fields'
);

select extensions.ok(
  position(
    'join lateral'
    in lower(pg_get_viewdef('public.published_course_catalog'::regclass, true))
  ) > 0
  and position(
    'candidate.published_at desc nulls last'
    in lower(pg_get_viewdef('public.published_course_catalog'::regclass, true))
  ) > 0
  and position(
    'candidate.version desc'
    in lower(pg_get_viewdef('public.published_course_catalog'::regclass, true))
  ) > 0
  and position(
    'limit 1'
    in lower(pg_get_viewdef('public.published_course_catalog'::regclass, true))
  ) > 0,
  'the catalog selects only the deterministic latest published version'
);

select extensions.ok(
  has_column_privilege(
    'anon', 'public.course_versions', 'registration_mode', 'select'
  )
  and has_column_privilege(
    'anon', 'public.course_versions', 'external_registration_url', 'select'
  )
  and has_column_privilege(
    'anon', 'public.course_versions', 'registration_cta_label', 'select'
  )
  and has_column_privilege(
    'authenticated',
    'public.course_versions',
    'external_registration_url',
    'select'
  ),
  'security-invoker catalog callers can resolve the projected columns'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.update_course_registration_settings(uuid,text,text,text,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.read_education_quality_workspace()',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.update_course_registration_settings(uuid,text,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.read_education_quality_workspace()',
    'execute'
  ),
  'only authenticated staff can reach the teaching-quality facade'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'internal.publish_course_version_idempotent(uuid,text,text,uuid)',
    'execute'
  ),
  'authenticated callers cannot bypass the guarded publication facade'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'internal.publish_course_version_as_platform_admin(uuid,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'internal.publish_course_version_as_platform_admin(uuid,text,text,uuid)',
    'execute'
  ),
  'the only executable internal publication capability carries its own CEO guard'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'internal.create_b2c_order(uuid,uuid,jsonb,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'internal.create_b2c_order_guarded(uuid,uuid,jsonb,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'internal.assign_organization_course(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'internal.assign_organization_course_guarded(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'internal.batch_assign_organization_course(uuid,uuid[],uuid,uuid,timestamptz,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'internal.batch_assign_organization_course_guarded(uuid,uuid[],uuid,uuid,timestamptz,uuid)',
    'execute'
  ),
  'all B2C and B2B course-allocation capabilities use registration guards'
);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.provision_education_quality_staff(uuid,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'internal.provision_education_quality_staff(uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.provision_education_quality_staff(uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.provision_education_quality_staff(uuid,text)',
    'execute'
  ),
  'staff provisioning is service-role only'
);

select extensions.is(
  internal.before_user_created(jsonb_build_object(
    'user', jsonb_build_object(
      'email', 'edu.control@suiyuecare.com',
      'app_metadata', jsonb_build_object(
        'provider', 'email',
        'account_type', 'staff',
        'staff_login', true,
        'staff_role', 'course_admin',
        'must_change_password', true
      )
    )
  )),
  '{}'::jsonb,
  'the protected teaching-quality account passes the Auth hook'
);

select extensions.is(
  internal.before_user_created(jsonb_build_object(
    'user', jsonb_build_object(
      'email', 'attacker@example.test',
      'app_metadata', jsonb_build_object(
        'provider', 'email',
        'account_type', 'staff',
        'staff_login', true,
        'staff_role', 'course_admin',
        'must_change_password', true
      )
    )
  )) -> 'error' ->> 'message',
  'Phone authentication or a pre-approved staff account is required.',
  'an arbitrary email cannot copy protected staff claims through the hook'
);

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '99600000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', '+886912996001', now(),
    '{"provider":"phone"}'::jsonb,
    '{"display_name":"品管甲"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '99600000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', '+886912996002', now(),
    '{"provider":"phone"}'::jsonb,
    '{"display_name":"品管乙"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '99600000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', '+886912996003', now(),
    '{"provider":"phone"}'::jsonb,
    '{"display_name":"執行長"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '99600000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', '+886912996004', now(),
    '{"provider":"phone"}'::jsonb,
    '{"display_name":"積分審核員"}'::jsonb, now(), now()
  );

insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '99600000-0000-4000-8000-000000000005',
  'authenticated', 'authenticated', 'edu.control@suiyuecare.com', now(),
  jsonb_build_object(
    'provider', 'email',
    'providers', jsonb_build_array('email'),
    'account_type', 'staff',
    'staff_login', true,
    'staff_role', 'course_admin',
    'must_change_password', true
  ),
  '{"display_name":"教學品管部"}'::jsonb, now(), now()
);

select set_config(
  'test.education.admin_a',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '99600000-0000-4000-8000-000000000001'
  ),
  true
);
select set_config(
  'test.education.admin_b',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '99600000-0000-4000-8000-000000000002'
  ),
  true
);
select set_config(
  'test.education.executive',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '99600000-0000-4000-8000-000000000003'
  ),
  true
);
select set_config(
  'test.education.reviewer',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '99600000-0000-4000-8000-000000000004'
  ),
  true
);

insert into public.staff_roles (person_id, role) values
  (current_setting('test.education.admin_a')::uuid, 'course_admin'),
  (current_setting('test.education.admin_b')::uuid, 'course_admin'),
  (current_setting('test.education.executive')::uuid, 'platform_admin'),
  (current_setting('test.education.reviewer')::uuid, 'accreditation_reviewer');

select extensions.ok(
  exists (
    select 1
    from public.auth_identities identity
    join public.people person on person.id = identity.person_id
    where identity.auth_user_id =
      '99600000-0000-4000-8000-000000000005'
      and person.verified_email = 'edu.control@suiyuecare.com'
      and person.email_verified_at is not null
  ),
  'the protected email identity is mapped without weakening phone identities'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);
select extensions.throws_ok(
  $$
    select public.provision_education_quality_staff(
      '99600000-0000-4000-8000-000000000005',
      'other.staff@suiyuecare.com'
    )
  $$,
  'P0001',
  'STAFF_PROVISIONING_REJECTED',
  'service provisioning is pinned to the pre-approved department account'
);
set local role service_role;
do $provision$
begin
  perform public.provision_education_quality_staff(
    '99600000-0000-4000-8000-000000000005',
    'edu.control@suiyuecare.com'
  );
end
$provision$;
reset role;

select extensions.ok(
  exists (
    select 1
    from public.staff_roles role
    join public.auth_identities identity
      on identity.person_id = role.person_id
    where identity.auth_user_id =
      '99600000-0000-4000-8000-000000000005'
      and role.role = 'course_admin'
      and role.active
  ),
  'service provisioning binds only the protected account to course_admin'
);

insert into public.courses (
  id, slug, internal_title, created_by
) values
  (
    '99610000-0000-4000-8000-000000000001',
    'education-quality-owner-a',
    '品管甲的課程',
    current_setting('test.education.admin_a')::uuid
  ),
  (
    '99610000-0000-4000-8000-000000000002',
    'education-quality-owner-b',
    '品管乙的課程',
    current_setting('test.education.admin_b')::uuid
  );

insert into public.course_versions (
  id, course_id, version, title, summary, description,
  learning_objectives, category_code, delivery_type, status, has_cover,
  created_by, authoring_idempotency_key
) values
  (
    '99620000-0000-4000-8000-000000000001',
    '99610000-0000-4000-8000-000000000001',
    1, '品管甲測試課',
    '完整說明居家照顧服務的報名課程內容',
    '這是給學員與家屬閱讀的完整課程說明，包含學習重點、報名方式與上課準備資訊。',
    '["了解居家照顧服務的核心流程"]'::jsonb,
    'daily_care_skills', 'recorded', 'draft', true,
    current_setting('test.education.admin_a')::uuid,
    '99620000-0000-4000-8000-000000000011'
  ),
  (
    '99620000-0000-4000-8000-000000000002',
    '99610000-0000-4000-8000-000000000002',
    1, '品管乙測試課', '測試課程摘要', '測試課程詳情',
    '["測試目標"]'::jsonb,
    'daily_care_skills', 'live', 'draft', false,
    current_setting('test.education.admin_b')::uuid,
    '99620000-0000-4000-8000-000000000012'
  );

insert into public.instructors (
  id, display_name, biography, credentials, active
) values (
  '99615000-0000-4000-8000-000000000001',
  '照顧課程講師',
  '長期參與居家照顧與家屬支持工作。',
  '長照專業講師資格',
  true
);
insert into public.course_instructors (
  course_version_id, instructor_id, sort_order
) values (
  '99620000-0000-4000-8000-000000000001',
  '99615000-0000-4000-8000-000000000001',
  0
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99600000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '99600000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

set local role authenticated;
select extensions.is(
  public.update_course_registration_settings(
    '99620000-0000-4000-8000-000000000001',
    'google_form',
    'https://forms.gle/AbCdEf123',
    '報名活動',
    '99630000-0000-4000-8000-000000000001'
  ) ->> 'registrationMode',
  'google_form',
  'a course admin can configure a valid Google short-form URL on their draft'
);
select extensions.throws_ok(
  $$
    select public.update_course_registration_settings(
      '99620000-0000-4000-8000-000000000001',
      'google_form',
      'https://forms.gle/AbCdEf123?entry.123=private',
      '報名活動',
      '99630000-0000-4000-8000-000000000007'
    )
  $$,
  'P0001',
  'COURSE_REGISTRATION_SETTINGS_INVALID',
  'the database refuses a stored Google Form prefill query'
);
select extensions.throws_ok(
  $$
    select public.update_course_registration_settings(
      '99620000-0000-4000-8000-000000000001',
      'google_form',
      null,
      '報名活動',
      '99630000-0000-4000-8000-000000000002'
    )
  $$,
  'P0001',
  'COURSE_REGISTRATION_SETTINGS_INVALID',
  'Google Form mode rejects a null registration URL'
);
select extensions.throws_ok(
  $$
    select public.update_course_registration_settings(
      '99620000-0000-4000-8000-000000000001',
      'google_form',
      'https://forms.gle.attacker.test/AbCdEf123',
      '報名活動',
      '99630000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'COURSE_REGISTRATION_SETTINGS_INVALID',
  'a lookalike Google Forms host is rejected'
);
select extensions.throws_ok(
  $$
    select public.update_course_registration_settings(
      '99620000-0000-4000-8000-000000000002',
      'google_form',
      'https://forms.gle/ForeignDraft123',
      '報名活動',
      '99630000-0000-4000-8000-000000000004'
    )
  $$,
  'P0001',
  'COURSE_REGISTRATION_SETTINGS_FORBIDDEN',
  'a course admin cannot change another creator''s draft'
);
select extensions.is(
  jsonb_array_length(
    public.read_education_quality_workspace() -> 'courses'
  ),
  1,
  'a course admin workspace contains only that creator''s course versions'
);
select extensions.throws_ok(
  $$
    select public.submit_course_version_for_review(
      '99620000-0000-4000-8000-000000000002',
      '不允許送出其他品管人員所建立的課程草稿。',
      '99630000-0000-4000-8000-000000000008'
    )
  $$,
  'P0001',
  'COURSE_SUBMISSION_REJECTED',
  'a course administrator cannot submit another creator''s draft'
);
select extensions.is(
  public.submit_course_version_for_review(
    '99620000-0000-4000-8000-000000000001',
    '課程報名頁資料已完成，送交執行長進行獨立審核。',
    '99630000-0000-4000-8000-000000000009'
  ) ->> 'status',
  'in_review',
  'the creator can submit a complete Google Form page without formal commerce gates'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99600000-0000-4000-8000-000000000004',
    'role', 'authenticated',
    'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '99600000-0000-4000-8000-000000000004',
  true
);
set local role authenticated;
select extensions.throws_ok(
  $$
    select public.publish_course_version(
      '99620000-0000-4000-8000-000000000001',
      '積分審核完成但不是執行長審核。',
      repeat('a', 64),
      '99630000-0000-4000-8000-000000000005'
    )
  $$,
  'P0001',
  'EXECUTIVE_APPROVAL_REQUIRED',
  'an accreditation reviewer cannot publish without executive approval'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99600000-0000-4000-8000-000000000003',
    'role', 'authenticated',
    'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '99600000-0000-4000-8000-000000000003',
  true
);
insert into private.step_up_grants (
  actor_id, action, target, nonce_hash, identity_epoch,
  totp_verified_at, expires_at
) values (
  current_setting('test.education.executive')::uuid,
  'course_publish',
  '99620000-0000-4000-8000-000000000001',
  repeat('b', 64),
  (
    select identity_epoch from public.people
    where id = current_setting('test.education.executive')::uuid
  ),
  now(), now() + interval '4 minutes'
);
set local role authenticated;
select extensions.is(
  jsonb_array_length(
    public.read_education_quality_workspace() -> 'courses'
  ),
  2,
  'the executive platform administrator can oversee all course drafts'
);
select extensions.throws_ok(
  $$
    select public.submit_course_version_for_review(
      '99620000-0000-4000-8000-000000000002',
      '執行長不可代替品管人員送審，避免後續成為自行審核。',
      '99630000-0000-4000-8000-000000000010'
    )
  $$,
  'P0001',
  'COURSE_SUBMISSION_REJECTED',
  'the executive cannot submit a draft and become its own reviewer'
);
select extensions.ok(
  (public.read_course_submission_review(
    '99620000-0000-4000-8000-000000000001'
  ) ->> 'canPublish')::boolean
  and (public.read_course_submission_review(
    '99620000-0000-4000-8000-000000000001'
  ) ->> 'canDecide')::boolean
  and public.read_course_submission_review(
    '99620000-0000-4000-8000-000000000001'
  ) ->> 'externalRegistrationUrl' =
    'https://forms.gle/AbCdEf123',
  'the executive review projection includes a safe target and publish decision'
);
select extensions.is(
  public.update_course_registration_settings(
    '99620000-0000-4000-8000-000000000002',
    'google_form',
    'https://docs.google.com/forms/d/e/FormId_123/viewform',
    '立即報名',
    '99630000-0000-4000-8000-000000000006'
  ) ->> 'externalRegistrationUrl',
  'https://docs.google.com/forms/d/e/FormId_123/viewform',
  'the executive can correct a valid long-form URL on any draft'
);
select extensions.is(
  public.publish_course_version(
    '99620000-0000-4000-8000-000000000001',
    '執行長已檢視學員預覽與報名連結，確認核准並上架。',
    repeat('b', 64),
    '99630000-0000-4000-8000-000000000011'
  ) ->> 'status',
  'published',
  'a separate exact platform administrator publishes the Google Form page'
);
select extensions.ok(
  exists (
    select 1
    from public.published_course_catalog catalog
    where catalog.course_version_id =
      '99620000-0000-4000-8000-000000000001'
      and catalog.registration_mode = 'google_form'
      and catalog.external_registration_url =
        'https://forms.gle/AbCdEf123'
  ),
  'the approved external page enters the existing public catalog without formal gates'
);
select extensions.ok(
  not exists (
    select 1
    from public.course_publication_reviews publication
    where publication.course_version_id =
      '99620000-0000-4000-8000-000000000001'
      and publication.status = 'pending'
  )
  and exists (
    select 1
    from public.course_publication_reviews publication
    where publication.course_version_id =
      '99620000-0000-4000-8000-000000000001'
      and publication.status = 'approved'
      and publication.reviewed_by =
        current_setting('test.education.executive')::uuid
      and publication.reviewed_at is not null
  ),
  'executive publication resolves the submitted review instead of leaving stale pending work'
);
select extensions.throws_ok(
  $$
    select public.create_b2c_order(
      '99620000-0000-4000-8000-000000000001',
      null,
      '{}'::jsonb,
      '99630000-0000-4000-8000-000000000013'
    )
  $$,
  'P0001',
  'EXTERNAL_REGISTRATION_REQUIRED',
  'the legacy no-coupon order RPC cannot purchase an external page'
);
select extensions.throws_ok(
  $$
    select public.create_b2c_order_with_coupon(
      '99620000-0000-4000-8000-000000000001',
      null,
      '{}'::jsonb,
      null,
      '99630000-0000-4000-8000-000000000012'
    )
  $$,
  'P0001',
  'EXTERNAL_REGISTRATION_REQUIRED',
  'a direct order RPC cannot purchase an external registration page'
);
select extensions.throws_ok(
  $$
    select public.assign_organization_course(
      '99640000-0000-4000-8000-000000000001',
      '99600000-0000-4000-8000-000000000001',
      '99620000-0000-4000-8000-000000000001',
      '99630000-0000-4000-8000-000000000014'
    )
  $$,
  'P0001',
  'EXTERNAL_REGISTRATION_REQUIRED',
  'single-member point assignment cannot allocate an external page'
);
select extensions.throws_ok(
  $$
    select public.batch_assign_organization_course(
      '99640000-0000-4000-8000-000000000001',
      array['99600000-0000-4000-8000-000000000001'::uuid],
      '99620000-0000-4000-8000-000000000001',
      null,
      null,
      '99630000-0000-4000-8000-000000000015'
    )
  $$,
  'P0001',
  'EXTERNAL_REGISTRATION_REQUIRED',
  'batch point assignment cannot allocate an external page'
);
select extensions.throws_ok(
  $$
    select public.sync_own_learner_cart(
      'add',
      array['99620000-0000-4000-8000-000000000001'::uuid]
    )
  $$,
  'P0001',
  'EXTERNAL_REGISTRATION_REQUIRED',
  'an external registration page cannot enter the learner cart'
);
select extensions.throws_ok(
  $$
    select public.present_legal_contract(
      '99620000-0000-4000-8000-000000000001',
      repeat('c', 64),
      '127.0.0.1'::inet
    )
  $$,
  'P0001',
  'COURSE_CONTRACT_UNAVAILABLE',
  'an external registration page cannot enter the platform contract flow'
);
reset role;

select extensions.ok(
  exists (
    select 1
    from public.audit_events event
    where event.action = 'course.registration_settings_updated'
      and event.target_id = '99620000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1
    from public.audit_events event
    where event.action = 'course.registration_settings_updated'
      and event.target_id = '99620000-0000-4000-8000-000000000002'
  ),
  'registration changes append auditable events for the creator and executive'
);

select extensions.is(
  (
    select registration_cta_label
    from public.course_versions
    where id = '99620000-0000-4000-8000-000000000002'
  ),
  '立即報名',
  'the executive correction persists the learner-facing call-to-action label'
);

rollback;
