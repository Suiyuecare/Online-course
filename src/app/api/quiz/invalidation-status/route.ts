import { NextResponse } from "next/server";
import { z } from "zod";
import { readOwnQuizInvalidationStatuses } from "@/application/quiz-attempt-invalidation";
import { requireUser } from "@/infrastructure/supabase/server";

export async function GET(request: Request) {
  try {
    const enrollmentId = z
      .uuid()
      .safeParse(new URL(request.url).searchParams.get("enrollmentId"));
    if (!enrollmentId.success) throw new Error("INVALID_ENROLLMENT_ID");
    const { supabase } = await requireUser();
    const statuses = await readOwnQuizInvalidationStatuses(
      supabase,
      enrollmentId.data,
    );
    return NextResponse.json(
      { ok: true, data: statuses },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    const code =
      error instanceof Error
        ? error.message.split(":")[0]
        : "QUIZ_INVALIDATION_STATUS_UNAVAILABLE";
    const status =
      code === "AUTHENTICATION_REQUIRED"
        ? 401
        : code.startsWith("QUIZ_INVALIDATION_STATUS_")
          ? 503
          : 400;
    return NextResponse.json(
      { ok: false, error: code },
      { status, headers: { "cache-control": "private, no-store" } },
    );
  }
}
