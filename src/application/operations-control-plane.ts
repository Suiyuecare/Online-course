import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const nullableTimestamp = z.string().nullable();

export const operationsIncidentActionSchema = z.enum([
  "contain",
  "investigate",
  "record_legal_contact",
  "resolve",
  "close",
  "reopen",
]);

export const operationsControlPlaneSchema = z.object({
  generatedAt: z.string(),
  runtime: z.object({
    workers: z.array(
      z.object({
        workerName: z.string(),
        lastSuccessAt: nullableTimestamp,
        fresh: z.boolean(),
        reportedDeadLetterCount: z.number().int().nonnegative(),
      }),
    ),
    durableDeadLetterCount: z.number().int().nonnegative(),
    notificationDeadLetterCount: z.number().int().nonnegative(),
    oldestDueJobAt: nullableTimestamp,
    oldestDueNotificationAt: nullableTimestamp,
  }),
  incidents: z.array(
    z.object({
      id: z.string().uuid(),
      severity: z.enum(["low", "medium", "high", "critical"]),
      status: z.enum([
        "open",
        "contained",
        "investigating",
        "resolved",
        "closed",
      ]),
      detectedAt: z.string(),
      containedAt: nullableTimestamp,
      legalContactedAt: nullableTimestamp,
      notificationDeadlineAt: nullableTimestamp,
      deadlineState: z.enum([
        "not_set",
        "recorded",
        "overdue",
        "due_soon",
        "open",
      ]),
      pendingRequest: z
        .object({
          id: z.string().uuid(),
          action: operationsIncidentActionSchema,
          requestedAt: z.string(),
          canReview: z.boolean(),
        })
        .nullable(),
    }),
  ),
  deadLetters: z.array(
    z.object({
      sourceKind: z.enum(["durable_job", "notification_outbox"]),
      sourceId: z.string().uuid(),
      itemType: z.string(),
      attemptCount: z.number().int().nonnegative(),
      createdAt: z.string(),
      retryable: z.boolean(),
      requiresReconciliation: z.boolean(),
      failureClass: z.enum([
        "unknown",
        "configuration",
        "authorization",
        "ambiguous_timeout",
        "execution_failure",
        "delivery_failure",
      ]),
      latestAction: z.enum(["retry", "acknowledge"]).nullable(),
    }),
  ),
  evidence: z.object({
    storageBuckets: z.array(
      z.object({
        bucketName: z.string(),
        latestManifestAt: nullableTimestamp,
        latestRestoreVerifiedAt: nullableTimestamp,
        legacyManifestCount: z.number().int().nonnegative(),
      }),
    ),
    latestDatabaseBackupAt: nullableTimestamp,
    latestDatabaseRestoreVerifiedAt: nullableTimestamp,
    latestArchiveReloadVerifiedAt: nullableTimestamp,
    latestDeletionTombstonesReplayedAt: nullableTimestamp,
    latestAuditChainVerifiedAt: nullableTimestamp,
    latestAuditCheckpointAt: nullableTimestamp,
  }),
});

export type OperationsControlPlane = z.infer<
  typeof operationsControlPlaneSchema
>;

export type OperationsIncidentAction = z.infer<
  typeof operationsIncidentActionSchema
>;

export async function readOperationsControlPlane(
  client: SupabaseClient,
): Promise<OperationsControlPlane> {
  const { data, error } = await client.rpc("read_operations_control_plane");
  if (error) throw new Error("OPERATIONS_CONTROL_PLANE_UNAVAILABLE");
  const parsed = operationsControlPlaneSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("OPERATIONS_CONTROL_PLANE_INVALID");
  }
  return parsed.data;
}
