import { describe, expect, it } from "vitest";
import {
  learnerWorkspaceSchema,
  organizationWorkspaceDetailsSchema,
  staffQueueResultSchema,
} from "@/application/workspace";
import {
  breaksFitTeachingWindow,
  liveBreakIntervalsSchema,
  totalBreakSeconds,
} from "@/domain/live-breaks";
import { presentErrorCode, presentStatus } from "@/domain/presentation";
import { stepUpActionForStaffAction } from "@/domain/staff-actions";

describe("Chinese status presentation", () => {
  it("does not describe a paid-but-unfulfilled order as available", () => {
    const result = presentStatus("order", "paid_unfulfilled");
    expect(result.label).toContain("開通處理中");
    expect(result.description).toContain("尚未");
    expect(result.nextAction).toContain("請勿重複付款");
  });

  it("distinguishes platform completion from authority crediting", () => {
    expect(presentStatus("enrollment", "completed").label).toBe("已完課");
    expect(presentStatus("enrollment", "credited").label).toBe("積分已登錄");
    expect(presentStatus("certificate", "active").description).toContain(
      "不代表積分已登錄",
    );
  });

  it("uses a fail-closed constant message for unknown statuses", () => {
    expect(presentStatus("order", "provider_added_a_new_status")).toEqual(
      presentStatus("order", null),
    );
  });

  it("turns engineering error codes into actionable Chinese", () => {
    expect(presentErrorCode("RATE_LIMITED", "fallback")).toContain("稍候");
    expect(presentErrorCode("OTP_VERIFICATION_REJECTED", "fallback")).toContain(
      "驗證碼",
    );
    expect(presentErrorCode("EXPORT_CAPABILITY_INVALID", "fallback")).toContain(
      "一次性",
    );
    expect(
      presentErrorCode("PREREQUISITE_DECISION_REJECTED", "fallback"),
    ).toContain("建立者不能");
    expect(presentErrorCode("UNKNOWN", "fallback")).toBe("fallback");
  });

  it("rejects a learner projection that omits server-derived lock state", () => {
    const incomplete = {
      courseTitle: "測試課程",
      deliveryType: "recorded",
      enrollmentStatus: "active",
      accreditationStatus: null,
      identity: null,
      modules: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          title: "第一章",
          lessons: [
            {
              id: "00000000-0000-4000-8000-000000000002",
              title: "第一課",
              type: "video",
              videoVersionId: null,
              completed: false,
              resumeSeconds: 0,
            },
          ],
        },
      ],
      components: [],
      liveBookings: [],
      completion: {},
      certificate: null,
    };
    expect(learnerWorkspaceSchema.safeParse(incomplete).success).toBe(false);
  });

  it("accepts only whitelisted staff context actions", () => {
    const result = staffQueueResultSchema.safeParse({
      items: [
        {
          itemId: "opaque",
          kind: "finance",
          title: "待核對匯款",
          referenceLabel: "訂單 SUI-001",
          status: "payment_review",
          statusLabel: "財務核對中",
          summary: "銀行交易與訂單金額相符",
          updatedAt: "2026-07-24T00:00:00.000Z",
          context: [],
          actions: [
            {
              key: "run_arbitrary_endpoint",
              label: "危險操作",
              targetId: "00000000-0000-4000-8000-000000000001",
              payload: {},
            },
          ],
        },
      ],
      nextCursor: null,
      availableStatuses: [],
    });
    expect(result.success).toBe(false);
  });

  it("maps each sensitive staff action to the exact server step-up action", () => {
    expect(stepUpActionForStaffAction("identity_decide")).toBe("pii_decrypt");
    expect(stepUpActionForStaffAction("attendance_decide")).toBe(
      "attendance_override",
    );
    expect(stepUpActionForStaffAction("refund_decide")).toBe("refund_decision");
    expect(stepUpActionForStaffAction("export_generate_download")).toBe(
      "accreditation_export",
    );
    expect(stepUpActionForStaffAction("prerequisite_decide")).toBe(
      "platform_prerequisite_review",
    );
    expect(stepUpActionForStaffAction("bank_reconcile")).toBe(
      "bank_reconciliation",
    );
    expect(stepUpActionForStaffAction("invoice_result")).toBe(
      "invoice_decision",
    );
    expect(stepUpActionForStaffAction("refund_disburse")).toBe(
      "refund_disbursement",
    );
    expect(stepUpActionForStaffAction("role_change_decide")).toBe(
      "role_change",
    );
  });

  it("requires organization actions to carry safe labels and server capabilities", () => {
    const result = organizationWorkspaceDetailsSchema.safeParse({
      members: [],
      invitations: [],
      topups: [],
      assignments: [
        {
          assignmentId: "00000000-0000-4000-8000-000000000001",
          memberLabel: "王○明",
          courseTitle: "失智照護",
          courseVersionId: "00000000-0000-4000-8000-000000000002",
          liveComponentId: null,
          status: "reserved",
          points: 100,
          eligibleLiveSessions: [],
        },
      ],
      liveBookings: [],
      invoices: [],
      outcomes: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects overlapping live breaks and computes explicit break time", () => {
    const breaks = [
      {
        startsAt: "2026-08-01T02:30:00.000Z",
        endsAt: "2026-08-01T02:45:00.000Z",
      },
      {
        startsAt: "2026-08-01T02:40:00.000Z",
        endsAt: "2026-08-01T02:50:00.000Z",
      },
    ];
    expect(liveBreakIntervalsSchema.safeParse(breaks).success).toBe(false);
    expect(totalBreakSeconds([breaks[0]!])).toBe(900);
  });

  it("requires every live break to stay inside the teaching window", () => {
    expect(
      breaksFitTeachingWindow({
        startsAt: "2026-08-01T02:00:00.000Z",
        endsAt: "2026-08-01T04:00:00.000Z",
        breakIntervals: [
          {
            startsAt: "2026-08-01T01:55:00.000Z",
            endsAt: "2026-08-01T02:05:00.000Z",
          },
        ],
      }),
    ).toBe(false);
  });
});
