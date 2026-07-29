create or replace function internal.read_own_order_history(
  requested_category text,
  row_limit integer,
  before_created_at timestamptz,
  before_order_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  actor uuid := internal.current_person_id();
  result jsonb;
begin
  if requested_category is null
     or requested_category not in (
       'all', 'action_required', 'reviewing', 'completed', 'closed_refund'
     )
  then
    raise exception 'ORDER_HISTORY_CATEGORY_INVALID';
  end if;
  if row_limit is null or row_limit not between 1 and 50 then
    raise exception 'ORDER_HISTORY_LIMIT_INVALID';
  end if;
  if (before_created_at is null) <> (before_order_id is null) then
    raise exception 'ORDER_HISTORY_CURSOR_INVALID';
  end if;

  with classified as materialized (
    select
      orders.*,
      case
        when exists (
          select 1
          from public.refund_cases refund_case
          where refund_case.order_id = orders.id
            and refund_case.status <> 'rejected'
        ) then 'closed_refund'
        when (
          case
            when orders.status = 'pending_transfer'
              and orders.transfer_due_at < now()
              then 'expired'
            else orders.status
          end
        ) in ('expired', 'cancelled', 'rejected') then 'closed_refund'
        when orders.status = 'paid' then 'completed'
        when orders.status in (
          'proof_submitted', 'payment_review', 'paid_unfulfilled'
        ) then 'reviewing'
        else 'action_required'
      end as display_category,
      case
        when orders.status = 'pending_transfer'
          and orders.transfer_due_at < now()
          then 'expired'
        else orders.status
      end as effective_status
    from public.orders orders
    where orders.person_id = actor
  ),
  filtered as materialized (
    select classified.*
    from classified
    where (
        requested_category = 'all'
        or classified.display_category = requested_category
      )
      and (
        before_created_at is null
        or (classified.created_at, classified.id)
          < (before_created_at, before_order_id)
      )
  ),
  paged as materialized (
    select filtered.*
    from filtered
    order by filtered.created_at desc, filtered.id desc
    limit row_limit + 1
  ),
  visible as materialized (
    select paged.*
    from paged
    order by paged.created_at desc, paged.id desc
    limit row_limit
  ),
  projected as materialized (
    select
      visible.created_at,
      visible.id,
      jsonb_build_object(
        'orderId', visible.id,
        'orderNumber', visible.order_number,
        'status', visible.status,
        'effectiveStatus', visible.effective_status,
        'displayCategory', visible.display_category,
        'paymentMethod', 'manual_bank_transfer',
        'amountDueTwd', visible.amount_due_twd,
        'amountPaidTwd', visible.amount_paid_twd,
        'transferDueAt', visible.transfer_due_at,
        'paidAt', visible.paid_at,
        'createdAt', visible.created_at,
        'items', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'courseVersionId', item.course_version_id,
              'courseSlug', course.slug,
              'courseTitle', item.title_snapshot,
              'deliveryType', version.delivery_type,
              'amountTwd', item.amount_twd,
              'hasCover',
                version.has_cover and version.status = 'published',
              'enrollmentId', enrollment.id,
              'enrollmentStatus', enrollment.status,
              'entitlementStatus', entitlement.status
            )
            order by item.created_at, item.id
          )
          from public.order_items item
          join public.course_versions version
            on version.id = item.course_version_id
          join public.courses course on course.id = version.course_id
          left join public.entitlements entitlement
            on entitlement.source_type = 'b2c_order'
           and entitlement.source_id = visible.id
           and entitlement.course_version_id = item.course_version_id
           and entitlement.person_id = actor
          left join public.enrollments enrollment
            on enrollment.entitlement_id = entitlement.id
           and enrollment.person_id = actor
          where item.order_id = visible.id
        ), '[]'::jsonb),
        'refundCases', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'refundCaseId', refund.id,
              'status', refund.status,
              'requestedAmountTwd', refund.requested_amount_twd,
              'disbursedAmountTwd', refund.disbursed_amount_twd,
              'submittedAt', refund.submitted_at,
              'decidedAt', refund.decided_at,
              'completedAt', refund.completed_at
            )
            order by refund.submitted_at desc, refund.id desc
          )
          from (
            select
              refund_case.id,
              refund_case.status,
              refund_case.submitted_at,
              refund_case.decided_at,
              coalesce((
                select sum(allocation.amount_twd)
                from public.refund_allocations allocation
                where allocation.refund_case_id = refund_case.id
              ), 0)::integer as requested_amount_twd,
              coalesce((
                select sum(disbursement.amount_twd)
                from public.refund_disbursements disbursement
                join public.refund_allocations allocation
                  on allocation.id = disbursement.refund_allocation_id
                where allocation.refund_case_id = refund_case.id
                  and disbursement.status = 'completed'
              ), 0)::integer as disbursed_amount_twd,
              (
                select max(disbursement.completed_at)
                from public.refund_disbursements disbursement
                join public.refund_allocations allocation
                  on allocation.id = disbursement.refund_allocation_id
                where allocation.refund_case_id = refund_case.id
                  and disbursement.status = 'completed'
              ) as completed_at
            from public.refund_cases refund_case
            where refund_case.order_id = visible.id
          ) refund
        ), '[]'::jsonb)
      ) as payload
    from visible
  )
  select jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(
        projected.payload
        order by projected.created_at desc, projected.id desc
      )
      from projected
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'all', (select count(*) from classified),
      'actionRequired', (
        select count(*) from classified
        where display_category = 'action_required'
      ),
      'reviewing', (
        select count(*) from classified
        where display_category = 'reviewing'
      ),
      'completed', (
        select count(*) from classified
        where display_category = 'completed'
      ),
      'closedRefund', (
        select count(*) from classified
        where display_category = 'closed_refund'
      )
    ),
    'hasMore', (select count(*) from paged) > row_limit,
    'nextCursor', case
      when (select count(*) from paged) > row_limit then (
        select jsonb_build_object(
          'createdAt', visible.created_at,
          'orderId', visible.id
        )
        from visible
        order by visible.created_at, visible.id
        limit 1
      )
      else null
    end
  )
  into result;

  return result;
end
$$;

revoke all on function internal.read_own_order_history(
  text, integer, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.read_own_order_history(
  text, integer, timestamptz, uuid
) to authenticated;

alter function internal.read_own_order(uuid)
  rename to read_own_order_without_refund_summary;
revoke all on function internal.read_own_order_without_refund_summary(uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.read_own_order_without_refund_summary(uuid)
  to authenticated;

create or replace function internal.read_own_order(target_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  actor uuid := internal.current_person_id();
  result jsonb;
  order_row public.orders%rowtype;
begin
  result := internal.read_own_order_without_refund_summary(target_order);
  select orders.* into order_row
  from public.orders orders
  where orders.id = target_order
    and orders.person_id = actor;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  return result || jsonb_build_object(
    'effectiveStatus', case
      when order_row.status = 'pending_transfer'
        and order_row.transfer_due_at < now()
        then 'expired'
      else order_row.status
    end,
    'subtotalTwd', order_row.amount_due_twd,
    'discountTwd', 0,
    'coupon', null,
    'refundCases', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'refundCaseId', refund.id,
          'status', refund.status,
          'requestedAmountTwd', refund.requested_amount_twd,
          'disbursedAmountTwd', refund.disbursed_amount_twd,
          'submittedAt', refund.submitted_at,
          'decidedAt', refund.decided_at,
          'completedAt', refund.completed_at
        )
        order by refund.submitted_at desc, refund.id desc
      )
      from (
        select
          refund_case.id,
          refund_case.status,
          refund_case.submitted_at,
          refund_case.decided_at,
          coalesce((
            select sum(allocation.amount_twd)
            from public.refund_allocations allocation
            where allocation.refund_case_id = refund_case.id
          ), 0)::integer as requested_amount_twd,
          coalesce((
            select sum(disbursement.amount_twd)
            from public.refund_disbursements disbursement
            join public.refund_allocations allocation
              on allocation.id = disbursement.refund_allocation_id
            where allocation.refund_case_id = refund_case.id
              and disbursement.status = 'completed'
          ), 0)::integer as disbursed_amount_twd,
          (
            select max(disbursement.completed_at)
            from public.refund_disbursements disbursement
            join public.refund_allocations allocation
              on allocation.id = disbursement.refund_allocation_id
            where allocation.refund_case_id = refund_case.id
              and disbursement.status = 'completed'
          ) as completed_at
        from public.refund_cases refund_case
        where refund_case.order_id = target_order
      ) refund
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function internal.read_own_order(uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.read_own_order(uuid)
  to authenticated;
