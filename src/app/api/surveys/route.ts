import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import { requireUser } from "@/infrastructure/supabase/server";

const rating = z.number().int().min(1).max(5);
const schema = z.object({
  enrollmentId: z.uuid(),
  ratings: z.tuple([rating, rating, rating, rating, rating]),
  comment: z.string().trim().max(2000).nullable(),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const { supabase } = await requireUser();
    const input = await readJson(request, schema);
    return new PlatformApplication(supabase).submitSurvey({
      ...input,
      idempotencyKey: requireIdempotencyKey(request),
    });
  });
}
