import { createHash } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  evidenceKind: z.enum([
    "storage_manifest_registered",
    "storage_restore_verified",
    "archive_reload_verified",
    "deletion_tombstones_replayed",
    "audit_chain_verified",
    "database_backup_manifest_registered",
    "database_restore_verified",
  ]),
  targetType: z.enum([
    "storage_bucket",
    "archive_manifest",
    "deletion_manifest",
    "audit_checkpoint",
    "database",
  ]),
  targetIdentifier: z.string().trim().min(1).max(100),
  outcome: z.enum(["passed", "failed"]),
  evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  externalReference: z.string().trim().min(3).max(500),
  reason: z.string().trim().min(10).max(1000),
  observedAt: z.string().datetime({ offset: true }),
  stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const idempotencyKey = requireIdempotencyKey(request);
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("record_operations_evidence", {
      p_evidence_kind: input.evidenceKind,
      p_target_type: input.targetType,
      p_target_identifier: input.targetIdentifier,
      p_outcome: input.outcome,
      p_evidence_sha256: input.evidenceSha256,
      p_external_reference: input.externalReference,
      p_reason: input.reason,
      p_observed_at: input.observedAt,
      p_idempotency_key: idempotencyKey,
      p_nonce_hash: createHash("sha256")
        .update(input.stepUpNonce)
        .digest("hex"),
    });
    if (error || !data) throw new Error("OPERATIONS_EVIDENCE_REJECTED");
    return { evidenceEventId: data };
  });
}
