-- GoTrue writes the built-in email provider marker after the auth.users
-- insert on some hosted versions. Protected app_metadata is already writable
-- only by an Auth Admin/service-role caller, so exact email + protected flags
-- remain the fail-closed admission boundary.
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
  protected_staff_identity boolean :=
    lower(trim(coalesce(user_record ->> 'email', ''))) =
      'edu.control@suiyuecare.com'
    and coalesce(app_metadata ->> 'account_type', '') = 'staff'
    and coalesce(app_metadata ->> 'staff_login', '') = 'true'
    and coalesce(app_metadata ->> 'staff_role', '') = 'course_admin'
    and coalesce(app_metadata ->> 'must_change_password', '') = 'true';
begin
  if internal.setting_is_true('maintenance_mode') then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 503,
        'message', 'Registration is temporarily unavailable.'
      )
    );
  end if;
  if not phone_identity and not protected_staff_identity then
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
  protected_staff_identity boolean :=
    new.email is not null
    and lower(trim(new.email)) = 'edu.control@suiyuecare.com'
    and coalesce(new.raw_app_meta_data ->> 'account_type', '') = 'staff'
    and coalesce(new.raw_app_meta_data ->> 'staff_login', '') = 'true'
    and coalesce(new.raw_app_meta_data ->> 'staff_role', '') = 'course_admin'
    and coalesce(
      new.raw_app_meta_data ->> 'must_change_password', ''
    ) = 'true';
  display_label text;
begin
  if new.phone is null and not protected_staff_identity then
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
      when protected_staff_identity then coalesce(display_label, '教學品管')
      else null
    end,
    case when protected_staff_identity then lower(new.email) else null end,
    case
      when protected_staff_identity then coalesce(new.email_confirmed_at, now())
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
