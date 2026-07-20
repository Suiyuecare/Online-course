import {
  createInvoiceRelateNumber,
  decryptEcpayInvoiceData,
  encryptEcpayInvoiceData,
  invoiceTimestamp,
  isSafeSingleEmail,
  isValidTaiwanBusinessNumber,
  sanitizeInvoiceText,
} from "./ecpay-invoice-core";

const STAGE_ORIGIN = "https://einvoice-stage.ecpay.com.tw";
const PRODUCTION_ORIGIN = "https://einvoice.ecpay.com.tw";

export type EcpayInvoiceItem = {
  name: string;
  count: number;
  unit?: string;
  unitPriceTwd: number;
  amountTwd: number;
};

export type EcpayInvoiceIssueInput = {
  relateNumber: string;
  customerIdentifier: string;
  customerName: string;
  customerEmail: string;
  salesAmountTwd: number;
  items: EcpayInvoiceItem[];
  remark?: string;
};

export type EcpayInvoiceAllowanceInput = {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerEmail: string;
  allowanceAmountTwd: number;
  reason: string;
  items: EcpayInvoiceItem[];
  returnUrl: string;
};

export type EcpayInvoiceIssueResult = {
  invoiceNumber: string;
  invoiceDate: string;
  randomNumber: string;
  relateNumber: string;
  recovered?: true;
};

export type EcpayInvoiceAllowanceResult = {
  temporaryAllowanceNumber: string;
  temporaryAt: string;
  expiresAt: string;
  remainingAmountTwd: number;
  requiresBuyerConsent: true;
};

type InvoiceConfig = {
  merchantId: string;
  hashKey: string;
  hashIv: string;
  origin: string;
};

type ProviderEnvelope = {
  TransCode?: number | string;
  TransMsg?: string;
  Data?: string;
};

type ProviderData = {
  RtnCode?: number | string;
  RtnMsg?: string;
  [key: string]: unknown;
};

export function isEcpayEnvironmentPairValid(
  paymentEnvironment = process.env.ECPAY_ENV,
  invoiceEnvironment = process.env.ECPAY_INVOICE_ENV,
) {
  return (
    (paymentEnvironment === "stage" || paymentEnvironment === "production") &&
    paymentEnvironment === invoiceEnvironment
  );
}

export class EcpayInvoiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EcpayInvoiceError";
  }
}

export function isAmbiguousEcpayAllowanceError(error: unknown) {
  if (!(error instanceof EcpayInvoiceError)) return true;
  return ![
    "INVALID_CONFIGURATION",
    "INVALID_INPUT",
    "STAGE_EMAIL_NOT_ALLOWED",
    "TRANSPORT_REJECTED",
    "PROVIDER_REJECTED",
  ].includes(error.code);
}

function configuredInvoiceService(): InvoiceConfig | null {
  const merchantId = process.env.ECPAY_INVOICE_MERCHANT_ID;
  const hashKey = process.env.ECPAY_INVOICE_HASH_KEY;
  const hashIv = process.env.ECPAY_INVOICE_HASH_IV;
  if (
    !merchantId ||
    !hashKey ||
    !hashIv ||
    !isEcpayEnvironmentPairValid()
  )
    return null;
  if (Buffer.byteLength(hashKey, "utf8") !== 16)
    throw new EcpayInvoiceError(
      "INVALID_CONFIGURATION",
      "ECPAY_INVOICE_HASH_KEY must be exactly 16 bytes.",
    );
  if (Buffer.byteLength(hashIv, "utf8") !== 16)
    throw new EcpayInvoiceError(
      "INVALID_CONFIGURATION",
      "ECPAY_INVOICE_HASH_IV must be exactly 16 bytes.",
    );
  return {
    merchantId,
    hashKey,
    hashIv,
    origin:
      process.env.ECPAY_INVOICE_ENV === "production"
        ? PRODUCTION_ORIGIN
        : STAGE_ORIGIN,
  };
}

export function isEcpayInvoiceConfigured() {
  const hashKey = process.env.ECPAY_INVOICE_HASH_KEY;
  const hashIv = process.env.ECPAY_INVOICE_HASH_IV;
  return Boolean(
    process.env.ECPAY_INVOICE_MERCHANT_ID &&
      hashKey &&
      hashIv &&
      isEcpayEnvironmentPairValid() &&
      Buffer.byteLength(hashKey, "utf8") === 16 &&
      Buffer.byteLength(hashIv, "utf8") === 16,
  );
}

function positiveInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new EcpayInvoiceError("INVALID_INPUT", `${field} must be positive.`);
}

function providerItems(items: EcpayInvoiceItem[], expectedTotal: number) {
  if (!items.length || items.length > 999)
    throw new EcpayInvoiceError("INVALID_INPUT", "Invoice items are invalid.");
  let total = 0;
  const mapped = items.map((item, index) => {
    positiveInteger(item.count, "ItemCount");
    positiveInteger(item.unitPriceTwd, "ItemPrice");
    positiveInteger(item.amountTwd, "ItemAmount");
    if (item.unitPriceTwd * item.count !== item.amountTwd)
      throw new EcpayInvoiceError(
        "INVALID_INPUT",
        "Invoice item amount does not match price and quantity.",
      );
    total += item.amountTwd;
    const name = sanitizeInvoiceText(item.name, 500);
    if (!name)
      throw new EcpayInvoiceError("INVALID_INPUT", "ItemName is required.");
    return {
      ItemSeq: index + 1,
      ItemName: name,
      ItemCount: item.count,
      ItemWord: sanitizeInvoiceText(item.unit ?? "名", 6) || "名",
      ItemPrice: item.unitPriceTwd,
      ItemTaxType: "1",
      ItemAmount: item.amountTwd,
      ItemRemark: "",
    };
  });
  if (total !== expectedTotal)
    throw new EcpayInvoiceError(
      "INVALID_INPUT",
      "Invoice item total does not match the requested total.",
    );
  return mapped;
}

function safeProviderMessage(value: unknown) {
  return sanitizeInvoiceText(typeof value === "string" ? value : "", 200);
}

function invoiceDateOnly(value: string) {
  const match = value.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (!match)
    throw new EcpayInvoiceError(
      "INVALID_RESPONSE",
      "ECPay invoice date is invalid.",
    );
  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized)
    throw new EcpayInvoiceError(
      "INVALID_RESPONSE",
      "ECPay invoice date is invalid.",
    );
  return normalized;
}

export class EcpayInvoiceClient {
  constructor(private readonly config: InvoiceConfig) {}

  private async request<T extends ProviderData>(path: string, data: object) {
    const response = await fetch(`${this.config.origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        MerchantID: this.config.merchantId,
        RqHeader: { Timestamp: invoiceTimestamp() },
        Data: encryptEcpayInvoiceData(
          data,
          this.config.hashKey,
          this.config.hashIv,
        ),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new EcpayInvoiceError(
        "HTTP_ERROR",
        `ECPay invoice API returned HTTP ${response.status}.`,
      );
    const envelope = (await response.json().catch(() => null)) as
      | ProviderEnvelope
      | null;
    if (!envelope || String(envelope.TransCode) !== "1")
      throw new EcpayInvoiceError(
        "TRANSPORT_REJECTED",
        safeProviderMessage(envelope?.TransMsg) ||
          "ECPay rejected the invoice request envelope.",
      );
    if (typeof envelope.Data !== "string" || !envelope.Data)
      throw new EcpayInvoiceError(
        "INVALID_RESPONSE",
        "ECPay invoice response did not contain encrypted data.",
      );
    let decoded: T;
    try {
      decoded = decryptEcpayInvoiceData<T>(
        envelope.Data,
        this.config.hashKey,
        this.config.hashIv,
      );
    } catch {
      throw new EcpayInvoiceError(
        "INVALID_RESPONSE",
        "ECPay invoice response could not be decrypted.",
      );
    }
    if (String(decoded.RtnCode) !== "1")
      throw new EcpayInvoiceError(
        "PROVIDER_REJECTED",
        safeProviderMessage(decoded.RtnMsg) ||
          "ECPay rejected the invoice operation.",
      );
    return decoded;
  }

  async issue(input: EcpayInvoiceIssueInput): Promise<EcpayInvoiceIssueResult> {
    positiveInteger(input.salesAmountTwd, "SalesAmount");
    if (!/^[A-Za-z0-9]{1,50}$/.test(input.relateNumber))
      throw new EcpayInvoiceError(
        "INVALID_INPUT",
        "RelateNumber must contain only letters and numbers.",
      );
    if (!isValidTaiwanBusinessNumber(input.customerIdentifier))
      throw new EcpayInvoiceError(
        "INVALID_INPUT",
        "CustomerIdentifier is invalid.",
      );
    if (!isSafeSingleEmail(input.customerEmail))
      throw new EcpayInvoiceError(
        "INVALID_INPUT",
        "CustomerEmail is invalid.",
      );
    if (
      this.config.origin === STAGE_ORIGIN &&
      !/@(?:example\.(?:com|net|org)|ecpay\.com\.tw)$/i.test(
        input.customerEmail,
      )
    )
      throw new EcpayInvoiceError(
        "STAGE_EMAIL_NOT_ALLOWED",
        "ECPay stage must not receive a real customer email address.",
      );
    const customerName = sanitizeInvoiceText(input.customerName, 60);
    if (!customerName)
      throw new EcpayInvoiceError(
        "INVALID_INPUT",
        "CustomerName is required.",
      );
    const result = await this.request<
      ProviderData & {
        InvoiceNo?: string;
        InvoiceDate?: string;
        RandomNumber?: string;
      }
    >("/B2CInvoice/Issue", {
      MerchantID: this.config.merchantId,
      RelateNumber: input.relateNumber,
      CustomerID: "",
      CustomerIdentifier: input.customerIdentifier,
      CustomerName: customerName,
      CustomerAddr: "",
      CustomerPhone: "",
      CustomerEmail: input.customerEmail,
      ClearanceMark: "",
      Print: "0",
      Donation: "0",
      LoveCode: "",
      CarrierType: "1",
      CarrierNum: "",
      TaxType: "1",
      SalesAmount: input.salesAmountTwd,
      InvoiceRemark: sanitizeInvoiceText(input.remark ?? "", 200),
      InvType: "07",
      vat: "1",
      Items: providerItems(input.items, input.salesAmountTwd),
    });
    if (
      typeof result.InvoiceNo !== "string" ||
      result.InvoiceNo.length !== 10 ||
      typeof result.InvoiceDate !== "string" ||
      !result.InvoiceDate ||
      typeof result.RandomNumber !== "string" ||
      !/^\d{4}$/.test(result.RandomNumber)
    )
      throw new EcpayInvoiceError(
        "INVALID_RESPONSE",
        "ECPay reported success without complete invoice details.",
      );
    return {
      invoiceNumber: result.InvoiceNo,
      invoiceDate: result.InvoiceDate,
      randomNumber: result.RandomNumber,
      relateNumber: input.relateNumber,
    };
  }

  async findByRelateNumber(
    relateNumber: string,
  ): Promise<EcpayInvoiceIssueResult & { salesAmountTwd: number }> {
    if (!/^[A-Za-z0-9]{1,50}$/.test(relateNumber))
      throw new EcpayInvoiceError(
        "INVALID_INPUT",
        "RelateNumber must contain only letters and numbers.",
      );
    const result = await this.request<
      ProviderData & {
        IIS_Number?: string;
        IIS_Relate_Number?: string;
        IIS_Create_Date?: string;
        IIS_Random_Number?: string;
        IIS_Sales_Amount?: number | string;
      }
    >("/B2CInvoice/GetIssue", {
      MerchantID: this.config.merchantId,
      RelateNumber: relateNumber,
    });
    const salesAmount = Number(result.IIS_Sales_Amount);
    if (
      typeof result.IIS_Number !== "string" ||
      result.IIS_Number.length !== 10 ||
      typeof result.IIS_Create_Date !== "string" ||
      !result.IIS_Create_Date ||
      typeof result.IIS_Random_Number !== "string" ||
      !/^\d{4}$/.test(result.IIS_Random_Number) ||
      !Number.isSafeInteger(salesAmount) ||
      salesAmount <= 0
    )
      throw new EcpayInvoiceError(
        "INVALID_RESPONSE",
        "ECPay invoice lookup returned incomplete details.",
      );
    return {
      invoiceNumber: result.IIS_Number,
      invoiceDate: result.IIS_Create_Date,
      randomNumber: result.IIS_Random_Number,
      relateNumber,
      salesAmountTwd: salesAmount,
      recovered: true,
    };
  }

  /** Starts the no-paper allowance flow; final issuance requires buyer consent. */
  async createAllowance(
    input: EcpayInvoiceAllowanceInput,
  ): Promise<EcpayInvoiceAllowanceResult> {
    positiveInteger(input.allowanceAmountTwd, "AllowanceAmount");
    if (input.invoiceNumber.length !== 10)
      throw new EcpayInvoiceError(
        "INVALID_INPUT",
        "InvoiceNo must be 10 characters.",
      );
    if (!/^\d{4}[/-]\d{2}[/-]\d{2}$/.test(input.invoiceDate))
      throw new EcpayInvoiceError(
        "INVALID_INPUT",
        "InvoiceDate is invalid.",
      );
    if (!isSafeSingleEmail(input.customerEmail))
      throw new EcpayInvoiceError(
        "INVALID_INPUT",
        "NotifyMail is invalid.",
      );
    if (
      this.config.origin === STAGE_ORIGIN &&
      !/@(?:example\.(?:com|net|org)|ecpay\.com\.tw)$/i.test(
        input.customerEmail,
      )
    )
      throw new EcpayInvoiceError(
        "STAGE_EMAIL_NOT_ALLOWED",
        "ECPay stage must not receive a real customer email address.",
      );
    const callback = new URL(input.returnUrl);
    if (
      callback.protocol !== "https:" &&
      !(callback.protocol === "http:" && callback.hostname === "localhost")
    )
      throw new EcpayInvoiceError(
        "INVALID_INPUT",
        "Allowance ReturnURL must use HTTPS.",
      );
    if (input.returnUrl.length > 200)
      throw new EcpayInvoiceError(
        "INVALID_INPUT",
        "Allowance ReturnURL is too long.",
      );
    const result = await this.request<
      ProviderData & {
        IA_Allow_No?: string;
        IA_TempDate?: string;
        IA_TempExpireDate?: string;
        IA_Remain_Allowance_Amt?: number | string;
      }
    >("/B2CInvoice/AllowanceByCollegiate", {
      MerchantID: this.config.merchantId,
      InvoiceNo: input.invoiceNumber,
      InvoiceDate: input.invoiceDate,
      AllowanceNotify: "E",
      CustomerName: sanitizeInvoiceText(input.customerName, 60),
      NotifyMail: input.customerEmail,
      AllowanceAmount: input.allowanceAmountTwd,
      Reason: sanitizeInvoiceText(input.reason, 50),
      Items: providerItems(input.items, input.allowanceAmountTwd).map((item) => ({
        ItemSeq: item.ItemSeq,
        ItemName: item.ItemName,
        ItemCount: item.ItemCount,
        ItemWord: item.ItemWord,
        ItemPrice: item.ItemPrice,
        ItemTaxType: item.ItemTaxType,
        ItemAmount: item.ItemAmount,
      })),
      ReturnURL: input.returnUrl,
    });
    const remaining = Number(result.IA_Remain_Allowance_Amt);
    if (
      typeof result.IA_Allow_No !== "string" ||
      !result.IA_Allow_No ||
      typeof result.IA_TempDate !== "string" ||
      typeof result.IA_TempExpireDate !== "string" ||
      !Number.isSafeInteger(remaining) ||
      remaining < 0
    )
      throw new EcpayInvoiceError(
        "INVALID_RESPONSE",
        "ECPay reported success without complete allowance details.",
      );
    return {
      temporaryAllowanceNumber: result.IA_Allow_No,
      temporaryAt: result.IA_TempDate,
      expiresAt: result.IA_TempExpireDate,
      remainingAmountTwd: remaining,
      requiresBuyerConsent: true,
    };
  }
}

let invoiceClient: EcpayInvoiceClient | null = null;

async function supabaseAdmin() {
  const { createSupabaseAdminClient } = await import("./supabase/server");
  return createSupabaseAdminClient();
}

export function getEcpayInvoiceClient() {
  if (invoiceClient) return invoiceClient;
  const config = configuredInvoiceService();
  if (!config) return null;
  invoiceClient = new EcpayInvoiceClient(config);
  return invoiceClient;
}

export async function ensureEnterpriseInvoiceRecord(input: {
  organizationId: string;
  orderId: string;
  amountTwd: number;
}) {
  const admin = await supabaseAdmin();
  if (!admin)
    return { created: false as const, reason: "SERVICE_NOT_CONFIGURED" };
  positiveInteger(input.amountTwd, "amountTwd");
  const { data: order } = await admin
    .from("orders")
    .select(
      "id,organization_id,amount_twd,order_kind,invoice_title,invoice_tax_id,invoice_email",
    )
    .eq("id", input.orderId)
    .maybeSingle();
  if (
    !order ||
    order.organization_id !== input.organizationId ||
    order.amount_twd !== input.amountTwd ||
    order.order_kind !== "enterprise_seat_pack" ||
    !order.invoice_title ||
    !order.invoice_tax_id ||
    !order.invoice_email
  )
    return { created: false as const, reason: "ORDER_SNAPSHOT_MISSING" };
  const { data: existing } = await admin
    .from("invoice_records")
    .select("id,status,idempotency_key")
    .eq("order_id", input.orderId)
    .eq("record_type", "invoice")
    .maybeSingle();
  if (existing)
    return { created: false as const, duplicate: true, record: existing };
  const { data, error } = await admin
    .from("invoice_records")
    .insert({
      organization_id: input.organizationId,
      order_id: input.orderId,
      record_type: "invoice",
      idempotency_key: createInvoiceRelateNumber(
        `enterprise-invoice:${input.orderId}`,
        "SYIR",
      ),
      status: "pending",
      buyer_title: order.invoice_title,
      buyer_tax_id: order.invoice_tax_id,
      buyer_email: order.invoice_email,
      amount_twd: input.amountTwd,
      attempt_count: 0,
      next_retry_at: new Date().toISOString(),
    })
    .select("id,status,idempotency_key")
    .single();
  if (error || !data) {
    const { data: raced } = await admin
      .from("invoice_records")
      .select("id,status,idempotency_key")
      .eq("order_id", input.orderId)
      .eq("record_type", "invoice")
      .maybeSingle();
    return raced
      ? { created: false as const, duplicate: true, record: raced }
      : {
          created: false as const,
          reason: safeProviderMessage(error?.message) || "CREATE_FAILED",
        };
  }
  return { created: true as const, record: data };
}

export async function issueEnterpriseInvoiceRecord(
  invoiceRecordId: string,
  input: Omit<EcpayInvoiceIssueInput, "relateNumber">,
  maxAttempts = 5,
) {
  const admin = await supabaseAdmin();
  let client: EcpayInvoiceClient | null;
  try {
    client = getEcpayInvoiceClient();
  } catch {
    client = null;
  }
  if (!admin || !client)
    return { issued: false as const, reason: "SERVICE_NOT_CONFIGURED" };
  const { data: record } = await admin
    .from("invoice_records")
    .select(
      "id,organization_id,status,record_type,amount_twd,attempt_count,invoice_number,invoice_date,updated_at",
    )
    .eq("id", invoiceRecordId)
    .maybeSingle();
  if (!record || record.record_type !== "invoice")
    return { issued: false as const, reason: "INVOICE_RECORD_NOT_FOUND" };
  if (record.status === "issued")
    return {
      issued: true as const,
      duplicate: true,
      invoiceNumber: record.invoice_number as string,
      invoiceDate: record.invoice_date as string,
    };
  if (!(["pending", "failed"] as string[]).includes(record.status))
    return { issued: false as const, reason: "INVOICE_NOT_ISSUABLE" };
  if (record.attempt_count >= maxAttempts)
    return { issued: false as const, reason: "RETRY_LIMIT_REACHED" };
  if (
    record.status === "pending" &&
    record.attempt_count > 0 &&
    Date.parse(record.updated_at) > Date.now() - 2 * 60_000
  )
    return { issued: false as const, reason: "ALREADY_PROCESSING" };
  if (record.amount_twd !== input.salesAmountTwd)
    return { issued: false as const, reason: "AMOUNT_MISMATCH" };
  const relateNumber = createInvoiceRelateNumber(
    `enterprise-invoice-record:${record.id}`,
  );
  const nextAttempt = record.attempt_count + 1;
  const { data: claimed } = await admin
    .from("invoice_records")
    .update({
      status: "pending",
      attempt_count: nextAttempt,
      error_message: null,
      next_retry_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", record.id)
    .eq("attempt_count", record.attempt_count)
    .in("status", ["pending", "failed"])
    .select("id")
    .maybeSingle();
  if (!claimed)
    return { issued: false as const, reason: "ALREADY_PROCESSING" };
  try {
    let result: EcpayInvoiceIssueResult;
    try {
      result = await client.issue({
        ...input,
        relateNumber,
      });
    } catch (issueError) {
      if (
        issueError instanceof EcpayInvoiceError &&
        issueError.code === "INVALID_INPUT"
      )
        throw issueError;
      try {
        const recovered = await client.findByRelateNumber(
          relateNumber,
        );
        if (recovered.salesAmountTwd !== input.salesAmountTwd)
          throw new EcpayInvoiceError(
            "RECOVERY_AMOUNT_MISMATCH",
            "Recovered invoice amount does not match the order.",
          );
        result = recovered;
      } catch (recoveryError) {
        if (
          recoveryError instanceof EcpayInvoiceError &&
          recoveryError.code === "RECOVERY_AMOUNT_MISMATCH"
        )
          throw recoveryError;
        throw issueError;
      }
    }
    const storedInvoiceDate = invoiceDateOnly(result.invoiceDate);
    const { error: auditError } = await admin.from("audit_events").insert({
      organization_id: record.organization_id,
      action: "enterprise.invoice_provider_confirmed",
      target_type: "invoice_record",
      target_id: record.id,
      before_data: { status: record.status, attempt_count: record.attempt_count },
      after_data: {
        invoice_number: result.invoiceNumber,
        invoice_date: storedInvoiceDate,
        relate_number: result.relateNumber,
        recovered: result.recovered === true,
        attempt_count: nextAttempt,
      },
    });
    if (auditError)
      return {
        issued: false as const,
        reason: "RECORD_AUDIT_FAILED",
        providerResult: result,
      };
    const { data: updated, error } = await admin
      .from("invoice_records")
      .update({
        status: "issued",
        provider_invoice_no: result.invoiceNumber,
        invoice_number: result.invoiceNumber,
        invoice_date: storedInvoiceDate,
        provider_response: {
          invoiceNumber: result.invoiceNumber,
          invoiceDate: result.invoiceDate,
          randomNumber: result.randomNumber,
          relateNumber: result.relateNumber,
          recovered: result.recovered === true,
        },
        issued_at: new Date().toISOString(),
        error_message: null,
        next_retry_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", record.id)
      .eq("attempt_count", nextAttempt)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error || !updated)
      return {
        issued: false as const,
        reason: error ? "RECORD_UPDATE_FAILED" : "RECORD_STATE_CHANGED",
        providerResult: result,
      };
    return {
      issued: true as const,
      invoiceNumber: result.invoiceNumber,
      invoiceDate: result.invoiceDate,
    };
  } catch (error) {
    const message = safeProviderMessage(
      error instanceof Error ? error.message : "INVOICE_ISSUE_FAILED",
    );
    const { error: failureAuditError } = await admin
      .from("audit_events")
      .insert({
        organization_id: record.organization_id,
        action: "enterprise.invoice_issue_failed",
        target_type: "invoice_record",
        target_id: record.id,
        before_data: { status: "pending", attempt_count: nextAttempt },
        after_data: {
          status: "failed",
          attempt_count: nextAttempt,
          error: message || "INVOICE_ISSUE_FAILED",
        },
      });
    if (failureAuditError)
      return { issued: false as const, reason: "RECORD_AUDIT_FAILED" };
    const { data: failedRecord, error: failureUpdateError } = await admin
      .from("invoice_records")
      .update({
        status: "failed",
        error_message: message,
        next_retry_at: new Date(
          Date.now() + Math.min(86_400_000, 5 * 60_000 * 2 ** (nextAttempt - 1)),
        ).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", record.id)
      .eq("attempt_count", nextAttempt)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (failureUpdateError || !failedRecord)
      return { issued: false as const, reason: "RECORD_UPDATE_FAILED" };
    return { issued: false as const, reason: message || "INVOICE_ISSUE_FAILED" };
  }
}

export async function retryEnterpriseInvoiceRecord(
  invoiceRecordId: string,
  options: { maxAttempts?: number } = {},
) {
  const admin = await supabaseAdmin();
  if (!admin)
    return { issued: false as const, reason: "SERVICE_NOT_CONFIGURED" };
  const { data: record } = await admin
    .from("invoice_records")
    .select(
      "id,organization_id,order_id,record_type,amount_twd,buyer_title,buyer_tax_id,buyer_email",
    )
    .eq("id", invoiceRecordId)
    .maybeSingle();
  if (!record || record.record_type !== "invoice")
    return { issued: false as const, reason: "INVOICE_RECORD_NOT_FOUND" };
  const { data: order } = await admin
    .from("orders")
    .select(
      "id,status,order_kind,amount_twd,order_items(item_type,quantity,unit_price_twd,courses(title))",
    )
    .eq("id", record.order_id)
    .maybeSingle();
  if (
    !order ||
    order.status !== "paid" ||
    order.order_kind !== "enterprise_seat_pack"
  )
    return { issued: false as const, reason: "ORDER_NOT_ISSUABLE" };
  const orderItem = (order.order_items ?? []).find(
    (item) => item.item_type === "seat_pack",
  );
  const course = orderItem
    ? Array.isArray(orderItem.courses)
      ? orderItem.courses[0]
      : orderItem.courses
    : null;
  if (
    !orderItem ||
    !course ||
    typeof record.buyer_title !== "string" ||
    typeof record.buyer_tax_id !== "string" ||
    typeof record.buyer_email !== "string"
  )
    return { issued: false as const, reason: "ORDER_INVOICE_SNAPSHOT_MISSING" };
  const result = await issueEnterpriseInvoiceRecord(
    record.id,
    {
      customerIdentifier: record.buyer_tax_id,
      customerName: record.buyer_title,
      customerEmail: record.buyer_email,
      salesAmountTwd: record.amount_twd,
      items: [
        {
          name: `${course.title}企業培訓名額`,
          count: orderItem.quantity,
          unitPriceTwd: orderItem.unit_price_twd,
          amountTwd: orderItem.quantity * orderItem.unit_price_twd,
        },
      ],
      remark: "歲悅學苑企業培訓課程",
    },
    options.maxAttempts ?? 5,
  );
  if (result.issued && result.invoiceNumber) {
    const { data: organization } = await admin
      .from("organizations")
      .select("name")
      .eq("id", record.organization_id)
      .maybeSingle();
    if (organization) {
      const { sendEnterpriseEmail } = await import("./enterprise-email");
      await sendEnterpriseEmail({
        kind: "invoice",
        to: record.buyer_email,
        organizationId: record.organization_id,
        referenceId: record.id,
        organizationName: organization.name,
        invoiceNumber: result.invoiceNumber,
        amountTwd: record.amount_twd,
      }).catch(() => undefined);
    }
  }
  return result;
}

export async function retryPendingEnterpriseInvoices(limit = 25) {
  const admin = await supabaseAdmin();
  if (!admin)
    return {
      configured: false as const,
      attempted: 0,
      issued: 0,
      failed: 0,
      skipped: 0,
      issuedRecordIds: [] as string[],
    };
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const { data: records, error } = await admin
    .from("invoice_records")
    .select("id")
    .eq("record_type", "invoice")
    .in("status", ["pending", "failed"])
    .lt("attempt_count", 5)
    .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
    .order("updated_at", { ascending: true })
    .limit(safeLimit);
  if (error)
    return {
      configured: true as const,
      attempted: 0,
      issued: 0,
      failed: 0,
      skipped: 0,
      issuedRecordIds: [] as string[],
      error: safeProviderMessage(error.message),
    };
  let issued = 0;
  let failed = 0;
  let skipped = 0;
  const issuedRecordIds: string[] = [];
  for (const record of records ?? []) {
    const result = await retryEnterpriseInvoiceRecord(record.id);
    if (result.issued) {
      issued += 1;
      issuedRecordIds.push(record.id);
    } else if (result.reason === "ALREADY_PROCESSING") skipped += 1;
    else failed += 1;
  }
  return {
    configured: true as const,
    attempted: records?.length ?? 0,
    issued,
    failed,
    skipped,
    issuedRecordIds,
  };
}
