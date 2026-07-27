import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicConfig, serverConfig } from "@/infrastructure/config";

function requirePublicSupabase() {
  const config = publicConfig();
  if (
    !config.NEXT_PUBLIC_SUPABASE_URL ||
    !config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    throw new Error("SUPABASE_PUBLIC_CONFIGURATION_MISSING");
  }
  return {
    url: config.NEXT_PUBLIC_SUPABASE_URL,
    key: config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export async function userSupabase() {
  const cookieStore = await cookies();
  const { url, key } = requirePublicSupabase();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot set cookies; proxy.ts performs refresh.
        }
      },
    },
  });
}

export function serviceSupabase() {
  const { url } = requirePublicSupabase();
  const secret = serverConfig().SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("SUPABASE_SERVER_CONFIGURATION_MISSING");
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser() {
  const supabase = await userSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("AUTHENTICATION_REQUIRED");
  return { supabase, user: data.user };
}
