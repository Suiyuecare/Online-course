import { NextResponse } from "next/server";
import { z } from "zod";
import { maybeCompleteEnrollment } from "@/lib/completion";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
} from "@/lib/supabase/server";

const submitSchema = z.object({
  liveSessionId: z.string().uuid().optional(),
  answers: z
    .array(
      z.object({ questionId: z.string().uuid(), optionId: z.string().uuid() }),
    )
    .min(1)
    .max(30),
});

async function context(courseSlug: string, liveSessionId?: string) {
  const userId = await getAuthenticatedUserId();
  const admin = createSupabaseAdminClient();
  if (!userId || !admin) return null;
  const { data: course } = await admin
    .from("courses")
    .select("id,title,pass_score,delivery")
    .eq("slug", courseSlug)
    .maybeSingle();
  if (!course) return null;
  if ((course.delivery === "live") !== Boolean(liveSessionId)) return null;
  let enrollmentQuery = admin
    .from("enrollments")
    .select("id")
    .eq("learner_id", userId)
    .eq("course_id", course.id)
    .in("status", ["active", "completed"]);
  enrollmentQuery = liveSessionId
    ? enrollmentQuery.eq("live_session_id", liveSessionId)
    : enrollmentQuery.is("live_session_id", null);
  const { data: enrollment } = await enrollmentQuery
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!enrollment) return null;
  return { userId, admin, course, enrollment };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseSlug: string }> },
) {
  const ctx = await context(
    (await params).courseSlug,
    new URL(request.url).searchParams.get("session") ?? undefined,
  );
  if (!ctx)
    return NextResponse.json(
      { error: "COURSE_ACCESS_REQUIRED" },
      { status: 403 },
    );
  const { data: questions } = await ctx.admin
    .from("quiz_questions")
    .select("id,prompt,position,quiz_options(id,label,position)")
    .eq("course_id", ctx.course.id)
    .eq("active", true)
    .order("position");
  const safe = (questions ?? []).map((question) => ({
    ...question,
    quiz_options: [...(question.quiz_options ?? [])]
      .sort((a, b) => a.position - b.position)
      .map(({ id, label }) => ({ id, label })),
  }));
  return NextResponse.json({
    courseTitle: ctx.course.title,
    passScore: ctx.course.pass_score,
    questions: safe,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseSlug: string }> },
) {
  const parsed = submitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_ANSWERS" }, { status: 400 });
  const ctx = await context(
    (await params).courseSlug,
    parsed.data.liveSessionId,
  );
  if (!ctx)
    return NextResponse.json(
      { error: "COURSE_ACCESS_REQUIRED" },
      { status: 403 },
    );
  const { data: questions } = await ctx.admin
    .from("quiz_questions")
    .select("id,points,quiz_options(id,is_correct)")
    .eq("course_id", ctx.course.id)
    .eq("active", true);
  if (!questions?.length || parsed.data.answers.length !== questions.length)
    return NextResponse.json({ error: "INCOMPLETE_ANSWERS" }, { status: 400 });
  const answerMap = new Map(
    parsed.data.answers.map((answer) => [answer.questionId, answer.optionId]),
  );
  let earned = 0;
  let total = 0;
  for (const question of questions) {
    total += question.points;
    const selected = question.quiz_options.find(
      (option) => option.id === answerMap.get(question.id),
    );
    if (!selected)
      return NextResponse.json({ error: "INVALID_OPTION" }, { status: 400 });
    if (selected.is_correct) earned += question.points;
  }
  const score = Math.round((earned / Math.max(1, total)) * 100);
  const passed = score >= ctx.course.pass_score;
  const { data: latest } = await ctx.admin
    .from("quiz_attempts")
    .select("attempt_number")
    .eq("enrollment_id", ctx.enrollment.id)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  await ctx.admin
    .from("quiz_attempts")
    .insert({
      enrollment_id: ctx.enrollment.id,
      learner_id: ctx.userId,
      score,
      passed,
      answers: parsed.data.answers,
      attempt_number: (latest?.attempt_number ?? 0) + 1,
      submitted_at: new Date().toISOString(),
      graded_at: new Date().toISOString(),
    });
  if (passed)
    await ctx.admin
      .from("enrollments")
      .update({ quiz_passed: true })
      .eq("id", ctx.enrollment.id);
  const completion = await maybeCompleteEnrollment(
    ctx.admin,
    ctx.enrollment.id,
  );
  return NextResponse.json({
    score,
    passed,
    attemptNumber: (latest?.attempt_number ?? 0) + 1,
    completion,
  });
}
