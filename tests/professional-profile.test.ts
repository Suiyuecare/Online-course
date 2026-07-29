import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildOwnProfessionalProfilePageData,
  emptyProfessionalProfile,
} from "@/application/professional-profile";
import type { LearnerCenterRow } from "@/application/learner-center";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const migration = source(
  "supabase/migrations/20260728133925_professional_learner_profiles.sql",
);

describe("professional learner profile", () => {
  it("keeps public-safe profile data separate from authoritative identity", () => {
    expect(migration).toContain("create table public.professional_profiles");
    expect(migration).toContain(
      "person_id uuid primary key\n    references public.people(id)",
    );
    expect(migration).toContain("professional_profiles_owner_read");
    expect(migration).toContain(
      "alter table public.professional_profiles force row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.professional_profiles",
    );
    expect(migration).not.toMatch(
      /professional_profiles[\s\S]{0,700}(?:phone|national_id|care_worker_id|employee_number|quiz_score|confirmed_valid_seconds)/i,
    );
  });

  it("exposes only owner-scoped invoker wrappers", () => {
    expect(migration).toContain("internal.current_person_id()");
    expect(migration).not.toContain("target_person");
    expect(migration).toContain(
      "create or replace function public.upsert_own_professional_profile",
    );
    expect(migration).toContain(
      "create or replace function public.bind_own_professional_profile_media",
    );
    expect(migration).toContain("expected_version is null");
    expect(migration).toContain("submitted_kind is null");
    expect(migration).toContain(
      "'member-' || replace(gen_random_uuid()::text, '-', '')",
    );
    expect(migration).not.toContain(
      "'member-' || replace(actor::text, '-', '')",
    );
    const publicFunctions =
      migration.match(/create or replace function public\.[\s\S]*?\n\$\$;/g) ??
      [];
    expect(publicFunctions.length).toBe(2);
    for (const block of publicFunctions) {
      expect(block).toContain("security invoker");
      expect(block).not.toContain("security definer");
    }
  });

  it("binds only scanned private media and verifies the sanitized hash", () => {
    for (const invariant of [
      "'profile_avatar', 'profile_cover'",
      "upload.owner_person_id = actor",
      "upload.status = 'promoted'",
      "upload.metadata_stripped",
      "upload.promoted_sha256",
      "promoted_upload_requires_hash",
      "and promoted_sha256 is not null",
      "or sanitized_sha256 is null",
    ]) {
      expect(migration).toContain(invariant);
    }
    const worker = source("src/app/api/workers/wake/route.ts");
    const media = source("src/app/api/profile/media/[kind]/route.ts");
    expect(worker).toContain("sanitizedSha256");
    expect(media).toContain("promoted_sha256");
    expect(media).toContain(
      'content-security-policy": "default-src \'none\'; sandbox"',
    );
    expect(media).toContain('"cache-control": "no-store"');
    expect(media).not.toContain("stale-while-revalidate");
    expect(media).not.toContain("content_sha256");
  });

  it("purges replaced profile media and preserves off-sale learner access", () => {
    const worker = source("src/app/api/workers/wake/route.ts");
    for (const invariant of [
      "learner_owned_courses_read",
      "schedule_profile_media_purge",
      "claim_profile_media_purge",
      "finalize_profile_media_purge",
      "detach_anonymized_professional_profile",
      "'profile_media_purge'",
    ]) {
      expect(migration + worker).toContain(invariant);
    }
    expect(worker).toContain('if (job.job_type === "profile_media_purge")');
    expect(worker).toContain('.from("safe-uploads")');
    expect(worker).toContain('.from("quarantine")');
  });

  it("shows only completed learner courses in the own profile projection", () => {
    const base = {
      course_title: "課程",
      delivery_type: "recorded" as const,
      confirmed_valid_seconds: 0,
      required_seconds: 60,
      next_live_starts_at: null,
      certificate_status: null,
      course_slug: "course",
      completed_at: "2026-07-28T00:00:00.000Z",
      has_cover: false,
      completion_due_at: null,
    };
    const rows: LearnerCenterRow[] = [
      {
        ...base,
        enrollment_id: "11111111-1111-4111-8111-111111111111",
        course_version_id: "21111111-1111-4111-8111-111111111111",
        enrollment_status: "active",
        certificate_id: null,
      },
      {
        ...base,
        enrollment_id: "31111111-1111-4111-8111-111111111111",
        course_version_id: "41111111-1111-4111-8111-111111111111",
        enrollment_status: "completed",
        certificate_id: "51111111-1111-4111-8111-111111111111",
      },
    ];
    const data = buildOwnProfessionalProfilePageData({
      profile: emptyProfessionalProfile("照護夥伴"),
      learnerRows: rows,
      instructorDashboard: null,
    });
    expect(data.completedCourses).toHaveLength(1);
    expect(data.certificateCount).toBe(1);
    expect(data.teachingCourses).toEqual([]);
  });

  it("ships edit, preview, visibility and instructor-specific experiences", () => {
    const editor = source("src/components/professional-profile-editor.tsx");
    const view = source("src/components/professional-profile-view.tsx");
    const publicPage = source("src/app/profiles/[slug]/page.tsx");
    const previewPage = source("src/app/learner/account/preview/page.tsx");
    for (const label of [
      "公開顯示名稱",
      "專業短標",
      "個人網站",
      "關於我",
      "自己的專長",
      "感興趣的主題",
      "公開個人頁",
      "公開已完成課程",
      "預覽公開頁",
      "上傳頭像",
      "上傳封面",
    ]) {
      expect(editor).toContain(label);
    }
    expect(view).toContain("我修畢的課");
    expect(view).toContain("data.isInstructor");
    expect(view).toContain("我開的課");
    expect(publicPage).toContain("robots: { index: false, follow: false }");
    expect(previewPage).toContain('mode="preview"');
  });

  it("never presents sensitive learning or legal identity on the public view", () => {
    const view = source("src/components/professional-profile-view.tsx");
    const publicReader = source("src/application/professional-profile.ts");
    expect(view).toContain("正式身分資料不會公開");
    for (const privateField of [
      "maskedPhone",
      "nationalId",
      "careWorkerId",
      "confirmedValidSeconds",
      "quizScore",
      "orderNumber",
      "organizationId",
      "employeeNumber",
    ]) {
      expect(publicReader).not.toContain(privateField);
    }
  });
});
