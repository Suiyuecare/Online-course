import { z } from "zod";

export const qualityStaffReasonSchema = z.string().trim().min(10).max(1000);

export const staffStepUpNonceSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const certificateRevocationRequestInputSchema = z.object({
  certificateId: z.uuid(),
  reason: qualityStaffReasonSchema,
  stepUpNonce: staffStepUpNonceSchema,
});

export const certificateRevocationDecisionInputSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: qualityStaffReasonSchema,
  stepUpNonce: staffStepUpNonceSchema,
});

const certificateStatusSchema = z.enum([
  "active",
  "submitted",
  "credited",
  "needs_correction",
  "rejected",
]);

export const certificateRevocationWorkspaceSchema = z.strictObject({
  certificateOptions: z.array(
    z.strictObject({
      certificateId: z.uuid(),
      learnerLabel: z.string().min(1).max(200),
      courseTitle: z.string().min(1).max(300),
      certificateKind: z.enum(["completion", "accreditation"]),
      currentStatus: certificateStatusSchema,
      issuedAt: z.iso.datetime({ offset: true }),
    }),
  ),
  pendingRequests: z.array(
    z.strictObject({
      requestId: z.uuid(),
      certificateId: z.uuid(),
      learnerLabel: z.string().min(1).max(200),
      courseTitle: z.string().min(1).max(300),
      certificateKind: z.enum(["completion", "accreditation"]),
      currentStatus: certificateStatusSchema,
      requestedByLabel: z.string().min(1).max(200),
      reason: z.string().min(10).max(1000),
      createdAt: z.iso.datetime({ offset: true }),
      canDecide: z.boolean(),
    }),
  ),
});

export type CertificateRevocationWorkspace = z.infer<
  typeof certificateRevocationWorkspaceSchema
>;

export const surveyInvestigationInputSchema = z.object({
  reason: qualityStaffReasonSchema,
  stepUpNonce: staffStepUpNonceSchema,
});

export const surveyInvestigationWorkspaceSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      surveyResponseId: z.uuid(),
      courseTitle: z.string().min(1).max(300),
      revision: z.number().int().min(1).max(2),
      averageRating: z.number().min(1).max(5),
      hasComment: z.boolean(),
      submittedAt: z.iso.datetime({ offset: true }),
    }),
  ),
  nextCursor: z.string().nullable(),
});

export type SurveyInvestigationWorkspace = z.infer<
  typeof surveyInvestigationWorkspaceSchema
>;

// Raw investigation is deliberately limited to the selected response. Keep
// parsing non-strict so any future server-only context is stripped at the API.
export const surveyInvestigationResultSchema = z.object({
  surveyResponseId: z.uuid(),
  revision: z.number().int().min(1).max(2),
  ratings: z.array(z.number().int().min(1).max(5)).length(5),
  comment: z.string().max(2000).nullable(),
  submittedAt: z.iso.datetime({ offset: true }),
});

export type SurveyInvestigationResult = z.infer<
  typeof surveyInvestigationResultSchema
>;

export const qualityWorkspaceQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  cursor: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
