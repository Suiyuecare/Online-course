import { NextResponse } from "next/server";
import { z } from "zod";
import { maybeCompleteEnrollment } from "@/lib/completion";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isPlatformAdmin,
} from "@/lib/supabase/server";

const schema = z.object({
  status: z.enum(["verified", "needs_correction", "rejected"]),
  reason: z.string().trim().max(500).optional().default(""),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ registrationId: string }> },
) {
  if (!(await isPlatformAdmin()))
    return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (
    !parsed.success ||
    (parsed.data.status !== "verified" && parsed.data.reason.length < 3)
  )
    return NextResponse.json({ error: "INVALID_REVIEW" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { registrationId } = await params;
  const actorId = await getAuthenticatedUserId();
  const { data: before } = await admin
    .from("accreditation_registrations")
    .select("id,enrollment_id,status,correction_reason")
    .eq("id", registrationId)
    .maybeSingle();
  if (!before)
    return NextResponse.json(
      { error: "REGISTRATION_NOT_FOUND" },
      { status: 404 },
    );
  const now = new Date().toISOString();
  const update = {
    status: parsed.data.status,
    correction_reason:
      parsed.data.status === "verified" ? null : parsed.data.reason,
    verified_at: parsed.data.status === "verified" ? now : null,
    verified_by: parsed.data.status === "verified" ? actorId : null,
  };
  const { data: registration, error } = await admin
    .from("accreditation_registrations")
    .update(update)
    .eq("id", registrationId)
    .select("id,enrollment_id,status,correction_reason")
    .single();
  if (error)
    return NextResponse.json({ error: "REVIEW_SAVE_FAILED" }, { status: 500 });
  await admin
    .from("audit_events")
    .insert({
      actor_id: actorId,
      action: `accreditation.registration_${parsed.data.status}`,
      target_type: "accreditation_registration",
      target_id: registrationId,
      before_data: before,
      after_data: registration,
    });
  const completion =
    parsed.data.status === "verified"
      ? await maybeCompleteEnrollment(admin, before.enrollment_id)
      : null;
  return NextResponse.json({ registration, completion });
}
