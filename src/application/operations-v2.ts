import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const nullableTimestamp = z.string().nullable();

export const auditExplorerSchema = z.object({
  items: z.array(
    z.object({
      sequence: z.string().regex(/^[1-9][0-9]*$/),
      action: z.string(),
      targetType: z.string(),
      targetReference: z.string().regex(/^[a-f0-9]{16}$/),
      actorKind: z.enum(["system", "identified_actor"]),
      organizationScoped: z.boolean(),
      hasReason: z.boolean(),
      eventHash: z.string().regex(/^[a-f0-9]{64}$/),
      occurredAt: z.string(),
    }),
  ),
  nextCursor: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .nullable(),
  filters: z.object({
    actionPrefix: z.string().nullable(),
    targetType: z.string().nullable(),
  }),
});

export type AuditExplorer = z.infer<typeof auditExplorerSchema>;

export async function readAuditExplorer(
  client: SupabaseClient,
  filters: {
    actionPrefix?: string;
    targetType?: string;
    cursor?: string;
    limit?: number;
  } = {},
): Promise<AuditExplorer> {
  const { data, error } = await client.rpc("read_staff_audit_events", {
    p_action_prefix: filters.actionPrefix?.trim() || null,
    p_target_type: filters.targetType?.trim() || null,
    p_cursor_before: filters.cursor ?? null,
    p_limit: filters.limit ?? 25,
  });
  if (error) throw new Error("AUDIT_EXPLORER_UNAVAILABLE");
  const parsed = auditExplorerSchema.safeParse(data);
  if (!parsed.success) throw new Error("AUDIT_EXPLORER_INVALID");
  return parsed.data;
}

export const slaWorkspaceSchema = z.object({
  generatedAt: z.string(),
  nextCursor: z
    .object({
      deadlineAt: z.string(),
      reference: z.string().regex(/^(SUP|REF)-[A-F0-9]{12}$/),
    })
    .nullable(),
  items: z.array(
    z.object({
      sourceKind: z.enum(["support_case", "refund_case"]),
      reference: z.string(),
      category: z.string(),
      status: z.string(),
      priority: z.string(),
      deadlineAt: z.string(),
      slaState: z.enum(["overdue", "due_soon", "on_track"]),
      assigned: z.boolean(),
      latestEscalationAt: nullableTimestamp,
    }),
  ),
});

export type SlaWorkspace = z.infer<typeof slaWorkspaceSchema>;

export async function readSlaWorkspace(
  client: SupabaseClient,
  scope: "support" | "refund" | "all",
  options: {
    cursor?: { deadlineAt: string; reference: string };
    limit?: number;
  } = {},
): Promise<SlaWorkspace> {
  const { data, error } = await client.rpc("read_staff_sla_workspace", {
    p_scope: scope,
    p_cursor_deadline: options.cursor?.deadlineAt ?? null,
    p_cursor_reference: options.cursor?.reference ?? null,
    p_limit: options.limit ?? 50,
  });
  if (error) throw new Error("SLA_WORKSPACE_UNAVAILABLE");
  const parsed = slaWorkspaceSchema.safeParse(data);
  if (!parsed.success) throw new Error("SLA_WORKSPACE_INVALID");
  return parsed.data;
}

export const retentionControlPlaneSchema = z.object({
  policies: z.array(
    z.object({
      policyRevisionId: z.string().uuid(),
      dataClass: z.string(),
      revision: z.number().int().positive(),
      onlineDays: z.number().int().nonnegative(),
      archiveDays: z.number().int().nonnegative(),
      effectiveAt: z.string(),
      dryRunSupported: z.boolean(),
      latestRequest: z
        .object({
          requestId: z.string().uuid(),
          cutoffAt: z.string(),
          candidateCount: z.number().int().nonnegative(),
          candidateDigest: z.string().regex(/^[a-f0-9]{64}$/),
          requestedAt: z.string(),
          status: z.enum(["pending", "approve", "reject"]),
          canReview: z.boolean(),
        })
        .nullable(),
    }),
  ),
  notice: z.string(),
});

export type RetentionControlPlane = z.infer<typeof retentionControlPlaneSchema>;

export async function readRetentionControlPlane(
  client: SupabaseClient,
): Promise<RetentionControlPlane> {
  const { data, error } = await client.rpc("read_retention_control_plane");
  if (error) throw new Error("RETENTION_CONTROL_PLANE_UNAVAILABLE");
  const parsed = retentionControlPlaneSchema.safeParse(data);
  if (!parsed.success) throw new Error("RETENTION_CONTROL_PLANE_INVALID");
  return parsed.data;
}
