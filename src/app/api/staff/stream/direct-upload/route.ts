import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { streamAdapter } from "@/infrastructure/adapters/stream";
import {
  readProviderOperationReceipt,
  recordProviderOperationReceipt,
} from "@/infrastructure/supabase/provider-receipts";
import { requireUser } from "@/infrastructure/supabase/server";

const preparedIntentSchema = z.object({
  intentId: z.uuid(),
  status: z.enum(["prepared", "registered", "failed"]),
  providerUid: z.string().nullable(),
  videoAssetId: z.uuid().nullable(),
  expiresAt: z.iso.datetime({ offset: true }),
  reused: z.boolean(),
});

const uploadReceiptSchema = z.object({
  uid: z.string().min(1).max(200),
  uploadURL: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
});

const registeredUploadSchema = z.object({
  videoAssetId: z.uuid(),
  providerUid: z.string().min(1),
  reused: z.boolean(),
});

const providerClaimSchema = z.object({
  claimed: z.boolean(),
  reused: z.boolean(),
  claimedAt: z.iso.datetime({ offset: true }).optional(),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const { supabase } = await requireUser();
    const { data: authorized } = await supabase.rpc("authorize_staff_action", {
      p_required_role: "course_admin",
      p_action: "stream.create_upload",
      p_target: "new_video_asset",
    });
    if (!authorized) throw new Error("STAFF_AUTHORIZATION_REQUIRED");
    const { lessonId, maxDurationSeconds } = await readJson(
      request,
      z.object({
        lessonId: z.uuid(),
        maxDurationSeconds: z.number().int().min(60).max(28_800),
      }),
    );
    const idempotencyKey = requireIdempotencyKey(request);
    const stream = streamAdapter();
    const { data: rawIntent, error: intentError } = await supabase.rpc(
      "prepare_stream_upload_intent",
      {
        p_lesson_id: lessonId,
        p_max_duration_seconds: maxDurationSeconds,
        p_idempotency_key: idempotencyKey,
      },
    );
    const intent = preparedIntentSchema.safeParse(rawIntent);
    if (intentError || !intent.success) {
      throw new Error("STREAM_UPLOAD_INTENT_FAILED");
    }
    if (intent.data.status === "failed") {
      throw new Error("STREAM_UPLOAD_REQUEST_ALREADY_FAILED");
    }

    const businessKey = `stream-direct-upload:${intent.data.intentId}`;
    const existingReceipt = await readProviderOperationReceipt({
      provider: "cloudflare_stream",
      operation: "direct_upload",
      businessKey,
    });
    if (intent.data.status === "registered" && !existingReceipt) {
      throw new Error("STREAM_UPLOAD_RECEIPT_MISSING");
    }

    let upload = existingReceipt
      ? uploadReceiptSchema.parse(existingReceipt.responsePayload)
      : null;
    if (!upload) {
      const { data: rawClaim, error: claimError } = await supabase.rpc(
        "claim_stream_upload_provider_request",
        {
          p_intent_id: intent.data.intentId,
          p_claim_id: randomUUID(),
        },
      );
      const claim = providerClaimSchema.safeParse(rawClaim);
      if (claimError || !claim.success) {
        throw new Error("STREAM_UPLOAD_PROVIDER_CLAIM_FAILED");
      }
      if (!claim.data.claimed) {
        throw new Error("STREAM_UPLOAD_REQUEST_IN_PROGRESS");
      }
      try {
        const created = await stream.createDirectUpload(
          maxDurationSeconds,
          intent.data.intentId,
        );
        upload = {
          ...created,
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        };
        try {
          await recordProviderOperationReceipt({
            provider: "cloudflare_stream",
            operation: "direct_upload",
            businessKey,
            providerReference: upload.uid,
            responsePayload: upload,
          });
        } catch (receiptError) {
          await stream.deleteAsset(upload.uid);
          await supabase.rpc("fail_stream_upload_intent", {
            p_intent_id: intent.data.intentId,
            p_reason: "provider receipt persistence failed; asset deleted",
          });
          throw receiptError;
        }
      } catch (providerError) {
        await supabase.rpc("fail_stream_upload_intent", {
          p_intent_id: intent.data.intentId,
          p_reason:
            providerError instanceof Error
              ? providerError.message
              : "provider request failed",
        });
        throw providerError;
      }
    }

    if (Date.parse(upload.expiresAt) <= Date.now()) {
      if (intent.data.status === "prepared") {
        await stream.deleteAsset(upload.uid);
        await supabase.rpc("fail_stream_upload_intent", {
          p_intent_id: intent.data.intentId,
          p_reason: "direct upload URL expired before registration",
        });
      }
      throw new Error("STREAM_UPLOAD_URL_EXPIRED");
    }

    const { data: rawRegistered, error: registrationError } =
      await supabase.rpc("finalize_stream_upload_intent", {
        p_intent_id: intent.data.intentId,
        p_provider_uid: upload.uid,
      });
    const registered = registeredUploadSchema.safeParse(rawRegistered);
    if (registrationError || !registered.success) {
      // The receipt is durable. A retry with the same key reuses the provider
      // object and can safely finish the database transaction.
      throw new Error("STREAM_UPLOAD_REGISTRATION_FAILED");
    }
    return {
      videoAssetId: registered.data.videoAssetId,
      providerUid: registered.data.providerUid,
      uploadURL: upload.uploadURL,
      expiresAt: upload.expiresAt,
      expiresInSeconds: Math.max(
        0,
        Math.floor((Date.parse(upload.expiresAt) - Date.now()) / 1000),
      ),
      reused:
        intent.data.reused ||
        existingReceipt !== null ||
        registered.data.reused,
    };
  });
}
