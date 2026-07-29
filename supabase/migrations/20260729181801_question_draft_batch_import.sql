-- Course administrators can preview a CSV in the browser and then commit the
-- validated batch in one database transaction. The database repeats every
-- validation because browser validation is not an authorization boundary.

create or replace function internal.import_question_draft_batch(
  target_version uuid,
  submitted_questions jsonb,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  bank_id uuid;
  question_spec jsonb;
  option_spec jsonb;
  option_text text;
  option_index integer;
  correct_index integer;
  question_sort integer;
  question_id uuid;
  option_id uuid;
  correct_option uuid;
  question_ids jsonb := '[]'::jsonb;
  request_hash text;
  prior public.idempotency_records%rowtype;
  result jsonb;
begin
  if actor is null
     or not internal.has_staff_role('course_admin')
     or idempotency is null
     or jsonb_typeof(submitted_questions) is distinct from 'array'
  then
    raise exception 'QUESTION_IMPORT_REJECTED';
  end if;
  if jsonb_array_length(submitted_questions) not between 1 and 200 then
    raise exception 'QUESTION_IMPORT_REJECTED';
  end if;

  select bank.id
  into bank_id
  from public.question_banks bank
  join public.course_versions version
    on version.id = bank.course_version_id
  where bank.course_version_id = target_version
    and bank.locked_at is null
    and version.status = 'draft'
    and (
      version.created_by = actor
      or internal.has_staff_role('platform_admin')
    )
  for update of bank, version;
  if not found then
    raise exception 'QUESTION_BANK_LOCKED';
  end if;

  -- Validate the complete batch before creating the idempotency fence or
  -- inserting any question. A malformed row therefore cannot cause a partial
  -- import.
  for question_spec in
    select value
    from jsonb_array_elements(submitted_questions)
  loop
    if jsonb_typeof(question_spec) is distinct from 'object' then
      raise exception 'QUESTION_SPEC_INVALID';
    end if;
    if jsonb_typeof(question_spec -> 'prompt') is distinct from 'string'
       or jsonb_typeof(question_spec -> 'topic') is distinct from 'string'
       or jsonb_typeof(question_spec -> 'explanation') is distinct from 'string'
       or jsonb_typeof(question_spec -> 'options') is distinct from 'array'
       or jsonb_typeof(question_spec -> 'correctIndex') is distinct from 'number'
    then
      raise exception 'QUESTION_SPEC_INVALID';
    end if;
    if char_length(btrim(question_spec ->> 'prompt')) not between 5 and 2000
       or char_length(btrim(question_spec ->> 'topic')) not between 2 and 200
       or char_length(btrim(question_spec ->> 'explanation'))
            not between 5 and 4000
       or jsonb_array_length(question_spec -> 'options') <> 4
       or coalesce(question_spec ->> 'correctIndex', '') !~ '^[0-3]$'
    then
      raise exception 'QUESTION_SPEC_INVALID';
    end if;

    for option_spec in
      select value
      from jsonb_array_elements(question_spec -> 'options')
    loop
      if jsonb_typeof(option_spec) is distinct from 'string'
         or char_length(btrim(option_spec #>> '{}')) not between 1 and 1000
      then
        raise exception 'QUESTION_OPTION_INVALID';
      end if;
    end loop;
  end loop;

  request_hash := internal.canonical_request_hash(jsonb_build_object(
    'courseVersionId', target_version,
    'questions', submitted_questions
  ));
  insert into public.idempotency_records (
    actor_id,
    operation,
    idempotency_key,
    request_hash,
    locked_until
  ) values (
    actor,
    'question_draft:batch_import',
    idempotency,
    request_hash,
    clock_timestamp() + interval '2 minutes'
  )
  on conflict (actor_id, operation, idempotency_key) do nothing;

  if not found then
    select record.*
    into prior
    from public.idempotency_records record
    where record.actor_id = actor
      and record.operation = 'question_draft:batch_import'
      and record.idempotency_key = idempotency
    for update;
    if not found then
      raise exception 'IDEMPOTENCY_REQUEST_CONFLICT';
    end if;
    if prior.request_hash <> request_hash
       or prior.completed_at is null
       or prior.response_body is null
    then
      raise exception 'IDEMPOTENCY_REQUEST_CONFLICT';
    end if;
    return prior.response_body;
  end if;

  select coalesce(max(question.sort_order), -1) + 1
  into question_sort
  from public.question_versions question
  where question.question_bank_id = bank_id
    and question.active;

  for question_spec in
    select value
    from jsonb_array_elements(submitted_questions)
  loop
    insert into public.question_versions (
      question_bank_id,
      stable_question_id,
      version,
      prompt,
      topic,
      explanation,
      sort_order
    ) values (
      bank_id,
      gen_random_uuid(),
      1,
      btrim(question_spec ->> 'prompt'),
      btrim(question_spec ->> 'topic'),
      btrim(question_spec ->> 'explanation'),
      question_sort
    )
    returning id into question_id;

    option_index := 0;
    correct_option := null;
    correct_index := (question_spec ->> 'correctIndex')::integer;
    for option_text in
      select btrim(value #>> '{}')
      from jsonb_array_elements(question_spec -> 'options')
    loop
      insert into public.question_option_versions (
        question_version_id,
        stable_option_id,
        option_text,
        sort_order
      ) values (
        question_id,
        gen_random_uuid(),
        option_text,
        option_index
      )
      returning id into option_id;
      if option_index = correct_index then
        correct_option := option_id;
      end if;
      option_index := option_index + 1;
    end loop;

    if correct_option is null then
      raise exception 'QUESTION_SPEC_INVALID';
    end if;
    insert into private.question_answer_keys (
      question_version_id,
      correct_option_id
    ) values (
      question_id,
      correct_option
    );

    question_ids := question_ids || jsonb_build_array(question_id);
    question_sort := question_sort + 1;
  end loop;

  result := jsonb_build_object(
    'importedCount', jsonb_array_length(submitted_questions),
    'questionIds', question_ids
  );
  update public.idempotency_records record
  set response_status = 200,
      response_body = result,
      completed_at = clock_timestamp(),
      locked_until = null
  where record.actor_id = actor
    and record.operation = 'question_draft:batch_import'
    and record.idempotency_key = idempotency;

  perform internal.append_audit_event(
    actor,
    'course.question_batch_imported',
    'course_version',
    target_version::text,
    'validated atomic question batch import',
    null,
    jsonb_build_object(
      'importedCount', jsonb_array_length(submitted_questions),
      'questionIds', question_ids
    )
  );
  return result;
end
$$;

revoke all on function internal.import_question_draft_batch(
  uuid, jsonb, uuid
) from public, anon, authenticated, service_role;

create or replace function public.import_question_draft_batch(
  p_course_version_id uuid,
  p_questions jsonb,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.import_question_draft_batch(
    p_course_version_id,
    p_questions,
    p_idempotency_key
  )
$$;

revoke all on function public.import_question_draft_batch(
  uuid, jsonb, uuid
) from public, anon, authenticated, service_role;

grant execute on function internal.import_question_draft_batch(
  uuid, jsonb, uuid
) to authenticated;
grant execute on function public.import_question_draft_batch(
  uuid, jsonb, uuid
) to authenticated;
