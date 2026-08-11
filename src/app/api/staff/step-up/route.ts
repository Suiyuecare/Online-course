import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  action: z.enum([
    "host_join",
    "course_publish",
    "accreditation_export",
    "accreditation_result",
    "pii_decrypt",
    "certificate_revoke",
    "attendance_override",
    "role_change",
    "identity_recovery",
    "deletion_approve",
    "refund_decision",
    "refund_account",
    "refund_disbursement",
    "point_refund_decision",
    "point_refund_account",
    "point_refund_result",
    "invoice_decision",
    "bank_reconciliation",
    "emergency_suspend",
    "platform_prerequisite_review",
    "provider_reconcile",
    "incident_transition",
    "operations_dead_letter",
    "operations_evidence",
    "retention_dry_run",
  ]),
  target: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const nonce = randomBytes(32).toString("base64url");
    const nonceHash = createHash("sha256").update(nonce).digest("hex");
    const { data, error } = await supabase.rpc("issue_step_up_grant", {
      p_action: input.action,
      p_target: input.target,
      p_nonce_hash: nonceHash,
    });
    if (error || !data) throw new Error("FRESH_TOTP_STEP_UP_REQUIRED");
    return {
      nonce,
      expiresAfterSeconds: 300,
      binding: { action: input.action, target: input.target },
    };
  });
}
