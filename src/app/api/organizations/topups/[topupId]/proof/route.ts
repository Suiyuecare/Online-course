import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  remitterName: z.string().trim().min(1).max(100),
  bankName: z.string().trim().min(1).max(100),
  accountLastFive: z.string().regex(/^\d{5}$/),
  transferredAt: z.iso.datetime(),
  amountTwd: z.number().int().positive(),
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
    return new PlatformApplication(supabase).submitPointTopupProof({
      topupId,
      ...input,
      idempotencyKey: requireIdempotencyKey(request),
    });
  });
}
