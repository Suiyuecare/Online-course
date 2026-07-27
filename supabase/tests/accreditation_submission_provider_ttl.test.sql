begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(19);

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '96000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', '+886926000001', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '96000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', '+886926000002', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.organizing_bodies (
  id, legal_name, qualification_reference, qualification_valid_from,
  contact_name, contact_email
) values (
  '96000000-0000-4000-8000-000000000010',
  '送審測試主辦單位', 'QUAL-9600', current_date - 1,
  '測試窗口', 'organizer@example.test'
);

insert into public.accreditation_authorities (
  id, name, submission_method, contact_name, contact_email
) values (
  '96000000-0000-4000-8000-000000000011',
  '送審測試認可單位', 'encrypted-upload',
  '認可窗口', 'authority@example.test'
);

insert into public.courses (
  id, slug, internal_title, created_by
) values (
  '96000000-0000-4000-8000-000000000020',
  'submission-claim-fixture',
  '送審 claim 交易測試',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '96000000-0000-4000-8000-000000000001'
  )
);

insert into public.course_versions (
  id, course_id, version, title, summary, description,
  delivery_type, status, commerce_close_at, created_by,
  authoring_idempotency_key
) values
  (
    '96000000-0000-4000-8000-000000000021',
    '96000000-0000-4000-8000-000000000020',
    1, '錄播送審測試', '錄播範圍', '錄播批次只能使用空場次',
    'recorded', 'draft', now() + interval '30 days',
    (
      select person_id
      from public.auth_identities
      where auth_user_id = '96000000-0000-4000-8000-000000000001'
    ),
    '96000000-0000-4000-8000-000000000022'
  ),
  (
    '96000000-0000-4000-8000-000000000023',
    '96000000-0000-4000-8000-000000000020',
    2, '直播送審測試', '直播範圍', '直播批次只能使用已結束場次',
    'live', 'draft', now() + interval '30 days',
    (
      select person_id
      from public.auth_identities
      where auth_user_id = '96000000-0000-4000-8000-000000000001'
    ),
    '96000000-0000-4000-8000-000000000024'
  );

insert into public.accreditation_decision_revisions (
  id, course_id, organizing_body_id, authority_id, revision, status,
  application_reference, approval_reference, points,
  valid_from, valid_until, effective_at,
  source_document_path, source_document_sha256, review_snapshot,
  created_by, reviewed_by
) values (
  '96000000-0000-4000-8000-000000000030',
  '96000000-0000-4000-8000-000000000020',
  '96000000-0000-4000-8000-000000000010',
  '96000000-0000-4000-8000-000000000011',
  1, 'approved', 'APP-9600', 'APPROVED-9600', 1,
  now() - interval '1 day', now() + interval '30 days',
  now() - interval '1 day',
  'private/accreditation/approved-9600.pdf', repeat('a', 64),
  '{"fixture":true}'::jsonb,
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '96000000-0000-4000-8000-000000000001'
  ),
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '96000000-0000-4000-8000-000000000002'
  )
);

insert into public.course_version_accreditation (
  course_version_id, accreditation_revision_id,
  disclosure_snapshot, terms_reconfirmed_at
) values
  (
    '96000000-0000-4000-8000-000000000021',
    '96000000-0000-4000-8000-000000000030',
    '核定測試揭露', now()
  ),
  (
    '96000000-0000-4000-8000-000000000023',
    '96000000-0000-4000-8000-000000000030',
    '核定測試揭露', now()
  );

insert into public.live_sessions (
  id, course_version_id, title, status, starts_at, ends_at,
  booking_close_at, learner_capacity, verified_zoom_total_capacity,
  scheduled_teaching_seconds, evidence_settles_at,
  application_idempotency_key, created_by
) values
  (
    '96000000-0000-4000-8000-000000000040',
    '96000000-0000-4000-8000-000000000023',
    '已結束直播場次 A', 'ended',
    now() - interval '3 hours', now() - interval '1 hour',
    now() - interval '4 hours', 50, 100, 7200,
    now() + interval '23 hours',
    '96000000-0000-4000-8000-000000000041',
    (
      select person_id
      from public.auth_identities
      where auth_user_id = '96000000-0000-4000-8000-000000000001'
    )
  ),
  (
    '96000000-0000-4000-8000-000000000042',
    '96000000-0000-4000-8000-000000000023',
    '已結束直播場次 B', 'ended',
    now() - interval '6 hours', now() - interval '4 hours',
    now() - interval '7 hours', 50, 100, 7200,
    now() + interval '20 hours',
    '96000000-0000-4000-8000-000000000043',
    (
      select person_id
      from public.auth_identities
      where auth_user_id = '96000000-0000-4000-8000-000000000001'
    )
  );

select extensions.ok(
  internal.accreditation_submission_scope_is_valid(
    '96000000-0000-4000-8000-000000000021',
    '96000000-0000-4000-8000-000000000030',
    null,
    now()
  ),
  'a recorded batch requires a null live-session scope'
);

select extensions.ok(
  not internal.accreditation_submission_scope_is_valid(
    '96000000-0000-4000-8000-000000000021',
    '96000000-0000-4000-8000-000000000030',
    '96000000-0000-4000-8000-000000000040',
    now()
  ),
  'a recorded batch rejects a live-session scope'
);

select extensions.ok(
  not internal.accreditation_submission_scope_is_valid(
    '96000000-0000-4000-8000-000000000023',
    '96000000-0000-4000-8000-000000000030',
    null,
    now()
  ),
  'a live batch rejects a null live-session scope'
);

select extensions.ok(
  internal.accreditation_submission_scope_is_valid(
    '96000000-0000-4000-8000-000000000023',
    '96000000-0000-4000-8000-000000000030',
    '96000000-0000-4000-8000-000000000040',
    now()
  ),
  'a live batch accepts only its ended session'
);

insert into public.entitlements (
  id, person_id, course_version_id, source_type, source_id, status,
  starts_at
) values (
  '96000000-0000-4000-8000-000000000050',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '96000000-0000-4000-8000-000000000001'
  ),
  '96000000-0000-4000-8000-000000000021',
  'b2c_order', '96000000-0000-4000-8000-000000000051',
  'active', now()
);

insert into public.enrollments (
  id, person_id, course_version_id, entitlement_id, status,
  completed_at
) values (
  '96000000-0000-4000-8000-000000000052',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '96000000-0000-4000-8000-000000000001'
  ),
  '96000000-0000-4000-8000-000000000021',
  '96000000-0000-4000-8000-000000000050',
  'completed', now()
);

insert into public.eligibility_snapshots (
  id, enrollment_id, accreditation_revision_id, authoritative_date,
  entitlement_valid, identity_verified, recorded_requirement_met,
  live_requirements_met, quiz_passed, survey_completed,
  accreditation_valid, evidence_manifest_hash, signed_snapshot
) values (
  '96000000-0000-4000-8000-000000000053',
  '96000000-0000-4000-8000-000000000052',
  '96000000-0000-4000-8000-000000000030',
  current_date, true, true, true, true, true, true, true,
  repeat('b', 64), '{"fixture":true}'::jsonb
);

insert into public.accreditation_submission_batches (
  id, course_version_id, accreditation_revision_id,
  template_version, application_idempotency_key, requested_by
) values
  (
    '96000000-0000-4000-8000-000000000060',
    '96000000-0000-4000-8000-000000000021',
    '96000000-0000-4000-8000-000000000030',
    'fixture-v1', '96000000-0000-4000-8000-000000000061',
    (
      select person_id
      from public.auth_identities
      where auth_user_id = '96000000-0000-4000-8000-000000000001'
    )
  ),
  (
    '96000000-0000-4000-8000-000000000062',
    '96000000-0000-4000-8000-000000000021',
    '96000000-0000-4000-8000-000000000030',
    'fixture-v1', '96000000-0000-4000-8000-000000000063',
    (
      select person_id
      from public.auth_identities
      where auth_user_id = '96000000-0000-4000-8000-000000000001'
    )
  );

insert into public.accreditation_submission_items (
  batch_id, enrollment_id, eligibility_snapshot_id, status
) values
  (
    '96000000-0000-4000-8000-000000000060',
    '96000000-0000-4000-8000-000000000052',
    '96000000-0000-4000-8000-000000000053',
    'included'
  ),
  (
    '96000000-0000-4000-8000-000000000062',
    '96000000-0000-4000-8000-000000000052',
    '96000000-0000-4000-8000-000000000053',
    'included'
  );

insert into public.accreditation_submission_claims (
  id, batch_id, enrollment_id, accreditation_revision_id,
  eligibility_snapshot_id, status
) values (
  '96000000-0000-4000-8000-000000000064',
  '96000000-0000-4000-8000-000000000060',
  '96000000-0000-4000-8000-000000000052',
  '96000000-0000-4000-8000-000000000030',
  '96000000-0000-4000-8000-000000000053',
  'active'
);

select extensions.throws_ok(
  $$
    insert into public.accreditation_submission_claims (
      id, batch_id, enrollment_id, accreditation_revision_id,
      eligibility_snapshot_id, status
    ) values (
      '96000000-0000-4000-8000-000000000065',
      '96000000-0000-4000-8000-000000000062',
      '96000000-0000-4000-8000-000000000052',
      '96000000-0000-4000-8000-000000000030',
      '96000000-0000-4000-8000-000000000053',
      'active'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "one_active_or_accepted_submission_per_enrollment"',
  'one enrollment cannot be active or accepted in two batches'
);

insert into public.entitlements (
  id, person_id, course_version_id, source_type, source_id, status,
  starts_at
) values (
  '96000000-0000-4000-8000-000000000054',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '96000000-0000-4000-8000-000000000001'
  ),
  '96000000-0000-4000-8000-000000000023',
  'b2c_order', '96000000-0000-4000-8000-000000000055',
  'active', now()
);

insert into public.enrollments (
  id, person_id, course_version_id, entitlement_id, status,
  completed_at
) values (
  '96000000-0000-4000-8000-000000000056',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '96000000-0000-4000-8000-000000000001'
  ),
  '96000000-0000-4000-8000-000000000023',
  '96000000-0000-4000-8000-000000000054',
  'completed', now()
);

insert into public.live_bookings (
  id, person_id, enrollment_id, course_version_id,
  live_session_id, payer_type, payer_source_id, status,
  customer_key, change_locked_at, idempotency_key
) values
  (
    '96000000-0000-4000-8000-000000000057',
    (
      select person_id
      from public.auth_identities
      where auth_user_id = '96000000-0000-4000-8000-000000000001'
    ),
    '96000000-0000-4000-8000-000000000056',
    '96000000-0000-4000-8000-000000000023',
    '96000000-0000-4000-8000-000000000040',
    'b2c', '96000000-0000-4000-8000-000000000090',
    'attended', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    now() - interval '1 day',
    '96000000-0000-4000-8000-000000000091'
  ),
  (
    '96000000-0000-4000-8000-000000000058',
    (
      select person_id
      from public.auth_identities
      where auth_user_id = '96000000-0000-4000-8000-000000000001'
    ),
    '96000000-0000-4000-8000-000000000056',
    '96000000-0000-4000-8000-000000000023',
    '96000000-0000-4000-8000-000000000042',
    'b2c', '96000000-0000-4000-8000-000000000092',
    'cancelled', 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    now() - interval '1 day',
    '96000000-0000-4000-8000-000000000093'
  );

insert into public.attendance_summaries (
  id, live_booking_id, denominator_seconds,
  effective_presence_seconds, camera_seconds,
  presence_percent, camera_percent, device_check_passed,
  checked_in, checked_out, qualified, source_manifest_hash,
  settled_at
) values
  (
    '96000000-0000-4000-8000-000000000059',
    '96000000-0000-4000-8000-000000000057',
    7200, 7200, 7200, 100, 100, true, true, true, true,
    repeat('e', 64), now()
  ),
  (
    '96000000-0000-4000-8000-000000000066',
    '96000000-0000-4000-8000-000000000058',
    7200, 7200, 7200, 100, 100, true, true, true, true,
    repeat('f', 64), now()
  );

insert into public.eligibility_snapshots (
  id, enrollment_id, accreditation_revision_id, authoritative_date,
  entitlement_valid, identity_verified, recorded_requirement_met,
  live_requirements_met, quiz_passed, survey_completed,
  accreditation_valid, evidence_manifest_hash, signed_snapshot
) values (
  '96000000-0000-4000-8000-000000000067',
  '96000000-0000-4000-8000-000000000056',
  '96000000-0000-4000-8000-000000000030',
  current_date, true, true, true, true, true, true, true,
  repeat('1', 64), '{"fixture":true}'::jsonb
);

insert into public.accreditation_submission_batches (
  id, course_version_id, accreditation_revision_id, live_session_id,
  template_version, application_idempotency_key, requested_by
) values
  (
    '96000000-0000-4000-8000-000000000068',
    '96000000-0000-4000-8000-000000000023',
    '96000000-0000-4000-8000-000000000030',
    '96000000-0000-4000-8000-000000000040',
    'fixture-live-a', '96000000-0000-4000-8000-000000000094',
    (
      select person_id
      from public.auth_identities
      where auth_user_id = '96000000-0000-4000-8000-000000000001'
    )
  ),
  (
    '96000000-0000-4000-8000-000000000069',
    '96000000-0000-4000-8000-000000000023',
    '96000000-0000-4000-8000-000000000030',
    '96000000-0000-4000-8000-000000000042',
    'fixture-live-b', '96000000-0000-4000-8000-000000000095',
    (
      select person_id
      from public.auth_identities
      where auth_user_id = '96000000-0000-4000-8000-000000000001'
    )
  );

insert into public.accreditation_submission_items (
  batch_id, enrollment_id, eligibility_snapshot_id,
  live_booking_id, status
) values
  (
    '96000000-0000-4000-8000-000000000068',
    '96000000-0000-4000-8000-000000000056',
    '96000000-0000-4000-8000-000000000067',
    '96000000-0000-4000-8000-000000000057',
    'included'
  ),
  (
    '96000000-0000-4000-8000-000000000069',
    '96000000-0000-4000-8000-000000000056',
    '96000000-0000-4000-8000-000000000067',
    '96000000-0000-4000-8000-000000000058',
    'included'
  );

insert into public.accreditation_submission_claims (
  id, batch_id, enrollment_id, live_booking_id,
  accreditation_revision_id, eligibility_snapshot_id, status
) values (
  '96000000-0000-4000-8000-000000000096',
  '96000000-0000-4000-8000-000000000069',
  '96000000-0000-4000-8000-000000000056',
  '96000000-0000-4000-8000-000000000058',
  '96000000-0000-4000-8000-000000000030',
  '96000000-0000-4000-8000-000000000067',
  'active'
);

select extensions.is(
  (
    select required_live_booking_ids
    from public.eligibility_snapshots
    where id = '96000000-0000-4000-8000-000000000067'
  ),
  array['96000000-0000-4000-8000-000000000057'::uuid],
  'eligibility captures only the exact attended and qualified booking'
);

select extensions.ok(
  internal.accreditation_submission_item_scope_is_valid(
    '96000000-0000-4000-8000-000000000068',
    '96000000-0000-4000-8000-000000000056',
    '96000000-0000-4000-8000-000000000067',
    '96000000-0000-4000-8000-000000000057'
  ),
  'the qualified A booking is valid only for the A batch'
);

select extensions.ok(
  not internal.accreditation_submission_item_scope_is_valid(
    '96000000-0000-4000-8000-000000000069',
    '96000000-0000-4000-8000-000000000056',
    '96000000-0000-4000-8000-000000000067',
    '96000000-0000-4000-8000-000000000058'
  ),
  'an A-qualified learner with a cancelled B booking cannot enter B'
);

select extensions.ok(
  not internal.batch_has_valid_active_claims(
    '96000000-0000-4000-8000-000000000069'
  ),
  'every downstream gate rejects a claim bound to cancelled B'
);

select extensions.throws_ok(
  $$
    update public.accreditation_submission_items
    set live_booking_id = '96000000-0000-4000-8000-000000000057'
    where batch_id = '96000000-0000-4000-8000-000000000069'
      and enrollment_id = '96000000-0000-4000-8000-000000000056'
  $$,
  'P0001',
  'ACCREDITATION_LIVE_BINDING_IMMUTABLE',
  'a persisted submission live-booking binding cannot be changed'
);

select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'public.accreditation_submission_claims',
    'select'
  ),
  'browser roles cannot read submission claims directly'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.create_accreditation_submission_batch(uuid,uuid,uuid,text,uuid,uuid)',
    'execute'
  ),
  'authenticated staff can call only the role-checked correction-aware wrapper'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.create_accreditation_submission_batch(uuid,uuid,uuid,text,uuid)',
    'execute'
  ),
  'the lineage-free batch overload is disabled'
);

insert into public.accreditation_decision_revisions (
  id, course_id, organizing_body_id, authority_id, revision, status,
  application_reference, valid_from, valid_until, effective_at,
  source_document_path, source_document_sha256, review_snapshot,
  created_by, reviewed_by
) values (
  '96000000-0000-4000-8000-000000000070',
  '96000000-0000-4000-8000-000000000020',
  '96000000-0000-4000-8000-000000000010',
  '96000000-0000-4000-8000-000000000011',
  2, 'revoked', 'APP-9600',
  now() - interval '1 day', now() + interval '30 days', now(),
  'private/accreditation/revoked-9600.pdf', repeat('c', 64),
  '{"fixture":true}'::jsonb,
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '96000000-0000-4000-8000-000000000001'
  ),
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '96000000-0000-4000-8000-000000000002'
  )
);

select extensions.ok(
  (
    select isolated_at is not null
      and isolated_by_revision_id =
        '96000000-0000-4000-8000-000000000070'
    from public.accreditation_submission_batches
    where id = '96000000-0000-4000-8000-000000000060'
  ),
  'a negative latest revision isolates every unfinished batch'
);

select extensions.is(
  (
    select status
    from public.accreditation_submission_claims
    where id = '96000000-0000-4000-8000-000000000064'
  ),
  'isolated',
  'negative accreditation resolves the active claim as isolated'
);

select extensions.is(
  (
    select count(*)::integer
    from public.accreditation_submission_claim_events
    where claim_id = '96000000-0000-4000-8000-000000000064'
      and next_status = 'isolated'
  ),
  1,
  'claim isolation preserves one append-only transition event'
);

select extensions.is(
  (
    select status
    from public.accreditation_submission_items
    where batch_id = '96000000-0000-4000-8000-000000000060'
      and enrollment_id = '96000000-0000-4000-8000-000000000052'
  ),
  'excluded',
  'negative accreditation excludes the previously claimed row'
);

insert into public.provider_validation_requests (
  id, provider, evidence_reference, evidence_sha256,
  test_environment, tested_at, requested_by, request_reason,
  status, reviewed_by, review_reason, reviewed_at, idempotency_key
) values (
  '96000000-0000-4000-8000-000000000080',
  'cloudflare_stream', 'ticket://provider-9600', repeat('d', 64),
  'production', now() - interval '1 day',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '96000000-0000-4000-8000-000000000001'
  ),
  'production evidence fixture',
  'approved',
  (
    select person_id
    from public.auth_identities
    where auth_user_id = '96000000-0000-4000-8000-000000000002'
  ),
  'independent provider evidence approval',
  now() - interval '1 hour',
  '96000000-0000-4000-8000-000000000081'
);

update public.provider_health
set status = 'healthy',
    checked_at = now(),
    last_success_at = now(),
    production_validated_at = (
      select reviewed_at
      from public.provider_validation_requests
      where id = '96000000-0000-4000-8000-000000000080'
    ),
    production_validation_expires_at = (
      select tested_at + interval '90 days'
      from public.provider_validation_requests
      where id = '96000000-0000-4000-8000-000000000080'
    )
where provider = 'cloudflare_stream';

select extensions.ok(
  internal.provider_production_validation_is_current(
    'cloudflare_stream', now()
  ),
  'production provider validation is current before its explicit TTL'
);

select extensions.ok(
  not internal.provider_production_validation_is_current(
    'cloudflare_stream', now() + interval '91 days'
  ),
  'production provider validation fails closed after its explicit TTL'
);

select extensions.finish();
rollback;
