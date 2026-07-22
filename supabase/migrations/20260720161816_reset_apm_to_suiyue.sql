-- Re-purpose the empty Online course project for Suiyue Academy.
--
-- This migration intentionally refuses to run if the remote APM inventory has
-- changed, if any APM row exists, or if Auth / Storage has started receiving
-- real data. It is also a no-op on a fresh database so local resets remain safe.

set search_path = pg_catalog, public, extensions;

do $$
declare
  object_count bigint;
  object_hash text;
  object_record record;
  has_rows boolean;
begin
  if exists (select 1 from auth.users) then
    raise exception 'RESET_ABORTED: auth.users is no longer empty';
  end if;

  if exists (select 1 from auth.sessions) then
    raise exception 'RESET_ABORTED: auth.sessions is no longer empty';
  end if;

  if exists (select 1 from storage.objects) then
    raise exception 'RESET_ABORTED: storage.objects is no longer empty';
  end if;

  if exists (select 1 from storage.buckets) then
    raise exception
      'RESET_ABORTED: delete the empty apm-evidence bucket through the Storage API first';
  end if;

  select count(*), md5(string_agg(identity, E'\n' order by identity))
  into object_count, object_hash
  from (
    select n.nspname || '.' || c.relname as identity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'apm_private')
      and c.relkind in ('r', 'p', 'f')
  ) inventory;

  if object_count = 0
     and not exists (select 1 from pg_namespace where nspname = 'apm_private')
     and not exists (
       select 1
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind in ('r', 'p', 'f', 'v', 'm', 'S')
     )
     and not exists (
       select 1
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
     )
     and not exists (
       select 1
       from pg_type t
       join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public' and t.typtype in ('e', 'd')
     )
  then
    return;
  end if;

  if object_count <> 40
     or object_hash <> 'ad3d4b26ce248155d2c24fac5978b22d'
  then
    raise exception
      'RESET_ABORTED: APM table inventory changed (count %, hash %)',
      object_count,
      object_hash;
  end if;

  select count(*), md5(string_agg(identity, E'\n' order by identity))
  into object_count, object_hash
  from (
    select n.nspname || '.' || c.relname as identity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'apm_private')
      and c.relkind = 'v'
  ) inventory;

  if object_count <> 5
     or object_hash <> '9d531954f569eba48f3063b78dfe46a7'
  then
    raise exception
      'RESET_ABORTED: APM view inventory changed (count %, hash %)',
      object_count,
      object_hash;
  end if;

  select count(*), md5(string_agg(identity, E'\n' order by identity))
  into object_count, object_hash
  from (
    select n.nspname || '.' || p.proname || '('
      || pg_get_function_identity_arguments(p.oid) || ')' as identity
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'apm_private')
      and p.prokind = 'f'
  ) inventory;

  if object_count <> 159
     or object_hash <> '0b05242f5788ac664ad73d504bd0404c'
  then
    raise exception
      'RESET_ABORTED: APM function inventory changed (count %, hash %)',
      object_count,
      object_hash;
  end if;

  select count(*), md5(string_agg(identity, E'\n' order by identity))
  into object_count, object_hash
  from (
    select n.nspname || '.' || t.typname as identity
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname in ('public', 'apm_private')
      and t.typtype = 'e'
  ) inventory;

  if object_count <> 23
     or object_hash <> '5922597eb1fed048967d53f66cacde9b'
  then
    raise exception
      'RESET_ABORTED: APM enum inventory changed (count %, hash %)',
      object_count,
      object_hash;
  end if;

  select count(*), md5(string_agg(identity, E'\n' order by identity))
  into object_count, object_hash
  from (
    select n.nspname || '.' || c.relname as identity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'apm_private')
      and c.relkind = 'S'
  ) inventory;

  if object_count <> 2
     or object_hash <> '36b42d3ada95660b06d502abaa36091b'
  then
    raise exception
      'RESET_ABORTED: APM sequence inventory changed (count %, hash %)',
      object_count,
      object_hash;
  end if;

  for object_record in
    select n.nspname as schema_name, c.relname as object_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'apm_private')
      and c.relkind in ('r', 'p', 'f')
    order by n.nspname, c.relname
  loop
    execute format(
      'select exists (select 1 from %I.%I limit 1)',
      object_record.schema_name,
      object_record.object_name
    ) into has_rows;

    if has_rows then
      raise exception
        'RESET_ABORTED: %.% contains data',
        object_record.schema_name,
        object_record.object_name;
    end if;
  end loop;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname in (
        'apm_evidence_insert_registered',
        'apm_evidence_select_authorized'
      )
  ) <> 2 then
    raise exception 'RESET_ABORTED: APM Storage policy inventory changed';
  end if;

  drop policy if exists apm_evidence_insert_registered on storage.objects;
  drop policy if exists apm_evidence_select_authorized on storage.objects;

  for object_record in
    select p.proname as object_name,
      pg_get_function_identity_arguments(p.oid) as identity_arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
    order by p.proname, pg_get_function_identity_arguments(p.oid)
  loop
    execute format(
      'drop function if exists public.%I(%s) cascade',
      object_record.object_name,
      object_record.identity_arguments
    );
  end loop;

  if exists (select 1 from pg_namespace where nspname = 'apm_private') then
    execute 'drop schema apm_private cascade';
  end if;

  drop view if exists
    public.calendar_entries,
    public.department_kpi_progress,
    public.gantt_entries,
    public.my_dashboard_metrics,
    public.project_progress;

  -- Every known FK-related table is included in this one statement. Omitting
  -- CASCADE makes any unexpected dependency outside the inventoried APM system
  -- fail the migration instead of silently deleting another system's object.
  drop table if exists
    public.kpi_award_adjustments,
    public.kpi_awards,
    public.kpi_goal_reviews,
    public.kpi_goal_versions,
    public.kpi_progress_updates,
    public.reminders,
    public.work_item_details,
    public.work_item_links,
    public.kpi_goals,
    public.kpi_plan_private,
    public.kpi_plan_versions,
    public.kpi_policy_goal_templates,
    public.kpi_policy_score_bands,
    public.kpi_reviews,
    public.notification_deliveries,
    public.project_department_approvals,
    public.project_details,
    public.project_members,
    public.work_items,
    public.approval_events,
    public.attachments,
    public.audit_events,
    public.comments,
    public.employee_roles,
    public.kpi_plans,
    public.kpi_policies,
    public.manager_closure,
    public.notifications,
    public.portal_handoff_nonces,
    public.projects,
    public.employees,
    public.finance_metric_snapshots,
    public.positions,
    public.departments,
    public.kpi_cycles,
    public.companies,
    public.integration_outbox,
    public.org_sync_runs;

  drop sequence if exists
    public.approval_events_id_seq,
    public.audit_events_id_seq;

  drop type if exists
    public.app_role,
    public.approval_status,
    public.attachment_purpose,
    public.attachment_status,
    public.attachment_subject_type,
    public.comment_subject_type,
    public.delivery_channel,
    public.delivery_status,
    public.kpi_adjustment_kind,
    public.kpi_award_status,
    public.kpi_bonus_basis,
    public.kpi_cycle_status,
    public.kpi_plan_status,
    public.kpi_policy_status,
    public.kpi_review_status,
    public.notification_kind,
    public.outbox_status,
    public.priority_level,
    public.project_member_role,
    public.project_status,
    public.reminder_status,
    public.work_item_kind,
    public.work_item_status;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'f', 'v', 'm', 'S')
  ) then
    raise exception 'RESET_ABORTED: public schema still contains APM relations';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ) then
    raise exception 'RESET_ABORTED: public schema still contains APM functions';
  end if;

  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype in ('e', 'd')
  ) then
    raise exception 'RESET_ABORTED: public schema still contains APM types';
  end if;
end
$$;

reset search_path;
