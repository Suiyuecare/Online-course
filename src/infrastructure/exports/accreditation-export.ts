import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  decryptWithDataKey,
  encryptWithDataKey,
  kmsAdapter,
} from "@/infrastructure/adapters/kms";
import {
  buildAccreditationWorkbook,
  type AccreditationExportRow,
} from "@/infrastructure/exports/accreditation-workbook";
import { readVerifiedAccreditationIdentity } from "@/infrastructure/security/accreditation-identity";
import { serviceSupabase } from "@/infrastructure/supabase/server";

const envelopeSchema = z.object({
  keyVersion: z.string().min(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  tag: z.string().min(1),
});

export async function generateAccreditationExport(input: {
  batchId: string;
  actorId: string;
  rowCount: number;
  courseVersionId: string;
  accreditationRevisionId: string;
  liveSessionId?: string | null;
  templateVersion: string;
}) {
  const service = serviceSupabase();
  const [
    { data: items, error: itemError },
    { data: course },
    { data: revision },
  ] = await Promise.all([
    service
      .from("accreditation_submission_items")
      .select("enrollments!inner(person_id)")
      .eq("batch_id", input.batchId)
      .eq("status", "included"),
    service
      .from("course_versions")
      .select("title")
      .eq("id", input.courseVersionId)
      .single(),
    service
      .from("accreditation_decision_revisions")
      .select("approval_reference")
      .eq("id", input.accreditationRevisionId)
      .single(),
  ]);
  if (itemError || !items || !course || !revision) {
    throw new Error("EXPORT_SOURCE_UNAVAILABLE");
  }
  const personIds = items.map(
    (item) => (item.enrollments as unknown as { person_id: string }).person_id,
  );
  if (personIds.length !== input.rowCount) {
    throw new Error("EXPORT_ROW_COUNT_CHANGED");
  }
  const rows: AccreditationExportRow[] = [];
  for (const personId of personIds) {
    rows.push(await readVerifiedAccreditationIdentity(personId));
  }
  const workbook = await buildAccreditationWorkbook({
    rows,
    courseTitle: course.title,
    accreditationReference: revision.approval_reference ?? "申請中",
    templateVersion: input.templateVersion,
  });
  const context = `accreditation-export:${input.batchId}`;
  const dataKey = randomBytes(32);
  const encryptedArtifact = encryptWithDataKey(
    workbook.toString("base64url"),
    dataKey,
    context,
  );
  const wrappedDataKey = await kmsAdapter().wrapDataKey(context, dataKey);
  const objectPath = `${input.batchId}/${randomUUID()}.encrypted.json`;
  const { error: uploadError } = await service.storage
    .from("accreditation-exports")
    .upload(
      objectPath,
      Buffer.from(JSON.stringify({ version: 1, encryptedArtifact }), "utf8"),
      {
        contentType: "application/json",
        cacheControl: "0",
        upsert: false,
      },
    );
  if (uploadError) throw new Error("EXPORT_STORAGE_FAILED");
  const capability = randomBytes(32).toString("base64url");
  const workbookHash = createHash("sha256").update(workbook).digest("hex");
  const { data, error } = await service.rpc("record_accreditation_export", {
    p_batch_id: input.batchId,
    p_actor_id: input.actorId,
    p_object_path: objectPath,
    p_sha256: workbookHash,
    p_envelope_key: wrappedDataKey,
    p_row_count: rows.length,
    p_filter: {
      courseVersionId: input.courseVersionId,
      accreditationRevisionId: input.accreditationRevisionId,
      liveSessionId: input.liveSessionId ?? null,
      templateVersion: input.templateVersion,
    },
    p_capability_hash: createHash("sha256").update(capability).digest("hex"),
  });
  if (error || !data) {
    await service.storage.from("accreditation-exports").remove([objectPath]);
    throw new Error("EXPORT_RECORD_FAILED");
  }
  return {
    exportId: (data as unknown as { exportId: string }).exportId,
    capability,
    expiresAfterSeconds: 600,
  };
}

export async function downloadAccreditationExport(input: {
  actorId: string;
  token: string;
}) {
  const service = serviceSupabase();
  const { data, error } = await service.rpc(
    "consume_export_download_capability",
    {
      p_actor_id: input.actorId,
      p_token_hash: createHash("sha256").update(input.token).digest("hex"),
    },
  );
  if (error || !data) throw new Error("EXPORT_CAPABILITY_INVALID");
  const context = z
    .object({
      exportId: z.uuid(),
      batchId: z.uuid(),
      objectPath: z.string().min(1),
      objectSha256: z.string().regex(/^[a-f0-9]{64}$/),
      envelopeKey: envelopeSchema,
    })
    .parse(data);
  const { data: object, error: objectError } = await service.storage
    .from("accreditation-exports")
    .download(context.objectPath);
  if (objectError) throw new Error("EXPORT_OBJECT_UNAVAILABLE");
  const encrypted = z
    .object({ version: z.literal(1), encryptedArtifact: envelopeSchema })
    .parse(JSON.parse(await object.text()));
  const dataKey = await kmsAdapter().unwrapDataKey(
    `accreditation-export:${context.batchId}`,
    context.envelopeKey,
  );
  const bytes = Buffer.from(
    decryptWithDataKey(
      encrypted.encryptedArtifact,
      dataKey,
      `accreditation-export:${context.batchId}`,
    ),
    "base64url",
  );
  if (
    createHash("sha256").update(bytes).digest("hex") !== context.objectSha256
  ) {
    throw new Error("EXPORT_INTEGRITY_FAILED");
  }
  return {
    bytes,
    fileName: `suiyue-accreditation-${context.exportId}.xlsx`,
  };
}
