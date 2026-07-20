import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isPlatformAdmin,
} from "@/lib/supabase/server";

const schema = z.object({ action: z.enum(["archive", "duplicate"]) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  if (!(await isPlatformAdmin()))
    return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { courseId } = await params;
  const actorId = await getAuthenticatedUserId();
  if (parsed.data.action === "archive") {
    const { data, error } = await admin
      .from("courses")
      .update({ status: "archived" })
      .eq("id", courseId)
      .select("id")
      .maybeSingle();
    if (error || !data)
      return NextResponse.json(
        { error: "COURSE_ARCHIVE_FAILED" },
        { status: 409 },
      );
    await admin
      .from("audit_events")
      .insert({
        actor_id: actorId,
        action: "course.archived",
        target_type: "course",
        target_id: courseId,
        after_data: { status: "archived" },
      });
    return NextResponse.json({ ok: true });
  }
  const { data: duplicatedId, error } = await admin.rpc(
    "duplicate_course_as_draft",
    { source_course_id: courseId, target_actor_id: actorId },
  );
  if (error || !duplicatedId)
    return NextResponse.json(
      { error: "COURSE_DUPLICATE_FAILED", message: error?.message },
      { status: 409 },
    );
  return NextResponse.json({ ok: true, courseId: duplicatedId });
}
