-- 修正企業折讓 claim RPC 中 PL/pgSQL 變數與資料表欄位同名造成的歧義。
-- 保留原函式簽章與權限，讓已部署環境可安全向前修復。
create or replace function public.claim_enterprise_allowance(
  target_invoice_record_id uuid,
  target_actor_id uuid
)
returns public.invoice_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowance_row public.invoice_records%rowtype;
  target_parent_invoice_id uuid;
  claim_token uuid := gen_random_uuid();
begin
  if not exists (
    select 1 from auth.users u
    where u.id = target_actor_id and u.raw_app_meta_data ->> 'platform_role' = 'admin'
  ) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;

  select ir.parent_invoice_id into target_parent_invoice_id
  from public.invoice_records ir
  where ir.id = target_invoice_record_id and ir.record_type = 'allowance';
  if target_parent_invoice_id is null then raise exception 'ENTERPRISE_ALLOWANCE_NOT_FOUND'; end if;
  perform 1
  from public.invoice_records parent
  where parent.id = target_parent_invoice_id
    and parent.record_type = 'invoice'
    and parent.status = 'issued'
  for share;
  if not found then raise exception 'ISSUED_PARENT_INVOICE_REQUIRED'; end if;

  select * into allowance_row
  from public.invoice_records
  where id = target_invoice_record_id
  for update;
  if allowance_row.id is null
    or allowance_row.record_type <> 'allowance'
    or allowance_row.parent_invoice_id is distinct from target_parent_invoice_id
    or allowance_row.allowance_status not in ('none', 'failed')
    or allowance_row.allowance_manual_reconciliation_required
    or allowance_row.allowance_number is not null then
    raise exception 'ENTERPRISE_ALLOWANCE_NOT_CLAIMABLE';
  end if;
  if allowance_row.allowance_status = 'failed'
    and allowance_row.next_retry_at is not null
    and allowance_row.next_retry_at > now() then
    raise exception 'ENTERPRISE_ALLOWANCE_RETRY_NOT_DUE';
  end if;

  update public.invoice_records
  set status = 'pending',
      allowance_status = 'processing',
      allowance_claim_token = claim_token,
      allowance_claimed_at = now(),
      allowance_lease_expires_at = now() + interval '5 minutes',
      allowance_last_claim_token_hash = null,
      allowance_manual_reconciliation_required = false,
      attempt_count = attempt_count + 1,
      next_retry_at = null,
      error_message = null,
      updated_at = now()
  where id = allowance_row.id
  returning * into allowance_row;

  insert into public.audit_events (
    actor_id, organization_id, action, target_type, target_id, after_data
  ) values (
    target_actor_id, allowance_row.organization_id, 'enterprise.allowance_claimed',
    'invoice_record', allowance_row.id::text,
    jsonb_build_object(
      'attempt_count', allowance_row.attempt_count,
      'lease_expires_at', allowance_row.allowance_lease_expires_at
    )
  );
  return allowance_row;
end;
$$;

revoke all on function public.claim_enterprise_allowance(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_enterprise_allowance(uuid, uuid)
  to service_role;
