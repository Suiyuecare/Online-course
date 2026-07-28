import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260724011632_live_hybrid.sql",
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
const apiHardening = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260724220000_api_security_hardening.sql",
  ),
  "utf8",
);

type ProviderPresenceEvent = {
  kind: "joined" | "left";
  participantUuid: string;
  occurredAtMinute: number;
};

function activeParticipantsAt(
  events: ProviderPresenceEvent[],
  minute: number,
): string[] {
  return events
    .filter(
      (event) =>
        event.kind === "joined" &&
        event.occurredAtMinute <= minute &&
        !events.some(
          (candidate) =>
            candidate.kind === "left" &&
            candidate.participantUuid === event.participantUuid &&
            candidate.occurredAtMinute >= event.occurredAtMinute &&
            candidate.occurredAtMinute <= minute,
        ),
    )
    .map((event) => event.participantUuid);
}

describe("live join lease provider correlation", () => {
  it("uses a different Zoom customer key for every lease", () => {
    expect(schema).toContain("provider_customer_key text not null unique");
    expect(schema).toContain(
      "check (provider_customer_key ~ '^[A-Za-z0-9_-]{32}$')",
    );
    expect(workflow).toContain(
      "'customerKey', existing_lease.provider_customer_key",
    );
    expect(workflow).toContain("'customerKey', provider_customer_key");
    expect(workflow).not.toContain("'customerKey', booking_row.customer_key");
  });

  it("does not let an old participant-left event release another lease", () => {
    expect(workflow).toContain(
      "lease.provider_customer_key = participant ->> 'customer_key'",
    );
    expect(workflow).toContain(
      "lease.zoom_participant_uuid =\n            participant ->> 'participant_uuid'",
    );
    expect(workflow).toContain(
      "joined.customer_key = lease.provider_customer_key",
    );
    expect(workflow).toContain(
      "joined.participant_uuid = lease.zoom_participant_uuid",
    );
  });

  it("keeps a joined participant fenced after credential expiry", () => {
    expect(workflow).toContain(
      "existing_lease.zoom_participant_uuid is not null",
    );
    expect(workflow).toContain(
      "existing_lease.old_participant_removed_at is null",
    );
    expect(workflow).toContain("existing_lease.zoom_participant_uuid is null");
    expect(workflow).toContain("existing_lease.credential_expires_at > now()");
    expect(workflow).not.toContain("when submitted_reason = 'sdk_join_failed'");
  });

  it("returns the last heartbeat sequence on fresh and replayed issuance", () => {
    expect(workflow).toContain(
      "'lastHeartbeatSequence', existing_lease.last_heartbeat_sequence",
    );
    expect(workflow).toContain("'lastHeartbeatSequence', 0");
  });

  it("supports a time-ordered rejoin while rejecting overlapping UUIDs", () => {
    const reorderedDelivery: ProviderPresenceEvent[] = [
      { kind: "joined", participantUuid: "old", occurredAtMinute: 0 },
      { kind: "joined", participantUuid: "new", occurredAtMinute: 35.1 },
      { kind: "left", participantUuid: "old", occurredAtMinute: 35 },
    ];
    expect(activeParticipantsAt(reorderedDelivery, 34)).toEqual(["old"]);
    expect(activeParticipantsAt(reorderedDelivery, 36)).toEqual(["new"]);
    expect(
      activeParticipantsAt(
        [
          { kind: "joined", participantUuid: "old", occurredAtMinute: 0 },
          { kind: "joined", participantUuid: "new", occurredAtMinute: 35 },
          { kind: "left", participantUuid: "old", occurredAtMinute: 36 },
        ],
        35.5,
      ),
    ).toHaveLength(2);

    expect(workflow).toContain(
      "Zoom assigns a new participant UUID after a legitimate rejoin.",
    );
    expect(workflow).toContain(
      "Webhooks can arrive as new-joined before old-left.",
    );
    expect(workflow).toContain("count(distinct active_join.participant_uuid)");
  });

  it("keeps a joined learner attendance-active beyond the 30-minute credential", () => {
    const longClass: ProviderPresenceEvent[] = [
      { kind: "joined", participantUuid: "learner", occurredAtMinute: 0 },
      { kind: "left", participantUuid: "learner", occurredAtMinute: 125 },
    ];
    expect(activeParticipantsAt(longClass, 20)).toEqual(["learner"]);
    expect(activeParticipantsAt(longClass, 40)).toEqual(["learner"]);
    expect(activeParticipantsAt(longClass, 120)).toEqual(["learner"]);
    expect(activeParticipantsAt(longClass, 126)).toEqual([]);

    const expiryBlock = worker.slice(
      worker.indexOf('job.job_type === "live_join_lease_expiry"'),
      worker.indexOf('job.job_type === "live_session_change"'),
    );
    expect(expiryBlock).toContain('"expire_live_join_credential"');
    expect(expiryBlock).not.toContain('"abort_live_join_lease"');
    expect(workflow).toContain(
      "lease.provider_status in ('registered', 'revoked')",
    );
    expect(workflow).toContain(
      "clock_timestamp() <= session_row.ends_at + interval '30 minutes'",
    );
    expect(workflow).toContain(
      "'live-join-attendance-close:' || target_lease::text",
    );
  });

  it("leases only evidence and safety jobs during an emergency shutdown", () => {
    const allowlistBlock = worker.slice(
      worker.indexOf("const emergencyAllowedJobTypes"),
      worker.indexOf("const excludedJobTypes"),
    );
    expect(
      [...allowlistBlock.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]),
    ).toEqual([
      "provider_event_process",
      "live_join_lease_expiry",
      "zoom_registrant_reconcile",
      "zoom_orphan_cleanup",
      "quarantine_scan",
      "profile_media_purge",
    ]);

    const hardenedLeaseStart = apiHardening.lastIndexOf(
      "create or replace function internal.lease_due_jobs_filtered",
    );
    const maintenanceLeaseBlock = apiHardening.slice(
      hardenedLeaseStart,
      apiHardening.indexOf(
        "create or replace function internal.finish_durable_job",
        hardenedLeaseStart,
      ),
    );
    expect(maintenanceLeaseBlock).toContain(
      "when internal.setting_is_true('maintenance_mode')",
    );
    expect(maintenanceLeaseBlock).toContain("'provider_event_process'");
    expect(maintenanceLeaseBlock).toContain("'live_join_lease_expiry'");
    expect(maintenanceLeaseBlock).toContain("'zoom_registrant_reconcile'");
    expect(maintenanceLeaseBlock).toContain("'zoom_orphan_cleanup'");
    expect(maintenanceLeaseBlock).toContain("'quarantine_scan'");
    expect(maintenanceLeaseBlock).not.toContain("'identity_recovery_complete'");
  });
});
