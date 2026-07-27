import { serviceSupabase } from "@/infrastructure/supabase/server";
import { canonicalFingerprint } from "@/infrastructure/security/signatures";

export async function ingestProviderEvent(input: {
  provider: "cloudflare_stream" | "zoom" | "resend";
  eventType: string;
  nativeEventId: string | null;
  occurredAt: string | null;
  payload: unknown;
  environment: string;
}) {
  const fingerprint =
    input.nativeEventId ??
    canonicalFingerprint({
      provider: input.provider,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      payload: input.payload,
    });
  const { data, error } = await serviceSupabase().rpc("ingest_provider_event", {
    p_provider: input.provider,
    p_event_type: input.eventType,
    p_native_event_id: input.nativeEventId,
    p_fingerprint: fingerprint,
    p_occurred_at: input.occurredAt,
    p_payload: input.payload,
    p_environment: input.environment,
  });
  if (error) throw new Error(`PROVIDER_EVENT_REJECTED:${error.message}`);
  return data;
}
