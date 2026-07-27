import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const provider = z.enum([
  "supabase_phone_auth",
  "twilio_verify",
  "cloudflare_stream",
  "zoom_oauth",
  "zoom_meeting_sdk",
  "resend",
  "managed_kms",
  "malware_scanner",
  "external_monitor",
]);

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(
      request,
      z.object({
        provider,
        evidenceReference: z.string().trim().min(3).max(500),
        evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
        testedAt: z.iso.datetime({ offset: true }),
        reason: z.string().trim().min(10).max(1000),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("request_provider_validation", {
      p_provider: input.provider,
      p_evidence_reference: input.evidenceReference,
      p_evidence_sha256: input.evidenceSha256,
      p_tested_at: input.testedAt,
      p_reason: input.reason,
      p_idempotency_key: requireIdempotencyKey(request),
    });
    if (error || !data) throw new Error("PROVIDER_VALIDATION_REQUEST_REJECTED");
    return { requestId: data };
  });
}
