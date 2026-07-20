import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import "server-only";

export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot set cookies. src/proxy.ts refreshes them.
        }
      },
    },
  });
}

export async function getAuthenticatedUserId() {
  const client = await createSupabaseServerClient();
  if (!client) return null;
  const { data, error } = await client.auth.getClaims();
  if (error) return null;
  return typeof data?.claims?.sub === "string" ? data.claims.sub : null;
}

export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getPlatformRole(): Promise<
  "admin" | "support" | "learner"
> {
  const userId = await getAuthenticatedUserId();
  const admin = createSupabaseAdminClient();
  if (!userId || !admin) return "learner";
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) return "learner";
  const role = data.user.app_metadata?.platform_role;
  return role === "admin"
    ? "admin"
    : role === "support"
      ? "support"
      : "learner";
}

export async function isPlatformAdmin() {
  return (await getPlatformRole()) === "admin";
}
