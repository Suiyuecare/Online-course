begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(14);
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

select extensions.ok(
  not has_function_privilege(
    'service_role',
    'public.finish_durable_job(uuid,text,boolean,text)',
    'execute'
  ),
  'the generation-less durable job completion API is disabled'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.finish_durable_job(uuid,text,bigint,boolean,text)',
    'execute'
  ),
  'service workers can complete only an exact lease generation'
);
select extensions.ok(
  not has_function_privilege(
    'service_role',
    'public.complete_zoom_orphan_cleanup(uuid,text,boolean,boolean)',
    'execute'
  ),
  'the generation-less orphan completion API is disabled'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.complete_zoom_orphan_cleanup(uuid,text,bigint,boolean,boolean)',
    'execute'
  ),
  'orphan cleanup completion requires an exact lease generation'
);

insert into public.durable_jobs (
  id,
  job_type,
  business_key,
  payload,
  available_at
) values (
  '70000000-0000-4000-8000-000000000001',
  'zoom_orphan_cleanup',
  'test:zoom-orphan-generation',
  '{}'::jsonb,
  clock_timestamp() - interval '1 minute'
);

create temporary table first_claim as
select internal.lease_due_jobs_filtered(
  'same-worker',
  1,
  array[]::text[],
  null
) as payload;

select extensions.is(
  (
    select (payload -> 0 ->> 'lease_generation')::bigint
    from first_claim
  ),
  1::bigint,
  'first durable job claim has generation one'
);
select extensions.is(
  (
    select status
    from public.durable_jobs
    where id = '70000000-0000-4000-8000-000000000001'
  ),
  'leased',
  'first claim moves the job to leased'
);

update public.durable_jobs
set lease_expires_at = clock_timestamp() - interval '1 second'
where id = '70000000-0000-4000-8000-000000000001';

create temporary table second_claim as
select internal.lease_due_jobs_filtered(
  'same-worker',
  1,
  array[]::text[],
  null
) as payload;

select extensions.is(
  (
    select (payload -> 0 ->> 'lease_generation')::bigint
    from second_claim
  ),
  2::bigint,
  'an expired leased job is atomically reclaimed with a new generation'
);
select extensions.is(
  (
    select attempt_count
    from public.durable_jobs
    where id = '70000000-0000-4000-8000-000000000001'
  ),
  2,
  'reclaim increments the provider attempt count'
);
select extensions.throws_ok(
  $$
    select internal.finish_durable_job(
      '70000000-0000-4000-8000-000000000001',
      'same-worker',
      1,
      true,
      null
    )
  $$,
  'P0001',
  'JOB_LEASE_GENERATION_MISMATCH',
  'a stale same-owner ABA completion is rejected'
);
select extensions.is(
  internal.finish_durable_job(
    '70000000-0000-4000-8000-000000000001',
    'same-worker',
    2,
    true,
    null
  ),
  'completed',
  'the current generation can complete the job'
);
select extensions.is(
  (
    select status
    from public.durable_jobs
    where id = '70000000-0000-4000-8000-000000000001'
  ),
  'completed',
  'the reclaimed job remains completed'
);

insert into private.zoom_registrant_receipt_fences (business_key)
values ('zoom-registrant:70000000-0000-4000-8000-000000000002');

select extensions.lives_ok(
  $receipt$
    select internal.record_provider_operation_receipt(
      'zoom',
      'register_participant',
      'zoom-registrant:70000000-0000-4000-8000-000000000002',
      'registrant-authoritative',
      repeat('a', 64),
      jsonb_build_object(
        'registrantId',
        'registrant-authoritative',
        'encryptedRegistrantToken',
        jsonb_build_object(
          'version', 1,
          'iv', 'iv',
          'ciphertext', 'ciphertext',
          'tag', 'tag'
        )
      )
    )
  $receipt$,
  'a registrant receipt can commit while its fence remains open'
);
select extensions.is(
  (
    select state
    from private.zoom_registrant_receipt_fences
    where business_key =
      'zoom-registrant:70000000-0000-4000-8000-000000000002'
  ),
  'receipt_authoritative',
  'recording a registrant receipt commits the authoritative fence'
);

insert into private.zoom_registrant_receipt_fences (
  business_key,
  state,
  provider_reference,
  sealed_at
) values (
  'zoom-registrant:70000000-0000-4000-8000-000000000003',
  'sealed_no_receipt',
  'registrant-revoked',
  clock_timestamp()
);
select extensions.throws_ok(
  $$
    select internal.record_provider_operation_receipt(
      'zoom',
      'register_participant',
      'zoom-registrant:70000000-0000-4000-8000-000000000003',
      'registrant-revoked',
      repeat('b', 64),
      jsonb_build_object(
        'registrantId',
        'registrant-revoked',
        'encryptedRegistrantToken',
        jsonb_build_object(
          'version', 1,
          'iv', 'iv',
          'ciphertext', 'ciphertext',
          'tag', 'tag'
        )
      )
    )
  $$,
  'P0001',
  'ZOOM_REGISTRANT_RECEIPT_FENCED_REVOKE',
  'a sealed absent-receipt decision rejects every late receipt'
);

select * from extensions.finish();
rollback;
