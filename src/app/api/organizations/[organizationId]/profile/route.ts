import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const optionalEmail = z.union([z.literal(""), z.email().max(320)]);
const schema = z.object({
  contactName: z.string().trim().max(100),
  contactEmail: optionalEmail,
  invoiceEmail: z.email().max(320),
  invoiceRecipient: z.string().trim().max(200),
  invoiceAddress: z.string().trim().max(500),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
) {
  return mutation(request, async () => {
    const { organizationId } = await context.params;
    z.uuid().parse(organizationId);
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("update_organization_profile", {
      p_organization_id: organizationId,
      p_contact_name: input.contactName,
      p_contact_email: input.contactEmail,
      p_invoice_email: input.invoiceEmail,
      p_invoice_recipient: input.invoiceRecipient,
      p_invoice_address: input.invoiceAddress,
      p_idempotency_key: requireIdempotencyKey(request),
    });
    if (error || !data) throw new Error("ORGANIZATION_PROFILE_REJECTED");
    return data;
  });
}
