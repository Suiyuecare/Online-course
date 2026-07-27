import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(
      request,
      z.object({
        targetType: z.enum(["order", "topup"]),
        allocationId: z.uuid(),
        reason: z.string().trim().min(3).max(500),
      }),
    );
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      input.targetType === "order"
        ? "confirm_bank_allocation"
        : "confirm_topup_bank_allocation",
      {
        p_allocation_id: input.allocationId,
        p_reason: input.reason,
      },
    );
    if (error) throw new Error(`DATABASE_REJECTED:${error.message}`);
    return data;
  });
}
