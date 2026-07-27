import { NextResponse } from "next/server";
import {
  evaluateRuntimeHealth,
  requiredProductionProviders,
  type ProviderHealthSignal,
} from "@/domain/runtime-health";
import { productionReadiness, serverConfig } from "@/infrastructure/config";
import { serviceSupabase } from "@/infrastructure/supabase/server";

export async function GET() {
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
  let deadLetterCount = 0;
  try {
    const service = serviceSupabase();
    const [providerResult, workerResult, oldestDueResult, deadLetterResult] =
      await Promise.all([
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
          .from("durable_jobs")
          .select("id", { count: "exact", head: true })
          .eq("status", "dead_letter"),
      ]);
    if (
      providerResult.error ||
      workerResult.error ||
      oldestDueResult.error ||
      deadLetterResult.error
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
    deadLetterCount = deadLetterResult.count ?? 0;
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
    deadLetterCount,
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
