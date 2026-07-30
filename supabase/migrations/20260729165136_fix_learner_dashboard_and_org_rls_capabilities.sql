-- Repair the narrow capabilities required by security-invoker learner views
-- and organization RLS predicates. Keep grants column-scoped so browser roles
-- do not gain access to raw attendance evidence or unrelated enrollment data.

revoke all on function internal.has_organization_role(uuid, text[])
  from public, anon, authenticated, service_role;

grant execute on function internal.has_organization_role(uuid, text[])
  to authenticated;

grant select (entitlement_id)
  on public.enrollments to authenticated;

grant select (hold_expires_at)
  on public.live_bookings to authenticated;

drop policy if exists own_attendance_summaries_read
  on public.attendance_summaries;

create policy own_attendance_summaries_read
on public.attendance_summaries
for select to authenticated
using (
  exists (
    select 1
    from public.live_bookings booking
    where booking.id = attendance_summaries.live_booking_id
      and booking.person_id = internal.request_person_id()
  )
);

grant select (live_booking_id, quarantined_at)
  on public.attendance_summaries to authenticated;

-- The public provider-ingestion wrapper was created after the bootstrap's
-- blanket function revoke, so PostgreSQL's default PUBLIC execute privilege
-- remained in effect. Keep this webhook entry point service-only.
revoke all on function public.ingest_provider_event(
  text, text, text, text, timestamptz, jsonb, text
) from public, anon, authenticated, service_role;

grant execute on function public.ingest_provider_event(
  text, text, text, text, timestamptz, jsonb, text
) to service_role;

-- Unassigned support cases have a NULL assignee. Return explicit booleans so
-- the staff UI and API schema never receive a nullable authorization flag.
create or replace function internal.read_support_queue()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
begin
  if not internal.has_exact_staff_role('support') then
    raise exception 'SUPPORT_ROLE_REQUIRED';
  end if;
  return jsonb_build_object(
    'agents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'roleId', role.id,
        'label', coalesce(nullif(trim(person.display_name), ''), '客服人員')
      ) order by coalesce(person.display_name, ''), role.id)
      from public.staff_roles role
      join public.people person on person.id = role.person_id
      where role.role = 'support'
        and role.active
        and person.anonymized_at is null
    ), '[]'::jsonb),
    'cases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'caseId', support_case.id,
        'reference', support_case.public_reference,
        'kind', support_case.kind,
        'safePreview', internal.support_safe_preview(support_case.kind),
        'status', support_case.status,
        'priority', support_case.priority,
        'scopeLabel', case
          when support_case.organization_id is null then '個人案件'
          else '機構案件'
        end,
        'requesterLabel', case
          when support_case.organization_id is null then '個人案件提出人'
          else '機構授權窗口'
        end,
        'assigned', support_case.assigned_to is not null,
        'assignedToMe', coalesce(support_case.assigned_to = actor, false),
        'canReadThread', coalesce(support_case.assigned_to = actor, false),
        'responseDueAt', support_case.response_due_at,
        'slaState', case
          when support_case.status in ('resolved', 'closed') then 'complete'
          when support_case.response_due_at < now() then 'overdue'
          when support_case.response_due_at <= now() + interval '4 hours'
            then 'due_soon'
          else 'on_track'
        end,
        'updatedAt', support_case.last_activity_at,
        'messages', case
          when support_case.assigned_to = actor then coalesce((
            select jsonb_agg(jsonb_build_object(
              'messageId', message.id,
              'authorKind', message.author_kind,
              'body', case message.author_kind
                when 'customer'
                  then '客戶內容需透過安全補件流程'
                else internal.redact_support_text(message.body)
              end,
              'createdAt', message.created_at
            ) order by message.created_at, message.id)
            from public.support_case_messages message
            where message.support_case_id = support_case.id
          ), '[]'::jsonb)
          else '[]'::jsonb
        end
      ) order by
        (support_case.status not in ('resolved', 'closed')) desc,
        support_case.response_due_at, support_case.last_activity_at desc,
        support_case.id)
      from public.support_cases support_case
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function internal.read_support_queue()
  from public, anon, authenticated, service_role;

grant execute on function internal.read_support_queue()
  to authenticated;
