import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudflareStreamAdapter,
  previewTokenTtlSeconds,
} from "@/infrastructure/adapters/stream";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const migration = source(
  "supabase/migrations/20260724235000_quality_revocation_preview.sql",
);
const hardeningMigration = source(
  "supabase/migrations/20260724237000_quality_concurrency_hardening.sql",
);

afterEach(() => vi.unstubAllEnvs());

function functionBlock(name: string) {
  const start = migration.indexOf(`function internal.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf("$$;", start);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end + 3);
}

describe("public course outline and signed preview", () => {
  it("issues short-lived preview credentials only through the service route", () => {
    expect(previewTokenTtlSeconds(60)).toBe(120);
    expect(previewTokenTtlSeconds(10_000)).toBe(300);
    expect(() => previewTokenTtlSeconds(0)).toThrow("STREAM_DURATION_REQUIRED");

    const route = source(
      "src/app/api/catalog/courses/[courseVersionId]/preview/[lessonId]/route.ts",
    );
    expect(route).toContain("enforceAnonymousPreviewRateLimit");
    expect(route).toContain("p_limit: 6");
    expect(route).toContain("new CloudflareStreamAdapter()");
    expect(route).toContain("productionReadiness()");
    expect(route).not.toContain("requireUser");
    expect(route).not.toContain("streamAdapter()");
  });

  it("signs unique Cloudflare JWTs that expire within five minutes", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", "preview-key");
    vi.stubEnv(
      "CLOUDFLARE_STREAM_SIGNING_PRIVATE_KEY",
      privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    );
    const adapter = new CloudflareStreamAdapter();
    const first = adapter.createPreviewToken("preview-video", 3_600);
    const second = adapter.createPreviewToken("preview-video", 3_600);
    expect(first).not.toBe(second);
    const [header, payload, signature] = first.split(".");
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { sub: string; jti: string; exp: number };
    expect(claims.sub).toBe("preview-video");
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(claims.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(0);
    expect(claims.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(300);
    expect(
      createVerify("RSA-SHA256")
        .update(`${header}.${payload}`)
        .verify(
          publicKey.export({ format: "pem", type: "spki" }),
          signature,
          "base64url",
        ),
    ).toBe(true);
  });

  it("makes draft, suspended, archived, and non-preview lessons ineligible", () => {
    const authorization = functionBlock("authorize_public_course_preview");
    expect(authorization).toContain("public.published_course_catalog");
    expect(authorization).toContain("lesson.preview");
    expect(authorization).toContain("lesson.archived_at is null");
    expect(authorization).toContain("asset.status = 'ready'");
    expect(authorization).toContain("asset.archived_at is null");
    expect(authorization).toContain("asset.require_signed_urls");
    expect(authorization).toContain("health.status = 'healthy'");
    expect(authorization).toContain(
      "health.production_validated_at is not null",
    );
    expect(authorization).toContain("auth.role() <> 'service_role'");
    expect(migration).toContain(
      "public.authorize_public_course_preview(uuid, uuid)\n+  to service_role".replace(
        "+",
        "",
      ),
    );
    expect(migration).not.toMatch(
      /grant execute on function\s+public\.authorize_public_course_preview\([\s\S]{0,80}\)\s+to anon/i,
    );
  });

  it("keeps provider identifiers out of the anonymous outline", () => {
    const outline = functionBlock("read_public_course_outline");
    expect(outline).toContain("'preview'");
    expect(outline).toContain("'durationSeconds'");
    expect(outline).toContain("'id', case");
    expect(outline).toContain("else null");
    expect(outline).not.toContain("provider_uid");

    const page = source("src/app/courses/[slug]/page.tsx");
    expect(page).toContain("lesson.preview && lesson.id &&");
    expect(page).toContain("免費試看");
    expect(page).toContain("付費單元");
    expect(source("src/infrastructure/supabase/catalog.ts")).toContain(
      "id: z.uuid().nullable()",
    );
  });

  it("requires current 90-day provider evidence before minting a preview", () => {
    expect(hardeningMigration).toContain(
      "internal.provider_production_validation_is_current(",
    );
    expect(hardeningMigration).toContain(
      "'cloudflare_stream', statement_timestamp()",
    );
    expect(hardeningMigration).toContain(
      "public.authorize_public_course_preview(uuid, uuid)",
    );
    expect(hardeningMigration).toContain("to service_role");
  });
});

describe("quiz invalidation and quality review controls", () => {
  it("uses immutable requests and decisions without changing raw answers", () => {
    expect(migration).toContain(
      "quiz_attempt_invalidation_requests_append_only",
    );
    expect(migration).toContain(
      "quiz_attempt_invalidation_decisions_append_only",
    );
    const decision = functionBlock("decide_quiz_attempt_invalidation");
    expect(decision).toContain("request_row.requested_by = actor");
    expect(decision).toContain("set status = 'voided'");
    expect(decision).toContain(
      "completion_eligible_before and not completion_eligible_after",
    );
    expect(decision).toContain("'suiyue:quiz-invalidation-enrollment:'");
    expect(decision).toContain("for update");
    expect(decision).toContain("revoke_certificate_for_quiz_invalidation");
    expect(decision).not.toMatch(
      /update\s+public\.(?:quiz_responses|quiz_attempt_items)/i,
    );
    expect(decision).not.toMatch(
      /delete\s+from\s+public\.(?:quiz_responses|quiz_attempt_items)/i,
    );
    const organizationOutcome = functionBlock(
      "organization_assignment_current_outcome",
    );
    expect(organizationOutcome).toContain("attempt.status <> 'voided'");
  });

  it("overlays append-only funded-organization quality corrections", () => {
    expect(migration).toContain("organization_assignment_outcome_corrections");
    expect(migration).toContain("organization_outcome_corrections_append_only");
    expect(migration).toContain(
      "membership_lifecycle_revision integer not null",
    );
    expect(migration).toContain(
      "entitlement.source_type = 'organization_assignment'",
    );
    expect(migration).toContain("coalesce(correction.correction, '{}'::jsonb)");
    const appendCorrection = functionBlock(
      "append_organization_quality_correction",
    );
    const visibleOutcome = functionBlock(
      "organization_assignment_visible_outcome",
    );
    expect(appendCorrection).toContain("for update of membership");
    expect(appendCorrection).toContain("membership.lifecycle_revision");
    expect(visibleOutcome).toContain("stored.membership_lifecycle_revision =");
    expect(visibleOutcome).toContain(
      "stored.created_at >= snapshot.visibility_cutoff_at",
    );
    expect(functionBlock("decide_quiz_attempt_invalidation")).toContain(
      "internal.append_organization_quality_correction(",
    );
    expect(functionBlock("decide_certificate_revocation")).toContain(
      "internal.append_organization_quality_correction(",
    );
  });

  it("binds certificate and quiz decisions to exact idempotent payloads", () => {
    const certificateRequest = functionBlock("request_certificate_revocation");
    const certificateDecision = functionBlock("decide_certificate_revocation");
    const quizDecision = functionBlock("decide_quiz_attempt_invalidation");
    expect(certificateRequest).toContain("'certificate_revocation_request_v2'");
    expect(certificateRequest).toContain("'certificateId', target_certificate");
    expect(certificateDecision).toContain(
      "'certificate_revocation_decision_v2'",
    );
    expect(quizDecision).toContain("idempotency_key = idempotency");
    expect(quizDecision).toContain(
      "QUIZ_INVALIDATION_IDEMPOTENCY_REPLAY_MISMATCH",
    );

    for (const route of [
      "src/app/api/staff/certificates/revocations/[requestId]/decision/route.ts",
      "src/app/api/staff/accreditation/quiz-attempt-invalidations/[requestId]/decision/route.ts",
    ]) {
      expect(source(route)).toContain(
        "p_idempotency_key: requireIdempotencyKey(request)",
      );
    }
  });

  it("removes implicit PUBLIC execute from legacy revocation wrappers", () => {
    expect(migration).toContain(
      "revoke all on function public.request_certificate_revocation(",
    );
    expect(migration).toContain(
      "revoke all on function public.decide_certificate_revocation(",
    );
    expect(migration).toContain(
      ") from public, anon, authenticated, service_role;",
    );
  });

  it("binds both invalidation actions to fresh step-up grants", () => {
    expect(functionBlock("request_quiz_attempt_invalidation")).toContain(
      "'accreditation_result', target_attempt::text, submitted_nonce_hash",
    );
    expect(functionBlock("decide_quiz_attempt_invalidation")).toContain(
      "'accreditation_result', target_request::text, submitted_nonce_hash",
    );
  });

  it("does not expose raw survey comments in a worklist", () => {
    const workspace = functionBlock("read_survey_investigation_workspace");
    expect(workspace).toContain("'hasComment'");
    expect(workspace).not.toContain("'comment'");
    expect(workspace).not.toContain("'enrollmentId'");

    const investigation = functionBlock("read_survey_investigation");
    expect(investigation).toContain(
      "'pii_decrypt', target_response::text, submitted_nonce_hash",
    );
    expect(migration).toContain(
      "revoke all on function public.read_survey_investigation(uuid, text)",
    );
  });

  it("keeps learner and staff invalidation projections free of answers", () => {
    const staff = functionBlock("read_quiz_attempt_invalidation_workspace");
    const learner = functionBlock("read_my_quiz_attempt_invalidation_statuses");
    for (const projection of [staff, learner]) {
      expect(projection).not.toContain("quiz_responses");
      expect(projection).not.toContain("question_snapshot");
      expect(projection).not.toContain("selected_option_id");
    }
    expect(learner).toContain("enrollment.person_id = actor");
    expect(learner).toContain("'reason'");
  });
});
