import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { staffRoleCandidateSchema } from "@/application/staff-role-directory";
import { videoMasterBackupItemSchema } from "@/application/video-backup-workspace";

const root = process.cwd();
const migration = readFileSync(
  join(
    root,
    "supabase/migrations/20260730033000_staff_directory_video_backup_workspace.sql",
  ),
  "utf8",
);
const rolePanel = readFileSync(
  join(root, "src/components/staff-role-candidate-panel.tsx"),
  "utf8",
);
const backupPanel = readFileSync(
  join(root, "src/components/video-master-backup-panel.tsx"),
  "utf8",
);

describe("staff role onboarding directory", () => {
  it("accepts only the masked candidate projection", () => {
    expect(
      staffRoleCandidateSchema.safeParse({
        personId: "99300000-0000-4000-8000-000000000001",
        displayName: "王小美",
        maskedPhone: "+88•••••001",
        maskedEmail: "w•••@example.test",
        currentRoles: [],
        pendingRoles: ["support"],
        registeredAt: "2026-07-30T03:30:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      staffRoleCandidateSchema.safeParse({
        personId: "99300000-0000-4000-8000-000000000001",
        displayName: "王小美",
        maskedPhone: "+886912990001",
        maskedEmail: "wang@example.test",
        currentRoles: [],
        pendingRoles: [],
        registeredAt: "2026-07-30T03:30:00.000Z",
        rawAuthUser: {},
      }).success,
    ).toBe(false);
  });

  it("keeps grant initiation separate from another administrator's decision", () => {
    expect(rolePanel).toContain("/api/staff/roles/requests");
    expect(rolePanel).toContain('"role_change"');
    expect(rolePanel).toContain(":grant");
    expect(rolePanel).toContain("另一位平台管理員");
    expect(rolePanel).not.toContain("/decision");
  });

  it("never returns a raw phone or raw email field", () => {
    expect(migration).toContain("'maskedPhone'");
    expect(migration).toContain("'maskedEmail'");
    expect(migration).not.toMatch(/'phone'\s*,\s*candidate\.phone/);
    expect(migration).not.toMatch(
      /'verifiedEmail'\s*,\s*candidate\.verified_email/,
    );
  });
});

describe("video master backup workspace", () => {
  it("accepts the bounded draft asset projection", () => {
    expect(
      videoMasterBackupItemSchema.safeParse({
        videoAssetId: "99400000-0000-4000-8000-000000000001",
        courseVersionId: "99400000-0000-4000-8000-000000000002",
        courseTitle: "失智照護",
        lessonTitle: "理解失智者的需求",
        status: "processing",
        providerReady: true,
        masterBackupVerified: false,
        backupVerifiedAt: null,
        createdAt: "2026-07-30T03:30:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("submits only the selected asset's immutable reference and SHA-256", () => {
    expect(backupPanel).toContain(
      "/api/staff/stream/assets/${videoAssetId}/backup",
    );
    expect(backupPanel).toContain('pattern="[A-Fa-f0-9]{64}"');
    expect(backupPanel).toContain("備份服務");
    expect(backupPanel).not.toContain("provider_uid");
  });

  it("limits the worklist to active draft-course video assets", () => {
    expect(migration).toContain("version.status = 'draft'");
    expect(migration).toContain("video.active");
    expect(migration).toContain(
      "asset.status in ('uploading', 'processing', 'ready', 'failed')",
    );
    expect(migration).toContain("internal.has_staff_role('course_admin')");
  });
});
