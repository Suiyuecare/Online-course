import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseAdminClient,
  getPlatformRole,
} from "@/lib/supabase/server";

const querySchema = z.object({
  organizationId: z.string().uuid().optional(),
  targetType: z.string().trim().min(1).max(80).optional(),
  targetId: z.string().trim().min(1).max(160).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: Request) {
  const role = await getPlatformRole();
  if (role !== "admin" && role !== "support")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success)
    return NextResponse.json({ error: "INVALID_AUDIT_FILTER" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });

  let query =
    role === "admin"
      ? admin
          .from("audit_events")
          .select(
            "id,actor_id,organization_id,action,target_type,target_id,before_data,after_data,occurred_at",
          )
          .order("id", { ascending: false })
          .limit(parsed.data.limit + 1)
      : admin
          .from("audit_events")
          .select("id,organization_id,action,target_type,occurred_at")
          .order("id", { ascending: false })
          .limit(parsed.data.limit + 1);
  if (parsed.data.organizationId)
    query = query.eq("organization_id", parsed.data.organizationId);
  if (parsed.data.targetType)
    query = query.eq("target_type", parsed.data.targetType);
  if (parsed.data.targetId) query = query.eq("target_id", parsed.data.targetId);
  if (parsed.data.cursor) query = query.lt("id", parsed.data.cursor);
  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: "AUDIT_QUERY_FAILED" }, { status: 500 });
  const rows = (data ?? []) as unknown as Array<{
    id: number;
    [key: string]: unknown;
  }>;
  const hasMore = rows.length > parsed.data.limit;
  const events = rows.slice(0, parsed.data.limit);
  return NextResponse.json(
    {
      events,
      nextCursor: hasMore ? events.at(-1)?.id ?? null : null,
      masked: role === "support",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
