import { NextResponse } from "next/server";
import { z } from "zod";
import { maybeCompleteEnrollment } from "@/lib/completion";
import { consumeEnterpriseAllocation } from "@/lib/enterprise-learning";
import { presenceIntervalSeconds } from "@/lib/env";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
} from "@/lib/supabase/server";

const schema = z.object({
  sessionId: z.string().uuid(),
  positionSeconds: z.number().int().nonnegative().max(86400),
  pageVisible: z.boolean(),
  playerPlaying: z.boolean(),
  online: z.boolean(),
  ended: z.boolean().optional(),
  confirmChallengeId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_HEARTBEAT" }, { status: 400 });
  const userId = await getAuthenticatedUserId();
  const admin = createSupabaseAdminClient();
  if (!userId)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const now = new Date();
  const interval = presenceIntervalSeconds();
  const { data: session } = await admin
    .from("playback_sessions")
    .select("id,enrollment_id,lesson_id,last_heartbeat_at,active")
    .eq("id", parsed.data.sessionId)
    .eq("learner_id", userId)
    .maybeSingle();
  if (!session?.active)
    return NextResponse.json({ error: "SESSION_INACTIVE" }, { status: 409 });
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("id,course_id,status")
    .eq("id", session.enrollment_id)
    .eq("learner_id", userId)
    .in("status", ["active", "completed"])
    .maybeSingle();
  const { data: entitlement } = enrollment
    ? await admin
        .from("entitlements")
        .select("id")
        .eq("user_id", userId)
        .eq("course_id", enrollment.course_id)
        .eq("active", true)
        .limit(1)
        .maybeSingle()
    : { data: null };
  if (!enrollment || !entitlement) {
    await admin
      .from("playback_sessions")
      .update({ active: false, ended_at: now.toISOString() })
      .eq("id", session.id)
      .eq("active", true);
    return NextResponse.json({ error: "COURSE_ACCESS_REVOKED" }, { status: 403 });
  }
  const previousHeartbeatAt = Date.parse(session.last_heartbeat_at);
  if (!Number.isFinite(previousHeartbeatAt))
    return NextResponse.json(
      { error: "INVALID_SESSION_HEARTBEAT" },
      { status: 409 },
    );
  const claimedHeartbeatAt = new Date(
    Math.max(now.getTime(), previousHeartbeatAt + 1),
  );
  const { data: touchedSession } = await admin
    .from("playback_sessions")
    .update({ last_heartbeat_at: claimedHeartbeatAt.toISOString() })
    .eq("id", session.id)
    .eq("active", true)
    .eq("last_heartbeat_at", session.last_heartbeat_at)
    .select("id")
    .maybeSingle();
  if (!touchedSession)
    return NextResponse.json({
      ok: true,
      duplicate: true,
      countedSeconds: 0,
      savedAt: now.toISOString(),
    });
  const { data: segment } = await admin
    .from("playback_segments")
    .select("id,segment_number,active_seconds,counts_toward_completion")
    .eq("playback_session_id", session.id)
    .is("ended_at", null)
    .order("segment_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!segment)
    return NextResponse.json({ error: "SEGMENT_NOT_FOUND" }, { status: 409 });

  if (parsed.data.confirmChallengeId) {
    const { data: challenge } = await admin
      .from("presence_challenges")
      .select("id,expires_at,confirmed_at,segment_number")
      .eq("id", parsed.data.confirmChallengeId)
      .eq("playback_session_id", session.id)
      .maybeSingle();
    if (
      !challenge ||
      challenge.confirmed_at ||
      new Date(challenge.expires_at) < now
    )
      return NextResponse.json({ error: "PRESENCE_EXPIRED" }, { status: 409 });
    await admin
      .from("presence_challenges")
      .update({ confirmed_at: now.toISOString() })
      .eq("id", challenge.id);
    const { data: confirmedSegment } = await admin
      .from("playback_segments")
      .update({
        presence_confirmed_at: now.toISOString(),
        counts_toward_completion: true,
        ended_at: now.toISOString(),
      })
      .eq("playback_session_id", session.id)
      .eq("segment_number", challenge.segment_number)
      .is("presence_confirmed_at", null)
      .is("ended_at", null)
      .select("active_seconds")
      .maybeSingle();
    if (!confirmedSegment)
      return NextResponse.json({
        ok: true,
        confirmed: true,
        duplicate: true,
        savedAt: now.toISOString(),
      });
    const credited = await creditProgress(
      admin,
      session.enrollment_id,
      session.lesson_id,
      parsed.data.positionSeconds,
      confirmedSegment?.active_seconds ?? 0,
    );
    const enterpriseSeat =
      credited && (confirmedSegment?.active_seconds ?? 0) > 0
        ? await consumeEnterpriseAllocation(admin, userId, {
            enrollmentId: session.enrollment_id,
          })
        : undefined;
    await admin
      .from("learning_events")
      .insert({
        learner_id: userId,
        enrollment_id: session.enrollment_id,
        lesson_ref: session.lesson_id,
        event_type: "presence_confirmed",
        position_seconds: parsed.data.positionSeconds,
        payload: { sessionId: session.id, challengeId: challenge.id },
      });
    await admin
      .from("playback_segments")
      .insert({
        playback_session_id: session.id,
        segment_number: challenge.segment_number + 1,
        started_at: now.toISOString(),
      });
    return NextResponse.json({
      ok: true,
      confirmed: true,
      enterpriseSeat,
      completion: await maybeCompleteEnrollment(admin, session.enrollment_id),
      savedAt: now.toISOString(),
    });
  }

  const elapsed = Math.max(
    0,
    Math.min(
      20,
      Math.floor(
        (claimedHeartbeatAt.getTime() - previousHeartbeatAt) / 1000,
      ),
    ),
  );
  const countable =
    parsed.data.pageVisible && parsed.data.playerPlaying && parsed.data.online;
  const nextSeconds = Math.min(
    interval,
    segment.active_seconds + (countable ? elapsed : 0),
  );
  const { data: updatedSegmentResult, error: segmentUpdateError } =
    await admin.rpc("update_playback_segment_active_seconds", {
      target_segment_id: segment.id,
      target_learner_id: userId,
      target_next_active_seconds: nextSeconds,
    });
  const updatedSegment = Array.isArray(updatedSegmentResult)
    ? updatedSegmentResult[0]
    : updatedSegmentResult;
  if (segmentUpdateError) {
    const accessExpired =
      segmentUpdateError.message.includes("ENTERPRISE_SEAT_LOT_EXPIRED") ||
      segmentUpdateError.message.includes("ENTERPRISE_ALLOCATION_INACTIVE");
    if (accessExpired)
      await admin
        .from("playback_sessions")
        .update({ active: false, ended_at: now.toISOString() })
        .eq("id", session.id)
        .eq("active", true);
    return NextResponse.json(
      { error: accessExpired ? "ENTERPRISE_SEAT_EXPIRED" : "SEGMENT_UPDATE_FAILED" },
      { status: accessExpired ? 403 : 409 },
    );
  }
  if (!updatedSegment)
    return NextResponse.json({ error: "SEGMENT_CLOSED" }, { status: 409 });
  const enterpriseSeat =
    countable && elapsed > 0
      ? await consumeEnterpriseAllocation(admin, userId, {
          enrollmentId: session.enrollment_id,
        })
      : undefined;
  await admin
    .from("learning_events")
    .insert({
      learner_id: userId,
      enrollment_id: session.enrollment_id,
      lesson_ref: session.lesson_id,
      event_type: parsed.data.ended ? "ended" : "heartbeat",
      position_seconds: parsed.data.positionSeconds,
      payload: {
        sessionId: session.id,
        pageVisible: parsed.data.pageVisible,
        playerPlaying: parsed.data.playerPlaying,
        online: parsed.data.online,
        serverCountedSeconds: countable ? elapsed : 0,
      },
    });

  if (parsed.data.ended && nextSeconds > 0 && nextSeconds < interval) {
    await admin
      .from("playback_segments")
      .update({
        ended_at: now.toISOString(),
        counts_toward_completion: true,
        presence_confirmed_at: now.toISOString(),
      })
      .eq("id", segment.id);
    const credited = await creditProgress(
      admin,
      session.enrollment_id,
      session.lesson_id,
      parsed.data.positionSeconds,
      nextSeconds,
    );
    const creditedEnterpriseSeat = credited
      ? await consumeEnterpriseAllocation(admin, userId, {
          enrollmentId: session.enrollment_id,
        })
      : undefined;
    await admin
      .from("playback_sessions")
      .update({ active: false, ended_at: now.toISOString() })
      .eq("id", session.id);
    return NextResponse.json({
      ok: true,
      ended: true,
      enterpriseSeat: enterpriseSeat ?? creditedEnterpriseSeat,
      completion: await maybeCompleteEnrollment(admin, session.enrollment_id),
      savedAt: now.toISOString(),
    });
  }

  if (nextSeconds >= interval) {
    const expiresAt = new Date(now.getTime() + 2 * 60 * 1000);
    const { data: challenge } = await admin
      .from("presence_challenges")
      .upsert(
        {
          playback_session_id: session.id,
          segment_number: segment.segment_number,
          requested_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        },
        { onConflict: "playback_session_id,segment_number" },
      )
      .select("id,expires_at")
      .single();
    await admin
      .from("learning_events")
      .insert({
        learner_id: userId,
        enrollment_id: session.enrollment_id,
        lesson_ref: session.lesson_id,
        event_type: "presence_requested",
        position_seconds: parsed.data.positionSeconds,
        payload: { sessionId: session.id, challengeId: challenge?.id },
      });
    return NextResponse.json({
      ok: true,
      presenceRequired: challenge,
      enterpriseSeat,
      savedAt: now.toISOString(),
    });
  }
  return NextResponse.json({
    ok: true,
    countedSeconds: countable ? elapsed : 0,
    enterpriseSeat,
    savedAt: now.toISOString(),
  });
}

async function creditProgress(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  enrollmentId: string,
  lessonId: string,
  positionSeconds: number,
  seconds: number,
) {
  const { error } = await admin.rpc("credit_lesson_progress", {
    target_enrollment_id: enrollmentId,
    target_lesson_id: lessonId,
    target_position_seconds: positionSeconds,
    target_credit_seconds: seconds,
  });
  return !error;
}
