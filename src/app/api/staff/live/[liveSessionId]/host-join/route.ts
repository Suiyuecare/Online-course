import { createHash } from "node:crypto";
import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { zoomMeetingAdapter } from "@/infrastructure/adapters/zoom";
import { decryptZoomSecret } from "@/infrastructure/security/provider-secrets";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ liveSessionId: string }> },
) {
  return mutation(request, async () => {
    const { liveSessionId } = await context.params;
    z.uuid().parse(liveSessionId);
    const { stepUpNonce } = await readJson(
      request,
      z.object({ stepUpNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("read_host_join_context", {
      p_live_session_id: liveSessionId,
      p_nonce_hash: createHash("sha256").update(stepUpNonce).digest("hex"),
    });
    if (error || !data) throw new Error("HOST_JOIN_NOT_AUTHORIZED");
    const contextData = z
      .object({
        meetingNumber: z.string().min(1),
        encryptedPasscode: z.object({
          version: z.literal(1),
          iv: z.string(),
          ciphertext: z.string(),
          tag: z.string(),
        }),
        providerHostId: z.string().min(1),
        displayName: z.string().min(1),
      })
      .parse(data);
    const zoom = zoomMeetingAdapter();
    const [credentials, zak] = await Promise.all([
      Promise.resolve(zoom.createHostSignature(contextData.meetingNumber)),
      zoom.getHostZak(contextData.providerHostId),
    ]);
    const passcode = decryptZoomSecret(
      contextData.encryptedPasscode,
      `zoom-meeting:${liveSessionId}`,
    );
    zoom.assertSafeJoinPayload({ passcode, zak });
    return {
      ...credentials,
      meetingNumber: contextData.meetingNumber,
      passcode,
      zak,
      displayName: contextData.displayName,
      ephemeral: true,
    };
  });
}
