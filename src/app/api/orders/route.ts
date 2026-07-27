import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  courseVersionId: z.uuid(),
  legalAcceptanceId: z.uuid(),
  liveSelections: z.record(z.string(), z.uuid()).default({}),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const { supabase } = await requireUser();
    const input = await readJson(request, schema);
    return new PlatformApplication(supabase).createOrder({
      ...input,
      idempotencyKey: requireIdempotencyKey(request),
    });
  });
}
