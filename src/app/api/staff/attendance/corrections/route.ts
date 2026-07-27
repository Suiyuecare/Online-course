import { createHash } from "node:crypto";
import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(
      request,
      z.object({
        attendanceSummaryId: z.uuid(),
        presenceSecondsDelta: z.number().int(),
        cameraSecondsDelta: z.number().int(),
        reason: z.string().trim().min(10).max(1000),
        evidenceReference: z.string().trim().min(3).max(500),
        stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "propose_attendance_correction",
      {
        p_attendance_summary_id: input.attendanceSummaryId,
        p_presence_seconds_delta: input.presenceSecondsDelta,
        p_camera_seconds_delta: input.cameraSecondsDelta,
        p_reason: input.reason,
        p_evidence_reference: input.evidenceReference,
        p_nonce_hash: createHash("sha256")
          .update(input.stepUpNonce)
          .digest("hex"),
      },
    );
    if (error || !data) throw new Error("ATTENDANCE_CORRECTION_REJECTED");
    return { correctionId: data };
  });
}
