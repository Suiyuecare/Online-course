import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  confirmed: z.literal(true),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  return mutation(request, async () => {
    const { orderId } = await context.params;
    z.uuid().parse(orderId);
    await readJson(request, schema);
    const { supabase } = await requireUser();
    return new PlatformApplication(supabase).cancelPendingTransferOrder({
      orderId,
      idempotencyKey: requireIdempotencyKey(request),
    });
  });
}
