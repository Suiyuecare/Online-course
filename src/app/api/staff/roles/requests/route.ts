import { createHash } from "node:crypto";
import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const role = z.enum([
  "instructor",
  "course_admin",
  "accreditation_reviewer",
  "finance",
  "support",
  "platform_admin",
]);

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(
      request,
      z.object({
        subjectPersonId: z.uuid(),
        role,
        action: z.enum(["grant", "revoke"]),
        reason: z.string().trim().min(10).max(1000),
        stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("request_staff_role_change", {
      p_subject_person_id: input.subjectPersonId,
      p_role: input.role,
      p_action: input.action,
      p_reason: input.reason,
      p_nonce_hash: createHash("sha256")
        .update(input.stepUpNonce)
        .digest("hex"),
    });
    if (error || !data) throw new Error("ROLE_CHANGE_REQUEST_REJECTED");
    return { requestId: data };
  });
}
