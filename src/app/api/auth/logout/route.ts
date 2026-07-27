import { NextResponse } from "next/server";
import {
  assertSameOrigin,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { userSupabase } from "@/infrastructure/supabase/server";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    requireIdempotencyKey(request);
    const client = await userSupabase();
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw new Error("SIGN_OUT_REJECTED");
    return NextResponse.json(
      { ok: true, data: { signedOut: true } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "SIGN_OUT_REJECTED" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
