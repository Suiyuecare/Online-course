import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const nullableString = z.string().nullable();

export const learnerWorkspaceSchema = z.object({
  courseTitle: z.string(),
  deliveryType: z.enum(["recorded", "live", "hybrid"]),
  enrollmentStatus: z.string(),
  accreditationStatus: z.string().nullable(),
  identity: z
    .object({
      status: z.string(),
      maskedName: nullableString,
      maskedNationalId: nullableString,
      maskedCareWorkerId: nullableString,
      reconfirmedAt: nullableString,
    })
    .nullable(),
  modules: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      lessons: z.array(
        z.object({
          id: z.string().uuid(),
          title: z.string(),
          type: z.enum(["video", "material", "quiz", "survey"]),
          videoVersionId: z.string().uuid().nullable(),
          componentId: z.string().uuid().nullable().default(null),
          completed: z.boolean(),
          resumeSeconds: z.number().int().nonnegative(),
          locked: z.boolean(),
          lockReason: nullableString,
        }),
      ),
    }),
  ),
  materials: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      lessonId: z.string().uuid().nullable(),
    }),
  ),
  components: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      type: z.enum(["recorded", "live"]),
      required: z.boolean(),
      completed: z.boolean(),
      confirmedSeconds: z.number().int().nonnegative().default(0),
      requiredSeconds: z.number().int().nonnegative().default(0),
      prerequisitesComplete: z.boolean().default(true),
      prerequisiteIds: z.array(z.string().uuid()),
    }),
  ),
  liveBookings: z.array(
    z.object({
      bookingId: z.string().uuid(),
      sessionId: z.string().uuid(),
      title: z.string(),
      status: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
      changeLockedAt: z.string(),
      canChange: z.boolean(),
      canJoin: z.boolean(),
      replacementSessions: z
        .array(
          z.object({
            id: z.string().uuid(),
            title: z.string(),
            startsAt: z.string(),
            endsAt: z.string(),
            bookingCloseAt: z.string(),
          }),
        )
        .default([]),
    }),
  ),
  completion: z.record(z.string(), z.unknown()),
  certificate: z
    .object({
      id: z.string().uuid(),
      kind: z.enum(["completion", "accreditation"]),
      status: z.string(),
    })
    .nullable(),
});

export type LearnerWorkspace = z.infer<typeof learnerWorkspaceSchema>;

export const ownOrderSchema = z.object({
  orderId: z.string().uuid(),
  orderNumber: z.string(),
  courseTitle: z.string(),
  status: z.string(),
  amountDueTwd: z.number().int().nonnegative(),
  amountPaidTwd: z.number().int().nonnegative(),
  transferDueAt: z.string(),
  createdAt: z.string(),
});

export type OwnOrderSummary = z.infer<typeof ownOrderSchema>;

export const organizationApplicationSchema = z.object({
  organizationId: z.string().uuid(),
  organizationName: z.string(),
  status: z.enum(["submitted", "approved", "rejected", "suspended"]),
  reasonSummary: z.string().nullable(),
  role: z.string(),
});

const organizationLiveSessionSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  startsAt: z.string(),
  bookingCloseAt: z.string(),
});

export const organizationWorkspaceDetailsSchema = z.object({
  organizationProfile: z.object({
    legalName: z.string(),
    contactName: z.string(),
    contactEmail: z.string(),
    invoiceEmail: nullableString,
    invoiceRecipient: nullableString,
    invoiceAddress: nullableString,
  }),
  capabilities: z.object({
    actorRole: z.enum(["owner", "training_manager", "finance"]),
    canEditProfile: z.boolean(),
    canManageMembers: z.boolean(),
    canManageOwnersOrFinance: z.boolean(),
  }),
  members: z.array(
    z.object({
      personId: z.string().uuid(),
      displayName: z.string(),
      employeeNumber: nullableString,
      department: nullableString,
      role: z.string(),
      status: z.string(),
      canManage: z.boolean(),
      canChangeRole: z.boolean(),
      canDeactivate: z.boolean(),
      offboardingBlock: nullableString,
    }),
  ),
  invitations: z.array(
    z.object({
      invitationId: z.string().uuid(),
      maskedPhone: z.string(),
      role: z.string(),
      status: z.string(),
      expiresAt: z.string(),
    }),
  ),
  topups: z.array(
    z.object({
      topupId: z.string().uuid(),
      referenceNumber: z.string(),
      points: z.number().int().positive(),
      amountTwd: z.number().int().positive(),
      status: z.string(),
      transferDueAt: z.string(),
      createdAt: z.string(),
    }),
  ),
  assignments: z.array(
    z.object({
      assignmentId: z.string().uuid(),
      memberLabel: z.string(),
      courseTitle: z.string(),
      courseVersionId: z.string().uuid(),
      liveComponentId: z.string().uuid().nullable(),
      status: z.string(),
      points: z.number().int().nonnegative(),
      canRelease: z.boolean(),
      eligibleLiveSessions: z.array(organizationLiveSessionSchema),
    }),
  ),
  liveBookings: z.array(
    z.object({
      bookingId: z.string().uuid(),
      sessionId: z.string().uuid(),
      assignmentId: z.string().uuid(),
      memberLabel: z.string(),
      courseTitle: z.string(),
      sessionTitle: z.string(),
      startsAt: z.string(),
      status: z.string(),
      canChange: z.boolean(),
      replacementSessions: z.array(organizationLiveSessionSchema),
    }),
  ),
  invoices: z.array(
    z.object({
      invoiceId: z.string().uuid(),
      externalNumber: nullableString,
      status: z.string(),
      amountTwd: z.number().int().nonnegative(),
      issuedOn: nullableString,
    }),
  ),
  outcomes: z.array(
    z.object({
      assignmentId: z.string().uuid(),
      memberLabel: z.string(),
      courseTitle: z.string(),
      progressPercent: z.number().min(0).max(100),
      validMinutes: z.number().int().nonnegative(),
      quizScore: z.number().nullable(),
      completionStatus: z.string(),
      accreditationStatus: z.string(),
    }),
  ),
});

export type OrganizationWorkspaceDetails = z.infer<
  typeof organizationWorkspaceDetailsSchema
>;

export const instructorBindingOptionSchema = z.object({
  roleId: z.string().uuid(),
  label: z.string(),
  hasProfile: z.boolean(),
  displayName: z.string(),
  biography: z.string(),
  credentials: z.string(),
});
export type InstructorBindingOption = z.infer<
  typeof instructorBindingOptionSchema
>;

export const instructorDashboardSchema = z.object({
  profile: z.object({
    displayName: z.string(),
    biography: z.string(),
    credentials: z.string(),
  }),
  courses: z.array(
    z.object({
      courseVersionId: z.string().uuid(),
      title: z.string(),
      version: z.number().int().positive(),
      status: z.string(),
      deliveryType: z.enum(["recorded", "live", "hybrid"]),
      liveSessions: z.array(
        z.object({
          liveSessionId: z.string().uuid(),
          title: z.string(),
          status: z.string(),
          startsAt: z.string(),
          endsAt: z.string(),
        }),
      ),
      surveySummary: z.object({
        responseCount: z.number().int().nonnegative(),
        averageRatings: z.array(z.number().min(1).max(5)).max(5),
      }),
    }),
  ),
});
export type InstructorDashboard = z.infer<typeof instructorDashboardSchema>;

const supportMessageSchema = z.object({
  messageId: z.string().uuid(),
  authorKind: z.enum(["customer", "support"]),
  body: z.string(),
  createdAt: z.string(),
});

export const supportCenterSchema = z.object({
  organizationOptions: z.array(
    z.object({ id: z.string().uuid(), label: z.string() }),
  ),
  cases: z.array(
    z.object({
      caseId: z.string().uuid(),
      reference: z.string(),
      kind: z.string(),
      summary: z.string(),
      status: z.string(),
      priority: z.string(),
      organizationScoped: z.boolean(),
      responseDueAt: z.string(),
      updatedAt: z.string(),
      messages: z.array(supportMessageSchema),
    }),
  ),
});
export type SupportCenter = z.infer<typeof supportCenterSchema>;

export const supportQueueSchema = z.object({
  agents: z.array(z.object({ roleId: z.string().uuid(), label: z.string() })),
  cases: z.array(
    z.object({
      caseId: z.string().uuid(),
      reference: z.string(),
      kind: z.string(),
      safePreview: z.string(),
      status: z.string(),
      priority: z.string(),
      scopeLabel: z.string(),
      requesterLabel: z.string(),
      assigned: z.boolean(),
      assignedToMe: z.boolean(),
      canReadThread: z.boolean(),
      responseDueAt: z.string(),
      slaState: z.enum(["complete", "overdue", "due_soon", "on_track"]),
      updatedAt: z.string(),
      messages: z.array(supportMessageSchema),
    }),
  ),
});
export type SupportQueue = z.infer<typeof supportQueueSchema>;

export const staffQueueActionSchema = z.object({
  key: z.enum([
    "finance_allocate",
    "finance_confirm",
    "organization_review",
    "course_publish",
    "identity_decide",
    "refund_decide",
    "attendance_decide",
    "live_open",
    "export_generate_download",
    "prerequisite_decide",
    "bank_reconcile",
    "invoice_result",
    "refund_disburse",
    "refund_disbursement_confirm",
    "role_change_request",
    "role_change_decide",
    "point_refund_decide",
    "point_refund_result",
    "provider_anomaly_propose",
    "provider_anomaly_decide",
  ]),
  label: z.string(),
  targetId: z.string().uuid(),
  payload: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
});

export const staffQueueResultSchema = z.object({
  items: z.array(
    z.object({
      itemId: z.string(),
      kind: z.string(),
      title: z.string(),
      referenceLabel: z.string(),
      status: z.string(),
      statusLabel: z.string(),
      summary: z.string(),
      updatedAt: z.string(),
      context: z.array(
        z.object({
          label: z.string(),
          value: z.string(),
        }),
      ),
      actions: z.array(staffQueueActionSchema),
    }),
  ),
  nextCursor: z.string().nullable(),
  availableStatuses: z.array(
    z.object({ value: z.string(), label: z.string() }),
  ),
});

export type StaffQueueResult = z.infer<typeof staffQueueResultSchema>;
export type StaffQueueItem = StaffQueueResult["items"][number];

export const zoomSetupReconciliationItemSchema = z.object({
  liveSessionId: z.string().uuid(),
  title: z.string(),
  claimedAt: z.string(),
  claimEligibleAt: z.string(),
  requestId: z.string().uuid().nullable(),
  resolutionKind: z
    .enum(["confirm_not_created", "register_existing"])
    .nullable(),
  providerMeetingNumber: z.string().nullable(),
  proposalReason: z.string().nullable(),
  evidenceReference: z.string().nullable(),
  proposedAt: z.string().nullable(),
  reviewStatus: z.enum([
    "provider_request_in_flight",
    "proposal_required",
    "awaiting_review",
    "rejected",
    "provider_verification",
    "provider_verification_failed",
    "provider_verification_complete",
  ]),
  jobStatus: z
    .enum(["pending", "retry", "leased", "completed", "dead_letter"])
    .nullable(),
  canPropose: z.boolean(),
  canDecide: z.boolean(),
});
export type ZoomSetupReconciliationItem = z.infer<
  typeof zoomSetupReconciliationItemSchema
>;

export const zoomOrphanCleanupItemSchema = z.object({
  jobId: z.string().uuid(),
  liveSessionId: z.string().uuid(),
  title: z.string(),
  providerMeetingNumber: z.string(),
  status: z.enum(["pending", "retry", "leased", "dead_letter"]),
  attemptCount: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
});
export type ZoomOrphanCleanupItem = z.infer<typeof zoomOrphanCleanupItemSchema>;

export const staffLiveSessionContextSchema = z.object({
  title: z.string(),
  status: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  bookingCloseAt: z.string(),
  canHost: z.boolean(),
  canEditBreaks: z.boolean(),
  canSettle: z.boolean(),
  canReschedule: z.boolean(),
  breakIntervals: z.array(
    z.object({
      startsAt: z.string(),
      endsAt: z.string(),
    }),
  ),
});
export type StaffLiveSessionContext = z.infer<
  typeof staffLiveSessionContextSchema
>;

const optionSchema = z.object({ id: z.string().uuid(), label: z.string() });
const courseDraftSchema = optionSchema.extend({
  deliveryType: z.enum(["recorded", "live", "hybrid"]),
  metadata: z.object({
    title: z.string(),
    summary: z.string(),
    description: z.string(),
    learningObjectives: z.array(z.string()),
    priceTwd: z.number().int().nonnegative(),
    organizationPointPrice: z.number().int().positive(),
    recordedRefundAllocationTwd: z.number().int().nonnegative(),
    equipmentRequirements: z.string(),
    legalDocumentId: z.string().uuid(),
    retentionPolicyRevisionId: z.string().uuid(),
    accreditationRevisionId: z.string().uuid().nullable(),
    accreditationDisclosure: z.string(),
    minimumCompletionDays: z.number().positive(),
    commerceCloseAt: z.string(),
    contentAvailableAt: z.string(),
    requiredWatchSeconds: z.number().int().nonnegative(),
    livePresencePercent: z.number().min(80).max(100).nullable(),
    liveCameraPercent: z.number().min(80).max(100).nullable(),
    hasCover: z.boolean(),
    hybridComponents: z.array(
      z.object({
        componentId: z.string().uuid(),
        componentType: z.enum(["recorded", "live"]),
        title: z.string(),
        required: z.boolean(),
        sortOrder: z.number().int().nonnegative(),
        refundAllocationTwd: z.number().int().nonnegative(),
        recordedRequiredWatchSeconds: z.number().int().nonnegative().default(0),
        dependsOnComponentIds: z.array(z.string().uuid()),
      }),
    ),
  }),
  instructors: z.array(
    optionSchema.extend({
      biography: z.string(),
      credentials: z.string(),
      sortOrder: z.number().int().nonnegative(),
    }),
  ),
  questions: z.array(
    z.object({
      id: z.string().uuid(),
      prompt: z.string(),
      topic: z.string(),
      explanation: z.string(),
      options: z.array(z.string()).length(4),
      correctIndex: z.number().int().min(0).max(3),
      sortOrder: z.number().int().nonnegative(),
    }),
  ),
  materials: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      lessonId: z.string().uuid().nullable(),
    }),
  ),
  modules: z.array(
    optionSchema.extend({
      sortOrder: z.number().int().nonnegative(),
      lessons: z.array(
        optionSchema.extend({
          contentType: z.enum(["video", "material", "quiz", "survey"]),
          preview: z.boolean(),
          sortOrder: z.number().int().nonnegative(),
          videoStatus: z
            .enum(["uploading", "processing", "ready", "failed"])
            .nullable(),
          hybridComponentId: z.string().uuid().nullable().default(null),
        }),
      ),
    }),
  ),
});
export const platformPrerequisiteOptionsSchema = z.object({
  courses: z.array(optionSchema),
  courseDrafts: z.array(courseDraftSchema),
  liveCourseVersions: z.array(
    optionSchema.extend({
      components: z.array(optionSchema),
    }),
  ),
  organizingBodies: z.array(optionSchema),
  authorities: z.array(optionSchema),
  accreditationRevisions: z.array(optionSchema),
  legalDocuments: z.array(optionSchema),
  retentionPolicies: z.array(optionSchema),
  zoomHosts: z.array(optionSchema),
  courseLifecycleVersions: z
    .array(
      z.object({
        id: z.string().uuid(),
        courseId: z.string().uuid(),
        slug: z.string(),
        title: z.string(),
        version: z.number().int().positive(),
        status: z.enum(["published", "suspended", "archived"]),
        commerceCloseAt: z.string(),
        publishedAt: z.string().nullable(),
        canStopSale: z.boolean(),
        canSuspend: z.boolean(),
        canResume: z.boolean(),
        canArchive: z.boolean(),
      }),
    )
    .default([]),
});
export type PlatformPrerequisiteOptions = z.infer<
  typeof platformPrerequisiteOptionsSchema
>;

export const launchControlWorkspaceSchema = z.object({
  settings: z.array(
    z.object({
      key: z.enum([
        "legal_approved",
        "finance_configured",
        "incident_owner_configured",
        "bank_account",
        "finance_high_value_threshold",
      ]),
      label: z.string(),
      value: z.record(z.string(), z.unknown()).nullable(),
      effectiveAt: z.string().nullable(),
      revision: z.number().int().positive().nullable(),
    }),
  ),
  settingRequests: z.array(
    z.object({
      id: z.string().uuid(),
      settingKey: z.string(),
      proposedValue: z.record(z.string(), z.unknown()),
      effectiveAt: z.string(),
      requestReason: z.string(),
      requesterLabel: z.string(),
      canDecide: z.boolean(),
    }),
  ),
  providers: z.array(
    z.object({
      provider: z.string(),
      status: z.string(),
      checkedAt: z.string().nullable(),
      lastSuccessAt: z.string().nullable(),
      productionValidatedAt: z.string().nullable(),
      productionValidationExpiresAt: z.string().nullable(),
      validationCurrent: z.boolean(),
    }),
  ),
  providerRequests: z.array(
    z.object({
      id: z.string().uuid(),
      provider: z.string(),
      evidenceReference: z.string(),
      evidenceSha256: z.string(),
      testedAt: z.string(),
      evidenceExpiresAt: z.string(),
      requestReason: z.string(),
      requesterLabel: z.string(),
      canDecide: z.boolean(),
      canApprove: z.boolean(),
    }),
  ),
});
export type LaunchControlWorkspace = z.infer<
  typeof launchControlWorkspaceSchema
>;

const accreditationBatchItemSchema = z.object({
  enrollmentId: z.string().uuid(),
  learnerLabel: z.string(),
  status: z.string(),
  missingReasons: z.array(z.string()),
});

export const accreditationOperationsWorkspaceSchema = z.object({
  canCreateBatch: z.boolean(),
  canManageLifecycle: z.boolean(),
  revisions: z.array(
    z.object({
      id: z.string().uuid(),
      courseId: z.string().uuid(),
      courseLabel: z.string(),
      revision: z.number().int().positive(),
      status: z.enum([
        "applying",
        "approved",
        "rejected",
        "expired",
        "revoked",
      ]),
      applicationReference: z.string().nullable(),
      approvalReference: z.string().nullable(),
      points: z.number().positive().nullable(),
      validFrom: z.string().nullable(),
      validUntil: z.string().nullable(),
      retroactive: z.boolean(),
      canRequestTransition: z.boolean(),
    }),
  ),
  transitionRequests: z.array(
    z.object({
      id: z.string().uuid(),
      sourceRevisionId: z.string().uuid(),
      courseLabel: z.string(),
      requestedStatus: z.enum(["approved", "rejected", "expired", "revoked"]),
      approvalReference: z.string().nullable(),
      points: z.number().positive().nullable(),
      validFrom: z.string().nullable(),
      validUntil: z.string().nullable(),
      effectiveAt: z.string(),
      retroactive: z.boolean(),
      retroactiveBasis: z.string().nullable(),
      sourceDocumentPath: z.string(),
      sourceDocumentSha256: z.string(),
      requestReason: z.string(),
      requesterLabel: z.string(),
      canDecide: z.boolean(),
    }),
  ),
  batchCourseOptions: z.array(
    z.object({
      courseVersionId: z.string().uuid(),
      label: z.string(),
      accreditationRevisionId: z.string().uuid(),
      accreditationLabel: z.string(),
      liveSessions: z.array(optionSchema),
    }),
  ),
  batches: z.array(
    z.object({
      id: z.string().uuid(),
      courseVersionId: z.string().uuid(),
      courseLabel: z.string(),
      accreditationRevisionId: z.string().uuid(),
      liveSessionId: z.string().uuid().nullable(),
      status: z.enum([
        "draft",
        "approved",
        "exported",
        "submitted",
        "accepted",
        "needs_correction",
        "rejected",
      ]),
      templateVersion: z.string(),
      externalReference: z.string().nullable(),
      supersedesBatchId: z.string().uuid().nullable(),
      isolatedAt: z.string().nullable(),
      isolationReason: z.string().nullable(),
      createdAt: z.string(),
      canCreateCorrection: z.boolean(),
      canMarkSubmitted: z.boolean(),
      canRecordResults: z.boolean(),
      items: z.array(accreditationBatchItemSchema),
    }),
  ),
});
export type AccreditationOperationsWorkspace = z.infer<
  typeof accreditationOperationsWorkspaceSchema
>;

export async function readLearnerWorkspace(
  client: SupabaseClient,
  enrollmentId: string,
): Promise<LearnerWorkspace> {
  const [{ data, error }, { data: gateData, error: gateError }] =
    await Promise.all([
      client.rpc("read_learner_course_workspace", {
        p_enrollment_id: enrollmentId,
      }),
      client.rpc("read_learner_runtime_gates", {
        p_enrollment_id: enrollmentId,
      }),
    ]);
  if (error || gateError) {
    throw new Error(
      `LEARNER_WORKSPACE_UNAVAILABLE:${error?.message ?? gateError?.message}`,
    );
  }
  const parsed = learnerWorkspaceSchema.safeParse(data);
  if (!parsed.success) throw new Error("LEARNER_WORKSPACE_INVALID");
  const gates = z
    .object({
      components: z.array(
        z.object({
          id: z.string().uuid(),
          confirmedSeconds: z.number().int().nonnegative(),
          requiredSeconds: z.number().int().nonnegative(),
          completed: z.boolean(),
          prerequisitesComplete: z.boolean(),
        }),
      ),
      lessonAccess: z.array(
        z.object({
          lessonId: z.string().uuid(),
          componentId: z.string().uuid().nullable(),
          locked: z.boolean(),
          lockReason: z.string().nullable(),
        }),
      ),
      bookingAccess: z.array(
        z.object({
          bookingId: z.string().uuid(),
          canChange: z.boolean(),
          canJoin: z.boolean(),
          replacementSessions: z.array(
            z.object({
              id: z.string().uuid(),
              title: z.string(),
              startsAt: z.string(),
              endsAt: z.string(),
              bookingCloseAt: z.string(),
            }),
          ),
        }),
      ),
    })
    .safeParse(gateData);
  if (!gates.success) throw new Error("LEARNER_RUNTIME_GATES_INVALID");
  const componentGates = new Map(
    gates.data.components.map((component) => [component.id, component]),
  );
  const lessonGates = new Map(
    gates.data.lessonAccess.map((lesson) => [lesson.lessonId, lesson]),
  );
  const bookingGates = new Map(
    gates.data.bookingAccess.map((booking) => [booking.bookingId, booking]),
  );
  return {
    ...parsed.data,
    components: parsed.data.components.map((component) => ({
      ...component,
      ...(componentGates.get(component.id) ?? {
        confirmedSeconds: 0,
        requiredSeconds: 0,
        completed: false,
        prerequisitesComplete: false,
      }),
    })),
    modules: parsed.data.modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => {
        const gate = lessonGates.get(lesson.id);
        return gate
          ? {
              ...lesson,
              componentId: gate.componentId,
              locked: gate.locked,
              lockReason: gate.lockReason,
            }
          : {
              ...lesson,
              locked: true,
              lockReason: "無法確認課程先修條件",
            };
      }),
    })),
    liveBookings: parsed.data.liveBookings.map((booking) => ({
      ...booking,
      ...(bookingGates.get(booking.bookingId) ?? {
        canChange: false,
        canJoin: false,
        replacementSessions: [],
      }),
    })),
  };
}

export async function readLearnerWorkspaceWithSafeFallback(
  client: SupabaseClient,
  enrollmentId: string,
): Promise<{ workspace: LearnerWorkspace; projectionReady: boolean } | null> {
  try {
    return {
      workspace: await readLearnerWorkspace(client, enrollmentId),
      projectionReady: true,
    };
  } catch {
    // A narrow RLS-only fallback keeps recorded lessons usable while the
    // dedicated projection is being deployed. It never uses service authority.
  }
  const [{ data: access }, { data: enrollment }] = await Promise.all([
    client
      .from("learner_course_access")
      .select("course_title,delivery_type,enrollment_status")
      .eq("enrollment_id", enrollmentId)
      .maybeSingle(),
    client
      .from("enrollments")
      .select("course_version_id,status")
      .eq("id", enrollmentId)
      .maybeSingle(),
  ]);
  if (!access || !enrollment) return null;
  const { data: moduleRows, error: moduleError } = await client
    .from("modules")
    .select("id,title,sort_order")
    .eq("course_version_id", enrollment.course_version_id)
    .order("sort_order");
  if (moduleError) throw new Error("LEARNER_MODULES_UNAVAILABLE");
  const moduleIds = (moduleRows ?? []).map((item) => item.id);
  const lessonRequest = client
    .from("lessons")
    .select("id,module_id,title,content_type,sort_order,archived_at")
    .is("archived_at", null)
    .order("sort_order");
  const { data: lessonRows, error: lessonError } =
    moduleIds.length > 0
      ? await lessonRequest.in("module_id", moduleIds)
      : { data: [], error: null };
  if (lessonError) throw new Error("LEARNER_LESSONS_UNAVAILABLE");
  const lessonIds = (lessonRows ?? []).map((item) => item.id);
  const videoRequest = client
    .from("lesson_video_versions")
    .select("id,lesson_id")
    .eq("active", true);
  const { data: videoRows, error: videoError } =
    lessonIds.length > 0
      ? await videoRequest.in("lesson_id", lessonIds)
      : { data: [], error: null };
  if (videoError) throw new Error("LEARNER_VIDEOS_UNAVAILABLE");
  const videoByLesson = new Map(
    (videoRows ?? []).map((video) => [video.lesson_id, video.id]),
  );
  const lessonsByModule = new Map<
    string,
    LearnerWorkspace["modules"][number]["lessons"]
  >();
  for (const lesson of lessonRows ?? []) {
    const current = lessonsByModule.get(lesson.module_id) ?? [];
    current.push({
      id: lesson.id,
      title: lesson.title,
      type: lesson.content_type,
      videoVersionId: videoByLesson.get(lesson.id) ?? null,
      componentId: null,
      completed: false,
      resumeSeconds: 0,
      locked: access.delivery_type === "hybrid",
      lockReason:
        access.delivery_type === "hybrid"
          ? "先修條件暫時無法確認，為保護積分紀錄已鎖定"
          : null,
    });
    lessonsByModule.set(lesson.module_id, current);
  }
  return {
    projectionReady: false,
    workspace: {
      courseTitle: access.course_title,
      deliveryType: access.delivery_type,
      enrollmentStatus: enrollment.status,
      accreditationStatus: null,
      identity: null,
      modules: (moduleRows ?? []).map((module) => ({
        id: module.id,
        title: module.title,
        lessons: lessonsByModule.get(module.id) ?? [],
      })),
      materials: [],
      components: [],
      liveBookings: [],
      completion: {},
      certificate: null,
    },
  };
}

export async function readOwnOrders(
  client: SupabaseClient,
  input: { limit?: number; before?: string | null } = {},
): Promise<OwnOrderSummary[]> {
  const { data, error } = await client.rpc("read_own_orders", {
    p_limit: input.limit ?? 50,
    p_before: input.before ?? null,
  });
  if (error) throw new Error(`ORDER_LIST_UNAVAILABLE:${error.message}`);
  const parsed = z.array(ownOrderSchema).safeParse(data);
  if (!parsed.success) throw new Error("ORDER_LIST_INVALID");
  return parsed.data;
}

export async function readOwnOrganizationApplication(client: SupabaseClient) {
  const { data, error } = await client.rpc("read_own_organization_application");
  if (error) throw new Error("ORGANIZATION_APPLICATION_UNAVAILABLE");
  if (data === null) return null;
  const parsed = organizationApplicationSchema.safeParse(data);
  if (!parsed.success) throw new Error("ORGANIZATION_APPLICATION_INVALID");
  return parsed.data;
}

export async function readOrganizationWorkspaceDetails(
  client: SupabaseClient,
  organizationId: string,
): Promise<OrganizationWorkspaceDetails> {
  const { data, error } = await client.rpc("read_organization_workspace_v2", {
    p_organization_id: organizationId,
  });
  if (error) throw new Error("ORGANIZATION_WORKSPACE_UNAVAILABLE");
  const parsed = organizationWorkspaceDetailsSchema.safeParse(data);
  if (!parsed.success) throw new Error("ORGANIZATION_WORKSPACE_INVALID");
  return parsed.data;
}

export async function readActiveInstructorOptions(
  client: SupabaseClient,
): Promise<InstructorBindingOption[]> {
  const { data, error } = await client.rpc("read_active_instructor_options");
  if (error) throw new Error("INSTRUCTOR_OPTIONS_UNAVAILABLE");
  const parsed = z.array(instructorBindingOptionSchema).safeParse(data);
  if (!parsed.success) throw new Error("INSTRUCTOR_OPTIONS_INVALID");
  return parsed.data;
}

export async function readInstructorDashboard(
  client: SupabaseClient,
): Promise<InstructorDashboard> {
  const { data, error } = await client.rpc("read_instructor_dashboard");
  if (error) throw new Error("INSTRUCTOR_DASHBOARD_UNAVAILABLE");
  const parsed = instructorDashboardSchema.safeParse(data);
  if (!parsed.success) throw new Error("INSTRUCTOR_DASHBOARD_INVALID");
  return parsed.data;
}

export async function readSupportCenter(
  client: SupabaseClient,
): Promise<SupportCenter> {
  const { data, error } = await client.rpc("read_support_center");
  if (error) throw new Error("SUPPORT_CENTER_UNAVAILABLE");
  const parsed = supportCenterSchema.safeParse(data);
  if (!parsed.success) throw new Error("SUPPORT_CENTER_INVALID");
  return parsed.data;
}

export async function readSupportQueue(
  client: SupabaseClient,
): Promise<SupportQueue> {
  const { data, error } = await client.rpc("read_support_queue");
  if (error) throw new Error("SUPPORT_QUEUE_UNAVAILABLE");
  const parsed = supportQueueSchema.safeParse(data);
  if (!parsed.success) throw new Error("SUPPORT_QUEUE_INVALID");
  return parsed.data;
}

export async function readStaffQueueItems(
  client: SupabaseClient,
  input: {
    queue: string;
    search?: string;
    status?: string;
    cursor?: string | null;
    limit?: number;
  },
): Promise<StaffQueueResult> {
  const { data, error } = await client.rpc("read_staff_queue_items", {
    p_queue: input.queue,
    p_search: input.search?.trim() || null,
    p_status: input.status?.trim() || null,
    p_cursor: input.cursor ?? null,
    p_limit: input.limit ?? 25,
  });
  if (error) throw new Error("STAFF_QUEUE_UNAVAILABLE");
  const parsed = staffQueueResultSchema.safeParse(data);
  if (!parsed.success) throw new Error("STAFF_QUEUE_INVALID");
  return parsed.data;
}

export async function readZoomSetupReconciliationWorklist(
  client: SupabaseClient,
): Promise<ZoomSetupReconciliationItem[]> {
  const { data, error } = await client.rpc(
    "read_zoom_setup_reconciliation_worklist",
  );
  if (error) throw new Error("ZOOM_SETUP_RECONCILIATION_LIST_UNAVAILABLE");
  const parsed = z.array(zoomSetupReconciliationItemSchema).safeParse(data);
  if (!parsed.success) {
    throw new Error("ZOOM_SETUP_RECONCILIATION_LIST_INVALID");
  }
  return parsed.data;
}

export async function readZoomOrphanCleanupWorklist(
  client: SupabaseClient,
): Promise<ZoomOrphanCleanupItem[]> {
  const { data, error } = await client.rpc("read_zoom_orphan_cleanup_worklist");
  if (error) throw new Error("ZOOM_ORPHAN_CLEANUP_LIST_UNAVAILABLE");
  const parsed = z.array(zoomOrphanCleanupItemSchema).safeParse(data);
  if (!parsed.success) {
    throw new Error("ZOOM_ORPHAN_CLEANUP_LIST_INVALID");
  }
  return parsed.data;
}

export async function readStaffLiveSessionContext(
  client: SupabaseClient,
  liveSessionId: string,
): Promise<StaffLiveSessionContext> {
  const { data, error } = await client.rpc("read_staff_live_session_context", {
    p_live_session_id: liveSessionId,
  });
  if (error) throw new Error("STAFF_LIVE_SESSION_UNAVAILABLE");
  const parsed = staffLiveSessionContextSchema.safeParse(data);
  if (!parsed.success) throw new Error("STAFF_LIVE_SESSION_INVALID");
  return parsed.data;
}

export async function readPlatformPrerequisiteOptions(
  client: SupabaseClient,
): Promise<PlatformPrerequisiteOptions> {
  const [{ data, error }, { data: controls, error: controlsError }] =
    await Promise.all([
      client.rpc("read_platform_prerequisite_options"),
      client.rpc("read_course_product_controls"),
    ]);
  if (error || controlsError) {
    throw new Error("PLATFORM_PREREQUISITES_UNAVAILABLE");
  }
  const controlResult = z
    .object({
      lifecycleVersions:
        platformPrerequisiteOptionsSchema.shape.courseLifecycleVersions,
      hybridConfigurations: z.array(
        z.object({
          courseVersionId: z.string().uuid(),
          components: z.array(
            z.object({
              componentId: z.string().uuid(),
              requiredWatchSeconds: z.number().int().nonnegative(),
            }),
          ),
          lessonMappings: z.array(
            z.object({
              lessonId: z.string().uuid(),
              componentId: z.string().uuid().nullable(),
            }),
          ),
        }),
      ),
    })
    .safeParse(controls);
  if (!controlResult.success) {
    throw new Error("COURSE_PRODUCT_CONTROLS_INVALID");
  }
  const raw =
    data && typeof data === "object"
      ? {
          ...(data as Record<string, unknown>),
          courseLifecycleVersions: controlResult.data.lifecycleVersions,
        }
      : data;
  const parsed = platformPrerequisiteOptionsSchema.safeParse(raw);
  if (!parsed.success) throw new Error("PLATFORM_PREREQUISITES_INVALID");
  const configurations = new Map(
    controlResult.data.hybridConfigurations.map((configuration) => [
      configuration.courseVersionId,
      configuration,
    ]),
  );
  return {
    ...parsed.data,
    courseDrafts: parsed.data.courseDrafts.map((draft) => {
      const configuration = configurations.get(draft.id);
      const componentRequirements = new Map(
        (configuration?.components ?? []).map((component) => [
          component.componentId,
          component.requiredWatchSeconds,
        ]),
      );
      const lessonMappings = new Map(
        (configuration?.lessonMappings ?? []).map((mapping) => [
          mapping.lessonId,
          mapping.componentId,
        ]),
      );
      return {
        ...draft,
        metadata: {
          ...draft.metadata,
          hybridComponents: draft.metadata.hybridComponents.map(
            (component) => ({
              ...component,
              recordedRequiredWatchSeconds:
                componentRequirements.get(component.componentId) ?? 0,
            }),
          ),
        },
        modules: draft.modules.map((module) => ({
          ...module,
          lessons: module.lessons.map((lesson) => ({
            ...lesson,
            hybridComponentId: lessonMappings.get(lesson.id) ?? null,
          })),
        })),
      };
    }),
  };
}

export async function readLaunchControlWorkspace(
  client: SupabaseClient,
): Promise<LaunchControlWorkspace> {
  const { data, error } = await client.rpc("read_launch_control_workspace");
  if (error) throw new Error("LAUNCH_CONTROL_WORKSPACE_UNAVAILABLE");
  const parsed = launchControlWorkspaceSchema.safeParse(data);
  if (!parsed.success) throw new Error("LAUNCH_CONTROL_WORKSPACE_INVALID");
  return parsed.data;
}

export async function readAccreditationOperationsWorkspace(
  client: SupabaseClient,
): Promise<AccreditationOperationsWorkspace> {
  const { data, error } = await client.rpc(
    "read_accreditation_operations_workspace",
  );
  if (error) throw new Error("ACCREDITATION_OPERATIONS_UNAVAILABLE");
  const parsed = accreditationOperationsWorkspaceSchema.safeParse(data);
  if (!parsed.success) throw new Error("ACCREDITATION_OPERATIONS_INVALID");
  return parsed.data;
}
