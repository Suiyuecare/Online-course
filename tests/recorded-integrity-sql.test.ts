import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260724011629_recorded_learning_exam.sql",
  ),
  "utf8",
);
const workflow = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260724011637_rls_grants_bootstrap.sql",
  ),
  "utf8",
);
const worker = readFileSync(
  join(process.cwd(), "src", "app", "api", "workers", "wake", "route.ts"),
  "utf8",
);

type ManifestEntry = { eventId: string; creditedSeconds: number };

function splitManifest(entries: ManifestEntry[], target: number) {
  let remaining = target;
  const block: ManifestEntry[] = [];
  const surplus: ManifestEntry[] = [];
  for (const entry of entries) {
    const blockSeconds = Math.min(
      entry.creditedSeconds,
      Math.max(remaining, 0),
    );
    if (blockSeconds > 0) {
      block.push({ ...entry, creditedSeconds: blockSeconds });
      remaining -= blockSeconds;
    }
    if (entry.creditedSeconds > blockSeconds) {
      surplus.push({
        ...entry,
        creditedSeconds: entry.creditedSeconds - blockSeconds,
      });
    }
  }
  if (remaining !== 0) throw new Error("target not reached");
  return { block, surplus };
}

describe("recorded evidence integrity", () => {
  it("fences the entire enrollment and requires a fresh origin baseline", () => {
    expect(schema).toContain("claimed_after_sequence bigint");
    expect(schema).toContain("baseline_sequence bigint");
    expect(schema).toContain(
      "create unique index one_pending_rewind_fence_per_enrollment",
    );
    expect(workflow).toContain(
      "rewind_fence.lesson_video_version_id <> lesson_video_version",
    );
    expect(workflow).toContain("'rewind_origin_required', true");
    expect(workflow).toContain("claimed_after_sequence = reported_sequence");
    expect(workflow).toContain("claimed_after_sequence < reported_sequence");
    const heartbeatFence = workflow.slice(
      workflow.indexOf("if session_row.rewind_fence_id is not null then"),
      workflow.indexOf("select challenge.* into pending_challenge"),
    );
    expect(heartbeatFence).toContain("rewind_fence.baseline_sequence is null");
    expect(heartbeatFence).not.toContain("session_row.last_sequence = 0");
  });

  it("splits an existing final carry without negative or missing credits", () => {
    const { block, surplus } = splitManifest(
      [{ eventId: "overshoot", creditedSeconds: 10 }],
      5,
    );
    expect(block).toEqual([{ eventId: "overshoot", creditedSeconds: 5 }]);
    expect(surplus).toEqual([{ eventId: "overshoot", creditedSeconds: 5 }]);
    expect(workflow).toContain("internal.split_candidate_manifest");
    expect(workflow).toContain("'blockManifest', block_manifest");
    expect(workflow).toContain("'surplusManifest', surplus_manifest");
    expect(workflow).not.toContain(
      "accepted_seconds - surplus_candidate_seconds",
    );
  });

  it("aggregates manifest credits globally and binds each event to its video", () => {
    const recompute = workflow.slice(
      workflow.indexOf(
        "function internal.recompute_recorded_progress_unchecked",
      ),
      workflow.indexOf(
        "function internal.recompute_recorded_progress(",
        workflow.indexOf(
          "function internal.recompute_recorded_progress_unchecked",
        ) + 1,
      ),
    );
    expect(recompute).toContain(
      "sum((entry.value ->> 'creditedSeconds')::integer)",
    );
    expect(recompute).toContain(
      "entry.credited_seconds <= event.candidate_seconds",
    );
    expect(recompute).toContain("source_session.lesson_video_version_id =");
    expect(recompute).toContain("confirmed_valid_seconds = 0");
  });

  it("recomputes before issue and uses immutable requirement-met time", () => {
    expect(workflow).toContain(
      "internal.recompute_recorded_progress_unchecked(enrollment_row.id)",
    );
    expect(workflow).toContain(
      "'reason', 'recorded_progress_drift_recomputed'",
    );
    expect(workflow).toContain(
      "create or replace function internal.recorded_requirement_met_at",
    );
    const completion = workflow.slice(
      workflow.indexOf("function internal.read_completion_render_context"),
      workflow.indexOf("function public.finalize_completion_and_certificate"),
    );
    const requirementTime = workflow.slice(
      workflow.indexOf("function internal.recorded_requirement_met_at"),
      workflow.indexOf(
        "function internal.start_quiz_attempt",
        workflow.indexOf("function internal.recorded_requirement_met_at"),
      ),
    );
    expect(requirementTime).toContain("block.confirmed_at");
    expect(completion).not.toContain("select summary.updated_at");
  });

  it("evaluates completion when watch time is the final prerequisite", () => {
    const recomputeJob = worker.slice(
      worker.indexOf('job.job_type === "recorded_progress_recompute"'),
      worker.indexOf('job.job_type === "quarantine_scan"'),
    );
    expect(recomputeJob).toContain('"recompute_recorded_progress"');
    expect(recomputeJob).toContain('"enqueue_completion_evaluation"');
    expect(workflow).toContain("'recorded-progress-recompute:'");
    expect(workflow).toContain(
      "'completion-evaluate:' || target_enrollment::text",
    );
    const enqueue = workflow.slice(
      workflow.indexOf("function internal.enqueue_completion_evaluation"),
      workflow.indexOf("function public.enqueue_completion_evaluation"),
    );
    expect(enqueue).toContain("enrollment_status <> 'active'");
    expect(enqueue).toContain("from public.certificates certificate");
    expect(enqueue).toContain("return false");
  });

  it("replays the same presence confirmation without double credit", () => {
    const confirmation = workflow.slice(
      workflow.indexOf("function internal.confirm_presence_challenge"),
      workflow.indexOf("function public.confirm_presence_challenge"),
    );
    expect(confirmation).toContain(
      "block.confirmation_idempotency_key = idempotency",
    );
    expect(confirmation).toContain("'replayed', true");
    expect(confirmation).toContain(
      "allocation.scope_type in ('recorded', 'whole_order')",
    );
    expect(confirmation).toContain("PRESENCE_CHALLENGE_ENTITLEMENT_REVOKED");
    expect(schema).toContain(
      "confirmation_idempotency_key uuid not null unique",
    );
  });

  it("freezes pending confirmation and recomputes the formal refund snapshot", () => {
    const refund = workflow.slice(
      workflow.indexOf("function internal.request_refund"),
      workflow.indexOf("function public.request_refund"),
    );
    expect(refund).toContain(
      "internal.recompute_recorded_progress_unchecked(target_enrollment)",
    );
    expect(refund).toContain("for update;");
    expect(refund).toContain(
      "recorded_usage_verified :=\n      coalesce((recompute_result ->> 'valid')::boolean, false)",
    );
    expect(refund).toContain("else 0");
    expect(refund).toContain("set timed_out_at = clock_timestamp()");
    expect(refund).not.toContain(
      "coalesce(summary.confirmed_valid_seconds, 0)",
    );
  });
});
