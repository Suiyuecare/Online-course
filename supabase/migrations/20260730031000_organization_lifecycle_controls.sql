create or replace function internal.change_organization_status(
  target_organization uuid,
  submitted_action text,
  submitted_reason text,
  submitted_nonce_hash text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor uuid := internal.current_person_id();
  organization_row public.organizations%rowtype;
  expected_status text;
  next_status text;
  request_hash text;
  result jsonb;
begin
  if not internal.has_staff_role('platform_admin')
     or submitted_action not in ('suspend', 'reactivate')
     or length(trim(submitted_reason)) < 10
     or submitted_nonce_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'ORGANIZATION_STATUS_CHANGE_REJECTED';
  end if;

  request_hash := encode(extensions.digest(
    target_organization::text || '|' || submitted_action || '|'
      || trim(submitted_reason),
    'sha256'
  ), 'hex');

  insert into public.idempotency_records (
    actor_id, operation, idempotency_key, request_hash, locked_until
  ) values (
    actor, 'organization_status_change', idempotency, request_hash,
    clock_timestamp() + interval '1 minute'
  )
  on conflict (actor_id, operation, idempotency_key) do nothing;

  if not found then
    select record.response_body into result
    from public.idempotency_records record
    where record.actor_id = actor
      and record.operation = 'organization_status_change'
      and record.idempotency_key = idempotency
      and record.request_hash = request_hash
      and record.completed_at is not null;
    if result is null then
      raise exception 'IDEMPOTENCY_REQUEST_CONFLICT';
    end if;
    return result;
  end if;

  perform internal.consume_step_up_grant(
    'emergency_suspend',
    target_organization::text,
    submitted_nonce_hash
  );

  expected_status := case submitted_action
    when 'suspend' then 'approved'
    else 'suspended'
  end;
  next_status := case submitted_action
    when 'suspend' then 'suspended'
    else 'approved'
  end;

  select * into organization_row
  from public.organizations organization
  where organization.id = target_organization
  for update;

  if not found or organization_row.status <> expected_status then
    raise exception 'ORGANIZATION_STATUS_TRANSITION_REJECTED';
  end if;

  update public.organizations
  set status = next_status
  where id = target_organization
    and status = expected_status;

  result := jsonb_build_object(
    'organizationId', target_organization,
    'action', submitted_action,
    'status', next_status
  );

  update public.idempotency_records
  set response_status = 200,
      response_body = result,
      completed_at = clock_timestamp(),
      locked_until = null
  where actor_id = actor
    and operation = 'organization_status_change'
    and idempotency_key = idempotency;

  perform internal.append_audit_event(
    actor,
    case submitted_action
      when 'suspend' then 'organization.suspended'
      else 'organization.reactivated'
    end,
    'organization',
    target_organization::text,
    trim(submitted_reason),
    target_organization,
    jsonb_build_object(
      'fromStatus', expected_status,
      'toStatus', next_status,
      'operation', submitted_action
    )
  );

  insert into public.notifications (
    person_id, category, title, body, business_key
  )
  select distinct
    recipient.person_id,
    'organization',
    case submitted_action
      when 'suspend' then '機構培訓功能已暫停'
      else '機構培訓功能已恢復'
    end,
    case submitted_action
      when 'suspend'
        then '平台已暫停機構的新購點、邀請與派課操作；既有稽核紀錄仍完整保留。'
      else '平台已恢復機構的購點、邀請與派課操作。'
    end,
    'organization-status:' || target_organization::text || ':'
      || idempotency::text
  from (
    select organization_row.contact_person_id as person_id
    union
    select membership.person_id
    from public.organization_memberships membership
    where membership.organization_id = target_organization
      and membership.active
      and membership.role in ('owner', 'training_manager')
  ) recipient
  where recipient.person_id is not null
  on conflict (person_id, business_key) do nothing;

  insert into public.notification_outbox (
    notification_id, channel, destination_ciphertext,
    template_key, template_data, business_idempotency_key
  )
  select
    notification.id,
    channel.name,
    '{}'::jsonb,
    'organization_status_changed',
    jsonb_build_object(
      'organizationId', target_organization,
      'status', next_status
    ),
    'organization-status:' || channel.name || ':'
      || target_organization::text || ':' || idempotency::text
  from public.notifications notification
  cross join (values ('sms'), ('email')) as channel(name)
  join public.people recipient on recipient.id = notification.person_id
  where notification.business_key =
      'organization-status:' || target_organization::text || ':'
        || idempotency::text
    and (
      channel.name = 'sms'
      or recipient.email_verified_at is not null
    )
  on conflict (business_idempotency_key) do nothing;

  return result;
end
$$;

revoke all on function internal.change_organization_status(
  uuid, text, text, text, uuid
) from public, anon, authenticated, service_role;

create or replace function public.change_organization_status(
  p_organization_id uuid,
  p_action text,
  p_reason text,
  p_nonce_hash text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, private, internal
as $$
  select internal.change_organization_status(
    p_organization_id,
    p_action,
    p_reason,
    p_nonce_hash,
    p_idempotency_key
  )
$$;

revoke all on function public.change_organization_status(
  uuid, text, text, text, uuid
) from public, anon, authenticated, service_role;

grant execute on function internal.change_organization_status(
  uuid, text, text, text, uuid
) to authenticated;
grant execute on function public.change_organization_status(
  uuid, text, text, text, uuid
) to authenticated;

create or replace function internal.read_organization_lifecycle_controls(
  search_text text,
  requested_limit integer
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  normalized_search text := nullif(trim(search_text), '');
  effective_limit integer := least(greatest(
    coalesce(requested_limit, 50), 1
  ), 100);
  result jsonb;
begin
  if not internal.has_staff_role('platform_admin') then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'organizationId', organization.id,
      'legalName', organization.legal_name,
      'status', organization.status,
      'invoiceEmail', organization.invoice_email,
      'contactName', coalesce(contact.display_name, '未設定'),
      'updatedAt', coalesce(
        (
          select max(event.occurred_at)
          from public.audit_events event
          where event.target_type = 'organization'
            and event.target_id = organization.id::text
            and event.action in (
              'organization.approved',
              'organization.suspended',
              'organization.reactivated'
            )
        ),
        organization.reviewed_at,
        organization.created_at
      )
    )
    order by organization.legal_name, organization.id
  ), '[]'::jsonb)
  into result
  from (
    select candidate.*
    from public.organizations candidate
    where candidate.status in ('approved', 'suspended')
      and (
        normalized_search is null
        or concat_ws(
          ' ', candidate.legal_name, candidate.invoice_email
        ) ilike '%' || normalized_search || '%'
      )
    order by candidate.legal_name, candidate.id
    limit effective_limit
  ) organization
  left join public.people contact
    on contact.id = organization.contact_person_id;

  return result;
end
$$;

revoke all on function internal.read_organization_lifecycle_controls(
  text, integer
) from public, anon, authenticated, service_role;

create or replace function public.read_organization_lifecycle_controls(
  p_search text default null,
  p_limit integer default 50
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_organization_lifecycle_controls(
    p_search, p_limit
  )
$$;

revoke all on function public.read_organization_lifecycle_controls(
  text, integer
) from public, anon, authenticated, service_role;

grant execute on function internal.read_organization_lifecycle_controls(
  text, integer
) to authenticated;
grant execute on function public.read_organization_lifecycle_controls(
  text, integer
) to authenticated;
