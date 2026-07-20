import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isPlatformAdmin,
} from "@/lib/supabase/server";

const schema = z.object({
  lessonId: z.string().uuid(),
  filename: z.string().min(1).max(240),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(200 * 1024 * 1024),
  durationSeconds: z
    .number()
    .int()
    .positive()
    .max(60 * 60),
});

export async function POST(request: Request) {
  if (!(await isPlatformAdmin()))
    return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "INVALID_UPLOAD",
        message: "第一階段直接上傳僅支援 200MB 以下檔案。",
      },
      { status: 400 },
    );
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  const admin = createSupabaseAdminClient();
  if (!accountId || !apiToken || !admin)
    return NextResponse.json(
      { error: "STREAM_NOT_CONFIGURED" },
      { status: 503 },
    );
  const creator = await getAuthenticatedUserId();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/direct_upload`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        maxDurationSeconds: Math.max(60, parsed.data.durationSeconds + 60),
        requireSignedURLs: true,
        creator,
        meta: {
          lessonId: parsed.data.lessonId,
          filename: parsed.data.filename,
        },
      }),
      cache: "no-store",
    },
  );
  const cloudflare = await response.json();
  if (
    !response.ok ||
    !cloudflare.success ||
    !cloudflare.result?.uploadURL ||
    !cloudflare.result?.uid
  )
    return NextResponse.json(
      { error: "DIRECT_UPLOAD_FAILED" },
      { status: 502 },
    );
  const { data: latest } = await admin
    .from("video_assets")
    .select("version")
    .eq("lesson_id", parsed.data.lessonId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await admin
    .from("video_assets")
    .insert({
      lesson_id: parsed.data.lessonId,
      version: (latest?.version ?? 0) + 1,
      stream_uid: cloudflare.result.uid,
      status: "uploading",
      original_filename: parsed.data.filename,
      file_size_bytes: parsed.data.sizeBytes,
      duration_seconds: parsed.data.durationSeconds,
      created_by: creator,
    });
  if (error)
    return NextResponse.json({ error: "VIDEO_RECORD_FAILED" }, { status: 500 });
  return NextResponse.json({
    uploadURL: cloudflare.result.uploadURL,
    uid: cloudflare.result.uid,
  });
}
