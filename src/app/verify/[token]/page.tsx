import { createHash, createHmac } from "node:crypto";
import { headers } from "next/headers";
import { presentStatus } from "@/domain/presentation";
import { serverConfig } from "@/infrastructure/config";
import { serviceSupabase } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

type Verification = {
  masked_name: string | null;
  course_title: string | null;
  completed_on: string | null;
  points: number | null;
  status: string | null;
};

const empty: Verification = {
  masked_name: null,
  course_title: null,
  completed_on: null,
  points: null,
  status: null,
};

export default async function CertificateVerificationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let result = empty;
  try {
    if (!/^[A-Za-z0-9_-]{22,}$/.test(token)) throw new Error("INVALID_TOKEN");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const secret = serverConfig().RATE_LIMIT_HMAC_SECRET;
    const requestHeaders = await headers();
    const address =
      requestHeaders.get("x-real-ip") ??
      requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (!secret || !address) throw new Error("RATE_LIMIT_UNAVAILABLE");
    const service = serviceSupabase();
    const ipScope = createHmac("sha256", secret)
      .update(`certificate-verification:${address}`)
      .digest("hex");
    const tokenScope = createHmac("sha256", secret)
      .update(`certificate-verification:${address}:${tokenHash}`)
      .digest("hex");
    const [ipLimit, tokenLimit] = await Promise.all([
      service.rpc("consume_route_rate_limit", {
        p_scope_hash: ipScope,
        p_action: "certificate_verification_ip",
        p_limit: 60,
      }),
      service.rpc("consume_route_rate_limit", {
        p_scope_hash: tokenScope,
        p_action: "certificate_verification_ip_token",
        p_limit: 5,
      }),
    ]);
    if (
      ipLimit.error ||
      tokenLimit.error ||
      !ipLimit.data ||
      !tokenLimit.data
    ) {
      throw new Error("RATE_LIMITED");
    }
    const { data } = await service
      .from("certificate_verification_projection")
      .select(
        "masked_name:masked_name_snapshot,course_title:course_title_snapshot,completed_on,points,status",
      )
      .eq("verification_token_hash", tokenHash)
      .maybeSingle();
    result = (data as unknown as Verification | null) ?? empty;
  } catch {
    // Constant-shape result intentionally hides whether a token ever existed.
  }
  const status = result.status
    ? presentStatus("certificate", result.status)
    : null;
  return (
    <section className="verify-page shell">
      <div className="verify-card">
        <p className="eyebrow">歲悅學苑證明查驗</p>
        <h1>{result.status ? "查驗結果" : "無法顯示證明"}</h1>
        <dl>
          <div>
            <dt>姓名</dt>
            <dd>{result.masked_name ?? "—"}</dd>
          </div>
          <div>
            <dt>課程</dt>
            <dd>{result.course_title ?? "—"}</dd>
          </div>
          <div>
            <dt>完成日期</dt>
            <dd>{result.completed_on ?? "—"}</dd>
          </div>
          <div>
            <dt>主管機關積分</dt>
            <dd>
              {result.status === "credited" && result.points !== null
                ? result.points
                : "尚未顯示為已登錄"}
            </dd>
          </div>
          <div>
            <dt>目前狀態</dt>
            <dd>{status?.label ?? "無法查驗"}</dd>
          </div>
        </dl>
        <p>
          {status?.description ??
            "無法確認此 token 是否曾存在；頁面不會洩漏可枚舉資訊。"}
        </p>
        <p>此頁不顯示完整姓名、證號或可用來搜尋其他證明的流水號。</p>
      </div>
    </section>
  );
}
