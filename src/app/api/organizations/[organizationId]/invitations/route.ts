import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import { prepareOrganizationInvitation } from "@/infrastructure/security/organization-invitations";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  phone: z.string().min(10).max(20),
  role: z.enum(["training_manager", "finance", "member"]).default("member"),
  employeeName: z.string().trim().max(100).default(""),
  employeeNumber: z.string().trim().max(100).default(""),
  department: z.string().trim().max(100).default(""),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
) {
  return mutation(request, async () => {
    const idempotencyKey = requireIdempotencyKey(request);
    const { organizationId } = await context.params;
    z.uuid().parse(organizationId);
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { data: actorRole, error: authorizationError } = await supabase.rpc(
      "authorize_organization_invitation_preparation",
      {
        p_organization_id: organizationId,
        p_requested_role: input.role,
      },
    );
    if (
      authorizationError ||
      !["owner", "training_manager"].includes(String(actorRole))
    ) {
      throw new Error("ORGANIZATION_MANAGER_REQUIRED");
    }
    const prepared = await prepareOrganizationInvitation({
      organizationId,
      phone: input.phone,
    });
    return new PlatformApplication(supabase).createOrganizationInvitation({
      organizationId,
      phoneCiphertext: prepared.phoneCiphertext,
      phoneBlindIndex: prepared.phoneBlindIndex,
      tokenHash: prepared.tokenHash,
      role: input.role,
      employeeName: input.employeeName,
      employeeNumber: input.employeeNumber,
      department: input.department,
      idempotencyKey,
    });
  });
}
