import { NextResponse } from "next/server";
import { z } from "zod";
import {
  canManageOrganization,
  isEnterpriseEnabled,
} from "@/lib/enterprise-core";
import {
  getAuthenticatedIdentity,
  getOrganizationContext,
} from "@/lib/enterprise";
import { createEnterpriseRosterTemplateBuffer } from "@/lib/enterprise-spreadsheet";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

export async function GET(request: Request) {
  if (!isEnterpriseEnabled())
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
  const organizationId = z
    .string()
    .uuid()
    .safeParse(new URL(request.url).searchParams.get("organizationId"));
  if (!organizationId.success)
    return NextResponse.json({ error: "INVALID_ORGANIZATION" }, { status: 400 });
  const client = await createSupabaseServerClient();
  const identity = await getAuthenticatedIdentity(client);
  if (!identity)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  const context = await getOrganizationContext(
    admin,
    identity.id,
    organizationId.data,
  );
  if (!context || !canManageOrganization(context.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const buffer = await createEnterpriseRosterTemplateBuffer();
  return new Response(buffer as BodyInit, {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition":
        "attachment; filename*=UTF-8''suiyue-enterprise-roster-template.xlsx",
      "cache-control": "no-store",
    },
  });
}
