import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  joinLeaseId: z.uuid(),
  sequence: z.number().int().positive(),
  cameraOn: z.boolean(),
  checkedDevice: z.boolean(),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const { supabase } = await requireUser();
    return new PlatformApplication(supabase).recordLiveHeartbeat(
      await readJson(request, schema),
    );
  });
}
