import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin } from "@/lib/env";
import {
  canManageOrganization,
  createInvitationToken,
  ENTERPRISE_INVITE_DAYS,
  hashInvitationToken,
  isEnterpriseEnabled,
} from "@/lib/enterprise-core";
import { sendEnterpriseEmail } from "@/lib/enterprise-email";
import {
  getAuthenticatedIdentity,
  getOrganizationContext,
} from "@/lib/enterprise";
import {
  parseEnterpriseRosterWorkbook,
  type EnterpriseRosterRow,
} from "@/lib/enterprise-spreadsheet";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const maxDuration = 300;
const requestSchema = z.object({
  organizationId: z.string().uuid(),
  mode: z.enum(["preview", "commit"]),
});

type ExistingInvitation = {
  id: string;
  email: string;
  email_normalized: string;
  status: string;
  role: "member" | "manager";
};

type PreviewAction = "create" | "renew" | "skip_existing_member";

async function inChunks<T>(
  values: T[],
  size: number,
  worker: (chunk: T[]) => Promise<void>,
) {
  for (let index = 0; index < values.length; index += size)
    await worker(values.slice(index, index + size));
}

async function organizationMemberEmails(
  admin: SupabaseClient,
  organizationId: string,
) {
  const members: Array<{ user_id: string }> = [];
  const acceptedInvitations: Array<{
    accepted_by: string | null;
    email: string;
  }> = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId)
      .order("user_id")
      .range(from, from + 499);
    if (error) throw error;
    members.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }
  for (let from = 0; ; from += 500) {
    const { data, error } = await admin
      .from("organization_invitations")
      .select("accepted_by,email")
      .eq("organization_id", organizationId)
      .eq("status", "accepted")
      .order("accepted_by")
      .range(from, from + 499);
    if (error) throw error;
    acceptedInvitations.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }
  const emails = new Set<string>();
  const acceptedUserIds = new Set<string>();
  for (const invitation of acceptedInvitations) {
    const email = invitation.email.trim().toLowerCase();
    if (email) emails.add(email);
    if (invitation.accepted_by) acceptedUserIds.add(invitation.accepted_by);
  }
  const legacyMembers = members.filter(
    (member) => !acceptedUserIds.has(member.user_id),
  );
  await inChunks(legacyMembers, 20, async (chunk) => {
    const results = await Promise.all(
      chunk.map((member) => admin.auth.admin.getUserById(member.user_id)),
    );
    for (const result of results) {
      if (result.error) throw result.error;
      const email = result.data.user?.email?.trim().toLowerCase();
      if (email) emails.add(email);
    }
  });
  return emails;
}

async function existingInvitations(
  admin: SupabaseClient,
  organizationId: string,
  emails: string[],
) {
  const invitations: ExistingInvitation[] = [];
  await inChunks(emails, 100, async (chunk) => {
    const { data, error } = await admin
      .from("organization_invitations")
      .select("id,email,email_normalized,status,role")
      .eq("organization_id", organizationId)
      .in("email_normalized", chunk);
    if (error) throw error;
    invitations.push(...((data ?? []) as ExistingInvitation[]));
  });
  return new Map(
    invitations.map((invitation) => [invitation.email_normalized, invitation]),
  );
}

async function persistInvitation(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    actorId: string;
    actorRole: "owner" | "manager" | "member";
    row: EnterpriseRosterRow;
    existing?: ExistingInvitation;
  },
) {
  const token = createInvitationToken();
  const expiresAt = new Date(
    Date.now() + ENTERPRISE_INVITE_DAYS * 86_400_000,
  ).toISOString();
  const payload = {
    organization_id: input.organizationId,
    email: input.row.email,
    invitee_name: input.row.name ?? "",
    employee_code: input.row.employeeNumber ?? null,
    department: input.row.department ?? null,
    role: "member",
    status: "pending",
    token_hash: hashInvitationToken(token),
    expires_at: expiresAt,
    invited_by: input.actorId,
    revoked_at: null,
    accepted_at: null,
  };
  if (input.existing) {
    if (input.existing.role === "manager" && input.actorRole !== "owner")
      throw new Error("OWNER_REQUIRED_FOR_MANAGER_INVITE");
    const { data, error } = await admin
      .from("organization_invitations")
      .update(payload)
      .eq("id", input.existing.id)
      .eq("role", input.existing.role)
      .neq("status", "accepted")
      .select("id,email,invitee_name,status,expires_at")
      .maybeSingle();
    if (error) throw error;
    return data ? { invitation: data, token, expiresAt } : null;
  }
  const inserted = await admin
    .from("organization_invitations")
    .insert(payload)
    .select("id,email,invitee_name,status,expires_at")
    .maybeSingle();
  if (!inserted.error && inserted.data)
    return { invitation: inserted.data, token, expiresAt };

  const { data: raced } = await admin
    .from("organization_invitations")
    .select("id,email,email_normalized,status,role")
    .eq("organization_id", input.organizationId)
    .eq("email_normalized", input.row.email)
    .maybeSingle();
  if (raced?.status === "accepted") return null;
  if (!raced) throw inserted.error ?? new Error("INVITATION_INSERT_FAILED");
  if (raced.role === "manager" && input.actorRole !== "owner")
    throw new Error("OWNER_REQUIRED_FOR_MANAGER_INVITE");
  const { data, error } = await admin
    .from("organization_invitations")
    .update(payload)
    .eq("id", raced.id)
    .eq("role", raced.role)
    .neq("status", "accepted")
    .select("id,email,invitee_name,status,expires_at")
    .maybeSingle();
  if (error) throw error;
  return data ? { invitation: data, token, expiresAt } : null;
}

export async function POST(request: Request) {
  if (!isEnterpriseEnabled())
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
  const formData = await request.formData().catch(() => null);
  if (!formData)
    return NextResponse.json({ error: "INVALID_MULTIPART_FORM" }, { status: 400 });
  const parsedRequest = requestSchema.safeParse({
    organizationId: formData.get("organizationId"),
    mode: formData.get("mode"),
  });
  const retryEmailsRaw = formData.get("retryEmails");
  let retryEmails: string[] | null = null;
  if (typeof retryEmailsRaw === "string" && retryEmailsRaw.trim()) {
    let retryEmailValues: unknown;
    try {
      retryEmailValues = JSON.parse(retryEmailsRaw);
    } catch {
      return NextResponse.json(
        { error: "INVALID_RETRY_EMAILS" },
        { status: 400 },
      );
    }
    const parsedRetryEmails = z
      .array(z.string().trim().email().transform((email) => email.toLowerCase()))
      .min(1)
      .max(1000)
      .safeParse(retryEmailValues);
    if (!parsedRetryEmails.success)
      return NextResponse.json(
        { error: "INVALID_RETRY_EMAILS" },
        { status: 400 },
      );
    retryEmails = [...new Set(parsedRetryEmails.data)];
  }
  const file = formData.get("file");
  if (!parsedRequest.success || !(file instanceof File))
    return NextResponse.json({ error: "INVALID_IMPORT_REQUEST" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES)
    return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 413 });
  if (!file.name.toLowerCase().endsWith(".xlsx"))
    return NextResponse.json({ error: "XLSX_REQUIRED" }, { status: 415 });

  const supabase = await createSupabaseServerClient();
  const identity = await getAuthenticatedIdentity(supabase);
  const admin = createSupabaseAdminClient();
  if (!identity)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  const context = await getOrganizationContext(
    admin,
    identity.id,
    parsedRequest.data.organizationId,
  );
  if (!context || !canManageOrganization(context.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (
    context.organization.status !== "approved" ||
    !context.organization.active
  )
    return NextResponse.json({ error: "ORGANIZATION_NOT_ACTIVE" }, { status: 409 });

  let roster;
  try {
    roster = await parseEnterpriseRosterWorkbook(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "INVALID_XLSX" }, { status: 400 });
  }
  if (!roster.valid) {
    const response = {
      mode: parsedRequest.data.mode,
      valid: false,
      totalRows: roster.totalRows,
      rows: roster.rows,
      errors: roster.errors,
    };
    return NextResponse.json(response, {
      status: parsedRequest.data.mode === "preview" ? 200 : 422,
    });
  }

  let memberEmails: Set<string>;
  let invitationMap: Map<string, ExistingInvitation>;
  try {
    [memberEmails, invitationMap] = await Promise.all([
      organizationMemberEmails(admin, context.organizationId),
      existingInvitations(
        admin,
        context.organizationId,
        roster.rows.map((row) => row.email),
      ),
    ]);
  } catch {
    return NextResponse.json(
      { error: "ORGANIZATION_ROSTER_LOOKUP_FAILED" },
      { status: 503 },
    );
  }
  const previewRows = roster.rows.map((row) => {
    const invitation = invitationMap.get(row.email);
    const action: PreviewAction =
      memberEmails.has(row.email) || invitation?.status === "accepted"
        ? "skip_existing_member"
        : invitation
          ? "renew"
          : "create";
    return { ...row, action };
  });
  const protectedManagerInvitations =
    context.role === "owner"
      ? []
      : previewRows.filter((row) => {
          const invitation = invitationMap.get(row.email);
          return (
            invitation?.role === "manager" &&
            invitation.status !== "accepted" &&
            !memberEmails.has(row.email)
          );
        });
  if (protectedManagerInvitations.length)
    return NextResponse.json(
      {
        mode: parsedRequest.data.mode,
        valid: false,
        totalRows: roster.totalRows,
        rows: previewRows,
        errors: protectedManagerInvitations.map((row) => ({
          rowNumber: row.rowNumber,
          field: "Email",
          message: "此 Email 已有管理者邀請，只有機構擁有者可以更新。",
        })),
      },
      { status: parsedRequest.data.mode === "preview" ? 200 : 403 },
    );
  const summary = {
    totalRows: previewRows.length,
    create: previewRows.filter((row) => row.action === "create").length,
    renew: previewRows.filter((row) => row.action === "renew").length,
    skipped: previewRows.filter((row) => row.action === "skip_existing_member")
      .length,
  };
  if (parsedRequest.data.mode === "preview")
    return NextResponse.json({
      mode: "preview",
      valid: true,
      summary,
      rows: previewRows,
      errors: [],
    });

  const allCandidates = previewRows.filter(
    (row) => row.action !== "skip_existing_member",
  );
  if (
    retryEmails?.some(
      (email) => !previewRows.some((row) => row.email === email),
    )
  )
    return NextResponse.json(
      { error: "RETRY_EMAIL_NOT_IN_WORKBOOK" },
      { status: 400 },
    );
  const retryEmailSet = retryEmails ? new Set(retryEmails) : null;
  const candidates = retryEmailSet
    ? allCandidates.filter((row) => retryEmailSet.has(row.email))
    : allCandidates;
  const persisted: Array<{
    invitation: {
      id: string;
      email: string;
      invitee_name: string;
      status: string;
      expires_at: string;
    };
    token: string;
    expiresAt: string;
  }> = [];
  const failures: Array<{ rowNumber: number; email: string; message: string }> = [];
  await inChunks(candidates, 20, async (chunk) => {
    const results = await Promise.allSettled(
      chunk.map((row) =>
        persistInvitation(admin, {
          organizationId: context.organizationId,
          actorId: identity.id,
          actorRole: context.role,
          row,
          existing: invitationMap.get(row.email),
        }),
      ),
    );
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        if (result.value) persisted.push(result.value);
        return;
      }
      failures.push({
        rowNumber: chunk[index].rowNumber,
        email: chunk[index].email,
        message:
          result.reason instanceof Error
            ? result.reason.message
            : "INVITATION_WRITE_FAILED",
      });
    });
  });

  let emailSent = 0;
  const deliveryFailures: Array<{
    rowNumber: number;
    email: string;
    message: string;
  }> = [];
  await inChunks(persisted, 20, async (chunk) => {
    const results = await Promise.all(
      chunk.map((item) =>
        sendEnterpriseEmail({
          kind: "invitation",
          to: item.invitation.email,
          organizationId: context.organizationId,
          referenceId: `${item.invitation.id}:${item.expiresAt}`,
          organizationName: context.organization.name,
          learnerName: item.invitation.invitee_name || undefined,
          inviteUrl: `${appOrigin(request)}/enterprise/invite/${encodeURIComponent(item.token)}`,
          request,
        }).catch(() => ({ sent: false as const })),
      ),
    );
    results.forEach((result, index) => {
      if (result.sent) {
        emailSent += 1;
        return;
      }
      const item = chunk[index];
      deliveryFailures.push({
        rowNumber:
          previewRows.find((row) => row.email === item.invitation.email)
            ?.rowNumber ?? 0,
        email: item.invitation.email,
        message: "reason" in result ? result.reason : "EMAIL_SEND_FAILED",
      });
    });
  });
  const emailPending = persisted.length - emailSent;
  const commitSummary = {
    ...summary,
    attempted: candidates.length,
    persisted: persisted.length,
    emailSent,
    emailPending,
    failed: failures.length,
  };
  const { error: auditError } = await admin.from("audit_events").insert({
    actor_id: identity.id,
    organization_id: context.organizationId,
    action: "organization_invitations.imported",
    target_type: "organization",
    target_id: context.organizationId,
    after_data: {
      total_rows: roster.totalRows,
      created_or_renewed: persisted.length,
      skipped: summary.skipped + (candidates.length - persisted.length - failures.length),
      failed: failures.length,
      email_sent: emailSent,
      email_pending: emailPending,
    },
  });

  if (auditError)
    return NextResponse.json(
      {
        mode: "commit",
        valid: false,
        summary: commitSummary,
        invitations: persisted.map((item) => item.invitation),
        failures: [
          ...failures,
          ...deliveryFailures,
          { rowNumber: 0, email: "", message: "AUDIT_WRITE_FAILED" },
        ],
      },
      { status: 503 },
    );

  return NextResponse.json(
    {
      mode: "commit",
      valid: failures.length === 0 && emailPending === 0,
      summary: commitSummary,
      invitations: persisted.map((item) => item.invitation),
      failures: [...failures, ...deliveryFailures],
    },
    { status: failures.length || emailPending ? 207 : 201 },
  );
}
