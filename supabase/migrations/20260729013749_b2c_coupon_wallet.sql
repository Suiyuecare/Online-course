create table public.coupon_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 2 and 120),
  description text not null check (length(trim(description)) between 2 and 500),
  benefit_kind text not null
    check (benefit_kind in ('percent_off', 'fixed_twd')),
  percent_off_bps integer
    check (percent_off_bps between 100 and 9900),
  fixed_discount_twd integer
    check (fixed_discount_twd > 0),
  max_discount_twd integer
    check (max_discount_twd is null or max_discount_twd > 0),
  minimum_subtotal_twd integer not null default 0
    check (minimum_subtotal_twd >= 0),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  total_claim_limit integer not null
    check (total_claim_limit between 1 and 1000000),
  total_redemption_limit integer not null
    check (total_redemption_limit between 1 and 1000000),
  scope_type text not null
    check (scope_type in ('all_b2c', 'specific_course_versions')),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'ended')),
  created_by uuid not null references public.people(id),
  approved_by uuid references public.people(id),
  approved_at timestamptz,
  ended_by uuid references public.people(id),
  ended_at timestamptz,
  creation_idempotency_key uuid not null,
  approval_idempotency_key uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (created_by, creation_idempotency_key),
  unique (approval_idempotency_key),
  check (valid_until > valid_from),
  check (total_redemption_limit <= total_claim_limit),
  check (
    (
      benefit_kind = 'percent_off'
      and percent_off_bps is not null
      and fixed_discount_twd is null
    )
    or (
      benefit_kind = 'fixed_twd'
      and percent_off_bps is null
      and fixed_discount_twd is not null
      and max_discount_twd is null
    )
  ),
  check (
    (approved_by is null and approved_at is null)
    or (
      approved_by is not null
      and approved_at is not null
      and approved_by <> created_by
    )
  ),
  check (
    (ended_by is null and ended_at is null)
    or (ended_by is not null and ended_at is not null)
  )
);

create table public.coupon_codes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.coupon_campaigns(id),
  code_sha256 text not null unique
    check (code_sha256 ~ '^[a-f0-9]{64}$'),
  code_hint text not null check (length(code_hint) between 4 and 12),
  created_by uuid not null references public.people(id),
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (campaign_id)
);

create table public.coupon_course_version_scopes (
  campaign_id uuid not null references public.coupon_campaigns(id),
  course_version_id uuid not null references public.course_versions(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key (campaign_id, course_version_id)
);

create table public.coupon_claims (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.coupon_campaigns(id),
  person_id uuid not null references public.people(id),
  source text not null check (source in ('code', 'staff_grant')),
  code_id uuid references public.coupon_codes(id),
  claim_idempotency_key uuid not null,
  claimed_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  unique (campaign_id, person_id),
  unique (person_id, claim_idempotency_key),
  unique (id, campaign_id, person_id),
  check (
    (source = 'code' and code_id is not null)
    or (source = 'staff_grant' and code_id is null)
  )
);

create table public.coupon_reservations (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null,
  campaign_id uuid not null,
  person_id uuid not null,
  order_id uuid not null unique references public.orders(id),
  status text not null default 'reserved'
    check (status in ('reserved', 'redeemed', 'released')),
  gross_twd integer not null check (gross_twd > 0),
  discount_twd integer not null check (discount_twd > 0),
  net_twd integer not null check (net_twd > 0),
  benefit_snapshot jsonb not null,
  allocation_snapshot jsonb not null,
  campaign_valid_until_snapshot timestamptz not null,
  reserved_at timestamptz not null default clock_timestamp(),
  redeemed_at timestamptz,
  released_at timestamptz,
  release_reason text,
  foreign key (claim_id, campaign_id, person_id)
    references public.coupon_claims(id, campaign_id, person_id),
  check (gross_twd - discount_twd = net_twd),
  check (discount_twd < gross_twd),
  check (
    (status = 'reserved' and redeemed_at is null and released_at is null)
    or (
      status = 'redeemed'
      and redeemed_at is not null
      and released_at is null
      and release_reason is null
    )
    or (
      status = 'released'
      and redeemed_at is null
      and released_at is not null
      and length(trim(release_reason)) >= 3
    )
  )
);

create table public.coupon_campaign_status_transitions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.coupon_campaigns(id),
  actor_person_id uuid not null references public.people(id),
  action text not null check (action in ('pause', 'resume', 'end')),
  previous_status text not null,
  next_status text not null,
  reason text not null check (length(trim(reason)) >= 10),
  idempotency_key uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  unique (actor_person_id, idempotency_key)
);

create unique index coupon_one_active_use_per_claim
  on public.coupon_reservations(claim_id)
  where status in ('reserved', 'redeemed');
create index coupon_claims_person_claimed_id_idx
  on public.coupon_claims(person_id, claimed_at desc, id desc);
create index coupon_reservations_campaign_status_idx
  on public.coupon_reservations(campaign_id, status);
create index coupon_reservations_person_campaign_status_idx
  on public.coupon_reservations(person_id, campaign_id, status);
create index coupon_campaigns_status_window_idx
  on public.coupon_campaigns(status, valid_from, valid_until);

alter table public.orders
  add column subtotal_twd integer;
update public.orders set subtotal_twd = amount_due_twd;
alter table public.orders
  alter column subtotal_twd set not null,
  add column discount_twd integer not null default 0;
alter table public.orders
  add constraint orders_coupon_amounts_check
  check (
    subtotal_twd > 0
    and discount_twd >= 0
    and discount_twd < subtotal_twd
    and subtotal_twd - discount_twd = amount_due_twd
  );

alter table public.coupon_campaigns enable row level security;
alter table public.coupon_campaigns force row level security;
alter table public.coupon_codes enable row level security;
alter table public.coupon_codes force row level security;
alter table public.coupon_course_version_scopes enable row level security;
alter table public.coupon_course_version_scopes force row level security;
alter table public.coupon_claims enable row level security;
alter table public.coupon_claims force row level security;
alter table public.coupon_reservations enable row level security;
alter table public.coupon_reservations force row level security;
alter table public.coupon_campaign_status_transitions
  enable row level security;
alter table public.coupon_campaign_status_transitions
  force row level security;

revoke all on table public.coupon_campaigns
  from public, anon, authenticated, service_role;
revoke all on table public.coupon_codes
  from public, anon, authenticated, service_role;
revoke all on table public.coupon_course_version_scopes
  from public, anon, authenticated, service_role;
revoke all on table public.coupon_claims
  from public, anon, authenticated, service_role;
revoke all on table public.coupon_reservations
  from public, anon, authenticated, service_role;
revoke all on table public.coupon_campaign_status_transitions
  from public, anon, authenticated, service_role;

create or replace function internal.coupon_normalized_code(submitted_code text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select upper(regexp_replace(trim(coalesce(submitted_code, '')), '\s+', '', 'g'))
$$;

create or replace function internal.coupon_discount_amount(
  submitted_benefit_kind text,
  submitted_percent_off_bps integer,
  submitted_fixed_discount_twd integer,
  submitted_max_discount_twd integer,
  submitted_subtotal_twd integer
)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select least(
    greatest(submitted_subtotal_twd - 1, 0),
    case
      when submitted_benefit_kind = 'percent_off' then least(
        floor(
          submitted_subtotal_twd::numeric
            * submitted_percent_off_bps::numeric / 10000
        )::integer,
        coalesce(submitted_max_discount_twd, submitted_subtotal_twd - 1)
      )
      when submitted_benefit_kind = 'fixed_twd'
        then submitted_fixed_discount_twd
      else 0
    end
  )
$$;

create or replace function internal.discounted_allocation_snapshot(
  original_snapshot jsonb,
  gross_twd integer,
  net_twd integer
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  result jsonb;
begin
  if gross_twd <= 0
     or net_twd <= 0
     or net_twd > gross_twd
     or jsonb_typeof(original_snapshot) <> 'object'
  then
    raise exception 'COUPON_ALLOCATION_INVALID';
  end if;

  with components as (
    select
      'recorded'::text as component_key,
      coalesce((original_snapshot ->> 'recorded')::integer, 0) as amount_twd
    union all
    select 'live:' || live.key, live.value::integer
    from jsonb_each_text(
      coalesce(original_snapshot -> 'live', '{}'::jsonb)
    ) live
  ),
  bases as (
    select
      component_key,
      amount_twd,
      floor(amount_twd::numeric * net_twd::numeric / gross_twd)::integer
        as base_twd,
      mod(amount_twd::bigint * net_twd::bigint, gross_twd::bigint)
        as remainder_rank
    from components
    where amount_twd > 0
  ),
  allocation as (
    select
      component_key,
      base_twd + case
        when row_number() over (
          order by remainder_rank desc, component_key
        ) <= net_twd - sum(base_twd) over ()
          then 1
        else 0
      end as amount_twd
    from bases
  )
  select jsonb_build_object(
    'recorded', coalesce((
      select amount_twd from allocation
      where component_key = 'recorded'
    ), 0),
    'live', coalesce((
      select jsonb_object_agg(
        substr(component_key, 6),
        amount_twd
        order by component_key
      )
      from allocation
      where component_key like 'live:%'
    ), '{}'::jsonb)
  )
  into result;

  if coalesce((result ->> 'recorded')::integer, 0)
     + coalesce((
       select sum(value::integer)
       from jsonb_each_text(result -> 'live')
     ), 0) <> net_twd
  then
    raise exception 'COUPON_ALLOCATION_TOTAL_MISMATCH';
  end if;
  return result;
end
$$;

revoke all on function internal.coupon_normalized_code(text)
  from public, anon, authenticated, service_role;
revoke all on function internal.coupon_discount_amount(
  text, integer, integer, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function internal.discounted_allocation_snapshot(
  jsonb, integer, integer
) from public, anon, authenticated, service_role;

create or replace function internal.guard_coupon_reservation_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.claim_id <> new.claim_id
     or old.campaign_id <> new.campaign_id
     or old.person_id <> new.person_id
     or old.order_id <> new.order_id
     or old.gross_twd <> new.gross_twd
     or old.discount_twd <> new.discount_twd
     or old.net_twd <> new.net_twd
     or old.benefit_snapshot <> new.benefit_snapshot
     or old.allocation_snapshot <> new.allocation_snapshot
     or old.campaign_valid_until_snapshot
        <> new.campaign_valid_until_snapshot
     or old.reserved_at <> new.reserved_at
  then
    raise exception 'COUPON_RESERVATION_IMMUTABLE';
  end if;
  if old.status <> 'reserved'
     or new.status not in ('redeemed', 'released')
  then
    raise exception 'COUPON_RESERVATION_TRANSITION_INVALID';
  end if;
  return new;
end
$$;

create trigger coupon_reservation_update_guard
before update on public.coupon_reservations
for each row execute function internal.guard_coupon_reservation_update();

create trigger coupon_reservation_delete_guard
before delete on public.coupon_reservations
for each row execute function internal.prevent_append_only_change();

create trigger coupon_claim_delete_guard
before update or delete on public.coupon_claims
for each row execute function internal.prevent_append_only_change();

create trigger coupon_code_delete_guard
before update or delete on public.coupon_codes
for each row execute function internal.prevent_append_only_change();

create trigger coupon_scope_delete_guard
before update or delete on public.coupon_course_version_scopes
for each row execute function internal.prevent_append_only_change();

create trigger coupon_campaign_status_transition_append_only
before update or delete on public.coupon_campaign_status_transitions
for each row execute function internal.prevent_append_only_change();

create or replace function internal.claim_coupon_code(
  submitted_code text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor uuid := internal.current_person_id();
  normalized_code text := internal.coupon_normalized_code(submitted_code);
  code_digest text;
  campaign_row public.coupon_campaigns%rowtype;
  code_row public.coupon_codes%rowtype;
  existing_claim public.coupon_claims%rowtype;
  claim_id uuid;
  current_claim_count integer;
begin
  if not internal.feature_is_open('b2c_commerce') then
    raise exception 'B2C_COMMERCE_CLOSED';
  end if;
  if idempotency is null
     or normalized_code !~ '^[A-Z0-9][A-Z0-9-]{2,30}[A-Z0-9]$'
  then
    raise exception 'COUPON_CODE_NOT_AVAILABLE';
  end if;
  code_digest := encode(
    extensions.digest(normalized_code, 'sha256'),
    'hex'
  );

  select claim.* into existing_claim
  from public.coupon_claims claim
  where claim.person_id = actor
    and claim.claim_idempotency_key = idempotency;
  if found then
    return jsonb_build_object(
      'claimId', existing_claim.id,
      'status', 'claimed',
      'alreadyClaimed', true
    );
  end if;

  select code.* into code_row
  from public.coupon_codes code
  where code.code_sha256 = code_digest
    and code.revoked_at is null;
  if not found then
    raise exception 'COUPON_CODE_NOT_AVAILABLE';
  end if;

  select campaign.* into campaign_row
  from public.coupon_campaigns campaign
  where campaign.id = code_row.campaign_id
  for update;
  if not found
     or campaign_row.status <> 'active'
     or clock_timestamp() < campaign_row.valid_from
     or clock_timestamp() >= campaign_row.valid_until
  then
    raise exception 'COUPON_CODE_NOT_AVAILABLE';
  end if;

  select claim.* into existing_claim
  from public.coupon_claims claim
  where claim.campaign_id = campaign_row.id
    and claim.person_id = actor;
  if found then
    return jsonb_build_object(
      'claimId', existing_claim.id,
      'status', 'claimed',
      'alreadyClaimed', true
    );
  end if;

  select count(*) into current_claim_count
  from public.coupon_claims claim
  where claim.campaign_id = campaign_row.id;
  if current_claim_count >= campaign_row.total_claim_limit then
    raise exception 'COUPON_CODE_NOT_AVAILABLE';
  end if;

  insert into public.coupon_claims (
    campaign_id,
    person_id,
    source,
    code_id,
    claim_idempotency_key
  ) values (
    campaign_row.id,
    actor,
    'code',
    code_row.id,
    idempotency
  )
  returning id into claim_id;

  perform internal.append_audit_event(
    actor,
    'coupon.claimed',
    'coupon_claim',
    claim_id::text,
    'learner claimed coupon code',
    null,
    jsonb_build_object('campaignId', campaign_row.id)
  );
  return jsonb_build_object(
    'claimId', claim_id,
    'status', 'claimed',
    'alreadyClaimed', false
  );
end
$$;

revoke all on function internal.claim_coupon_code(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.claim_coupon_code(text, uuid)
  to authenticated;

create or replace function public.claim_coupon_code(
  p_code text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.claim_coupon_code(p_code, p_idempotency_key)
$$;

revoke all on function public.claim_coupon_code(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_coupon_code(text, uuid)
  to authenticated;

create or replace function internal.read_my_coupons(
  requested_category text,
  row_limit integer,
  before_claimed_at timestamptz,
  before_claim_id uuid
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
       'available', 'reserved', 'used', 'expired'
     )
  then
    raise exception 'COUPON_CATEGORY_INVALID';
  end if;
  if row_limit is null or row_limit not between 1 and 50 then
    raise exception 'COUPON_LIMIT_INVALID';
  end if;
  if (before_claimed_at is null) <> (before_claim_id is null) then
    raise exception 'COUPON_CURSOR_INVALID';
  end if;

  with classified as materialized (
    select
      claim.id,
      claim.claimed_at,
      campaign.id as campaign_id,
      campaign.title,
      campaign.description,
      campaign.benefit_kind,
      campaign.percent_off_bps,
      campaign.fixed_discount_twd,
      campaign.max_discount_twd,
      campaign.minimum_subtotal_twd,
      campaign.valid_from,
      campaign.valid_until,
      campaign.scope_type,
      code.code_hint,
      reservation.id as reservation_id,
      reservation.order_id,
      reservation.status as reservation_status,
      reservation.discount_twd as reserved_discount_twd,
      reservation.net_twd as reserved_net_twd,
      reservation.redeemed_at,
      reservation.released_at,
      orders.order_number,
      orders.transfer_due_at,
      case
        when reservation.status = 'redeemed' then 'used'
        when reservation.status = 'reserved' then 'reserved'
        when claim.revoked_at is not null
          or campaign.status in ('draft', 'paused', 'ended')
          or now() < campaign.valid_from
          or now() >= campaign.valid_until
          then 'expired'
        else 'available'
      end as display_category
    from public.coupon_claims claim
    join public.coupon_campaigns campaign
      on campaign.id = claim.campaign_id
    left join public.coupon_codes code
      on code.id = claim.code_id
    left join lateral (
      select use.*
      from public.coupon_reservations use
      where use.claim_id = claim.id
        and use.status in ('reserved', 'redeemed')
      order by use.reserved_at desc, use.id desc
      limit 1
    ) reservation on true
    left join public.orders orders
      on orders.id = reservation.order_id
     and orders.person_id = actor
    where claim.person_id = actor
  ),
  filtered as materialized (
    select classified.*
    from classified
    where classified.display_category = requested_category
      and (
        before_claimed_at is null
        or (classified.claimed_at, classified.id)
          < (before_claimed_at, before_claim_id)
      )
  ),
  paged as materialized (
    select filtered.*
    from filtered
    order by filtered.claimed_at desc, filtered.id desc
    limit row_limit + 1
  ),
  visible as materialized (
    select paged.*
    from paged
    order by paged.claimed_at desc, paged.id desc
    limit row_limit
  )
  select jsonb_build_object(
    'coupons', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'claimId', visible.id,
          'campaignId', visible.campaign_id,
          'title', visible.title,
          'description', visible.description,
          'benefitKind', visible.benefit_kind,
          'percentOffBps', visible.percent_off_bps,
          'fixedDiscountTwd', visible.fixed_discount_twd,
          'maxDiscountTwd', visible.max_discount_twd,
          'minimumSubtotalTwd', visible.minimum_subtotal_twd,
          'validFrom', visible.valid_from,
          'validUntil', visible.valid_until,
          'scopeType', visible.scope_type,
          'codeHint', visible.code_hint,
          'status', visible.display_category,
          'claimedAt', visible.claimed_at,
          'reservation', case
            when visible.reservation_id is null then null
            else jsonb_build_object(
              'orderId', visible.order_id,
              'orderNumber', visible.order_number,
              'discountTwd', visible.reserved_discount_twd,
              'amountDueTwd', visible.reserved_net_twd,
              'transferDueAt', visible.transfer_due_at,
              'redeemedAt', visible.redeemed_at
            )
          end,
          'applicableCourses', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'courseVersionId', scope.course_version_id,
                'title', version.title,
                'slug', course.slug
              )
              order by version.title, scope.course_version_id
            )
            from public.coupon_course_version_scopes scope
            join public.course_versions version
              on version.id = scope.course_version_id
            join public.courses course on course.id = version.course_id
            where scope.campaign_id = visible.campaign_id
          ), '[]'::jsonb)
        )
        order by visible.claimed_at desc, visible.id desc
      )
      from visible
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'available', (
        select count(*) from classified where display_category = 'available'
      ),
      'reserved', (
        select count(*) from classified where display_category = 'reserved'
      ),
      'used', (
        select count(*) from classified where display_category = 'used'
      ),
      'expired', (
        select count(*) from classified where display_category = 'expired'
      )
    ),
    'hasMore', (select count(*) from paged) > row_limit,
    'nextCursor', case
      when (select count(*) from paged) > row_limit then (
        select jsonb_build_object(
          'claimedAt', visible.claimed_at,
          'claimId', visible.id
        )
        from visible
        order by visible.claimed_at, visible.id
        limit 1
      )
      else null
    end
  )
  into result;
  return result;
end
$$;

revoke all on function internal.read_my_coupons(
  text, integer, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.read_my_coupons(
  text, integer, timestamptz, uuid
) to authenticated;

create or replace function public.read_my_coupons(
  p_category text default 'available',
  p_limit integer default 12,
  p_before_claimed_at timestamptz default null,
  p_before_claim_id uuid default null
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_my_coupons(
    p_category,
    p_limit,
    p_before_claimed_at,
    p_before_claim_id
  )
$$;

revoke all on function public.read_my_coupons(
  text, integer, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.read_my_coupons(
  text, integer, timestamptz, uuid
) to authenticated;

create or replace function internal.coupon_quote_for_claim(
  target_person uuid,
  target_claim uuid,
  target_course_version uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  claim_row public.coupon_claims%rowtype;
  campaign_row public.coupon_campaigns%rowtype;
  version_row public.course_versions%rowtype;
  active_use public.coupon_reservations%rowtype;
  redemption_count integer;
  discount_amount integer;
  rejection_reason text;
begin
  select claim.* into claim_row
  from public.coupon_claims claim
  where claim.id = target_claim
    and claim.person_id = target_person;
  if not found then
    return jsonb_build_object('eligible', false, 'reason', 'not_available');
  end if;
  select campaign.* into campaign_row
  from public.coupon_campaigns campaign
  where campaign.id = claim_row.campaign_id;
  select version.* into version_row
  from public.course_versions version
  where version.id = target_course_version;
  select use.* into active_use
  from public.coupon_reservations use
  where use.claim_id = claim_row.id
    and use.status in ('reserved', 'redeemed')
  order by use.reserved_at desc, use.id desc
  limit 1;

  rejection_reason := case
    when campaign_row.id is null or version_row.id is null
      then 'not_available'
    when claim_row.revoked_at is not null
      then 'not_available'
    when active_use.id is not null
      then case
        when active_use.status = 'reserved'
          then 'already_reserved'
        else 'already_used'
      end
    when campaign_row.status <> 'active'
      then 'campaign_unavailable'
    when now() < campaign_row.valid_from
      then 'not_started'
    when now() >= campaign_row.valid_until
      then 'expired'
    when version_row.status <> 'published'
      or version_row.price_twd is null
      then 'course_unavailable'
    when version_row.price_twd < campaign_row.minimum_subtotal_twd
      then 'minimum_not_met'
    when campaign_row.scope_type = 'specific_course_versions'
      and not exists (
        select 1
        from public.coupon_course_version_scopes scope
        where scope.campaign_id = campaign_row.id
          and scope.course_version_id = version_row.id
      )
      then 'course_not_applicable'
    else null
  end;
  if rejection_reason is not null then
    return jsonb_build_object(
      'eligible', false,
      'reason', rejection_reason
    );
  end if;

  select count(*) into redemption_count
  from public.coupon_reservations use
  where use.campaign_id = campaign_row.id
    and use.status in ('reserved', 'redeemed');
  if redemption_count >= campaign_row.total_redemption_limit then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'redemption_limit_reached'
    );
  end if;

  discount_amount := internal.coupon_discount_amount(
    campaign_row.benefit_kind,
    campaign_row.percent_off_bps,
    campaign_row.fixed_discount_twd,
    campaign_row.max_discount_twd,
    version_row.price_twd
  );
  if discount_amount <= 0 then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'no_discount'
    );
  end if;

  return jsonb_build_object(
    'eligible', true,
    'reason', null,
    'claimId', claim_row.id,
    'campaignId', campaign_row.id,
    'title', campaign_row.title,
    'benefitKind', campaign_row.benefit_kind,
    'percentOffBps', campaign_row.percent_off_bps,
    'fixedDiscountTwd', campaign_row.fixed_discount_twd,
    'minimumSubtotalTwd', campaign_row.minimum_subtotal_twd,
    'validUntil', campaign_row.valid_until,
    'listPriceTwd', version_row.price_twd,
    'discountTwd', discount_amount,
    'amountDueTwd', version_row.price_twd - discount_amount
  );
end
$$;

revoke all on function internal.coupon_quote_for_claim(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function internal.read_checkout_coupon_options(
  target_course_version uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, internal
as $$
declare
  actor uuid := internal.current_person_id();
  result jsonb;
begin
  select coalesce(jsonb_agg(quote.payload order by
    (quote.payload ->> 'discountTwd')::integer desc,
    claim.claimed_at,
    claim.id
  ), '[]'::jsonb)
  into result
  from public.coupon_claims claim
  cross join lateral (
    select internal.coupon_quote_for_claim(
      actor,
      claim.id,
      target_course_version
    ) as payload
  ) quote
  where claim.person_id = actor
    and (quote.payload ->> 'eligible')::boolean;
  return result;
end
$$;

revoke all on function internal.read_checkout_coupon_options(uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.read_checkout_coupon_options(uuid)
  to authenticated;

create or replace function public.read_checkout_coupon_options(
  p_course_version_id uuid
)
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_checkout_coupon_options(p_course_version_id)
$$;

revoke all on function public.read_checkout_coupon_options(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_checkout_coupon_options(uuid)
  to authenticated;

create or replace function internal.sync_coupon_reservation_from_order()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  changed_reservation uuid;
  allocated_total integer;
begin
  if new.status in ('paid', 'paid_unfulfilled') then
    update public.coupon_reservations use
    set status = 'redeemed',
        redeemed_at = coalesce(new.paid_at, clock_timestamp())
    where use.order_id = new.id
      and use.status = 'reserved'
    returning use.id into changed_reservation;
    if changed_reservation is not null then
      perform internal.append_audit_event(
        null,
        'coupon.redeemed',
        'coupon_reservation',
        changed_reservation::text,
        'payment confirmed',
        null,
        jsonb_build_object('orderId', new.id)
      );
    end if;
  elsif new.status in ('expired', 'cancelled', 'rejected') then
    select coalesce(sum(
      case
        when allocation.allocation_kind = 'allocation'
          then allocation.amount_twd
        else -allocation.amount_twd
      end
    ), 0)::integer
    into allocated_total
    from public.bank_transaction_allocations allocation
    where allocation.order_id = new.id;
    if allocated_total = 0 then
      update public.coupon_reservations use
      set status = 'released',
          released_at = clock_timestamp(),
          release_reason = 'order_' || new.status
      where use.order_id = new.id
        and use.status = 'reserved'
      returning use.id into changed_reservation;
      if changed_reservation is not null then
        perform internal.append_audit_event(
          null,
          'coupon.released',
          'coupon_reservation',
          changed_reservation::text,
          'unpaid order closed',
          null,
          jsonb_build_object(
            'orderId', new.id,
            'orderStatus', new.status
          )
        );
      end if;
    end if;
  end if;
  return new;
end
$$;

create trigger orders_coupon_reservation_status_sync
after update of status on public.orders
for each row
when (old.status is distinct from new.status)
execute function internal.sync_coupon_reservation_from_order();

create or replace function internal.release_due_coupon_reservations(
  row_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target record;
  released_count integer := 0;
begin
  if row_limit is null or row_limit not between 1 and 5000 then
    raise exception 'COUPON_RELEASE_LIMIT_INVALID';
  end if;
  for target in
    select orders.id
    from public.orders orders
    join public.coupon_reservations use on use.order_id = orders.id
    where use.status = 'reserved'
      and orders.status = 'pending_transfer'
      and orders.transfer_due_at <= clock_timestamp()
      and not exists (
        select 1
        from public.bank_transaction_allocations allocation
        where allocation.order_id = orders.id
          and allocation.allocation_kind = 'allocation'
      )
    order by orders.transfer_due_at, orders.id
    limit row_limit
    for update of orders skip locked
  loop
    update public.orders
    set status = 'expired'
    where id = target.id
      and status = 'pending_transfer'
      and transfer_due_at <= clock_timestamp();
    if found then
      released_count := released_count + 1;
    end if;
  end loop;
  return released_count;
end
$$;

revoke all on function internal.release_due_coupon_reservations(integer)
  from public, anon, authenticated, service_role;
grant execute on function internal.release_due_coupon_reservations(integer)
  to service_role;

create or replace function public.release_due_coupon_reservations(
  p_limit integer default 500
)
returns integer
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.release_due_coupon_reservations(p_limit)
$$;

revoke all on function public.release_due_coupon_reservations(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.release_due_coupon_reservations(integer)
  to service_role;

create or replace function internal.create_b2c_order_with_coupon(
  course_version uuid,
  legal_acceptance uuid,
  live_selections jsonb,
  coupon_claim uuid,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  actor uuid := internal.current_person_id();
  existing_order public.orders%rowtype;
  existing_use public.coupon_reservations%rowtype;
  claim_row public.coupon_claims%rowtype;
  campaign_row public.coupon_campaigns%rowtype;
  version_row public.course_versions%rowtype;
  order_result jsonb;
  target_order uuid;
  quote jsonb;
  discount_amount integer;
  net_amount integer;
  original_allocation jsonb;
  net_allocation jsonb;
  reservation_id uuid;
begin
  if idempotency is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(actor::text || ':' || idempotency::text, 0)
  );

  select orders.* into existing_order
  from public.orders orders
  where orders.person_id = actor
    and orders.idempotency_key = idempotency;
  if found then
    select use.* into existing_use
    from public.coupon_reservations use
    where use.order_id = existing_order.id;
    if (
      coupon_claim is null
      and existing_use.id is null
    ) or (
      coupon_claim is not null
      and existing_use.claim_id = coupon_claim
    ) then
      return jsonb_build_object(
        'orderId', existing_order.id,
        'orderNumber', existing_order.order_number,
        'expiresAt', existing_order.transfer_due_at,
        'subtotalTwd', existing_order.subtotal_twd,
        'discountTwd', existing_order.discount_twd,
        'amountDueTwd', existing_order.amount_due_twd
      );
    end if;
    raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH';
  end if;

  if coupon_claim is null then
    order_result := internal.create_b2c_order(
      course_version,
      legal_acceptance,
      live_selections,
      idempotency
    );
    return order_result || jsonb_build_object(
      'subtotalTwd', (
        select orders.subtotal_twd
        from public.orders orders
        where orders.id = (order_result ->> 'orderId')::uuid
      ),
      'discountTwd', 0,
      'amountDueTwd', (
        select orders.amount_due_twd
        from public.orders orders
        where orders.id = (order_result ->> 'orderId')::uuid
      )
    );
  end if;

  perform internal.release_due_coupon_reservations(200);

  select claim.* into claim_row
  from public.coupon_claims claim
  where claim.id = coupon_claim
    and claim.person_id = actor
  for update;
  if not found or claim_row.revoked_at is not null then
    raise exception 'COUPON_NOT_AVAILABLE';
  end if;
  select campaign.* into campaign_row
  from public.coupon_campaigns campaign
  where campaign.id = claim_row.campaign_id
  for update;
  if not found then
    raise exception 'COUPON_NOT_AVAILABLE';
  end if;
  select version.* into version_row
  from public.course_versions version
  where version.id = course_version
  for share;
  if not found then
    raise exception 'COURSE_NOT_SELLABLE';
  end if;

  quote := internal.coupon_quote_for_claim(
    actor,
    claim_row.id,
    version_row.id
  );
  if not coalesce((quote ->> 'eligible')::boolean, false) then
    raise exception 'COUPON_NOT_AVAILABLE';
  end if;
  discount_amount := (quote ->> 'discountTwd')::integer;
  net_amount := (quote ->> 'amountDueTwd')::integer;
  original_allocation := jsonb_build_object(
    'recorded', version_row.recorded_refund_allocation_twd,
    'live', version_row.live_refund_allocations
  );
  net_allocation := internal.discounted_allocation_snapshot(
    original_allocation,
    version_row.price_twd,
    net_amount
  );

  order_result := internal.create_b2c_order(
    course_version,
    legal_acceptance,
    live_selections,
    idempotency
  );
  target_order := (order_result ->> 'orderId')::uuid;

  update public.orders
  set subtotal_twd = version_row.price_twd,
      discount_twd = discount_amount,
      amount_due_twd = net_amount,
      price_snapshot = price_snapshot || jsonb_build_object(
        'listPriceTwd', version_row.price_twd,
        'discountTwd', discount_amount,
        'netPriceTwd', net_amount,
        'couponCampaignId', campaign_row.id,
        'couponClaimId', claim_row.id,
        'couponTitle', campaign_row.title,
        'couponBenefit', jsonb_build_object(
          'kind', campaign_row.benefit_kind,
          'percentOffBps', campaign_row.percent_off_bps,
          'fixedDiscountTwd', campaign_row.fixed_discount_twd,
          'maxDiscountTwd', campaign_row.max_discount_twd,
          'minimumSubtotalTwd', campaign_row.minimum_subtotal_twd
        ),
        'netRefundAllocations', net_allocation
      )
  where id = target_order
    and person_id = actor
    and status = 'pending_transfer';
  if not found then
    raise exception 'COUPON_ORDER_UPDATE_REJECTED';
  end if;

  update public.order_items
  set amount_twd = net_amount,
      price_allocation_snapshot = net_allocation
  where order_id = target_order
    and course_version_id = version_row.id;
  update public.bank_payment_instructions
  set amount_twd = net_amount
  where order_id = target_order;

  insert into public.coupon_reservations (
    claim_id,
    campaign_id,
    person_id,
    order_id,
    gross_twd,
    discount_twd,
    net_twd,
    benefit_snapshot,
    allocation_snapshot,
    campaign_valid_until_snapshot
  ) values (
    claim_row.id,
    campaign_row.id,
    actor,
    target_order,
    version_row.price_twd,
    discount_amount,
    net_amount,
    jsonb_build_object(
      'title', campaign_row.title,
      'kind', campaign_row.benefit_kind,
      'percentOffBps', campaign_row.percent_off_bps,
      'fixedDiscountTwd', campaign_row.fixed_discount_twd,
      'maxDiscountTwd', campaign_row.max_discount_twd,
      'minimumSubtotalTwd', campaign_row.minimum_subtotal_twd
    ),
    net_allocation,
    campaign_row.valid_until
  )
  returning id into reservation_id;

  perform internal.append_audit_event(
    actor,
    'coupon.reserved',
    'coupon_reservation',
    reservation_id::text,
    'coupon reserved for manual-transfer order',
    null,
    jsonb_build_object(
      'orderId', target_order,
      'campaignId', campaign_row.id,
      'grossTwd', version_row.price_twd,
      'discountTwd', discount_amount,
      'netTwd', net_amount
    )
  );

  return order_result || jsonb_build_object(
    'subtotalTwd', version_row.price_twd,
    'discountTwd', discount_amount,
    'amountDueTwd', net_amount,
    'couponReservationId', reservation_id
  );
end
$$;

revoke all on function internal.create_b2c_order_with_coupon(
  uuid, uuid, jsonb, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.create_b2c_order_with_coupon(
  uuid, uuid, jsonb, uuid, uuid
) to authenticated;

create or replace function public.create_b2c_order_with_coupon(
  p_course_version_id uuid,
  p_legal_acceptance_id uuid,
  p_live_selections jsonb,
  p_coupon_claim_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.create_b2c_order_with_coupon(
    p_course_version_id,
    p_legal_acceptance_id,
    p_live_selections,
    p_coupon_claim_id,
    p_idempotency_key
  )
$$;

revoke all on function public.create_b2c_order_with_coupon(
  uuid, uuid, jsonb, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_b2c_order_with_coupon(
  uuid, uuid, jsonb, uuid, uuid
) to authenticated;

alter function internal.finalize_order_payment(uuid)
  rename to finalize_order_payment_without_coupon_late_guard;
revoke all on function
  internal.finalize_order_payment_without_coupon_late_guard(uuid)
  from public, anon, authenticated, service_role;

create or replace function internal.finalize_order_payment(target_order uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  order_row public.orders%rowtype;
  use_row public.coupon_reservations%rowtype;
  paid_total integer;
begin
  select orders.* into order_row
  from public.orders orders
  where orders.id = target_order
  for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  select use.* into use_row
  from public.coupon_reservations use
  where use.order_id = target_order;
  if use_row.id is null or use_row.status <> 'released' then
    return internal.finalize_order_payment_without_coupon_late_guard(
      target_order
    );
  end if;

  select coalesce(sum(
    case
      when allocation.allocation_kind = 'allocation'
        then allocation.amount_twd
      else -allocation.amount_twd
    end
  ), 0)::integer
  into paid_total
  from public.bank_transaction_allocations allocation
  where allocation.order_id = target_order;
  if paid_total <> order_row.amount_due_twd then
    return internal.finalize_order_payment_without_coupon_late_guard(
      target_order
    );
  end if;

  update public.orders
  set status = 'paid_unfulfilled',
      amount_paid_twd = paid_total,
      paid_at = clock_timestamp()
  where id = order_row.id;
  insert into public.payment_events (
    order_id,
    event_type,
    amount_twd,
    actor_id,
    event_data
  ) values (
    order_row.id,
    'payment_confirmed',
    paid_total,
    internal.current_person_id(),
    jsonb_build_object(
      'fulfillmentStatus', 'paid_unfulfilled',
      'reason', 'coupon_reservation_released_before_late_payment'
    )
  );
  insert into public.reconciliation_cases (
    kind,
    order_id,
    status,
    reason
  ) values (
    'late_payment',
    order_row.id,
    'open',
    'payment arrived after the coupon reservation was released'
  );
  insert into public.invoice_records (order_id, amount_twd)
  values (order_row.id, paid_total)
  on conflict do nothing;
  insert into public.notifications (
    person_id,
    category,
    title,
    body,
    business_key
  ) values (
    order_row.person_id,
    'payment',
    '匯款已確認，待人工處理',
    '款項在折扣券保留已釋放後才入帳；客服將協助退款或重新確認優惠，不會自動開課。',
    'order-paid-unfulfilled-coupon:' || order_row.id::text
  )
  on conflict (person_id, business_key) do nothing;
  return 'paid_unfulfilled';
end
$$;

revoke all on function internal.finalize_order_payment(uuid)
  from public, anon, authenticated, service_role;

create or replace function internal.create_coupon_campaign(
  submitted_title text,
  submitted_description text,
  submitted_code text,
  submitted_benefit_kind text,
  submitted_percent_off_bps integer,
  submitted_fixed_discount_twd integer,
  submitted_max_discount_twd integer,
  submitted_minimum_subtotal_twd integer,
  submitted_valid_from timestamptz,
  submitted_valid_until timestamptz,
  submitted_total_claim_limit integer,
  submitted_total_redemption_limit integer,
  submitted_course_version_ids jsonb,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal, extensions
as $$
declare
  actor uuid := internal.current_person_id();
  normalized_code text := internal.coupon_normalized_code(submitted_code);
  campaign_id uuid;
  existing public.coupon_campaigns%rowtype;
  scope_count integer;
begin
  if not internal.has_exact_staff_role('platform_admin') then
    raise exception 'COUPON_ADMIN_FORBIDDEN';
  end if;
  select campaign.* into existing
  from public.coupon_campaigns campaign
  where campaign.created_by = actor
    and campaign.creation_idempotency_key = idempotency;
  if found then
    return jsonb_build_object(
      'campaignId', existing.id,
      'status', existing.status,
      'couponCode', null,
      'replayed', true
    );
  end if;
  if idempotency is null
     or length(trim(coalesce(submitted_title, ''))) not between 2 and 120
     or length(trim(coalesce(submitted_description, '')))
        not between 2 and 500
     or normalized_code !~ '^[A-Z0-9][A-Z0-9-]{2,30}[A-Z0-9]$'
     or submitted_benefit_kind not in ('percent_off', 'fixed_twd')
     or submitted_minimum_subtotal_twd < 0
     or submitted_valid_until <= greatest(
       submitted_valid_from,
       clock_timestamp()
     )
     or submitted_total_claim_limit not between 1 and 1000000
     or submitted_total_redemption_limit not between 1
       and submitted_total_claim_limit
     or jsonb_typeof(submitted_course_version_ids) <> 'array'
     or jsonb_array_length(submitted_course_version_ids) > 100
     or (
       submitted_benefit_kind = 'percent_off'
       and (
         submitted_percent_off_bps not between 100 and 9900
         or submitted_fixed_discount_twd is not null
         or (
           submitted_max_discount_twd is not null
           and submitted_max_discount_twd <= 0
         )
       )
     )
     or (
       submitted_benefit_kind = 'fixed_twd'
       and (
         submitted_fixed_discount_twd is null
         or submitted_fixed_discount_twd <= 0
         or submitted_percent_off_bps is not null
         or submitted_max_discount_twd is not null
       )
     )
  then
    raise exception 'COUPON_CAMPAIGN_INVALID';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(submitted_course_version_ids) item
    where item.value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'COUPON_COURSE_SCOPE_INVALID';
  end if;
  select count(distinct item.value) into scope_count
  from jsonb_array_elements_text(submitted_course_version_ids) item;
  if scope_count <> jsonb_array_length(submitted_course_version_ids)
     or exists (
       select 1
       from jsonb_array_elements_text(submitted_course_version_ids) item
       left join public.course_versions version
         on version.id = item.value::uuid
       where version.id is null
     )
  then
    raise exception 'COUPON_COURSE_SCOPE_INVALID';
  end if;

  insert into public.coupon_campaigns (
    title,
    description,
    benefit_kind,
    percent_off_bps,
    fixed_discount_twd,
    max_discount_twd,
    minimum_subtotal_twd,
    valid_from,
    valid_until,
    total_claim_limit,
    total_redemption_limit,
    scope_type,
    created_by,
    creation_idempotency_key
  ) values (
    trim(submitted_title),
    trim(submitted_description),
    submitted_benefit_kind,
    submitted_percent_off_bps,
    submitted_fixed_discount_twd,
    submitted_max_discount_twd,
    submitted_minimum_subtotal_twd,
    submitted_valid_from,
    submitted_valid_until,
    submitted_total_claim_limit,
    submitted_total_redemption_limit,
    case
      when scope_count = 0 then 'all_b2c'
      else 'specific_course_versions'
    end,
    actor,
    idempotency
  )
  returning id into campaign_id;

  insert into public.coupon_codes (
    campaign_id,
    code_sha256,
    code_hint,
    created_by
  ) values (
    campaign_id,
    encode(extensions.digest(normalized_code, 'sha256'), 'hex'),
    left(normalized_code, 2) || '••••' || right(normalized_code, 2),
    actor
  );

  insert into public.coupon_course_version_scopes (
    campaign_id,
    course_version_id
  )
  select campaign_id, item.value::uuid
  from jsonb_array_elements_text(submitted_course_version_ids) item;

  perform internal.append_audit_event(
    actor,
    'coupon.campaign_created',
    'coupon_campaign',
    campaign_id::text,
    'draft campaign created',
    null,
    jsonb_build_object(
      'benefitKind', submitted_benefit_kind,
      'courseScopeCount', scope_count,
      'claimLimit', submitted_total_claim_limit,
      'redemptionLimit', submitted_total_redemption_limit
    )
  );
  return jsonb_build_object(
    'campaignId', campaign_id,
    'status', 'draft',
    'couponCode', normalized_code,
    'replayed', false
  );
end
$$;

revoke all on function internal.create_coupon_campaign(
  text, text, text, text, integer, integer, integer, integer,
  timestamptz, timestamptz, integer, integer, jsonb, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.create_coupon_campaign(
  text, text, text, text, integer, integer, integer, integer,
  timestamptz, timestamptz, integer, integer, jsonb, uuid
) to authenticated;

create or replace function public.create_coupon_campaign(
  p_title text,
  p_description text,
  p_code text,
  p_benefit_kind text,
  p_percent_off_bps integer,
  p_fixed_discount_twd integer,
  p_max_discount_twd integer,
  p_minimum_subtotal_twd integer,
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_total_claim_limit integer,
  p_total_redemption_limit integer,
  p_course_version_ids jsonb,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.create_coupon_campaign(
    p_title,
    p_description,
    p_code,
    p_benefit_kind,
    p_percent_off_bps,
    p_fixed_discount_twd,
    p_max_discount_twd,
    p_minimum_subtotal_twd,
    p_valid_from,
    p_valid_until,
    p_total_claim_limit,
    p_total_redemption_limit,
    p_course_version_ids,
    p_idempotency_key
  )
$$;

revoke all on function public.create_coupon_campaign(
  text, text, text, text, integer, integer, integer, integer,
  timestamptz, timestamptz, integer, integer, jsonb, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_coupon_campaign(
  text, text, text, text, integer, integer, integer, integer,
  timestamptz, timestamptz, integer, integer, jsonb, uuid
) to authenticated;

create or replace function internal.approve_coupon_campaign(
  target_campaign uuid,
  submitted_reason text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  actor uuid := internal.current_person_id();
  campaign_row public.coupon_campaigns%rowtype;
begin
  if not internal.has_exact_staff_role('finance')
     or length(trim(coalesce(submitted_reason, ''))) < 10
     or idempotency is null
  then
    raise exception 'COUPON_APPROVAL_FORBIDDEN';
  end if;
  select campaign.* into campaign_row
  from public.coupon_campaigns campaign
  where campaign.id = target_campaign
  for update;
  if not found then
    raise exception 'COUPON_CAMPAIGN_NOT_FOUND';
  end if;
  if campaign_row.approval_idempotency_key = idempotency
     and campaign_row.status = 'active'
  then
    return jsonb_build_object(
      'campaignId', campaign_row.id,
      'status', campaign_row.status
    );
  end if;
  if campaign_row.status <> 'draft'
     or campaign_row.created_by = actor
     or campaign_row.valid_until <= clock_timestamp()
     or campaign_row.approved_by is not null
  then
    raise exception 'COUPON_APPROVAL_REJECTED';
  end if;
  if (
    campaign_row.scope_type = 'specific_course_versions'
    and not exists (
      select 1
      from public.coupon_course_version_scopes scope
      where scope.campaign_id = campaign_row.id
    )
  ) or (
    campaign_row.scope_type = 'all_b2c'
    and exists (
      select 1
      from public.coupon_course_version_scopes scope
      where scope.campaign_id = campaign_row.id
    )
  ) then
    raise exception 'COUPON_COURSE_SCOPE_INVALID';
  end if;

  update public.coupon_campaigns
  set status = 'active',
      approved_by = actor,
      approved_at = clock_timestamp(),
      approval_idempotency_key = idempotency,
      updated_at = clock_timestamp()
  where id = campaign_row.id;
  perform internal.append_audit_event(
    actor,
    'coupon.campaign_approved',
    'coupon_campaign',
    campaign_row.id::text,
    trim(submitted_reason),
    null,
    jsonb_build_object('createdBy', campaign_row.created_by)
  );
  return jsonb_build_object(
    'campaignId', campaign_row.id,
    'status', 'active'
  );
end
$$;

revoke all on function internal.approve_coupon_campaign(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.approve_coupon_campaign(uuid, text, uuid)
  to authenticated;

create or replace function public.approve_coupon_campaign(
  p_campaign_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.approve_coupon_campaign(
    p_campaign_id,
    p_reason,
    p_idempotency_key
  )
$$;

revoke all on function public.approve_coupon_campaign(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.approve_coupon_campaign(uuid, text, uuid)
  to authenticated;

create or replace function internal.change_coupon_campaign_status(
  target_campaign uuid,
  submitted_action text,
  submitted_reason text,
  idempotency uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal
as $$
declare
  actor uuid := internal.current_person_id();
  campaign_row public.coupon_campaigns%rowtype;
  existing_transition public.coupon_campaign_status_transitions%rowtype;
  next_status text;
begin
  if not internal.has_exact_staff_role('platform_admin')
     or submitted_action not in ('pause', 'resume', 'end')
     or length(trim(coalesce(submitted_reason, ''))) < 10
     or idempotency is null
  then
    raise exception 'COUPON_STATUS_CHANGE_FORBIDDEN';
  end if;
  select transition.* into existing_transition
  from public.coupon_campaign_status_transitions transition
  where transition.actor_person_id = actor
    and transition.idempotency_key = idempotency;
  if found then
    if existing_transition.campaign_id <> target_campaign
       or existing_transition.action <> submitted_action
    then
      raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH';
    end if;
    return jsonb_build_object(
      'campaignId', existing_transition.campaign_id,
      'status', existing_transition.next_status
    );
  end if;
  select campaign.* into campaign_row
  from public.coupon_campaigns campaign
  where campaign.id = target_campaign
  for update;
  if not found then
    raise exception 'COUPON_CAMPAIGN_NOT_FOUND';
  end if;
  next_status := case
    when submitted_action = 'pause' and campaign_row.status = 'active'
      then 'paused'
    when submitted_action = 'resume'
      and campaign_row.status = 'paused'
      and campaign_row.valid_until > clock_timestamp()
      then 'active'
    when submitted_action = 'end'
      and campaign_row.status in ('draft', 'active', 'paused')
      then 'ended'
    else null
  end;
  if next_status is null then
    raise exception 'COUPON_STATUS_TRANSITION_INVALID';
  end if;
  update public.coupon_campaigns
  set status = next_status,
      ended_by = case when next_status = 'ended' then actor else ended_by end,
      ended_at = case
        when next_status = 'ended' then clock_timestamp()
        else ended_at
      end,
      updated_at = clock_timestamp()
  where id = campaign_row.id;
  insert into public.coupon_campaign_status_transitions (
    campaign_id,
    actor_person_id,
    action,
    previous_status,
    next_status,
    reason,
    idempotency_key
  ) values (
    campaign_row.id,
    actor,
    submitted_action,
    campaign_row.status,
    next_status,
    trim(submitted_reason),
    idempotency
  );
  perform internal.append_audit_event(
    actor,
    'coupon.campaign_' || submitted_action,
    'coupon_campaign',
    campaign_row.id::text,
    trim(submitted_reason),
    null,
    jsonb_build_object(
      'previousStatus', campaign_row.status,
      'nextStatus', next_status
    )
  );
  return jsonb_build_object(
    'campaignId', campaign_row.id,
    'status', next_status
  );
end
$$;

revoke all on function internal.change_coupon_campaign_status(
  uuid, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.change_coupon_campaign_status(
  uuid, text, text, uuid
) to authenticated;

create or replace function public.change_coupon_campaign_status(
  p_campaign_id uuid,
  p_action text,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, internal
as $$
  select internal.change_coupon_campaign_status(
    p_campaign_id,
    p_action,
    p_reason,
    p_idempotency_key
  )
$$;

revoke all on function public.change_coupon_campaign_status(
  uuid, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.change_coupon_campaign_status(
  uuid, text, text, uuid
) to authenticated;

create or replace function internal.read_coupon_admin_workspace()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, internal
as $$
declare
  result jsonb;
begin
  if not (
    internal.has_exact_staff_role('platform_admin')
    or internal.has_exact_staff_role('finance')
  ) then
    raise exception 'COUPON_ADMIN_FORBIDDEN';
  end if;
  select jsonb_build_object(
    'campaigns', coalesce(jsonb_agg(
      jsonb_build_object(
        'campaignId', campaign.id,
        'title', campaign.title,
        'description', campaign.description,
        'status', campaign.status,
        'benefitKind', campaign.benefit_kind,
        'percentOffBps', campaign.percent_off_bps,
        'fixedDiscountTwd', campaign.fixed_discount_twd,
        'maxDiscountTwd', campaign.max_discount_twd,
        'minimumSubtotalTwd', campaign.minimum_subtotal_twd,
        'validFrom', campaign.valid_from,
        'validUntil', campaign.valid_until,
        'totalClaimLimit', campaign.total_claim_limit,
        'totalRedemptionLimit', campaign.total_redemption_limit,
        'scopeType', campaign.scope_type,
        'codeHint', code.code_hint,
        'createdAt', campaign.created_at,
        'createdByMe', campaign.created_by = internal.request_person_id(),
        'claimCount', (
          select count(*)
          from public.coupon_claims claim
          where claim.campaign_id = campaign.id
        ),
        'reservedCount', (
          select count(*)
          from public.coupon_reservations use
          where use.campaign_id = campaign.id
            and use.status = 'reserved'
        ),
        'redeemedCount', (
          select count(*)
          from public.coupon_reservations use
          where use.campaign_id = campaign.id
            and use.status = 'redeemed'
        ),
        'courses', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'courseVersionId', scope.course_version_id,
              'title', version.title
            )
            order by version.title, scope.course_version_id
          )
          from public.coupon_course_version_scopes scope
          join public.course_versions version
            on version.id = scope.course_version_id
          where scope.campaign_id = campaign.id
        ), '[]'::jsonb)
      )
      order by campaign.created_at desc, campaign.id desc
    ), '[]'::jsonb),
    'courseOptions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'courseVersionId', version.id,
          'title', version.title,
          'status', version.status
        )
        order by version.title, version.id
      )
      from public.course_versions version
      where version.status in ('published', 'sale_stopped')
    ), '[]'::jsonb)
  )
  into result
  from public.coupon_campaigns campaign
  join public.coupon_codes code on code.campaign_id = campaign.id;
  return result;
end
$$;

revoke all on function internal.read_coupon_admin_workspace()
  from public, anon, authenticated, service_role;
grant execute on function internal.read_coupon_admin_workspace()
  to authenticated;

create or replace function public.read_coupon_admin_workspace()
returns jsonb
language sql
security invoker
stable
set search_path = pg_catalog, public, internal
as $$
  select internal.read_coupon_admin_workspace()
$$;

revoke all on function public.read_coupon_admin_workspace()
  from public, anon, authenticated, service_role;
grant execute on function public.read_coupon_admin_workspace()
  to authenticated;

alter function internal.read_own_order_history(
  text, integer, timestamptz, uuid
) rename to read_own_order_history_without_coupon_summary;
revoke all on function internal.read_own_order_history_without_coupon_summary(
  text, integer, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.read_own_order_history_without_coupon_summary(
  text, integer, timestamptz, uuid
) to authenticated;

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
set search_path = pg_catalog, public, internal
as $$
declare
  actor uuid := internal.current_person_id();
  base jsonb;
  enriched_orders jsonb;
begin
  base := internal.read_own_order_history_without_coupon_summary(
    requested_category,
    row_limit,
    before_created_at,
    before_order_id
  );
  select coalesce(jsonb_agg(
    listed.payload || jsonb_build_object(
      'subtotalTwd', orders.subtotal_twd,
      'discountTwd', orders.discount_twd,
      'coupon', case
        when use.id is null then null
        else jsonb_build_object(
          'title', use.benefit_snapshot ->> 'title',
          'status', use.status,
          'discountTwd', use.discount_twd
        )
      end
    )
    order by listed.ordinality
  ), '[]'::jsonb)
  into enriched_orders
  from jsonb_array_elements(base -> 'orders')
    with ordinality listed(payload, ordinality)
  join public.orders orders
    on orders.id = (listed.payload ->> 'orderId')::uuid
   and orders.person_id = actor
  left join public.coupon_reservations use
    on use.order_id = orders.id;
  return jsonb_set(base, '{orders}', enriched_orders, true);
end
$$;

revoke all on function internal.read_own_order_history(
  text, integer, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function internal.read_own_order_history(
  text, integer, timestamptz, uuid
) to authenticated;

alter function internal.read_own_order(uuid)
  rename to read_own_order_without_coupon_summary;
revoke all on function internal.read_own_order_without_coupon_summary(uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.read_own_order_without_coupon_summary(uuid)
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
  use_row public.coupon_reservations%rowtype;
begin
  result := internal.read_own_order_without_coupon_summary(target_order);
  select orders.* into order_row
  from public.orders orders
  where orders.id = target_order
    and orders.person_id = actor;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  select use.* into use_row
  from public.coupon_reservations use
  where use.order_id = target_order
    and use.person_id = actor;

  return result || jsonb_build_object(
    'subtotalTwd', order_row.subtotal_twd,
    'discountTwd', order_row.discount_twd,
    'coupon', case
      when use_row.id is null then null
      else jsonb_build_object(
        'title', use_row.benefit_snapshot ->> 'title',
        'status', use_row.status,
        'discountTwd', use_row.discount_twd
      )
    end
  );
end
$$;

revoke all on function internal.read_own_order(uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.read_own_order(uuid)
  to authenticated;
