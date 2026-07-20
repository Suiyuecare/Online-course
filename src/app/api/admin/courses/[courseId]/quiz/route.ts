import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isPlatformAdmin,
} from "@/lib/supabase/server";

const schema = z
  .object({
    prompt: z.string().trim().min(5).max(500),
    explanation: z.string().trim().max(1000).optional().default(""),
    points: z.number().int().min(1).max(100),
    options: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(300),
          isCorrect: z.boolean(),
        }),
      )
      .min(2)
      .max(6),
  })
  .refine(
    (value) => value.options.filter((option) => option.isCorrect).length === 1,
    { message: "Exactly one correct option is required" },
  );

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  if (!(await isPlatformAdmin()))
    return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_QUIZ_QUESTION" },
      { status: 400 },
    );
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { courseId } = await params;
  const { count } = await admin
    .from("quiz_questions")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId);
  const { data: question, error } = await admin
    .from("quiz_questions")
    .insert({
      course_id: courseId,
      prompt: parsed.data.prompt,
      explanation: parsed.data.explanation,
      position: count ?? 0,
      points: parsed.data.points,
      active: true,
    })
    .select("id")
    .single();
  if (error || !question)
    return NextResponse.json(
      { error: "QUESTION_CREATE_FAILED" },
      { status: 409 },
    );
  const { error: optionsError } = await admin
    .from("quiz_options")
    .insert(
      parsed.data.options.map((option, position) => ({
        question_id: question.id,
        label: option.label,
        is_correct: option.isCorrect,
        position,
      })),
    );
  if (optionsError) {
    await admin.from("quiz_questions").delete().eq("id", question.id);
    return NextResponse.json(
      { error: "OPTIONS_CREATE_FAILED" },
      { status: 500 },
    );
  }
  await admin
    .from("audit_events")
    .insert({
      actor_id: await getAuthenticatedUserId(),
      action: "quiz.question_created",
      target_type: "course",
      target_id: courseId,
      after_data: { question_id: question.id },
    });
  return NextResponse.json({ id: question.id }, { status: 201 });
}
