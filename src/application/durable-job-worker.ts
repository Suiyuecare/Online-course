export type DurableJobLease = {
  id: string;
  job_type: string;
  business_key: string;
  payload: Record<string, unknown>;
  lease_generation: number;
};

export type DurableJobProcessResult = "already_finalized" | void;

export type DurableJobFinishInput = {
  jobId: string;
  workerId: string;
  leaseGeneration: number;
  succeeded: boolean;
  failureMessage: string | null;
};

export async function settleDurableJobLease(input: {
  job: DurableJobLease;
  workerId: string;
  process: (
    job: DurableJobLease,
    workerId: string,
  ) => Promise<DurableJobProcessResult>;
  finish: (finish: DurableJobFinishInput) => Promise<string>;
}): Promise<{ status: string; finishFailed: boolean }> {
  let failure: string | null = null;
  let finalizedInsideJob = false;
  try {
    finalizedInsideJob =
      (await input.process(input.job, input.workerId)) === "already_finalized";
  } catch (caught) {
    failure = caught instanceof Error ? caught.message : "WORKER_FAILURE";
  }

  if (finalizedInsideJob && failure === null) {
    return { status: "completed_in_job", finishFailed: false };
  }

  try {
    const status = await input.finish({
      jobId: input.job.id,
      workerId: input.workerId,
      leaseGeneration: input.job.lease_generation,
      succeeded: failure === null,
      failureMessage: failure,
    });
    return { status, finishFailed: false };
  } catch {
    return { status: "lease_finish_failed", finishFailed: true };
  }
}
