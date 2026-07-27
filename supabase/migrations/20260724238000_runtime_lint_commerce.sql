-- Resolve runtime PL/pgSQL lint findings without changing public signatures.
-- Each definition is copied from the latest applied implementation; only
-- ambiguous local names and the unsupported JSON object length call change.

create or replace function internal.create_b2c_order(
  course_version uuid,
  legal_acceptance uuid,
  live_selections jsonb,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  version_row public.course_versions%rowtype;
  decision_row public.accreditation_decision_revisions%rowtype;
  acceptance_row public.legal_acceptances%rowtype;
  existing_order public.orders%rowtype;
  order_id uuid;
  order_number text;
  transfer_due timestamptz;
  bank_setting jsonb;
  selected record;
  session_row public.live_sessions%rowtype;
  booking_count integer;
begin
  if not internal.feature_is_open('b2c_commerce') then
    raise exception 'B2C_COMMERCE_CLOSED';
  end if;

  select * into existing_order
  from public.orders
  where person_id = actor and idempotency_key = idempotency;
  if found then
    return jsonb_build_object(
      'orderId', existing_order.id,
      'orderNumber', existing_order.order_number,
      'expiresAt', existing_order.transfer_due_at
    );
  end if;

  select * into version_row
  from public.course_versions
  where id = course_version
  for share;
  if not found
     or version_row.status <> 'published'
     or version_row.commerce_close_at <= now()
     or version_row.price_twd is null
     or version_row.legal_document_id is null
     or version_row.retention_policy_revision_id is null
  then
    raise exception 'COURSE_NOT_SELLABLE';
  end if;

  select decision.* into decision_row
  from public.course_version_accreditation link
  join public.accreditation_decision_revisions decision
    on decision.id = link.accreditation_revision_id
  where link.course_version_id = version_row.id
  order by decision.revision desc
  limit 1;
  if not found or decision_row.status not in ('applying', 'approved') then
    raise exception 'ACCREDITATION_NOT_SELLABLE';
  end if;

  select * into acceptance_row
  from public.legal_acceptances
  where id = legal_acceptance
    and person_id = actor
    and legal_document_id = version_row.legal_document_id;
  if not found
     or acceptance_row.second_confirmed_at is null
     or acceptance_row.second_confirmed_at
       < acceptance_row.first_presented_at + interval '72 hours'
  then
    raise exception 'CONTRACT_SECOND_CONFIRMATION_REQUIRED';
  end if;

  select setting.value into bank_setting
  from public.operating_setting_revisions setting
  where setting.setting_key = 'bank_account'
    and setting.effective_at <= now()
    and (setting.superseded_at is null or setting.superseded_at > now())
  order by setting.revision desc
  limit 1;
  if bank_setting is null
     or bank_setting ->> 'bankName' is null
     or bank_setting ->> 'bankCode' is null
     or bank_setting ->> 'accountName' is null
     or bank_setting ->> 'accountNumber' is null
     or bank_setting ->> 'maskedAccount' is null
  then
    raise exception 'BANK_CONFIGURATION_MISSING';
  end if;

  if version_row.delivery_type in ('live', 'hybrid') then
    if jsonb_typeof(live_selections) <> 'object'
       or coalesce(live_selections = '{}'::jsonb, true)
    then
      raise exception 'LIVE_SESSION_SELECTION_REQUIRED';
    end if;
    for selected in
      select key as component_id, value #>> '{}' as session_id
      from jsonb_each(live_selections)
      order by value #>> '{}'
    loop
      select * into session_row
      from public.live_sessions
      where id = selected.session_id::uuid
        and course_version_id = version_row.id
        and status in ('scheduled', 'open')
      for update;
      if not found
         or internal.business_days_between(now(), session_row.starts_at) < 3
         or session_row.booking_close_at <= now()
      then
        raise exception 'LIVE_SESSION_NOT_BOOKABLE';
      end if;
      perform internal.release_expired_live_holds(session_row.id, 1000);
      select count(*) into booking_count
      from public.live_bookings
      where live_session_id = session_row.id
        and (
          status in ('confirmed', 'attended')
          or (status = 'held' and hold_expires_at > clock_timestamp())
        );
      if booking_count >= session_row.learner_capacity then
        raise exception 'LIVE_SESSION_FULL';
      end if;
    end loop;
  end if;

  transfer_due := case
    when version_row.delivery_type = 'recorded'
      then now() + interval '72 hours'
    else now() + interval '24 hours'
  end;
  order_id := gen_random_uuid();
  order_number := 'SY' || to_char(now(), 'YYYYMMDD')
    || upper(substr(replace(order_id::text, '-', ''), 1, 10));

  insert into public.orders (
    id, order_number, person_id, legal_acceptance_id, status,
    amount_due_twd, accreditation_disclosure_snapshot, price_snapshot,
    transfer_due_at, idempotency_key
  ) values (
    order_id, order_number, actor, legal_acceptance, 'pending_transfer',
    version_row.price_twd,
    case when decision_row.status = 'applying'
      then '積分申請中、尚未核定、不保證取得點數'
      else '積分核定資訊以訂單快照為準'
    end,
    jsonb_build_object(
      'courseVersionId', version_row.id,
      'priceTwd', version_row.price_twd,
      'recordedAllocationTwd', version_row.recorded_refund_allocation_twd,
      'liveAllocations', version_row.live_refund_allocations,
      'accreditationRevisionId', decision_row.id,
      'relatedParty', false
    ),
    transfer_due, idempotency
  );

  insert into public.order_items (
    order_id, course_version_id, scope_type, title_snapshot,
    amount_twd, price_allocation_snapshot
  ) values (
    order_id, version_row.id, 'whole_course', version_row.title,
    version_row.price_twd,
    jsonb_build_object(
      'recorded', version_row.recorded_refund_allocation_twd,
      'live', version_row.live_refund_allocations
    )
  );

  insert into public.bank_payment_instructions (
    order_id, bank_name_snapshot, bank_code_snapshot, account_name_snapshot,
    account_number_snapshot, masked_account_snapshot, amount_twd, expires_at
  ) values (
    order_id, bank_setting ->> 'bankName', bank_setting ->> 'bankCode',
    bank_setting ->> 'accountName', bank_setting ->> 'accountNumber',
    bank_setting ->> 'maskedAccount',
    version_row.price_twd, transfer_due
  );

  if version_row.delivery_type in ('live', 'hybrid') then
    for selected in
      select key as component_id, value #>> '{}' as session_id
      from jsonb_each(live_selections)
      order by value #>> '{}'
    loop
      insert into public.live_bookings (
        person_id, course_version_id, live_component_id, live_session_id,
        payer_type, payer_source_id, status, customer_key, hold_expires_at,
        change_locked_at, idempotency_key
      ) values (
        actor, version_row.id,
        case when selected.component_id = 'course'
          then null else selected.component_id::uuid end,
        selected.session_id::uuid, 'b2c', order_id, 'held',
        rtrim(
          translate(
            encode(extensions.gen_random_bytes(24), 'base64'),
            '+/',
            '-_'
          ),
          '='
        ),
        now() + interval '24 hours',
        (
          select starts_at - interval '24 hours'
          from public.live_sessions where id = selected.session_id::uuid
        ),
        gen_random_uuid()
      );
    end loop;
  end if;

  perform internal.append_audit_event(
    actor, 'order.created', 'order', order_id::text,
    'B2C manual bank transfer order', null,
    jsonb_build_object('amountTwd', version_row.price_twd)
  );
  return jsonb_build_object(
    'orderId', order_id,
    'orderNumber', order_number,
    'expiresAt', transfer_due
  );
end
$$;
revoke all on function internal.create_b2c_order(
  uuid, uuid, jsonb, uuid
) from public;
create or replace function internal.finalize_order_payment(target_order uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  order_row public.orders%rowtype;
  paid_total integer;
  item_row public.order_items%rowtype;
  decision_status text;
  entitlement_status text;
  new_entitlement_id uuid;
  new_enrollment_id uuid;
begin
  select * into order_row from public.orders
    where id = target_order for update;
  select coalesce(sum(
    case when allocation_kind = 'allocation' then amount_twd else -amount_twd end
  ), 0) into paid_total
  from public.bank_transaction_allocations
  where order_id = target_order;
  if paid_total <> order_row.amount_due_twd then
    update public.orders
      set status = 'payment_review', amount_paid_twd = paid_total
      where id = target_order;
    return 'payment_review';
  end if;
  select * into item_row from public.order_items
    where order_id = target_order limit 1;
  select decision.status into decision_status
  from public.course_version_accreditation link
  join public.accreditation_decision_revisions decision
    on decision.id = link.accreditation_revision_id
  where link.course_version_id = item_row.course_version_id
  order by decision.revision desc limit 1;
  entitlement_status := case
    when decision_status = 'approved' then 'active'
    else 'locked'
  end;

  if exists (
    select 1 from public.live_bookings booking
    where booking.payer_type = 'b2c'
      and booking.payer_source_id = order_row.id
      and (
        booking.status <> 'held'
        or booking.hold_expires_at < now()
      )
  ) then
    update public.live_bookings
    set status = 'released'
    where payer_type = 'b2c'
      and payer_source_id = order_row.id
      and status = 'held';
    update public.orders
      set status = 'paid_unfulfilled', amount_paid_twd = paid_total,
          paid_at = now()
      where id = order_row.id;
    insert into public.payment_events (
      order_id, event_type, amount_twd, actor_id, event_data
    ) values (
      order_row.id, 'payment_confirmed', paid_total,
      internal.current_person_id(),
      jsonb_build_object(
        'fulfillmentStatus', 'paid_unfulfilled',
        'reason', 'live_hold_expired_or_released'
      )
    );
    insert into public.invoice_records (order_id, amount_twd)
    values (order_row.id, paid_total)
    on conflict do nothing;
    insert into public.reconciliation_cases (
      kind, order_id, status, reason
    ) values (
      'capacity_unavailable', order_row.id, 'open',
      'payment confirmed after live hold was unavailable'
    );
    insert into public.notifications (
      person_id, category, title, body, business_key
    ) values (
      order_row.person_id, 'payment', '匯款已確認，待安排履約',
      '已確認實際入帳，但原直播保留位已失效。請選擇合適場次或申請全額退款。',
      'order-paid-unfulfilled:' || order_row.id::text
    ) on conflict (person_id, business_key) do nothing;
    return 'paid_unfulfilled';
  end if;

  insert into public.entitlements (
    person_id, course_version_id, source_type, source_id,
    status, locked_reason, starts_at
  ) values (
    order_row.person_id, item_row.course_version_id, 'b2c_order',
    order_row.id, entitlement_status,
    case when entitlement_status = 'locked'
      then 'accreditation_not_yet_approved' end,
    case when entitlement_status = 'active' then now() end
  )
  on conflict (person_id, course_version_id, source_type, source_id)
  do update set status = excluded.status
  returning id into new_entitlement_id;
  insert into public.enrollments (
    person_id, course_version_id, entitlement_id
  ) values (
    order_row.person_id, item_row.course_version_id, new_entitlement_id
  ) on conflict (entitlement_id) do update
    set person_id = excluded.person_id
  returning id into new_enrollment_id;
  update public.live_bookings
    set status = 'confirmed',
        hold_expires_at = null,
        enrollment_id = new_enrollment_id
    where payer_type = 'b2c'
      and payer_source_id = order_row.id
      and status = 'held';
  update public.orders
    set status = 'paid', amount_paid_twd = paid_total, paid_at = now()
    where id = order_row.id;
  insert into public.payment_events (
    order_id, event_type, amount_twd, actor_id, event_data
  ) values (
    order_row.id, 'payment_confirmed', paid_total,
    internal.current_person_id(),
    jsonb_build_object('entitlementStatus', entitlement_status)
  );
  insert into public.invoice_records (
    order_id, amount_twd
  ) values (
    order_row.id, paid_total
  ) on conflict do nothing;
  insert into public.notifications (
    person_id, category, title, body, business_key
  ) values (
    order_row.person_id, 'payment', '匯款已確認',
    case when entitlement_status = 'active'
      then '已確認實際入帳，課程已開通。'
      else '已確認實際入帳；積分核准前課程仍保持鎖定。'
    end,
    'order-paid:' || order_row.id::text
  ) on conflict (person_id, business_key) do nothing;
  insert into public.notification_outbox (
    notification_id, channel, destination_ciphertext,
    template_key, template_data, business_idempotency_key
  )
  select
    notification.id, channel.name, '{}'::jsonb, 'payment_confirmed',
    jsonb_build_object('orderId', order_row.id),
    'order-paid:' || channel.name || ':' || order_row.id::text
  from public.notifications notification
  cross join (values ('sms'), ('email')) as channel(name)
  where notification.person_id = order_row.person_id
    and notification.business_key = 'order-paid:' || order_row.id::text
    and (
      channel.name = 'sms'
      or exists (
        select 1 from public.people person
        where person.id = order_row.person_id
          and person.email_verified_at is not null
      )
    )
  on conflict (business_idempotency_key) do nothing;
  return 'paid';
end
$$;
revoke all on function internal.finalize_order_payment(uuid) from public;
create or replace function internal.build_refundable_scopes(
  target_order uuid,
  target_person uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  order_row public.orders%rowtype;
  item_row public.order_items%rowtype;
  target_enrollment_id uuid;
  total_prior integer;
  scope_prior integer;
  base_amount integer;
  remaining_amount integer;
  confirmed_seconds integer;
  required_seconds integer;
  supplied_ratio numeric;
  is_credited boolean;
  live_allocation record;
  live_label text;
  scopes jsonb := '[]'::jsonb;
  eligible boolean;
  ineligible_reason text;
  recompute_result jsonb;
begin
  select * into order_row
  from public.orders
  where id = target_order and person_id = target_person;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  select * into item_row
  from public.order_items
  where order_id = target_order
  order by created_at
  limit 1;
  select enrollment.id into target_enrollment_id
  from public.entitlements entitlement
  join public.enrollments enrollment
    on enrollment.entitlement_id = entitlement.id
  where entitlement.person_id = target_person
    and entitlement.source_type = 'b2c_order'
    and entitlement.source_id = target_order;
  select coalesce(sum(allocation.amount_twd), 0) into total_prior
  from public.refund_allocations allocation
  join public.refund_cases refund_case
    on refund_case.id = allocation.refund_case_id
  where refund_case.order_id = target_order
    and refund_case.status not in ('rejected', 'failed');
  select exists (
    select 1
    from public.certificates certificate
    where certificate.enrollment_id = target_enrollment_id
      and certificate.current_status = 'credited'
  ) into is_credited;

  remaining_amount := greatest(
    order_row.amount_paid_twd - total_prior, 0
  );
  eligible := order_row.status in ('paid', 'paid_unfulfilled')
    and remaining_amount > 0 and not is_credited;
  ineligible_reason := case
    when is_credited then 'official_accreditation_already_credited'
    when order_row.status not in ('paid', 'paid_unfulfilled')
      then 'order_not_paid'
    when remaining_amount <= 0 then 'refund_value_exhausted'
    else null
  end;
  scopes := scopes || jsonb_build_array(jsonb_build_object(
    'scopeType', 'whole_order',
    'scopeId', null,
    'label', '整筆訂單',
    'eligible', eligible,
    'ineligibleReason', ineligible_reason
  ));

  base_amount := coalesce(
    (item_row.price_allocation_snapshot ->> 'recorded')::integer, 0
  );
  if base_amount > 0 then
    if target_enrollment_id is not null then
      recompute_result :=
        internal.recompute_recorded_progress_unchecked(target_enrollment_id);
    end if;
    if target_enrollment_id is null
       or not coalesce((recompute_result ->> 'valid')::boolean, false)
       or coalesce(
         (recompute_result ->> 'driftDetected')::boolean, true
       )
    then
      -- A quotation must never reduce a learner's refundable amount using
      -- unverified or stale viewing totals.
      confirmed_seconds := 0;
      select greatest(
        coalesce(requirement.required_watch_seconds, 0), 1
      )
      into required_seconds
      from public.course_requirements requirement
      where requirement.course_version_id = item_row.course_version_id;
    else
      confirmed_seconds :=
        coalesce((recompute_result ->> 'confirmedSeconds')::integer, 0);
      select greatest(
        coalesce(requirement.required_watch_seconds, 0), 1
      )
      into required_seconds
      from public.course_requirements requirement
      where requirement.course_version_id = item_row.course_version_id;
    end if;
    supplied_ratio := least(
      1,
      greatest(
        0,
        coalesce(confirmed_seconds, 0)::numeric
          / greatest(coalesce(required_seconds, 1), 1)
      )
    );
    select coalesce(sum(allocation.amount_twd), 0)
      into scope_prior
    from public.refund_allocations allocation
    join public.refund_cases refund_case
      on refund_case.id = allocation.refund_case_id
    where refund_case.order_id = target_order
      and refund_case.status not in ('rejected', 'failed')
      and allocation.scope_type = 'recorded'
      and allocation.scope_id = item_row.course_version_id;
    remaining_amount := greatest(
      ceil(base_amount * (1 - supplied_ratio))::integer - scope_prior,
      0
    );
    eligible := order_row.status = 'paid'
      and target_enrollment_id is not null
      and remaining_amount > 0
      and not is_credited;
    ineligible_reason := case
      when is_credited then 'official_accreditation_already_credited'
      when order_row.status <> 'paid' then 'course_access_not_fulfilled'
      when target_enrollment_id is null then 'enrollment_not_found'
      when remaining_amount <= 0 then 'refund_value_exhausted'
      else null
    end;
    scopes := scopes || jsonb_build_array(jsonb_build_object(
      'scopeType', 'recorded',
      'scopeId', item_row.course_version_id,
      'label', '預錄課程內容',
      'eligible', eligible,
      'ineligibleReason', ineligible_reason
    ));
  end if;

  for live_allocation in
    select key::uuid as scope_id, value::integer as amount_twd
    from jsonb_each_text(
      coalesce(item_row.price_allocation_snapshot -> 'live', '{}'::jsonb)
    )
    order by key
  loop
    base_amount := live_allocation.amount_twd;
    select coalesce(max(
      attendance.effective_presence_seconds::numeric
        / greatest(attendance.denominator_seconds, 1)
    ), 0) into supplied_ratio
    from public.live_bookings booking
    left join public.attendance_summaries attendance
      on attendance.live_booking_id = booking.id
    where booking.enrollment_id = target_enrollment_id
      and coalesce(
        booking.live_component_id, booking.course_version_id
      ) = live_allocation.scope_id;
    select coalesce(sum(allocation.amount_twd), 0)
      into scope_prior
    from public.refund_allocations allocation
    join public.refund_cases refund_case
      on refund_case.id = allocation.refund_case_id
    where refund_case.order_id = target_order
      and refund_case.status not in ('rejected', 'failed')
      and allocation.scope_type = 'live_component'
      and allocation.scope_id = live_allocation.scope_id;
    remaining_amount := greatest(
      ceil(base_amount * (1 - least(1, supplied_ratio)))::integer
        - scope_prior,
      0
    );
    select coalesce(component.title, item_row.title_snapshot || '（直播）')
      into live_label
    from (select 1) placeholder
    left join public.hybrid_components component
      on component.id = live_allocation.scope_id;
    eligible := order_row.status = 'paid'
      and target_enrollment_id is not null
      and remaining_amount > 0
      and not is_credited;
    ineligible_reason := case
      when is_credited then 'official_accreditation_already_credited'
      when order_row.status <> 'paid' then 'course_access_not_fulfilled'
      when target_enrollment_id is null then 'enrollment_not_found'
      when remaining_amount <= 0 then 'refund_value_exhausted'
      else null
    end;
    scopes := scopes || jsonb_build_array(jsonb_build_object(
      'scopeType', 'live_component',
      'scopeId', live_allocation.scope_id,
      'label', live_label,
      'eligible', eligible,
      'ineligibleReason', ineligible_reason
    ));
  end loop;
  return scopes;
end
$$;
revoke all on function internal.build_refundable_scopes(uuid, uuid)
  from public;
create or replace function internal.request_refund(
  target_case uuid,
  target_order uuid,
  submitted_basis text,
  submitted_reason text,
  submitted_scopes jsonb,
  submitted_account_ciphertext jsonb,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  order_row public.orders%rowtype;
  item_row public.order_items%rowtype;
  entitlement_row public.entitlements%rowtype;
  target_enrollment uuid;
  scope jsonb;
  scope_type text;
  requested_scope_id uuid;
  allocation_amount integer;
  base_amount integer;
  confirmed_seconds integer;
  required_seconds integer;
  supplied_ratio numeric;
  prior_refunds integer;
  prior_scope_refunds integer;
  total_requested integer := 0;
  existing_case uuid;
  recompute_result jsonb;
  recorded_usage_verified boolean := false;
begin
  select refund_case.id into existing_case
  from public.refund_cases refund_case
  where refund_case.requested_by = actor
    and refund_case.idempotency_key = idempotency;
  if found then
    return jsonb_build_object('refundCaseId', existing_case);
  end if;
  if submitted_basis not in (
    'consumer_withdrawal', 'proportional_termination',
    'accreditation_failure', 'provider_failure',
    'suiyue_cancellation', 'material_change', 'other'
  )
     or length(trim(submitted_reason)) < 10
     or jsonb_typeof(submitted_scopes) <> 'array'
     or jsonb_array_length(submitted_scopes) not between 1 and 20
     or (
       select count(*)
       from jsonb_array_elements(submitted_scopes)
     ) <> (
       select count(distinct
         (item ->> 'scopeType') || ':' || coalesce(item ->> 'scopeId', '')
       )
       from jsonb_array_elements(submitted_scopes) item
     )
     or (
       jsonb_array_length(submitted_scopes) > 1
       and exists (
         select 1 from jsonb_array_elements(submitted_scopes) item
         where item ->> 'scopeType' = 'whole_order'
       )
     )
  then raise exception 'REFUND_REQUEST_INVALID'; end if;
  select * into order_row from public.orders
  where id = target_order and person_id = actor
    and status in ('paid', 'paid_unfulfilled')
  for update;
  if not found then raise exception 'PAID_ORDER_REQUIRED'; end if;
  select * into item_row from public.order_items
  where order_id = target_order
  order by created_at limit 1;
  select entitlement.* into entitlement_row
  from public.entitlements entitlement
  where entitlement.person_id = actor
    and entitlement.source_type = 'b2c_order'
    and entitlement.source_id = target_order
  for update;
  select enrollment.id into target_enrollment
  from public.enrollments enrollment
  where enrollment.entitlement_id = entitlement_row.id;
  if target_enrollment is not null
     and exists (
       select 1
       from jsonb_array_elements(submitted_scopes) requested_scope
       where requested_scope ->> 'scopeType'
         in ('recorded', 'whole_order')
     )
  then
    -- Serialize the usage snapshot against an in-flight presence
    -- confirmation. Confirmation locks the same challenge first and rechecks
    -- entitlement state, so either its block is included here or it is
    -- rejected after this refund freezes access.
    perform challenge.id
    from public.presence_challenges challenge
    where challenge.enrollment_id = target_enrollment
    order by challenge.id
    for update;
    recompute_result :=
      internal.recompute_recorded_progress_unchecked(target_enrollment);
    recorded_usage_verified :=
      coalesce((recompute_result ->> 'valid')::boolean, false)
      and not coalesce(
        (recompute_result ->> 'driftDetected')::boolean, true
      );
    confirmed_seconds := case
      when recorded_usage_verified
        then coalesce(
          (recompute_result ->> 'confirmedSeconds')::integer, 0
        )
      else 0
    end;
    update public.presence_challenges challenge
    set timed_out_at = clock_timestamp(),
        consumed_at = clock_timestamp()
    where challenge.enrollment_id = target_enrollment
      and challenge.confirmed_at is null
      and challenge.timed_out_at is null
      and challenge.consumed_at is null;
    update public.playback_sessions session
    set active = false,
        closed_at = coalesce(session.closed_at, clock_timestamp()),
        candidate_unconfirmed_seconds = 0,
        candidate_origin_lesson_video_version_id = null,
        candidate_origin_media_position_seconds = null,
        candidate_event_manifest = '[]'::jsonb
    where session.enrollment_id = target_enrollment;
    update public.progress_summaries summary
    set candidate_seconds = 0,
        updated_at = clock_timestamp()
    where summary.enrollment_id = target_enrollment;
  end if;
  if exists (
    select 1
    from public.certificates certificate
    where certificate.enrollment_id = target_enrollment
      and certificate.current_status = 'credited'
  ) then
    raise exception 'CREDITED_ENROLLMENT_NOT_REFUNDABLE';
  end if;
  if entitlement_row.id is null and not (
    jsonb_array_length(submitted_scopes) = 1
    and submitted_scopes -> 0 ->> 'scopeType' = 'whole_order'
    and order_row.status = 'paid_unfulfilled'
  ) then
    raise exception 'REFUND_SCOPE_REQUIRES_ENTITLEMENT';
  end if;
  select coalesce(sum(allocation.amount_twd), 0) into prior_refunds
  from public.refund_allocations allocation
  join public.refund_cases refund_case
    on refund_case.id = allocation.refund_case_id
  where refund_case.order_id = target_order
    and refund_case.status not in ('rejected', 'failed');

  insert into public.refund_cases (
    id, order_id, requested_by, basis, reason,
    account_details_ciphertext, usage_snapshot, idempotency_key
  ) values (
    target_case, target_order, actor, submitted_basis,
    trim(submitted_reason), submitted_account_ciphertext,
    jsonb_build_object(
      'capturedAt', now(),
      'entitlementId', entitlement_row.id,
      'entitlementStatus', entitlement_row.status,
      'enrollmentId', target_enrollment,
      'recordedUsageVerified', recorded_usage_verified,
      'recordedConfirmedSeconds', coalesce(confirmed_seconds, 0),
      'recordedRecompute', recompute_result
    ),
    idempotency
  );

  for scope in select value from jsonb_array_elements(submitted_scopes)
  loop
    scope_type := scope ->> 'scopeType';
    requested_scope_id := (scope ->> 'scopeId')::uuid;
    if scope_type = 'whole_order' then
      base_amount := order_row.amount_paid_twd;
      supplied_ratio := 0;
      allocation_amount := order_row.amount_paid_twd - prior_refunds;
      update public.entitlements set status = 'frozen',
        locked_reason = 'refund:' || target_case::text
      where id = entitlement_row.id;
    elsif scope_type = 'recorded' then
      if requested_scope_id is distinct from item_row.course_version_id then
        raise exception 'REFUND_SCOPE_INVALID';
      end if;
      base_amount := coalesce(
        (item_row.price_allocation_snapshot ->> 'recorded')::integer, 0
      );
      select greatest(
        coalesce(requirement.required_watch_seconds, 0), 1
      )
        into required_seconds
      from public.course_requirements requirement
      where requirement.course_version_id = item_row.course_version_id;
      supplied_ratio := least(
        1, greatest(0, confirmed_seconds::numeric / required_seconds)
      );
      select coalesce(sum(allocation.amount_twd), 0)
        into prior_scope_refunds
      from public.refund_allocations allocation
      join public.refund_cases refund_case
        on refund_case.id = allocation.refund_case_id
      where refund_case.order_id = target_order
        and refund_case.status not in ('rejected', 'failed')
        and allocation.scope_type = 'recorded'
        and allocation.scope_id = requested_scope_id;
      allocation_amount := ceil(
        base_amount * (1 - supplied_ratio)
      )::integer - prior_scope_refunds;
      update public.playback_sessions
      set active = false, closed_at = now()
      where playback_sessions.enrollment_id = target_enrollment
        and active;
    elsif scope_type = 'live_component' and requested_scope_id is not null then
      if not exists (
        select 1
        from public.live_bookings booking
        where booking.enrollment_id = target_enrollment
          and coalesce(
            booking.live_component_id, booking.course_version_id
          ) = requested_scope_id
      ) then
        raise exception 'REFUND_SCOPE_INVALID';
      end if;
      base_amount := coalesce(
        (
          item_row.price_allocation_snapshot
            -> 'live' ->> requested_scope_id::text
        )::integer,
        0
      );
      select coalesce(
        max(
          attendance.effective_presence_seconds::numeric
          / greatest(attendance.denominator_seconds, 1)
        ), 0
      ) into supplied_ratio
      from public.live_bookings booking
      left join public.attendance_summaries attendance
        on attendance.live_booking_id = booking.id
      where booking.enrollment_id = target_enrollment
        and coalesce(
          booking.live_component_id, booking.course_version_id
        ) = requested_scope_id;
      select coalesce(sum(allocation.amount_twd), 0)
        into prior_scope_refunds
      from public.refund_allocations allocation
      join public.refund_cases refund_case
        on refund_case.id = allocation.refund_case_id
      where refund_case.order_id = target_order
        and refund_case.status not in ('rejected', 'failed')
        and allocation.scope_type = 'live_component'
        and allocation.scope_id = requested_scope_id;
      allocation_amount := ceil(
        base_amount * (1 - least(1, supplied_ratio))
      )::integer - prior_scope_refunds;
      update public.live_bookings set status = 'released'
      where enrollment_id = target_enrollment
        and coalesce(live_component_id, course_version_id) = requested_scope_id
        and status in ('held', 'confirmed');
      update public.live_join_leases lease set active = false
      from public.live_bookings booking
      where booking.id = lease.live_booking_id
        and booking.enrollment_id = target_enrollment
        and coalesce(
          booking.live_component_id, booking.course_version_id
        ) = requested_scope_id
        and lease.active;
    else
      raise exception 'REFUND_SCOPE_INVALID';
    end if;
    if allocation_amount <= 0 then
      raise exception 'REFUND_SCOPE_HAS_NO_REMAINING_VALUE';
    end if;
    total_requested := total_requested + allocation_amount;
    if prior_refunds + total_requested > order_row.amount_paid_twd then
      raise exception 'REFUND_EXCEEDS_PAYMENT';
    end if;
    insert into public.refund_allocations (
      refund_case_id, order_item_id, scope_type, scope_id,
      amount_twd, calculation_snapshot
    ) values (
      target_case, item_row.id, scope_type, requested_scope_id,
      allocation_amount,
      jsonb_build_object(
        'calculatedAt', now(), 'baseAmountTwd', base_amount,
        'suppliedRatio', supplied_ratio,
        'consumerFavorableRounding', 'ceil'
      )
    );
  end loop;
  if exists (
    select 1 from public.refund_allocations allocation
    where allocation.refund_case_id = target_case
      and allocation.scope_type = 'whole_order'
  ) then
    update public.playback_sessions
      set active = false, closed_at = now()
      where enrollment_id = target_enrollment
        and active;
    update public.live_bookings set status = 'released'
      where enrollment_id = target_enrollment
        and status in ('held', 'confirmed');
    update public.live_join_leases lease set active = false
    from public.live_bookings booking
      where booking.id = lease.live_booking_id
      and booking.enrollment_id = target_enrollment
      and lease.active;
  end if;
  perform internal.append_audit_event(
    actor, 'refund.requested', 'refund_case', target_case::text,
    trim(submitted_reason), null,
    jsonb_build_object('orderId', target_order, 'amountTwd', total_requested)
  );
  return jsonb_build_object(
    'refundCaseId', target_case,
    'calculatedAmountTwd', total_requested,
    'status', 'submitted'
  );
end
$$;
revoke all on function internal.request_refund(
  uuid, uuid, text, text, jsonb, jsonb, uuid
) from public;
create or replace function internal.import_bank_statement_batch(
  submitted_source_sha256 text,
  submitted_attachment_reference text,
  submitted_booked_on date,
  submitted_bank_total integer,
  submitted_rows jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  imported_batch_id uuid;
  row_data jsonb;
  calculated_total bigint;
begin
  if not internal.has_staff_role('finance')
     or submitted_source_sha256 !~ '^[a-f0-9]{64}$'
     or submitted_attachment_reference = ''
     or submitted_bank_total < 0
     or jsonb_typeof(submitted_rows) <> 'array'
     or jsonb_array_length(submitted_rows) not between 1 and 5000
  then raise exception 'BANK_IMPORT_REJECTED'; end if;
  select coalesce(sum((value ->> 'amountTwd')::bigint), 0)
    into calculated_total
  from jsonb_array_elements(submitted_rows);
  if calculated_total <> submitted_bank_total then
    raise exception 'BANK_IMPORT_TOTAL_MISMATCH';
  end if;
  insert into public.bank_import_batches (
    source_sha256, attachment_reference, booked_on,
    imported_by, bank_total_twd
  ) values (
    submitted_source_sha256, submitted_attachment_reference,
    submitted_booked_on, actor, submitted_bank_total
  )
  on conflict (source_sha256) do update
    set source_sha256 = excluded.source_sha256
  returning id into imported_batch_id;
  if exists (
    select 1 from public.bank_import_batches batch
    where batch.id = imported_batch_id and batch.imported_by <> actor
  ) then raise exception 'BANK_IMPORT_SOURCE_ALREADY_USED'; end if;
  if exists (
    select 1 from public.bank_transactions transaction_row
    where transaction_row.batch_id = imported_batch_id
  ) then return imported_batch_id; end if;
  for row_data in select value from jsonb_array_elements(submitted_rows)
  loop
    if (row_data ->> 'amountTwd')::integer <= 0
       or coalesce(row_data ->> 'remitterName', '') = ''
       or (
         row_data ->> 'accountLastFive' is not null
         and row_data ->> 'accountLastFive' !~ '^[0-9]{5}$'
       )
       or row_data ->> 'fingerprint' !~ '^[a-f0-9]{64}$'
    then raise exception 'BANK_IMPORT_ROW_INVALID'; end if;
    insert into public.bank_transactions (
      batch_id, bank_fingerprint, booked_on, remitter_name,
      account_last_five, amount_twd, bank_reference, created_by
    ) values (
      imported_batch_id, row_data ->> 'fingerprint', submitted_booked_on,
      row_data ->> 'remitterName', row_data ->> 'accountLastFive',
      (row_data ->> 'amountTwd')::integer,
      row_data ->> 'bankReference', actor
    );
  end loop;
  perform internal.append_audit_event(
    actor, 'bank_statement.imported', 'bank_import_batch',
    imported_batch_id::text, 'quarantined source imported', null,
    jsonb_build_object(
      'sourceSha256', submitted_source_sha256,
      'bankTotalTwd', submitted_bank_total,
      'rowCount', jsonb_array_length(submitted_rows)
    )
  );
  return imported_batch_id;
end
$$;
revoke all on function internal.import_bank_statement_batch(
  text, text, date, integer, jsonb
) from public;
create or replace function internal.request_live_session_change(
  target_session uuid,
  submitted_action text,
  replacement_starts_at timestamptz,
  replacement_ends_at timestamptz,
  replacement_booking_close_at timestamptz,
  submitted_reason text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  session_row public.live_sessions%rowtype;
  reservation_row public.zoom_host_reservations%rowtype;
  decision public.accreditation_decision_revisions%rowtype;
  job_id uuid;
  job_business_key text := 'live-session-change:' || idempotency::text;
begin
  if not internal.has_staff_role('course_admin')
     or submitted_action not in ('reschedule', 'cancel')
     or length(trim(submitted_reason)) < 10
  then raise exception 'LIVE_SESSION_CHANGE_REJECTED'; end if;
  select job.id into job_id from public.durable_jobs job
  where job.business_key = job_business_key;
  if job_id is not null then
    return jsonb_build_object('jobId', job_id, 'queued', true);
  end if;
  select * into session_row from public.live_sessions
  where id = target_session for update;
  if not found
     or session_row.status not in ('scheduled', 'open')
     or session_row.starts_at <= now()
  then raise exception 'LIVE_SESSION_CHANGE_REJECTED'; end if;
  select * into reservation_row from public.zoom_host_reservations
  where live_session_id = target_session
    and status = 'confirmed'
  for update;
  if not found then raise exception 'LIVE_HOST_RESERVATION_MISSING'; end if;
  if submitted_action = 'reschedule' then
    if replacement_starts_at is null
       or replacement_ends_at is null
       or replacement_booking_close_at is null
       or replacement_starts_at <= now()
       or replacement_ends_at <= replacement_starts_at
       or replacement_booking_close_at >= replacement_starts_at
       or replacement_ends_at - replacement_starts_at
         <> session_row.ends_at - session_row.starts_at
    then raise exception 'RESCHEDULE_WINDOW_INVALID'; end if;
    select accreditation.* into decision
    from public.course_version_accreditation link
    join public.accreditation_decision_revisions accreditation
      on accreditation.id = link.accreditation_revision_id
    where link.course_version_id = session_row.course_version_id
    order by accreditation.revision desc limit 1;
    if not found
       or decision.status <> 'approved'
       or replacement_starts_at < decision.valid_from
       or replacement_ends_at > decision.valid_until
    then raise exception 'RESCHEDULE_OUTSIDE_ACCREDITATION'; end if;
    update public.zoom_host_reservations
    set reservation_window = tstzrange(
          replacement_starts_at - interval '60 minutes',
          replacement_ends_at + interval '60 minutes',
          '[)'
        ),
        status = 'reconciling'
    where id = reservation_row.id;
  else
    update public.zoom_host_reservations set status = 'reconciling'
    where id = reservation_row.id;
  end if;
  update public.live_sessions set status = 'reconciling'
  where id = target_session;
  insert into public.durable_jobs (
    job_type, business_key, payload
  ) values (
    'live_session_change', job_business_key,
    jsonb_build_object(
      'liveSessionId', target_session,
      'action', submitted_action,
      'previousStatus', session_row.status,
      'previousStartsAt', session_row.starts_at,
      'previousEndsAt', session_row.ends_at,
      'previousBookingCloseAt', session_row.booking_close_at,
      'replacementStartsAt', replacement_starts_at,
      'replacementEndsAt', replacement_ends_at,
      'replacementBookingCloseAt', replacement_booking_close_at,
      'requestedBy', actor,
      'reason', trim(submitted_reason)
    )
  ) returning id into job_id;
  perform internal.append_audit_event(
    actor, 'live_session.' || submitted_action || '_requested',
    'live_session', target_session::text, trim(submitted_reason), null,
    jsonb_build_object('durableJobId', job_id)
  );
  return jsonb_build_object('jobId', job_id, 'queued', true);
end
$$;
revoke all on function internal.request_live_session_change(
  uuid, text, timestamptz, timestamptz, timestamptz, text, uuid
) from public;
create or replace function internal.change_b2c_live_session(
  target_booking uuid,
  replacement_session uuid,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  booking_row public.live_bookings%rowtype;
  order_row public.orders%rowtype;
  source_session public.live_sessions%rowtype;
  replacement public.live_sessions%rowtype;
  prior_event public.live_booking_change_events%rowtype;
  occupied_count integer;
  reason_kind text;
  decision_status text;
  entitlement_status text;
  new_entitlement_id uuid;
  new_enrollment_id uuid;
  all_components_ready boolean := false;
  notification_id uuid;
begin
  select * into prior_event
  from public.live_booking_change_events event
  where event.person_id = actor
    and event.idempotency_key = idempotency;
  if found then
    if prior_event.live_booking_id <> target_booking
       or prior_event.replacement_live_session_id <> replacement_session
    then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object(
      'bookingId', prior_event.live_booking_id,
      'liveSessionId', prior_event.replacement_live_session_id,
      'reasonKind', prior_event.reason_kind,
      'replayed', true
    );
  end if;

  -- Fixed lock order matches payment fulfillment: order -> booking ->
  -- lexically ordered session advisory locks -> session rows.
  select orders.* into order_row
  from public.live_bookings booking
  join public.orders orders
    on booking.payer_type = 'b2c'
    and orders.id = booking.payer_source_id
  where booking.id = target_booking
    and booking.person_id = actor
    and orders.person_id = actor
  for update of orders;
  if not found then
    raise exception 'B2C_LIVE_BOOKING_NOT_FOUND';
  end if;

  select * into booking_row
  from public.live_bookings booking
  where booking.id = target_booking
    and booking.person_id = actor
    and booking.payer_type = 'b2c'
    and booking.payer_source_id = order_row.id
  for update;
  if not found
     or replacement_session = booking_row.live_session_id
     or (
       booking_row.status = 'confirmed'
       and (
         order_row.status <> 'paid'
         or clock_timestamp() >= booking_row.change_locked_at
       )
     )
     or (
       booking_row.status = 'cancelled'
       and order_row.status not in ('paid', 'paid_unfulfilled')
     )
     or (
       booking_row.status = 'released'
       and order_row.status <> 'paid_unfulfilled'
     )
     or booking_row.status not in ('confirmed', 'cancelled', 'released')
     or exists (
       select 1 from public.live_join_leases lease
       where lease.live_booking_id = booking_row.id and lease.active
     )
     or exists (
       select 1 from public.check_events event
       where event.live_booking_id = booking_row.id
     )
     or exists (
       select 1 from public.attendance_summaries summary
       where summary.live_booking_id = booking_row.id
     )
  then
    raise exception 'B2C_LIVE_SESSION_CHANGE_LOCKED';
  end if;

  if booking_row.live_session_id::text < replacement_session::text then
    perform pg_advisory_xact_lock(hashtextextended(
      'suiyue:live-capacity:' || booking_row.live_session_id::text, 0
    ));
    perform pg_advisory_xact_lock(hashtextextended(
      'suiyue:live-capacity:' || replacement_session::text, 0
    ));
  else
    perform pg_advisory_xact_lock(hashtextextended(
      'suiyue:live-capacity:' || replacement_session::text, 0
    ));
    perform pg_advisory_xact_lock(hashtextextended(
      'suiyue:live-capacity:' || booking_row.live_session_id::text, 0
    ));
  end if;
  perform session.id
  from public.live_sessions session
  where session.id in (booking_row.live_session_id, replacement_session)
  order by session.id
  for update;

  select * into source_session
  from public.live_sessions session
  where session.id = booking_row.live_session_id;
  select * into replacement
  from public.live_sessions session
  where session.id = replacement_session
    and session.course_version_id = booking_row.course_version_id
    and session.hybrid_component_id is not distinct from
      booking_row.live_component_id
    and session.status in ('scheduled', 'open')
    and session.booking_close_at > clock_timestamp()
    and session.starts_at > clock_timestamp() + interval '24 hours';
  if not found then
    raise exception 'B2C_REPLACEMENT_SESSION_INVALID';
  end if;

  if booking_row.status = 'cancelled'
     and source_session.status <> 'cancelled'
  then
    raise exception 'B2C_CANCELLATION_REMEDY_INVALID';
  end if;
  if booking_row.enrollment_id is not null then
    perform internal.assert_live_component_access(
      booking_row.enrollment_id, booking_row.live_component_id
    );
  elsif order_row.status <> 'paid_unfulfilled' then
    raise exception 'B2C_ENROLLMENT_REQUIRED';
  end if;

  perform internal.release_expired_live_holds(replacement.id, 1000);
  select count(*) into occupied_count
  from public.live_bookings occupied
  where occupied.live_session_id = replacement.id
    and (
      occupied.status in ('confirmed', 'attended')
      or (
        occupied.status = 'held'
        and occupied.hold_expires_at > clock_timestamp()
      )
    );
  if occupied_count >= replacement.learner_capacity then
    raise exception 'B2C_REPLACEMENT_SESSION_FULL';
  end if;

  reason_kind := case
    when order_row.status = 'paid_unfulfilled'
      then 'paid_unfulfilled_recovery'
    when booking_row.status = 'cancelled'
      then 'provider_cancellation'
    else 'learner_change'
  end;
  update public.live_bookings
  set live_session_id = replacement.id,
      status = 'confirmed',
      hold_expires_at = null,
      change_locked_at = replacement.starts_at - interval '24 hours'
  where id = booking_row.id;

  if order_row.status = 'paid_unfulfilled' then
    select not exists (
      select 1
      from public.live_bookings sibling
      where sibling.payer_type = 'b2c'
        and sibling.payer_source_id = order_row.id
        and sibling.status not in ('confirmed', 'attended')
    ) into all_components_ready;
    if all_components_ready then
      select decision.status into decision_status
      from public.order_items item
      join public.course_version_accreditation link
        on link.course_version_id = item.course_version_id
      join public.accreditation_decision_revisions decision
        on decision.id = link.accreditation_revision_id
      where item.order_id = order_row.id
      order by decision.revision desc
      limit 1;
      entitlement_status := case
        when decision_status = 'approved' then 'active'
        else 'locked'
      end;
      insert into public.entitlements (
        person_id, course_version_id, source_type, source_id,
        status, locked_reason, starts_at
      ) values (
        actor, booking_row.course_version_id, 'b2c_order', order_row.id,
        entitlement_status,
        case when entitlement_status = 'locked'
          then 'accreditation_not_yet_approved' end,
        case when entitlement_status = 'active'
          then clock_timestamp() end
      )
      on conflict (person_id, course_version_id, source_type, source_id)
      do update set
        status = excluded.status,
        locked_reason = excluded.locked_reason,
        starts_at = coalesce(public.entitlements.starts_at, excluded.starts_at)
      returning id into new_entitlement_id;
      insert into public.enrollments (
        person_id, course_version_id, entitlement_id
      ) values (
        actor, booking_row.course_version_id, new_entitlement_id
      )
      on conflict (entitlement_id) do update
      set person_id = excluded.person_id
      returning id into new_enrollment_id;
      update public.live_bookings
      set enrollment_id = new_enrollment_id
      where payer_type = 'b2c'
        and payer_source_id = order_row.id
        and status in ('confirmed', 'attended');
      update public.orders
      set status = 'paid'
      where id = order_row.id and status = 'paid_unfulfilled';
      update public.reconciliation_cases
      set status = 'resolved',
          resolved_at = clock_timestamp(),
          reason = reason || '; learner selected replacement sessions'
      where order_id = order_row.id
        and kind = 'capacity_unavailable'
        and status in ('open', 'investigating');
      insert into public.payment_events (
        order_id, event_type, amount_twd, actor_id,
        idempotency_key, event_data
      ) values (
        order_row.id, 'fulfillment_recovered', null, actor,
        idempotency,
        jsonb_build_object(
          'enrollmentId', new_enrollment_id,
          'replacementSessionId', replacement.id
        )
      );
    end if;
  end if;

  insert into public.live_booking_change_events (
    live_booking_id, person_id, previous_live_session_id,
    replacement_live_session_id, reason_kind, idempotency_key
  ) values (
    booking_row.id, actor, booking_row.live_session_id,
    replacement.id, reason_kind, idempotency
  );
  insert into public.notifications (
    person_id, category, title, body, business_key
  ) values (
    actor, 'live', '直播場次已更換',
    '新場次已確認；請重新下載行事曆，開課前再完成設備檢查。',
    'b2c-live-change:' || booking_row.id::text || ':' ||
      replacement.id::text
  )
  on conflict (person_id, business_key) do update
  set title = excluded.title, body = excluded.body
  returning id into notification_id;
  perform internal.append_audit_event(
    actor, 'live_booking.b2c_session_changed', 'live_booking',
    booking_row.id::text, reason_kind, null,
    jsonb_build_object(
      'previousLiveSessionId', booking_row.live_session_id,
      'replacementLiveSessionId', replacement.id,
      'orderId', order_row.id,
      'paidUnfulfilledRecovered', all_components_ready
    )
  );
  return jsonb_build_object(
    'bookingId', booking_row.id,
    'liveSessionId', replacement.id,
    'reasonKind', reason_kind,
    'orderStatus', case
      when all_components_ready then 'paid'
      else order_row.status
    end,
    'replayed', false
  );
end
$$;
revoke all on function internal.change_b2c_live_session(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function internal.change_b2c_live_session(
  uuid, uuid, uuid
) to authenticated;
