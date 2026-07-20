"use client";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="button-secondary"
      onClick={async () => {
        await getSupabaseBrowserClient()?.auth.signOut();
        router.replace("/");
        router.refresh();
      }}
    >
      登出
    </button>
  );
}
