import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  role: z.enum(["owner", "training_manager", "finance", "member"]),
  active: z.boolean(),
  employeeNumber: z.string().trim().max(100),
  department: z.string().trim().max(100),
  reason: z.string().trim().min(10).max(2000),
});

export async function POST(
  request: Request,
  context: {
    params: Promise<{ organizationId: string; personId: string }>;
  },
) {
  return mutation(request, async () => {
    const { organizationId, personId } = await context.params;
    z.uuid().parse(organizationId);
    z.uuid().parse(personId);
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("manage_organization_member", {
      p_organization_id: organizationId,
      p_person_id: personId,
      p_role: input.role,
      p_active: input.active,
      p_employee_number: input.employeeNumber,
      p_department: input.department,
      p_reason: input.reason,
      p_idempotency_key: requireIdempotencyKey(request),
    });
    if (error || !data) throw new Error("ORGANIZATION_MEMBER_CHANGE_REJECTED");
    return data;
  });
}
