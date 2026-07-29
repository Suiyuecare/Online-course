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
    '98000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', '+886912980001', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '98000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', '+886912980002', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

select set_config(
  'test.question.admin_person_id',
  (
    select person_id::text
    from public.auth_identities
    where auth_user_id = '98000000-0000-4000-8000-000000000001'
  ),
  true
);

insert into public.staff_roles (person_id, role)
values (
  current_setting('test.question.admin_person_id')::uuid,
  'course_admin'
);

insert into public.courses (
  id, slug, internal_title, created_by
) values (
  '98100000-0000-4000-8000-000000000001',
  'question-batch-import-test',
  '題庫批次匯入測試',
  current_setting('test.question.admin_person_id')::uuid
);

insert into public.course_versions (
  id, course_id, version, title, summary, description,
  delivery_type, status, created_by, authoring_idempotency_key
) values (
  '98100000-0000-4000-8000-000000000002',
  '98100000-0000-4000-8000-000000000001',
  1, '題庫批次匯入測試', '驗證原子匯入',
  '驗證題目、選項、答案、授權與冪等。',
  'recorded', 'draft',
  current_setting('test.question.admin_person_id')::uuid,
  '98100000-0000-4000-8000-000000000003'
);

insert into public.question_banks (
  id, course_version_id, version, created_by
) values (
  '98100000-0000-4000-8000-000000000004',
  '98100000-0000-4000-8000-000000000002',
  1,
  current_setting('test.question.admin_person_id')::uuid
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.import_question_draft_batch(uuid,jsonb,uuid)',
    'execute'
  ),
  'authenticated users can resolve the guarded public batch RPC'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.import_question_draft_batch(uuid,jsonb,uuid)',
    'execute'
  ),
  'anonymous users cannot execute the question batch RPC'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '98000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '98000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select set_config(
  'test.question.first_response',
  public.import_question_draft_batch(
    '98100000-0000-4000-8000-000000000002',
    $json$
      [
        {
          "prompt": "遇到失智者反覆提問時，第一步應該怎麼做？",
          "topic": "失智溝通",
          "options": ["責備", "回應情緒並提供提示", "忽略", "限制活動"],
          "correctIndex": 1,
          "explanation": "先理解情緒與需求，再用環境線索協助定向。"
        },
        {
          "prompt": "協助長者安全移位前，應優先確認什麼？",
          "topic": "安全移位",
          "options": ["地面與輔具", "電視音量", "餐點口味", "訪客人數"],
          "correctIndex": 0,
          "explanation": "先確認環境、煞車與輔具狀態，才能降低跌倒風險。"
        }
      ]
    $json$::jsonb,
    '98200000-0000-4000-8000-000000000001'
  )::text,
  true
);

select extensions.is(
  (current_setting('test.question.first_response')::jsonb
    ->> 'importedCount')::integer,
  2,
  'a course administrator imports the complete validated batch'
);
reset role;

select extensions.is(
  (
    select count(*)::integer
    from public.question_versions
    where question_bank_id = '98100000-0000-4000-8000-000000000004'
  ),
  2,
  'the batch creates two question versions'
);
select extensions.is(
  (
    select count(*)::integer
    from public.question_option_versions option
    join public.question_versions question
      on question.id = option.question_version_id
    where question.question_bank_id =
      '98100000-0000-4000-8000-000000000004'
  ),
  8,
  'the batch creates exactly four options for every question'
);
select extensions.is(
  (
    select count(*)::integer
    from private.question_answer_keys answer
    join public.question_versions question
      on question.id = answer.question_version_id
    where question.question_bank_id =
      '98100000-0000-4000-8000-000000000004'
  ),
  2,
  'the batch records one private answer key per question'
);

set local role authenticated;
select extensions.is(
  public.import_question_draft_batch(
    '98100000-0000-4000-8000-000000000002',
    $json$
      [
        {
          "prompt": "遇到失智者反覆提問時，第一步應該怎麼做？",
          "topic": "失智溝通",
          "options": ["責備", "回應情緒並提供提示", "忽略", "限制活動"],
          "correctIndex": 1,
          "explanation": "先理解情緒與需求，再用環境線索協助定向。"
        },
        {
          "prompt": "協助長者安全移位前，應優先確認什麼？",
          "topic": "安全移位",
          "options": ["地面與輔具", "電視音量", "餐點口味", "訪客人數"],
          "correctIndex": 0,
          "explanation": "先確認環境、煞車與輔具狀態，才能降低跌倒風險。"
        }
      ]
    $json$::jsonb,
    '98200000-0000-4000-8000-000000000001'
  )::text,
  current_setting('test.question.first_response'),
  'an identical idempotent replay returns the original response'
);
reset role;

select extensions.is(
  (
    select count(*)::integer
    from public.question_versions
    where question_bank_id = '98100000-0000-4000-8000-000000000004'
  ),
  2,
  'an idempotent replay creates no duplicate questions'
);

set local role authenticated;
select extensions.throws_ok(
  $$
    select public.import_question_draft_batch(
      '98100000-0000-4000-8000-000000000002',
      '[{
        "prompt":"這是另一個不同的有效題目內容？",
        "topic":"不同主題",
        "options":["一","二","三","四"],
        "correctIndex":0,
        "explanation":"這是足夠長度的答案說明。"
      }]'::jsonb,
      '98200000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'IDEMPOTENCY_REQUEST_CONFLICT',
  'reusing a completed key for a different payload is rejected'
);

select extensions.throws_ok(
  $$
    select public.import_question_draft_batch(
      '98100000-0000-4000-8000-000000000002',
      '[
        {
          "prompt":"第一題本身是有效的測試題目？",
          "topic":"原子測試",
          "options":["一","二","三","四"],
          "correctIndex":0,
          "explanation":"這是足夠長度的答案說明。"
        },
        {
          "prompt":"第二題包含錯誤答案索引？",
          "topic":"原子測試",
          "options":["一","二","三","四"],
          "correctIndex":9,
          "explanation":"這是足夠長度的答案說明。"
        }
      ]'::jsonb,
      '98200000-0000-4000-8000-000000000002'
    )
  $$,
  'P0001',
  'QUESTION_SPEC_INVALID',
  'a malformed row rejects the entire batch'
);
reset role;

select extensions.is(
  (
    select count(*)::integer
    from public.question_versions
    where question_bank_id = '98100000-0000-4000-8000-000000000004'
  ),
  2,
  'a rejected batch leaves the existing question bank unchanged'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '98000000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'aal', 'aal1',
    'iat', extract(epoch from now())::bigint
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '98000000-0000-4000-8000-000000000002',
  true
);
set local role authenticated;
select extensions.throws_ok(
  $$
    select public.import_question_draft_batch(
      '98100000-0000-4000-8000-000000000002',
      '[{
        "prompt":"一般學員不得建立這一個題目？",
        "topic":"權限測試",
        "options":["一","二","三","四"],
        "correctIndex":0,
        "explanation":"這是足夠長度的答案說明。"
      }]'::jsonb,
      '98200000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'QUESTION_IMPORT_REJECTED',
  'a learner cannot import questions into a draft'
);
reset role;

select extensions.finish();
rollback;
