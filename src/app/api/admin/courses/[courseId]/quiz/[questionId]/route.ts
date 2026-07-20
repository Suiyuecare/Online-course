import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isPlatformAdmin,
} from "@/lib/supabase/server";

const schema = z.object({ active: z.boolean() });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ courseId: string; questionId: string }> },
) {
  if (!(await isPlatformAdmin()))
    return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_QUESTION_UPDATE" },
      { status: 400 },
    );
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { courseId, questionId } = await params;
  const { data: question, error } = await admin
    .from("quiz_questions")
    .update({ active: parsed.data.active })
    .eq("id", questionId)
    .eq("course_id", courseId)
    .select("id,active")
    .maybeSingle();
  if (error || !question)
    return NextResponse.json({ error: "QUESTION_NOT_FOUND" }, { status: 404 });
  await admin
    .from("audit_events")
    .insert({
      actor_id: await getAuthenticatedUserId(),
      action: parsed.data.active
        ? "quiz.question_activated"
        : "quiz.question_archived",
      target_type: "course",
      target_id: courseId,
      after_data: { question_id: questionId },
    });
  return NextResponse.json({ question });
}
