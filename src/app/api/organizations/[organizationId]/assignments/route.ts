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
        memberPersonId: z.uuid(),
        courseVersionId: z.uuid(),
      }),
    );
    const { supabase } = await requireUser();
    return new PlatformApplication(supabase).assignOrganizationCourse({
      organizationId,
      ...input,
      idempotencyKey: requireIdempotencyKey(request),
    });
  });
}
