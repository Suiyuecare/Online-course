begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;

select extensions.plan(26);

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '9a000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', '+886912980001', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '9a000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', '+886912980002', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '9a000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', '+886912980003', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

select set_config(
  'test.operations.admin_one',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '9a000000-0000-4000-8000-000000000001'
  ),
  true
);
select set_config(
  'test.operations.admin_two',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '9a000000-0000-4000-8000-000000000002'
  ),
  true
);

insert into public.staff_roles (person_id, role) values
  (current_setting('test.operations.admin_one')::uuid, 'platform_admin'),
  (current_setting('test.operations.admin_two')::uuid, 'platform_admin');

insert into public.security_incidents (
  id, severity, status, owner, summary, detected_at,
  notification_deadline_at
) values (
  '9b000000-0000-4000-8000-000000000001',
  'high', 'open', 'operations-test', '測試事故', now(),
  now() + interval '72 hours'
);

insert into public.durable_jobs (
  id, job_type, business_key, payload, status, attempt_count
) values
  (
    '9c000000-0000-4000-8000-000000000001',
    'completion_evaluate', 'operations:safe-retry',
    '{}'::jsonb, 'dead_letter', 5
  ),
  (
    '9c000000-0000-4000-8000-000000000002',
    'zoom_setup_finalize', 'operations:unsafe-retry',
    '{}'::jsonb, 'dead_letter', 5
  );

select extensions.ok(
  not has_table_privilege(
    'authenticated', 'public.security_incident_transition_requests', 'select'
  ),
  'authenticated browsers cannot select incident transition requests'
);
select extensions.ok(
  not has_table_privilege(
    'authenticated', 'public.security_incident_transition_decisions', 'select'
  ),
  'authenticated browsers cannot select incident decisions'
);
select extensions.ok(
  not has_table_privilege(
    'authenticated', 'public.security_incident_events', 'select'
  ),
  'authenticated browsers cannot select incident events'
);
select extensions.ok(
  not has_table_privilege(
    'authenticated', 'public.operations_dead_letter_actions', 'select'
  ),
  'authenticated browsers cannot select dead-letter actions'
);
select extensions.ok(
  not has_table_privilege(
    'authenticated', 'public.operations_evidence_events', 'select'
  ),
  'authenticated browsers cannot select evidence events'
);
select extensions.ok(
  not has_function_privilege(
    'anon', 'public.read_operations_control_plane()', 'execute'
  ),
  'anonymous clients cannot execute the operations projection'
);
select extensions.ok(
  has_function_privilege(
    'authenticated', 'public.read_operations_control_plane()', 'execute'
  ),
  'authenticated staff can resolve the guarded operations projection'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '9a000000-0000-4000-8000-000000000003',
    'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '9a000000-0000-4000-8000-000000000003',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select extensions.throws_ok(
  $$select public.read_operations_control_plane()$$,
  'P0001',
  'OPERATIONS_CONTROL_PLANE_REJECTED',
  'a learner cannot read the operations control plane'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '9a000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '9a000000-0000-4000-8000-000000000001',
  true
);

set local role authenticated;
select extensions.is(
  jsonb_array_length(
    public.read_operations_control_plane() -> 'incidents'
  ),
  1,
  'a platform administrator sees the safe incident projection'
);
select extensions.ok(
  position(
    'destination_ciphertext'
    in public.read_operations_control_plane()::text
  ) = 0
  and position(
    '"payload"'
    in public.read_operations_control_plane()::text
  ) = 0,
  'the projection omits queue payloads and notification destinations'
);
reset role;

insert into private.step_up_grants (
  actor_id, action, target, nonce_hash, identity_epoch,
  totp_verified_at, expires_at
) values (
  current_setting('test.operations.admin_one')::uuid,
  'incident_transition',
  '9b000000-0000-4000-8000-000000000001:contain',
  repeat('a', 64),
  (
    select identity_epoch from public.people
    where id = current_setting('test.operations.admin_one')::uuid
  ),
  now(), now() + interval '4 minutes'
);

set local role authenticated;
select set_config(
  'test.operations.transition_request',
  public.request_security_incident_transition(
    '9b000000-0000-4000-8000-000000000001',
    'contain',
    '已完成來源隔離並保留調查證據，申請確認圍堵。',
    'runbook://incident/test-containment',
    '9d000000-0000-4000-8000-000000000001',
    repeat('a', 64)
  )::text,
  true
);
select extensions.ok(
  current_setting('test.operations.transition_request')::uuid is not null,
  'a target-bound fresh step-up can propose an incident transition'
);
reset role;

select extensions.is(
  (
    select count(*)::integer
    from public.security_incident_events
    where event_type = 'transition_requested'
  ),
  1,
  'the proposal appends one immutable incident event'
);

insert into private.step_up_grants (
  actor_id, action, target, nonce_hash, identity_epoch,
  totp_verified_at, expires_at
) values (
  current_setting('test.operations.admin_one')::uuid,
  'incident_transition',
  current_setting('test.operations.transition_request') || ':approve',
  repeat('b', 64),
  (
    select identity_epoch from public.people
    where id = current_setting('test.operations.admin_one')::uuid
  ),
  now(), now() + interval '4 minutes'
);

set local role authenticated;
select extensions.throws_ok(
  format(
    $$select public.decide_security_incident_transition(
      %L::uuid, 'approve', '提出人不得批准自己的狀態變更申請。',
      '9d000000-0000-4000-8000-000000000002', repeat('b', 64)
    )$$,
    current_setting('test.operations.transition_request')
  ),
  'P0001',
  'INDEPENDENT_INCIDENT_REVIEW_REQUIRED',
  'the proposer cannot approve their own transition'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '9a000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '9a000000-0000-4000-8000-000000000002',
  true
);

insert into private.step_up_grants (
  actor_id, action, target, nonce_hash, identity_epoch,
  totp_verified_at, expires_at
) values (
  current_setting('test.operations.admin_two')::uuid,
  'incident_transition',
  current_setting('test.operations.transition_request') || ':approve',
  repeat('c', 64),
  (
    select identity_epoch from public.people
    where id = current_setting('test.operations.admin_two')::uuid
  ),
  now(), now() + interval '4 minutes'
);

set local role authenticated;
select extensions.is(
  public.decide_security_incident_transition(
    current_setting('test.operations.transition_request')::uuid,
    'approve',
    '獨立查核隔離證據完整，同意將事故標記為已圍堵。',
    '9d000000-0000-4000-8000-000000000003',
    repeat('c', 64)
  ) ->> 'status',
  'approve',
  'a distinct platform administrator can approve the transition'
);
reset role;

select extensions.is(
  (
    select status from public.security_incidents
    where id = '9b000000-0000-4000-8000-000000000001'
  ),
  'contained',
  'approval applies the exact requested incident status'
);
select extensions.is(
  (
    select count(*)::integer from public.security_incident_events
    where incident_id = '9b000000-0000-4000-8000-000000000001'
  ),
  2,
  'request and approval remain as separate incident events'
);
select extensions.throws_ok(
  $$update public.security_incident_transition_requests
    set reason = '不得覆寫'
    where id = current_setting('test.operations.transition_request')::uuid$$,
  'P0001',
  'APPEND_ONLY_TABLE',
  'incident transition requests cannot be updated'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '9a000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '9a000000-0000-4000-8000-000000000001',
  true
);

insert into private.step_up_grants (
  actor_id, action, target, nonce_hash, identity_epoch,
  totp_verified_at, expires_at
) values
  (
    current_setting('test.operations.admin_one')::uuid,
    'operations_dead_letter',
    'durable_job:9c000000-0000-4000-8000-000000000001:retry',
    repeat('d', 64),
    (
      select identity_epoch from public.people
      where id = current_setting('test.operations.admin_one')::uuid
    ),
    now(), now() + interval '4 minutes'
  ),
  (
    current_setting('test.operations.admin_one')::uuid,
    'operations_dead_letter',
    'durable_job:9c000000-0000-4000-8000-000000000002:retry',
    repeat('e', 64),
    (
      select identity_epoch from public.people
      where id = current_setting('test.operations.admin_one')::uuid
    ),
    now(), now() + interval '4 minutes'
  );

set local role authenticated;
select extensions.is(
  public.act_on_operations_dead_letter(
    'durable_job', '9c000000-0000-4000-8000-000000000001',
    'retry', '此為純資料庫完課重算，可安全依冪等鍵重新排程。',
    '9d000000-0000-4000-8000-000000000004', repeat('d', 64)
  ) ->> 'status',
  'retry',
  'a database-local idempotent job can be retried'
);
reset role;

select extensions.is(
  (
    select status from public.durable_jobs
    where id = '9c000000-0000-4000-8000-000000000001'
  ),
  'retry',
  'safe retry returns the job to the durable queue'
);

set local role authenticated;
select extensions.throws_ok(
  $$select public.act_on_operations_dead_letter(
    'durable_job', '9c000000-0000-4000-8000-000000000002',
    'retry', '此工作涉及 Zoom 外部副作用，不應允許盲目重送。',
    '9d000000-0000-4000-8000-000000000005', repeat('e', 64)
  )$$,
  'P0001',
  'DEAD_LETTER_RECONCILIATION_REQUIRED',
  'a provider-side job cannot be blindly replayed'
);
reset role;

select extensions.is(
  (
    select status from public.durable_jobs
    where id = '9c000000-0000-4000-8000-000000000002'
  ),
  'dead_letter',
  'rejected provider retry leaves the original dead letter unchanged'
);

insert into private.step_up_grants (
  actor_id, action, target, nonce_hash, identity_epoch,
  totp_verified_at, expires_at
) values
  (
    current_setting('test.operations.admin_one')::uuid,
    'operations_dead_letter',
    'durable_job:9c000000-0000-4000-8000-000000000002:acknowledge',
    repeat('f', 64),
    (
      select identity_epoch from public.people
      where id = current_setting('test.operations.admin_one')::uuid
    ),
    now(), now() + interval '4 minutes'
  ),
  (
    current_setting('test.operations.admin_one')::uuid,
    'operations_evidence',
    'database_backup_manifest_registered:primary',
    repeat('1', 64),
    (
      select identity_epoch from public.people
      where id = current_setting('test.operations.admin_one')::uuid
    ),
    now(), now() + interval '4 minutes'
  );

set local role authenticated;
select extensions.is(
  public.act_on_operations_dead_letter(
    'durable_job', '9c000000-0000-4000-8000-000000000002',
    'acknowledge', '已建立 Zoom 專用對帳案件，不在此重送 provider 操作。',
    '9d000000-0000-4000-8000-000000000006', repeat('f', 64)
  ) ->> 'status',
  'acknowledge',
  'provider dead letters can receive an immutable reconciliation note'
);
select extensions.ok(
  public.record_operations_evidence(
    'database_backup_manifest_registered', 'database', 'primary',
    'passed', repeat('a', 64), 'vault://backup/manifest-test',
    '外部備份程序已完成，這裡只登錄可驗證的 manifest 證據。',
    now(), '9d000000-0000-4000-8000-000000000007', repeat('1', 64)
  ) is not null,
  'a fresh step-up records evidence without invoking an external provider'
);
reset role;

select extensions.is(
  (
    select count(*)::integer from public.operations_evidence_events
    where evidence_kind = 'database_backup_manifest_registered'
  ),
  1,
  'the evidence ledger contains exactly one immutable event'
);
select extensions.is(
  (
    select count(*)::integer from public.operations_dead_letter_actions
    where action = 'acknowledge'
  ),
  1,
  'the acknowledgement is retained separately from the source job'
);
select extensions.ok(
  (
    select status = 'dead_letter' from public.durable_jobs
    where id = '9c000000-0000-4000-8000-000000000002'
  ),
  'acknowledgement never falsifies provider-job recovery'
);

select extensions.finish();
rollback;
