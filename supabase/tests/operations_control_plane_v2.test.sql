begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to anon;
grant execute on all functions in schema extensions to anon;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
grant usage on schema extensions to service_role;
grant execute on all functions in schema extensions to service_role;

select extensions.plan(28);

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '9e000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', '+886912980101', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-8000-000000000000',
    '9e000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', '+886912980102', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '9e000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', '+886912980103', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '9e000000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', '+886912980104', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

select set_config(
  'test.operations_v2.admin_one',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '9e000000-0000-4000-8000-000000000001'
  ),
  true
);
select set_config(
  'test.operations_v2.admin_two',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '9e000000-0000-4000-8000-000000000002'
  ),
  true
);
select set_config(
  'test.operations_v2.support',
  (
    select person_id::text from public.auth_identities
    where auth_user_id = '9e000000-0000-4000-8000-000000000003'
  ),
  true
);

insert into public.staff_roles (person_id, role) values
  (current_setting('test.operations_v2.admin_one')::uuid, 'platform_admin'),
  (current_setting('test.operations_v2.admin_two')::uuid, 'platform_admin'),
  (current_setting('test.operations_v2.support')::uuid, 'support');

insert into public.legal_documents (
  id, kind, revision, content_sha256, object_path,
  approved_by_legal, effective_at
) values (
  '9e100000-0000-4000-8000-000000000001',
  'privacy_notice', 901, repeat('a', 64),
  'test/legal/privacy-notice.pdf', true, now() - interval '1 day'
);

insert into public.support_cases (
  id, kind, status, priority, summary, response_due_at, closed_at
) values
  (
    '9e200000-0000-4000-8000-000000000001',
    'general', 'open', 'high', 'SLA projection fixture',
    now() + interval '1 hour', null
  ),
  (
    '9e200000-0000-4000-8000-000000000002',
    'general', 'closed', 'normal', 'Retention fixture',
    now() - interval '30 days', now() - interval '20 days'
  );

insert into public.retention_policy_revisions (
  id, data_class, revision, online_days, archive_days,
  legal_basis, approved_by, effective_at
) values (
  '9e300000-0000-4000-8000-000000000001',
  'support_cases', 901, 0, 1, 'test-only retention policy',
  current_setting('test.operations_v2.admin_one')::uuid,
  now() - interval '1 day'
);

select internal.append_audit_event(
  current_setting('test.operations_v2.admin_one')::uuid,
  'operations.v2_fixture', 'support_case',
  '9e200000-0000-4000-8000-000000000001',
  'sensitive fixture reason', null,
  jsonb_build_object('secretPayload', 'must-not-project')
);

select extensions.ok(
  not has_table_privilege(
    'authenticated', 'public.sla_escalation_events', 'select'
  ),
  'authenticated browsers cannot select SLA escalation events'
);
select extensions.ok(
  not has_table_privilege(
    'authenticated', 'public.retention_dry_run_requests', 'select'
  ),
  'authenticated browsers cannot select retention dry-run requests'
);
select extensions.ok(
  not has_table_privilege(
    'authenticated', 'public.retention_dry_run_decisions', 'select'
  ),
  'authenticated browsers cannot select retention dry-run decisions'
);
select extensions.ok(
  has_function_privilege(
    'anon', 'public.read_effective_legal_center()', 'execute'
  ),
  'anonymous callers can resolve the fixed safe legal facade'
);
select extensions.ok(
  has_function_privilege(
    'authenticated', 'public.read_effective_legal_center()', 'execute'
  ),
  'authenticated callers may resolve the safe legal metadata projection'
);
select extensions.ok(
  has_function_privilege(
    'service_role', 'public.read_effective_legal_center()', 'execute'
  ),
  'the server can render public legal metadata through the narrow projection'
);

select set_config(
  'request.jwt.claims',
  '{"role":"anon"}',
  true
);
select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;
select extensions.is(
  jsonb_array_length(public.read_effective_legal_center()),
  1,
  'the public legal center exposes the effective approved revision'
);
select extensions.ok(
  position(
    'object_path' in public.read_effective_legal_center()::text
  ) = 0,
  'the legal projection omits storage paths'
);
reset role;

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.read_staff_audit_events(text,text,bigint,integer)',
    'execute'
  ),
  'anonymous callers cannot execute the staff audit projection'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.read_staff_audit_events(text,text,bigint,integer)',
    'execute'
  ),
  'authenticated staff can resolve the guarded audit projection'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '9e000000-0000-4000-8000-000000000004',
    'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '9e000000-0000-4000-8000-000000000004',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select extensions.throws_ok(
  $$select public.read_staff_audit_events(null,null,null,25)$$,
  'P0001',
  'AUDIT_EXPLORER_REJECTED',
  'a learner cannot read the staff audit explorer'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '9e000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '9e000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select extensions.ok(
  jsonb_array_length(
    public.read_staff_audit_events('operations.', null, null, 25) -> 'items'
  ) >= 1,
  'a platform administrator sees matching audit metadata'
);
select extensions.ok(
  position(
    'secretPayload'
    in public.read_staff_audit_events('operations.', null, null, 25)::text
  ) = 0
  and position(
    'sensitive fixture reason'
    in public.read_staff_audit_events('operations.', null, null, 25)::text
  ) = 0,
  'the audit projection omits payload and reason text'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '9e000000-0000-4000-8000-000000000003',
    'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '9e000000-0000-4000-8000-000000000003',
  true
);
set local role authenticated;
select extensions.is(
  jsonb_array_length(
    public.read_staff_sla_workspace('support') -> 'items'
  ),
  1,
  'support staff sees only the active support SLA projection'
);
select extensions.throws_ok(
  $$select public.read_staff_sla_workspace('refund')$$,
  'P0001',
  'SLA_WORKSPACE_REJECTED',
  'support staff cannot read the finance refund SLA scope'
);
reset role;

select set_config(
  'test.operations_v2.outbox_before',
  (select count(*)::text from public.notification_outbox),
  true
);
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select extensions.ok(
  public.enqueue_due_sla_escalations() >= 1,
  'the service worker schedules due SLA evidence jobs'
);
reset role;
select extensions.is(
  (
    select count(*)::integer from public.durable_jobs
    where job_type = 'sla_escalation_record'
      and payload ->> 'sourceId' =
        '9e200000-0000-4000-8000-000000000001'
  ),
  1,
  'SLA scheduling is idempotent by a stable durable-job business key'
);

update public.durable_jobs
set status = 'leased',
    lease_owner = 'operations-v2-test',
    lease_expires_at = now() + interval '5 minutes',
    lease_generation = 1
where job_type = 'sla_escalation_record'
  and payload ->> 'sourceId' =
    '9e200000-0000-4000-8000-000000000001';
select set_config(
  'test.operations_v2.sla_job',
  (
    select id::text from public.durable_jobs
    where job_type = 'sla_escalation_record'
      and payload ->> 'sourceId' =
        '9e200000-0000-4000-8000-000000000001'
  ),
  true
);

set local role service_role;
select extensions.ok(
  public.record_sla_escalation(
    current_setting('test.operations_v2.sla_job')::uuid,
    'operations-v2-test',
    1
  ),
  'the leased worker appends an SLA escalation event'
);
reset role;
select extensions.is(
  (
    select count(*)::integer from public.sla_escalation_events
    where source_id = '9e200000-0000-4000-8000-000000000001'
  ),
  1,
  'one append-only SLA escalation event is recorded'
);
select extensions.is(
  (select count(*)::text from public.notification_outbox),
  current_setting('test.operations_v2.outbox_before'),
  'SLA evidence recording sends no external notification'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '9e000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '9e000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
insert into private.step_up_grants (
  actor_id, action, target, nonce_hash, identity_epoch,
  totp_verified_at, expires_at
) values (
  current_setting('test.operations_v2.admin_one')::uuid,
  'retention_dry_run',
  '9e300000-0000-4000-8000-000000000001:dry_run',
  repeat('d', 64),
  (
    select identity_epoch from public.people
    where id = current_setting('test.operations_v2.admin_one')::uuid
  ),
  now(), now() + interval '4 minutes'
);
set local role authenticated;
select set_config(
  'test.operations_v2.dry_run',
  public.request_retention_dry_run(
    '9e300000-0000-4000-8000-000000000001',
    '計算依法可清理資料的候選摘要，但不執行刪除。',
    '9e400000-0000-4000-8000-000000000001',
    repeat('d', 64)
  )::text,
  true
);
select extensions.ok(
  current_setting('test.operations_v2.dry_run')::uuid is not null,
  'a target-bound fresh step-up creates a retention dry-run'
);
reset role;

insert into private.step_up_grants (
  actor_id, action, target, nonce_hash, identity_epoch,
  totp_verified_at, expires_at
) values (
  current_setting('test.operations_v2.admin_one')::uuid,
  'retention_dry_run',
  '9e300000-0000-4000-8000-000000000001:dry_run',
  repeat('3', 64),
  (
    select identity_epoch from public.people
    where id = current_setting('test.operations_v2.admin_one')::uuid
  ),
  now(), now() + interval '4 minutes'
);
set local role authenticated;
select extensions.throws_ok(
  $$select public.request_retention_dry_run(
    '9e300000-0000-4000-8000-000000000001',
    '既有未決 dry-run 不得被新請求遮蔽。',
    '9e400000-0000-4000-8000-000000000004',
    repeat('3', 64)
  )$$,
  'P0001',
  'RETENTION_DRY_RUN_PENDING_REVIEW',
  'one policy cannot hide a pending dry-run behind a newer request'
);
reset role;

insert into private.step_up_grants (
  actor_id, action, target, nonce_hash, identity_epoch,
  totp_verified_at, expires_at
) values (
  current_setting('test.operations_v2.admin_one')::uuid,
  'retention_dry_run',
  current_setting('test.operations_v2.dry_run') || ':approve',
  repeat('e', 64),
  (
    select identity_epoch from public.people
    where id = current_setting('test.operations_v2.admin_one')::uuid
  ),
  now(), now() + interval '4 minutes'
);
set local role authenticated;
select extensions.throws_ok(
  format(
    $$select public.decide_retention_dry_run(
      %L::uuid, 'approve', '提出人不得覆核自己的 dry-run。',
      '9e500000-0000-4000-8000-000000000001',
      '9e400000-0000-4000-8000-000000000002', repeat('e', 64)
    )$$,
    current_setting('test.operations_v2.dry_run')
  ),
  'P0001',
  'INDEPENDENT_RETENTION_REVIEW_REQUIRED',
  'the dry-run proposer cannot approve their own evidence'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '9e000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '9e000000-0000-4000-8000-000000000002',
  true
);
insert into private.step_up_grants (
  actor_id, action, target, nonce_hash, identity_epoch,
  totp_verified_at, expires_at
) values (
  current_setting('test.operations_v2.admin_two')::uuid,
  'operations_evidence',
  'retention_candidate_manifest_verified:' ||
    current_setting('test.operations_v2.dry_run'),
  repeat('4', 64),
  (
    select identity_epoch from public.people
    where id = current_setting('test.operations_v2.admin_two')::uuid
  ),
  now(), now() + interval '4 minutes'
);
set local role authenticated;
select set_config(
  'test.operations_v2.evidence',
  public.record_retention_dry_run_evidence(
    current_setting('test.operations_v2.dry_run')::uuid,
    'evidence://retention-dry-run/approved',
    '已核對固定候選查詢、完整摘要與外部保存證據。',
    '9e400000-0000-4000-8000-000000000005',
    repeat('4', 64)
  )::text,
  true
);
select extensions.ok(
  current_setting('test.operations_v2.evidence')::uuid is not null,
  'the reviewer records a bound append-only evidence event first'
);
reset role;

insert into private.step_up_grants (
  actor_id, action, target, nonce_hash, identity_epoch,
  totp_verified_at, expires_at
) values (
  current_setting('test.operations_v2.admin_two')::uuid,
  'retention_dry_run',
  current_setting('test.operations_v2.dry_run') || ':approve',
  repeat('1', 64),
  (
    select identity_epoch from public.people
    where id = current_setting('test.operations_v2.admin_two')::uuid
  ),
  now(), now() + interval '4 minutes'
);
set local role authenticated;
select set_config(
  'test.operations_v2.decision',
  public.decide_retention_dry_run(
    current_setting('test.operations_v2.dry_run')::uuid,
    'approve',
    '獨立核對候選摘要與外部證據，僅批准 dry-run 證明。',
    current_setting('test.operations_v2.evidence')::uuid,
    '9e400000-0000-4000-8000-000000000003',
    repeat('1', 64)
  )::text,
  true
);
select extensions.is(
  current_setting('test.operations_v2.decision')::jsonb ->> 'status',
  'approve',
  'a distinct platform administrator can approve the dry-run evidence'
);
select extensions.is(
  current_setting('test.operations_v2.decision')::jsonb
    ->> 'physicalPurgePerformed',
  'false',
  'approval explicitly reports that no physical purge occurred'
);
reset role;

select extensions.is(
  (
    select count(*)::integer from public.support_cases
    where id = '9e200000-0000-4000-8000-000000000002'
  ),
  1,
  'the approved dry-run leaves candidate rows untouched'
);
select extensions.throws_ok(
  format(
    $$update public.retention_dry_run_requests
      set reason = '不得覆寫'
      where id = %L::uuid$$,
    current_setting('test.operations_v2.dry_run')
  ),
  'P0001',
  'APPEND_ONLY_TABLE',
  'retention dry-run requests cannot be updated'
);

select * from extensions.finish();
rollback;
