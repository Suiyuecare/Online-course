import { mutation } from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(request: Request) {
  return mutation(request, async () => {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null)
      .select("id");
    if (error) throw new Error("NOTIFICATIONS_READ_REJECTED");
    return { updated: data?.length ?? 0 };
  });
}
