begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;

select extensions.plan(12);

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '99400000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', '+886912994001', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.courses (
  id, slug, internal_title, created_by
) values (
  '99400000-0000-4000-8000-000000000010',
  'content-release-gate-test',
  '開課時間閘門測試',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '99400000-0000-4000-8000-000000000001'
  )
);

insert into public.course_versions (
  id, course_id, version, title, summary, description,
  delivery_type, status, content_available_at, created_by,
  authoring_idempotency_key
) values (
  '99400000-0000-4000-8000-000000000020',
  '99400000-0000-4000-8000-000000000010',
  1, '等待開放的網路課程', '驗證錄播課指定開課時間',
  '驗證在指定開課時間以前，影片、測驗、問卷與教材皆由伺服器拒絕。',
  'recorded', 'draft', now() + interval '2 days',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '99400000-0000-4000-8000-000000000001'
  ),
  '99400000-0000-4000-8000-000000000021'
);

insert into public.modules (
  id, course_version_id, title, sort_order
) values (
  '99400000-0000-4000-8000-000000000030',
  '99400000-0000-4000-8000-000000000020',
  '第一單元', 0
);

insert into public.lessons (
  id, module_id, title, content_type, sort_order
) values (
  '99400000-0000-4000-8000-000000000040',
  '99400000-0000-4000-8000-000000000030',
  '開課後教材', 'material', 0
);

insert into public.entitlements (
  id, person_id, course_version_id, source_type, source_id,
  status, starts_at
) values (
  '99400000-0000-4000-8000-000000000050',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '99400000-0000-4000-8000-000000000001'
  ),
  '99400000-0000-4000-8000-000000000020',
  'b2c_order', '99400000-0000-4000-8000-000000000051',
  'active', now()
);

insert into public.enrollments (
  id, person_id, course_version_id, entitlement_id
) values (
  '99400000-0000-4000-8000-000000000060',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '99400000-0000-4000-8000-000000000001'
  ),
  '99400000-0000-4000-8000-000000000020',
  '99400000-0000-4000-8000-000000000050'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.read_learner_runtime_gates(uuid)',
    'execute'
  ),
  'an authenticated learner can resolve the guarded runtime projection'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.read_learner_runtime_gates(uuid)',
    'execute'
  ),
  'anonymous clients cannot inspect learner runtime gates'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99400000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal1',
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
select extensions.throws_ok(
  $$
    select public.authorize_recorded_playback(
      '99400000-0000-4000-8000-000000000060',
      '99400000-0000-4000-8000-000000000070'
    )
  $$,
  'P0001',
  'COURSE_CONTENT_NOT_AVAILABLE',
  'a future recorded course cannot mint a playback session'
);
select extensions.throws_ok(
  $$
    select public.start_quiz_attempt(
      '99400000-0000-4000-8000-000000000060',
      '99400000-0000-4000-8000-000000000071'
    )
  $$,
  'P0001',
  'COURSE_CONTENT_NOT_AVAILABLE',
  'a future recorded course cannot start its quiz'
);
select extensions.throws_ok(
  $$
    select public.record_playback_heartbeat(
      '99400000-0000-4000-8000-000000000060',
      '99400000-0000-4000-8000-000000000073',
      1, 1, 0, true, true, true, null
    )
  $$,
  'P0001',
  'COURSE_CONTENT_NOT_AVAILABLE',
  'a stale pre-release playback lease cannot report watch time'
);
select extensions.throws_ok(
  $$
    select public.confirm_presence_challenge(
      '99400000-0000-4000-8000-000000000060',
      'stale-challenge-token',
      '99400000-0000-4000-8000-000000000074'
    )
  $$,
  'P0001',
  'COURSE_CONTENT_NOT_AVAILABLE',
  'a stale pre-release challenge cannot confirm watch time'
);
select extensions.throws_ok(
  $$
    select public.submit_survey(
      '99400000-0000-4000-8000-000000000060',
      array[5, 5, 5, 5, 5],
      '尚未開課不得送出',
      '99400000-0000-4000-8000-000000000072'
    )
  $$,
  'P0001',
  'COURSE_CONTENT_NOT_AVAILABLE',
  'a future recorded course cannot submit its survey'
);
select extensions.is(
  (
    public.read_learner_runtime_gates(
      '99400000-0000-4000-8000-000000000060'
    ) ->> 'contentAvailable'
  )::boolean,
  false,
  'the runtime projection exposes the future release as unavailable'
);
select extensions.is(
  (
    public.read_learner_runtime_gates(
      '99400000-0000-4000-8000-000000000060'
    ) -> 'lessonAccess' -> 0 ->> 'locked'
  )::boolean,
  true,
  'every lesson is locked before the scheduled release'
);
select extensions.results_eq(
  $$
    select content_available_at is not null
    from public.learner_dashboard
    where enrollment_id = '99400000-0000-4000-8000-000000000060'
  $$,
  $$ values (true) $$,
  'the learner dashboard exposes the countdown timestamp to its owner'
);
reset role;

update public.course_versions
set content_available_at = now() - interval '1 minute'
where id = '99400000-0000-4000-8000-000000000020';

set local role authenticated;
select extensions.is(
  (
    public.read_learner_runtime_gates(
      '99400000-0000-4000-8000-000000000060'
    ) ->> 'contentAvailable'
  )::boolean,
  true,
  'the runtime projection opens at the scheduled release'
);
select extensions.is(
  (
    public.read_learner_runtime_gates(
      '99400000-0000-4000-8000-000000000060'
    ) -> 'lessonAccess' -> 0 ->> 'locked'
  )::boolean,
  false,
  'a regular recorded lesson unlocks after release'
);
reset role;

select * from extensions.finish();
rollback;
