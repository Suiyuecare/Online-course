import { NextResponse } from "next/server";
import { z } from "zod";
import {
  encryptLiveSecret,
  isLiveSecretEncryptionConfigured,
} from "@/lib/live-secrets";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  getPlatformRole,
  isPlatformAdmin,
} from "@/lib/supabase/server";
import { createZoomMeeting, isZoomConfigured } from "@/lib/zoom";

const breakSchema = z
  .object({ startsAt: z.string().datetime(), endsAt: z.string().datetime() })
  .refine((item) => Date.parse(item.endsAt) > Date.parse(item.startsAt));
const schema = z
  .object({
    courseId: z.string().uuid(),
    title: z.string().trim().min(3).max(160),
    instructorName: z.string().trim().min(2).max(80),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    capacity: z.number().int().min(1).max(1000).default(50),
    hostPlanCapacity: z.number().int().min(1).max(1000).default(100),
    breaks: z.array(breakSchema).max(10).default([]),
  })
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
    path: ["endsAt"],
  })
  .refine((value) => value.capacity <= value.hostPlanCapacity, {
    path: ["capacity"],
  });

export async function GET() {
  const role = await getPlatformRole();
  if (!(["admin", "support"] as string[]).includes(role))
    return NextResponse.json({ error: "STAFF_REQUIRED" }, { status: 403 });
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { data, error } = await admin
    .from("live_sessions")
    .select(
      "id,course_id,title,instructor_name,starts_at,ends_at,status,capacity,host_plan_capacity,break_intervals,zoom_status,camera_required_percent,courses(title,slug,accredited),live_session_bookings(id,status),live_attendance_summaries(attendance_status)",
    )
    .order("starts_at", { ascending: false });
  return error
    ? NextResponse.json({ error: "LIVE_SESSION_LIST_FAILED" }, { status: 500 })
    : NextResponse.json({ sessions: data ?? [], readOnly: role !== "admin" });
}

export async function POST(request: Request) {
  if (!(await isPlatformAdmin()))
    return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "INVALID_LIVE_SESSION",
        fields: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  const admin = createSupabaseAdminClient();
  const actorId = await getAuthenticatedUserId();
  if (!admin || !actorId)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { data: course } = await admin
    .from("courses")
    .select("id,delivery,status")
    .eq("id", parsed.data.courseId)
    .maybeSingle();
  if (!course || course.delivery !== "live")
    return NextResponse.json(
      { error: "LIVE_COURSE_REQUIRED" },
      { status: 409 },
    );
  const { data: session, error } = await admin
    .from("live_sessions")
    .insert({
      course_id: course.id,
      title: parsed.data.title,
      instructor_name: parsed.data.instructorName,
      starts_at: parsed.data.startsAt,
      ends_at: parsed.data.endsAt,
      capacity: parsed.data.capacity,
      host_plan_capacity: parsed.data.hostPlanCapacity,
      break_intervals: parsed.data.breaks,
      camera_required_percent: 80,
      status: "draft",
      zoom_status: isZoomConfigured() ? "creating" : "not_created",
      join_opens_at: new Date(
        Date.parse(parsed.data.startsAt) - 10 * 60_000,
      ).toISOString(),
    })
    .select("*")
    .single();
  if (error || !session)
    return NextResponse.json(
      { error: "LIVE_SESSION_CREATE_FAILED", message: error?.message },
      { status: 500 },
    );
  let zoomError: string | null = null;
  if (isZoomConfigured() && isLiveSecretEncryptionConfigured()) {
    try {
      const meeting = await createZoomMeeting({
        topic: parsed.data.title,
        startsAt: parsed.data.startsAt,
        durationMinutes: Math.ceil(
          (Date.parse(parsed.data.endsAt) - Date.parse(parsed.data.startsAt)) /
            60_000,
        ),
      });
      await admin.rpc("store_live_zoom_credentials", {
        target_session_id: session.id,
        target_meeting_number: String(meeting.id),
        target_encrypted_passcode: encryptLiveSecret(meeting.password),
      });
      await admin
        .from("live_sessions")
        .update({
          zoom_meeting_id: String(meeting.id),
          zoom_meeting_uuid: meeting.uuid,
          zoom_host_id: meeting.host_id,
          zoom_status: "ready",
          status: "scheduled",
        })
        .eq("id", session.id);
    } catch (cause) {
      zoomError = cause instanceof Error ? cause.message : "ZOOM_CREATE_FAILED";
      await admin
        .from("live_sessions")
        .update({ zoom_status: "failed" })
        .eq("id", session.id);
    }
  }
  await admin
    .from("audit_events")
    .insert({
      actor_id: actorId,
      action: "live_session.created",
      target_type: "live_session",
      target_id: session.id,
      after_data: { ...parsed.data, zoom_error: zoomError },
    });
  return NextResponse.json(
    {
      session: {
        ...session,
        zoom_status: zoomError ? "failed" : session.zoom_status,
      },
      zoomError,
    },
    { status: 201 },
  );
}
