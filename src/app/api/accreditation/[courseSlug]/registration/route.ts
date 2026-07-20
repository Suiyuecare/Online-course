import { NextResponse } from "next/server";
import { z } from "zod";
import {
  encryptAccreditationIdentity,
  isLearnerEncryptionConfigured,
  maskNationalId,
  nationalIdFingerprint,
  normalizeNationalId,
} from "@/lib/accreditation-crypto";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
} from "@/lib/supabase/server";

const schema = z.object({
  fullName: z.string().trim().min(2).max(80),
  nationalId: z
    .string()
    .trim()
    .transform(normalizeNationalId)
    .pipe(z.string().regex(/^[A-Z0-9]{8,20}$/)),
  longTermCareNumber: z.string().trim().min(3).max(60),
  phone: z
    .string()
    .trim()
    .regex(/^0[2-9][0-9-]{7,12}$/),
  organization: z.string().trim().min(2).max(120),
  personnelCategory: z.string().trim().min(2).max(80),
  consent: z.literal(true),
});

async function registrationContext(courseSlug: string, liveSessionId?: string) {
  const userId = await getAuthenticatedUserId();
  const admin = createSupabaseAdminClient();
  if (!userId || !admin) return null;
  const { data: course } = await admin
    .from("courses")
    .select("id,title,delivery,accredited,accreditation_status")
    .eq("slug", courseSlug)
    .maybeSingle();
  if (!course?.accredited) return null;
  if ((course.delivery === "live") !== Boolean(liveSessionId)) return null;
  let enrollmentQuery = admin
    .from("enrollments")
    .select("id,status")
    .eq("learner_id", userId)
    .eq("course_id", course.id)
    .in("status", ["active", "completed"]);
  enrollmentQuery = liveSessionId
    ? enrollmentQuery.eq("live_session_id", liveSessionId)
    : enrollmentQuery.is("live_session_id", null);
  const { data: enrollment } = await enrollmentQuery.maybeSingle();
  return enrollment ? { userId, admin, course, enrollment } : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseSlug: string }> },
) {
  const ctx = await registrationContext(
    (await params).courseSlug,
    new URL(request.url).searchParams.get("session") ?? undefined,
  );
  if (!ctx)
    return NextResponse.json(
      { error: "ACCREDITED_ENROLLMENT_REQUIRED" },
      { status: 403 },
    );
  const { data: registration } = await ctx.admin
    .from("accreditation_registrations")
    .select(
      "status,personnel_category,national_id_masked,submitted_at,verified_at,correction_reason",
    )
    .eq("enrollment_id", ctx.enrollment.id)
    .maybeSingle();
  return NextResponse.json({
    course: {
      title: ctx.course.title,
      accreditationStatus: ctx.course.accreditation_status,
    },
    registration,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseSlug: string }> },
) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "INVALID_ACCREDITATION_PROFILE",
        fields: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  const ctx = await registrationContext(
    (await params).courseSlug,
    new URL(request.url).searchParams.get("session") ?? undefined,
  );
  if (!ctx)
    return NextResponse.json(
      { error: "ACCREDITED_ENROLLMENT_REQUIRED" },
      { status: 403 },
    );
  if (!isLearnerEncryptionConfigured())
    return NextResponse.json(
      { error: "ENCRYPTION_NOT_CONFIGURED" },
      { status: 503 },
    );
  const identity = {
    fullName: parsed.data.fullName,
    nationalId: parsed.data.nationalId,
    longTermCareNumber: parsed.data.longTermCareNumber,
    phone: parsed.data.phone,
    organization: parsed.data.organization,
  };
  const { error: profileError } = await ctx.admin.rpc(
    "store_accreditation_profile",
    {
      target_user_id: ctx.userId,
      target_fingerprint: nationalIdFingerprint(identity.nationalId),
      target_encrypted_payload: encryptAccreditationIdentity(identity),
    },
  );
  if (profileError)
    return NextResponse.json(
      {
        error:
          profileError.code === "23505"
            ? "IDENTITY_ALREADY_USED"
            : "PROFILE_SAVE_FAILED",
      },
      { status: 409 },
    );
  const now = new Date().toISOString();
  const { data: registration, error } = await ctx.admin
    .from("accreditation_registrations")
    .upsert(
      {
        enrollment_id: ctx.enrollment.id,
        learner_id: ctx.userId,
        course_id: ctx.course.id,
        status: "submitted",
        personnel_category: parsed.data.personnelCategory,
        national_id_masked: maskNationalId(identity.nationalId),
        submitted_at: now,
        verified_at: null,
        verified_by: null,
        correction_reason: null,
      },
      { onConflict: "enrollment_id" },
    )
    .select("id,status,national_id_masked,submitted_at")
    .single();
  if (error)
    return NextResponse.json(
      { error: "REGISTRATION_SAVE_FAILED" },
      { status: 500 },
    );
  await ctx.admin
    .from("profiles")
    .update({ full_name: identity.fullName, phone: identity.phone })
    .eq("id", ctx.userId);
  await ctx.admin.from("audit_events").insert({
    actor_id: ctx.userId,
    action: "accreditation.registration_submitted",
    target_type: "enrollment",
    target_id: ctx.enrollment.id,
    after_data: {
      registration_id: registration.id,
      personnel_category: parsed.data.personnelCategory,
    },
  });
  return NextResponse.json({ registration });
}
