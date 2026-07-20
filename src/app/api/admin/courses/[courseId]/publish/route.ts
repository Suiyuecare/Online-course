import { NextResponse } from "next/server";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isPlatformAdmin,
} from "@/lib/supabase/server";

export async function POST(
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
  const { error } = await admin
    .from("courses")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", courseId);
  if (error)
    return NextResponse.json(
      { error: "PUBLISH_CHECK_FAILED", message: error.message },
      { status: 409 },
    );
  await admin
    .from("audit_events")
    .insert({
      actor_id: await getAuthenticatedUserId(),
      action: "course.published",
      target_type: "course",
      target_id: courseId,
      after_data: { status: "published" },
    });
  return NextResponse.json({ ok: true });
}
