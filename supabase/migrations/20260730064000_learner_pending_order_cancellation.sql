-- A learner may withdraw an unpaid manual-transfer order while it is still
-- This forward migration is ordered after the complete pre-launch schema chain.
-- waiting for payment. The transition is serialized with finance allocation
-- by locking the order row, releases any held live seats, lets the existing
-- coupon trigger release a reserved coupon, and restores the course to the
-- account-backed cart when capacity permits. Financial and payment evidence is
-- retained; nothing is deleted.

alter table public.orders
  add column learner_cancel_idempotency_key uuid;

create unique index orders_learner_cancel_idempotency_idx
  on public.orders(person_id, learner_cancel_idempotency_key)
  where learner_cancel_idempotency_key is not null;

alter table public.orders
  add constraint orders_learner_cancel_state_check
  check (
    learner_cancel_idempotency_key is null
    or status = 'cancelled'
  );

create or replace function internal.cancel_own_pending_transfer_order(
  target_order uuid,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  actor uuid := internal.current_person_id();
  order_row public.orders%rowtype;
  target_course_version uuid;
  released_booking_count integer := 0;
  cart_restored boolean := false;
  coupon_released boolean := false;
begin
  if target_order is null or idempotency is null then
    raise exception 'ORDER_CANCELLATION_INPUT_REQUIRED';
  end if;

  -- Match the lock used by account-cart mutations before taking the order
  -- lock. This keeps the 100-item cart cap exact across devices.
  perform 1
  from public.people person
  where person.id = actor
  for update;
  if not found then
    raise exception 'ACTIVE_PERSON_REQUIRED';
  end if;

  select orders.* into order_row
  from public.orders orders
  where orders.id = target_order
    and orders.person_id = actor
  for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if order_row.status = 'cancelled'
     and order_row.learner_cancel_idempotency_key = idempotency
  then
    return jsonb_build_object(
      'orderId', order_row.id,
      'status', 'cancelled',
      'replayed', true
    );
  end if;

  if order_row.status <> 'pending_transfer'
     or order_row.amount_paid_twd <> 0
     or order_row.learner_cancel_idempotency_key is not null
     or exists (
       select 1
       from public.payment_proofs proof
       where proof.order_id = order_row.id
     )
     or exists (
       select 1
       from public.bank_transaction_allocations allocation
       where allocation.order_id = order_row.id
     )
  then
    raise exception 'ORDER_CANCELLATION_NOT_AVAILABLE';
  end if;

  if exists (
    select 1
    from public.live_bookings booking
    where booking.payer_type = 'b2c'
      and booking.payer_source_id = order_row.id
      and booking.status not in ('held', 'released')
  ) then
    raise exception 'ORDER_CANCELLATION_NOT_AVAILABLE';
  end if;

  update public.live_bookings booking
  set status = 'released',
      hold_expires_at = null
  where booking.payer_type = 'b2c'
    and booking.payer_source_id = order_row.id
    and booking.status = 'held';
  get diagnostics released_booking_count = row_count;

  update public.orders orders
  set status = 'cancelled',
      learner_cancel_idempotency_key = idempotency
  where orders.id = order_row.id
    and orders.status = 'pending_transfer';
  if not found then
    raise exception 'ORDER_CANCELLATION_VERSION_CONFLICT';
  end if;

  select item.course_version_id into target_course_version
  from public.order_items item
  where item.order_id = order_row.id
  order by item.created_at, item.id
  limit 1;

  if target_course_version is not null
     and exists (
       select 1
       from public.published_course_catalog catalog
       where catalog.course_version_id = target_course_version
     )
     and (
       exists (
         select 1
         from public.learner_cart_items cart
         where cart.person_id = actor
           and cart.course_version_id = target_course_version
       )
       or (
         select count(*)
         from public.learner_cart_items cart
         where cart.person_id = actor
       ) < 100
     )
  then
    insert into public.learner_cart_items (
      person_id,
      course_version_id
    ) values (
      actor,
      target_course_version
    )
    on conflict (person_id, course_version_id) do nothing;
    cart_restored := true;
  end if;

  select exists (
    select 1
    from public.coupon_reservations reservation
    where reservation.order_id = order_row.id
      and reservation.status = 'released'
  ) into coupon_released;

  insert into public.notifications (
    person_id,
    category,
    title,
    body,
    business_key
  ) values (
    actor,
    'payment',
    '待匯款訂單已取消',
    case
      when cart_restored
        then '訂單已取消，尚未使用的折扣券與直播保留位已釋放；課程已放回購物車。'
      else '訂單已取消，尚未使用的折扣券與直播保留位已釋放。'
    end,
    'order-cancelled-by-learner:' || order_row.id::text
  )
  on conflict (person_id, business_key) do nothing;

  perform internal.append_audit_event(
    actor,
    'order.cancelled_by_learner',
    'order',
    order_row.id::text,
    'learner cancelled unpaid pending-transfer order',
    null,
    jsonb_build_object(
      'idempotencyKey', idempotency,
      'releasedLiveBookingCount', released_booking_count,
      'couponReleased', coupon_released,
      'cartRestored', cart_restored
    )
  );

  return jsonb_build_object(
    'orderId', order_row.id,
    'status', 'cancelled',
    'replayed', false,
    'releasedLiveBookingCount', released_booking_count,
    'couponReleased', coupon_released,
    'cartRestored', cart_restored
  );
end
$$;

revoke all on function internal.cancel_own_pending_transfer_order(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.cancel_own_pending_transfer_order(
  p_order_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, internal
as $$
  select internal.cancel_own_pending_transfer_order(
    p_order_id,
    p_idempotency_key
  )
$$;

revoke all on function public.cancel_own_pending_transfer_order(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function internal.cancel_own_pending_transfer_order(uuid, uuid)
  to authenticated;
grant execute on function public.cancel_own_pending_transfer_order(uuid, uuid)
  to authenticated;
