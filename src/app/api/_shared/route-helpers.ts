import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { DomainError } from "@/domain/feature-gates";
import {
  jsonRequestBodyLimitBytes,
  readRequestTextWithLimit,
} from "@/domain/request-body";
import {
  emergencyClosureCode,
  highFrequencyRateLimitPlan,
  isExactSameOrigin,
  rateLimitAction,
  type EmergencyCapability,
  usesAuthenticatedHighFrequencyLimit,
} from "@/domain/request-security";
import { serverConfig } from "@/infrastructure/config";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (
    !isExactSameOrigin(
      request.url,
      origin,
      request.headers.get("sec-fetch-site"),
    )
  ) {
    throw new Error(origin ? "ORIGIN_REJECTED" : "ORIGIN_REQUIRED");
  }
}

export function assertEmergencyCapability(
  request: Request,
  explicitCapability?: EmergencyCapability,
): void {
  const config = serverConfig();
  const code = emergencyClosureCode(
    {
      allDisabled: config.EMERGENCY_DISABLE_ALL === "true",
      paymentsDisabled: config.EMERGENCY_DISABLE_PAYMENTS === "true",
      exportsDisabled: config.EMERGENCY_DISABLE_EXPORTS === "true",
      certificatesDisabled: config.EMERGENCY_DISABLE_CERTIFICATES === "true",
    },
    new URL(request.url).pathname,
    explicitCapability,
  );
  if (code) throw new Error(code);
}

export async function enforceRateLimit(request: Request) {
  const secret = serverConfig().RATE_LIMIT_HMAC_SECRET;
  if (!secret) throw new Error("RATE_LIMIT_CONFIGURATION_MISSING");
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const address = request.headers.get("x-real-ip") ?? forwarded;
  if (!address) throw new Error("CLIENT_IP_UNAVAILABLE");
  const scope = createHmac("sha256", secret)
    .update(`${address}|${request.headers.get("user-agent") ?? ""}`)
    .digest("hex");
  const action = rateLimitAction(new URL(request.url).pathname);
  const limiter = serviceSupabase();

  if (
    usesAuthenticatedHighFrequencyLimit(action) ||
    !action.startsWith("/api/auth/otp/")
  ) {
    const { user } = await requireUser();
    const personScope = createHmac("sha256", secret)
      .update(`authenticated-user|${user.id}`)
      .digest("hex");
    const plan = usesAuthenticatedHighFrequencyLimit(action)
      ? highFrequencyRateLimitPlan
      : {
          perAuthenticatedPersonPerMinute: 30,
          perNetworkPerMinute: 30,
        };
    const [personResult, networkResult] = await Promise.all([
      limiter.rpc("consume_route_rate_limit", {
        p_scope_hash: personScope,
        p_action: `${action}:person`,
        p_limit: plan.perAuthenticatedPersonPerMinute,
      }),
      limiter.rpc("consume_route_rate_limit", {
        p_scope_hash: scope,
        p_action: `${action}:network`,
        p_limit: plan.perNetworkPerMinute,
      }),
    ]);
    if (
      personResult.error ||
      !personResult.data ||
      networkResult.error ||
      !networkResult.data
    ) {
      throw new Error("RATE_LIMITED");
    }
    return;
  }

  const { data, error } = await limiter.rpc("consume_route_rate_limit", {
    p_scope_hash: scope,
    p_action: action,
    p_limit: 5,
  });
  if (error || !data) throw new Error("RATE_LIMITED");
}

export function requireIdempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key");
  if (!value || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  }
  return value;
}

export async function readJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  return schema.parse(
    JSON.parse(
      await readRequestTextWithLimit(request, jsonRequestBodyLimitBytes),
    ),
  );
}

export async function mutation(
  request: Request,
  operation: () => Promise<unknown>,
) {
  try {
    assertSameOrigin(request);
    assertEmergencyCapability(request);
    await enforceRateLimit(request);
    requireIdempotencyKey(request);
    const data = await operation();
    return NextResponse.json(
      { ok: true, data },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const code =
      error instanceof DomainError
        ? error.code
        : error instanceof Error
          ? error.message.split(":")[0]
          : "REQUEST_REJECTED";
    const status =
      code === "AUTHENTICATION_REQUIRED"
        ? 401
        : code === "REQUEST_BODY_TOO_LARGE"
          ? 413
          : code.includes("CONFIGURATION") ||
              code.includes("UNAVAILABLE") ||
              code.includes("EMERGENCY_CLOSED")
            ? 503
            : 400;
    return NextResponse.json(
      { ok: false, error: code },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
