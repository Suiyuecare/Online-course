import { NextResponse } from "next/server";
import { z } from "zod";
import {
  canManageOrganization,
  isEnterpriseEnabled,
} from "@/lib/enterprise-core";
import {
  getAuthenticatedIdentity,
  getOrganizationContext,
} from "@/lib/enterprise";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

const requestSchema = z.object({
  organizationId: z.string().uuid(),
  orderId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  quantity: z.number().int().min(1).max(10_000),
  reason: z.string().trim().min(5).max(500),
});

export async function POST(request: Request) {
  if (!isEnterpriseEnabled())
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_REFUND_REQUEST" }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const identity = await getAuthenticatedIdentity(supabase);
  const admin = createSupabaseAdminClient();
  if (!identity)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  const context = await getOrganizationContext(
    admin,
    identity.id,
    parsed.data.organizationId,
  );
  if (
    !context ||
    !canManageOrganization(context.role)
  )
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (
    context.organization.status !== "approved" ||
    !context.organization.active
  )
    return NextResponse.json(
      { error: "ORGANIZATION_NOT_ACTIVE" },
      { status: 409 },
    );
  const { data: order } = await admin
    .from("orders")
    .select("id,organization_id,status,order_kind")
    .eq("id", parsed.data.orderId)
    .eq("organization_id", context.organizationId)
    .maybeSingle();
  if (!order || order.order_kind !== "enterprise_seat_pack")
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  const { data, error } = await admin.rpc("request_enterprise_refund", {
    target_order_id: order.id,
    target_seat_quantity: parsed.data.quantity,
    target_reason: parsed.data.reason,
    target_actor_id: identity.id,
    target_request_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error)
    return NextResponse.json(
      {
        error: error.message.includes("INSUFFICIENT_UNUSED")
          ? "INSUFFICIENT_UNUSED_SEATS"
          : error.message.includes("IDEMPOTENCY_SNAPSHOT_MISMATCH")
            ? "IDEMPOTENCY_SNAPSHOT_MISMATCH"
            : error.message.includes("NOT_REFUNDABLE")
              ? "ORDER_NOT_REFUNDABLE"
              : "REFUND_REQUEST_FAILED",
        message: error.message,
      },
      { status: 409 },
    );
  return NextResponse.json({ refund: data }, { status: 201 });
}
