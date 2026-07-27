import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  enrollmentId: z.uuid(),
  challengeToken: z.string().min(20),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const { supabase } = await requireUser();
    const input = await readJson(request, schema);
    return new PlatformApplication(supabase).confirmPresence({
      ...input,
      idempotencyKey: requireIdempotencyKey(request),
    });
  });
}
