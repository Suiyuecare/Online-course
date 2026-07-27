import { createHash } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { certificateRevocationRequestInputSchema } from "@/domain/quality-staff";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(
      request,
      certificateRevocationRequestInputSchema,
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "request_certificate_revocation",
      {
        p_certificate_id: input.certificateId,
        p_reason: input.reason,
        p_idempotency_key: requireIdempotencyKey(request),
        p_nonce_hash: createHash("sha256")
          .update(input.stepUpNonce)
          .digest("hex"),
      },
    );
    if (error || !data) {
      throw new Error("CERTIFICATE_REVOCATION_REQUEST_REJECTED");
    }
    return { requestId: z.uuid().parse(data) };
  });
}
