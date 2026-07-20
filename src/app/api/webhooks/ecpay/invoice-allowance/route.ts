import { verifyInvoiceAllowanceCallbackCheckMacValue } from "@/lib/ecpay-invoice-core";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

function providerText(value: string, status = 200) {
  return new Response(value, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function parseTaipeiAllowanceDate(value: string) {
  const match = value
    .trim()
    .match(
      /^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/,
    );
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const localDate = `${year}-${month}-${day}`;
  const dateOnly = new Date(`${localDate}T00:00:00Z`);
  if (
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    Number.isNaN(dateOnly.getTime()) ||
    dateOnly.toISOString().slice(0, 10) !== localDate
  )
    return null;
  const instant = new Date(
    `${localDate}T${hour}:${minute}:${second}+08:00`,
  );
  if (Number.isNaN(instant.getTime())) return null;
  return { instant: instant.toISOString(), localDate };
}

export async function POST(request: Request) {
  const hashKey = process.env.ECPAY_INVOICE_HASH_KEY;
  const hashIv = process.env.ECPAY_INVOICE_HASH_IV;
  const admin = createSupabaseAdminClient();
  if (!hashKey || !hashIv || !admin)
    return providerText("0|SERVICE_NOT_CONFIGURED", 503);
  const params = Object.fromEntries(
    new URLSearchParams(await request.text()).entries(),
  );
  if (!verifyInvoiceAllowanceCallbackCheckMacValue(params, hashKey, hashIv))
    return providerText("0|INVALID_CHECK_MAC", 403);
  if (
    params.RtnCode !== "1" ||
    !params.IA_Allow_No ||
    !params.IA_Invoice_No ||
    !params.IA_Date
  )
    return providerText("0|INVALID_ALLOWANCE_RESULT", 400);
  if (!/^\d+$/.test(params.IIS_Remain_Allowance_Amt ?? ""))
    return providerText("0|INVALID_REMAINING_AMOUNT", 400);
  const remainingAmount = Number(params.IIS_Remain_Allowance_Amt);
  if (!Number.isSafeInteger(remainingAmount))
    return providerText("0|INVALID_REMAINING_AMOUNT", 400);
  const allowanceDate = parseTaipeiAllowanceDate(params.IA_Date);
  if (!allowanceDate)
    return providerText("0|INVALID_ALLOWANCE_DATE", 400);
  const callbackRecordId = new URL(request.url).searchParams.get("record");
  if (
    callbackRecordId &&
    !z.string().uuid().safeParse(callbackRecordId).success
  )
    return providerText("0|INVALID_RECORD_REFERENCE", 400);
  // record query string 不是綠界簽章欄位，不能用它選擇更新目標。先以已簽章的
  // IA_Allow_No 找出唯一 outbox，再把 record 當作額外交叉核對。
  const { data: record, error: lookupError } = await admin
    .from("invoice_records")
    .select("id")
    .eq("record_type", "allowance")
    .eq("allowance_number", params.IA_Allow_No)
    .maybeSingle();
  if (lookupError) return providerText("0|ALLOWANCE_LOOKUP_FAILED", 500);
  if (!record) return providerText("0|ALLOWANCE_NOT_FOUND", 404);
  if (callbackRecordId && callbackRecordId !== record.id)
    return providerText("0|ALLOWANCE_RECORD_MISMATCH", 409);
  const invoiceRecordId = record.id;

  const { error } = await admin.rpc(
    "apply_verified_enterprise_allowance_callback",
    {
      target_invoice_record_id: invoiceRecordId,
      target_invoice_number: params.IA_Invoice_No,
      target_allowance_number: params.IA_Allow_No,
      target_allowance_at: allowanceDate.instant,
      // IA_Date 是台北本地時間；直接保存原字串解析出的日期，避免 UTC
      // toISOString().slice(0, 10) 在凌晨把日期倒退一天。
      target_allowance_local_date: allowanceDate.localDate,
      target_remaining_allowance_twd: remainingAmount,
      target_provider_response: params,
    },
  );
  if (error) {
    if (error.message.includes("NOT_FOUND"))
      return providerText("0|ALLOWANCE_NOT_FOUND", 404);
    if (error.message.includes("INVALID_ENTERPRISE_ALLOWANCE_CALLBACK"))
      return providerText("0|INVALID_ALLOWANCE_RESULT", 400);
    if (
      error.message.includes("MISMATCH") ||
      error.message.includes("CONFLICT") ||
      error.message.includes("STATE_CHANGED")
    )
      return providerText("0|ALLOWANCE_CALLBACK_MISMATCH", 409);
    return providerText("0|ALLOWANCE_UPDATE_FAILED", 500);
  }
  return providerText("1|OK");
}
