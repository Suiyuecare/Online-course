import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import {
  privacyRequestInputSchema,
  privacyRequestLabel,
} from "@/domain/privacy-rights";
import { requireUser } from "@/infrastructure/supabase/server";

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(request, privacyRequestInputSchema);
    const { supabase } = await requireUser();
    const label = privacyRequestLabel(input.requestType);
    const { data, error } = await supabase.rpc("create_support_case", {
      p_kind: "privacy",
      p_summary: `個資權利申請：${label}`,
      p_initial_message: [
        `申請類型：${label}`,
        input.detail,
        "提出人已理解：帳號停用或提出刪除申請，不會立即刪除依法應保存的訂單、付款、積分送審、證明或稽核紀錄。",
      ].join("\n\n"),
      p_organization_id: null,
      p_idempotency_key: requireIdempotencyKey(request),
    });
    if (error || !data) throw new Error("PRIVACY_REQUEST_REJECTED");
    return data;
  });
}
