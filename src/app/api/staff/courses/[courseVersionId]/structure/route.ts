import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("instructor"),
    personId: z.uuid().nullable(),
    displayName: z.string().trim().min(2).max(100),
    biography: z.string().trim().min(10).max(3000),
    credentials: z.string().trim().min(5).max(1000),
  }),
  z.object({
    operation: z.literal("lesson"),
    moduleId: z.uuid().nullable(),
    moduleTitle: z.string().trim().max(200).nullable(),
    lessonTitle: z.string().trim().min(2).max(200),
    contentType: z.enum(["video", "material", "quiz", "survey"]),
    preview: z.boolean(),
  }),
  z.object({
    operation: z.literal("material"),
    uploadId: z.uuid(),
    lessonId: z.uuid().nullable(),
    title: z.string().trim().min(2).max(200),
  }),
  z.object({
    operation: z.literal("cover"),
    uploadId: z.uuid(),
  }),
  z.object({
    operation: z.literal("course_update"),
    title: z.string().trim().min(2).max(200),
    summary: z.string().trim().min(10).max(500),
    description: z.string().trim().min(20).max(10_000),
    learningObjectives: z.array(z.string().trim().min(2).max(300)).min(1),
    priceTwd: z.number().int().nonnegative(),
    organizationPointPrice: z.number().int().positive(),
    recordedRefundAllocationTwd: z.number().int().nonnegative(),
    equipmentRequirements: z.string().max(2000),
    legalDocumentId: z.uuid(),
    retentionPolicyRevisionId: z.uuid(),
    accreditationRevisionId: z.uuid(),
    accreditationDisclosure: z.string().trim().min(10).max(2000),
    minimumCompletionDays: z.number().int().positive().max(3650),
    commerceCloseAt: z.iso.datetime({ offset: true }),
    contentAvailableAt: z.iso.datetime({ offset: true }),
    requiredWatchSeconds: z.number().int().nonnegative(),
    livePresencePercent: z.number().min(80).max(100).nullable(),
    liveCameraPercent: z.number().min(80).max(100).nullable(),
    hybridComponents: z.array(
      z.object({
        componentId: z.uuid(),
        title: z.string().trim().min(2).max(200),
        required: z.boolean(),
        sortOrder: z.number().int().nonnegative(),
        refundAllocationTwd: z.number().int().nonnegative(),
        dependsOnComponentIds: z.array(z.uuid()),
      }),
    ),
  }),
  z.object({
    operation: z.literal("hybrid_configuration"),
    componentRequirements: z
      .array(
        z.object({
          componentId: z.uuid(),
          requiredWatchSeconds: z.number().int().nonnegative(),
        }),
      )
      .min(1),
    lessonMappings: z
      .array(
        z.object({
          lessonId: z.uuid(),
          componentId: z.uuid(),
        }),
      )
      .min(1),
  }),
  z.object({
    operation: z.literal("module_update"),
    moduleId: z.uuid(),
    title: z.string().trim().min(2).max(200),
  }),
  z.object({
    operation: z.literal("module_delete"),
    moduleId: z.uuid(),
  }),
  z.object({
    operation: z.literal("module_reorder"),
    orderedIds: z.array(z.uuid()).min(1).max(500),
  }),
  z.object({
    operation: z.literal("lesson_update"),
    lessonId: z.uuid(),
    title: z.string().trim().min(2).max(200),
    contentType: z.enum(["video", "material", "quiz", "survey"]),
    preview: z.boolean(),
  }),
  z.object({
    operation: z.literal("lesson_delete"),
    lessonId: z.uuid(),
  }),
  z.object({
    operation: z.literal("lesson_reorder"),
    moduleId: z.uuid(),
    orderedIds: z.array(z.uuid()).min(1).max(500),
  }),
  z.object({
    operation: z.literal("instructor_update"),
    instructorId: z.uuid(),
    displayName: z.string().trim().min(2).max(100),
    biography: z.string().trim().min(10).max(3000),
    credentials: z.string().trim().min(5).max(1000),
  }),
  z.object({
    operation: z.literal("instructor_delete"),
    instructorId: z.uuid(),
  }),
  z.object({
    operation: z.literal("instructor_reorder"),
    orderedIds: z.array(z.uuid()).min(1).max(100),
  }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ courseVersionId: string }> },
) {
  return mutation(request, async () => {
    const { courseVersionId } = await context.params;
    z.uuid().parse(courseVersionId);
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const idempotencyKey = requireIdempotencyKey(request);
    if (input.operation === "hybrid_configuration") {
      const { data, error } = await supabase.rpc(
        "configure_hybrid_learning_graph",
        {
          p_course_version_id: courseVersionId,
          p_component_requirements: input.componentRequirements,
          p_lesson_mappings: input.lessonMappings,
          p_idempotency_key: idempotencyKey,
        },
      );
      if (error || !data) {
        throw new Error("HYBRID_CONFIGURATION_REJECTED");
      }
      return data;
    }
    const { operation, ...spec } = input;
    const { data, error } = await supabase.rpc("author_course_structure", {
      p_course_version_id: courseVersionId,
      p_operation: operation,
      p_spec: spec,
      p_idempotency_key: idempotencyKey,
    });
    if (error || !data) throw new Error("COURSE_STRUCTURE_AUTHORING_REJECTED");
    return data;
  });
}
