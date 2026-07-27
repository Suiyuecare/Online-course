import { z } from "zod";

export const encryptedZoomRegistrantSecretSchema = z.object({
  version: z.literal(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  tag: z.string().min(1),
});

export const zoomRegistrantReceiptSchema = z.object({
  registrantId: z.string().min(1),
  encryptedRegistrantToken: encryptedZoomRegistrantSecretSchema,
});

export type ZoomRegistrantReceipt = z.infer<typeof zoomRegistrantReceiptSchema>;

type ProviderReceipt = {
  providerReference: string | null;
  responsePayload: unknown;
};

export async function resolveRegistrantReceiptWriteFailure(input: {
  candidate: ZoomRegistrantReceipt;
  readAuthoritative: () => Promise<ProviderReceipt | null>;
}): Promise<
  | { outcome: "authoritative"; receipt: ZoomRegistrantReceipt }
  | {
      outcome: "reconciliation_required";
      reason:
        | "read_unknown"
        | "receipt_absent"
        | "receipt_invalid"
        | "competing";
    }
> {
  let authoritative: ProviderReceipt | null;
  try {
    authoritative = await input.readAuthoritative();
  } catch {
    return { outcome: "reconciliation_required", reason: "read_unknown" };
  }
  if (authoritative === null) {
    // A null read does not prove that the failed receipt RPC rolled back.
    // The staged reconciliation job owns the provider-side decision.
    return { outcome: "reconciliation_required", reason: "receipt_absent" };
  }
  const parsed = zoomRegistrantReceiptSchema.safeParse(
    authoritative.responsePayload,
  );
  if (
    !parsed.success ||
    authoritative.providerReference !== parsed.data.registrantId
  ) {
    return { outcome: "reconciliation_required", reason: "receipt_invalid" };
  }
  if (parsed.data.registrantId !== input.candidate.registrantId) {
    return { outcome: "reconciliation_required", reason: "competing" };
  }
  return { outcome: "authoritative", receipt: parsed.data };
}

export async function executeZoomRegistrantReconciliation(input: {
  jobId: string;
  workerId: string;
  leaseGeneration: number;
  readContext: (lease: {
    jobId: string;
    workerId: string;
    leaseGeneration: number;
  }) => Promise<{
    action: "preserve" | "revoke";
    meetingNumber: string;
    providerRegistrantId: string;
  }>;
  revokeRegistrant: (
    meetingNumber: string,
    providerRegistrantId: string,
  ) => Promise<void>;
  complete: (completion: {
    jobId: string;
    workerId: string;
    leaseGeneration: number;
    providerRevoked: boolean;
    preservedAuthoritative: boolean;
  }) => Promise<void>;
}): Promise<"already_finalized"> {
  const lease = {
    jobId: input.jobId,
    workerId: input.workerId,
    leaseGeneration: input.leaseGeneration,
  };
  const context = await input.readContext(lease);
  const preserve = context.action === "preserve";
  if (!preserve) {
    await input.revokeRegistrant(
      context.meetingNumber,
      context.providerRegistrantId,
    );
  }
  await input.complete({
    ...lease,
    providerRevoked: !preserve,
    preservedAuthoritative: preserve,
  });
  return "already_finalized";
}

export async function executeZoomOrphanCleanup(input: {
  jobId: string;
  workerId: string;
  leaseGeneration: number;
  readContext: (lease: {
    jobId: string;
    workerId: string;
    leaseGeneration: number;
  }) => Promise<{
    providerMeetingNumber: string;
    authoritativeReceiptReference: string | null;
  }>;
  deleteMeeting: (providerMeetingNumber: string) => Promise<void>;
  complete: (completion: {
    jobId: string;
    workerId: string;
    leaseGeneration: number;
    providerDeleteConfirmed: boolean;
    preservedAuthoritative: boolean;
  }) => Promise<void>;
}): Promise<"already_finalized"> {
  const lease = {
    jobId: input.jobId,
    workerId: input.workerId,
    leaseGeneration: input.leaseGeneration,
  };
  const context = await input.readContext(lease);
  const preserve =
    context.authoritativeReceiptReference === context.providerMeetingNumber;
  if (!preserve) {
    await input.deleteMeeting(context.providerMeetingNumber);
  }
  await input.complete({
    ...lease,
    providerDeleteConfirmed: !preserve,
    preservedAuthoritative: preserve,
  });
  return "already_finalized";
}
