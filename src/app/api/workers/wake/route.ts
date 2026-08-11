import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  settleDurableJobLease,
  type DurableJobLease,
} from "@/application/durable-job-worker";
import {
  executeZoomOrphanCleanup,
  executeZoomRegistrantReconciliation,
} from "@/application/zoom-provider-reconciliation";
import { zoomMeetingReceiptSchema } from "@/domain/zoom-setup";
import { certificateRenderer } from "@/infrastructure/adapters/certificate-renderer";
import { IdentityRecoveryAdapter } from "@/infrastructure/adapters/identity-recovery";
import {
  decryptWithDataKey,
  kmsAdapter,
  type Envelope,
} from "@/infrastructure/adapters/kms";
import { messagingAdapter } from "@/infrastructure/adapters/sms";
import { notificationAdapter } from "@/infrastructure/adapters/notifications";
import { malwareScanner } from "@/infrastructure/adapters/malware-scanner";
import { zoomMeetingAdapter } from "@/infrastructure/adapters/zoom";
import { publicConfig, serverConfig } from "@/infrastructure/config";
import { readVerifiedIdentityName } from "@/infrastructure/security/accreditation-identity";
import { encryptZoomSecret } from "@/infrastructure/security/provider-secrets";
import {
  readProviderOperationReceipt,
  recordProviderOperationReceipt,
} from "@/infrastructure/supabase/provider-receipts";
import { serviceSupabase } from "@/infrastructure/supabase/server";

function sameSecret(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const configured = serverConfig().CRON_SECRET;
  const presented = request.headers
    .get("authorization")
    ?.replace("Bearer ", "");
  if (!configured || !presented || !sameSecret(configured, presented)) {
    return NextResponse.json({ accepted: false }, { status: 401 });
  }
  const workerId = randomUUID();
  const service = serviceSupabase();
  const config = serverConfig();
  const degradedReasons: string[] = [];
  const { error: heartbeatStartError } = await service.rpc(
    "record_worker_heartbeat",
    {
      p_worker_name: "vercel-cron",
      p_succeeded: false,
    },
  );
  if (heartbeatStartError) {
    degradedReasons.push("worker_heartbeat_start_failed");
  }
  const { error: couponReleaseError } = await service.rpc(
    "release_due_coupon_reservations",
    { p_limit: 500 },
  );
  if (couponReleaseError) {
    degradedReasons.push("coupon_reservation_release_failed");
  }
  const { error: slaEnqueueError } = await service.rpc(
    "enqueue_due_sla_escalations",
  );
  if (slaEnqueueError) {
    degradedReasons.push("sla_escalation_enqueue_failed");
  }
  const allDisabled = config.EMERGENCY_DISABLE_ALL === "true";
  const emergencyAllowedJobTypes = allDisabled
    ? [
        "provider_event_process",
        "live_join_lease_expiry",
        "zoom_registrant_reconcile",
        "zoom_orphan_cleanup",
        "quarantine_scan",
        "profile_media_purge",
        "sla_escalation_record",
      ]
    : null;
  const excludedJobTypes =
    !allDisabled && config.EMERGENCY_DISABLE_CERTIFICATES === "true"
      ? ["completion_evaluate"]
      : [];
  if (!allDisabled) {
    const { error: reminderError } = await service.rpc(
      "enqueue_due_live_reminders",
    );
    if (reminderError) degradedReasons.push("live_reminder_enqueue_failed");
  }
  const { data, error } = await service.rpc("lease_due_jobs_filtered", {
    p_worker_id: workerId,
    p_limit: 50,
    p_excluded_job_types: excludedJobTypes,
    p_allowed_job_types: emergencyAllowedJobTypes,
  });
  if (error) {
    return NextResponse.json(
      {
        accepted: false,
        degraded: true,
        reasons: [...degradedReasons, "durable_job_lease_failed"],
      },
      { status: 503 },
    );
  }
  const jobs = z
    .array(
      z.object({
        id: z.uuid(),
        job_type: z.string(),
        business_key: z.string(),
        payload: z.record(z.string(), z.unknown()),
        lease_generation: z.number().int().positive(),
      }),
    )
    .parse(data);
  const outcomes: { id: string; status: string }[] = [];
  for (const job of jobs) {
    const outcome = await settleDurableJobLease({
      job,
      workerId,
      process: processJob,
      finish: async (finish) => {
        const { data: status, error: finishError } = await service.rpc(
          "finish_durable_job",
          {
            p_job_id: finish.jobId,
            p_worker_id: finish.workerId,
            p_lease_generation: finish.leaseGeneration,
            p_succeeded: finish.succeeded,
            p_failure_message: finish.failureMessage,
          },
        );
        if (finishError) throw new Error("DURABLE_JOB_LEASE_FINISH_FAILED");
        return String(status);
      },
    });
    outcomes.push({ id: job.id, status: outcome.status });
    if (outcome.finishFailed) {
      degradedReasons.push(`job_finish_failed:${job.id}`);
    }
  }
  const notificationBatch = allDisabled
    ? { outcomes: [], degradedReason: null }
    : await deliverNotificationBatch(workerId, Math.max(0, 50 - jobs.length));
  if (notificationBatch.degradedReason) {
    degradedReasons.push(notificationBatch.degradedReason);
  }
  let degraded = degradedReasons.length > 0;
  const { error: heartbeatSuccessError } = await service.rpc(
    "record_worker_heartbeat",
    {
      p_worker_name: "vercel-cron",
      p_succeeded: !degraded,
    },
  );
  if (heartbeatSuccessError) {
    degradedReasons.push("worker_heartbeat_success_failed");
    degraded = true;
  }
  return NextResponse.json(
    {
      accepted: !degraded,
      degraded,
      reasons: degradedReasons,
      leased: jobs.length,
      outcomes,
      notifications: notificationBatch.outcomes,
    },
    { status: degraded ? 503 : 200 },
  );
}

const leasedNotificationSchema = z.object({
  id: z.uuid(),
  notification_id: z.uuid(),
  channel: z.enum(["email", "sms"]),
  template_key: z.string(),
  template_data: z.record(z.string(), z.unknown()),
  business_idempotency_key: z.string(),
});

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

const smsReceiptPayloadSchema = z.object({
  providerMessageId: z.string().min(1),
  status: z.string().optional(),
});

async function sendSmsWithReceipt(input: {
  businessKey: string;
  to: string;
  body: string;
}) {
  const existing = await readProviderOperationReceipt({
    provider: "twilio",
    operation: "send_sms",
    businessKey: input.businessKey,
  });
  if (existing) return smsReceiptPayloadSchema.parse(existing.responsePayload);

  const delivered = await messagingAdapter().send({
    to: input.to,
    body: input.body,
    idempotencyKey: input.businessKey,
  });
  const payload = smsReceiptPayloadSchema.parse(delivered);
  await recordProviderOperationReceipt({
    provider: "twilio",
    operation: "send_sms",
    businessKey: input.businessKey,
    providerReference: payload.providerMessageId,
    responsePayload: payload,
  });
  return payload;
}

const identityRecoveryReceiptSchema = z.object({
  replacementAuthUserId: z.uuid(),
  confirmationHash: z.string().regex(/^[a-f0-9]{64}$/),
});

async function completeIdentityRecoveryWithReceipt(recoveryCaseId: string) {
  const businessKey = `identity-recovery:${recoveryCaseId}`;
  const existing = await readProviderOperationReceipt({
    provider: "identity_recovery",
    operation: "complete",
    businessKey,
  });
  if (existing) {
    return identityRecoveryReceiptSchema.parse(existing.responsePayload);
  }
  const completion = identityRecoveryReceiptSchema.parse(
    await new IdentityRecoveryAdapter().complete({
      recoveryCaseId,
      idempotencyKey: businessKey,
    }),
  );
  await recordProviderOperationReceipt({
    provider: "identity_recovery",
    operation: "complete",
    businessKey,
    providerReference: completion.confirmationHash,
    responsePayload: completion,
  });
  return completion;
}

async function deliverNotificationBatch(workerId: string, limit: number) {
  if (limit <= 0) {
    return { outcomes: [], degradedReason: null as string | null };
  }
  const service = serviceSupabase();
  const { data, error: leaseError } = await service.rpc(
    "lease_notification_outbox",
    {
      p_worker_id: workerId,
      p_limit: limit,
    },
  );
  if (leaseError) {
    return {
      outcomes: [],
      degradedReason: "notification_outbox_lease_failed",
    };
  }
  const leased = z.array(leasedNotificationSchema).parse(data ?? []);
  const outcomes: { id: string; status: string }[] = [];
  let degradedReason: string | null = null;
  for (const outbox of leased) {
    let failure: string | null = null;
    let providerMessageId: string | null = null;
    try {
      const { data: rawDestination, error: destinationError } =
        await service.rpc("read_notification_destination", {
          p_outbox_id: outbox.id,
        });
      const destination = z
        .object({
          channel: z.enum(["email", "sms"]),
          destination: z.string().min(1),
          title: z.string(),
          body: z.string(),
        })
        .safeParse(rawDestination);
      if (destinationError || !destination.success) {
        throw new Error("VERIFIED_EMAIL_DESTINATION_REQUIRED");
      }
      if (destination.data.channel === "email") {
        const delivered = await notificationAdapter().deliver({
          to: destination.data.destination,
          subject: destination.data.title,
          html: `<main><h1>${escapeHtml(destination.data.title)}</h1><p>${escapeHtml(destination.data.body)}</p><p>歲悅學苑</p></main>`,
          idempotencyKey: outbox.business_idempotency_key,
        });
        providerMessageId = delivered.id;
      } else {
        const delivered = await sendSmsWithReceipt({
          businessKey: `notification-sms:${outbox.business_idempotency_key}`,
          to: destination.data.destination,
          body: `${destination.data.title}：${destination.data.body}`,
        });
        providerMessageId = delivered.providerMessageId;
      }
    } catch (caught) {
      failure =
        caught instanceof Error ? caught.message : "NOTIFICATION_FAILURE";
    }
    const { data: status, error } = await service.rpc(
      "finish_notification_outbox",
      {
        p_outbox_id: outbox.id,
        p_worker_id: workerId,
        p_succeeded: failure === null,
        p_provider_message_id: providerMessageId,
        p_failure_message: failure,
      },
    );
    outcomes.push({
      id: outbox.id,
      status: error ? "lease_finish_failed" : String(status),
    });
    if (error) degradedReason = "notification_outbox_finish_failed";
  }
  return { outcomes, degradedReason };
}

async function processJob(
  job: DurableJobLease,
  workerId: string,
): Promise<"already_finalized" | void> {
  if (job.job_type === "sla_escalation_record") {
    const { error } = await serviceSupabase().rpc("record_sla_escalation", {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_lease_generation: job.lease_generation,
    });
    if (error) throw new Error("SLA_ESCALATION_RECORD_FAILED");
    return;
  }
  if (job.job_type === "provider_event_process") {
    const eventId = z.uuid().parse(job.payload.providerEventId);
    const { error } = await serviceSupabase().rpc("process_provider_event", {
      p_provider_event_id: eventId,
      p_expected_environment: serverConfig().APP_ENV,
    });
    if (error) throw new Error("PROVIDER_EVENT_PROCESSING_FAILED");
    return;
  }
  if (job.job_type === "organization_invitation_sms") {
    await deliverOrganizationInvitation(
      z.uuid().parse(job.payload.invitationId),
      job.id,
    );
    return;
  }
  if (job.job_type === "completion_evaluate") {
    const config = serverConfig();
    if (
      config.EMERGENCY_DISABLE_ALL === "true" ||
      config.EMERGENCY_DISABLE_CERTIFICATES === "true"
    ) {
      throw new Error("EMERGENCY_CLOSED_CERTIFICATES");
    }
    await renderCompletionCertificate(z.uuid().parse(job.payload.enrollmentId));
    return;
  }
  if (job.job_type === "recorded_progress_recompute") {
    const enrollmentId = z.uuid().parse(job.payload.enrollmentId);
    const { data, error } = await serviceSupabase().rpc(
      "recompute_recorded_progress",
      { p_enrollment_id: enrollmentId },
    );
    const result = z
      .object({
        valid: z.boolean(),
        driftDetected: z.boolean(),
      })
      .safeParse(data);
    if (error || !result.success || !result.data.valid) {
      throw new Error("RECORDED_PROGRESS_RECOMPUTE_FAILED");
    }
    const { error: enqueueError } = await serviceSupabase().rpc(
      "enqueue_completion_evaluation",
      { p_enrollment_id: enrollmentId },
    );
    if (enqueueError) {
      throw new Error("RECORDED_COMPLETION_ENQUEUE_FAILED");
    }
    return;
  }
  if (job.job_type === "quarantine_scan") {
    await scanQuarantineUpload(z.uuid().parse(job.payload.uploadId));
    return;
  }
  if (job.job_type === "profile_media_purge") {
    await purgeProfileMedia(z.uuid().parse(job.payload.uploadId));
    return;
  }
  if (job.job_type === "live_attendance_settle") {
    const { error } = await serviceSupabase().rpc("settle_live_attendance", {
      p_live_session_id: z.uuid().parse(job.payload.liveSessionId),
    });
    if (error) throw new Error("LIVE_ATTENDANCE_SETTLEMENT_FAILED");
    return;
  }
  if (job.job_type === "identity_recovery_complete") {
    const recoveryCaseId = z.uuid().parse(job.payload.recoveryCaseId);
    const completion =
      await completeIdentityRecoveryWithReceipt(recoveryCaseId);
    const { error } = await serviceSupabase().rpc(
      "complete_identity_recovery_case",
      {
        p_recovery_case_id: recoveryCaseId,
        p_replacement_auth_user_id: completion.replacementAuthUserId,
        p_confirmation_hash: completion.confirmationHash,
      },
    );
    if (error) throw new Error("IDENTITY_RECOVERY_FINALIZE_FAILED");
    return;
  }
  if (job.job_type === "live_join_lease_expiry") {
    const leaseId = z.uuid().parse(job.payload.leaseId);
    const personId = z.uuid().parse(job.payload.personId);
    const liveSessionId = z.uuid().parse(job.payload.liveSessionId);
    const service = serviceSupabase();
    const { data, error } = await service.rpc("read_live_join_expiry_context", {
      p_lease_id: leaseId,
      p_person_id: personId,
      p_job_id: job.id,
      p_worker_id: workerId,
      p_lease_generation: job.lease_generation,
    });
    const expiryContext = z
      .object({
        leaseId: z.uuid(),
        liveSessionId: z.uuid(),
        meetingNumber: z.string().min(1),
        registrantId: z.string().nullable(),
        providerStatus: z.enum(["pending", "registered", "revoked", "failed"]),
        active: z.boolean(),
        credentialExpiresAt: z.iso.datetime({ offset: true }),
      })
      .safeParse(data);
    if (
      error ||
      !expiryContext.success ||
      expiryContext.data.leaseId !== leaseId ||
      expiryContext.data.liveSessionId !== liveSessionId
    ) {
      throw new Error("LIVE_JOIN_EXPIRY_CONTEXT_INVALID");
    }
    if (!expiryContext.data.active) return;

    let registrantRevoked = false;
    if (expiryContext.data.providerStatus === "registered") {
      if (!expiryContext.data.registrantId) {
        throw new Error("ZOOM_REGISTRANT_CONTEXT_MISSING");
      }
      await zoomMeetingAdapter().revokeRegistrant(
        expiryContext.data.meetingNumber,
        expiryContext.data.registrantId,
      );
      registrantRevoked = true;
    }
    const { data: expired, error: expiryError } = await service.rpc(
      "expire_live_join_credential",
      {
        p_lease_id: leaseId,
        p_job_id: job.id,
        p_worker_id: workerId,
        p_lease_generation: job.lease_generation,
        p_registrant_revoked: registrantRevoked,
        p_reason: "credential_expiry_worker",
        p_idempotency_key: job.id,
      },
    );
    const expiryResult = z
      .object({
        accepted: z.literal(true),
        attendanceActive: z.boolean(),
        providerStatus: z.enum(["pending", "registered", "revoked", "failed"]),
        credentialExpiredAt: z.iso.datetime({ offset: true }),
      })
      .safeParse(expired);
    if (expiryError || !expiryResult.success) {
      throw new Error("LIVE_JOIN_EXPIRY_FINALIZE_FAILED");
    }
    // Credential expiry cannot evict an already joined Zoom participant.
    // The RPC atomically completes this job and, when attendance is still
    // active, schedules a separate close at the session checkout boundary.
    return "already_finalized";
  }
  if (job.job_type === "zoom_orphan_cleanup") {
    const service = serviceSupabase();
    return executeZoomOrphanCleanup({
      jobId: job.id,
      workerId,
      leaseGeneration: job.lease_generation,
      readContext: async (lease) => {
        const { data, error } = await service.rpc(
          "read_zoom_orphan_cleanup_context",
          {
            p_job_id: lease.jobId,
            p_worker_id: lease.workerId,
            p_lease_generation: lease.leaseGeneration,
          },
        );
        const context = z
          .object({
            liveSessionId: z.uuid(),
            providerMeetingNumber: z.string().min(1).max(32),
            authoritativeReceiptReference: z.string().nullable(),
          })
          .safeParse(data);
        if (error || !context.success) {
          throw new Error("ZOOM_ORPHAN_CLEANUP_CONTEXT_INVALID");
        }
        return context.data;
      },
      deleteMeeting: (providerMeetingNumber) =>
        zoomMeetingAdapter().deleteMeeting(providerMeetingNumber),
      complete: async (completion) => {
        const { error } = await service.rpc("complete_zoom_orphan_cleanup", {
          p_job_id: completion.jobId,
          p_worker_id: completion.workerId,
          p_lease_generation: completion.leaseGeneration,
          p_provider_delete_confirmed: completion.providerDeleteConfirmed,
          p_preserved_authoritative: completion.preservedAuthoritative,
        });
        if (error) {
          throw new Error("ZOOM_ORPHAN_CLEANUP_COMPLETION_FAILED");
        }
      },
    });
  }
  if (job.job_type === "zoom_registrant_reconcile") {
    const service = serviceSupabase();
    return executeZoomRegistrantReconciliation({
      jobId: job.id,
      workerId,
      leaseGeneration: job.lease_generation,
      readContext: async (lease) => {
        const { data, error } = await service.rpc(
          "read_zoom_registrant_reconciliation_context",
          {
            p_job_id: lease.jobId,
            p_worker_id: lease.workerId,
            p_lease_generation: lease.leaseGeneration,
          },
        );
        const context = z
          .object({
            action: z.enum(["preserve", "revoke"]),
            meetingNumber: z.string().min(1).max(32),
            providerRegistrantId: z.string().min(1).max(500),
          })
          .safeParse(data);
        if (error || !context.success) {
          throw new Error("ZOOM_REGISTRANT_RECONCILIATION_CONTEXT_INVALID");
        }
        return context.data;
      },
      revokeRegistrant: (meetingNumber, providerRegistrantId) =>
        zoomMeetingAdapter().revokeRegistrant(
          meetingNumber,
          providerRegistrantId,
        ),
      complete: async (completion) => {
        const { error } = await service.rpc(
          "complete_zoom_registrant_reconciliation",
          {
            p_job_id: completion.jobId,
            p_worker_id: completion.workerId,
            p_lease_generation: completion.leaseGeneration,
            p_provider_revoked: completion.providerRevoked,
            p_preserved_authoritative: completion.preservedAuthoritative,
          },
        );
        if (error) {
          throw new Error("ZOOM_REGISTRANT_RECONCILIATION_COMPLETION_FAILED");
        }
      },
    });
  }
  if (job.job_type === "zoom_setup_reconcile") {
    const service = serviceSupabase();
    const { data, error } = await service.rpc(
      "read_zoom_setup_reconciliation_context",
      { p_job_id: job.id },
    );
    const context = z
      .object({
        reconciliationRequestId: z.uuid(),
        liveSessionId: z.uuid(),
        providerMeetingNumber: z.string().regex(/^[0-9]{9,12}$/),
        expectedProviderHostId: z.string().min(1),
        expectedTopic: z.string().min(1),
        expectedStartsAt: z.iso.datetime({ offset: true }),
        expectedDurationMinutes: z.number().int().positive(),
      })
      .safeParse(data);
    if (error || !context.success) {
      throw new Error("ZOOM_RECONCILIATION_CONTEXT_INVALID");
    }
    const businessKey = `zoom-meeting:${context.data.liveSessionId}`;
    const existingReceipt = await readProviderOperationReceipt({
      provider: "zoom",
      operation: "create_meeting",
      businessKey,
    });
    let meeting = existingReceipt
      ? zoomMeetingReceiptSchema.parse(existingReceipt.responsePayload)
      : null;
    if (
      meeting &&
      meeting.meetingNumber !== context.data.providerMeetingNumber
    ) {
      throw new Error("ZOOM_RECONCILIATION_RECEIPT_MISMATCH");
    }
    if (!meeting) {
      const recovered = await zoomMeetingAdapter().readMeetingForReconciliation(
        {
          meetingNumber: context.data.providerMeetingNumber,
          expectedHostId: context.data.expectedProviderHostId,
          expectedTopic: context.data.expectedTopic,
          expectedStartsAt: context.data.expectedStartsAt,
          expectedDurationMinutes: context.data.expectedDurationMinutes,
        },
      );
      meeting = zoomMeetingReceiptSchema.parse({
        meetingNumber: String(recovered.id),
        meetingUuid: recovered.uuid,
        meetingType: recovered.meetingType,
        topic: recovered.topic,
        startsAt: recovered.startsAt,
        durationMinutes: recovered.durationMinutes,
        encryptedPasscode: encryptZoomSecret(
          recovered.password,
          `zoom-meeting:${context.data.liveSessionId}`,
        ),
        providerHostId: recovered.host_id,
        safety: recovered.safety,
      });
      await recordProviderOperationReceipt({
        provider: "zoom",
        operation: "create_meeting",
        businessKey,
        providerReference: meeting.meetingNumber,
        responsePayload: meeting,
      });
    }
    const { error: finalizeError } = await service.rpc(
      "finalize_verified_live_session_setup",
      {
        p_live_session_id: context.data.liveSessionId,
        p_meeting_number: meeting.meetingNumber,
        p_meeting_uuid: meeting.meetingUuid,
        p_encrypted_passcode: meeting.encryptedPasscode,
        p_provider_host_id: meeting.providerHostId,
        p_accountless_join_enabled: meeting.safety.accountlessJoinEnabled,
        p_waiting_room: meeting.safety.waitingRoom,
        p_participant_rename_disabled: meeting.safety.participantRenameDisabled,
        p_participant_share_disabled: meeting.safety.participantShareDisabled,
        p_cloud_recording_disabled: meeting.safety.cloudRecordingDisabled,
        p_removed_participant_rejoin_disabled:
          meeting.safety.removedParticipantRejoinDisabled,
      },
    );
    if (finalizeError) {
      throw new Error("ZOOM_RECONCILIATION_FINALIZE_FAILED");
    }
    return;
  }
  if (job.job_type === "zoom_setup_finalize") {
    const liveSessionId = z.uuid().parse(job.payload.liveSessionId);
    const businessKey = `zoom-meeting:${liveSessionId}`;
    const receipt = await readProviderOperationReceipt({
      provider: "zoom",
      operation: "create_meeting",
      businessKey,
    });
    if (!receipt) throw new Error("ZOOM_SETUP_RECEIPT_MISSING");
    const meeting = zoomMeetingReceiptSchema.parse(receipt.responsePayload);
    const { error } = await serviceSupabase().rpc(
      "finalize_verified_live_session_setup",
      {
        p_live_session_id: liveSessionId,
        p_meeting_number: meeting.meetingNumber,
        p_meeting_uuid: meeting.meetingUuid,
        p_encrypted_passcode: meeting.encryptedPasscode,
        p_provider_host_id: meeting.providerHostId,
        p_accountless_join_enabled: meeting.safety.accountlessJoinEnabled,
        p_waiting_room: meeting.safety.waitingRoom,
        p_participant_rename_disabled: meeting.safety.participantRenameDisabled,
        p_participant_share_disabled: meeting.safety.participantShareDisabled,
        p_cloud_recording_disabled: meeting.safety.cloudRecordingDisabled,
        p_removed_participant_rejoin_disabled:
          meeting.safety.removedParticipantRejoinDisabled,
      },
    );
    if (error) throw new Error("ZOOM_SETUP_FINALIZE_FAILED");
    return;
  }
  if (job.job_type === "live_session_change") {
    const service = serviceSupabase();
    const { data, error } = await service.rpc(
      "read_live_session_change_context",
      { p_job_id: job.id },
    );
    const change = z
      .object({
        liveSessionId: z.uuid(),
        action: z.enum(["reschedule", "cancel"]),
        meetingNumber: z.string().min(1),
        topic: z.string().min(1),
        replacementStartsAt: z.iso.datetime({ offset: true }).nullable(),
        replacementEndsAt: z.iso.datetime({ offset: true }).nullable(),
      })
      .safeParse(data);
    if (error || !change.success) {
      throw new Error("LIVE_SESSION_CHANGE_CONTEXT_INVALID");
    }
    const zoom = zoomMeetingAdapter();
    if (change.data.action === "cancel") {
      await zoom.deleteMeeting(change.data.meetingNumber);
    } else {
      if (!change.data.replacementStartsAt || !change.data.replacementEndsAt) {
        throw new Error("LIVE_RESCHEDULE_WINDOW_MISSING");
      }
      await zoom.updateMeeting(change.data.meetingNumber, {
        topic: change.data.topic,
        startsAt: change.data.replacementStartsAt,
        durationMinutes: Math.ceil(
          (Date.parse(change.data.replacementEndsAt) -
            Date.parse(change.data.replacementStartsAt)) /
            60_000,
        ),
        timezone: "Asia/Taipei",
      });
    }
    const { error: finalizeError } = await service.rpc(
      "finalize_live_session_change",
      { p_job_id: job.id },
    );
    if (finalizeError) throw new Error("LIVE_SESSION_CHANGE_FINALIZE_FAILED");
    return;
  }
  throw new Error("UNKNOWN_JOB_TYPE");
}

async function scanQuarantineUpload(uploadId: string) {
  const service = serviceSupabase();
  const { data: upload, error } = await service
    .from("upload_quarantine")
    .select(
      "id,owner_person_id,purpose,object_path,declared_mime,byte_size,status",
    )
    .eq("id", uploadId)
    .maybeSingle();
  if (
    error ||
    !upload ||
    !["quarantined", "scanning"].includes(upload.status)
  ) {
    throw new Error("QUARANTINE_UPLOAD_NOT_SCANNABLE");
  }
  const { data: object, error: downloadError } = await service.storage
    .from("quarantine")
    .download(upload.object_path);
  if (downloadError) throw new Error("QUARANTINE_OBJECT_UNAVAILABLE");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== Number(upload.byte_size)) {
    throw new Error("QUARANTINE_SIZE_MISMATCH");
  }
  const result = await malwareScanner().scan({
    bytes,
    declaredMime: upload.declared_mime,
    purpose: upload.purpose,
    fileName: upload.id,
  });
  let promotedPath: string | null = null;
  if (result.safe && result.sanitizedBytes) {
    promotedPath = `${upload.purpose}/${upload.owner_person_id}/${upload.id}`;
    const { error: promoteError } = await service.storage
      .from("safe-uploads")
      .upload(promotedPath, result.sanitizedBytes, {
        contentType: result.detectedMime,
        cacheControl: "0",
        upsert: false,
      });
    if (promoteError) throw new Error("SAFE_UPLOAD_PROMOTION_FAILED");
  }
  const { error: finishError } = await service.rpc("finish_quarantine_scan", {
    p_upload_id: upload.id,
    p_safe: result.safe,
    p_detected_mime: result.detectedMime,
    p_archive_entry_count: result.archiveEntryCount,
    p_expanded_byte_size: result.expandedByteSize,
    p_metadata_stripped: result.metadataStripped,
    p_promoted_object_path: promotedPath,
    p_result: {
      safe: result.safe,
      reason: result.reason,
      sanitizedByteSize: result.sanitizedBytes?.byteLength ?? null,
      sanitizedSha256: result.sanitizedBytes
        ? createHash("sha256").update(result.sanitizedBytes).digest("hex")
        : null,
    },
  });
  if (finishError) {
    if (promotedPath) {
      await service.storage.from("safe-uploads").remove([promotedPath]);
    }
    throw new Error("QUARANTINE_SCAN_FINALIZE_FAILED");
  }
}

async function purgeProfileMedia(uploadId: string) {
  const service = serviceSupabase();
  const { data, error } = await service.rpc("claim_profile_media_purge", {
    p_upload_id: uploadId,
  });
  const context = z
    .discriminatedUnion("claimed", [
      z.object({ claimed: z.literal(false) }),
      z.object({
        claimed: z.literal(true),
        quarantineObjectPath: z.string().min(1),
        promotedObjectPath: z.string().min(1).nullable(),
      }),
    ])
    .safeParse(data);
  if (error || !context.success) {
    throw new Error("PROFILE_MEDIA_PURGE_CONTEXT_INVALID");
  }
  if (!context.data.claimed) return;

  const { error: quarantineError } = await service.storage
    .from("quarantine")
    .remove([context.data.quarantineObjectPath]);
  if (quarantineError) {
    throw new Error("PROFILE_MEDIA_QUARANTINE_PURGE_FAILED");
  }
  if (context.data.promotedObjectPath) {
    const { error: promotedError } = await service.storage
      .from("safe-uploads")
      .remove([context.data.promotedObjectPath]);
    if (promotedError) {
      throw new Error("PROFILE_MEDIA_SAFE_PURGE_FAILED");
    }
  }

  const { data: finalized, error: finalizeError } = await service.rpc(
    "finalize_profile_media_purge",
    { p_upload_id: uploadId },
  );
  if (finalizeError || finalized !== true) {
    throw new Error("PROFILE_MEDIA_PURGE_FINALIZE_FAILED");
  }
}

const invitationEnvelope = z.object({
  version: z.literal(1),
  encryptedPayload: z.object({
    keyVersion: z.string(),
    iv: z.string(),
    ciphertext: z.string(),
    tag: z.string(),
  }),
  wrappedDataKey: z.object({
    keyVersion: z.string(),
    iv: z.string(),
    ciphertext: z.string(),
    tag: z.string(),
  }),
});

async function deliverOrganizationInvitation(
  invitationId: string,
  deliveryAttemptId: string,
) {
  const service = serviceSupabase();
  const { data: invitation, error } = await service
    .from("organization_invitations")
    .select(
      "organization_id,phone_ciphertext,expires_at,accepted_at,revoked_at",
    )
    .eq("id", invitationId)
    .maybeSingle();
  if (
    error ||
    !invitation ||
    invitation.accepted_at ||
    invitation.revoked_at ||
    Date.parse(invitation.expires_at) <= Date.now()
  ) {
    throw new Error("INVITATION_NOT_DELIVERABLE");
  }
  const envelope = invitationEnvelope.parse(invitation.phone_ciphertext);
  const context = `organization-invitation:${invitation.organization_id}`;
  const dataKey = await kmsAdapter().unwrapDataKey(
    context,
    envelope.wrappedDataKey as Envelope,
  );
  const payload = z
    .object({
      phone: z.string().regex(/^\+8869\d{8}$/),
      token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    })
    .parse(
      JSON.parse(
        decryptWithDataKey(envelope.encryptedPayload, dataKey, context),
      ),
    );
  const { data: organization } = await service
    .from("organizations")
    .select("legal_name")
    .eq("id", invitation.organization_id)
    .single();
  const siteUrl = publicConfig().NEXT_PUBLIC_SITE_URL;
  await sendSmsWithReceipt({
    businessKey: `organization-invitation:${invitationId}:${deliveryAttemptId}`,
    to: payload.phone,
    body: `${organization?.legal_name ?? "機構"}邀請你加入歲悅學苑：${siteUrl}/organization/invite/${payload.token}（7 天內有效）`,
  });
}

async function renderCompletionCertificate(enrollmentId: string) {
  const service = serviceSupabase();
  const { data, error } = await service.rpc("read_completion_render_context", {
    p_enrollment_id: enrollmentId,
  });
  const renderContextBase = z.object({
    personId: z.uuid(),
    courseTitle: z.string().min(1),
    courseVersion: z.number().int().positive(),
    completedOn: z.iso.date(),
    requirements: z.object({
      requiredWatchSeconds: z.number().int().nonnegative(),
      livePresencePercent: z.number().nullable(),
      liveCameraPercent: z.number().nullable(),
      quizPassingScore: z.number(),
      surveyRequired: z.boolean(),
    }),
    liveSessions: z.array(
      z.object({
        sessionId: z.uuid(),
        title: z.string(),
        startsAt: z.iso.datetime({ offset: true }),
        denominatorSeconds: z.number().int().positive(),
        presenceThreshold: z.number(),
        cameraThreshold: z.number(),
        presencePercent: z.number(),
        cameraPercent: z.number(),
      }),
    ),
  });
  const renderContext = renderContextBase
    .and(
      z.discriminatedUnion("certificateKind", [
        z.object({
          certificateKind: z.literal("completion"),
          officialAccreditationCredited: z.literal(false),
          accreditationReference: z.null(),
          accreditationPoints: z.null(),
          accreditationAuthority: z.null(),
        }),
        z.object({
          certificateKind: z.literal("accreditation"),
          officialAccreditationCredited: z.literal(true),
          accreditationReference: z.string().min(1),
          accreditationPoints: z.number().positive(),
          accreditationAuthority: z.string().min(1),
        }),
      ]),
    )
    .safeParse(data);
  if (error || !renderContext.success) {
    throw new Error("COMPLETION_NOT_READY");
  }
  const learnerName = await readVerifiedIdentityName(
    renderContext.data.personId,
  );
  const verificationToken = randomBytes(32).toString("base64url");
  const config = serverConfig();
  const siteUrl = publicConfig().NEXT_PUBLIC_SITE_URL;
  const bytes = await certificateRenderer().render({
    enrollmentId,
    learnerName,
    ...renderContext.data,
    verificationUrl: `${siteUrl}/verify/${verificationToken}`,
  });
  const objectPath = `${renderContext.data.personId}/${enrollmentId}/${randomUUID()}.pdf`;
  const { error: uploadError } = await service.storage
    .from("certificates")
    .upload(objectPath, bytes, {
      contentType: "application/pdf",
      cacheControl: "0",
      upsert: false,
    });
  if (uploadError) throw new Error("CERTIFICATE_STORAGE_FAILED");
  const pdfHash = createHash("sha256").update(bytes).digest("hex");
  const verificationHash = createHash("sha256")
    .update(verificationToken)
    .digest("hex");
  const issuingActor = config.CERTIFICATE_ISSUING_PERSON_ID;
  if (!issuingActor) {
    await service.storage.from("certificates").remove([objectPath]);
    throw new Error("CERTIFICATE_ISSUING_ACTOR_MISSING");
  }
  const { error: finalizeError } = await service.rpc(
    "finalize_completion_and_certificate",
    {
      p_enrollment_id: enrollmentId,
      p_pdf_object_path: objectPath,
      p_pdf_sha256: pdfHash,
      p_verification_token_hash: verificationHash,
      p_issuing_actor_id: issuingActor,
    },
  );
  if (finalizeError) {
    await service.storage.from("certificates").remove([objectPath]);
    throw new Error("COMPLETION_NOT_READY");
  }
}
