-- Learner account settings are private recommendation preferences, not
-- accreditation evidence and not a public professional profile. Browser roles
-- can read only their own safe projection; every write is validated and
-- committed through one actor-derived RPC.

create or replace function internal.text_array_is_unique(input_values text[])
returns boolean
language sql
immutable
strict
security invoker
set search_path = pg_catalog
as $$
  select cardinality(input_values) = (
    select count(distinct value)
    from unnest(input_values) value
  )
$$;

revoke all on function internal.text_array_is_unique(text[])
  from public, anon, authenticated, service_role;

create table public.learner_account_settings (
  person_id uuid primary key
    references public.people(id) on delete cascade,
  current_status_code text not null default 'undisclosed'
    check (current_status_code in (
      'care_professional',
      'organization_manager',
      'medical_professional',
      'student',
      'family_caregiver',
      'other',
      'undisclosed'
    )),
  learning_goal_codes text[] not null default '{}'::text[]
    check (
      cardinality(learning_goal_codes) <= 3
      and array_position(learning_goal_codes, null) is null
      and learning_goal_codes <@ array[
        'earn_credits',
        'care_skills',
        'new_staff_training',
        'career_growth',
        'regulation_updates',
        'organization_management',
        'personal_growth'
      ]::text[]
      and internal.text_array_is_unique(learning_goal_codes)
    ),
  interest_codes text[] not null default '{}'::text[]
    check (
      cardinality(interest_codes) <= 8
      and array_position(interest_codes, null) is null
      and interest_codes <@ array[
        'career_entry',
        'daily_care',
        'special_needs',
        'reablement',
        'quality_safety',
        'supervision_management',
        'ethics_rights',
        'policy_law'
      ]::text[]
      and internal.text_array_is_unique(interest_codes)
    ),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.learner_professional_roles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null
    references public.learner_account_settings(person_id) on delete cascade,
  position smallint not null check (position between 0 and 4),
  category_code text not null,
  title_code text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (person_id, position),
  unique (person_id, category_code, title_code),
  check (
    (
      category_code = 'long_term_care'
      and title_code in (
        'care_worker',
        'home_service_supervisor',
        'care_manager',
        'case_manager',
        'institution_manager'
      )
    )
    or (
      category_code = 'medical_health'
      and title_code in (
        'nurse',
        'physician',
        'physical_therapist',
        'occupational_therapist',
        'dietitian',
        'pharmacist'
      )
    )
    or (
      category_code = 'social_work'
      and title_code in (
        'social_worker',
        'community_coordinator'
      )
    )
    or (
      category_code = 'operations'
      and title_code in (
        'administrator',
        'training_coordinator',
        'quality_manager'
      )
    )
    or (
      category_code = 'student_other'
      and title_code in (
        'student',
        'family_caregiver',
        'other'
      )
    )
  )
);

create index learner_professional_roles_person_order_idx
  on public.learner_professional_roles(person_id, position, id);

create table private.learner_account_pii (
  person_id uuid primary key
    references public.people(id) on delete cascade,
  encrypted_profile jsonb not null
    check (jsonb_typeof(encrypted_profile) = 'object'),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.learner_account_settings enable row level security;
alter table public.learner_account_settings force row level security;
alter table public.learner_professional_roles enable row level security;
alter table public.learner_professional_roles force row level security;
alter table private.learner_account_pii enable row level security;
alter table private.learner_account_pii force row level security;

revoke all on table public.learner_account_settings
  from public, anon, authenticated, service_role;
revoke all on table public.learner_professional_roles
  from public, anon, authenticated, service_role;
revoke all on table private.learner_account_pii
  from public, anon, authenticated, service_role;

grant select on table public.learner_account_settings to authenticated;
grant select on table public.learner_professional_roles to authenticated;
grant select on table public.learner_account_settings to service_role;
grant select on table public.learner_professional_roles to service_role;

create policy learner_account_settings_owner_read
on public.learner_account_settings
for select
to authenticated
using (person_id = (select internal.request_person_id()));

create policy learner_professional_roles_owner_read
on public.learner_professional_roles
for select
to authenticated
using (person_id = (select internal.request_person_id()));

create or replace function internal.read_own_learner_account_settings()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  person_row public.people%rowtype;
  settings_row public.learner_account_settings%rowtype;
  role_rows jsonb := '[]'::jsonb;
begin
  select person.* into strict person_row
  from public.people person
  where person.id = actor
    and person.anonymized_at is null;

  select settings.* into settings_row
  from public.learner_account_settings settings
  where settings.person_id = actor;

  if found then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', role.id,
          'category', role.category_code,
          'title', role.title_code
        )
        order by role.position, role.id
      ),
      '[]'::jsonb
    )
    into role_rows
    from public.learner_professional_roles role
    where role.person_id = actor;
  end if;

  return jsonb_build_object(
    'personId', actor,
    'verifiedEmail', person_row.verified_email,
    'emailVerifiedAt', person_row.email_verified_at,
    'currentStatus', coalesce(
      settings_row.current_status_code,
      'undisclosed'
    ),
    'professionalRoles', role_rows,
    'learningGoals', coalesce(
      to_jsonb(settings_row.learning_goal_codes),
      '[]'::jsonb
    ),
    'interests', coalesce(
      to_jsonb(settings_row.interest_codes),
      '[]'::jsonb
    ),
    'version', coalesce(settings_row.version, 0),
    'updatedAt', settings_row.updated_at
  );
exception
  when no_data_found then
    raise exception 'ACTIVE_UNRESTRICTED_IDENTITY_REQUIRED';
end
$$;

revoke all on function internal.read_own_learner_account_settings()
  from public, anon, authenticated, service_role;

create or replace function public.read_own_learner_account_settings()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_own_learner_account_settings()
$$;

revoke all on function public.read_own_learner_account_settings()
  from public, anon, authenticated, service_role;

grant execute on function internal.read_own_learner_account_settings()
  to authenticated;
grant execute on function public.read_own_learner_account_settings()
  to authenticated;

create or replace function internal.read_learner_account_pii(
  target_person uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, private
as $$
declare
  encrypted_value jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     or target_person is null
  then
    raise exception 'LEARNER_ACCOUNT_PII_SERVICE_REQUIRED';
  end if;

  select pii.encrypted_profile into encrypted_value
  from private.learner_account_pii pii
  join public.people person
    on person.id = pii.person_id
  where pii.person_id = target_person
    and person.anonymized_at is null;

  return jsonb_build_object('encryptedProfile', encrypted_value);
end
$$;

revoke all on function internal.read_learner_account_pii(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.read_learner_account_pii(
  p_person_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, internal
as $$
  select internal.read_learner_account_pii(p_person_id)
$$;

revoke all on function public.read_learner_account_pii(uuid)
  from public, anon, authenticated, service_role;

grant execute on function internal.read_learner_account_pii(uuid)
  to service_role;
grant execute on function public.read_learner_account_pii(uuid)
  to service_role;

create or replace function internal.upsert_own_learner_account_settings(
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
  actor uuid := internal.current_person_id();
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
       and jsonb_typeof(submitted_encrypted_profile) <> 'object'
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
  where settings.person_id = actor
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
    where settings.person_id = actor
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
      actor,
      submitted_current_status_code,
      goal_values,
      interest_values
    )
    returning * into settings_row;
  end if;

  delete from public.learner_professional_roles role
  where role.person_id = actor;

  insert into public.learner_professional_roles (
    person_id,
    position,
    category_code,
    title_code
  )
  select
    actor,
    (entry.ordinality - 1)::smallint,
    entry.value ->> 'category',
    entry.value ->> 'title'
  from jsonb_array_elements(roles_value)
    with ordinality entry(value, ordinality);

  if replace_encrypted_profile then
    if submitted_encrypted_profile is null then
      delete from private.learner_account_pii pii
      where pii.person_id = actor;
    else
      insert into private.learner_account_pii (
        person_id,
        encrypted_profile
      ) values (
        actor,
        submitted_encrypted_profile
      )
      on conflict (person_id) do update
      set encrypted_profile = excluded.encrypted_profile,
          updated_at = clock_timestamp();
    end if;
  end if;

  perform internal.append_audit_event(
    actor,
    'learner_account_settings.updated',
    'learner_account_settings',
    actor::text,
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

revoke all on function internal.upsert_own_learner_account_settings(
  text, jsonb, text[], text[], jsonb, boolean, bigint
) from public, anon, authenticated, service_role;

create or replace function public.upsert_own_learner_account_settings(
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
set search_path = pg_catalog, public, internal
as $$
  select internal.upsert_own_learner_account_settings(
    p_current_status_code,
    p_professional_roles,
    p_learning_goal_codes,
    p_interest_codes,
    p_encrypted_profile,
    p_replace_encrypted_profile,
    p_expected_version
  )
$$;

revoke all on function public.upsert_own_learner_account_settings(
  text, jsonb, text[], text[], jsonb, boolean, bigint
) from public, anon, authenticated, service_role;

grant execute on function internal.upsert_own_learner_account_settings(
  text, jsonb, text[], text[], jsonb, boolean, bigint
) to authenticated;
grant execute on function public.upsert_own_learner_account_settings(
  text, jsonb, text[], text[], jsonb, boolean, bigint
) to authenticated;

create or replace function internal.purge_anonymized_learner_account_settings()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  delete from private.learner_account_pii pii
  where pii.person_id = new.id;

  delete from public.learner_account_settings settings
  where settings.person_id = new.id;

  return new;
end
$$;

revoke all on function internal.purge_anonymized_learner_account_settings()
  from public, anon, authenticated, service_role;

create trigger purge_anonymized_learner_account_settings
after update of anonymized_at on public.people
for each row
when (
  old.anonymized_at is null
  and new.anonymized_at is not null
)
execute function internal.purge_anonymized_learner_account_settings();
