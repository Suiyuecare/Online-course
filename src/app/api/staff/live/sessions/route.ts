import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import {
  breaksFitTeachingWindow,
  liveBreakIntervalsSchema,
  totalBreakSeconds,
} from "@/domain/live-breaks";
import { zoomMeetingReceiptSchema } from "@/domain/zoom-setup";
import { zoomMeetingAdapter } from "@/infrastructure/adapters/zoom";
import { encryptZoomSecret } from "@/infrastructure/security/provider-secrets";
import {
  readProviderOperationReceipt,
  recordProviderOperationReceipt,
} from "@/infrastructure/supabase/provider-receipts";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

const schema = z
  .object({
    courseVersionId: z.uuid(),
    hybridComponentId: z.uuid().nullable().optional(),
    hostResourceId: z.uuid(),
    title: z.string().trim().min(2).max(200),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    bookingCloseAt: z.iso.datetime({ offset: true }),
    learnerCapacity: z.number().int().min(1).max(200),
    verifiedZoomTotalCapacity: z.number().int().positive(),
    hostSeats: z.number().int().min(1).max(5),
    cohostSeats: z.number().int().min(0).max(10),
    reservedSupportSeats: z.number().int().min(0).max(20),
    breakIntervals: liveBreakIntervalsSchema,
    presenceThreshold: z.number().min(80).max(100),
    cameraThreshold: z.number().min(80).max(100),
  })
  .refine((input) => Date.parse(input.endsAt) > Date.parse(input.startsAt), {
    message: "end must be after start",
  })
  .refine(
    (input) => Date.parse(input.bookingCloseAt) < Date.parse(input.startsAt),
    { message: "booking close must precede start" },
  )
  .superRefine((input, context) => {
    if (!breaksFitTeachingWindow(input)) {
      context.addIssue({
        code: "custom",
        message: "BREAK_OUTSIDE_TEACHING_WINDOW",
        path: ["breakIntervals"],
      });
    }
    const teachingSeconds =
      (Date.parse(input.endsAt) - Date.parse(input.startsAt)) / 1000;
    if (totalBreakSeconds(input.breakIntervals) >= teachingSeconds) {
      context.addIssue({
        code: "custom",
        message: "BREAKS_CONSUME_TEACHING_WINDOW",
        path: ["breakIntervals"],
      });
    }
  });

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(request, schema);
    const idempotencyKey = requireIdempotencyKey(request);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("prepare_live_session_setup", {
      p_spec: input,
      p_idempotency_key: idempotencyKey,
    });
    const prepared = z
      .object({
        liveSessionId: z.uuid(),
        hostUserReference: z.string().min(1),
        topic: z.string().min(1),
        startsAt: z.string(),
        durationMinutes: z.number().int().positive(),
      })
      .safeParse(data);
    if (error || !prepared.success) {
      throw new Error("LIVE_SESSION_RESERVATION_REJECTED");
    }
    const zoom = zoomMeetingAdapter();
    const businessKey = `zoom-meeting:${prepared.data.liveSessionId}`;
    let createdMeetingNumber: string | null = null;
    let receiptWriteOutcome:
      | "not_attempted"
      | "unknown"
      | "confirmed"
      | "confirmed_absent"
      | "competing" = "not_attempted";
    try {
      const existingReceipt = await readProviderOperationReceipt({
        provider: "zoom",
        operation: "create_meeting",
        businessKey,
      });
      let meeting = existingReceipt
        ? zoomMeetingReceiptSchema.parse(existingReceipt.responsePayload)
        : null;
      receiptWriteOutcome = existingReceipt ? "confirmed" : "not_attempted";
      if (!meeting) {
        const expectedProviderHostId = await zoom.resolveHostIdentity(
          prepared.data.hostUserReference,
        );
        const { data: rawClaim, error: claimError } = await supabase.rpc(
          "claim_zoom_meeting_provider_request",
          {
            p_live_session_id: prepared.data.liveSessionId,
            p_claim_id: randomUUID(),
            p_provider_host_id: expectedProviderHostId,
          },
        );
        const claim = z
          .object({
            claimed: z.boolean(),
            reused: z.boolean(),
            claimedAt: z.iso.datetime({ offset: true }).optional(),
          })
          .safeParse(rawClaim);
        if (claimError || !claim.success) {
          throw new Error("ZOOM_MEETING_PROVIDER_CLAIM_FAILED");
        }
        if (!claim.data.claimed) {
          throw new Error("ZOOM_MEETING_REQUEST_IN_PROGRESS");
        }
        const created = await zoom.createMeeting({
          hostUserId: prepared.data.hostUserReference,
          topic: prepared.data.topic,
          startsAt: prepared.data.startsAt,
          durationMinutes: prepared.data.durationMinutes,
          timezone: "Asia/Taipei",
        });
        createdMeetingNumber = String(created.id);
        meeting = zoomMeetingReceiptSchema.parse({
          meetingNumber: createdMeetingNumber,
          meetingUuid: created.uuid,
          meetingType: 2,
          topic: prepared.data.topic,
          startsAt: prepared.data.startsAt,
          durationMinutes: prepared.data.durationMinutes,
          encryptedPasscode: encryptZoomSecret(
            created.password,
            `zoom-meeting:${prepared.data.liveSessionId}`,
          ),
          providerHostId: created.host_id,
          safety: await zoom.verifyMeetingSafety(created, {
            hostId: expectedProviderHostId,
            topic: prepared.data.topic,
            startsAt: prepared.data.startsAt,
            durationMinutes: prepared.data.durationMinutes,
          }),
        });
        receiptWriteOutcome = "unknown";
        await recordProviderOperationReceipt({
          provider: "zoom",
          operation: "create_meeting",
          businessKey,
          providerReference: meeting.meetingNumber,
          responsePayload: meeting,
        });
        receiptWriteOutcome = "confirmed";
      }
      const service = serviceSupabase();
      const { error: finalizeError } = await service.rpc(
        "finalize_verified_live_session_setup",
        {
          p_live_session_id: prepared.data.liveSessionId,
          p_meeting_number: meeting.meetingNumber,
          p_meeting_uuid: meeting.meetingUuid,
          p_encrypted_passcode: meeting.encryptedPasscode,
          p_provider_host_id: meeting.providerHostId,
          p_accountless_join_enabled: meeting.safety.accountlessJoinEnabled,
          p_waiting_room: meeting.safety.waitingRoom,
          p_participant_rename_disabled:
            meeting.safety.participantRenameDisabled,
          p_participant_share_disabled: meeting.safety.participantShareDisabled,
          p_cloud_recording_disabled: meeting.safety.cloudRecordingDisabled,
          p_removed_participant_rejoin_disabled:
            meeting.safety.removedParticipantRejoinDisabled,
        },
      );
      if (finalizeError) throw new Error("LIVE_SETUP_FINALIZE_FAILED");
      return {
        liveSessionId: prepared.data.liveSessionId,
        scheduled: true,
        reusedProviderMeeting: existingReceipt !== null,
      };
    } catch (caught) {
      if (receiptWriteOutcome === "unknown" && createdMeetingNumber !== null) {
        try {
          const competingReceipt = await readProviderOperationReceipt({
            provider: "zoom",
            operation: "create_meeting",
            businessKey,
          });
          receiptWriteOutcome =
            competingReceipt === null
              ? "confirmed_absent"
              : competingReceipt.providerReference === createdMeetingNumber
                ? "confirmed"
                : "competing";
        } catch {
          // Keep the explicit unknown state. A receipt write may have committed
          // even when both its response and the authoritative read were lost.
        }
      }
      const deletionPermitted =
        receiptWriteOutcome === "not_attempted" ||
        receiptWriteOutcome === "competing";
      // Even an authoritative null read cannot prove a timed-out write is no
      // longer running. After any write attempt, only a competing immutable
      // receipt proves this meeting cannot become authoritative.
      if (deletionPermitted && createdMeetingNumber !== null) {
        try {
          await zoom.deleteMeeting(createdMeetingNumber);
          if (receiptWriteOutcome !== "competing") {
            const { error: abandonError } = await serviceSupabase().rpc(
              "fail_claimed_live_session_setup",
              {
                p_live_session_id: prepared.data.liveSessionId,
                p_reason: caught instanceof Error ? caught.message : "unknown",
                p_provider_delete_confirmed: true,
              },
            );
            if (abandonError) {
              throw new Error("ZOOM_PROVIDER_DELETE_NOT_RECORDED");
            }
          }
        } catch (deleteFailure) {
          const { error: cleanupError } = await serviceSupabase().rpc(
            "enqueue_zoom_orphan_cleanup",
            {
              p_live_session_id: prepared.data.liveSessionId,
              p_provider_meeting_number: createdMeetingNumber,
              p_reason:
                deleteFailure instanceof Error
                  ? deleteFailure.message
                  : "ZOOM_PROVIDER_DELETE_FAILED",
            },
          );
          if (cleanupError) {
            throw new Error("ZOOM_ORPHAN_CLEANUP_ENQUEUE_FAILED");
          }
        }
      }
      throw new Error("LIVE_PROVIDER_SETUP_FAILED");
    }
  });
}
