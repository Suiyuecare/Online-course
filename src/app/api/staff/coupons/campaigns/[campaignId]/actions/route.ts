import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  action: z.enum(["approve", "pause", "resume", "end"]),
  reason: z.string().trim().min(10).max(500),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  return mutation(request, async () => {
    const { campaignId } = await context.params;
    const id = z.uuid().parse(campaignId);
    const input = await readJson(request, schema);
    const idempotencyKey = requireIdempotencyKey(request);
    const { supabase } = await requireUser();
    const application = new PlatformApplication(supabase);
    return input.action === "approve"
      ? application.approveCouponCampaign({
          campaignId: id,
          reason: input.reason,
          idempotencyKey,
        })
      : application.changeCouponCampaignStatus({
          campaignId: id,
          action: input.action,
          reason: input.reason,
          idempotencyKey,
        });
  });
}
