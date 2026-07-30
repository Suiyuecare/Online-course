import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

export const organizationApplicationReviewSchema = z
  .object({
    organizationId: z.string().uuid(),
    legalName: z.string().min(1),
    taxIdMasked: z.string().min(1),
    contactName: z.string().min(1),
    contactEmailMasked: z.string().min(1),
    invoiceEmailMasked: z.string().min(1),
    status: z.enum(["submitted", "approved", "rejected", "suspended"]),
    submittedAt: z.string(),
    canReview: z.boolean(),
  })
  .strict();

export type OrganizationApplicationReview = z.infer<
  typeof organizationApplicationReviewSchema
>;

export const courseSubmissionReviewSchema = z
  .object({
    courseVersionId: z.string().uuid(),
    title: z.string().min(1),
    version: z.number().int().positive(),
    status: z.literal("in_review"),
    submittedBy: z.string().min(1),
    submittedAt: z.string(),
    submissionReason: z.string().nullable(),
    canDecide: z.boolean(),
  })
  .strict();

export type CourseSubmissionReview = z.infer<
  typeof courseSubmissionReviewSchema
>;

export async function readOrganizationApplicationReview(
  client: SupabaseClient,
  organizationId: string,
): Promise<OrganizationApplicationReview> {
  const target = z.string().uuid().parse(organizationId);
  const { data, error } = await client.rpc(
    "read_organization_application_review",
    { p_organization_id: target },
  );
  if (error) throw new Error("ORGANIZATION_APPLICATION_REVIEW_UNAVAILABLE");
  const parsed = organizationApplicationReviewSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("ORGANIZATION_APPLICATION_REVIEW_INVALID");
  }
  return parsed.data;
}

export async function readCourseSubmissionReview(
  client: SupabaseClient,
  courseVersionId: string,
): Promise<CourseSubmissionReview> {
  const target = z.string().uuid().parse(courseVersionId);
  const { data, error } = await client.rpc("read_course_submission_review", {
    p_course_version_id: target,
  });
  if (error) throw new Error("COURSE_SUBMISSION_REVIEW_UNAVAILABLE");
  const parsed = courseSubmissionReviewSchema.safeParse(data);
  if (!parsed.success) throw new Error("COURSE_SUBMISSION_REVIEW_INVALID");
  return parsed.data;
}
