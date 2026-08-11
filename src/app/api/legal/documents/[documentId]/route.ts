import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readEffectiveLegalCenter } from "@/application/legal-center";
import { serviceSupabase } from "@/infrastructure/supabase/server";

function notFound() {
  return NextResponse.json(
    { ok: false },
    {
      status: 404,
      headers: {
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await context.params;
  if (!z.uuid().safeParse(documentId).success) {
    return notFound();
  }
  try {
    const supabase = serviceSupabase();
    const effectiveDocument = (await readEffectiveLegalCenter(supabase)).find(
      (candidate) => candidate.documentId === documentId,
    );
    if (!effectiveDocument) {
      return notFound();
    }
    const { data: document, error } = await supabase
      .from("legal_documents")
      .select(
        "kind,revision,object_path,content_sha256,approved_by_legal,effective_at,superseded_at",
      )
      .eq("id", documentId)
      .maybeSingle();
    const now = Date.now();
    if (
      error ||
      !document?.approved_by_legal ||
      document.kind !== effectiveDocument.kind ||
      document.revision !== effectiveDocument.revision ||
      document.content_sha256 !== effectiveDocument.contentSha256 ||
      !document.effective_at ||
      Date.parse(document.effective_at) > now ||
      (document.superseded_at && Date.parse(document.superseded_at) <= now)
    ) {
      return notFound();
    }
    if (document.object_path.startsWith("inline://platform-prerequisite/")) {
      const changeId = document.object_path.slice(
        "inline://platform-prerequisite/".length,
      );
      if (!z.uuid().safeParse(changeId).success) {
        throw new Error("LEGAL_DOCUMENT_REFERENCE_INVALID");
      }
      const { data: source, error: sourceError } = await supabase
        .from("platform_prerequisite_changes")
        .select("specification")
        .eq("id", changeId)
        .eq("materialized_target_id", documentId)
        .eq("kind", "legal_document_revision")
        .eq("status", "approved")
        .maybeSingle();
      const content =
        source?.specification &&
        typeof source.specification === "object" &&
        !Array.isArray(source.specification) &&
        typeof source.specification.content === "string"
          ? source.specification.content
          : null;
      if (sourceError || !content) {
        throw new Error("LEGAL_DOCUMENT_SOURCE_UNAVAILABLE");
      }
      const bytes = Buffer.from(content, "utf8");
      if (
        createHash("sha256").update(bytes).digest("hex") !==
        document.content_sha256
      ) {
        throw new Error("LEGAL_DOCUMENT_INTEGRITY_FAILED");
      }
      return new NextResponse(bytes, {
        headers: {
          "cache-control": "private, no-store",
          "content-disposition": `attachment; filename="suiyue-${document.kind}-v${document.revision}.txt"`,
          "content-type": "text/plain; charset=utf-8",
          etag: `"${document.content_sha256}"`,
          "x-legal-document-sha256": document.content_sha256,
          "x-content-type-options": "nosniff",
        },
      });
    }
    const { data, error: downloadError } = await supabase.storage
      .from("legal-documents")
      .download(document.object_path);
    if (downloadError) throw new Error("LEGAL_DOCUMENT_STORAGE_UNAVAILABLE");
    const bytes = Buffer.from(await data.arrayBuffer());
    if (
      createHash("sha256").update(bytes).digest("hex") !==
      document.content_sha256
    ) {
      throw new Error("LEGAL_DOCUMENT_INTEGRITY_FAILED");
    }
    return new NextResponse(bytes, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="suiyue-${document.kind}-v${document.revision}.pdf"`,
        "content-type": "application/pdf",
        etag: `"${document.content_sha256}"`,
        "x-legal-document-sha256": document.content_sha256,
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "LEGAL_DOCUMENT_UNAVAILABLE" },
      {
        status: 503,
        headers: {
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }
}
