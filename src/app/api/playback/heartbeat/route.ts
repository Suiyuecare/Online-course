import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  enrollmentId: z.uuid(),
  playbackSessionId: z.uuid(),
  leaseEpoch: z.number().int().nonnegative(),
  sequence: z.number().int().positive(),
  mediaPositionSeconds: z.number().nonnegative(),
  playing: z.boolean(),
  visible: z.boolean(),
  online: z.boolean(),
  challengeToken: z.string().min(20).nullable(),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const { supabase } = await requireUser();
    return new PlatformApplication(supabase).heartbeat(
      await readJson(request, schema),
    );
  });
}
