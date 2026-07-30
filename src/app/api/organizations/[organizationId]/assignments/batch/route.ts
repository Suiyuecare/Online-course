import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import { requireUser } from "@/infrastructure/supabase/server";

const batchAssignmentSchema = z
  .object({
    memberPersonIds: z
      .array(z.uuid())
      .min(1)
      .max(200)
      .refine(
        (memberPersonIds) =>
          new Set(memberPersonIds).size === memberPersonIds.length,
        "DUPLICATE_MEMBER_SELECTION",
      ),
    courseVersionId: z.uuid(),
    liveSessionId: z.uuid().nullable().optional(),
    completionDueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
) {
  return mutation(request, async () => {
    const { organizationId } = await context.params;
    z.uuid().parse(organizationId);
    const input = await readJson(request, batchAssignmentSchema);
    const { supabase } = await requireUser();
    return new PlatformApplication(supabase).batchAssignOrganizationCourse({
      organizationId,
      memberPersonIds: input.memberPersonIds,
      courseVersionId: input.courseVersionId,
      liveSessionId: input.liveSessionId ?? null,
      completionDueAt: input.completionDueAt ?? null,
      idempotencyKey: requireIdempotencyKey(request),
    });
  });
}
