import { z } from "zod";
import {
  assertExpectedAccount,
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("present"),
    courseVersionId: z.uuid(),
    deviceHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({
    phase: z.literal("confirm"),
    acceptanceId: z.uuid(),
    deviceHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);

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

export async function POST(request: Request) {
  return mutation(request, async () => {
    requireIdempotencyKey(request);
    const { supabase, user } = await requireUser();
    assertExpectedAccount(request, user.id);
    const input = await readJson(request, schema);
    const application = new PlatformApplication(supabase);
    const requestIp = clientIp(request);
    return input.phase === "present"
      ? application.presentLegalContract({
          courseVersionId: input.courseVersionId,
          deviceHash: input.deviceHash,
          requestIp,
        })
      : application.confirmLegalContract({
          acceptanceId: input.acceptanceId,
          deviceHash: input.deviceHash,
          requestIp,
        });
  });
}
