import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import { requireUser } from "@/infrastructure/supabase/server";

function clientIp(request: Request) {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const value = request.headers.get("x-real-ip") ?? forwarded;
  if (!value || !/^[0-9a-f:.]+$/i.test(value)) {
    throw new Error("CLIENT_IP_UNAVAILABLE");
  }
  return value;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
) {
  return mutation(request, async () => {
    requireIdempotencyKey(request);
    const { organizationId } = await context.params;
    z.uuid().parse(organizationId);
    const { deviceHash } = await readJson(
      request,
      z.object({ deviceHash: z.string().regex(/^[a-f0-9]{64}$/) }),
    );
    const { supabase } = await requireUser();
    return new PlatformApplication(supabase).presentOrganizationContract({
      organizationId,
      deviceHash,
      requestIp: clientIp(request),
    });
  });
}
