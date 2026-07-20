import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrganizationRole } from "@/lib/enterprise-core";

export type OrganizationContext = {
  organizationId: string;
  role: OrganizationRole;
  organization: {
    id: string;
    name: string;
    tax_id: string | null;
    status: string;
    active: boolean;
    invoice_email?: string | null;
    contact_name?: string | null;
    contact_phone?: string | null;
  };
};

export function organizationContextForClient(context: OrganizationContext) {
  if (context.role === "owner" || context.role === "manager") return context;
  return {
    ...context,
    organization: {
      id: context.organization.id,
      name: context.organization.name,
      status: context.organization.status,
      active: context.organization.active,
      tax_id: null,
      invoice_email: null,
      contact_name: null,
      contact_phone: null,
    },
  } satisfies OrganizationContext;
}

export async function getOrganizationContext(
  admin: SupabaseClient,
  userId: string,
  requestedOrganizationId?: string | null,
): Promise<OrganizationContext | null> {
  let query = admin
    .from("organization_members")
    .select(
      "organization_id,role,organizations(id,name,tax_id,status,active,invoice_email,contact_name,contact_phone)",
    )
    .eq("user_id", userId);
  if (requestedOrganizationId)
    query = query.eq("organization_id", requestedOrganizationId);
  const { data } = await query.order("joined_at").limit(1).maybeSingle();
  const organization = Array.isArray(data?.organizations)
    ? data.organizations[0]
    : data?.organizations;
  if (!data || !organization) return null;
  return {
    organizationId: data.organization_id,
    role: data.role as OrganizationRole,
    organization,
  };
}

export async function getOrganizationContexts(
  admin: SupabaseClient,
  userId: string,
): Promise<OrganizationContext[]> {
  const { data, error } = await admin
    .from("organization_members")
    .select(
      "organization_id,role,organizations(id,name,tax_id,status,active,invoice_email,contact_name,contact_phone)",
    )
    .eq("user_id", userId)
    .order("joined_at")
    .order("organization_id");
  if (error) throw error;
  return (data ?? []).flatMap((membership) => {
    const organization = Array.isArray(membership.organizations)
      ? membership.organizations[0]
      : membership.organizations;
    if (!organization) return [];
    return [
      {
        organizationId: membership.organization_id,
        role: membership.role as OrganizationRole,
        organization,
      } satisfies OrganizationContext,
    ];
  });
}

export async function getAuthenticatedIdentity(
  client: SupabaseClient | null,
): Promise<{ id: string; email: string } | null> {
  if (!client) return null;
  const { data, error } = await client.auth.getClaims();
  const id = data?.claims?.sub;
  const email = data?.claims?.email;
  if (error || typeof id !== "string" || typeof email !== "string")
    return null;
  return { id, email: email.trim().toLowerCase() };
}
