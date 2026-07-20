import { NextResponse } from "next/server";
import { z } from "zod";
import { maybeCompleteEnrollment } from "@/lib/completion";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
} from "@/lib/supabase/server";

const schema = z.object({
  courseSlug: z.string().min(1).max(120),
  liveSessionId: z.string().uuid().optional(),
  rating: z.number().int().min(1).max(5),
  feedback: z.string().trim().max(1000).optional(),
});
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_SATISFACTION" },
      { status: 400 },
    );
  const userId = await getAuthenticatedUserId();
  const admin = createSupabaseAdminClient();
  if (!userId)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { data: course } = await admin
    .from("courses")
    .select("id,delivery")
    .eq("slug", parsed.data.courseSlug)
    .maybeSingle();
  if (
    !course ||
    (course.delivery === "live") !== Boolean(parsed.data.liveSessionId)
  )
    return NextResponse.json(
      { error: "COURSE_ACCESS_REQUIRED" },
      { status: 403 },
    );
  let enrollmentQuery = admin
    .from("enrollments")
    .select("id")
    .eq("learner_id", userId)
    .eq("course_id", course.id)
    .in("status", ["active", "completed"]);
  enrollmentQuery = parsed.data.liveSessionId
    ? enrollmentQuery.eq("live_session_id", parsed.data.liveSessionId)
    : enrollmentQuery.is("live_session_id", null);
  const { data: enrollment } = await enrollmentQuery.maybeSingle();
  if (!enrollment)
    return NextResponse.json(
      { error: "COURSE_ACCESS_REQUIRED" },
      { status: 403 },
    );
  await admin
    .from("satisfaction_responses")
    .upsert(
      {
        enrollment_id: enrollment.id,
        learner_id: userId,
        ratings: { overall: parsed.data.rating },
        feedback: parsed.data.feedback,
      },
      { onConflict: "enrollment_id" },
    );
  await admin
    .from("enrollments")
    .update({ satisfaction_completed: true })
    .eq("id", enrollment.id);
  return NextResponse.json({
    ok: true,
    completion: await maybeCompleteEnrollment(admin, enrollment.id),
  });
}
