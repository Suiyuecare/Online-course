import { describe, expect, it } from "vitest";
import {
  settleDurableJobLease,
  type DurableJobLease,
  type DurableJobFinishInput,
} from "@/application/durable-job-worker";
import {
  executeZoomOrphanCleanup,
  executeZoomRegistrantReconciliation,
  resolveRegistrantReceiptWriteFailure,
  type ZoomRegistrantReceipt,
} from "@/application/zoom-provider-reconciliation";

const candidate: ZoomRegistrantReceipt = {
  registrantId: "registrant-candidate",
  encryptedRegistrantToken: {
    version: 1,
    iv: "iv",
    ciphertext: "ciphertext",
    tag: "tag",
  },
};

describe("Zoom registrant receipt races", () => {
  it("keeps an authoritative-null read unknown and lets a late receipt win the fence", async () => {
    const state: {
      receipt: ZoomRegistrantReceipt | null;
      reconciliation: "staged" | "preserved" | "revoked";
      revoked: boolean;
    } = {
      receipt: null,
      reconciliation: "staged",
      revoked: false,
    };

    const routeResolution = await resolveRegistrantReceiptWriteFailure({
      candidate,
      readAuthoritative: async () => null,
    });
    expect(routeResolution).toEqual({
      outcome: "reconciliation_required",
      reason: "receipt_absent",
    });
    expect(state.revoked).toBe(false);

    // The original receipt transaction commits after its HTTP response was
    // lost. The durable worker observes it under the same DB fence.
    state.receipt = candidate;
    await executeZoomRegistrantReconciliation({
      jobId: "job",
      workerId: "worker",
      leaseGeneration: 1,
      readContext: async () => ({
        action:
          state.receipt?.registrantId === candidate.registrantId
            ? "preserve"
            : "revoke",
        meetingNumber: "123456789",
        providerRegistrantId: candidate.registrantId,
      }),
      revokeRegistrant: async () => {
        state.revoked = true;
      },
      complete: async ({ preservedAuthoritative }) => {
        if (!preservedAuthoritative || !state.receipt) {
          throw new Error("authoritative receipt required");
        }
        state.reconciliation = "preserved";
      },
    });

    expect(state).toMatchObject({
      reconciliation: "preserved",
      revoked: false,
    });
  });

  it("seals an absent receipt before revoke and rejects every late receipt", async () => {
    const state: {
      fence: "open" | "sealed";
      reconciliation: "staged" | "revoked";
      providerRegistrantActive: boolean;
      receipt: ZoomRegistrantReceipt | null;
    } = {
      fence: "open",
      reconciliation: "staged",
      providerRegistrantActive: true,
      receipt: null,
    };

    await executeZoomRegistrantReconciliation({
      jobId: "job",
      workerId: "worker",
      leaseGeneration: 1,
      readContext: async () => {
        if (state.receipt === null) state.fence = "sealed";
        return {
          action: "revoke",
          meetingNumber: "123456789",
          providerRegistrantId: candidate.registrantId,
        };
      },
      revokeRegistrant: async () => {
        state.providerRegistrantActive = false;
      },
      complete: async ({ providerRevoked }) => {
        if (!providerRevoked || state.fence !== "sealed") {
          throw new Error("receipt absence was not fenced");
        }
        state.reconciliation = "revoked";
      },
    });

    const lateReceiptWrite = () => {
      if (state.fence === "sealed") {
        throw new Error("ZOOM_REGISTRANT_RECEIPT_FENCED_REVOKE");
      }
      state.receipt = candidate;
    };
    expect(lateReceiptWrite).toThrow("ZOOM_REGISTRANT_RECEIPT_FENCED_REVOKE");
    expect(state).toMatchObject({
      reconciliation: "revoked",
      providerRegistrantActive: false,
      receipt: null,
    });
  });

  it("never treats a competing receipt as permission to return the candidate token", async () => {
    const result = await resolveRegistrantReceiptWriteFailure({
      candidate,
      readAuthoritative: async () => ({
        providerReference: "registrant-authoritative",
        responsePayload: {
          ...candidate,
          registrantId: "registrant-authoritative",
        },
      }),
    });
    expect(result).toEqual({
      outcome: "reconciliation_required",
      reason: "competing",
    });
    expect("receipt" in result).toBe(false);
  });
});

describe("durable job generation races", () => {
  it("rejects a stale same-owner ABA completion after an expired lease is reclaimed", async () => {
    const job: DurableJobLease = {
      id: "job",
      job_type: "example",
      business_key: "example:job",
      payload: {},
      lease_generation: 1,
    };
    const state = {
      status: "leased" as "leased" | "completed",
      owner: "same-worker",
      generation: 1,
      completedGeneration: null as number | null,
    };
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const finish = async (input: DurableJobFinishInput) => {
      if (
        state.status !== "leased" ||
        state.owner !== input.workerId ||
        state.generation !== input.leaseGeneration
      ) {
        throw new Error("JOB_LEASE_GENERATION_MISMATCH");
      }
      state.status = "completed";
      state.completedGeneration = input.leaseGeneration;
      return "completed";
    };

    const staleWorker = settleDurableJobLease({
      job,
      workerId: "same-worker",
      process: async () => firstCanFinish,
      finish,
    });

    // The lease expires and is atomically reclaimed, even by an identical
    // worker identity. Only the incremented generation distinguishes it.
    state.generation += 1;
    const reclaimedJob = { ...job, lease_generation: state.generation };
    const currentWorker = await settleDurableJobLease({
      job: reclaimedJob,
      workerId: "same-worker",
      process: async () => undefined,
      finish,
    });
    releaseFirst();
    const staleResult = await staleWorker;

    expect(currentWorker).toEqual({
      status: "completed",
      finishFailed: false,
    });
    expect(staleResult).toEqual({
      status: "lease_finish_failed",
      finishFailed: true,
    });
    expect(state.completedGeneration).toBe(2);
  });

  it("safely finishes orphan cleanup after DELETE succeeded and the first worker crashed", async () => {
    const state = {
      providerMeetingExists: true,
      status: "leased" as "leased" | "completed",
      owner: "worker-a",
      generation: 1,
      deleteCalls: 0,
    };
    const run = (workerId: string, leaseGeneration: number, crash: boolean) =>
      executeZoomOrphanCleanup({
        jobId: "orphan-job",
        workerId,
        leaseGeneration,
        readContext: async ({
          workerId: owner,
          leaseGeneration: generation,
        }) => {
          if (
            state.status !== "leased" ||
            state.owner !== owner ||
            state.generation !== generation
          ) {
            throw new Error("ZOOM_ORPHAN_CLEANUP_LEASE_GENERATION_MISMATCH");
          }
          return {
            providerMeetingNumber: "123456789",
            authoritativeReceiptReference: null,
          };
        },
        deleteMeeting: async () => {
          state.deleteCalls += 1;
          // First call is 204; after the crash, replay observes 404. Both are
          // successful deletion outcomes.
          state.providerMeetingExists = false;
        },
        complete: async ({ workerId: owner, leaseGeneration: generation }) => {
          if (crash) throw new Error("simulated process crash");
          if (
            state.status !== "leased" ||
            state.owner !== owner ||
            state.generation !== generation
          ) {
            throw new Error("ZOOM_ORPHAN_CLEANUP_LEASE_GENERATION_MISMATCH");
          }
          state.status = "completed";
        },
      });

    await expect(run("worker-a", 1, true)).rejects.toThrow(
      "simulated process crash",
    );
    expect(state.providerMeetingExists).toBe(false);
    expect(state.status).toBe("leased");

    state.owner = "worker-b";
    state.generation = 2;
    await expect(run("worker-b", 2, false)).resolves.toBe("already_finalized");
    expect(state.status).toBe("completed");
    expect(state.deleteCalls).toBe(2);
  });
});
