import { z } from "zod";
import {
  assertExpectedAccount,
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { syncOwnLearnerCart } from "@/application/learner-cart";
import { PlatformApplication } from "@/application/platform";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  courseVersionId: z.uuid(),
  legalAcceptanceId: z.uuid(),
  liveSelections: z.record(z.string(), z.uuid()).default({}),
  couponClaimId: z.uuid().nullable().default(null),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const { supabase, user } = await requireUser();
    assertExpectedAccount(request, user.id);
    const input = await readJson(request, schema);
    const { data: registration, error: registrationError } = await supabase
      .from("published_course_catalog")
      .select("registration_mode")
      .eq("course_version_id", input.courseVersionId)
      .maybeSingle();
    if (registrationError || !registration) {
      throw new Error("COURSE_PURCHASE_UNAVAILABLE");
    }
    if (registration.registration_mode === "google_form") {
      throw new Error("EXTERNAL_REGISTRATION_REQUIRED");
    }
    const order = await new PlatformApplication(supabase).createOrder({
      ...input,
      idempotencyKey: requireIdempotencyKey(request),
    });
    // A pending-transfer order is now the authoritative continuation point.
    // Cart cleanup is a non-financial preference update and must never roll
    // back or hide a successfully created order.
    await syncOwnLearnerCart(supabase, {
      operation: "remove",
      courseVersionIds: [input.courseVersionId],
    }).catch(() => null);
    return order;
  });
}
