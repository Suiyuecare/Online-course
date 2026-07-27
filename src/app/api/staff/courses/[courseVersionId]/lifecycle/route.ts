import { createHash } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ courseVersionId: string }> },
) {
  return mutation(request, async () => {
    const { courseVersionId } = await context.params;
    z.uuid().parse(courseVersionId);
    const input = await readJson(
      request,
      z.object({
        action: z.enum(["stop_sale", "suspend", "resume", "archive"]),
        reason: z.string().trim().min(10).max(1000),
        stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "transition_course_version_lifecycle",
      {
        p_course_version_id: courseVersionId,
        p_action: input.action,
        p_reason: input.reason,
        p_nonce_hash: createHash("sha256")
          .update(input.stepUpNonce)
          .digest("hex"),
        p_idempotency_key: requireIdempotencyKey(request),
      },
    );
    if (error || !data) throw new Error("COURSE_LIFECYCLE_REJECTED");
    return data;
  });
}
