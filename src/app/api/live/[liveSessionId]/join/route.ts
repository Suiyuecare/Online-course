import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { PlatformApplication } from "@/application/platform";
import {
  resolveRegistrantReceiptWriteFailure,
  zoomRegistrantReceiptSchema,
} from "@/application/zoom-provider-reconciliation";
import { zoomMeetingAdapter } from "@/infrastructure/adapters/zoom";
import {
  decryptZoomSecret,
  encryptZoomSecret,
} from "@/infrastructure/security/provider-secrets";
import {
  readProviderOperationReceipt,
  recordProviderOperationReceipt,
} from "@/infrastructure/supabase/provider-receipts";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

async function stageRegistrantReconciliation(input: {
  leaseId: string;
  meetingNumber: string;
  registrantId: string;
  encryptedRegistrantToken: z.infer<
    typeof zoomRegistrantReceiptSchema
  >["encryptedRegistrantToken"];
}) {
  const service = serviceSupabase();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await service.rpc(
      "stage_zoom_registrant_reconciliation",
      {
        p_lease_id: input.leaseId,
        p_meeting_number: input.meetingNumber,
        p_provider_registrant_id: input.registrantId,
        p_encrypted_registrant_token: input.encryptedRegistrantToken,
      },
    );
    if (!error) return;
  }
  throw new Error("ZOOM_REGISTRANT_RECONCILIATION_STAGE_FAILED");
}

export async function POST(
  request: Request,
  context: { params: Promise<{ liveSessionId: string }> },
) {
  return mutation(request, async () => {
    const { supabase } = await requireUser();
    const { liveSessionId } = await context.params;
    const { deviceHash } = await readJson(
      request,
      z.object({ deviceHash: z.string().regex(/^[a-f0-9]{64}$/) }),
    );
    let lease: Awaited<ReturnType<PlatformApplication["issueLiveJoinLease"]>>;
    try {
      lease = await new PlatformApplication(supabase).issueLiveJoinLease({
        liveSessionId,
        deviceHash,
        idempotencyKey: requireIdempotencyKey(request),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("JOIN_LEASE_EXPIRED_OR_ABORTED")
      ) {
        throw new Error("LIVE_JOIN_ATTEMPT_EXPIRED");
      }
      throw error;
    }
    const zoom = zoomMeetingAdapter();
    const receiptBusinessKey = `zoom-registrant:${lease.leaseId}`;
    const existingReceipt = await readProviderOperationReceipt({
      provider: "zoom",
      operation: "register_participant",
      businessKey: receiptBusinessKey,
    });
    let receipt = existingReceipt
      ? zoomRegistrantReceiptSchema.parse(existingReceipt.responsePayload)
      : null;
    if (
      receipt &&
      existingReceipt?.providerReference !== receipt.registrantId
    ) {
      throw new Error("ZOOM_REGISTRANT_RECEIPT_INVALID");
    }
    if (!receipt && lease.replayed) {
      // A previous request may have reached Zoom before losing its response.
      // Without a durable encrypted receipt, registering again could create a
      // second participant, so this requires expiry cleanup/reconciliation.
      throw new Error("ZOOM_REGISTRATION_RECONCILIATION_REQUIRED");
    }
    if (!receipt) {
      const registered = await zoom.registerParticipant({
        meetingNumber: lease.meetingNumber,
        email: lease.syntheticEmail,
        displayName: lease.displayName,
        customerKey: lease.customerKey,
      });
      receipt = {
        registrantId: registered.registrantId,
        encryptedRegistrantToken: encryptZoomSecret(
          registered.registrantToken,
          `zoom-registrant:${lease.leaseId}`,
        ),
      };
      try {
        await stageRegistrantReconciliation({
          leaseId: lease.leaseId,
          meetingNumber: lease.meetingNumber,
          registrantId: receipt.registrantId,
          encryptedRegistrantToken: receipt.encryptedRegistrantToken,
        });
      } catch (stageError) {
        // No receipt write has been attempted yet. Revoking here cannot leave
        // an immutable receipt pointing at a revoked registrant. A staging RPC
        // that committed despite losing its response will safely replay the
        // same idempotent revoke in the durable worker.
        await zoom.revokeRegistrant(lease.meetingNumber, receipt.registrantId);
        throw stageError;
      }
      try {
        await recordProviderOperationReceipt({
          provider: "zoom",
          operation: "register_participant",
          businessKey: receiptBusinessKey,
          providerReference: receipt.registrantId,
          responsePayload: receipt,
        });
      } catch (receiptError) {
        const resolution = await resolveRegistrantReceiptWriteFailure({
          candidate: receipt,
          readAuthoritative: () =>
            readProviderOperationReceipt({
              provider: "zoom",
              operation: "register_participant",
              businessKey: receiptBusinessKey,
            }),
        });
        if (resolution.outcome !== "authoritative") {
          // The candidate and its encrypted token were durably staged before
          // the receipt attempt. Only the fenced reconciliation worker may
          // now preserve or revoke it. A null read remains an unknown outcome.
          throw new Error("ZOOM_REGISTRATION_RECONCILIATION_REQUIRED", {
            cause: receiptError,
          });
        }
        receipt = resolution.receipt;
      }
    }
    const { error } = await serviceSupabase().rpc("finalize_live_join_lease", {
      p_lease_id: lease.leaseId,
      p_provider_registrant_id: receipt.registrantId,
      p_registrant_token_ciphertext: receipt.encryptedRegistrantToken,
    });
    if (error) {
      // The encrypted provider receipt is durable. Same-key replay reuses it
      // and safely retries this database finalize without a second registrant.
      throw new Error("LIVE_JOIN_SAGA_FAILED");
    }
    const registrantToken = decryptZoomSecret(
      receipt.encryptedRegistrantToken,
      `zoom-registrant:${lease.leaseId}`,
    );
    const credentials = zoom.createParticipantSignature(lease.meetingNumber);
    const passcode = decryptZoomSecret(
      lease.encryptedPasscode,
      `zoom-meeting:${liveSessionId}`,
    );
    return {
      leaseId: lease.leaseId,
      lastHeartbeatSequence: lease.lastHeartbeatSequence,
      meetingNumber: lease.meetingNumber,
      passcode,
      registrantToken,
      displayName: lease.displayName,
      syntheticEmail: lease.syntheticEmail,
      customerKey: lease.customerKey,
      ...credentials,
    };
  });
}
