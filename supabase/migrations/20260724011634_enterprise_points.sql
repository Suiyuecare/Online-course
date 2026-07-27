create table public.organization_wallets (
  organization_id uuid primary key references public.organizations(id),
  available_points bigint not null default 0 check (available_points >= 0),
  reserved_points bigint not null default 0 check (reserved_points >= 0),
  refund_reserved_points bigint not null default 0
    check (refund_reserved_points >= 0),
  consumed_points bigint not null default 0 check (consumed_points >= 0),
  refunded_points bigint not null default 0 check (refunded_points >= 0),
  ledger_version bigint not null default 0 check (ledger_version >= 0),
  updated_at timestamptz not null default now()
);

create table public.point_topups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  requested_by uuid not null references public.people(id),
  status text not null default 'pending_transfer'
    check (status in (
      'pending_transfer', 'proof_submitted', 'payment_review', 'paid',
      'rejected', 'cancelled', 'expired', 'refund_pending',
      'partially_refunded', 'refunded'
    )),
  points bigint not null check (points > 0),
  amount_due_twd bigint not null check (amount_due_twd > 0),
  amount_paid_twd bigint not null default 0 check (amount_paid_twd >= 0),
  legal_acceptance_id uuid not null references public.legal_acceptances(id),
  transfer_due_at timestamptz not null,
  first_confirmed_by uuid references public.people(id),
  second_confirmed_by uuid references public.people(id),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  check (points = amount_due_twd),
  check (amount_paid_twd <= amount_due_twd),
  check (
    second_confirmed_by is null
    or second_confirmed_by <> first_confirmed_by
  ),
  unique (organization_id, idempotency_key)
);

alter table public.bank_payment_instructions
  add column topup_id uuid unique references public.point_topups(id),
  add constraint bank_payment_instruction_target
    check ((order_id is null) <> (topup_id is null));

alter table public.payment_proofs
  add column topup_id uuid references public.point_topups(id),
  add constraint payment_proof_target
    check ((order_id is null) <> (topup_id is null));

alter table public.bank_transaction_allocations
  add constraint bank_allocations_topup_fk
  foreign key (topup_id) references public.point_topups(id);

alter table public.invoice_records
  add constraint invoice_records_topup_fk
  foreign key (point_topup_id) references public.point_topups(id);

create unique index one_invoice_per_order
  on public.invoice_records(order_id) where order_id is not null;
create unique index one_invoice_per_topup
  on public.invoice_records(point_topup_id) where point_topup_id is not null;

create table public.point_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  point_topup_id uuid not null unique references public.point_topups(id),
  purchased_points bigint not null check (purchased_points > 0),
  available_points bigint not null check (available_points >= 0),
  reserved_points bigint not null default 0 check (reserved_points >= 0),
  refund_reserved_points bigint not null default 0
    check (refund_reserved_points >= 0),
  consumed_points bigint not null default 0 check (consumed_points >= 0),
  refunded_points bigint not null default 0 check (refunded_points >= 0),
  paid_twd_per_point numeric(12,4) not null default 1
    check (paid_twd_per_point = 1),
  purchased_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (
    purchased_points =
      available_points + reserved_points + refund_reserved_points
      + consumed_points + refunded_points
  )
);

create table public.point_ledger_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  point_lot_id uuid not null references public.point_lots(id),
  event_type text not null check (event_type in (
    'minted', 'reserved', 'released', 'consumed', 'compensated',
    'refund_reserved', 'refund_released', 'refunded'
  )),
  points bigint not null check (points > 0),
  assignment_id uuid,
  topup_id uuid references public.point_topups(id),
  actor_id uuid not null references public.people(id),
  idempotency_key uuid not null,
  reason text not null,
  occurred_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

alter table public.point_ledger_events owner to suiyue_money_owner;

create table public.organization_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  member_person_id uuid not null references public.people(id),
  course_version_id uuid not null references public.course_versions(id),
  assigned_by uuid not null references public.people(id),
  status text not null default 'reserved'
    check (status in (
      'reserved', 'active', 'consumed', 'released', 'completed',
      'cancelled', 'refunded'
    )),
  point_price_snapshot integer not null check (point_price_snapshot > 0),
  consumed_at timestamptz,
  released_at timestamptz,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, member_person_id, course_version_id),
  unique (organization_id, idempotency_key)
);

alter table public.point_ledger_events
  add constraint point_ledger_assignment_fk
  foreign key (assignment_id) references public.organization_assignments(id);

create table public.assignment_point_allocations (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.organization_assignments(id),
  point_lot_id uuid not null references public.point_lots(id),
  points bigint not null check (points > 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'consumed', 'released', 'compensated')),
  created_at timestamptz not null default now(),
  unique (assignment_id, point_lot_id)
);

create table public.organization_invitation_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  uploaded_by uuid not null references public.people(id),
  quarantine_object_path text not null,
  content_sha256 text not null unique,
  scan_status text not null default 'quarantined'
    check (scan_status in ('quarantined', 'scanning', 'safe', 'rejected', 'failed')),
  validation_status text not null default 'pending'
    check (validation_status in ('pending', 'invalid', 'valid', 'imported')),
  row_count integer check (row_count between 0 and 1000),
  validation_errors jsonb not null default '[]'::jsonb,
  idempotency_key uuid not null,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create table public.point_refund_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  point_topup_id uuid not null references public.point_topups(id),
  point_lot_id uuid not null references public.point_lots(id),
  requested_by uuid not null references public.people(id),
  points bigint not null check (points > 0),
  amount_twd bigint not null check (amount_twd > 0),
  account_details_ciphertext jsonb not null,
  status text not null default 'submitted'
    check (status in (
      'submitted', 'reviewing', 'approved', 'disbursing',
      'completed', 'rejected', 'failed'
    )),
  first_approved_by uuid references public.people(id),
  second_approved_by uuid references public.people(id),
  external_reference text,
  failure_reason text,
  idempotency_key uuid not null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  completed_at timestamptz,
  check (points = amount_twd),
  check (
    first_approved_by is null
    or first_approved_by <> requested_by
  ),
  check (
    second_approved_by is null
    or (
      first_approved_by is not null
      and second_approved_by <> first_approved_by
      and second_approved_by <> requested_by
    )
  ),
  unique (requested_by, idempotency_key)
);

create trigger point_ledger_append_only
before update or delete on public.point_ledger_events
for each row execute function internal.prevent_append_only_change();
