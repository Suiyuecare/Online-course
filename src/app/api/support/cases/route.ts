import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser } from "@/infrastructure/supabase/server";

const schema = z.object({
  kind: z.enum([
    "learning",
    "live",
    "order",
    "organization",
    "account",
    "privacy",
    "other",
  ]),
  summary: z.string().trim().min(5).max(200),
  initialMessage: z.string().trim().min(1).max(4000),
  organizationId: z.uuid().nullable(),
});

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(request, schema);
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("create_support_case", {
      p_kind: input.kind,
      p_summary: input.summary,
      p_initial_message: input.initialMessage,
      p_organization_id: input.organizationId,
      p_idempotency_key: requireIdempotencyKey(request),
    });
    if (error || !data) throw new Error("SUPPORT_CASE_REJECTED");
    return data;
  });
}
