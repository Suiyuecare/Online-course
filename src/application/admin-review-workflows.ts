import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { googleFormUrlSchema } from "@/domain/education-quality";

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

const courseSubmissionReviewBaseSchema = z.strictObject({
  courseVersionId: z.string().uuid(),
  slug: z.string().trim().min(1).max(200),
  title: z.string().min(1),
  summary: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1).max(10_000),
  learningObjectives: z.array(z.string().trim().min(1).max(300)),
  deliveryType: z.enum(["recorded", "live", "hybrid"]),
  hasCover: z.boolean(),
  instructors: z.array(
    z.strictObject({
      name: z.string().trim().min(1).max(200),
      biography: z.string().trim().min(1).max(5_000),
      credentials: z.string().trim().min(1).max(1_000),
    }),
  ),
  version: z.number().int().positive(),
  status: z.literal("in_review"),
  submittedBy: z.string().min(1),
  submittedAt: z.string(),
  submissionReason: z.string().nullable(),
  registrationCtaLabel: z.string().trim().min(2).max(20),
  canDecide: z.boolean(),
  canPublish: z.boolean(),
});

export const courseSubmissionReviewSchema = z.discriminatedUnion(
  "registrationMode",
  [
    courseSubmissionReviewBaseSchema.extend({
      registrationMode: z.literal("internal"),
      externalRegistrationUrl: z.null(),
    }),
    courseSubmissionReviewBaseSchema.extend({
      registrationMode: z.literal("google_form"),
      externalRegistrationUrl: googleFormUrlSchema,
    }),
  ],
);

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
