import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isPlatformAdmin,
} from "@/lib/supabase/server";

const createSchema = z.object({
  title: z.string().trim().min(3).max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(100),
  subtitle: z.string().trim().max(220).optional().default(""),
  priceTwd: z.number().int().min(0).max(100000),
  accredited: z.boolean().default(false),
  passScore: z.number().int().min(60).max(100).default(80),
  delivery: z.enum(["recorded", "live"]).default("recorded"),
});

export async function GET() {
  if (!(await isPlatformAdmin()))
    return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { data, error } = await admin
    .from("courses")
    .select(
      "id,slug,title,subtitle,delivery,status,price_twd,accredited,organizer_name,accreditation_status,accreditation_authority,accreditation_category,accreditation_number,accreditation_points,pass_score,completion_percent,updated_at",
    )
    .order("updated_at", { ascending: false });
  return error
    ? NextResponse.json({ error: "COURSE_LIST_FAILED" }, { status: 500 })
    : NextResponse.json({ courses: data ?? [] });
}

export async function POST(request: Request) {
  if (!(await isPlatformAdmin()))
    return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
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
  const actorId = await getAuthenticatedUserId();
  const { data: course, error } = await admin
    .from("courses")
    .insert({
      slug: parsed.data.slug,
      title: parsed.data.title,
      subtitle: parsed.data.subtitle,
      delivery: parsed.data.delivery,
      status: "draft",
      price_twd: parsed.data.priceTwd,
      accredited: parsed.data.accredited,
      pass_score: parsed.data.passScore,
      created_by: actorId,
    })
    .select(
      "id,slug,title,status,price_twd,accredited,accreditation_status,pass_score,completion_percent",
    )
    .single();
  if (error || !course)
    return NextResponse.json(
      {
        error:
          error?.code === "23505"
            ? "SLUG_ALREADY_EXISTS"
            : "COURSE_CREATE_FAILED",
      },
      { status: 409 },
    );
  await admin
    .from("audit_events")
    .insert({
      actor_id: actorId,
      action: "course.created",
      target_type: "course",
      target_id: course.id,
      after_data: course,
    });
  return NextResponse.json({ course }, { status: 201 });
}
