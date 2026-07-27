import { z } from "zod";
import { mutation } from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ notificationId: string }> },
) {
  return mutation(request, async () => {
    const { notificationId } = await context.params;
    z.uuid().parse(notificationId);
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId)
      .is("read_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error("NOTIFICATION_READ_REJECTED");
    return { notificationId, read: Boolean(data) };
  });
}
