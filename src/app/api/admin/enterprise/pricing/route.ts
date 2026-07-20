import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  getPlatformRole,
} from "@/lib/supabase/server";

const createSchema = z.object({
  courseId: z.string().uuid(),
  minQuantity: z.number().int().min(1).max(10000),
  maxQuantity: z.number().int().min(1).max(10000).nullable(),
  unitPriceTwd: z.number().int().min(1).max(1_000_000),
  effectiveAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
});

export async function GET() {
  if (!(["admin", "support"] as string[]).includes(await getPlatformRole()))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  const { data } = await admin
    .from("course_price_tiers")
    .select("*,courses(id,title,delivery)")
    .order("course_id")
    .order("min_quantity");
  return NextResponse.json({ tiers: data ?? [] });
}

export async function POST(request: Request) {
  if ((await getPlatformRole()) !== "admin")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (
    !parsed.success ||
    (parsed.data.maxQuantity !== null &&
      parsed.data.maxQuantity < parsed.data.minQuantity) ||
    (parsed.data.expiresAt !== null &&
      Date.parse(parsed.data.expiresAt) <= Date.parse(parsed.data.effectiveAt))
  )
    return NextResponse.json({ error: "INVALID_PRICE_TIER" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const actorId = await getAuthenticatedUserId();
  if (!admin || !actorId)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  const { data: currentActor } = await admin.auth.admin.getUserById(actorId);
  if (currentActor.user?.app_metadata?.platform_role !== "admin")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { data: overlapping } = await admin
    .from("course_price_tiers")
    .select("id,min_quantity,max_quantity,effective_at,expires_at")
    .eq("course_id", parsed.data.courseId)
    .eq("active", true);
  if (
    overlapping?.some((tier) => {
      const oldMax = tier.max_quantity ?? Number.POSITIVE_INFINITY;
      const newMax = parsed.data.maxQuantity ?? Number.POSITIVE_INFINITY;
      const oldEnd = tier.expires_at
        ? Date.parse(tier.expires_at)
        : Number.POSITIVE_INFINITY;
      const newEnd = parsed.data.expiresAt
        ? Date.parse(parsed.data.expiresAt)
        : Number.POSITIVE_INFINITY;
      const timeOverlaps =
        Date.parse(parsed.data.effectiveAt) < oldEnd &&
        Date.parse(tier.effective_at) < newEnd;
      return (
        timeOverlaps &&
        parsed.data.minQuantity <= oldMax &&
        tier.min_quantity <= newMax
      );
    })
  )
    return NextResponse.json(
      { error: "OVERLAPPING_PRICE_TIER" },
      { status: 409 },
    );
  const requestedTier = {
    course_id: parsed.data.courseId,
    min_quantity: parsed.data.minQuantity,
    max_quantity: parsed.data.maxQuantity,
    unit_price_twd: parsed.data.unitPriceTwd,
    effective_at: parsed.data.effectiveAt,
    expires_at: parsed.data.expiresAt,
  };
  const { error: requestAuditError } = await admin.from("audit_events").insert({
    actor_id: actorId,
    action: "enterprise.price_tier_create_requested",
    target_type: "course",
    target_id: parsed.data.courseId,
    after_data: requestedTier,
  });
  if (requestAuditError)
    return NextResponse.json(
      { error: "PRICE_TIER_AUDIT_FAILED" },
      { status: 503 },
    );
  const { data, error } = await admin
    .from("course_price_tiers")
    .insert({
      course_id: parsed.data.courseId,
      min_quantity: parsed.data.minQuantity,
      max_quantity: parsed.data.maxQuantity,
      unit_price_twd: parsed.data.unitPriceTwd,
      effective_at: parsed.data.effectiveAt,
      expires_at: parsed.data.expiresAt,
      active: true,
      created_by: actorId,
    })
    .select("*")
    .single();
  if (error)
    return NextResponse.json({ error: "CREATE_FAILED" }, { status: 500 });
  const { error: resultAuditError } = await admin.from("audit_events").insert({
    actor_id: actorId,
    action: "enterprise.price_tier_created",
    target_type: "course_price_tier",
    target_id: data.id,
    after_data: data,
  });
  if (resultAuditError)
    return NextResponse.json(
      { error: "PRICE_TIER_RESULT_AUDIT_FAILED" },
      { status: 503 },
    );
  return NextResponse.json({ tier: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  if ((await getPlatformRole()) !== "admin")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!z.string().uuid().safeParse(id).success)
    return NextResponse.json({ error: "INVALID_TIER" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const actorId = await getAuthenticatedUserId();
  if (!admin || !actorId)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  const { data: currentActor } = await admin.auth.admin.getUserById(actorId);
  if (currentActor.user?.app_metadata?.platform_role !== "admin")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { data: tier } = await admin
    .from("course_price_tiers")
    .select("id,course_id,active")
    .eq("id", id!)
    .maybeSingle();
  if (!tier)
    return NextResponse.json({ error: "TIER_NOT_FOUND" }, { status: 404 });
  const { error: requestAuditError } = await admin.from("audit_events").insert({
    actor_id: actorId,
    action: "enterprise.price_tier_deactivate_requested",
    target_type: "course_price_tier",
    target_id: tier.id,
    before_data: { active: tier.active },
    after_data: { active: false },
  });
  if (requestAuditError)
    return NextResponse.json(
      { error: "PRICE_TIER_AUDIT_FAILED" },
      { status: 503 },
    );
  const { data: deactivated, error } = await admin
    .from("course_price_tiers")
    .update({ active: false })
    .eq("id", id!)
    .eq("active", tier.active)
    .select("id")
    .maybeSingle();
  if (error || !deactivated)
    return NextResponse.json(
      { error: error ? "UPDATE_FAILED" : "TIER_CHANGED" },
      { status: error ? 500 : 409 },
    );
  const { error: resultAuditError } = await admin.from("audit_events").insert({
    actor_id: actorId,
    action: "enterprise.price_tier_deactivated",
    target_type: "course_price_tier",
    target_id: tier.id,
    before_data: { active: tier.active },
    after_data: { active: false },
  });
  if (resultAuditError)
    return NextResponse.json(
      { error: "PRICE_TIER_RESULT_AUDIT_FAILED" },
      { status: 503 },
    );
  return NextResponse.json({ ok: true });
}
