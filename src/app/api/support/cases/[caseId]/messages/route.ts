import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  return mutation(request, async () => {
    const { caseId } = await context.params;
    z.uuid().parse(caseId);
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("append_support_case_message", {
      p_support_case_id: caseId,
      p_body: input.body,
      p_idempotency_key: requireIdempotencyKey(request),
    });
    if (error || !data) throw new Error("SUPPORT_MESSAGE_REJECTED");
    return data;
  });
}
