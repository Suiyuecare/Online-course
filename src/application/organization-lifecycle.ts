import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const organizationLifecycleItemSchema = z.object({
  organizationId: z.string().uuid(),
  legalName: z.string().min(1),
  status: z.enum(["approved", "suspended"]),
  invoiceEmail: z.string().email(),
  contactName: z.string().min(1),
  updatedAt: z.string(),
});

export type OrganizationLifecycleItem = z.infer<
  typeof organizationLifecycleItemSchema
>;

export async function readOrganizationLifecycleControls(
  client: SupabaseClient,
  input: { search?: string; limit?: number } = {},
): Promise<OrganizationLifecycleItem[]> {
  const { data, error } = await client.rpc(
    "read_organization_lifecycle_controls",
    {
      p_search: input.search?.trim() || null,
      p_limit: input.limit ?? 50,
    },
  );
  if (error) {
    throw new Error("ORGANIZATION_LIFECYCLE_UNAVAILABLE");
  }
  const parsed = z.array(organizationLifecycleItemSchema).safeParse(data);
  if (!parsed.success) {
    throw new Error("ORGANIZATION_LIFECYCLE_INVALID");
  }
  return parsed.data;
}
