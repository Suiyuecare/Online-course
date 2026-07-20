import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
} from "@/lib/supabase/server";

const schema = z.object({ lessonId: z.string().uuid() });
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_VIDEO_REQUEST" },
      { status: 400 },
    );
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  const customerCode = process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE;
  const userId = await getAuthenticatedUserId();
  const admin = createSupabaseAdminClient();
  if (!accountId || !apiToken || !customerCode || !admin)
    return NextResponse.json(
      { error: "STREAM_NOT_CONFIGURED" },
      { status: 503 },
    );
  if (!userId)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { data: lesson } = await admin
    .from("lessons")
    .select(
      "id,stream_uid,course_modules!inner(course_id),video_assets!lessons_active_video_asset_id_fkey(status)",
    )
    .eq("id", parsed.data.lessonId)
    .maybeSingle();
  const relation = lesson?.course_modules as unknown as
    | { course_id?: string }
    | { course_id?: string }[]
    | undefined;
  const courseId = Array.isArray(relation)
    ? relation[0]?.course_id
    : relation?.course_id;
  if (!courseId || !lesson?.stream_uid)
    return NextResponse.json({ error: "VIDEO_NOT_READY" }, { status: 409 });
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("id")
    .eq("learner_id", userId)
    .eq("course_id", courseId)
    .in("status", ["active", "completed"])
    .maybeSingle();
  if (!enrollment)
    return NextResponse.json(
      { error: "COURSE_ACCESS_REQUIRED" },
      { status: 403 },
    );
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${encodeURIComponent(lesson.stream_uid)}/token`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        exp: Math.floor(Date.now() / 1000) + 15 * 60,
        downloadable: false,
      }),
      cache: "no-store",
    },
  );
  const result = await response.json();
  const token = result?.result?.token;
  if (!response.ok || !token)
    return NextResponse.json({ error: "STREAM_TOKEN_FAILED" }, { status: 502 });
  return NextResponse.json(
    {
      iframeUrl: `https://customer-${customerCode}.cloudflarestream.com/${token}/iframe`,
      expiresIn: 900,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
