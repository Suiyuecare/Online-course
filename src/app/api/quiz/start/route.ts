import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(request: Request) {
  return mutation(request, async () => {
    const { supabase } = await requireUser();
    const input = await readJson(request, z.object({ enrollmentId: z.uuid() }));
    return new PlatformApplication(supabase).startQuiz({
      ...input,
      idempotencyKey: requireIdempotencyKey(request),
    });
  });
}
