begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;

select extensions.plan(18);

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '99600000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', '+886912996001', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '99600000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', '+886912996002', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

select set_config(
  'test.cart.person_one',
  (
    select person_id::text
    from public.auth_identities
    where auth_user_id = '99600000-0000-4000-8000-000000000001'
  ),
  true
);
select set_config(
  'test.cart.person_two',
  (
    select person_id::text
    from public.auth_identities
    where auth_user_id = '99600000-0000-4000-8000-000000000002'
  ),
  true
);

insert into public.organizing_bodies (
  id, legal_name, qualification_reference,
  qualification_valid_from, contact_name, contact_email
) values (
  '99600000-0000-4000-8000-000000000010',
  '購物車測試主辦單位', 'CART-TEST',
  current_date - 1, '購物車測試承辦人', 'cart-body@example.test'
);

insert into public.accreditation_authorities (
  id, name, submission_method, contact_name, contact_email
) values (
  '99600000-0000-4000-8000-000000000011',
  '購物車測試核定單位', 'test',
  '購物車核定承辦人', 'cart-authority@example.test'
);

insert into public.legal_documents (
  id, kind, revision, content_sha256, object_path,
  approved_by_legal, effective_at
) values (
  '99600000-0000-4000-8000-000000000012',
  'b2c_contract', 996001, repeat('a', 64),
  'legal/test-learner-cart', true, now() - interval '1 day'
);

insert into public.courses (
  id, slug, internal_title, created_by
) values
  (
    '99600000-0000-4000-8000-000000000020',
    'learner-cart-published',
    '購物車已發布課',
    current_setting('test.cart.person_one')::uuid
  ),
  (
    '99600000-0000-4000-8000-000000000021',
    'learner-cart-draft',
    '購物車草稿課',
    current_setting('test.cart.person_one')::uuid
  );

set local session_replication_role = replica;
insert into public.course_versions (
  id, course_id, version, title, summary, description,
  delivery_type, category_code, status, price_twd,
  recorded_refund_allocation_twd,
  legal_document_id, minimum_completion_window, commerce_close_at,
  content_available_at, has_cover, published_at, created_by,
  authoring_idempotency_key
) values
  (
    '99600000-0000-4000-8000-000000000030',
    '99600000-0000-4000-8000-000000000020',
    1, '權威價格購物車課', '購物車同步摘要',
    '驗證跨裝置購物車只保存課程版本，不接受前端價格。',
    'recorded', 'daily_care_skills', 'published', 900, 900,
    '99600000-0000-4000-8000-000000000012',
    interval '30 days', now() + interval '365 days',
    now() - interval '1 hour', true, now(),
    current_setting('test.cart.person_one')::uuid,
    '99600000-0000-4000-8000-000000000031'
  ),
  (
    '99600000-0000-4000-8000-000000000032',
    '99600000-0000-4000-8000-000000000021',
    1, '不可加入的草稿課', '草稿摘要', '草稿說明',
    'recorded', 'daily_care_skills', 'draft', 1200, 1200,
    '99600000-0000-4000-8000-000000000012',
    interval '30 days', now() + interval '365 days',
    now() - interval '1 hour', false, null,
    current_setting('test.cart.person_one')::uuid,
    '99600000-0000-4000-8000-000000000033'
  );
set local session_replication_role = origin;

insert into public.accreditation_decision_revisions (
  id, course_id, organizing_body_id, authority_id,
  revision, status, approval_reference, points,
  valid_from, valid_until, effective_at,
  source_document_path, source_document_sha256,
  review_snapshot, created_by, reviewed_by
) values (
  '99600000-0000-4000-8000-000000000040',
  '99600000-0000-4000-8000-000000000020',
  '99600000-0000-4000-8000-000000000010',
  '99600000-0000-4000-8000-000000000011',
  1, 'approved', 'CART-APPROVED', 2,
  now() - interval '1 day', now() + interval '730 days', now(),
  'accreditation/test-learner-cart', repeat('b', 64),
  '{"purpose":"learner cart test"}'::jsonb,
  current_setting('test.cart.person_one')::uuid,
  current_setting('test.cart.person_two')::uuid
);

insert into public.course_version_accreditation (
  course_version_id, accreditation_revision_id, disclosure_snapshot
) values (
  '99600000-0000-4000-8000-000000000030',
  '99600000-0000-4000-8000-000000000040',
  '購物車測試核定快照'
);

insert into public.learner_cart_items (
  person_id, course_version_id
) values (
  current_setting('test.cart.person_two')::uuid,
  '99600000-0000-4000-8000-000000000030'
);

select extensions.ok(
  not has_table_privilege(
    'anon',
    'public.learner_cart_items',
    'select'
  ),
  'anonymous visitors cannot read account carts'
);
select extensions.ok(
  has_table_privilege(
    'authenticated',
    'public.learner_cart_items',
    'select'
  ),
  'authenticated learners can resolve the owner-scoped cart table'
);
select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'public.learner_cart_items',
    'insert'
  ),
  'authenticated learners cannot insert cart rows directly'
);
select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'public.learner_cart_items',
    'delete'
  ),
  'authenticated learners cannot delete cart rows directly'
);
select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'public.learner_cart_items',
    'update'
  ),
  'authenticated learners cannot update cart rows directly'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.read_own_learner_cart()',
    'execute'
  ),
  'authenticated learners can read their cart through a narrow RPC'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.read_own_learner_cart()',
    'execute'
  ),
  'anonymous visitors cannot execute the cart reader'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.sync_own_learner_cart(text,uuid[])',
    'execute'
  ),
  'authenticated learners can use the idempotent cart sync RPC'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.sync_own_learner_cart(text,uuid[])',
    'execute'
  ),
  'anonymous visitors cannot execute account cart synchronization'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99600000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal1',
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

select extensions.results_eq(
  $$select count(*)::bigint from public.learner_cart_items$$,
  $$values (0::bigint)$$,
  'a learner cannot read another learner cart'
);
select extensions.is(
  jsonb_array_length(
    public.read_own_learner_cart() -> 'items'
  ),
  0,
  'the account cart reader starts empty for the first learner'
);
select extensions.is(
  jsonb_array_length(
    public.sync_own_learner_cart(
      'merge',
      array['99600000-0000-4000-8000-000000000030'::uuid]
    ) -> 'items'
  ),
  1,
  'merging a device cart persists the published course'
);
select extensions.is(
  (
    public.read_own_learner_cart()
      -> 'items' -> 0 ->> 'priceTwd'
  )::integer,
  900,
  'the cart price is rebuilt from the authoritative course version'
);
select extensions.is(
  (
    public.sync_own_learner_cart(
      'merge',
      array[
        '99600000-0000-4000-8000-000000000030'::uuid,
        '99600000-0000-4000-8000-000000000032'::uuid
      ]
    ) -> 'rejectedCourseVersionIds' ->> 0
  ),
  '99600000-0000-4000-8000-000000000032',
  'merge reports a draft local item without persisting it'
);
select extensions.throws_ok(
  $$
    select public.sync_own_learner_cart(
      'add',
      array['99600000-0000-4000-8000-000000000032'::uuid]
    )
  $$,
  'P0001',
  'LEARNER_CART_COURSE_UNAVAILABLE',
  'a draft course cannot be added through the cart RPC'
);
select extensions.throws_ok(
  $$
    select public.sync_own_learner_cart(
      null,
      '{}'::uuid[]
    )
  $$,
  'P0001',
  'LEARNER_CART_INVALID',
  'a missing operation cannot fall through to an implicit merge'
);
select extensions.is(
  jsonb_array_length(
    public.sync_own_learner_cart(
      'remove',
      array['99600000-0000-4000-8000-000000000030'::uuid]
    ) -> 'items'
  ),
  0,
  'removing a cart item is account scoped and idempotent'
);

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '99600000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '99600000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;

select extensions.is(
  jsonb_array_length(
    public.read_own_learner_cart() -> 'items'
  ),
  1,
  'removing one learner item does not touch another learner cart'
);

reset role;
select * from extensions.finish();
rollback;
