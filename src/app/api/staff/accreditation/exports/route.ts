import { createHash } from "node:crypto";
import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { generateAccreditationExport } from "@/infrastructure/exports/accreditation-export";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(
      request,
      z
        .object({
          batchId: z.uuid(),
          target: z.uuid(),
          stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        })
        .refine((value) => value.batchId === value.target, {
          message: "EXPORT_TARGET_MISMATCH",
          path: ["target"],
        }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("approve_and_authorize_export", {
      p_batch_id: input.batchId,
      p_nonce_hash: createHash("sha256")
        .update(input.stepUpNonce)
        .digest("hex"),
    });
    if (error || !data) throw new Error("EXPORT_NOT_AUTHORIZED");
    const authority = z
      .object({
        actorId: z.uuid(),
        rowCount: z.number().int().positive(),
        courseVersionId: z.uuid(),
        accreditationRevisionId: z.uuid(),
        liveSessionId: z.uuid().nullable(),
        templateVersion: z.string().min(1),
      })
      .parse(data);
    return generateAccreditationExport({
      batchId: input.batchId,
      ...authority,
    });
  });
}
