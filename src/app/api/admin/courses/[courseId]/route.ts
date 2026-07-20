import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isPlatformAdmin,
} from "@/lib/supabase/server";

const updateSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  subtitle: z.string().trim().max(220).optional(),
  description: z.string().trim().max(5000).optional(),
  price_twd: z.number().int().min(0).max(100000).optional(),
  pass_score: z.number().int().min(60).max(100).optional(),
  completion_percent: z.number().int().min(1).max(100).optional(),
  satisfaction_required: z.boolean().optional(),
  accredited: z.boolean().optional(),
  organizer_name: z.string().trim().min(2).max(120).optional(),
  accreditation_authority: z.string().trim().max(120).nullable().optional(),
  accreditation_category: z.string().trim().max(120).nullable().optional(),
  accreditation_status: z
    .enum([
      "not_submitted",
      "preparing",
      "submitted",
      "approved",
      "rejected",
      "expired",
    ])
    .optional(),
  accreditation_number: z.string().trim().max(120).nullable().optional(),
  accreditation_points: z.number().min(0).max(999).optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  if (!(await isPlatformAdmin()))
    return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { courseId } = await params;
  const { data: course } = await admin
    .from("courses")
    .select("*")
    .eq("id", courseId)
    .maybeSingle();
  if (!course)
    return NextResponse.json({ error: "COURSE_NOT_FOUND" }, { status: 404 });
  const [{ data: modules }, { data: questions }] = await Promise.all([
    admin
      .from("course_modules")
      .select(
        "id,title,position,lessons(id,title,position,duration_seconds,is_preview,active_video_asset_id)",
      )
      .eq("course_id", courseId)
      .order("position"),
    admin
      .from("quiz_questions")
      .select(
        "id,prompt,position,points,active,quiz_options(id,label,is_correct,position)",
      )
      .eq("course_id", courseId)
      .order("position"),
  ]);
  return NextResponse.json({
    course,
    modules: modules ?? [],
    questions: questions ?? [],
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  if (!(await isPlatformAdmin()))
    return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_COURSE", fields: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { courseId } = await params;
  const { data: before } = await admin
    .from("courses")
    .select("*")
    .eq("id", courseId)
    .maybeSingle();
  if (!before)
    return NextResponse.json({ error: "COURSE_NOT_FOUND" }, { status: 404 });
  const { data: course, error } = await admin
    .from("courses")
    .update(parsed.data)
    .eq("id", courseId)
    .select("*")
    .single();
  if (error)
    return NextResponse.json(
      { error: "COURSE_UPDATE_FAILED", message: error.message },
      { status: 409 },
    );
  await admin
    .from("audit_events")
    .insert({
      actor_id: await getAuthenticatedUserId(),
      action: "course.updated",
      target_type: "course",
      target_id: courseId,
      before_data: before,
      after_data: course,
    });
  return NextResponse.json({ course });
}
