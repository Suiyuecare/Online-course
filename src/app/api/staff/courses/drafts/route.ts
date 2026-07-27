import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const lesson = z.object({
  title: z.string().trim().min(2).max(200),
  contentType: z.enum(["video", "material", "quiz", "survey"]),
  preview: z.boolean().default(false),
  sortOrder: z.number().int().min(0),
});
const component = z.object({
  componentType: z.enum(["recorded", "live"]),
  title: z.string().trim().min(2).max(200),
  required: z.boolean().default(true),
  sortOrder: z.number().int().min(0),
  refundAllocationTwd: z.number().int().min(0),
  dependsOnSortOrders: z.array(z.number().int().min(0)).default([]),
});
const schema = z
  .object({
    courseId: z.uuid().optional(),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    internalTitle: z.string().trim().min(2).max(200),
    title: z.string().trim().min(2).max(200),
    summary: z.string().trim().min(10).max(500),
    description: z.string().trim().min(20).max(10_000),
    learningObjectives: z.array(z.string().trim().min(2).max(300)).min(1),
    deliveryType: z.enum(["recorded", "live", "hybrid"]),
    priceTwd: z.number().int().min(0),
    organizationPointPrice: z.number().int().positive(),
    recordedRefundAllocationTwd: z.number().int().min(0),
    liveRefundAllocationTwd: z.number().int().min(0),
    equipmentRequirements: z.string().max(2000),
    legalDocumentId: z.uuid(),
    retentionPolicyRevisionId: z.uuid(),
    accreditationRevisionId: z.uuid().nullable().optional(),
    accreditationDisclosure: z.string().trim().max(2000).default(""),
    minimumCompletionDays: z.number().int().positive().max(3650),
    commerceCloseAt: z.iso.datetime({ offset: true }),
    contentAvailableAt: z.iso.datetime({ offset: true }),
    requiredWatchSeconds: z.number().int().min(0),
    livePresencePercent: z.number().min(80).max(100).nullable(),
    liveCameraPercent: z.number().min(80).max(100).nullable(),
    modules: z
      .array(
        z.object({
          title: z.string().trim().min(2).max(200),
          sortOrder: z.number().int().min(0),
          lessons: z.array(lesson).min(1),
        }),
      )
      .min(1),
    hybridComponents: z.array(component).default([]),
  })
  .superRefine((input, context) => {
    if (!input.courseId && !input.slug) {
      context.addIssue({
        code: "custom",
        path: ["slug"],
        message: "slug is required for a new course",
      });
    }
    if (
      ["recorded", "hybrid"].includes(input.deliveryType) &&
      input.requiredWatchSeconds <= 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["requiredWatchSeconds"],
        message: "recorded delivery requires watch seconds",
      });
    }
    if (
      ["live", "hybrid"].includes(input.deliveryType) &&
      (!input.livePresencePercent || !input.liveCameraPercent)
    ) {
      context.addIssue({
        code: "custom",
        path: ["livePresencePercent"],
        message: "live delivery requires attendance thresholds",
      });
    }
    if (
      (input.accreditationRevisionId &&
        input.accreditationDisclosure.length < 10) ||
      (!input.accreditationRevisionId &&
        input.accreditationDisclosure.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["accreditationDisclosure"],
        message:
          "accreditation disclosure is required only when a revision is linked",
      });
    }
    if (input.deliveryType === "hybrid" && input.hybridComponents.length < 2) {
      context.addIssue({
        code: "custom",
        path: ["hybridComponents"],
        message: "hybrid delivery requires components",
      });
    }
    const hybridAllocation = input.hybridComponents.reduce(
      (total, item) => total + item.refundAllocationTwd,
      0,
    );
    const allocationValid =
      (input.deliveryType === "recorded" &&
        input.recordedRefundAllocationTwd === input.priceTwd &&
        input.liveRefundAllocationTwd === 0) ||
      (input.deliveryType === "live" &&
        input.recordedRefundAllocationTwd === 0 &&
        input.liveRefundAllocationTwd === input.priceTwd) ||
      (input.deliveryType === "hybrid" &&
        input.liveRefundAllocationTwd === 0 &&
        hybridAllocation === input.priceTwd);
    if (!allocationValid) {
      context.addIssue({
        code: "custom",
        path: ["liveRefundAllocationTwd"],
        message: "refund allocations must exactly equal the course price",
      });
    }
  });

export async function POST(request: Request) {
  return mutation(request, async () => {
    const spec = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("create_course_draft", {
      p_spec: spec,
      p_idempotency_key: requireIdempotencyKey(request),
    });
    if (error || !data) throw new Error("COURSE_DRAFT_REJECTED");
    return data;
  });
}
