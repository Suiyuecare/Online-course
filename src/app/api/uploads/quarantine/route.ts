import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  assertSameOrigin,
  enforceRateLimit,
} from "@/app/api/_shared/route-helpers";
import {
  quarantineRequestBodyLimitBytes,
  readMultipartFormDataWithLimit,
} from "@/domain/request-body";
import { resolveActivePerson } from "@/infrastructure/security/accreditation-identity";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

const purposeSchema = z.enum([
  "payment_proof",
  "identity_correction",
  "course_material",
  "organization_roster",
  "bank_statement",
]);
const allowedMime = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);

function magicMatches(bytes: Uint8Array, mime: string) {
  const prefix = Buffer.from(bytes.subarray(0, 8));
  if (mime === "image/jpeg")
    return prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff;
  if (mime === "image/png")
    return prefix.toString("hex") === "89504e470d0a1a0a";
  if (mime === "application/pdf")
    return prefix.subarray(0, 5).toString("ascii") === "%PDF-";
  if (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  )
    return prefix.subarray(0, 2).toString("ascii") === "PK";
  if (mime === "text/csv")
    return !prefix.includes(0) && !prefix.toString("ascii").startsWith("MZ");
  return false;
}

export async function POST(request: Request) {
  let uploadedPath: string | null = null;
  try {
    assertSameOrigin(request);
    await enforceRateLimit(request);
    const { supabase, user } = await requireUser();
    const form = await readMultipartFormDataWithLimit(
      request,
      quarantineRequestBodyLimitBytes,
    );
    const purpose = purposeSchema.parse(form.get("purpose"));
    let personId: string;
    try {
      personId = await resolveActivePerson(supabase);
    } catch {
      const { data, error } = await serviceSupabase().rpc(
        "resolve_restricted_upload_person",
        { p_auth_user_id: user.id, p_purpose: purpose },
      );
      personId = z.uuid().parse(data);
      if (error) throw new Error("RESTRICTED_UPLOAD_REJECTED");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("FILE_REQUIRED");
    if (
      !allowedMime.has(file.type) ||
      file.size <= 0 ||
      file.size > 10_000_000
    ) {
      throw new Error("UPLOAD_TYPE_OR_SIZE_REJECTED");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!magicMatches(bytes, file.type)) {
      throw new Error("UPLOAD_MAGIC_MISMATCH");
    }
    const uploadId = randomUUID();
    uploadedPath = `${personId}/${purpose}/${uploadId}`;
    const service = serviceSupabase();
    const { error: uploadError } = await service.storage
      .from("quarantine")
      .upload(uploadedPath, bytes, {
        contentType: "application/octet-stream",
        cacheControl: "0",
        upsert: false,
      });
    if (uploadError) throw new Error("QUARANTINE_STORAGE_FAILED");
    const { error } = await service.rpc("register_quarantine_upload", {
      p_upload_id: uploadId,
      p_owner_id: personId,
      p_purpose: purpose,
      p_object_path: uploadedPath,
      p_declared_mime: file.type,
      p_byte_size: file.size,
      p_sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    if (error) {
      await service.storage.from("quarantine").remove([uploadedPath]);
      throw new Error("QUARANTINE_REGISTER_FAILED");
    }
    return Response.json(
      { ok: true, data: { uploadId, status: "quarantined" } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : "UPLOAD_REJECTED";
    return Response.json(
      {
        ok: false,
        error,
      },
      {
        status: error === "REQUEST_BODY_TOO_LARGE" ? 413 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}

export async function GET(request: Request) {
  try {
    await enforceRateLimit(request);
    const uploadId = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("uploadId"));
    const { supabase, user } = await requireUser();
    let personId: string;
    try {
      personId = await resolveActivePerson(supabase);
    } catch {
      const { data, error } = await serviceSupabase().rpc(
        "resolve_restricted_upload_person",
        {
          p_auth_user_id: user.id,
          p_purpose: "identity_correction",
        },
      );
      personId = z.uuid().parse(data);
      if (error) throw new Error("RESTRICTED_UPLOAD_REJECTED");
    }
    const { data, error } = await serviceSupabase()
      .from("upload_quarantine")
      .select("id,status,detected_mime,created_at,scanned_at")
      .eq("id", uploadId)
      .eq("owner_person_id", personId)
      .maybeSingle();
    if (error || !data) throw new Error("UPLOAD_NOT_FOUND");
    return Response.json(
      { ok: true, data },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, error: "UPLOAD_NOT_FOUND" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
}
