import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  evaluateRuntimeHealth,
  requiredProductionProviders,
  type ProviderHealthSignal,
} from "@/domain/runtime-health";
import { productionReadiness, serverConfig } from "@/infrastructure/config";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

function sameSecret(left: string, right: string) {
  const expected = Buffer.from(left);
  const presented = Buffer.from(right);
  return (
    expected.length === presented.length && timingSafeEqual(expected, presented)
  );
}

async function canReadDetailedReadiness(request: Request) {
  try {
    const configured = process.env.CRON_SECRET;
    const presented = request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "");
    if (
      configured &&
      configured.length >= 32 &&
      presented &&
      sameSecret(configured, presented)
    ) {
      return true;
    }
  } catch {
    // A missing server configuration cannot grant access.
  }

  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("authorize_staff_action", {
      p_required_role: "platform_admin",
      p_action: "operations.readiness.read",
      p_target: "production",
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  if (!(await canReadDetailedReadiness(request))) {
    return NextResponse.json(
      { status: "protected" },
      {
        status: 401,
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }

  let readiness: Record<string, boolean>;
  let emergencyClosed = true;
  try {
    readiness = productionReadiness();
    emergencyClosed = serverConfig().EMERGENCY_DISABLE_ALL === "true";
  } catch {
    readiness = { environment: false };
  }

  const now = new Date();
  let databaseConnected = false;
  let providers: ProviderHealthSignal[] = [];
  let workerLastSuccessAt: string | null = null;
  let oldestDueJobCreatedAt: string | null = null;
  let oldestDueNotificationCreatedAt: string | null = null;
  let durableDeadLetterCount = 0;
  let notificationDeadLetterCount = 0;
  try {
    const service = serviceSupabase();
    const [
      providerResult,
      workerResult,
      oldestDueResult,
      oldestDueNotificationResult,
      deadLetterResult,
      notificationDeadLetterResult,
    ] = await Promise.all([
      service
        .from("provider_health")
        .select(
          "provider,status,checked_at,production_validated_at,production_validation_expires_at",
        )
        .in("provider", [...requiredProductionProviders]),
      service
        .from("worker_heartbeats")
        .select("last_success_at")
        .eq("worker_name", "vercel-cron")
        .maybeSingle(),
      service
        .from("durable_jobs")
        .select("created_at")
        .in("status", ["pending", "retry"])
        .lte("available_at", now.toISOString())
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      service
        .from("notification_outbox")
        .select("created_at")
        .in("status", ["pending", "retry"])
        .lte("available_at", now.toISOString())
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      service
        .from("durable_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "dead_letter"),
      service
        .from("notification_outbox")
        .select("id", { count: "exact", head: true })
        .eq("status", "dead_letter"),
    ]);
    if (
      providerResult.error ||
      workerResult.error ||
      oldestDueResult.error ||
      oldestDueNotificationResult.error ||
      deadLetterResult.error ||
      notificationDeadLetterResult.error
    ) {
      throw new Error("HEALTH_DEPENDENCY_QUERY_FAILED");
    }
    databaseConnected = true;
    providers = (providerResult.data ?? []).map((provider) => ({
      provider: provider.provider,
      status: provider.status,
      checkedAt: provider.checked_at,
      productionValidatedAt: provider.production_validated_at,
      productionValidationExpiresAt: provider.production_validation_expires_at,
    }));
    workerLastSuccessAt = workerResult.data?.last_success_at ?? null;
    oldestDueJobCreatedAt = oldestDueResult.data?.created_at ?? null;
    oldestDueNotificationCreatedAt =
      oldestDueNotificationResult.data?.created_at ?? null;
    durableDeadLetterCount = deadLetterResult.count ?? 0;
    notificationDeadLetterCount = notificationDeadLetterResult.count ?? 0;
  } catch {
    databaseConnected = false;
  }

  const health = evaluateRuntimeHealth({
    now,
    configuration: readiness,
    emergencyClosed,
    databaseConnected,
    providers,
    workerLastSuccessAt,
    oldestDueJobCreatedAt,
    oldestDueNotificationCreatedAt,
    durableDeadLetterCount,
    notificationDeadLetterCount,
  });
  return NextResponse.json(
    {
      status: health.status,
      emergencyClosed,
      capabilities: readiness,
      dependencies: health.dependencies,
      reasons: health.reasons,
    },
    {
      status: health.status === "ready" ? 200 : 503,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
