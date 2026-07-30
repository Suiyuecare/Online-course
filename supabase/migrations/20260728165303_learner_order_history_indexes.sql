create index if not exists orders_person_created_id_idx
  on public.orders(person_id, created_at desc, id desc);

create index if not exists refund_cases_order_submitted_id_idx
  on public.refund_cases(order_id, submitted_at desc, id desc);

create index if not exists refund_allocations_case_idx
  on public.refund_allocations(refund_case_id);
