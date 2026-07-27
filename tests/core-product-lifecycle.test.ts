import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), "utf8");

const migration = read(
  "supabase",
  "migrations",
  "20260724071357_core_product_lifecycle_and_hybrid_gates.sql",
);
const baseMigration = read(
  "supabase",
  "migrations",
  "20260724011637_rls_grants_bootstrap.sql",
);
const providerSagaMigration = read(
  "supabase",
  "migrations",
  "20260724180000_provider_operation_sagas.sql",
);
const playbackAuthorization = read(
  "src",
  "app",
  "api",
  "playback",
  "_shared",
  "authorization.ts",
);
const playbackTokenRoute = read(
  "src",
  "app",
  "api",
  "playback",
  "token",
  "route.ts",
);
const playbackRefreshRoute = read(
  "src",
  "app",
  "api",
  "playback",
  "refresh",
  "route.ts",
);
const playbackHeartbeatRoute = read(
  "src",
  "app",
  "api",
  "playback",
  "heartbeat",
  "route.ts",
);
const playbackPresenceRoute = read(
  "src",
  "app",
  "api",
  "playback",
  "presence",
  "route.ts",
);
const recordedClassroom = read("src", "components", "recorded-classroom.tsx");
const learnerChangeRoute = read(
  "src",
  "app",
  "api",
  "live",
  "bookings",
  "[bookingId]",
  "change",
  "route.ts",
);
const lifecycleRoute = read(
  "src",
  "app",
  "api",
  "staff",
  "courses",
  "[courseVersionId]",
  "lifecycle",
  "route.ts",
);
const hybridEditor = read(
  "src",
  "components",
  "course-draft-metadata-editor.tsx",
);
const liveBookingCard = read("src", "components", "live-booking-card.tsx");
const lifecyclePanel = read("src", "components", "course-lifecycle-panel.tsx");

describe("component-scoped hybrid learning", () => {
  it("stores component minutes, maps every video, and preserves the global total", () => {
    expect(migration).toContain("recorded_required_watch_seconds");
    expect(migration).toContain("hybrid_component_id uuid");
    expect(migration).toContain("HYBRID_TOTAL_WATCH_REQUIREMENT_MISMATCH");
    expect(migration).toContain("HYBRID_LESSON_MAPPING_INVALID");
    expect(migration).toContain("HYBRID_REQUIRED_COMPONENT_HAS_NO_VIDEO");
    expect(migration).toContain(
      "create trigger validate_hybrid_publish_transition",
    );
    expect(hybridEditor).toContain("recordedRequiredWatchSeconds");
    expect(hybridEditor).toContain(
      "混合課的必修錄播元件分鐘合計，必須等於全課必要有效觀看分鐘。",
    );
    expect(hybridEditor).toContain("每個錄播影片單元都必須指定");
  });

  it("gates playback, live access, quizzes, and certification at runtime", () => {
    for (const implementation of [
      "authorize_recorded_playback_without_hybrid_gate",
      "issue_live_join_lease_without_hybrid_gate",
      "record_live_check_event_without_hybrid_gate",
      "select_assignment_live_session_without_hybrid_gate",
      "change_assignment_live_session_without_hybrid_gate",
      "start_quiz_attempt_without_hybrid_gate",
    ]) {
      expect(migration).toContain(implementation);
    }
    expect(migration).toContain("assert_hybrid_lesson_access");
    expect(migration).toContain("assert_live_component_access");
    expect(migration).toContain("HYBRID_COMPONENT_PREREQUISITES_INCOMPLETE");
    expect(migration).toContain("HYBRID_REQUIRED_COMPONENTS_INCOMPLETE");
    expect(migration).toContain(
      "create or replace function public.read_completion_render_context",
    );
    expect(migration).toContain(
      "create or replace function public.finalize_completion_and_certificate",
    );
  });

  it("attributes one confirmed block across its actual 1 + 9 minute components", () => {
    const videoToComponent = new Map([
      ["video-a", "component-a"],
      ["video-b", "component-b"],
    ]);
    const manifest = [
      { videoVersionId: "video-a", creditedSeconds: 60 },
      { videoVersionId: "video-b", creditedSeconds: 540 },
    ];
    const confirmedByComponent = manifest.reduce<Record<string, number>>(
      (totals, entry) => {
        const component = videoToComponent.get(entry.videoVersionId);
        if (component) {
          totals[component] = (totals[component] ?? 0) + entry.creditedSeconds;
        }
        return totals;
      },
      {},
    );

    expect(confirmedByComponent).toEqual({
      "component-a": 60,
      "component-b": 540,
    });
    const componentSeconds = migration.slice(
      migration.indexOf("internal.hybrid_component_confirmed_seconds"),
      migration.indexOf("internal.hybrid_component_is_complete"),
    );
    expect(componentSeconds).toContain(
      "jsonb_array_elements(\n    challenge.event_manifest",
    );
    expect(componentSeconds).toContain(
      "manifest_entry.value ->> 'videoVersionId'",
    );
    expect(componentSeconds).toContain(
      "manifest_entry.value ->> 'creditedSeconds'",
    );
    expect(componentSeconds).toContain(
      "lesson.hybrid_component_id = target_component",
    );
    expect(componentSeconds).not.toContain("sum(block.seconds)");
  });
});

describe("enrollment-bound recorded playback", () => {
  it("uses the caller-selected enrollment for authorization and every follow-up", () => {
    const authorize = baseMigration.slice(
      baseMigration.indexOf("internal.authorize_recorded_playback"),
      baseMigration.indexOf("internal.split_candidate_manifest"),
    );
    const heartbeat = baseMigration.slice(
      baseMigration.indexOf("internal.record_playback_heartbeat"),
      baseMigration.indexOf("internal.confirm_presence_challenge"),
    );
    const presence = baseMigration.slice(
      baseMigration.indexOf("internal.confirm_presence_challenge"),
      baseMigration.indexOf("internal.recompute_recorded_progress_unchecked"),
    );
    const refresh = providerSagaMigration.slice(
      providerSagaMigration.indexOf("internal.refresh_recorded_playback"),
      providerSagaMigration.indexOf(
        "create or replace function public.refresh_recorded_playback",
      ),
    );

    expect(authorize).toContain("enrollment.id = target_enrollment");
    expect(authorize).toContain("'enrollment_id', enrollment_row.id");
    expect(heartbeat).toContain("enrollment_id = target_enrollment");
    expect(presence).toContain("challenge.enrollment_id = target_enrollment");
    expect(refresh).toContain("session.enrollment_id = target_enrollment");
    expect(refresh).toContain("target_enrollment, lesson_video_version");
  });

  it("cannot silently switch between B2C and organization enrollments for one version", () => {
    for (const route of [
      playbackTokenRoute,
      playbackRefreshRoute,
      playbackHeartbeatRoute,
      playbackPresenceRoute,
    ]) {
      expect(route).toContain("enrollmentId");
    }
    expect(playbackTokenRoute).toContain("p_enrollment_id: enrollmentId");
    expect(playbackRefreshRoute).toContain(
      "p_enrollment_id: input.enrollmentId",
    );
    expect(playbackAuthorization).toContain("enrollment_id: z.uuid()");
    expect(recordedClassroom).toContain(
      "payload.data.enrollmentId !== enrollmentId",
    );
    expect(recordedClassroom).toContain("enrollmentId: snapshot.enrollmentId");
    expect(recordedClassroom).toContain(
      "body: JSON.stringify({ enrollmentId, challengeToken })",
    );
  });
});

describe("B2C live-session replacement", () => {
  it("locks the order, booking, and session capacity in one fixed order", () => {
    const orderLock = migration.indexOf("select orders.* into order_row");
    const bookingLock = migration.indexOf("select * into booking_row");
    const advisoryLocks = migration.indexOf(
      "if booking_row.live_session_id::text < replacement_session::text",
    );
    const sessionLocks = migration.indexOf("perform session.id", advisoryLocks);
    expect(orderLock).toBeGreaterThan(0);
    expect(bookingLock).toBeGreaterThan(orderLock);
    expect(advisoryLocks).toBeGreaterThan(bookingLock);
    expect(sessionLocks).toBeGreaterThan(advisoryLocks);
  });

  it("rechecks deadlines, capacity, cancellation, and paid-unfulfilled recovery", () => {
    expect(migration).toContain("interval '24 hours'");
    expect(migration).toContain("B2C_REPLACEMENT_SESSION_FULL");
    expect(migration).toContain("B2C_CANCELLATION_REMEDY_INVALID");
    expect(migration).toContain("'paid_unfulfilled_recovery'");
    expect(migration).toContain("'fulfillment_recovered'");
    expect(migration).toContain(
      "booking_row.status = 'cancelled'\n       and order_row.status not in ('paid', 'paid_unfulfilled')",
    );
    expect(migration).toContain(
      "booking.status = 'cancelled'\n            and session.status = 'cancelled'\n            and orders.status in ('paid', 'paid_unfulfilled')",
    );
    expect(migration).toContain(
      "create table public.live_booking_change_events",
    );
    expect(migration).toContain("live_booking_change_events_append_only");
    expect(learnerChangeRoute).toContain("change_b2c_live_session");
    expect(learnerChangeRoute).toContain("requireIdempotencyKey(request)");
    expect(liveBookingCard).toContain("確認更換場次");
    expect(liveBookingCard).toContain("原場次已取消");
  });
});

describe("course-version lifecycle and catalog", () => {
  it("allows only one published version and resolves the catalog deterministically", () => {
    expect(migration).toContain(
      "create unique index one_published_version_per_course",
    );
    expect(migration).toContain("join lateral");
    expect(migration).toContain(
      "order by candidate.published_at desc nulls last",
    );
    expect(migration).toContain("order by decision.revision desc, decision.id");
    expect(migration).toContain(
      "accreditation.valid_until >\n    clock_timestamp() + version.minimum_completion_window",
    );
  });

  it("validates only the version being published so a second version is independent", () => {
    const graphValidation = baseMigration.slice(
      baseMigration.indexOf("HYBRID_REQUIRED_COMPONENTS_MISSING"),
      baseMigration.indexOf(
        "update public.course_versions",
        baseMigration.indexOf("HYBRID_GRAPH_CYCLE_OR_UNREACHABLE"),
      ),
    );
    expect(graphValidation).toContain(
      "where edge.course_version_id = target_version",
    );
    expect(graphValidation).toContain(
      "and edge.course_version_id = target_version",
    );
    expect(graphValidation).not.toContain(
      "where edge.course_version_id <> target_version",
    );
  });

  it("keeps an owner's historical version readable without reopening sales", () => {
    const historicalAccess = migration.slice(
      migration.indexOf("create policy learner_owned_course_versions_read"),
      migration.indexOf("drop policy if exists catalog_accreditation_read"),
    );
    const checkout = baseMigration.slice(
      baseMigration.indexOf("internal.create_b2c_order"),
      baseMigration.indexOf(
        "create or replace function public.create_b2c_order",
      ),
    );
    expect(historicalAccess).toContain("for select to authenticated");
    expect(historicalAccess).toContain(
      "enrollment.person_id = internal.request_person_id()",
    );
    expect(historicalAccess).toContain("entitlement.status = 'active'");
    expect(baseMigration).toContain(
      "using (status = 'published' and commerce_close_at > now())",
    );
    expect(migration).toContain("and candidate.status = 'published'");
    expect(migration).toContain(
      "version.commerce_close_at > clock_timestamp()",
    );
    expect(checkout).toContain("version_row.status <> 'published'");
    expect(checkout).toContain("version_row.commerce_close_at <= now()");
  });

  it("requires step-up, a reason, idempotency, and append-only audit evidence", () => {
    for (const action of ["stop_sale", "suspend", "resume", "archive"]) {
      expect(migration).toContain(`'${action}'`);
      expect(lifecycleRoute).toContain(`"${action}"`);
    }
    expect(migration).toContain("consume_step_up_grant(\n    'course_publish'");
    expect(migration).toContain("course_version_lifecycle_transitions");
    expect(migration).toContain(
      "course_version_lifecycle_transitions_append_only",
    );
    expect(migration).toContain("'course.lifecycle_' || submitted_action");
    expect(lifecycleRoute).toContain("requireIdempotencyKey(request)");
    expect(lifecycleRoute).toContain('createHash("sha256")');
    expect(lifecyclePanel).toContain("永久封存");
    expect(lifecyclePanel).toContain("操作原因（至少 10 字");
  });
});
