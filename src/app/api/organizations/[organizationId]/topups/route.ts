import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
) {
  return mutation(request, async () => {
    const { organizationId } = await context.params;
    z.uuid().parse(organizationId);
    const input = await readJson(
      request,
      z.object({
        points: z.number().int().min(1).max(10_000_000),
        legalAcceptanceId: z.uuid(),
      }),
    );
    const { supabase } = await requireUser();
    return new PlatformApplication(supabase).createPointTopup({
      organizationId,
      ...input,
      idempotencyKey: requireIdempotencyKey(request),
    });
  });
}
