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
    requireIdempotencyKey(request);
    const { courseVersionId } = await context.params;
    z.uuid().parse(courseVersionId);
    const { reason, stepUpNonce } = await readJson(
      request,
      z.object({
        reason: z.string().trim().min(10).max(1000),
        stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("publish_course_version", {
      p_course_version_id: courseVersionId,
      p_reason: reason,
      p_nonce_hash: createHash("sha256").update(stepUpNonce).digest("hex"),
    });
    if (error) throw new Error(`DATABASE_REJECTED:${error.message}`);
    return { published: data };
  });
}
