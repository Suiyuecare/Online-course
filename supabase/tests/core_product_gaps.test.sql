begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;

select extensions.plan(5);

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '81000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', '+886900008101', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.courses (
  id, slug, internal_title, created_by
) values (
  '81000000-0000-4000-8000-000000000010',
  'core-product-gaps',
  '核心產品缺口測試',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '81000000-0000-4000-8000-000000000001'
  )
);

insert into public.course_versions (
  id, course_id, version, title, summary, description,
  delivery_type, status, commerce_close_at, created_by,
  authoring_idempotency_key
) values (
  '81000000-0000-4000-8000-000000000020',
  '81000000-0000-4000-8000-000000000010',
  1, '已停售的混合積分課', '測試摘要', '測試說明',
  'hybrid', 'suspended', now() + interval '30 days',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '81000000-0000-4000-8000-000000000001'
  ),
  '81000000-0000-4000-8000-000000000021'
);

insert into public.course_requirements (
  course_version_id, required_watch_seconds
) values (
  '81000000-0000-4000-8000-000000000020', 600
);

insert into public.hybrid_components (
  id, course_version_id, component_type, title, required, sort_order,
  refund_allocation_twd, recorded_required_watch_seconds
) values
  (
    '81000000-0000-4000-8000-000000000030',
    '81000000-0000-4000-8000-000000000020',
    'recorded', '錄播一', true, 0, 0, 60
  ),
  (
    '81000000-0000-4000-8000-000000000031',
    '81000000-0000-4000-8000-000000000020',
    'recorded', '錄播二', true, 1, 0, 540
  );

insert into public.modules (
  id, course_version_id, title, sort_order
) values
  (
    '81000000-0000-4000-8000-000000000040',
    '81000000-0000-4000-8000-000000000020',
    '模組一', 0
  ),
  (
    '81000000-0000-4000-8000-000000000041',
    '81000000-0000-4000-8000-000000000020',
    '模組二', 1
  );

insert into public.lessons (
  id, module_id, title, content_type, sort_order, hybrid_component_id
) values
  (
    '81000000-0000-4000-8000-000000000050',
    '81000000-0000-4000-8000-000000000040',
    '影片一', 'video', 0,
    '81000000-0000-4000-8000-000000000030'
  ),
  (
    '81000000-0000-4000-8000-000000000051',
    '81000000-0000-4000-8000-000000000041',
    '影片二', 'video', 0,
    '81000000-0000-4000-8000-000000000031'
  );

insert into public.video_assets (
  id, provider_uid, status, duration_seconds,
  application_idempotency_key, uploaded_by
) values
  (
    '81000000-0000-4000-8000-000000000060',
    'core-gap-video-a', 'processing', 600,
    '81000000-0000-4000-8000-000000000061',
    (
      select person_id
      from public.auth_identities
      where auth_user_id = '81000000-0000-4000-8000-000000000001'
    )
  ),
  (
    '81000000-0000-4000-8000-000000000062',
    'core-gap-video-b', 'processing', 600,
    '81000000-0000-4000-8000-000000000063',
    (
      select person_id
      from public.auth_identities
      where auth_user_id = '81000000-0000-4000-8000-000000000001'
    )
  );

insert into public.lesson_video_versions (
  id, lesson_id, video_asset_id, version, created_by
) values
  (
    '81000000-0000-4000-8000-000000000070',
    '81000000-0000-4000-8000-000000000050',
    '81000000-0000-4000-8000-000000000060',
    1,
    (
      select person_id
      from public.auth_identities
      where auth_user_id = '81000000-0000-4000-8000-000000000001'
    )
  ),
  (
    '81000000-0000-4000-8000-000000000071',
    '81000000-0000-4000-8000-000000000051',
    '81000000-0000-4000-8000-000000000062',
    1,
    (
      select person_id
      from public.auth_identities
      where auth_user_id = '81000000-0000-4000-8000-000000000001'
    )
  );

insert into public.entitlements (
  id, person_id, course_version_id, source_type, source_id,
  status, starts_at
) values (
  '81000000-0000-4000-8000-000000000080',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '81000000-0000-4000-8000-000000000001'
  ),
  '81000000-0000-4000-8000-000000000020',
  'b2c_order', '81000000-0000-4000-8000-000000000081',
  'active', now()
);

insert into public.enrollments (
  id, person_id, course_version_id, entitlement_id
) values (
  '81000000-0000-4000-8000-000000000090',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '81000000-0000-4000-8000-000000000001'
  ),
  '81000000-0000-4000-8000-000000000020',
  '81000000-0000-4000-8000-000000000080'
);

insert into public.entitlements (
  id, person_id, course_version_id, source_type, source_id,
  status, starts_at
) values (
  '81000000-0000-4000-8000-000000000082',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '81000000-0000-4000-8000-000000000001'
  ),
  '81000000-0000-4000-8000-000000000020',
  'organization_assignment', '81000000-0000-4000-8000-000000000083',
  'active', now()
);

insert into public.enrollments (
  id, person_id, course_version_id, entitlement_id
) values (
  '81000000-0000-4000-8000-000000000091',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '81000000-0000-4000-8000-000000000001'
  ),
  '81000000-0000-4000-8000-000000000020',
  '81000000-0000-4000-8000-000000000082'
);

insert into public.playback_sessions (
  id, enrollment_id, person_id, lesson_video_version_id,
  session_nonce_hash, device_hash
) values (
  '81000000-0000-4000-8000-000000000100',
  '81000000-0000-4000-8000-000000000090',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '81000000-0000-4000-8000-000000000001'
  ),
  '81000000-0000-4000-8000-000000000070',
  'core-gap-session-nonce', 'core-gap-device'
);

with manifest(value) as (
  values (
    jsonb_build_array(
      jsonb_build_object(
        'videoVersionId', '81000000-0000-4000-8000-000000000070',
        'creditedSeconds', 60
      ),
      jsonb_build_object(
        'videoVersionId', '81000000-0000-4000-8000-000000000071',
        'creditedSeconds', 540
      )
    )
  )
)
insert into public.presence_challenges (
  id, enrollment_id, playback_session_id, lesson_video_version_id,
  token_hash, block_started_media_position_seconds, block_seconds,
  event_manifest, event_manifest_hash, issued_at, expires_at,
  confirmed_at, consumed_at
)
select
  '81000000-0000-4000-8000-000000000110',
  '81000000-0000-4000-8000-000000000090',
  '81000000-0000-4000-8000-000000000100',
  '81000000-0000-4000-8000-000000000070',
  repeat('a', 64), 0, 600, manifest.value,
  encode(extensions.digest(manifest.value::text, 'sha256'), 'hex'),
  '2030-01-01 00:00:00+00'::timestamptz,
  '2030-01-01 00:01:30+00'::timestamptz,
  '2030-01-01 00:00:30+00'::timestamptz,
  '2030-01-01 00:00:30+00'::timestamptz
from manifest;

insert into public.confirmed_watch_blocks (
  id, enrollment_id, presence_challenge_id,
  confirmation_idempotency_key, seconds, confirmed_at,
  event_manifest_hash
) select
  '81000000-0000-4000-8000-000000000120',
  '81000000-0000-4000-8000-000000000090',
  '81000000-0000-4000-8000-000000000110',
  '81000000-0000-4000-8000-000000000121',
  600, '2030-01-01 00:00:30+00'::timestamptz,
  event_manifest_hash
from public.presence_challenges
where id = '81000000-0000-4000-8000-000000000110';

select extensions.is(
  internal.hybrid_component_confirmed_seconds(
    '81000000-0000-4000-8000-000000000090',
    '81000000-0000-4000-8000-000000000030'
  ),
  60,
  'one confirmed block credits one minute to its first component'
);

select extensions.is(
  internal.hybrid_component_confirmed_seconds(
    '81000000-0000-4000-8000-000000000090',
    '81000000-0000-4000-8000-000000000031'
  ),
  540,
  'the same confirmed block credits nine minutes to its second component'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '81000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '81000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select extensions.throws_ok(
  $$
    select internal.record_playback_heartbeat(
      '81000000-0000-4000-8000-000000000091',
      '81000000-0000-4000-8000-000000000100',
      1, 1, 0, false, true, true, null
    )
  $$,
  'P0001',
  'PLAYBACK_LEASE_REJECTED',
  'a B2C playback session cannot be charged to a B2B enrollment'
);

select extensions.results_eq(
  $$select enrollment_id
    from public.learner_dashboard
    where enrollment_id = '81000000-0000-4000-8000-000000000090'$$,
  $$values ('81000000-0000-4000-8000-000000000090'::uuid)$$,
  'the owner still sees a suspended purchased version in their dashboard'
);

reset role;
set local role anon;

select extensions.results_eq(
  $$select count(*)::bigint
    from public.course_versions
    where id = '81000000-0000-4000-8000-000000000020'$$,
  $$values (0::bigint)$$,
  'a suspended historical version is not visible in the public catalog'
);

reset role;
select * from extensions.finish();
rollback;
