import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
} from "@/lib/supabase/server";

const schema = z.object({
  lessonId: z.string().uuid(),
  deviceFingerprint: z.string().min(8).max(160),
  takeOver: z.boolean().optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_SESSION" }, { status: 400 });
  const userId = await getAuthenticatedUserId();
  const admin = createSupabaseAdminClient();
  if (!userId)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { data: lesson } = await admin
    .from("lessons")
    .select(
      "id,course_modules!inner(course_id),video_assets!lessons_active_video_asset_id_fkey(status)",
    )
    .eq("id", parsed.data.lessonId)
    .maybeSingle();
  const moduleRelation = lesson?.course_modules as unknown as
    | { course_id?: string }
    | { course_id?: string }[]
    | undefined;
  const courseId = Array.isArray(moduleRelation)
    ? moduleRelation[0]?.course_id
    : moduleRelation?.course_id;
  if (!courseId)
    return NextResponse.json({ error: "LESSON_NOT_FOUND" }, { status: 404 });
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("id")
    .eq("learner_id", userId)
    .eq("course_id", courseId)
    .in("status", ["active", "completed"])
    .maybeSingle();
  if (!enrollment)
    return NextResponse.json(
      { error: "COURSE_ACCESS_REQUIRED" },
      { status: 403 },
    );
  const { data: entitlement } = await admin
    .from("entitlements")
    .select("id")
    .eq("user_id", userId)
    .eq("course_id", courseId)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (!entitlement)
    return NextResponse.json(
      { error: "COURSE_ACCESS_REQUIRED" },
      { status: 403 },
    );
  const { data: active } = await admin
    .from("playback_sessions")
    .select("id,device_fingerprint,last_heartbeat_at")
    .eq("learner_id", userId)
    .eq("active", true)
    .maybeSingle();
  const stale = active
    ? Date.now() - new Date(active.last_heartbeat_at).getTime() > 45_000
    : false;
  if (
    active &&
    !stale &&
    active.device_fingerprint === parsed.data.deviceFingerprint
  )
    return NextResponse.json({
      sessionId: active.id,
      resumed: true,
    });
  if (active && !stale && !parsed.data.takeOver)
    return NextResponse.json(
      {
        error: "ACTIVE_SESSION_EXISTS",
        sameDevice: active.device_fingerprint === parsed.data.deviceFingerprint,
        lastHeartbeatAt: active.last_heartbeat_at,
      },
      { status: 409 },
    );
  if (active) {
    await admin
      .from("playback_sessions")
      .update({ active: false, ended_at: new Date().toISOString() })
      .eq("id", active.id);
    await admin
      .from("audit_events")
      .insert({
        actor_id: userId,
        action: stale
          ? "playback.stale_session_closed"
          : "playback.session_taken_over",
        target_type: "playback_session",
        target_id: active.id,
        after_data: { new_device: parsed.data.deviceFingerprint },
      });
  }
  const { data: session, error } = await admin
    .from("playback_sessions")
    .insert({
      enrollment_id: enrollment.id,
      learner_id: userId,
      lesson_id: parsed.data.lessonId,
      device_fingerprint: parsed.data.deviceFingerprint,
    })
    .select("id")
    .single();
  if (error || !session)
    return NextResponse.json(
      { error: "SESSION_CREATE_FAILED" },
      { status: 500 },
    );
  await admin
    .from("playback_segments")
    .insert({
      playback_session_id: session.id,
      segment_number: 1,
      started_at: new Date().toISOString(),
    });
  await admin
    .from("learning_events")
    .insert({
      learner_id: userId,
      enrollment_id: enrollment.id,
      lesson_ref: parsed.data.lessonId,
      event_type: "play",
      payload: { sessionId: session.id },
    });
  return NextResponse.json({ sessionId: session.id });
}
