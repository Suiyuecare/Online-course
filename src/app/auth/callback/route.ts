import { NextResponse } from "next/server";
import { authCallbackDestinations } from "@/lib/auth-callback";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const destinations = authCallbackDestinations(url.searchParams.get("next"));
  const supabase = await createSupabaseServerClient();
  if (!supabase || !code)
    return NextResponse.redirect(new URL(destinations.failure, url.origin));
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error)
    return NextResponse.redirect(new URL(destinations.failure, url.origin));
  return NextResponse.redirect(new URL(destinations.success, url.origin));
}
