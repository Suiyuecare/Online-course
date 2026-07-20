import { createHash } from "node:crypto";
import { Resend } from "resend";
import "server-only";
import {
  EnterpriseEmail,
  type EnterpriseEmailKind,
  type EnterpriseEmailTemplateProps,
} from "@/emails/enterprise-email";
import {
  isSafeNotificationEmail,
  sanitizeInvoiceText,
} from "@/lib/ecpay-invoice-core";
import { appOrigin } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type EnterpriseEmailBase = {
  to: string;
  organizationId: string;
  referenceId: string;
  organizationName: string;
  request?: Request;
  learnerName?: string;
  /** Internal retry handle used by the enterprise operations cron. */
  deliveryId?: string;
};

export type EnterpriseEmailInput = EnterpriseEmailBase & {
  kind: EnterpriseEmailKind;
  decision?: "approved" | "rejected" | "suspended";
  refundDecision?: "paid" | "rejected";
  reminderDays?: 7 | 1;
  reason?: string;
  inviteUrl?: string;
  courseTitle?: string;
  sessionTitle?: string;
  sessionStartsAt?: string;
  dueAt?: string;
  invoiceNumber?: string;
  amountTwd?: number;
};

let resendClient: Resend | null = null;

function resend() {
  if (!process.env.RESEND_API_KEY) return null;
  resendClient ??= new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

function emailSubject(input: EnterpriseEmailInput) {
  switch (input.kind) {
    case "organization_review":
      return input.decision === "approved"
        ? `機構申請已通過｜${input.organizationName}`
        : input.decision === "suspended"
          ? `機構服務已暫停｜${input.organizationName}`
          : `機構申請需要調整｜${input.organizationName}`;
    case "invitation":
      return `邀請您加入｜${input.organizationName}`;
    case "assignment":
      return `企業培訓課程指派｜${input.courseTitle}`;
    case "live_session":
      return `企業直播場次已安排｜${input.courseTitle}`;
    case "deadline":
      return `企業培訓期限提醒｜${input.courseTitle}`;
    case "completion":
      return `企業培訓已完成｜${input.courseTitle}`;
    case "invoice":
      return `電子發票已開立｜${input.invoiceNumber}`;
    case "refund":
      return input.refundDecision === "rejected"
        ? `企業名額退費申請結果｜${input.organizationName}`
        : `企業名額退費已完成｜${input.organizationName}`;
  }
}

function safeUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost")
    throw new Error("INVALID_EMAIL_ACTION_URL");
  return url.toString();
}

function templateProps(input: EnterpriseEmailInput): EnterpriseEmailTemplateProps {
  const dashboardUrl = `${appOrigin(input.request)}/enterprise`;
  const common = {
    kind: input.kind,
    organizationName: sanitizeInvoiceText(input.organizationName, 120),
    learnerName: sanitizeInvoiceText(input.learnerName ?? "", 80),
    actionUrl:
      input.kind === "invitation" && input.inviteUrl
        ? safeUrl(input.inviteUrl)
        : safeUrl(dashboardUrl),
  } satisfies EnterpriseEmailTemplateProps;
  switch (input.kind) {
    case "organization_review":
      return { ...common, decision: input.decision, reason: input.reason };
    case "invitation":
      return common;
    case "assignment":
      return { ...common, courseTitle: input.courseTitle, dueAt: input.dueAt };
    case "live_session":
      return {
        ...common,
        courseTitle: input.courseTitle,
        sessionTitle: input.sessionTitle,
        sessionStartsAt: input.sessionStartsAt,
      };
    case "deadline":
      return { ...common, courseTitle: input.courseTitle, dueAt: input.dueAt };
    case "completion":
      return { ...common, courseTitle: input.courseTitle };
    case "invoice":
      return {
        ...common,
        invoiceNumber: input.invoiceNumber,
        amountTwd: input.amountTwd,
      };
    case "refund":
      return {
        ...common,
        amountTwd: input.amountTwd,
        reason: input.reason,
        refundDecision: input.refundDecision,
      };
  }
}

type EnterpriseDeliveryKind =
  | "organization_approved"
  | "organization_rejected"
  | "organization_suspended"
  | "invitation"
  | "assignment"
  | "live_session"
  | "due_7d"
  | "due_1d"
  | "completion"
  | "invoice"
  | "refund";

function deliveryKind(input: EnterpriseEmailInput): EnterpriseDeliveryKind {
  if (input.kind === "organization_review") {
    if (input.decision === "approved") return "organization_approved";
    if (input.decision === "suspended") return "organization_suspended";
    return "organization_rejected";
  }
  if (input.kind === "deadline")
    return input.reminderDays === 7 ? "due_7d" : "due_1d";
  return input.kind;
}

function deterministicKey(
  kind: string,
  organizationId: string,
  referenceId: string,
  recipient: string,
) {
  const digest = createHash("sha256")
    .update(`${organizationId}|${kind}|${referenceId}|${recipient}`)
    .digest("hex")
    .slice(0, 40);
  return `enterprise-${kind}-${digest}`;
}

function referencedUuid(value: string) {
  return (
    value.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    )?.[0] ?? null
  );
}

async function allocationReferenceUuid(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  input: EnterpriseEmailInput,
) {
  const referenceUuid = referencedUuid(input.referenceId);
  if (input.kind !== "completion") return referenceUuid;
  if (!referenceUuid) return null;
  const { data, error } = await admin
    .from("enterprise_seat_allocations")
    .select("id")
    .eq("enrollment_id", referenceUuid)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (error) throw new Error("ALLOCATION_REFERENCE_LOOKUP_FAILED");
  return data?.id ?? null;
}

function businessReference(input: EnterpriseEmailInput) {
  if (input.kind === "organization_review")
    return `${input.referenceId}:${input.decision ?? "unknown"}`;
  if (input.kind === "invitation" && input.inviteUrl) {
    const tokenDigest = createHash("sha256")
      .update(input.inviteUrl)
      .digest("hex")
      .slice(0, 16);
    return `${input.referenceId}:${tokenDigest}`;
  }
  return input.referenceId;
}

function validPayload(input: EnterpriseEmailInput) {
  if (input.kind === "organization_review") return Boolean(input.decision);
  if (input.kind === "invitation") return Boolean(input.inviteUrl);
  if (input.kind === "deadline")
    return (
      (input.reminderDays === 7 || input.reminderDays === 1) &&
      Boolean(input.courseTitle && input.dueAt)
    );
  if (input.kind === "assignment") return Boolean(input.courseTitle);
  if (input.kind === "live_session")
    return Boolean(
      input.courseTitle && input.sessionTitle && input.sessionStartsAt,
    );
  if (input.kind === "completion") return Boolean(input.courseTitle);
  if (input.kind === "invoice")
    return Boolean(
      input.invoiceNumber?.length === 10 &&
        Number.isSafeInteger(input.amountTwd) &&
        Number(input.amountTwd) > 0,
    );
  if (input.kind === "refund")
    return Boolean(
      (input.refundDecision === "paid" || input.refundDecision === "rejected") &&
        Number.isSafeInteger(input.amountTwd) &&
        Number(input.amountTwd) > 0,
    );
  return true;
}

export async function sendEnterpriseEmail(input: EnterpriseEmailInput) {
  const admin = createSupabaseAdminClient();
  if (!admin)
    return { sent: false as const, reason: "EMAIL_NOT_CONFIGURED" };
  const recipient = input.to.trim().toLowerCase();
  if (!isSafeNotificationEmail(recipient))
    return { sent: false as const, reason: "INVALID_RECIPIENT" };
  if (!input.referenceId.trim())
    return { sent: false as const, reason: "REFERENCE_ID_REQUIRED" };
  if (!validPayload(input))
    return { sent: false as const, reason: "INVALID_EMAIL_PAYLOAD" };

  const storedKind = deliveryKind(input);
  const idempotencyKey = deterministicKey(
    storedKind,
    input.organizationId,
    businessReference(input),
    recipient,
  );
  const lookup = () => {
    let query = admin
      .from("enterprise_email_deliveries")
      .select(
        "id,status,idempotency_key,attempt_count,next_attempt_at,organization_id,recipient_email,kind",
      )
      .eq("organization_id", input.organizationId)
      .eq("recipient_email", recipient)
      .eq("kind", storedKind);
    query = input.deliveryId
      ? query.eq("id", input.deliveryId)
      : query.eq("idempotency_key", idempotencyKey);
    return query.maybeSingle();
  };
  let { data: delivery } = await lookup();
  if (delivery?.status === "sent")
    return { sent: true as const, duplicate: true };
  if (
    delivery?.status === "pending" &&
    Number(delivery.attempt_count) > 0 &&
    delivery.next_attempt_at === null
  )
    return { sent: false as const, reason: "ALREADY_PROCESSING" };
  if (
    delivery?.next_attempt_at &&
    Date.parse(delivery.next_attempt_at) > Date.now()
  )
    return { sent: false as const, reason: "RETRY_NOT_DUE" };
  if (!delivery) {
    const referenceUuid = referencedUuid(input.referenceId);
    let allocationUuid = referenceUuid;
    if (
      ["assignment", "live_session", "deadline", "completion"].includes(
        input.kind,
      )
    ) {
      try {
        allocationUuid = await allocationReferenceUuid(admin, input);
      } catch {
        return {
          sent: false as const,
          reason: "ALLOCATION_REFERENCE_LOOKUP_FAILED",
        };
      }
      if (!allocationUuid)
        return {
          sent: false as const,
          reason: "ALLOCATION_REFERENCE_REQUIRED",
        };
    }
    const { data: created } = await admin
      .from("enterprise_email_deliveries")
      .insert({
        organization_id: input.organizationId,
        recipient_email: recipient,
        reference_id: input.referenceId,
        kind: storedKind,
        idempotency_key: idempotencyKey,
        invitation_id: input.kind === "invitation" ? referenceUuid : null,
        allocation_id:
          ["assignment", "live_session", "deadline", "completion"].includes(
            input.kind,
          )
            ? allocationUuid
            : null,
        invoice_record_id: input.kind === "invoice" ? referenceUuid : null,
        status: "pending",
        attempt_count: 0,
        next_attempt_at: new Date().toISOString(),
      })
      .select(
        "id,status,idempotency_key,attempt_count,next_attempt_at,organization_id,recipient_email,kind",
      )
      .maybeSingle();
    delivery = created ?? (await lookup()).data;
  }
  if (!delivery)
    return { sent: false as const, reason: "DELIVERY_LOCK_FAILED" };

  const client = resend();
  if (!client)
    return { sent: false as const, reason: "EMAIL_NOT_CONFIGURED" };

  let props: EnterpriseEmailTemplateProps;
  try {
    props = templateProps(input);
  } catch {
    return { sent: false as const, reason: "INVALID_EMAIL_ACTION_URL" };
  }
  const nextAttempt = Number(delivery.attempt_count ?? 0) + 1;
  const claimExpiresAt = new Date(Date.now() + 2 * 60_000).toISOString();
  let claim = admin
    .from("enterprise_email_deliveries")
    .update({
      status: "pending",
      attempt_count: nextAttempt,
      next_attempt_at: claimExpiresAt,
      error_message: null,
    })
    .eq("id", delivery.id)
    .eq("attempt_count", delivery.attempt_count ?? 0)
    .in("status", ["pending", "failed"]);
  claim = delivery.next_attempt_at
    ? claim.eq("next_attempt_at", delivery.next_attempt_at)
    : claim.is("next_attempt_at", null);
  const { data: claimed, error: claimError } = await claim
    .select("id")
    .maybeSingle();
  if (claimError)
    return { sent: false as const, reason: "DELIVERY_LOCK_FAILED" };
  if (!claimed) return { sent: false as const, reason: "ALREADY_PROCESSING" };
  try {
    const result = await client.emails.send(
      {
        from:
          process.env.RESEND_FROM_EMAIL ??
          "歲悅學苑 <onboarding@resend.dev>",
        to: recipient,
        subject: emailSubject(input),
        react: <EnterpriseEmail {...props} />,
      },
      {
        headers: {
          "Idempotency-Key": deterministicKey(
            delivery.kind,
            delivery.organization_id,
            delivery.idempotency_key,
            delivery.recipient_email,
          ),
        },
      },
    );
    if (result.error) throw new Error(result.error.message);
    const { data: persisted, error: persistError } = await admin
      .from("enterprise_email_deliveries")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        provider_message_id: result.data?.id ?? null,
        error_message: null,
        next_attempt_at: null,
      })
      .eq("id", delivery.id)
      .eq("attempt_count", nextAttempt)
      .eq("next_attempt_at", claimExpiresAt)
      .select("id")
      .maybeSingle();
    if (persistError || !persisted)
      return {
        sent: false as const,
        reason: "EMAIL_PROVIDER_ACCEPTED_RECONCILIATION_REQUIRED",
        providerMessageId: result.data?.id ?? null,
      };
    return { sent: true as const, providerMessageId: result.data?.id ?? null };
  } catch (error) {
    const message = sanitizeInvoiceText(
      error instanceof Error ? error.message : "EMAIL_SEND_FAILED",
      400,
    );
    const { data: failed, error: failurePersistError } = await admin
      .from("enterprise_email_deliveries")
      .update({
        status: "failed",
        error_message: message,
        next_attempt_at: new Date(
          Date.now() + Math.min(86_400_000, 5 * 60_000 * 2 ** (nextAttempt - 1)),
        ).toISOString(),
      })
      .eq("id", delivery.id)
      .eq("attempt_count", nextAttempt)
      .eq("next_attempt_at", claimExpiresAt)
      .select("id")
      .maybeSingle();
    if (failurePersistError || !failed)
      return {
        sent: false as const,
        reason: "EMAIL_FAILURE_STATE_PERSIST_FAILED",
      };
    return { sent: false as const, reason: message || "EMAIL_SEND_FAILED" };
  }
}
