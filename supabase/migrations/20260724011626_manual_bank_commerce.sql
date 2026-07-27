create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  person_id uuid not null references public.people(id),
  legal_acceptance_id uuid not null references public.legal_acceptances(id),
  status text not null default 'pending_transfer'
    check (status in (
      'contract_review', 'pending_transfer', 'proof_submitted', 'payment_review',
      'paid', 'paid_unfulfilled', 'rejected', 'cancelled', 'expired'
    )),
  amount_due_twd integer not null check (amount_due_twd > 0),
  amount_paid_twd integer not null default 0 check (amount_paid_twd >= 0),
  currency text not null default 'TWD' check (currency = 'TWD'),
  accreditation_disclosure_snapshot text not null,
  price_snapshot jsonb not null,
  transfer_due_at timestamptz not null,
  paid_at timestamptz,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (person_id, idempotency_key),
  check (amount_paid_twd <= amount_due_twd)
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  course_version_id uuid not null references public.course_versions(id),
  scope_type text not null check (scope_type in ('recorded', 'live_component', 'whole_course')),
  scope_id uuid,
  title_snapshot text not null,
  amount_twd integer not null check (amount_twd >= 0),
  price_allocation_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (order_id, course_version_id, scope_type, scope_id)
);

create table public.bank_payment_instructions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique references public.orders(id),
  bank_name_snapshot text not null,
  bank_code_snapshot text not null,
  account_name_snapshot text not null,
  account_number_snapshot text not null,
  masked_account_snapshot text not null,
  amount_twd integer not null check (amount_twd > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id),
  submitted_by uuid not null references public.people(id),
  remitter_name text not null,
  bank_name text not null,
  account_last_five text not null check (account_last_five ~ '^[0-9]{5}$'),
  transferred_at timestamptz not null,
  amount_twd integer not null check (amount_twd > 0),
  quarantine_object_path text,
  promoted_object_path text,
  content_sha256 text unique check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  content_fingerprint text unique,
  scan_status text not null default 'not_provided'
    check (scan_status in ('not_provided', 'quarantined', 'scanning', 'safe', 'rejected', 'failed')),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (submitted_by, idempotency_key)
);

create table public.bank_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_sha256 text not null unique check (source_sha256 ~ '^[a-f0-9]{64}$'),
  attachment_reference text not null,
  booked_on date not null,
  imported_by uuid not null references public.people(id),
  reconciled_by uuid references public.people(id),
  reconciled_at timestamptz,
  bank_total_twd integer not null check (bank_total_twd >= 0),
  created_at timestamptz not null default now(),
  check (reconciled_by is null or reconciled_by <> imported_by)
);

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.bank_import_batches(id),
  bank_fingerprint text not null unique,
  booked_on date not null,
  remitter_name text not null,
  account_last_five text check (account_last_five is null or account_last_five ~ '^[0-9]{5}$'),
  amount_twd integer not null check (amount_twd > 0),
  bank_reference text not null,
  created_by uuid not null references public.people(id),
  created_at timestamptz not null default now()
);

create table public.bank_transaction_allocations (
  id uuid primary key default gen_random_uuid(),
  bank_transaction_id uuid not null references public.bank_transactions(id),
  order_id uuid references public.orders(id),
  topup_id uuid,
  allocation_kind text not null check (allocation_kind in ('allocation', 'reversal')),
  amount_twd integer not null check (amount_twd > 0),
  reverses_allocation_id uuid references public.bank_transaction_allocations(id),
  allocated_by uuid not null references public.people(id),
  second_confirmed_by uuid references public.people(id),
  idempotency_key uuid not null,
  reason text not null,
  created_at timestamptz not null default now(),
  check ((order_id is null) <> (topup_id is null)),
  check (
    (allocation_kind = 'allocation' and reverses_allocation_id is null)
    or (allocation_kind = 'reversal' and reverses_allocation_id is not null)
  ),
  check (second_confirmed_by is null or second_confirmed_by <> allocated_by),
  unique (allocated_by, idempotency_key)
);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id),
  event_type text not null,
  amount_twd integer check (amount_twd is null or amount_twd >= 0),
  actor_id uuid not null references public.people(id),
  source_allocation_id uuid references public.bank_transaction_allocations(id),
  idempotency_key uuid unique,
  event_data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

alter table public.payment_events owner to suiyue_money_owner;

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id),
  course_version_id uuid not null references public.course_versions(id),
  source_type text not null check (source_type in ('b2c_order', 'organization_assignment')),
  source_id uuid not null,
  status text not null default 'locked'
    check (status in ('locked', 'active', 'frozen', 'revoked', 'expired')),
  locked_reason text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  unique (person_id, course_version_id, source_type, source_id)
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id),
  course_version_id uuid not null references public.course_versions(id),
  entitlement_id uuid not null unique references public.entitlements(id),
  status text not null default 'active'
    check (status in (
      'active', 'completed', 'submitted', 'credited', 'needs_correction',
      'rejected', 'revoked', 'refunded'
  )),
  identity_profile_confirmed_at timestamptz,
  identity_profile_revision_confirmed integer
    check (
      identity_profile_revision_confirmed is null
      or identity_profile_revision_confirmed > 0
    ),
  completed_at timestamptz,
  submitted_at timestamptz,
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  unique (person_id, course_version_id, entitlement_id)
);

create table public.invoice_records (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id),
  point_topup_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'issued', 'failed')),
  buyer_name text,
  buyer_tax_id text,
  external_number text,
  issued_on date,
  amount_twd integer not null check (amount_twd > 0),
  created_at timestamptz not null default now(),
  check ((order_id is null) <> (point_topup_id is null))
);

create table public.invoice_events (
  id uuid primary key default gen_random_uuid(),
  invoice_record_id uuid not null references public.invoice_records(id),
  event_type text not null check (event_type in (
    'issue_requested', 'issued', 'failed', 'allowance_requested',
    'allowance_completed', 'void_requested', 'void_completed', 'corrected'
  )),
  amount_twd integer check (amount_twd is null or amount_twd > 0),
  external_reference text,
  actor_id uuid not null references public.people(id),
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.refund_cases (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  requested_by uuid not null references public.people(id),
  status text not null default 'submitted'
    check (status in (
      'submitted', 'reviewing', 'approved', 'rejected', 'disbursing',
      'partially_disbursed', 'completed', 'failed'
    )),
  basis text not null check (basis in (
    'consumer_withdrawal', 'proportional_termination', 'accreditation_failure',
    'provider_failure', 'suiyue_cancellation', 'material_change', 'other'
  )),
  reason text not null,
  account_details_ciphertext jsonb,
  frozen_at timestamptz not null default now(),
  usage_snapshot jsonb not null,
  idempotency_key uuid not null,
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (requested_by, idempotency_key)
);

create table public.refund_case_decisions (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases(id),
  reviewer_id uuid not null references public.people(id),
  decision text not null check (decision in ('approve', 'reject')),
  reason text not null,
  created_at timestamptz not null default now(),
  unique (refund_case_id, reviewer_id)
);

create table private.refund_account_access_grants (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases(id),
  actor_id uuid not null references public.people(id),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.refund_allocations (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases(id),
  order_item_id uuid references public.order_items(id),
  scope_type text not null check (scope_type in ('recorded', 'live_component', 'whole_order')),
  scope_id uuid,
  amount_twd integer not null check (amount_twd > 0),
  calculation_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create table public.refund_disbursements (
  id uuid primary key default gen_random_uuid(),
  refund_allocation_id uuid not null references public.refund_allocations(id),
  attempt integer not null check (attempt > 0),
  amount_twd integer not null check (amount_twd > 0),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed')),
  external_reference text,
  executed_by uuid references public.people(id),
  failure_reason text,
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (refund_allocation_id, attempt)
);

create table public.reconciliation_cases (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'underpayment', 'overpayment', 'split_payment', 'combined_payment',
    'late_payment', 'unmatched_payment', 'input_error', 'capacity_unavailable'
  )),
  order_id uuid references public.orders(id),
  bank_transaction_id uuid references public.bank_transactions(id),
  status text not null default 'open'
    check (status in ('open', 'investigating', 'resolved', 'closed')),
  reason text not null,
  assigned_to uuid references public.people(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create or replace function internal.current_person_id()
returns uuid
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  result uuid;
begin
  select ai.person_id into result
  from public.auth_identities ai
  join public.people p on p.id = ai.person_id
  where ai.auth_user_id = auth.uid()
    and ai.active
    and not ai.restricted
    and ai.identity_epoch = p.identity_epoch
    and coalesce(auth.jwt() ->> 'iat', '') ~ '^[0-9]+$'
    and to_timestamp((auth.jwt() ->> 'iat')::double precision)
      >= ai.session_valid_after;
  if result is null then
    raise exception 'ACTIVE_UNRESTRICTED_IDENTITY_REQUIRED';
  end if;
  return result;
end
$$;
revoke all on function internal.current_person_id() from public;

create or replace function internal.prevent_append_only_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'APPEND_ONLY_TABLE';
end
$$;

create trigger payment_events_append_only
before update or delete on public.payment_events
for each row execute function internal.prevent_append_only_change();
create trigger bank_transactions_append_only
before update or delete on public.bank_transactions
for each row execute function internal.prevent_append_only_change();
create trigger bank_allocations_append_only
before update or delete on public.bank_transaction_allocations
for each row execute function internal.prevent_append_only_change();
create trigger invoice_events_append_only
before update or delete on public.invoice_events
for each row execute function internal.prevent_append_only_change();

create or replace function internal.check_bank_allocation_totals()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  transaction_total bigint;
  transaction_allocated bigint;
  order_due bigint;
  order_allocated bigint;
  topup_due bigint;
  topup_allocated bigint;
begin
  perform 1 from public.bank_transactions
    where id = new.bank_transaction_id for update;
  select amount_twd into transaction_total
    from public.bank_transactions where id = new.bank_transaction_id;
  select coalesce(sum(
    case when allocation_kind = 'allocation' then amount_twd else -amount_twd end
  ), 0) into transaction_allocated
    from public.bank_transaction_allocations
    where bank_transaction_id = new.bank_transaction_id;
  if transaction_allocated > transaction_total or transaction_allocated < 0 then
    raise exception 'BANK_TRANSACTION_ALLOCATION_OUT_OF_RANGE';
  end if;

  if new.order_id is not null then
    perform 1 from public.orders where id = new.order_id for update;
    select amount_due_twd into order_due from public.orders where id = new.order_id;
    select coalesce(sum(
      case when allocation_kind = 'allocation' then amount_twd else -amount_twd end
    ), 0) into order_allocated
      from public.bank_transaction_allocations where order_id = new.order_id;
    if order_allocated > order_due or order_allocated < 0 then
      raise exception 'ORDER_ALLOCATION_OUT_OF_RANGE';
    end if;
  end if;
  if new.topup_id is not null then
    perform 1 from public.point_topups where id = new.topup_id for update;
    select amount_due_twd into topup_due
      from public.point_topups where id = new.topup_id;
    select coalesce(sum(
      case when allocation_kind = 'allocation' then amount_twd else -amount_twd end
    ), 0) into topup_allocated
      from public.bank_transaction_allocations where topup_id = new.topup_id;
    if topup_allocated > topup_due or topup_allocated < 0 then
      raise exception 'TOPUP_ALLOCATION_OUT_OF_RANGE';
    end if;
  end if;
  return new;
end
$$;
revoke all on function internal.check_bank_allocation_totals() from public;

create constraint trigger bank_allocation_totals
after insert on public.bank_transaction_allocations
deferrable initially immediate
for each row execute function internal.check_bank_allocation_totals();
