begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;

select extensions.plan(24);

select extensions.results_eq(
  $$
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'course_versions'
      and column_name in (
        'registration_mode',
        'external_registration_url',
        'registration_cta_label'
      )
    order by column_name
  $$,
  $$
    values
      ('external_registration_url'::text),
      ('registration_cta_label'::text),
      ('registration_mode'::text)
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
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'published_course_catalog'
      and column_name in (
        'registration_mode',
        'external_registration_url',
        'registration_cta_label'
      )
    order by column_name
  $$,
  $$
    values
      ('external_registration_url'::text),
      ('registration_cta_label'::text),
      ('registration_mode'::text)
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
  delivery_type, status, created_by, authoring_idempotency_key
) values
  (
    '99620000-0000-4000-8000-000000000001',
    '99610000-0000-4000-8000-000000000001',
    1, '品管甲測試課', '測試課程摘要', '測試課程詳情',
    'recorded', 'draft',
    current_setting('test.education.admin_a')::uuid,
    '99620000-0000-4000-8000-000000000011'
  ),
  (
    '99620000-0000-4000-8000-000000000002',
    '99610000-0000-4000-8000-000000000002',
    1, '品管乙測試課', '測試課程摘要', '測試課程詳情',
    'live', 'draft',
    current_setting('test.education.admin_b')::uuid,
    '99620000-0000-4000-8000-000000000012'
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
    'https://forms.gle/AbCdEf123?usp=sf_link',
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
set local role authenticated;
select extensions.is(
  jsonb_array_length(
    public.read_education_quality_workspace() -> 'courses'
  ),
  2,
  'the executive platform administrator can oversee all course drafts'
);
select extensions.is(
  public.update_course_registration_settings(
    '99620000-0000-4000-8000-000000000002',
    'google_form',
    'https://docs.google.com/forms/d/e/FormId_123/viewform?usp=sharing',
    '立即報名',
    '99630000-0000-4000-8000-000000000006'
  ) ->> 'externalRegistrationUrl',
  'https://docs.google.com/forms/d/e/FormId_123/viewform?usp=sharing',
  'the executive can correct a valid long-form URL on any draft'
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
