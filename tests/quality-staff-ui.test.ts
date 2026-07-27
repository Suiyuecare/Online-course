import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  certificateRevocationWorkspaceSchema,
  surveyInvestigationResultSchema,
  surveyInvestigationWorkspaceSchema,
} from "@/domain/quality-staff";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("quality and accreditation staff UI", () => {
  it("requires a selectable certificate projection and server-derived dual control", () => {
    const component = source("src/components/certificate-revocation-panel.tsx");
    const page = source("src/app/staff/quality/page.tsx");
    const unsafeIdInput =
      /<input\b[^>]*\bname="(?:certificateId|requestId|surveyResponseId|enrollmentId)"/;

    expect(component).not.toMatch(unsafeIdInput);
    expect(component).toContain('<select name="certificateId"');
    expect(component).toContain("request.canDecide");
    expect(component).toContain(
      'obtainStepUp("certificate_revoke", certificateId)',
    );
    expect(component).toContain(
      'obtainStepUp("certificate_revoke", request.requestId)',
    );
    expect(page).toContain("readCertificateRevocationWorkspace");
    expect(page).toContain("readSurveyInvestigationWorkspace");
  });

  it("fails closed if a survey list projection contains a raw comment", () => {
    const parsed = surveyInvestigationWorkspaceSchema.safeParse({
      items: [
        {
          surveyResponseId: "00000000-0000-4000-8000-000000000001",
          courseTitle: "失智照護",
          revision: 1,
          averageRating: 4.2,
          hasComment: true,
          submittedAt: "2026-07-24T01:02:03+00:00",
          comment: "不應出現在清單",
        },
      ],
      nextCursor: null,
    });

    expect(parsed.success).toBe(false);
  });

  it("strips the enrollment identifier from separately authorized raw results", () => {
    const parsed = surveyInvestigationResultSchema.parse({
      surveyResponseId: "00000000-0000-4000-8000-000000000001",
      enrollmentId: "00000000-0000-4000-8000-000000000002",
      revision: 1,
      ratings: [5, 4, 5, 4, 5],
      comment: "課程很實用",
      submittedAt: "2026-07-24T01:02:03+00:00",
    });

    expect(parsed).not.toHaveProperty("enrollmentId");
    expect(parsed.comment).toBe("課程很實用");
  });

  it("requires reason plus fresh step-up for a raw survey investigation", () => {
    const component = source("src/components/survey-investigation-panel.tsx");
    const route = source(
      "src/app/api/staff/surveys/[surveyResponseId]/investigate/route.ts",
    );

    expect(component).toContain(
      'obtainStepUp("pii_decrypt", item.surveyResponseId)',
    );
    expect(component).toContain("{ reason, stepUpNonce }");
    expect(route).toContain("surveyInvestigationInputSchema");
    expect(route).toContain("p_nonce_hash");
    expect(route).toContain("surveyInvestigationResultSchema");
  });

  it("accepts only a masked certificate revocation workspace", () => {
    const parsed = certificateRevocationWorkspaceSchema.safeParse({
      certificateOptions: [
        {
          certificateId: "00000000-0000-4000-8000-000000000001",
          learnerLabel: "王○明",
          courseTitle: "失智照護",
          certificateKind: "accreditation",
          currentStatus: "credited",
          issuedAt: "2026-07-24T01:02:03+00:00",
        },
      ],
      pendingRequests: [],
    });

    expect(parsed.success).toBe(true);
  });
});
