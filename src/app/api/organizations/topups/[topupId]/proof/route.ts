import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import { resolveActivePerson } from "@/infrastructure/security/accreditation-identity";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

const schema = z.object({
  remitterName: z.string().trim().min(1).max(100),
  bankName: z.string().trim().min(1).max(100),
  accountLastFive: z.string().regex(/^\d{5}$/),
  transferredAt: z.iso.datetime(),
  amountTwd: z.number().int().positive(),
  quarantineId: z.uuid().nullable().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ topupId: string }> },
) {
  return mutation(request, async () => {
    const { topupId } = await context.params;
    z.uuid().parse(topupId);
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    let objectPath: string | null = null;
    let contentHash: string | null = null;
    if (input.quarantineId) {
      const { data, error } = await serviceSupabase().rpc(
        "read_safe_quarantine_upload",
        {
          p_upload_id: input.quarantineId,
          p_owner_id: await resolveActivePerson(supabase),
          p_purpose: "payment_proof",
        },
      );
      const safe = z
        .object({
          objectPath: z.string().min(1),
          contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .safeParse(data);
      if (error || !safe.success) throw new Error("SAFE_UPLOAD_REQUIRED");
      objectPath = safe.data.objectPath;
      contentHash = safe.data.contentSha256;
    }
    return new PlatformApplication(supabase).submitPointTopupProof({
      topupId,
      remitterName: input.remitterName,
      bankName: input.bankName,
      accountLastFive: input.accountLastFive,
      transferredAt: input.transferredAt,
      amountTwd: input.amountTwd,
      objectPath,
      contentHash,
      idempotencyKey: requireIdempotencyKey(request),
    });
  });
}
