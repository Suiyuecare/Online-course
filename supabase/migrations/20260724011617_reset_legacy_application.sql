-- This migration intentionally drops only the inventoried legacy learning app.
-- Supabase system schemas are read for a zero-data assertion, but are never
-- modified. Storage buckets must be removed through the Storage API first.
-- MAINTENANCE_WRITE_FENCE is an external, human-verified precondition: Auth
-- signup, legacy Cron/webhooks and legacy service credentials must already be
-- disabled before the guarded reset settings below are supplied.
do $reset$
declare
  object_record record;
  object_name text;
  drop_statement text;
  protected_count bigint;
  project_ref text := current_setting('app.suiyue_project_ref', true);
  fingerprint text := current_setting('app.suiyue_legacy_fingerprint', true);
  legacy_present boolean;
  legacy_relation_count integer;
  legacy_routine_count integer;
  legacy_trigger_count integer;
  legacy_type_count integer;
  legacy_tables constant text[] := array[
    'public.accreditation_exports',
    'public.accreditation_registrations',
    'public.audit_events',
    'public.certificates',
    'public.course_assignments',
    'public.course_modules',
    'public.course_price_tiers',
    'public.courses',
    'public.enrollments',
    'public.enterprise_email_deliveries',
    'public.enterprise_seat_allocations',
    'public.enterprise_seat_events',
    'public.enterprise_seat_lots',
    'public.entitlements',
    'public.invoice_records',
    'public.learning_events',
    'public.lesson_progress',
    'public.lessons',
    'public.live_attendance_adjustments',
    'public.live_attendance_events',
    'public.live_attendance_summaries',
    'public.live_email_deliveries',
    'public.live_session_bookings',
    'public.live_sessions',
    'public.order_items',
    'public.orders',
    'public.organization_invitations',
    'public.organization_members',
    'public.organizations',
    'public.payment_events',
    'public.platform_settings',
    'public.playback_segments',
    'public.playback_sessions',
    'public.presence_challenges',
    'public.profiles',
    'public.quiz_attempts',
    'public.quiz_options',
    'public.quiz_questions',
    'public.refunds',
    'public.satisfaction_responses',
    'public.subscriptions',
    'public.video_assets',
    'public.zoom_webhook_events',
    'private.learner_accreditation_profiles',
    'private.learner_identifiers',
    'private.live_session_zoom_credentials'
  ];
  legacy_function_names constant text[] := array[
    'accept_organization_invitation',
    'apply_ecpay_paid_order',
    'apply_enterprise_refund',
    'apply_enterprise_seat_event_balance',
    'apply_verified_enterprise_allowance_callback',
    'assign_enterprise_seat',
    'claim_enterprise_allowance',
    'complete_enterprise_allowance',
    'consume_enterprise_seat',
    'correct_enterprise_seat_lot',
    'create_enterprise_checkout_order',
    'credit_lesson_progress',
    'decide_enterprise_refund',
    'duplicate_course_as_draft',
    'expire_enterprise_allowance_claims',
    'expire_enterprise_seats',
    'expire_enterprise_seat_lots',
    'fail_enterprise_allowance',
    'get_accreditation_profile',
    'get_live_zoom_credentials',
    'guard_enterprise_playback_seconds_update',
    'handle_new_user',
    'initialize_invoice_allowance_totals',
    'is_active_org_manager',
    'is_org_admin',
    'is_org_manager',
    'is_org_owner',
    'is_platform_admin',
    'is_platform_staff',
    'populate_enterprise_order_item_snapshot',
    'prevent_append_only_mutation',
    'prevent_lesson_history_delete',
    'reconcile_enterprise_allowance',
    'release_enterprise_seat',
    'request_enterprise_refund',
    'reserve_live_seat',
    'select_enterprise_live_session',
    'set_updated_at',
    'shares_organization',
    'store_accreditation_profile',
    'store_live_zoom_credentials',
    'submit_organization_application',
    'transfer_live_booking',
    'update_playback_segment_active_seconds',
    'validate_accredited_course_publication',
    'validate_accredited_recorded_course_publication',
    'validate_enterprise_live_check_in',
    'validate_enterprise_live_session_reschedule',
    'validate_enterprise_playback_start',
    'validate_recorded_course_publication'
  ];
  legacy_trigger_names constant text[] := array[
    'auth.users.on_auth_user_created',
    'public.accreditation_registrations.accreditation_registrations_updated_at',
    'public.audit_events.audit_events_append_only',
    'public.course_price_tiers.course_price_tiers_updated_at',
    'public.courses.courses_updated_at',
    'public.courses.validate_accredited_course_publication',
    'public.courses.validate_accredited_recorded_course_publication',
    'public.courses.validate_recorded_course_publication',
    'public.enrollments.enrollments_updated_at',
    'public.enterprise_seat_allocations.enterprise_seat_allocations_updated_at',
    'public.enterprise_seat_events.enterprise_seat_events_append_only',
    'public.enterprise_seat_events.enterprise_seat_events_apply_balance',
    'public.enterprise_seat_lots.enterprise_seat_lots_updated_at',
    'public.invoice_records.initialize_invoice_allowance_totals',
    'public.invoice_records.invoice_records_updated_at',
    'public.lessons.prevent_lesson_history_delete',
    'public.live_attendance_adjustments.live_attendance_adjustments_append_only',
    'public.live_attendance_events.live_attendance_events_append_only',
    'public.live_attendance_events.validate_enterprise_live_check_in',
    'public.live_session_bookings.live_session_bookings_updated_at',
    'public.live_sessions.live_sessions_updated_at',
    'public.live_sessions.validate_enterprise_live_session_reschedule',
    'public.order_items.populate_enterprise_order_item_snapshot',
    'public.orders.orders_updated_at',
    'public.organization_invitations.organization_invitations_updated_at',
    'public.organizations.organizations_updated_at',
    'public.payment_events.payment_events_append_only',
    'public.playback_segments.guard_enterprise_playback_seconds_update',
    'public.playback_sessions.validate_enterprise_playback_start',
    'public.profiles.profiles_updated_at',
    'public.video_assets.video_assets_updated_at',
    'public.zoom_webhook_events.zoom_webhook_events_append_only'
  ];
  legacy_sequence_names constant text[] := array[
    'public.audit_events_id_seq',
    'public.enterprise_seat_events_id_seq',
    'public.learning_events_id_seq',
    'public.live_attendance_events_id_seq',
    'public.payment_events_id_seq',
    'public.zoom_webhook_events_id_seq'
  ];
  legacy_enum_names constant text[] := array[
    'course_delivery',
    'course_status',
    'enrollment_status',
    'member_role',
    'order_status',
    'video_asset_status'
  ];
begin
  select exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'private')
      and relation.relkind in ('r', 'p', 'f', 'v', 'm', 'S')
    union all
    select 1
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname in ('public', 'private')
    union all
    select 1
    from pg_type legacy_type
    join pg_namespace namespace on namespace.oid = legacy_type.typnamespace
    where namespace.nspname in ('public', 'private')
      and legacy_type.typtype in ('e', 'd')
    union all
    select 1
    from pg_trigger legacy_trigger
    join pg_class target_relation
      on target_relation.oid = legacy_trigger.tgrelid
    join pg_namespace target_namespace
      on target_namespace.oid = target_relation.relnamespace
    join pg_proc trigger_routine
      on trigger_routine.oid = legacy_trigger.tgfoid
    join pg_namespace routine_namespace
      on routine_namespace.oid = trigger_routine.pronamespace
    where not legacy_trigger.tgisinternal
      and (
        target_namespace.nspname in ('public', 'private')
        or routine_namespace.nspname in ('public', 'private')
      )
  ) into legacy_present;
  if not legacy_present then
    return;
  end if;

  -- A mixed or partially installed baseline must be investigated manually.
  if to_regclass('public.people') is not null then
    raise exception 'RESET_ABORTED_MIXED_APPLICATION_BASELINES';
  end if;

  if project_ref is distinct from 'eswdhynrbzrjgetnmhit' then
    raise exception 'RESET_ABORTED_PROJECT_REF_MISMATCH';
  end if;
  if fingerprint is distinct from
    '9520c33bac3a0b4f719344ddba5ae25e98067dcdd5c7115da67570736d7eefbc'
  then
    raise exception 'RESET_ABORTED_LEGACY_FINGERPRINT_MISMATCH';
  end if;

  -- Auth evidence is a hard stop. A phone identity without a business row is
  -- still real user data and must never be erased by the clean-rebuild grant.
  foreach object_name in array array[
    'auth.users',
    'auth.sessions',
    'auth.refresh_tokens',
    'auth.identities'
  ]
  loop
    if to_regclass(object_name) is not null then
      execute format('select count(*) from %s', object_name)
        into protected_count;
      if protected_count <> 0 then
        raise exception 'RESET_ABORTED_PROTECTED_DATA:%=%',
          object_name, protected_count;
      end if;
    end if;
  end loop;

  if to_regclass('storage.objects') is not null then
    select count(*) into protected_count from storage.objects;
    if protected_count <> 0 then
      raise exception 'RESET_ABORTED_PROTECTED_DATA:storage.objects=%',
        protected_count;
    end if;
  end if;
  if to_regclass('storage.buckets') is not null then
    select count(*) into protected_count from storage.buckets;
    if protected_count <> 0 then
      raise exception
        'RESET_ABORTED_STORAGE_BUCKETS_REQUIRE_API_REMOVAL:%',
        protected_count;
    end if;
  end if;

  -- Every inventoried table is protected, not only orders/enrollments. This
  -- catches draft courses, quiz content and platform settings as real data.
  foreach object_name in array legacy_tables
  loop
    if to_regclass(object_name) is not null then
      execute format('select count(*) from %s', object_name)
        into protected_count;
      if protected_count <> 0 then
        raise exception 'RESET_ABORTED_PROTECTED_DATA:%=%',
          object_name, protected_count;
      end if;
    end if;
  end loop;

  select count(*) into legacy_relation_count
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname in ('public', 'private')
    and relation.relkind in ('r', 'p', 'f', 'v', 'm', 'S');
  select count(*) into legacy_routine_count
  from pg_proc routine
  join pg_namespace namespace on namespace.oid = routine.pronamespace
  where namespace.nspname in ('public', 'private')
    and routine.prokind in ('f', 'p');
  select count(*) into legacy_type_count
  from pg_type legacy_type
  join pg_namespace namespace on namespace.oid = legacy_type.typnamespace
  where namespace.nspname in ('public', 'private')
    and legacy_type.typtype in ('e', 'd');
  select count(*) into legacy_trigger_count
  from pg_trigger legacy_trigger
  join pg_class target_relation
    on target_relation.oid = legacy_trigger.tgrelid
  join pg_namespace target_namespace
    on target_namespace.oid = target_relation.relnamespace
  join pg_proc trigger_routine
    on trigger_routine.oid = legacy_trigger.tgfoid
  join pg_namespace routine_namespace
    on routine_namespace.oid = trigger_routine.pronamespace
  where not legacy_trigger.tgisinternal
    and (
      target_namespace.nspname in ('public', 'private')
      or routine_namespace.nspname in ('public', 'private')
    );
  if legacy_relation_count <> (
       cardinality(legacy_tables) + cardinality(legacy_sequence_names)
     )
     or legacy_routine_count <> 50
     or legacy_type_count <> cardinality(legacy_enum_names)
     or legacy_trigger_count <> cardinality(legacy_trigger_names)
  then
    raise exception
      'RESET_ABORTED_LEGACY_OBJECT_COUNT_CHANGED:relations=% routines=% types=% triggers=%',
      legacy_relation_count, legacy_routine_count,
      legacy_type_count, legacy_trigger_count;
  end if;

  -- Do not silently CASCADE through an object that was not in the signed
  -- legacy inventory. Owned identity sequences are allowed and disappear with
  -- their table; standalone relations, views and routines are not.
  if exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'private')
      and relation.relkind in ('r', 'p', 'f')
      and format('%I.%I', namespace.nspname, relation.relname)
        <> all(legacy_tables)
  ) then
    raise exception 'RESET_ABORTED_UNKNOWN_APPLICATION_TABLE';
  end if;
  if exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'private')
      and relation.relkind in ('v', 'm')
  ) then
    raise exception 'RESET_ABORTED_UNKNOWN_APPLICATION_VIEW';
  end if;
  if exists (
    select 1
    from pg_trigger legacy_trigger
    join pg_class target_relation
      on target_relation.oid = legacy_trigger.tgrelid
    join pg_namespace target_namespace
      on target_namespace.oid = target_relation.relnamespace
    join pg_proc trigger_routine
      on trigger_routine.oid = legacy_trigger.tgfoid
    join pg_namespace routine_namespace
      on routine_namespace.oid = trigger_routine.pronamespace
    where not legacy_trigger.tgisinternal
      and (
        target_namespace.nspname in ('public', 'private')
        or routine_namespace.nspname in ('public', 'private')
      )
      and format(
        '%I.%I.%I',
        target_namespace.nspname,
        target_relation.relname,
        legacy_trigger.tgname
      ) <> all(legacy_trigger_names)
  ) then
    raise exception 'RESET_ABORTED_UNKNOWN_APPLICATION_TRIGGER';
  end if;
  if exists (
    select 1
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname in ('public', 'private')
      and routine.prokind in ('f', 'p')
      and routine.proname <> all(legacy_function_names)
  ) then
    raise exception 'RESET_ABORTED_UNKNOWN_APPLICATION_ROUTINE';
  end if;
  if exists (
    select 1
    from pg_type legacy_type
    join pg_namespace namespace on namespace.oid = legacy_type.typnamespace
    where namespace.nspname in ('public', 'private')
      and legacy_type.typtype in ('e', 'd')
      and legacy_type.typname <> all(legacy_enum_names)
  ) then
    raise exception 'RESET_ABORTED_UNKNOWN_APPLICATION_TYPE';
  end if;
  if exists (
    select 1
    from pg_class sequence
    join pg_namespace namespace on namespace.oid = sequence.relnamespace
    where namespace.nspname in ('public', 'private')
      and sequence.relkind = 'S'
      and format('%I.%I', namespace.nspname, sequence.relname)
        <> all(legacy_sequence_names)
  ) then
    raise exception 'RESET_ABORTED_UNKNOWN_APPLICATION_SEQUENCE';
  end if;

  -- The only legacy trigger outside the disposable schemas must be removed
  -- first; otherwise private.handle_new_user cannot be dropped safely.
  execute 'drop trigger if exists on_auth_user_created on auth.users';

  -- Drop every inventoried application trigger explicitly before its table.
  -- This keeps function dependency failures meaningful and prevents CASCADE.
  for object_record in
    select target_namespace.nspname as schema_name,
      target_relation.relname as table_name,
      legacy_trigger.tgname as trigger_name
    from pg_trigger legacy_trigger
    join pg_class target_relation
      on target_relation.oid = legacy_trigger.tgrelid
    join pg_namespace target_namespace
      on target_namespace.oid = target_relation.relnamespace
    where not legacy_trigger.tgisinternal
      and target_namespace.nspname in ('public', 'private')
      and format(
        '%I.%I.%I',
        target_namespace.nspname,
        target_relation.relname,
        legacy_trigger.tgname
      ) = any(legacy_trigger_names)
  loop
    execute format(
      'drop trigger if exists %I on %I.%I',
      object_record.trigger_name,
      object_record.schema_name,
      object_record.table_name
    );
  end loop;

  select 'drop table ' || string_agg(candidate, ', ' order by candidate)
    into drop_statement
  from unnest(legacy_tables) candidate
  where to_regclass(candidate) is not null;
  if drop_statement is not null then
    execute drop_statement;
  end if;

  for object_record in
    select namespace.nspname as schema_name,
      routine.proname as object_name,
      pg_get_function_identity_arguments(routine.oid) as identity_arguments,
      routine.prokind
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname in ('public', 'private')
      and routine.proname = any(legacy_function_names)
    order by namespace.nspname, routine.proname,
      pg_get_function_identity_arguments(routine.oid)
  loop
    execute format(
      'drop %s if exists %I.%I(%s)',
      case when object_record.prokind = 'p' then 'procedure' else 'function' end,
      object_record.schema_name,
      object_record.object_name,
      object_record.identity_arguments
    );
  end loop;

  foreach object_name in array legacy_sequence_names
  loop
    execute format('drop sequence if exists %s', object_name);
  end loop;

  for object_record in
    select namespace.nspname as schema_name, legacy_type.typname as type_name
    from pg_type legacy_type
    join pg_namespace namespace on namespace.oid = legacy_type.typnamespace
    where namespace.nspname in ('public', 'private')
      and legacy_type.typtype = 'e'
      and legacy_type.typname = any(legacy_enum_names)
  loop
    execute format(
      'drop type if exists %I.%I',
      object_record.schema_name, object_record.type_name
    );
  end loop;

  if to_regnamespace('private') is not null then
    if exists (
      select 1 from pg_class
      where relnamespace = to_regnamespace('private')
    ) or exists (
      select 1 from pg_proc
      where pronamespace = to_regnamespace('private')
    ) then
      raise exception 'RESET_ABORTED_PRIVATE_SCHEMA_NOT_EMPTY';
    end if;
    execute 'drop schema private';
  end if;
end
$reset$;
