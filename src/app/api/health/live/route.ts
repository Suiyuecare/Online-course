import { NextResponse } from "next/server";

// Public liveness is intentionally minimal. Detailed readiness, provider
// validation, queue state, and emergency switches remain on /api/health.
export async function GET() {
  return NextResponse.json(
    { status: "live" },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
