import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign"),
    assigneeRoleId: z.uuid(),
    reason: z.string().trim().min(5).max(2000),
  }),
  z.object({
    action: z.literal("reply"),
    body: z.string().trim().min(1).max(4000),
    reason: z.string().trim().min(5).max(2000),
  }),
  z.object({
    action: z.literal("status"),
    status: z.enum([
      "open",
      "investigating",
      "waiting_customer",
      "resolved",
      "closed",
    ]),
    reason: z.string().trim().min(5).max(2000),
  }),
  z.object({
    action: z.literal("sla"),
    responseDueAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(5).max(2000),
  }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  return mutation(request, async () => {
    const { caseId } = await context.params;
    z.uuid().parse(caseId);
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("act_on_support_case", {
      p_support_case_id: caseId,
      p_action: input.action,
      p_assignee_role_id:
        input.action === "assign" ? input.assigneeRoleId : null,
      p_status: input.action === "status" ? input.status : null,
      p_body: input.action === "reply" ? input.body : null,
      p_response_due_at: input.action === "sla" ? input.responseDueAt : null,
      p_reason: input.reason,
      p_idempotency_key: requireIdempotencyKey(request),
    });
    if (error || !data) throw new Error("SUPPORT_ACTION_REJECTED");
    return data;
  });
}
