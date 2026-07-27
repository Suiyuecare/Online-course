import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  return mutation(request, async () => {
    const { assignmentId } = await context.params;
    z.uuid().parse(assignmentId);
    const { reason } = await readJson(
      request,
      z.object({ reason: z.string().trim().min(10).max(1000) }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "release_organization_assignment",
      {
        p_assignment_id: assignmentId,
        p_reason: reason,
        p_idempotency_key: requireIdempotencyKey(request),
      },
    );
    if (error || !data) throw new Error("ASSIGNMENT_RELEASE_REJECTED");
    return { released: true };
  });
}
