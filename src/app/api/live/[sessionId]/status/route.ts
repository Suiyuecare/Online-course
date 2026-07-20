import { NextResponse } from "next/server";
import { getConfirmedLiveBooking, recomputeLiveAttendance } from "@/lib/live";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
} from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const userId = await getAuthenticatedUserId();
  const admin = createSupabaseAdminClient();
  if (!userId)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!admin)
    return NextResponse.json(
      { error: "SERVICE_NOT_CONFIGURED" },
      { status: 503 },
    );
  const { sessionId } = await params;
  const booking = await getConfirmedLiveBooking(admin, userId, sessionId);
  if (!booking)
    return NextResponse.json(
      { error: "LIVE_BOOKING_REQUIRED" },
      { status: 403 },
    );
  const summary = await recomputeLiveAttendance(admin, booking.id);
  return NextResponse.json({ booking, summary });
}
