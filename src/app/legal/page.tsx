import type { Metadata } from "next";
import Link from "next/link";
import {
  readEffectiveLegalCenter,
  type EffectiveLegalDocument,
} from "@/application/legal-center";
import { publicSupportDefaults } from "@/content/public-support";
import { userSupabase } from "@/infrastructure/supabase/server";

export const metadata: Metadata = { title: "契約、退款與隱私說明" };
export const dynamic = "force-dynamic";

const legalKindLabels: Record<EffectiveLegalDocument["kind"], string> = {
  b2c_contract: "個人購課服務契約",
  b2b_contract: "機構培訓服務契約",
  privacy_notice: "個人資料與隱私告知",
  refund_policy: "退款與終止政策",
  pending_accreditation_disclosure: "積分申請中課程揭露",
};

const operatingFields = [
  ["法人／營業人", process.env.LEGAL_ENTITY_NAME],
  ["統一編號", process.env.LEGAL_TAX_ID],
  ["營業地址", process.env.LEGAL_ADDRESS],
  ["客服電話", process.env.SUPPORT_PHONE],
  ["客服 Email", process.env.SUPPORT_EMAIL],
  ["收款銀行", process.env.BANK_NAME],
  ["銀行代碼", process.env.BANK_CODE],
  ["戶名", process.env.BANK_ACCOUNT_NAME],
] as const;

export default async function LegalPage() {
  let documents: EffectiveLegalDocument[] | null = null;
  try {
    documents = await readEffectiveLegalCenter(await userSupabase());
  } catch {
    // Legal content never silently falls back to hard-coded prose. A database
    // or projection outage is shown as unavailable and commerce remains closed.
  }
  const complete = operatingFields.every(([, value]) => Boolean(value));
  const disclosedOperatingFields = complete
    ? operatingFields
    : [
        ["客服電話", process.env.SUPPORT_PHONE ?? publicSupportDefaults.phone],
        [
          "客服 Email",
          process.env.SUPPORT_EMAIL ?? publicSupportDefaults.email,
        ],
        ["服務時間", process.env.SUPPORT_HOURS ?? publicSupportDefaults.hours],
      ];
  return (
    <section className="page-shell narrow shell legal-page">
      <p className="eyebrow">報名前完整閱讀</p>
      <h1>服務契約、退款與隱私原則</h1>
      {!complete && (
        <div className="warning-panel">
          <strong>目前為功能展示階段，尚未開放匯款或建立正式訂單</strong>
          <p>
            你可以先完整體驗學員、機構與管理後台；法人、銀行與正式契約資料會在通過律師、會計及內部雙人覆核後，才顯示於付款畫面。
          </p>
          <div className="button-row legal-demo-actions">
            <Link className="button" href="/demo">
              看完整功能導覽
            </Link>
            <Link className="button secondary" href="/support">
              聯絡歲悅客服
            </Link>
          </div>
        </div>
      )}
      {documents === null ? (
        <div className="warning-panel" role="alert">
          <strong>正式法律文件目前無法讀取</strong>
          <p>
            系統不會用頁面內建文字代替資料庫已發布版本。文件服務恢復前，請勿匯款或建立正式訂單。
          </p>
        </div>
      ) : documents.length === 0 ? (
        <div className="warning-panel" role="alert">
          <strong>目前沒有已生效且經法律核准的文件</strong>
          <p>正式法律文件發布前，付款與正式訂單維持關閉。</p>
        </div>
      ) : (
        <section aria-labelledby="effective-legal-documents">
          <h2 id="effective-legal-documents">目前有效的正式文件</h2>
          <div className="record-grid">
            {documents.map((document) => (
              <article key={document.documentId}>
                <p className="eyebrow">第 {document.revision} 版</p>
                <h3>{legalKindLabels[document.kind]}</h3>
                <p>
                  生效時間：
                  {new Date(document.effectiveAt).toLocaleString("zh-TW")}
                </p>
                <p>
                  SHA-256：
                  <code>{document.contentSha256}</code>
                </p>
                <a className="button secondary" href={document.downloadPath}>
                  下載並核對正式文件
                </a>
              </article>
            ))}
          </div>
        </section>
      )}
      <article id="privacy">
        <h2>資料權利與閱讀協助</h2>
        <div className="button-row">
          <Link className="button secondary" href="/learner/privacy">
            辦理我的資料與帳號權利
          </Link>
          <Link className="button secondary" href="/accessibility">
            查看無障礙與閱讀協助
          </Link>
        </div>
      </article>
      <dl className="operating-data">
        {disclosedOperatingFields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
