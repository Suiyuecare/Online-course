import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const baseReason = z.string().trim().min(10).max(1000);
const schema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("operating_setting"),
      settingKey: z.enum([
        "commerce_b2c",
        "commerce_b2b",
        "recorded_learning",
        "live_learning",
        "hybrid_learning",
        "certificate_issuance",
        "accreditation_exports",
      ]),
      enabled: z.boolean(),
      effectiveAt: z.iso.datetime(),
      reason: baseReason,
    }),
    z.object({
      kind: z.literal("organizing_body"),
      legalName: z.string().trim().min(2).max(200),
      qualificationReference: z.string().trim().min(2).max(200),
      qualificationValidFrom: z.iso.date(),
      qualificationValidUntil: z.iso.date().nullable(),
      contactName: z.string().trim().min(2).max(100),
      contactEmail: z.email(),
      reason: baseReason,
    }),
    z.object({
      kind: z.literal("accreditation_authority"),
      name: z.string().trim().min(2).max(200),
      submissionMethod: z.string().trim().min(2).max(500),
      contactName: z.string().trim().min(2).max(100),
      contactEmail: z.email(),
      reason: baseReason,
    }),
    z.object({
      kind: z.literal("accreditation_revision"),
      courseId: z.uuid(),
      organizingBodyId: z.uuid(),
      authorityId: z.uuid(),
      applicationReference: z.string().trim().min(1).max(200),
      sourceDocumentPath: z.string().trim().min(1).max(500),
      sourceDocumentSha256: z.string().regex(/^[a-f0-9]{64}$/),
      validFrom: z.iso.datetime(),
      validUntil: z.iso.datetime(),
      reason: baseReason,
    }),
    z.object({
      kind: z.literal("retention_policy_revision"),
      policyName: z.string().trim().min(2).max(200),
      purpose: z.string().trim().min(10).max(1000),
      legalBasis: z.string().trim().min(5).max(1000),
      retentionDays: z.number().int().min(1).max(36500),
      effectiveAt: z.iso.datetime(),
      reason: baseReason,
    }),
    z.object({
      kind: z.literal("legal_document_revision"),
      documentKind: z.enum([
        "b2c_terms",
        "b2b_terms",
        "privacy",
        "accreditation_disclosure",
      ]),
      title: z.string().trim().min(2).max(200),
      content: z.string().trim().min(100).max(100_000),
      effectiveAt: z.iso.datetime(),
      reason: baseReason,
    }),
    z.object({
      kind: z.literal("zoom_host_resource"),
      hostUserReference: z.string().trim().min(2).max(200),
      backupHostReference: z.string().trim().max(200).nullable(),
      verifiedTotalCapacity: z.number().int().min(1).max(200),
      concurrencySlot: z.number().int().min(1).max(20),
      licenseVerifiedAt: z.iso.datetime(),
      reason: baseReason,
    }),
  ])
  .superRefine((input, context) => {
    if (
      input.kind === "accreditation_revision" &&
      Date.parse(input.validUntil) <= Date.parse(input.validFrom)
    ) {
      context.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "validUntil must be later than validFrom",
      });
    }
  });

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { kind, reason, ...spec } = input;
    const { data, error } = await supabase.rpc("manage_platform_prerequisite", {
      p_kind: kind,
      p_operation: "create_draft",
      p_spec: spec,
      p_reason: reason,
      p_idempotency_key: requireIdempotencyKey(request),
    });
    if (error) throw new Error(`DATABASE_REJECTED:${error.message}`);
    return data;
  });
}
