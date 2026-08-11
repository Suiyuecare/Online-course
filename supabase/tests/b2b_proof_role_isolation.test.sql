begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;

select extensions.plan(23);

select extensions.ok(
  to_regprocedure(
    'public.submit_point_topup_proof(uuid,text,text,text,timestamptz,integer,uuid)'
  ) is null,
  'the attachment-dropping top-up proof overload no longer exists'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.submit_point_topup_proof(uuid,text,text,text,timestamptz,integer,text,text,uuid)',
    'execute'
  ),
  'authenticated organization users can execute only the corrected proof RPC'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.read_organization_workspace_v2(uuid)',
    'execute'
  ),
  'authenticated callers cannot bypass the role-safe workspace projection'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.read_organization_training_report_v2(uuid,uuid,uuid,text,text)',
    'execute'
  ),
  'authenticated callers cannot bypass the role-safe training report'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.read_organization_workspace_v3(uuid)',
    'execute'
  ),
  'authenticated organization operators can execute the safe workspace'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.read_organization_training_report_v3(uuid,uuid,uuid,text,text)',
    'execute'
  ),
  'authenticated training operators can request the guarded report'
);

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'a1000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', '+886912100001', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a1000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', '+886912100002', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a1000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', '+886912100003', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a1000000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', '+886912100004', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.organizations (
  id, legal_name, tax_id_blind_index, invoice_email, status,
  application_idempotency_key
) values (
  'a2000000-0000-4000-8000-000000000001',
  '企業證據權限測試機構', repeat('a', 64),
  'invoice@example.test', 'approved',
  'a2000000-0000-4000-8000-000000000002'
);

insert into public.organization_memberships (
  organization_id, person_id, role
) values
  (
    'a2000000-0000-4000-8000-000000000001',
    (
      select person_id from public.auth_identities
      where auth_user_id = 'a1000000-0000-4000-8000-000000000001'
    ),
    'owner'
  ),
  (
    'a2000000-0000-4000-8000-000000000001',
    (
      select person_id from public.auth_identities
      where auth_user_id = 'a1000000-0000-4000-8000-000000000002'
    ),
    'training_manager'
  ),
  (
    'a2000000-0000-4000-8000-000000000001',
    (
      select person_id from public.auth_identities
      where auth_user_id = 'a1000000-0000-4000-8000-000000000003'
    ),
    'finance'
  ),
  (
    'a2000000-0000-4000-8000-000000000001',
    (
      select person_id from public.auth_identities
      where auth_user_id = 'a1000000-0000-4000-8000-000000000004'
    ),
    'member'
  );

insert into public.legal_documents (
  id, kind, revision, content_sha256, object_path,
  approved_by_legal, effective_at
) values (
  'a3000000-0000-4000-8000-000000000001',
  'b2b_contract', 930001, repeat('b', 64),
  'legal/b2b-proof-role-isolation', true, now() - interval '10 days'
);

insert into public.legal_acceptances (
  id, person_id, legal_document_id,
  first_presented_at, second_confirmed_at,
  first_ip, second_ip, first_device_hash, second_device_hash,
  document_hash_snapshot
) values (
  'a3000000-0000-4000-8000-000000000002',
  (
    select person_id from public.auth_identities
    where auth_user_id = 'a1000000-0000-4000-8000-000000000001'
  ),
  'a3000000-0000-4000-8000-000000000001',
  now() - interval '4 days', now() - interval '1 day',
  '127.0.0.1', '127.0.0.1', 'proof-device-1', 'proof-device-2',
  repeat('b', 64)
);

insert into public.point_topups (
  id, organization_id, requested_by, status,
  points, amount_due_twd, legal_acceptance_id,
  transfer_due_at, idempotency_key
) values (
  'a4000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  (
    select person_id from public.auth_identities
    where auth_user_id = 'a1000000-0000-4000-8000-000000000001'
  ),
  'pending_transfer', 1000, 1000,
  'a3000000-0000-4000-8000-000000000002',
  now() + interval '2 days',
  'a4000000-0000-4000-8000-000000000002'
);

insert into public.invoice_records (
  id, point_topup_id, status, amount_twd
) values (
  'a4000000-0000-4000-8000-000000000003',
  'a4000000-0000-4000-8000-000000000001',
  'pending', 1000
);

insert into public.upload_quarantine (
  id, owner_person_id, purpose, object_path, declared_mime,
  detected_mime, byte_size, content_sha256, status,
  metadata_stripped, promoted_object_path, promoted_sha256
) values (
  'a5000000-0000-4000-8000-000000000001',
  (
    select person_id from public.auth_identities
    where auth_user_id = 'a1000000-0000-4000-8000-000000000001'
  ),
  'payment_proof', 'quarantine/b2b-proof-role-isolation',
  'image/png', 'image/png', 2048, repeat('c', 64), 'promoted',
  true, 'promoted/b2b-proof-role-isolation', repeat('d', 64)
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'a1000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select extensions.is(
  public.submit_point_topup_proof(
    'a4000000-0000-4000-8000-000000000001',
    '王小明', '測試銀行', '12345',
    '2026-01-01 00:00:00+00'::timestamptz, 1000,
    'promoted/b2b-proof-role-isolation', repeat('d', 64),
    'a6000000-0000-4000-8000-000000000001'
  ) ->> 'attachmentStatus',
  'safe',
  'a promoted payment proof is accepted for the organization top-up'
);

select extensions.is(
  (
    public.submit_point_topup_proof(
      'a4000000-0000-4000-8000-000000000001',
      '王小明', '測試銀行', '12345',
      '2026-01-01 00:00:00+00'::timestamptz, 1000,
      'promoted/b2b-proof-role-isolation', repeat('d', 64),
      'a6000000-0000-4000-8000-000000000001'
    ) ->> 'replayed'
  )::boolean,
  true,
  'an identical proof retry replays without inserting another record'
);

select extensions.throws_ok(
  $$
    select public.submit_point_topup_proof(
      'a4000000-0000-4000-8000-000000000001',
      '王小明', '測試銀行', '12345', now(), 1000,
      'promoted/forged-proof', repeat('e', 64),
      'a6000000-0000-4000-8000-000000000002'
    )
  $$,
  'P0001',
  'SAFE_UPLOAD_REQUIRED',
  'a caller cannot forge a promoted object path or sanitized hash'
);
reset role;

select extensions.ok(
  (
    select proof.promoted_object_path =
        'promoted/b2b-proof-role-isolation'
      and proof.content_sha256 = repeat('d', 64)
      and proof.scan_status = 'safe'
    from public.payment_proofs proof
    where proof.topup_id = 'a4000000-0000-4000-8000-000000000001'
  ),
  'the safe promoted path and sanitized hash persist on the payment proof'
);
select extensions.is(
  (
    select count(*)::integer
    from public.payment_proofs proof
    where proof.topup_id = 'a4000000-0000-4000-8000-000000000001'
  ),
  1,
  'proof replay creates exactly one payment proof'
);
select extensions.is(
  (
    select count(*)::integer
    from public.audit_events event
    where event.action = 'organization.topup_proof_submitted'
      and event.target_id = 'a4000000-0000-4000-8000-000000000001'
  ),
  1,
  'proof replay creates exactly one append-only audit event'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'a1000000-0000-4000-8000-000000000002',
    'role', 'authenticated', 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;

select extensions.is(
  jsonb_array_length(
    public.read_organization_workspace_v3(
      'a2000000-0000-4000-8000-000000000001'
    ) -> 'topups'
  ),
  0,
  'training manager receives no top-up records'
);
select extensions.is(
  jsonb_array_length(
    public.read_organization_workspace_v3(
      'a2000000-0000-4000-8000-000000000001'
    ) -> 'invoices'
  ),
  0,
  'training manager receives no invoice records'
);
select extensions.ok(
  (
    public.read_organization_workspace_v3(
      'a2000000-0000-4000-8000-000000000001'
    ) -> 'capabilities' ->> 'canViewTraining'
  )::boolean
  and not (
    public.read_organization_workspace_v3(
      'a2000000-0000-4000-8000-000000000001'
    ) -> 'capabilities' ->> 'canViewFinance'
  )::boolean,
  'training manager receives training-only capabilities'
);
select extensions.ok(
  jsonb_typeof(
    public.read_organization_training_report_v3(
      'a2000000-0000-4000-8000-000000000001',
      null, null, null, null
    )
  ) = 'object',
  'training manager can read the organization training report'
);
select extensions.is(
  jsonb_array_length(
    public.read_organization_training_report_v3(
      'a2000000-0000-4000-8000-000000000001',
      null, null, null, null
    ) -> 'pointLedger'
  ),
  0,
  'training manager receives no finance point-ledger events'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'a1000000-0000-4000-8000-000000000003',
    'role', 'authenticated', 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000003',
  true
);
set local role authenticated;

select extensions.is(
  jsonb_array_length(
    public.read_organization_workspace_v3(
      'a2000000-0000-4000-8000-000000000001'
    ) -> 'outcomes'
  ),
  0,
  'finance receives no employee learning outcomes'
);
select extensions.is(
  jsonb_array_length(
    public.read_organization_workspace_v3(
      'a2000000-0000-4000-8000-000000000001'
    ) -> 'assignments'
  ),
  0,
  'finance receives no employee course assignments'
);
select extensions.ok(
  (
    public.read_organization_workspace_v3(
      'a2000000-0000-4000-8000-000000000001'
    ) -> 'capabilities' ->> 'canViewFinance'
  )::boolean
  and not (
    public.read_organization_workspace_v3(
      'a2000000-0000-4000-8000-000000000001'
    ) -> 'capabilities' ->> 'canViewTraining'
  )::boolean,
  'finance receives finance-only capabilities'
);
select extensions.throws_ok(
  $$
    select public.read_organization_training_report_v3(
      'a2000000-0000-4000-8000-000000000001',
      null, null, null, null
    )
  $$,
  'P0001',
  'ORGANIZATION_TRAINING_NOT_AUTHORIZED',
  'finance cannot read or export employee training outcomes'
);
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'a1000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select extensions.ok(
  jsonb_array_length(
    public.read_organization_workspace_v3(
      'a2000000-0000-4000-8000-000000000001'
    ) -> 'topups'
  ) = 1
  and jsonb_array_length(
    public.read_organization_workspace_v3(
      'a2000000-0000-4000-8000-000000000001'
    ) -> 'invoices'
  ) = 1,
  'owner retains the complete finance projection'
);
select extensions.ok(
  (
    public.read_organization_workspace_v3(
      'a2000000-0000-4000-8000-000000000001'
    ) -> 'capabilities' ->> 'canViewFinance'
  )::boolean
  and (
    public.read_organization_workspace_v3(
      'a2000000-0000-4000-8000-000000000001'
    ) -> 'capabilities' ->> 'canViewTraining'
  )::boolean,
  'owner retains both finance and training capabilities'
);
reset role;

select * from extensions.finish();
rollback;
