-- Privacy/data-subject requests reuse the existing append-only support case
-- This forward migration is ordered after the complete pre-launch schema chain.
-- lifecycle. They remain personal (never organization scoped), carry their own
-- safe queue label, and receive a longer first-response deadline.

create or replace function internal.support_safe_preview(submitted_kind text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case submitted_kind
    when 'learning' then '學習與進度案件'
    when 'live' then '直播課程案件'
    when 'order' then '訂單與匯款狀態案件'
    when 'organization' then '機構培訓案件'
    when 'account' then '帳號登入案件'
    when 'privacy' then '個資與帳號權利案件'
    else '其他客服案件'
  end || '；內容需透過安全補件流程'
$$;

revoke all on function internal.support_safe_preview(text) from public;

create or replace function internal.create_support_case(
  submitted_kind text,
  submitted_summary text,
  submitted_initial_message text,
  target_organization uuid,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  prior public.support_case_events%rowtype;
  case_id uuid := gen_random_uuid();
  message_id uuid := gen_random_uuid();
  public_reference text :=
    'SUP-' || upper(left(replace(case_id::text, '-', ''), 12));
  normalized_summary text := trim(coalesce(submitted_summary, ''));
  normalized_message text :=
    trim(coalesce(submitted_initial_message, ''));
  request_hash text := internal.canonical_request_hash(jsonb_build_object(
    'kind', submitted_kind,
    'summary', normalized_summary,
    'initialMessage', normalized_message,
    'organizationId', target_organization
  ));
  due_at timestamptz := internal.add_business_days(
    clock_timestamp(),
    case when submitted_kind = 'privacy' then 15 else 1 end
  );
begin
  select * into prior
  from public.support_case_events event
  where event.actor_person_id = actor
    and event.idempotency_key = idempotency;
  if found then
    if prior.event_type <> 'created'
       or prior.request_hash <> request_hash
       or not internal.customer_can_access_support_case(
         prior.support_case_id
       )
    then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object(
      'caseId', prior.support_case_id,
      'reference', (
        select support_case.public_reference
        from public.support_cases support_case
        where support_case.id = prior.support_case_id
      ),
      'replayed', true
    );
  end if;
  if submitted_kind not in (
       'learning', 'live', 'order', 'organization',
       'account', 'privacy', 'other'
     )
     or length(normalized_summary) not between 5 and 200
     or length(normalized_message) not between 1 and 4000
     or (
       submitted_kind = 'privacy'
       and target_organization is not null
     )
     or (
       target_organization is not null
       and not internal.has_organization_role(
         target_organization,
         array['owner', 'training_manager', 'finance']
       )
     )
  then raise exception 'SUPPORT_CASE_INVALID'; end if;

  insert into public.support_cases (
    id, public_reference, person_id, organization_id, kind,
    status, priority, summary, response_due_at, last_activity_at,
    customer_last_message_at
  ) values (
    case_id, public_reference, actor, target_organization, submitted_kind,
    'open', 'normal', normalized_summary, due_at, clock_timestamp(),
    clock_timestamp()
  );
  insert into public.support_case_messages (
    id, support_case_id, author_person_id, author_kind,
    body, idempotency_key, request_hash
  ) values (
    message_id, case_id, actor, 'customer', normalized_message,
    idempotency, request_hash
  );
  insert into public.support_case_events (
    support_case_id, actor_person_id, event_type,
    resulting_status, response_due_at, reason, event_data,
    idempotency_key, request_hash
  ) values (
    case_id, actor, 'created', 'open', due_at,
    'customer created support case',
    jsonb_build_object(
      'kind', submitted_kind,
      'organizationScoped', target_organization is not null,
      'messageId', message_id
    ),
    idempotency, request_hash
  );
  perform internal.append_audit_event(
    actor, 'support.case_created', 'support_case', case_id::text,
    'customer created support case', target_organization,
    jsonb_build_object(
      'kind', submitted_kind,
      'organizationScoped', target_organization is not null
    )
  );
  return jsonb_build_object(
    'caseId', case_id,
    'reference', public_reference,
    'replayed', false
  );
end
$$;

revoke all on function internal.create_support_case(
  text, text, text, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function internal.create_support_case(
  text, text, text, uuid, uuid
) to authenticated;
