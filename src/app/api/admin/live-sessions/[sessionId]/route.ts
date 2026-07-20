import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelZoomMeeting, updateZoomMeeting } from "@/lib/zoom";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isPlatformAdmin,
} from "@/lib/supabase/server";

const schema = z.object({
  action: z.enum(["open_sales", "end", "cancel"]),
  reason: z.string().trim().min(5).max(500).optional(),
});
const updateSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    instructorName: z.string().trim().min(2).max(80),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    capacity: z.number().int().min(1).max(1000),
    hostPlanCapacity: z.number().int().min(1).max(1000),
    breaks: z.array(z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime() })).max(10),
  })
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt) && value.capacity <= value.hostPlanCapacity);

export async function PUT(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_LIVE_SESSION" }, { status: 400 });
  const admin = createSupabaseAdminClient(); const actorId = await getAuthenticatedUserId(); const { sessionId } = await params;
  if (!admin || !actorId) return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  const { data: session } = await admin.from("live_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!session) return NextResponse.json({ error: "LIVE_SESSION_NOT_FOUND" }, { status: 404 });
  if (["ended", "cancelled"].includes(session.status)) return NextResponse.json({ error: "LIVE_SESSION_IMMUTABLE" }, { status: 409 });
  const { count } = await admin.from("live_session_bookings").select("id", { count: "exact", head: true }).eq("live_session_id", sessionId).eq("status", "confirmed");
  if ((count ?? 0) > parsed.data.capacity) return NextResponse.json({ error: "CAPACITY_BELOW_SOLD_SEATS" }, { status: 409 });
  const { data: enterpriseAllocations, error: allocationError } = await admin
    .from("enterprise_seat_allocations")
    .select("seat_lot_id")
    .eq("live_session_id", sessionId)
    .in("status", ["assigned", "consumed"]);
  if (allocationError)
    return NextResponse.json(
      { error: "ENTERPRISE_SESSION_VALIDATION_FAILED" },
      { status: 500 },
    );
  const enterpriseLotIds = [
    ...new Set((enterpriseAllocations ?? []).map((item) => item.seat_lot_id)),
  ];
  if (enterpriseLotIds.length) {
    const { data: enterpriseLots, error: lotError } = await admin
      .from("enterprise_seat_lots")
      .select("id,valid_until")
      .in("id", enterpriseLotIds);
    if (lotError)
      return NextResponse.json(
        { error: "ENTERPRISE_SESSION_VALIDATION_FAILED" },
        { status: 500 },
      );
    if (
      (enterpriseLots ?? []).some(
        (lot) => Date.parse(parsed.data.startsAt) > Date.parse(lot.valid_until),
      )
    )
      return NextResponse.json(
        { error: "ENTERPRISE_SEAT_EXPIRY_BEFORE_SESSION" },
        { status: 409 },
      );
  }
  let zoomUpdated = false;
  try {
    if (session.zoom_meeting_id && session.zoom_status === "ready") {
      await updateZoomMeeting(session.zoom_meeting_id, {
        topic: parsed.data.title,
        startsAt: parsed.data.startsAt,
        durationMinutes: Math.ceil(
          (Date.parse(parsed.data.endsAt) - Date.parse(parsed.data.startsAt)) /
            60_000,
        ),
      });
      zoomUpdated = true;
    }
  } catch (cause) {
    return NextResponse.json(
      {
        error: "ZOOM_UPDATE_FAILED",
        message: cause instanceof Error ? cause.message : "Zoom 操作失敗",
      },
      { status: 502 },
    );
  }
  const changes = { title: parsed.data.title, instructor_name: parsed.data.instructorName, starts_at: parsed.data.startsAt, ends_at: parsed.data.endsAt, capacity: parsed.data.capacity, host_plan_capacity: parsed.data.hostPlanCapacity, break_intervals: parsed.data.breaks, join_opens_at: new Date(Date.parse(parsed.data.startsAt) - 10 * 60_000).toISOString() };
  const { error } = await admin.from("live_sessions").update(changes).eq("id", sessionId);
  if (error) {
    let zoomRollbackFailed = false;
    if (zoomUpdated && session.zoom_meeting_id)
      try {
        await updateZoomMeeting(session.zoom_meeting_id, {
          topic: session.title,
          startsAt: session.starts_at,
          durationMinutes: Math.ceil(
            (Date.parse(session.ends_at) - Date.parse(session.starts_at)) /
              60_000,
          ),
        });
      } catch {
        zoomRollbackFailed = true;
      }
    await admin.from("audit_events").insert({
      actor_id: actorId,
      action: "live_session.update_failed",
      target_type: "live_session",
      target_id: sessionId,
      before_data: session,
      after_data: {
        attempted_changes: changes,
        zoom_rollback_failed: zoomRollbackFailed,
      },
    });
    return NextResponse.json(
      {
        error: zoomRollbackFailed
          ? "LIVE_SESSION_UPDATE_REQUIRES_RECONCILIATION"
          : "LIVE_SESSION_UPDATE_FAILED",
        message: error.message,
      },
      { status: 409 },
    );
  }
  await admin.from("audit_events").insert({ actor_id: actorId, action: "live_session.updated", target_type: "live_session", target_id: sessionId, before_data: session, after_data: changes });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (!(await isPlatformAdmin()))
    return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_LIVE_ACTION" }, { status: 400 });
  if (parsed.data.action === "cancel" && !parsed.data.reason)
    return NextResponse.json(
      { error: "CANCELLATION_REASON_REQUIRED" },
      { status: 400 },
    );
  const admin = createSupabaseAdminClient();
  const actorId = await getAuthenticatedUserId();
  const { sessionId } = await params;
  if (!admin || !actorId)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { data: session } = await admin
    .from("live_sessions")
    .select("id,status,zoom_status,zoom_meeting_id,title,starts_at,ends_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session)
    return NextResponse.json(
      { error: "LIVE_SESSION_NOT_FOUND" },
      { status: 404 },
    );
  const nextStatus =
    parsed.data.action === "open_sales"
      ? "open"
      : parsed.data.action === "end"
        ? "ended"
        : "cancelled";
  if (parsed.data.action === "open_sales" && session.zoom_status !== "ready")
    return NextResponse.json(
      { error: "ZOOM_MEETING_NOT_READY" },
      { status: 409 },
    );
  try {
    if (parsed.data.action === "cancel" && session.zoom_meeting_id)
      await cancelZoomMeeting(session.zoom_meeting_id);
    if (parsed.data.action === "open_sales" && session.zoom_meeting_id)
      await updateZoomMeeting(session.zoom_meeting_id, {
        topic: session.title,
        startsAt: session.starts_at,
        durationMinutes: Math.ceil(
          (Date.parse(session.ends_at) - Date.parse(session.starts_at)) /
            60_000,
        ),
      });
  } catch (cause) {
    return NextResponse.json(
      {
        error: "ZOOM_UPDATE_FAILED",
        message: cause instanceof Error ? cause.message : "Zoom 操作失敗",
      },
      { status: 502 },
    );
  }
  const changes =
    parsed.data.action === "cancel"
      ? {
          status: nextStatus,
          zoom_status: "cancelled",
          cancelled_at: new Date().toISOString(),
        }
      : parsed.data.action === "end"
        ? { status: nextStatus, ended_at: new Date().toISOString() }
        : { status: nextStatus };
  const { error } = await admin
    .from("live_sessions")
    .update(changes)
    .eq("id", sessionId);
  if (error)
    return NextResponse.json({ error: "LIVE_ACTION_FAILED" }, { status: 500 });
  if (parsed.data.action === "cancel")
    await admin
      .from("live_session_bookings")
      .update({ status: "cancelled" })
      .eq("live_session_id", sessionId)
      .in("status", ["held", "confirmed"]);
  await admin.from("audit_events").insert({
    actor_id: actorId,
    action: `live_session.${parsed.data.action}`,
    target_type: "live_session",
    target_id: sessionId,
    before_data: { status: session.status },
    after_data: { ...changes, reason: parsed.data.reason },
  });
  return NextResponse.json({ ok: true, status: nextStatus });
}
