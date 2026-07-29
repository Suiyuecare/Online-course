begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;

select extensions.plan(12);

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '99300000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', '+886912993001', now(),
    '{}'::jsonb, '{"display_name":"平台管理員"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '99300000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', '+886912993002', now(),
    '{}'::jsonb, '{"display_name":"課程管理員"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '99300000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', '+886912993003', now(),
    '{}'::jsonb, '{"display_name":"待授權客服"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '99300000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', '+886912993004', now(),
    '{}'::jsonb, '{"display_name":"一般學員"}'::jsonb, now(), now()
  );

select set_config(
  'test.directory.admin_person_id',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '99300000-0000-4000-8000-000000000001'
  ),
  true
);
select set_config(
  'test.directory.course_admin_person_id',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '99300000-0000-4000-8000-000000000002'
  ),
  true
);
select set_config(
  'test.directory.candidate_person_id',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '99300000-0000-4000-8000-000000000003'
  ),
  true
);

update public.people
set verified_email = 'support.candidate@example.test',
    email_verified_at = now()
where id = current_setting('test.directory.candidate_person_id')::uuid;

insert into public.staff_roles (person_id, role) values
  (
    current_setting('test.directory.admin_person_id')::uuid,
    'platform_admin'
  ),
  (
    current_setting('test.directory.course_admin_person_id')::uuid,
    'course_admin'
  );

insert into public.courses (
  id, slug, internal_title, created_by
) values (
  '99400000-0000-4000-8000-000000000001',
  'video-backup-workspace-test',
  '影音備份工作區測試',
  current_setting('test.directory.course_admin_person_id')::uuid
);

insert into public.course_versions (
  id, course_id, version, title, summary, description,
  delivery_type, status, created_by, authoring_idempotency_key
) values (
  '99400000-0000-4000-8000-000000000002',
  '99400000-0000-4000-8000-000000000001',
  1, '影音備份工作區測試', '驗證安全投影',
  '只有課程管理員可以取得草稿影音資產的備份狀態。',
  'recorded', 'draft',
  current_setting('test.directory.course_admin_person_id')::uuid,
  '99400000-0000-4000-8000-000000000003'
);

insert into public.modules (
  id, course_version_id, title, sort_order
) values (
  '99400000-0000-4000-8000-000000000004',
  '99400000-0000-4000-8000-000000000002',
  '測試章節', 0
);

insert into public.lessons (
  id, module_id, title, content_type, sort_order
) values (
  '99400000-0000-4000-8000-000000000005',
  '99400000-0000-4000-8000-000000000004',
  '測試影片單元', 'video', 0
);

insert into public.video_assets (
  id, provider_uid, status, duration_seconds, provider_payload,
  application_idempotency_key, uploaded_by
) values (
  '99400000-0000-4000-8000-000000000006',
  'video-backup-workspace-provider-uid',
  'processing',
  600,
  '{"providerReady":true}'::jsonb,
  '99400000-0000-4000-8000-000000000007',
  current_setting('test.directory.course_admin_person_id')::uuid
);

insert into public.lesson_video_versions (
  id, lesson_id, video_asset_id, version, created_by
) values (
  '99400000-0000-4000-8000-000000000008',
  '99400000-0000-4000-8000-000000000005',
  '99400000-0000-4000-8000-000000000006',
  1,
  current_setting('test.directory.course_admin_person_id')::uuid
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.read_staff_role_candidates(text,integer)',
    'execute'
  ),
  'authenticated staff can resolve the guarded candidate projection'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.read_staff_role_candidates(text,integer)',
    'execute'
  ),
  'anonymous clients cannot read staff candidates'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99300000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '99300000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select set_config(
  'test.directory.candidate_result',
  public.read_staff_role_candidates('0912993003', 10)::text,
  true
);
select extensions.is(
  jsonb_array_length(
    current_setting('test.directory.candidate_result')::jsonb
  ),
  1,
  'a full phone search resolves exactly the intended registered account'
);
select extensions.ok(
  (
    current_setting('test.directory.candidate_result')::jsonb
      -> 0 ->> 'maskedPhone'
  ) <> '+886912993003',
  'the candidate projection never returns the raw phone number'
);
select extensions.ok(
  not (
    current_setting('test.directory.candidate_result')::jsonb
      -> 0 ? 'phone'
  ),
  'the candidate projection has no raw phone field'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99300000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '99300000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;
select extensions.throws_ok(
  $$
    select public.read_staff_role_candidates(null, 10)
  $$,
  'P0001',
  'PLATFORM_ADMIN_REQUIRED',
  'a course administrator cannot enumerate registered accounts'
);
reset role;

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.read_video_master_backup_worklist(uuid)',
    'execute'
  ),
  'authenticated staff can resolve the guarded video backup projection'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.read_video_master_backup_worklist(uuid)',
    'execute'
  ),
  'anonymous clients cannot read the video backup worklist'
);

set local role authenticated;
select set_config(
  'test.directory.video_result',
  public.read_video_master_backup_worklist(
    '99400000-0000-4000-8000-000000000002'
  )::text,
  true
);
select extensions.is(
  jsonb_array_length(
    current_setting('test.directory.video_result')::jsonb
  ),
  1,
  'a course administrator sees the active draft video asset'
);
select extensions.is(
  current_setting('test.directory.video_result')::jsonb
    -> 0 ->> 'providerReady',
  'true',
  'the worklist reports the provider-ready state'
);
select extensions.is(
  current_setting('test.directory.video_result')::jsonb
    -> 0 ->> 'masterBackupVerified',
  'false',
  'the worklist reports that the immutable master is still missing'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99300000-0000-4000-8000-000000000004',
    'role', 'authenticated',
    'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '99300000-0000-4000-8000-000000000004',
  true
);
set local role authenticated;
select extensions.throws_ok(
  $$
    select public.read_video_master_backup_worklist(null)
  $$,
  'P0001',
  'COURSE_ADMIN_REQUIRED',
  'a learner cannot read draft video backup state'
);
reset role;

select extensions.finish();
rollback;
