import type { SupabaseClient } from "@supabase/supabase-js";

type RpcResult<T> = { data: T | null; error: { message: string } | null };

export type OrganizationBatchAssignmentResult = {
  requestedCount: number;
  succeededCount: number;
  failedCount: number;
  reservedPoints: number;
  courseVersionId: string;
  liveSessionId: string | null;
  completionDueAt: string | null;
  results: {
    memberPersonId: string;
    status: "assigned" | "failed";
    assignmentId: string | null;
    liveBookingId: string | null;
    reservedPoints: number;
    errorCode: string | null;
  }[];
};

async function rpc<T>(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = (await client.rpc(name, args)) as RpcResult<T>;
  if (error) throw new Error(`DATABASE_REJECTED:${error.message}`);
  if (data === null) throw new Error("DATABASE_EMPTY_RESULT");
  return data;
}

export class PlatformApplication {
  constructor(private readonly client: SupabaseClient) {}

  presentLegalContract(input: {
    courseVersionId: string;
    deviceHash: string;
    requestIp: string;
  }) {
    return rpc<{
      acceptanceId: string;
      firstPresentedAt: string;
      confirmAvailableAt: string;
      secondConfirmedAt: string | null;
      documentId: string;
      documentHash: string;
    }>(this.client, "present_legal_contract", {
      p_course_version_id: input.courseVersionId,
      p_device_hash: input.deviceHash,
      p_request_ip: input.requestIp,
    });
  }

  confirmLegalContract(input: {
    acceptanceId: string;
    deviceHash: string;
    requestIp: string;
  }) {
    return rpc<{ acceptanceId: string; secondConfirmedAt: string }>(
      this.client,
      "confirm_legal_contract",
      {
        p_acceptance_id: input.acceptanceId,
        p_device_hash: input.deviceHash,
        p_request_ip: input.requestIp,
      },
    );
  }

  orderDetails(orderId: string) {
    return rpc<{
      orderId: string;
      orderNumber: string;
      status: string;
      effectiveStatus: string;
      subtotalTwd: number;
      discountTwd: number;
      amountDueTwd: number;
      amountPaidTwd: number;
      transferDueAt: string;
      paidAt: string | null;
      accreditationDisclosure: string;
      courseTitle: string;
      bankName: string;
      bankCode: string;
      accountName: string;
      accountNumber: string;
      maskedAccount: string;
      coupon: {
        title: string;
        status: "reserved" | "redeemed" | "released";
        discountTwd: number;
      } | null;
      refundCases: {
        refundCaseId: string;
        status:
          | "submitted"
          | "reviewing"
          | "approved"
          | "rejected"
          | "disbursing"
          | "partially_disbursed"
          | "completed"
          | "failed";
        requestedAmountTwd: number;
        disbursedAmountTwd: number;
        submittedAt: string;
        decidedAt: string | null;
        completedAt: string | null;
      }[];
      refundableScopes?: {
        scopeType: "whole_order" | "recorded" | "live_component";
        scopeId: string | null;
        label: string;
        eligible: boolean;
        ineligibleReason: string | null;
      }[];
      liveBookingRepairs?: {
        bookingId: string;
        sessionId: string;
        title: string;
        status: string;
        startsAt: string;
        endsAt: string;
        changeLockedAt: string;
        canChange: boolean;
        replacementSessions: {
          id: string;
          title: string;
          startsAt: string;
          endsAt: string;
          bookingCloseAt: string;
        }[];
      }[];
    }>(this.client, "read_own_order", { p_order_id: orderId });
  }

  applyForOrganization(input: {
    legalName: string;
    taxIdBlindIndex: string;
    taxIdLastFour: string;
    invoiceEmail: string;
    idempotencyKey: string;
  }) {
    return rpc<{ organizationId: string; status: string }>(
      this.client,
      "apply_for_organization_v2",
      {
        p_legal_name: input.legalName,
        p_tax_id_blind_index: input.taxIdBlindIndex,
        p_tax_id_last_four: input.taxIdLastFour,
        p_invoice_email: input.invoiceEmail,
        p_idempotency_key: input.idempotencyKey,
      },
    );
  }

  createOrganizationInvitation(input: {
    organizationId: string;
    phoneCiphertext: Record<string, unknown>;
    phoneBlindIndex: string;
    tokenHash: string;
    role: "training_manager" | "finance" | "member";
    employeeName: string;
    employeeNumber: string;
    department: string;
    idempotencyKey: string;
  }) {
    return rpc<{ invitationId: string; expiresAt: string }>(
      this.client,
      "create_organization_invitation",
      {
        p_organization_id: input.organizationId,
        p_phone_ciphertext: input.phoneCiphertext,
        p_phone_blind_index: input.phoneBlindIndex,
        p_token_hash: input.tokenHash,
        p_role: input.role,
        p_employee_name: input.employeeName,
        p_employee_number: input.employeeNumber,
        p_department: input.department,
        p_idempotency_key: input.idempotencyKey,
      },
    );
  }

  assignOrganizationCourse(input: {
    organizationId: string;
    memberPersonId: string;
    courseVersionId: string;
    idempotencyKey: string;
  }) {
    return rpc<{ assignmentId: string; reservedPoints: number }>(
      this.client,
      "assign_organization_course",
      {
        p_organization_id: input.organizationId,
        p_member_person_id: input.memberPersonId,
        p_course_version_id: input.courseVersionId,
        p_idempotency_key: input.idempotencyKey,
      },
    );
  }

  batchAssignOrganizationCourse(input: {
    organizationId: string;
    memberPersonIds: string[];
    courseVersionId: string;
    liveSessionId: string | null;
    completionDueAt: string | null;
    idempotencyKey: string;
  }) {
    return rpc<OrganizationBatchAssignmentResult>(
      this.client,
      "batch_assign_organization_course",
      {
        p_organization_id: input.organizationId,
        p_member_person_ids: input.memberPersonIds,
        p_course_version_id: input.courseVersionId,
        p_live_session_id: input.liveSessionId,
        p_completion_due_at: input.completionDueAt,
        p_idempotency_key: input.idempotencyKey,
      },
    );
  }

  createPointTopup(input: {
    organizationId: string;
    points: number;
    legalAcceptanceId: string;
    idempotencyKey: string;
  }) {
    return rpc<{ topupId: string; status: string; expiresAt: string }>(
      this.client,
      "create_point_topup",
      {
        p_organization_id: input.organizationId,
        p_points: input.points,
        p_legal_acceptance_id: input.legalAcceptanceId,
        p_idempotency_key: input.idempotencyKey,
      },
    );
  }

  presentOrganizationContract(input: {
    organizationId: string;
    deviceHash: string;
    requestIp: string;
  }) {
    return rpc<{
      acceptanceId: string;
      firstPresentedAt: string;
      confirmAvailableAt: string;
      secondConfirmedAt: string | null;
      documentId: string;
      documentHash: string;
    }>(this.client, "present_organization_contract", {
      p_organization_id: input.organizationId,
      p_device_hash: input.deviceHash,
      p_request_ip: input.requestIp,
    });
  }

  pointTopupDetails(topupId: string) {
    return rpc<{
      topupId: string;
      status: string;
      points: number;
      amountDueTwd: number;
      transferDueAt: string;
      bankName: string;
      bankCode: string;
      accountName: string;
      accountNumber: string;
    }>(this.client, "read_own_point_topup", { p_topup_id: topupId });
  }

  submitPointTopupProof(input: {
    topupId: string;
    remitterName: string;
    bankName: string;
    accountLastFive: string;
    transferredAt: string;
    amountTwd: number;
    objectPath: string | null;
    contentHash: string | null;
    idempotencyKey: string;
  }) {
    return rpc<{
      status: string;
      proofId: string;
      attachmentStatus: "not_provided" | "safe";
      replayed: boolean;
    }>(this.client, "submit_point_topup_proof", {
      p_topup_id: input.topupId,
      p_remitter_name: input.remitterName,
      p_bank_name: input.bankName,
      p_account_last_five: input.accountLastFive,
      p_transferred_at: input.transferredAt,
      p_amount_twd: input.amountTwd,
      p_object_path: input.objectPath,
      p_content_hash: input.contentHash,
      p_idempotency_key: input.idempotencyKey,
    });
  }

  createOrder(input: {
    courseVersionId: string;
    legalAcceptanceId: string;
    liveSelections: Record<string, string>;
    couponClaimId: string | null;
    idempotencyKey: string;
  }) {
    return rpc<{
      orderId: string;
      orderNumber: string;
      expiresAt: string;
      subtotalTwd: number;
      discountTwd: number;
      amountDueTwd: number;
      couponReservationId?: string;
    }>(this.client, "create_b2c_order_with_coupon", {
      p_course_version_id: input.courseVersionId,
      p_legal_acceptance_id: input.legalAcceptanceId,
      p_live_selections: input.liveSelections,
      p_coupon_claim_id: input.couponClaimId,
      p_idempotency_key: input.idempotencyKey,
    });
  }

  claimCoupon(input: { code: string; idempotencyKey: string }) {
    return rpc<{
      claimId: string;
      status: "claimed";
      alreadyClaimed: boolean;
    }>(this.client, "claim_coupon_code", {
      p_code: input.code,
      p_idempotency_key: input.idempotencyKey,
    });
  }

  createCouponCampaign(input: {
    title: string;
    description: string;
    code: string;
    benefitKind: "percent_off" | "fixed_twd";
    percentOffBps: number | null;
    fixedDiscountTwd: number | null;
    maxDiscountTwd: number | null;
    minimumSubtotalTwd: number;
    validFrom: string;
    validUntil: string;
    totalClaimLimit: number;
    totalRedemptionLimit: number;
    courseVersionIds: string[];
    idempotencyKey: string;
  }) {
    return rpc<{
      campaignId: string;
      status: "draft";
      couponCode: string | null;
      replayed: boolean;
    }>(this.client, "create_coupon_campaign", {
      p_title: input.title,
      p_description: input.description,
      p_code: input.code,
      p_benefit_kind: input.benefitKind,
      p_percent_off_bps: input.percentOffBps,
      p_fixed_discount_twd: input.fixedDiscountTwd,
      p_max_discount_twd: input.maxDiscountTwd,
      p_minimum_subtotal_twd: input.minimumSubtotalTwd,
      p_valid_from: input.validFrom,
      p_valid_until: input.validUntil,
      p_total_claim_limit: input.totalClaimLimit,
      p_total_redemption_limit: input.totalRedemptionLimit,
      p_course_version_ids: input.courseVersionIds,
      p_idempotency_key: input.idempotencyKey,
    });
  }

  approveCouponCampaign(input: {
    campaignId: string;
    reason: string;
    idempotencyKey: string;
  }) {
    return rpc<{ campaignId: string; status: string }>(
      this.client,
      "approve_coupon_campaign",
      {
        p_campaign_id: input.campaignId,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      },
    );
  }

  changeCouponCampaignStatus(input: {
    campaignId: string;
    action: "pause" | "resume" | "end";
    reason: string;
    idempotencyKey: string;
  }) {
    return rpc<{ campaignId: string; status: string }>(
      this.client,
      "change_coupon_campaign_status",
      {
        p_campaign_id: input.campaignId,
        p_action: input.action,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      },
    );
  }

  submitPaymentProof(input: {
    orderId: string;
    remitterName: string;
    bankName: string;
    accountLastFive: string;
    transferredAt: string;
    amountTwd: number;
    objectPath: string | null;
    contentHash: string | null;
    idempotencyKey: string;
  }) {
    return rpc<{ status: string }>(this.client, "submit_payment_proof", {
      p_order_id: input.orderId,
      p_remitter_name: input.remitterName,
      p_bank_name: input.bankName,
      p_account_last_five: input.accountLastFive,
      p_transferred_at: input.transferredAt,
      p_amount_twd: input.amountTwd,
      p_object_path: input.objectPath,
      p_content_hash: input.contentHash,
      p_idempotency_key: input.idempotencyKey,
    });
  }

  cancelPendingTransferOrder(input: {
    orderId: string;
    idempotencyKey: string;
  }) {
    return rpc<{
      orderId: string;
      status: "cancelled";
      replayed: boolean;
      releasedLiveBookingCount?: number;
      couponReleased?: boolean;
      cartRestored?: boolean;
    }>(this.client, "cancel_own_pending_transfer_order", {
      p_order_id: input.orderId,
      p_idempotency_key: input.idempotencyKey,
    });
  }

  heartbeat(input: {
    enrollmentId: string;
    playbackSessionId: string;
    leaseEpoch: number;
    sequence: number;
    mediaPositionSeconds: number;
    playing: boolean;
    visible: boolean;
    online: boolean;
    challengeToken: string | null;
  }) {
    return rpc<{
      candidateSeconds: number;
      confirmedSeconds: number;
      challengeRequired: boolean;
      challengeToken: string | null;
      challengeTimedOut: boolean;
      challengeExpiresAt: string | null;
      originLessonId: string | null;
      originVideoVersionId: string | null;
      originPositionSeconds: number | null;
      rewindToSeconds?: number;
    }>(this.client, "record_playback_heartbeat", {
      p_enrollment_id: input.enrollmentId,
      p_playback_session_id: input.playbackSessionId,
      p_lease_epoch: input.leaseEpoch,
      p_sequence: input.sequence,
      p_media_position_seconds: input.mediaPositionSeconds,
      p_playing: input.playing,
      p_visible: input.visible,
      p_online: input.online,
      p_challenge_token: input.challengeToken,
    });
  }

  confirmPresence(input: {
    enrollmentId: string;
    challengeToken: string;
    idempotencyKey: string;
  }) {
    return rpc<{ confirmedSeconds: number }>(
      this.client,
      "confirm_presence_challenge",
      {
        p_enrollment_id: input.enrollmentId,
        p_challenge_token: input.challengeToken,
        p_idempotency_key: input.idempotencyKey,
      },
    );
  }

  startQuiz(input: { enrollmentId: string; idempotencyKey: string }) {
    return rpc<{
      attemptId: string;
      expiresAt: string;
      questions: unknown[];
    }>(this.client, "start_quiz_attempt", {
      p_enrollment_id: input.enrollmentId,
      p_idempotency_key: input.idempotencyKey,
    });
  }

  submitQuiz(input: {
    attemptId: string;
    responses: Record<string, string>;
    idempotencyKey: string;
  }) {
    return rpc<{ score: number; passed: boolean; topics: string[] }>(
      this.client,
      "submit_quiz_attempt",
      {
        p_attempt_id: input.attemptId,
        p_responses: input.responses,
        p_idempotency_key: input.idempotencyKey,
      },
    );
  }

  submitSurvey(input: {
    enrollmentId: string;
    ratings: [number, number, number, number, number];
    comment: string | null;
    idempotencyKey: string;
  }) {
    return rpc<{ responseId: string; editableUntil: string }>(
      this.client,
      "submit_survey",
      {
        p_enrollment_id: input.enrollmentId,
        p_ratings: input.ratings,
        p_comment: input.comment,
        p_idempotency_key: input.idempotencyKey,
      },
    );
  }

  issueLiveJoinLease(input: {
    liveSessionId: string;
    deviceHash: string;
    idempotencyKey: string;
  }) {
    return rpc<{
      leaseId: string;
      meetingNumber: string;
      encryptedPasscode: {
        version: 1;
        iv: string;
        ciphertext: string;
        tag: string;
      };
      syntheticEmail: string;
      displayName: string;
      customerKey: string;
      expiresAt: string;
      lastHeartbeatSequence: number;
      providerStatus: "pending" | "registered" | "revoked" | "failed";
      replayed: boolean;
    }>(this.client, "issue_live_join_lease", {
      p_live_session_id: input.liveSessionId,
      p_device_hash: input.deviceHash,
      p_idempotency_key: input.idempotencyKey,
    });
  }

  recordLiveHeartbeat(input: {
    joinLeaseId: string;
    sequence: number;
    cameraOn: boolean;
    checkedDevice: boolean;
  }) {
    return rpc<{ accepted: boolean }>(this.client, "record_live_heartbeat", {
      p_join_lease_id: input.joinLeaseId,
      p_sequence: input.sequence,
      p_camera_on: input.cameraOn,
      p_checked_device: input.checkedDevice,
    });
  }
}
