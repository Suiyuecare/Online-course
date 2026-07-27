import { z } from "zod";
import {
  mutation,
  readJson,
  requireIdempotencyKey,
} from "@/app/api/_shared/route-helpers";
import { requireUser, serviceSupabase } from "@/infrastructure/supabase/server";

export async function POST(request: Request) {
  return mutation(request, async () => {
    const input = await readJson(
      request,
      z.object({
        kind: z.enum(["lost_phone", "recycled_number", "totp_recovery"]),
        evidenceSummary: z.string().trim().min(20).max(3000),
        uploadId: z.uuid(),
      }),
    );
    const { user } = await requireUser();
    const { data, error } = await serviceSupabase().rpc(
      "open_identity_recovery_case",
      {
        p_auth_user_id: user.id,
        p_kind: input.kind,
        p_evidence_summary: input.evidenceSummary,
        p_upload_id: input.uploadId,
        p_idempotency_key: requireIdempotencyKey(request),
      },
    );
    if (error || !data) throw new Error("IDENTITY_RECOVERY_REQUEST_REJECTED");
    return {
      recoveryCaseId: data,
      status: "submitted",
      disclosure:
        "須由兩位不同平台管理員核准、通知舊聯絡管道並經 24 小時冷卻；此前舊資料維持封鎖。",
    };
  });
}
