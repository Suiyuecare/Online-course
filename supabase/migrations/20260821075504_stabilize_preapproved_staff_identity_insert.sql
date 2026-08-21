-- Hosted GoTrue applies Auth Admin app_metadata after auth.users is inserted.
-- The insert gate therefore admits only the one pre-approved corporate email;
-- it does not grant any staff authority. Authority is granted separately by
-- the service-role-only provisioning RPC after email confirmation and all
-- protected app_metadata claims are present.
create or replace function internal.before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  user_record jsonb := event -> 'user';
  app_metadata jsonb := coalesce(user_record -> 'app_metadata', '{}'::jsonb);
  phone_identity boolean :=
    coalesce(user_record ->> 'phone', '') <> ''
    and coalesce(app_metadata ->> 'provider', '') = 'phone';
  preapproved_staff_email boolean :=
    lower(trim(coalesce(user_record ->> 'email', ''))) =
      'edu.control@suiyuecare.com';
begin
  if internal.setting_is_true('maintenance_mode') then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 503,
        'message', 'Registration is temporarily unavailable.'
      )
    );
  end if;
  if not phone_identity and not preapproved_staff_email then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Phone authentication or a pre-approved staff account is required.'
      )
    );
  end if;
  return '{}'::jsonb;
end
$$;

revoke all on function internal.before_user_created(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function internal.before_user_created(jsonb)
  to supabase_auth_admin;

create or replace function internal.handle_new_phone_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_person_id uuid;
  preapproved_staff_email boolean :=
    new.email is not null
    and lower(trim(new.email)) = 'edu.control@suiyuecare.com';
  display_label text;
begin
  if new.phone is null and not preapproved_staff_email then
    raise exception 'PHONE_OR_PREAPPROVED_STAFF_AUTH_REQUIRED';
  end if;
  display_label := nullif(trim(coalesce(
    new.raw_user_meta_data ->> 'display_name',
    ''
  )), '');
  insert into public.people (
    display_name,
    verified_email,
    email_verified_at
  ) values (
    case
      when preapproved_staff_email then coalesce(display_label, '教學品管')
      else null
    end,
    case
      when preapproved_staff_email and new.email_confirmed_at is not null
        then lower(new.email)
      else null
    end,
    case
      when preapproved_staff_email then new.email_confirmed_at
      else null
    end
  ) returning id into new_person_id;
  insert into public.auth_identities (
    person_id, auth_user_id, restricted, restriction_reason
  ) values (
    new_person_id, new.id, false, null
  );
  return new;
end
$$;

revoke all on function internal.handle_new_phone_identity()
  from public, anon, authenticated, service_role;

create or replace function internal.provision_education_quality_staff(
  target_auth_user uuid,
  expected_email text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_person uuid;
  normalized_email text := lower(trim(coalesce(expected_email, '')));
begin
  if target_auth_user is null
     or normalized_email <> 'edu.control@suiyuecare.com'
     or expected_email <> normalized_email
  then
    raise exception 'STAFF_PROVISIONING_REJECTED';
  end if;
  select identity.person_id into target_person
  from auth.users account
  join public.auth_identities identity
    on identity.auth_user_id = account.id
   and identity.active
   and not identity.restricted
  where account.id = target_auth_user
    and lower(trim(account.email)) = normalized_email
    and account.email_confirmed_at is not null
    and account.raw_app_meta_data ->> 'account_type' = 'staff'
    and account.raw_app_meta_data ->> 'staff_login' = 'true'
    and account.raw_app_meta_data ->> 'staff_role' = 'course_admin'
    and account.raw_app_meta_data ->> 'must_change_password' = 'true';
  if target_person is null then
    raise exception 'PREAPPROVED_STAFF_IDENTITY_REQUIRED';
  end if;
  update public.people
  set
    display_name = coalesce(
      nullif(trim(display_name), ''),
      '教學品管部'
    ),
    verified_email = normalized_email,
    email_verified_at = coalesce(email_verified_at, now())
  where id = target_person;
  insert into public.staff_roles (
    person_id, role, active, revoked_at
  ) values (
    target_person, 'course_admin', true, null
  ) on conflict (person_id, role) do update
    set active = true, revoked_at = null;
  perform internal.append_audit_event(
    null,
    'staff.education_quality_provisioned',
    'person',
    target_person::text,
    'authorized teaching-quality staff account provisioning',
    null,
    jsonb_build_object(
      'role', 'course_admin',
      'emailDomain', 'suiyuecare.com',
      'serviceProvisioned', true
    )
  );
  return jsonb_build_object(
    'personId', target_person,
    'role', 'course_admin',
    'active', true
  );
end
$$;

revoke all on function internal.provision_education_quality_staff(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function internal.provision_education_quality_staff(uuid, text)
  to service_role;
