import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  assertEmergencyCapability,
  assertSameOrigin,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import {
  CloudflareStreamAdapter,
  previewTokenTtlSeconds,
} from "@/infrastructure/adapters/stream";
import {
  productionReadiness,
  publicConfig,
  serverConfig,
} from "@/infrastructure/config";
import { serviceSupabase } from "@/infrastructure/supabase/server";

const authorizationSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("authorized"),
      courseVersionId: z.uuid(),
      lessonId: z.uuid(),
      videoUid: z.string().min(1),
      durationSeconds: z.number().int().positive(),
    })
    .strict(),
  z.object({ status: z.literal("provider_unavailable") }).strict(),
  z.object({ status: z.literal("unavailable") }).strict(),
]);

const friendlyMessage = "此試看片段目前無法播放，請稍後再試或聯絡歲悅學苑。";

function response(status: number, error: string) {
  return NextResponse.json(
    { ok: false, error, message: friendlyMessage },
    {
      status,
      headers: {
        "cache-control": "no-store, private",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

async function enforceAnonymousPreviewRateLimit(request: Request) {
  const secret = serverConfig().RATE_LIMIT_HMAC_SECRET;
  if (!secret) throw new Error("PREVIEW_CONFIGURATION_MISSING");
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const address = request.headers.get("x-real-ip") ?? forwarded;
  if (!address) throw new Error("PREVIEW_CLIENT_UNAVAILABLE");
  const scope = createHmac("sha256", secret)
    .update(`${address}|${request.headers.get("user-agent") ?? ""}`)
    .digest("hex");
  const { data, error } = await serviceSupabase().rpc(
    "consume_route_rate_limit",
    {
      p_scope_hash: scope,
      p_action: "public-course-preview",
      p_limit: 6,
    },
  );
  if (error || data !== true) throw new Error("PREVIEW_RATE_LIMITED");
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ courseVersionId: string; lessonId: string }>;
  },
) {
  try {
    assertSameOrigin(request);
    assertEmergencyCapability(request);
    requireIdempotencyKey(request);
    const params = z
      .object({
        courseVersionId: z.uuid(),
        lessonId: z.uuid(),
      })
      .parse(await context.params);
    await enforceAnonymousPreviewRateLimit(request);

    const readiness = productionReadiness();
    const config = publicConfig();
    if (
      !readiness.stream ||
      !config.NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE
    ) {
      return response(503, "PREVIEW_PROVIDER_UNAVAILABLE");
    }

    const service = serviceSupabase();
    const { data, error } = await service.rpc(
      "authorize_public_course_preview",
      {
        p_course_version_id: params.courseVersionId,
        p_lesson_id: params.lessonId,
      },
    );
    const authorization = authorizationSchema.safeParse(data);
    if (error || !authorization.success) {
      return response(404, "PREVIEW_UNAVAILABLE");
    }
    if (authorization.data.status === "provider_unavailable") {
      return response(503, "PREVIEW_PROVIDER_UNAVAILABLE");
    }
    if (authorization.data.status !== "authorized") {
      return response(404, "PREVIEW_UNAVAILABLE");
    }
    if (
      authorization.data.courseVersionId !== params.courseVersionId ||
      authorization.data.lessonId !== params.lessonId
    ) {
      return response(404, "PREVIEW_UNAVAILABLE");
    }

    const ttlSeconds = previewTokenTtlSeconds(
      authorization.data.durationSeconds,
    );
    const previewToken = new CloudflareStreamAdapter().createPreviewToken(
      authorization.data.videoUid,
      authorization.data.durationSeconds,
    );
    return NextResponse.json(
      {
        ok: true,
        data: {
          previewToken,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
          customerCode: config.NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE,
          lessonId: params.lessonId,
        },
      },
      {
        status: 200,
        headers: {
          "cache-control": "no-store, private",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch (error) {
    const code =
      error instanceof Error ? error.message.split(":")[0] : "PREVIEW_REJECTED";
    if (code === "PREVIEW_RATE_LIMITED") {
      return response(429, "PREVIEW_RATE_LIMITED");
    }
    if (
      code.includes("CONFIGURATION") ||
      code.includes("UNAVAILABLE") ||
      code.includes("EMERGENCY_CLOSED")
    ) {
      return response(503, "PREVIEW_PROVIDER_UNAVAILABLE");
    }
    return response(404, "PREVIEW_UNAVAILABLE");
  }
}
