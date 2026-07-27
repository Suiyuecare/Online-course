import { z } from "zod";
import { mutation, readJson } from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({ enrollmentId: z.string().uuid() });

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc(
      "reconfirm_accreditation_identity",
      { p_enrollment_id: input.enrollmentId },
    );
    const parsed = z
      .object({
        status: z.literal("verified"),
        reconfirmedAt: z.string(),
      })
      .safeParse(data);
    if (error || !parsed.success) throw new Error("RECONFIRM_REJECTED");
    return parsed.data;
  });
}
