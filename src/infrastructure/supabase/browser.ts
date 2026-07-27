"use client";

import { createBrowserClient } from "@supabase/ssr";

export function browserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_PUBLIC_CONFIGURATION_MISSING");
  return createBrowserClient(url, key);
}
