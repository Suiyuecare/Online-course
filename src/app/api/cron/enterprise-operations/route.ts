import { NextResponse } from "next/server";
import {
  isEcpayInvoiceConfigured,
  retryPendingEnterpriseInvoices,
} from "@/lib/ecpay-invoice";
import {
  sendEnterpriseEmail,
  type EnterpriseEmailInput,
} from "@/lib/enterprise-email";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

function related<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function inBatches<T>(
  values: T[],
  batchSize: number,
  worker: (value: T) => Promise<void>,
) {
  for (let index = 0; index < values.length; index += batchSize)
    await Promise.all(values.slice(index, index + batchSize).map(worker));
}

const PAGE_SIZE = 250;

async function learnerEmails(
  admin: AdminClient,
  learnerIds: string[],
) {
  const wanted = new Set(learnerIds);
  const emails = new Map<string, string>();
  let page = 1;
  while (wanted.size > emails.size) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1_000,
    });
    if (error) return { emails, error: error.message };
    for (const user of data.users) {
      if (wanted.has(user.id) && user.email) emails.set(user.id, user.email);
    }
    if (data.users.length < 1_000) break;
    page += 1;
  }
  return { emails, error: null };
}

async function learnerNames(admin: AdminClient, learnerIds: string[]) {
  const names = new Map<string, string>();
  for (let index = 0; index < learnerIds.length; index += PAGE_SIZE) {
    const { data } = await admin
      .from("profiles")
      .select("id,full_name")
      .in("id", learnerIds.slice(index, index + PAGE_SIZE));
    for (const profile of data ?? [])
      if (profile.full_name) names.set(profile.id, profile.full_name);
  }
  return names;
}

function referencedUuids(value: string | null) {
  return (
    value?.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
    ) ?? []
  );
}

async function suppressDelivery(
  admin: AdminClient,
  deliveryId: string,
  reason: string,
) {
  const { error } = await admin
    .from("enterprise_email_deliveries")
    .update({
      status: "suppressed",
      error_message: reason,
      next_attempt_at: null,
    })
    .eq("id", deliveryId)
    .in("status", ["pending", "failed"]);
  return error?.message ?? null;
}

async function deferDelivery(
  admin: AdminClient,
  deliveryId: string,
  reason: string,
) {
  const { error } = await admin
    .from("enterprise_email_deliveries")
    .update({
      status: "failed",
      error_message: reason,
      next_attempt_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    })
    .eq("id", deliveryId)
    .in("status", ["pending", "failed"]);
  return error?.message ?? null;
}

async function expireSeatLots(admin: AdminClient, now: string) {
  const { data, error } = await admin.rpc("expire_enterprise_seat_lots", {
    target_now: now,
  });
  return {
    expired: Array.isArray(data)
      ? data.length
      : Number.isFinite(Number(data))
        ? Number(data)
        : 0,
    error: error?.message ?? null,
  };
}

async function expireAllowanceClaims(admin: AdminClient, now: string) {
  const { data, error } = await admin.rpc("expire_enterprise_allowance_claims", {
    target_now: now,
  });
  return {
    ambiguous: Number.isFinite(Number(data)) ? Number(data) : 0,
    error: error?.message ?? null,
  };
}

async function deadlineReminders(
  admin: AdminClient,
  request: Request,
  now: Date,
) {
  let attempted = 0;
  let sent = 0;
  let missingRecipients = 0;
  let emailNotConfigured = false;
  const errors: string[] = [];
  const attemptedReferences = new Set<string>();
  type DueAllocation = {
    id: string;
    organization_id: string;
    learner_id: string;
    due_at: string | null;
    organizations: { name: string } | { name: string }[] | null;
    courses: { title: string } | { title: string }[] | null;
    days: 7 | 1;
  };
  const candidates: DueAllocation[] = [];

  for (const days of [7, 1] as const) {
    const target = now.getTime() + days * 86_400_000;
    const lower = new Date(target - 65 * 60_000).toISOString();
    const upper = new Date(target + 65 * 60_000).toISOString();
    let offset = 0;
    while (true) {
      const { data, error } = await admin
        .from("enterprise_seat_allocations")
        .select(
          "id,organization_id,learner_id,due_at,status,organizations(name),courses(title)",
        )
        .in("status", ["assigned", "consumed"])
        .gte("due_at", lower)
        .lte("due_at", upper)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        errors.push(error.message);
        break;
      }
      candidates.push(
        ...(data ?? []).map((allocation) => ({ ...allocation, days })),
      );
      if ((data?.length ?? 0) < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  const learnerIds = [...new Set(candidates.map((item) => item.learner_id))];
  const [{ emails, error: learnerEmailError }, names] = await Promise.all([
    learnerEmails(admin, learnerIds),
    learnerNames(admin, learnerIds),
  ]);
  if (learnerEmailError) errors.push(learnerEmailError);

  async function deliver(
    allocation: DueAllocation,
  ) {
    const organization = related(allocation.organizations);
    const course = related(allocation.courses);
    if (!organization || !course || !allocation.due_at) return;
    const referenceId = `${allocation.id}:deadline:${allocation.days}d`;
    if (attemptedReferences.has(referenceId)) return;
    attemptedReferences.add(referenceId);
    const recipient = emails.get(allocation.learner_id);
    if (!recipient) {
      missingRecipients += 1;
      return;
    }
    attempted += 1;
    const result = await sendEnterpriseEmail({
      kind: "deadline",
      to: recipient,
      organizationId: allocation.organization_id,
      referenceId,
      organizationName: organization.name,
      learnerName: names.get(allocation.learner_id),
      courseTitle: course.title,
      dueAt: allocation.due_at,
      reminderDays: allocation.days,
      request,
    });
    if (result.sent) sent += 1;
    else if (result.reason === "EMAIL_NOT_CONFIGURED")
      emailNotConfigured = true;
    else errors.push(`DEADLINE_DELIVERY_FAILED:${result.reason}`);
  }

  await inBatches(candidates, 10, deliver);
  if (missingRecipients > 0)
    errors.push(`DEADLINE_RECIPIENTS_MISSING:${missingRecipients}`);
  return {
    eligible: candidates.length,
    attempted,
    sent,
    missingRecipients,
    emailNotConfigured,
    errors,
  };
}

type RetryDelivery = {
  id: string;
  organization_id: string;
  recipient_email: string;
  reference_id: string | null;
  kind: string;
  allocation_id: string | null;
  invoice_record_id: string | null;
};

type RebuiltDelivery =
  | { input: EnterpriseEmailInput }
  | { suppress: string }
  | { retry: string };

async function rebuildDelivery(
  admin: AdminClient,
  request: Request,
  delivery: RetryDelivery,
): Promise<RebuiltDelivery> {
  const base = {
    to: delivery.recipient_email,
    organizationId: delivery.organization_id,
    referenceId: delivery.reference_id ?? delivery.id,
    request,
    deliveryId: delivery.id,
  };

  if (delivery.kind === "invitation")
    return { suppress: "MANUAL_RESEND_REQUIRED_INVITATION_TOKEN_NOT_RECOVERABLE" };

  if (
    [
      "organization_approved",
      "organization_rejected",
      "organization_suspended",
    ].includes(delivery.kind)
  ) {
    const decision = delivery.kind.replace("organization_", "") as
      | "approved"
      | "rejected"
      | "suspended";
    const { data: organization, error } = await admin
      .from("organizations")
      .select("name,status,review_note")
      .eq("id", delivery.organization_id)
      .maybeSingle();
    if (error) return { retry: "ORGANIZATION_RETRY_LOOKUP_FAILED" };
    if (!organization) return { suppress: "ORGANIZATION_NO_LONGER_EXISTS" };
    if (organization.status !== decision)
      return { suppress: "ORGANIZATION_NOTIFICATION_OBSOLETE" };
    return {
      input: {
        ...base,
        kind: "organization_review",
        organizationName: organization.name,
        decision,
        reason: organization.review_note ?? undefined,
      },
    };
  }

  if (
    ["assignment", "live_session", "due_7d", "due_1d", "completion"].includes(
      delivery.kind,
    )
  ) {
    if (!delivery.allocation_id)
      return { suppress: "ALLOCATION_REFERENCE_MISSING" };
    const { data: allocation, error } = await admin
      .from("enterprise_seat_allocations")
      .select(
        "id,organization_id,learner_id,status,due_at,live_session_id,enrollment_id,organizations(name),courses(title),live_sessions(title,starts_at)",
      )
      .eq("id", delivery.allocation_id)
      .eq("organization_id", delivery.organization_id)
      .maybeSingle();
    if (error) return { retry: "ALLOCATION_RETRY_LOOKUP_FAILED" };
    if (!allocation) return { suppress: "ALLOCATION_NO_LONGER_EXISTS" };
    const organization = related(allocation.organizations);
    const course = related(allocation.courses);
    if (!organization || !course)
      return { suppress: "ALLOCATION_RELATED_DATA_MISSING" };
    if (!['assigned', 'consumed'].includes(allocation.status))
      return { suppress: "ALLOCATION_NOTIFICATION_OBSOLETE" };
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", allocation.learner_id)
      .maybeSingle();
    const common = {
      ...base,
      organizationName: organization.name,
      learnerName: profile?.full_name || undefined,
      courseTitle: course.title,
    };
    if (delivery.kind === "assignment")
      return {
        input: {
          ...common,
          kind: "assignment",
          dueAt: allocation.due_at ?? undefined,
        },
      };
    if (delivery.kind === "live_session") {
      const referenceSessionId = referencedUuids(delivery.reference_id)[1];
      if (
        !referenceSessionId ||
        allocation.live_session_id !== referenceSessionId
      )
        return { suppress: "LIVE_SESSION_NOTIFICATION_OBSOLETE" };
      const session = related(allocation.live_sessions);
      if (!session) return { retry: "LIVE_SESSION_RETRY_LOOKUP_FAILED" };
      return {
        input: {
          ...common,
          kind: "live_session",
          sessionTitle: session.title,
          sessionStartsAt: session.starts_at,
        },
      };
    }
    if (delivery.kind === "due_7d" || delivery.kind === "due_1d") {
      if (!allocation.due_at)
        return { suppress: "DEADLINE_NOTIFICATION_OBSOLETE" };
      const reminderDays = delivery.kind === "due_7d" ? 7 : 1;
      const remainingMs = Date.parse(allocation.due_at) - Date.now();
      if (
        !Number.isFinite(remainingMs) ||
        remainingMs <= 0 ||
        remainingMs > reminderDays * 86_400_000 + 2 * 60 * 60_000
      )
        return { suppress: "DEADLINE_NOTIFICATION_OBSOLETE" };
      return {
        input: {
          ...common,
          kind: "deadline",
          dueAt: allocation.due_at,
          reminderDays,
        },
      };
    }
    if (!allocation.enrollment_id)
      return { suppress: "COMPLETION_ENROLLMENT_MISSING" };
    return { input: { ...common, kind: "completion" } };
  }

  if (delivery.kind === "refund") {
    const refundId = referencedUuids(delivery.reference_id)[0];
    if (!refundId) return { suppress: "REFUND_REFERENCE_MISSING" };
    const { data: refund, error } = await admin
      .from("refunds")
      .select(
        "id,status,amount_twd,reason,decision_reason,organizations(name)",
      )
      .eq("id", refundId)
      .eq("organization_id", delivery.organization_id)
      .eq("refund_scope", "enterprise_seats")
      .maybeSingle();
    if (error) return { retry: "REFUND_RETRY_LOOKUP_FAILED" };
    if (!refund) return { suppress: "REFUND_NO_LONGER_EXISTS" };
    const decision = delivery.reference_id?.endsWith(":rejected")
      ? "rejected"
      : delivery.reference_id?.endsWith(":paid")
        ? "paid"
        : null;
    if (!decision) return { suppress: "REFUND_DECISION_NOT_RECOVERABLE" };
    if (refund.status !== decision)
      return { suppress: "REFUND_NOTIFICATION_OBSOLETE" };
    const organization = related(refund.organizations);
    if (!organization) return { suppress: "REFUND_ORGANIZATION_MISSING" };
    return {
      input: {
        ...base,
        kind: "refund",
        organizationName: organization.name,
        amountTwd: refund.amount_twd,
        reason: refund.decision_reason || refund.reason,
        refundDecision: decision,
      },
    };
  }

  return { suppress: `MANUAL_RETRY_REQUIRED_UNSUPPORTED_KIND:${delivery.kind}` };
}

async function retryEnterpriseNotifications(
  admin: AdminClient,
  request: Request,
  now: Date,
) {
  const errors: string[] = [];
  let attempted = 0;
  let sent = 0;
  let suppressed = 0;
  let deferred = 0;
  let manualActionRequired = 0;
  const manualReasons = new Map<string, number>();
  let emailNotConfigured = false;
  const { data, error } = await admin
    .from("enterprise_email_deliveries")
    .select(
      "id,organization_id,recipient_email,reference_id,kind,allocation_id,invoice_record_id",
    )
    .in("status", ["pending", "failed"])
    .neq("kind", "invoice")
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now.toISOString()}`)
    .order("next_attempt_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(250);
  if (error)
    return {
      attempted,
      sent,
      suppressed,
      deferred,
      manualActionRequired,
      manualReasons: {},
      emailNotConfigured,
      errors: [error.message],
    };

  await inBatches(data ?? [], 10, async (delivery) => {
    const rebuilt = await rebuildDelivery(admin, request, delivery);
    if ("suppress" in rebuilt) {
      const suppressionError = await suppressDelivery(
        admin,
        delivery.id,
        rebuilt.suppress,
      );
      if (suppressionError) errors.push(suppressionError);
      else {
        suppressed += 1;
        if (rebuilt.suppress.startsWith("MANUAL_")) {
          manualActionRequired += 1;
          manualReasons.set(
            rebuilt.suppress,
            (manualReasons.get(rebuilt.suppress) ?? 0) + 1,
          );
        }
      }
      return;
    }
    if ("retry" in rebuilt) {
      const deferralError = await deferDelivery(
        admin,
        delivery.id,
        rebuilt.retry,
      );
      if (deferralError) errors.push(deferralError);
      else deferred += 1;
      return;
    }
    attempted += 1;
    const result = await sendEnterpriseEmail(rebuilt.input);
    if (result.sent) sent += 1;
    else if (result.reason === "EMAIL_NOT_CONFIGURED") {
      emailNotConfigured = true;
      const deferralError = await deferDelivery(
        admin,
        delivery.id,
        result.reason,
      );
      if (deferralError) errors.push(deferralError);
      else deferred += 1;
    }
    else if (
      ["INVALID_EMAIL_PAYLOAD", "INVALID_EMAIL_ACTION_URL"].includes(
        result.reason,
      )
    ) {
      const suppressionError = await suppressDelivery(
        admin,
        delivery.id,
        result.reason,
      );
      if (suppressionError) errors.push(suppressionError);
      else suppressed += 1;
    } else if (
      [
        "ALREADY_PROCESSING",
        "DELIVERY_LOCK_FAILED",
        "EMAIL_PROVIDER_ACCEPTED_RECONCILIATION_REQUIRED",
        "EMAIL_FAILURE_STATE_PERSIST_FAILED",
      ].includes(result.reason)
    ) {
      const deferralError = await deferDelivery(
        admin,
        delivery.id,
        result.reason,
      );
      if (deferralError) errors.push(deferralError);
      else deferred += 1;
    }
  });
  return {
    attempted,
    sent,
    suppressed,
    deferred,
    manualActionRequired,
    manualReasons: Object.fromEntries(manualReasons),
    emailNotConfigured,
    errors,
  };
}

async function invoiceNotifications(
  admin: AdminClient,
  recordIds: string[],
  request: Request,
) {
  let attempted = 0;
  let sent = 0;
  let emailNotConfigured = false;
  const errors: string[] = [];
  const candidates = new Map(recordIds.map((id) => [id, null as string | null]));
  const { data: pending, error: pendingError } = await admin
    .from("enterprise_email_deliveries")
    .select("id,invoice_record_id")
    .eq("kind", "invoice")
    .in("status", ["pending", "failed"])
    .not("invoice_record_id", "is", null)
    .or(
      `next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`,
    )
    .order("created_at", { ascending: true })
    .limit(50);
  if (pendingError) errors.push(pendingError.message);
  for (const delivery of pending ?? [])
    if (delivery.invoice_record_id)
      candidates.set(delivery.invoice_record_id, delivery.id);
  await inBatches([...candidates.entries()], 5, async ([recordId, deliveryId]) => {
    const { data: record, error } = await admin
      .from("invoice_records")
      .select(
        "id,organization_id,invoice_number,buyer_email,amount_twd,organizations(name)",
      )
      .eq("id", recordId)
      .eq("status", "issued")
      .maybeSingle();
    if (error) {
      if (deliveryId) {
        const deferralError = await deferDelivery(
          admin,
          deliveryId,
          "INVOICE_EMAIL_RETRY_LOOKUP_FAILED",
        );
        if (deferralError) errors.push(deferralError);
      } else errors.push(error.message);
      return;
    }
    const organization = related(record?.organizations);
    if (
      !record ||
      !organization ||
      !record.buyer_email ||
      !record.invoice_number
    ) {
      if (deliveryId) {
        const suppressionError = await suppressDelivery(
          admin,
          deliveryId,
          "INVOICE_NOTIFICATION_OBSOLETE_OR_INCOMPLETE",
        );
        if (suppressionError) errors.push(suppressionError);
      }
      return;
    }
    attempted += 1;
    const result = await sendEnterpriseEmail({
      kind: "invoice",
      to: record.buyer_email,
      organizationId: record.organization_id,
      referenceId: record.id,
      organizationName: organization.name,
      invoiceNumber: record.invoice_number,
      amountTwd: record.amount_twd,
      request,
      deliveryId: deliveryId ?? undefined,
    });
    if (result.sent) sent += 1;
    else if (result.reason === "EMAIL_NOT_CONFIGURED") {
      emailNotConfigured = true;
      if (deliveryId) {
        const deferralError = await deferDelivery(
          admin,
          deliveryId,
          result.reason,
        );
        if (deferralError) errors.push(deferralError);
      }
    } else {
      if (deliveryId) {
        const deferralError = await deferDelivery(
          admin,
          deliveryId,
          result.reason,
        );
        if (deferralError) errors.push(deferralError);
      } else errors.push(`INVOICE_EMAIL_DELIVERY_FAILED:${result.reason}`);
    }
  });
  return { attempted, sent, emailNotConfigured, errors };
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (
    !expected ||
    request.headers.get("authorization") !== `Bearer ${expected}`
  )
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );

  const now = new Date();
  const [expiration, allowanceClaimExpiration] = await Promise.all([
    expireSeatLots(admin, now.toISOString()),
    expireAllowanceClaims(admin, now.toISOString()),
  ]);
  const invoiceRetry = await retryPendingEnterpriseInvoices(25);
  const reminders = await deadlineReminders(admin, request, now);
  const [notificationRetries, invoiceEmails] = await Promise.all([
    retryEnterpriseNotifications(admin, request, now),
    invoiceNotifications(admin, invoiceRetry.issuedRecordIds, request),
  ]);
  const invoiceUnavailable =
    invoiceRetry.attempted > 0 && !isEcpayInvoiceConfigured();
  const invoiceFailures = invoiceRetry.failed > 0;
  const emailUnavailable =
    reminders.emailNotConfigured ||
    notificationRetries.emailNotConfigured ||
    invoiceEmails.emailNotConfigured;
  const errors = [
    expiration.error,
    allowanceClaimExpiration.error,
    "error" in invoiceRetry ? invoiceRetry.error : null,
    ...reminders.errors,
    ...notificationRetries.errors,
    ...invoiceEmails.errors,
  ].filter(Boolean);
  const ok =
    !invoiceUnavailable &&
    !invoiceFailures &&
    !emailUnavailable &&
    notificationRetries.manualActionRequired === 0 &&
    errors.length === 0;
  return NextResponse.json(
    {
      ok,
      expiredSeatLots: expiration.expired,
      ambiguousAllowanceClaims: allowanceClaimExpiration.ambiguous,
      invoices: {
        attempted: invoiceRetry.attempted,
        issued: invoiceRetry.issued,
        failed: invoiceRetry.failed,
        skipped: invoiceRetry.skipped,
        configured: isEcpayInvoiceConfigured(),
      },
      reminders: {
        eligible: reminders.eligible,
        attempted: reminders.attempted,
        sent: reminders.sent,
        missingRecipients: reminders.missingRecipients,
      },
      notificationRetries: {
        attempted: notificationRetries.attempted,
        sent: notificationRetries.sent,
        suppressed: notificationRetries.suppressed,
        deferred: notificationRetries.deferred,
        manualActionRequired: notificationRetries.manualActionRequired,
        manualReasons: notificationRetries.manualReasons,
      },
      invoiceEmails: {
        attempted: invoiceEmails.attempted,
        sent: invoiceEmails.sent,
      },
      errors,
    },
    { status: ok ? 200 : invoiceUnavailable || emailUnavailable ? 503 : 500 },
  );
}
