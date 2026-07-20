import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isPlatformAdmin,
} from "@/lib/supabase/server";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_module"),
    title: z.string().trim().min(2).max(120),
  }),
  z.object({
    action: z.literal("update_module"),
    moduleId: z.string().uuid(),
    title: z.string().trim().min(2).max(120),
  }),
  z.object({ action: z.literal("delete_module"), moduleId: z.string().uuid() }),
  z.object({
    action: z.literal("add_lesson"),
    moduleId: z.string().uuid(),
    title: z.string().trim().min(2).max(120),
    durationSeconds: z.number().int().min(1).max(86400),
    isPreview: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("update_lesson"),
    lessonId: z.string().uuid(),
    title: z.string().trim().min(2).max(120),
    durationSeconds: z.number().int().min(1).max(86400),
    isPreview: z.boolean(),
  }),
  z.object({ action: z.literal("delete_lesson"), lessonId: z.string().uuid() }),
  z.object({
    action: z.literal("move_module"),
    moduleId: z.string().uuid(),
    direction: z.enum(["up", "down"]),
  }),
  z.object({
    action: z.literal("move_lesson"),
    lessonId: z.string().uuid(),
    direction: z.enum(["up", "down"]),
  }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  if (!(await isPlatformAdmin()))
    return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_CURRICULUM" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { courseId } = await params;
  let targetId = "";
  if (parsed.data.action === "add_module") {
    const { count } = await admin
      .from("course_modules")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId);
    const { data, error } = await admin
      .from("course_modules")
      .insert({
        course_id: courseId,
        title: parsed.data.title,
        position: count ?? 0,
      })
      .select("id")
      .single();
    if (error || !data)
      return NextResponse.json(
        { error: "MODULE_CREATE_FAILED" },
        { status: 409 },
      );
    targetId = data.id;
  } else if (parsed.data.action === "update_module") {
    const { data, error } = await admin
      .from("course_modules")
      .update({ title: parsed.data.title })
      .eq("id", parsed.data.moduleId)
      .eq("course_id", courseId)
      .select("id")
      .maybeSingle();
    if (error || !data)
      return NextResponse.json(
        { error: "MODULE_UPDATE_FAILED" },
        { status: 409 },
      );
    targetId = data.id;
  } else if (parsed.data.action === "delete_module") {
    const { data: course } = await admin
      .from("courses")
      .select("status")
      .eq("id", courseId)
      .maybeSingle();
    if (course?.status !== "draft")
      return NextResponse.json(
        { error: "PUBLISHED_CONTENT_CANNOT_BE_DELETED" },
        { status: 409 },
      );
    const { error } = await admin
      .from("course_modules")
      .delete()
      .eq("id", parsed.data.moduleId)
      .eq("course_id", courseId);
    if (error)
      return NextResponse.json(
        { error: "MODULE_HAS_HISTORY_OR_VIDEO" },
        { status: 409 },
      );
    targetId = parsed.data.moduleId;
  } else if (parsed.data.action === "add_lesson") {
    const { data: module } = await admin
      .from("course_modules")
      .select("id")
      .eq("id", parsed.data.moduleId)
      .eq("course_id", courseId)
      .maybeSingle();
    if (!module)
      return NextResponse.json({ error: "MODULE_NOT_FOUND" }, { status: 404 });
    const { count } = await admin
      .from("lessons")
      .select("id", { count: "exact", head: true })
      .eq("module_id", module.id);
    const { data, error } = await admin
      .from("lessons")
      .insert({
        module_id: module.id,
        title: parsed.data.title,
        position: count ?? 0,
        duration_seconds: parsed.data.durationSeconds,
        is_preview: parsed.data.isPreview,
      })
      .select("id")
      .single();
    if (error || !data)
      return NextResponse.json(
        { error: "LESSON_CREATE_FAILED" },
        { status: 409 },
      );
    targetId = data.id;
  } else if (parsed.data.action === "update_lesson") {
    const { data: lessonOwner } = await admin
      .from("lessons")
      .select("id,module_id")
      .eq("id", parsed.data.lessonId)
      .maybeSingle();
    const { data: ownerModule } = lessonOwner
      ? await admin
          .from("course_modules")
          .select("id")
          .eq("id", lessonOwner.module_id)
          .eq("course_id", courseId)
          .maybeSingle()
      : { data: null };
    if (!ownerModule)
      return NextResponse.json({ error: "LESSON_NOT_FOUND" }, { status: 404 });
    const { data, error } = await admin
      .from("lessons")
      .update({
        title: parsed.data.title,
        duration_seconds: parsed.data.durationSeconds,
        is_preview: parsed.data.isPreview,
      })
      .eq("id", parsed.data.lessonId)
      .select("id")
      .single();
    if (error || !data)
      return NextResponse.json(
        { error: "LESSON_UPDATE_FAILED" },
        { status: 409 },
      );
    targetId = data.id;
  } else if (parsed.data.action === "delete_lesson") {
    const { data: course } = await admin
      .from("courses")
      .select("status")
      .eq("id", courseId)
      .maybeSingle();
    if (course?.status !== "draft")
      return NextResponse.json(
        { error: "PUBLISHED_CONTENT_CANNOT_BE_DELETED" },
        { status: 409 },
      );
    const { data: lesson } = await admin
      .from("lessons")
      .select("id,module_id")
      .eq("id", parsed.data.lessonId)
      .maybeSingle();
    const { data: ownerModule } = lesson
      ? await admin
          .from("course_modules")
          .select("id")
          .eq("id", lesson.module_id)
          .eq("course_id", courseId)
          .maybeSingle()
      : { data: null };
    if (!ownerModule)
      return NextResponse.json({ error: "LESSON_NOT_FOUND" }, { status: 404 });
    const [{ count: sessionCount }, { count: eventCount }] = await Promise.all([
      admin
        .from("playback_sessions")
        .select("id", { count: "exact", head: true })
        .eq("lesson_id", parsed.data.lessonId),
      admin
        .from("learning_events")
        .select("id", { count: "exact", head: true })
        .eq("lesson_ref", parsed.data.lessonId),
    ]);
    if ((sessionCount ?? 0) > 0 || (eventCount ?? 0) > 0)
      return NextResponse.json(
        { error: "LESSON_HAS_HISTORY" },
        { status: 409 },
      );
    await admin
      .from("lessons")
      .update({ active_video_asset_id: null })
      .eq("id", parsed.data.lessonId);
    const { error } = await admin
      .from("lessons")
      .delete()
      .eq("id", parsed.data.lessonId);
    if (error)
      return NextResponse.json(
        { error: "LESSON_DELETE_FAILED" },
        { status: 409 },
      );
    targetId = parsed.data.lessonId;
  } else if (parsed.data.action === "move_lesson") {
    const { data: current } = await admin
      .from("lessons")
      .select("id,module_id,position")
      .eq("id", parsed.data.lessonId)
      .maybeSingle();
    const { data: ownerModule } = current
      ? await admin
          .from("course_modules")
          .select("id")
          .eq("id", current.module_id)
          .eq("course_id", courseId)
          .maybeSingle()
      : { data: null };
    if (!current || !ownerModule)
      return NextResponse.json({ error: "LESSON_NOT_FOUND" }, { status: 404 });
    const targetPosition =
      current.position + (parsed.data.direction === "up" ? -1 : 1);
    if (targetPosition < 0)
      return NextResponse.json({ ok: true, id: current.id });
    const { data: other } = await admin
      .from("lessons")
      .select("id,position")
      .eq("module_id", current.module_id)
      .eq("position", targetPosition)
      .maybeSingle();
    if (!other) return NextResponse.json({ ok: true, id: current.id });
    await admin.from("lessons").update({ position: -1 }).eq("id", current.id);
    await admin
      .from("lessons")
      .update({ position: current.position })
      .eq("id", other.id);
    const { error } = await admin
      .from("lessons")
      .update({ position: targetPosition })
      .eq("id", current.id);
    if (error)
      return NextResponse.json(
        { error: "LESSON_MOVE_FAILED" },
        { status: 409 },
      );
    targetId = current.id;
  } else {
    const { data: current } = await admin
      .from("course_modules")
      .select("id,position")
      .eq("id", parsed.data.moduleId)
      .eq("course_id", courseId)
      .maybeSingle();
    if (!current)
      return NextResponse.json({ error: "MODULE_NOT_FOUND" }, { status: 404 });
    const targetPosition =
      current.position + (parsed.data.direction === "up" ? -1 : 1);
    if (targetPosition < 0)
      return NextResponse.json({ ok: true, id: current.id });
    const { data: other } = await admin
      .from("course_modules")
      .select("id,position")
      .eq("course_id", courseId)
      .eq("position", targetPosition)
      .maybeSingle();
    if (!other) return NextResponse.json({ ok: true, id: current.id });
    await admin
      .from("course_modules")
      .update({ position: -1 })
      .eq("id", current.id);
    await admin
      .from("course_modules")
      .update({ position: current.position })
      .eq("id", other.id);
    const { error } = await admin
      .from("course_modules")
      .update({ position: targetPosition })
      .eq("id", current.id);
    if (error)
      return NextResponse.json(
        { error: "MODULE_MOVE_FAILED" },
        { status: 409 },
      );
    targetId = current.id;
  }
  await admin
    .from("audit_events")
    .insert({
      actor_id: await getAuthenticatedUserId(),
      action: `curriculum.${parsed.data.action}`,
      target_type: "course",
      target_id: courseId,
      after_data: { target_id: targetId },
    });
  return NextResponse.json({ ok: true, id: targetId });
}
