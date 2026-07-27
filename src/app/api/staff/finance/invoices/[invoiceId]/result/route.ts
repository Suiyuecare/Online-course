import { createHash } from "node:crypto";
import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ invoiceId: string }> },
) {
  return mutation(request, async () => {
    const { invoiceId } = await context.params;
    z.uuid().parse(invoiceId);
    const input = await readJson(
      request,
      z.object({
        eventType: z.enum([
          "issued",
          "failed",
          "allowance_completed",
          "void_completed",
        ]),
        amountTwd: z.number().int().positive().nullable(),
        externalReference: z.string().trim().max(500),
        reason: z.string().trim().min(10).max(1000),
        stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("record_manual_invoice_result", {
      p_invoice_id: invoiceId,
      p_event_type: input.eventType,
      p_amount_twd: input.amountTwd,
      p_external_reference: input.externalReference,
      p_reason: input.reason,
      p_nonce_hash: createHash("sha256")
        .update(input.stepUpNonce)
        .digest("hex"),
    });
    if (error || !data) throw new Error("INVOICE_RESULT_REJECTED");
    return { status: data };
  });
}
