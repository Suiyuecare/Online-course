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
        "https://docs.google.com/forms/d/e/1FAIpQLSc_safe123/viewform?usp=sf_link",
      ),
    ).toBe(
      "https://docs.google.com/forms/d/e/1FAIpQLSc_safe123/viewform?usp=sf_link",
    );

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

    for (const field of [
      "registration_mode",
      "external_registration_url",
      "registration_cta_label",
    ]) {
      expect(catalog).toContain(field);
    }
    expect(detail).toContain("safeGoogleFormUrl");
    expect(detail).toContain('registrationUrl ? "活動報名"');
    expect(card).toContain("purchaseReady && !registrationUrl");
  });

  it("keeps final publication visible only to the executive approver", () => {
    const queue = source("src/app/staff/[queue]/page.tsx");
    expect(queue).toContain('p_required_role: "platform_admin"');
    expect(queue).toContain(
      'action.key !== "course_publish" || isExecutiveApprover === true',
    );
  });
});
