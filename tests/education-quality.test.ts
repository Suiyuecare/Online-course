import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  educationQualityRegistrationInputSchema,
  educationQualityWorkspaceSchema,
  safeGoogleFormUrl,
} from "@/domain/education-quality";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("education-quality course registration", () => {
  it("accepts only exact official Google Forms HTTPS targets", () => {
    expect(safeGoogleFormUrl("https://forms.gle/Abc_123-XyZ")).toBe(
      "https://forms.gle/Abc_123-XyZ",
    );
    expect(
      safeGoogleFormUrl(
        "https://docs.google.com/forms/d/e/1FAIpQLSc_safe123/viewform?usp=sf_link&entry.123=%E7%8E%8B#prefill",
      ),
    ).toBe("https://docs.google.com/forms/d/e/1FAIpQLSc_safe123/viewform");

    for (const value of [
      "http://forms.gle/Abc_123",
      "https://forms.gle.example.com/Abc_123",
      "https://member@forms.gle/Abc_123",
      "https://forms.gle:444/Abc_123",
      "https://forms.gle/Abc_123/extra",
      "https://docs.google.com/forms/d/Abc_123/edit",
    ]) {
      expect(safeGoogleFormUrl(value)).toBeNull();
    }
  });

  it("keeps external registration and CTA fields strict", () => {
    expect(
      educationQualityRegistrationInputSchema.safeParse({
        registrationMode: "google_form",
        externalRegistrationUrl: "https://forms.gle/Abc_123",
        registrationCtaLabel: "立即報名",
      }).success,
    ).toBe(true);
    expect(
      educationQualityRegistrationInputSchema.safeParse({
        registrationMode: "internal",
        externalRegistrationUrl: "https://forms.gle/Abc_123",
        registrationCtaLabel: "立即報名",
      }).success,
    ).toBe(false);
    expect(
      educationQualityRegistrationInputSchema.safeParse({
        registrationMode: "google_form",
        externalRegistrationUrl: "https://example.com/form",
        registrationCtaLabel: "立即報名",
      }).success,
    ).toBe(false);
  });

  it("rejects a workspace row whose mode and target do not agree", () => {
    const course = {
      courseVersionId: "10000000-0000-4000-8000-000000000001",
      slug: "care-course",
      version: 1,
      title: "照顧服務員核心課程",
      summary: "完整課程摘要",
      deliveryType: "recorded",
      status: "draft",
      registrationCtaLabel: "報名活動",
      hasCover: true,
      canEdit: true,
      canSubmit: true,
      submittedAt: null,
      publishedAt: null,
      updatedAt: "2026-08-21T08:00:00+08:00",
    };
    expect(
      educationQualityWorkspaceSchema.safeParse({
        courses: [
          {
            ...course,
            registrationMode: "internal",
            externalRegistrationUrl: null,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      educationQualityWorkspaceSchema.safeParse({
        courses: [
          {
            ...course,
            registrationMode: "google_form",
            externalRegistrationUrl: null,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("publishes the approved CTA without mixing it with the cart flow", () => {
    const catalog = source("src/infrastructure/supabase/catalog.ts");
    const detail = source("src/app/courses/[slug]/page.tsx");
    const card = source("src/components/course-card.tsx");
    const contract = source("src/app/courses/[slug]/contract/page.tsx");
    const orderRoute = source("src/app/api/orders/route.ts");

    for (const field of [
      "registration_mode",
      "external_registration_url",
      "registration_cta_label",
    ]) {
      expect(catalog).toContain(field);
    }
    expect(detail).toContain("safeGoogleFormUrl");
    expect(detail).toContain(
      'usesExternalRegistration ? "活動報名" : "報名前先知道"',
    );
    expect(detail).toContain("系統不會改用站內購買");
    expect(card).toContain('course.registration_mode === "internal"');
    expect(card).toContain("外部報名");
    expect(card).toContain("由主辦單位通知");
    expect(card).toContain("報名連結暫時無法使用");
    expect(contract).toContain('course.registration_mode === "google_form"');
    expect(contract).toContain("redirect(`/courses/");
    expect(orderRoute).toContain('select("registration_mode")');
    expect(orderRoute).toContain("EXTERNAL_REGISTRATION_REQUIRED");
  });

  it("blocks review while registration edits are not saved", () => {
    const workspace = source("src/components/education-quality-workspace.tsx");
    expect(workspace).toContain("registrationDirty");
    expect(workspace).toContain("disabled={busy || registrationDirty}");
    expect(workspace).toContain("請先按「儲存報名設定」");
    expect(workspace).toContain('window.addEventListener("beforeunload"');
  });

  it("keeps final publication visible only to the executive approver", () => {
    const queue = source("src/app/staff/[queue]/page.tsx");
    const reviewPanel = source(
      "src/components/course-submission-review-panel.tsx",
    );
    const publishRoute = source(
      "src/app/api/staff/courses/[courseVersionId]/publish/route.ts",
    );
    expect(queue).toContain('p_required_role: "platform_admin"');
    expect(queue).toContain("isExecutiveApprover === true &&");
    expect(queue).toContain("courseSubmissionReview.canPublish");
    expect(queue).toContain('action.key !== "course_publish"');
    expect(reviewPanel).toContain(
      'obtainStepUp("course_publish", review.courseVersionId)',
    );
    expect(reviewPanel).toContain("核准並上架 Google 表單報名頁");
    expect(publishRoute).toContain('supabase.rpc("authorize_exact_staff_role"');
    expect(publishRoute).toContain('p_required_role: "platform_admin"');
    expect(publishRoute).toContain("EXECUTIVE_APPROVAL_REQUIRED");
  });
});
