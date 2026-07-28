-- Keep optional learner profile PII behind the application server's KMS
-- boundary. Browser sessions may read their safe projection, but may not
-- submit values that are expected to already be encrypted.

revoke all on function public.upsert_own_learner_account_settings(
  text, jsonb, text[], text[], jsonb, boolean, bigint
) from public, anon, authenticated, service_role;

revoke all on function internal.upsert_own_learner_account_settings(
  text, jsonb, text[], text[], jsonb, boolean, bigint
) from public, anon, authenticated, service_role;

create or replace function internal.learner_account_envelope_is_valid(
  envelope jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select coalesce(
    jsonb_typeof(envelope) = 'object'
    and envelope ?& array[
      'version',
      'encryptedPayload',
      'wrappedDataKey'
    ]
    and envelope
      - 'version'
      - 'encryptedPayload'
      - 'wrappedDataKey' = '{}'::jsonb
    and envelope ->> 'version' = '1'
    and jsonb_typeof(envelope -> 'encryptedPayload') = 'object'
    and (envelope -> 'encryptedPayload') ?& array[
      'keyVersion',
      'iv',
      'ciphertext',
      'tag'
    ]
    and (envelope -> 'encryptedPayload')
      - 'keyVersion'
      - 'iv'
      - 'ciphertext'
      - 'tag' = '{}'::jsonb
    and jsonb_typeof(envelope -> 'encryptedPayload' -> 'keyVersion') = 'string'
    and jsonb_typeof(envelope -> 'encryptedPayload' -> 'iv') = 'string'
    and jsonb_typeof(envelope -> 'encryptedPayload' -> 'ciphertext') = 'string'
    and jsonb_typeof(envelope -> 'encryptedPayload' -> 'tag') = 'string'
    and jsonb_typeof(envelope -> 'wrappedDataKey') = 'object'
    and (envelope -> 'wrappedDataKey') ?& array[
      'keyVersion',
      'iv',
      'ciphertext',
      'tag'
    ]
    and (envelope -> 'wrappedDataKey')
      - 'keyVersion'
      - 'iv'
      - 'ciphertext'
      - 'tag' = '{}'::jsonb
    and jsonb_typeof(envelope -> 'wrappedDataKey' -> 'keyVersion') = 'string'
    and jsonb_typeof(envelope -> 'wrappedDataKey' -> 'iv') = 'string'
    and jsonb_typeof(envelope -> 'wrappedDataKey' -> 'ciphertext') = 'string'
    and jsonb_typeof(envelope -> 'wrappedDataKey' -> 'tag') = 'string',
    false
  )
$$;

revoke all on function internal.learner_account_envelope_is_valid(jsonb)
  from public, anon, authenticated, service_role;

create or replace function internal.upsert_learner_account_settings_for_person(
  target_person uuid,
  submitted_current_status_code text,
  submitted_professional_roles jsonb,
  submitted_learning_goal_codes text[],
  submitted_interest_codes text[],
  submitted_encrypted_profile jsonb,
  replace_encrypted_profile boolean,
  expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  person_row public.people%rowtype;
  settings_row public.learner_account_settings%rowtype;
  roles_value jsonb := coalesce(
    submitted_professional_roles,
    '[]'::jsonb
  );
  goal_values text[] := coalesce(
    submitted_learning_goal_codes,
    '{}'::text[]
  );
  interest_values text[] := coalesce(
    submitted_interest_codes,
    '{}'::text[]
  );
  role_count integer := 0;
  unique_role_count integer := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or target_person is null
  then
    raise exception 'LEARNER_ACCOUNT_SETTINGS_SERVICE_REQUIRED';
  end if;

  select person.* into person_row
  from public.people person
  where person.id = target_person
  for update;

  if not found or person_row.anonymized_at is not null then
    raise exception 'LEARNER_ACCOUNT_SETTINGS_IDENTITY_RESTRICTED';
  end if;

  if submitted_current_status_code is null
     or submitted_current_status_code not in (
       'care_professional',
       'organization_manager',
       'medical_professional',
       'student',
       'family_caregiver',
       'other',
       'undisclosed'
     )
     or jsonb_typeof(roles_value) <> 'array'
     or jsonb_array_length(roles_value) > 5
     or cardinality(goal_values) > 3
     or array_position(goal_values, null) is not null
     or not (
       goal_values <@ array[
         'earn_credits',
         'care_skills',
         'new_staff_training',
         'career_growth',
         'regulation_updates',
         'organization_management',
         'personal_growth'
       ]::text[]
     )
     or not internal.text_array_is_unique(goal_values)
     or cardinality(interest_values) > 8
     or array_position(interest_values, null) is not null
     or not (
       interest_values <@ array[
         'career_entry',
         'daily_care',
         'special_needs',
         'reablement',
         'quality_safety',
         'supervision_management',
         'ethics_rights',
         'policy_law'
       ]::text[]
     )
     or not internal.text_array_is_unique(interest_values)
     or replace_encrypted_profile is null
     or expected_version is null
     or expected_version < 0
     or (
       not replace_encrypted_profile
       and submitted_encrypted_profile is not null
     )
     or (
       replace_encrypted_profile
       and submitted_encrypted_profile is not null
       and not internal.learner_account_envelope_is_valid(
         submitted_encrypted_profile
       )
     )
  then
    raise exception 'LEARNER_ACCOUNT_SETTINGS_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(roles_value) role
    where jsonb_typeof(role) <> 'object'
       or not (role ?& array['category', 'title'])
       or role - 'category' - 'title' <> '{}'::jsonb
       or jsonb_typeof(role -> 'category') <> 'string'
       or jsonb_typeof(role -> 'title') <> 'string'
       or not (
         (
           role ->> 'category' = 'long_term_care'
           and role ->> 'title' in (
             'care_worker',
             'home_service_supervisor',
             'care_manager',
             'case_manager',
             'institution_manager'
           )
         )
         or (
           role ->> 'category' = 'medical_health'
           and role ->> 'title' in (
             'nurse',
             'physician',
             'physical_therapist',
             'occupational_therapist',
             'dietitian',
             'pharmacist'
           )
         )
         or (
           role ->> 'category' = 'social_work'
           and role ->> 'title' in (
             'social_worker',
             'community_coordinator'
           )
         )
         or (
           role ->> 'category' = 'operations'
           and role ->> 'title' in (
             'administrator',
             'training_coordinator',
             'quality_manager'
           )
         )
         or (
           role ->> 'category' = 'student_other'
           and role ->> 'title' in (
             'student',
             'family_caregiver',
             'other'
           )
         )
       )
  ) then
    raise exception 'LEARNER_ACCOUNT_ROLE_INVALID';
  end if;

  select count(*)::integer,
         count(
           distinct (
             role ->> 'category',
             role ->> 'title'
           )
         )::integer
    into role_count, unique_role_count
  from jsonb_array_elements(roles_value) role;

  if role_count <> unique_role_count then
    raise exception 'LEARNER_ACCOUNT_ROLE_DUPLICATE';
  end if;

  select settings.* into settings_row
  from public.learner_account_settings settings
  where settings.person_id = target_person
  for update;

  if found then
    if settings_row.version <> expected_version then
      raise exception 'LEARNER_ACCOUNT_SETTINGS_VERSION_CONFLICT';
    end if;

    update public.learner_account_settings settings
    set current_status_code = submitted_current_status_code,
        learning_goal_codes = goal_values,
        interest_codes = interest_values,
        version = settings.version + 1,
        updated_at = clock_timestamp()
    where settings.person_id = target_person
    returning settings.* into settings_row;
  else
    if expected_version <> 0 then
      raise exception 'LEARNER_ACCOUNT_SETTINGS_VERSION_CONFLICT';
    end if;

    insert into public.learner_account_settings (
      person_id,
      current_status_code,
      learning_goal_codes,
      interest_codes
    ) values (
      target_person,
      submitted_current_status_code,
      goal_values,
      interest_values
    )
    returning * into settings_row;
  end if;

  delete from public.learner_professional_roles role
  where role.person_id = target_person;

  insert into public.learner_professional_roles (
    person_id,
    position,
    category_code,
    title_code
  )
  select
    target_person,
    (entry.ordinality - 1)::smallint,
    entry.value ->> 'category',
    entry.value ->> 'title'
  from jsonb_array_elements(roles_value)
    with ordinality entry(value, ordinality);

  if replace_encrypted_profile then
    if submitted_encrypted_profile is null then
      delete from private.learner_account_pii pii
      where pii.person_id = target_person;
    else
      insert into private.learner_account_pii (
        person_id,
        encrypted_profile
      ) values (
        target_person,
        submitted_encrypted_profile
      )
      on conflict (person_id) do update
      set encrypted_profile = excluded.encrypted_profile,
          updated_at = clock_timestamp();
    end if;
  end if;

  perform internal.append_audit_event(
    target_person,
    'learner_account_settings.updated',
    'learner_account_settings',
    target_person::text,
    'learner updated private account recommendation settings',
    null,
    jsonb_build_object(
      'version', settings_row.version,
      'professionalRoleCount', role_count,
      'learningGoalCount', cardinality(goal_values),
      'interestCount', cardinality(interest_values),
      'sensitiveProfileChanged', replace_encrypted_profile
    )
  );

  return jsonb_build_object(
    'version', settings_row.version,
    'updatedAt', settings_row.updated_at
  );
end
$$;

revoke all on function internal.upsert_learner_account_settings_for_person(
  uuid, text, jsonb, text[], text[], jsonb, boolean, bigint
) from public, anon, authenticated, service_role;

create or replace function public.upsert_learner_account_settings_for_person(
  p_person_id uuid,
  p_current_status_code text,
  p_professional_roles jsonb,
  p_learning_goal_codes text[],
  p_interest_codes text[],
  p_encrypted_profile jsonb,
  p_replace_encrypted_profile boolean,
  p_expected_version bigint
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, internal
as $$
  select internal.upsert_learner_account_settings_for_person(
    p_person_id,
    p_current_status_code,
    p_professional_roles,
    p_learning_goal_codes,
    p_interest_codes,
    p_encrypted_profile,
    p_replace_encrypted_profile,
    p_expected_version
  )
$$;

revoke all on function public.upsert_learner_account_settings_for_person(
  uuid, text, jsonb, text[], text[], jsonb, boolean, bigint
) from public, anon, authenticated, service_role;

grant execute on function public.upsert_learner_account_settings_for_person(
  uuid, text, jsonb, text[], text[], jsonb, boolean, bigint
) to service_role;

grant execute on function internal.upsert_learner_account_settings_for_person(
  uuid, text, jsonb, text[], text[], jsonb, boolean, bigint
) to service_role;
