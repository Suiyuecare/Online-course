import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  getPlatformRole,
} from "@/lib/supabase/server";

const schema = z.object({
  availableDelta: z.number().int().min(-10_000).max(10_000).refine(Boolean),
  reason: z.string().trim().min(5).max(500),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ lotId: string }> },
) {
  if ((await getPlatformRole()) !== "admin")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const [{ lotId }, body, actorId] = await Promise.all([
    params,
    request.json().catch(() => null),
    getAuthenticatedUserId(),
  ]);
  const parsed = schema.safeParse(body);
  if (!z.string().uuid().safeParse(lotId).success || !parsed.success)
    return NextResponse.json({ error: "INVALID_SEAT_CORRECTION" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  if (!actorId || !admin)
    return NextResponse.json({ error: "SERVICE_NOT_CONFIGURED" }, { status: 503 });
  const { data, error } = await admin.rpc("correct_enterprise_seat_lot", {
    target_lot_id: lotId,
    target_available_delta: parsed.data.availableDelta,
    target_actor_id: actorId,
    target_reason: parsed.data.reason,
  });
  if (error)
    return NextResponse.json(
      {
        error: error.message.includes("BALANCE")
          ? "INVALID_SEAT_BALANCE"
          : error.message.includes("RESERVED")
            ? "REFUND_SEATS_RESERVED"
            : "SEAT_CORRECTION_FAILED",
      },
      { status: 409 },
    );
  return NextResponse.json({ seatLot: data });
}
