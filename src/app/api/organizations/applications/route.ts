import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import { organizationTaxIdIndex } from "@/infrastructure/security/organization-invitations";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  legalName: z.string().trim().min(2).max(200),
  taxId: z.string().regex(/^\d{8}$/),
  invoiceEmail: z.email().max(320),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    return new PlatformApplication(supabase).applyForOrganization({
      legalName: input.legalName,
      taxIdBlindIndex: organizationTaxIdIndex(input.taxId),
      taxIdLastFour: input.taxId.slice(-4),
      invoiceEmail: input.invoiceEmail,
      idempotencyKey: requireIdempotencyKey(request),
    });
  });
}
