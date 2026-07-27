import type { Metadata } from "next";

export const metadata: Metadata = { title: "契約與退款說明" };

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

export default function LegalPage() {
  const complete = operatingFields.every(([, value]) => Boolean(value));
  return (
    <section className="page-shell narrow shell legal-page">
      <p className="eyebrow">報名前完整閱讀</p>
      <h1>服務契約與退款原則</h1>
      {!complete && (
        <div className="warning-panel">
          <strong>正式營運資料尚未齊全，收費功能目前關閉</strong>
          <p>完成律師、會計與銀行資料確認後，才會發布正式契約版本。</p>
        </div>
      )}
      <article>
        <h2>72 小時契約審閱</h2>
        <p>
          第一次提供可下載、列印的完整契約與版本雜湊；72
          小時後才能第二次確認，完成後才能建立人工匯款訂單。
        </p>
      </article>
      <article>
        <h2>匯款與開通</h2>
        <p>
          提交匯款人、銀行、帳號末五碼、時間與金額，只是提供核對資料，不代表付款完成。財務確認銀行實際入帳且金額完全相符後，系統才會開通。
        </p>
      </article>
      <article>
        <h2>退款</h2>
        <p>
          未開始的錄播、未舉行的直播原則上全額退款。錄播開始後，依「正式有效分鐘
          ÷
          版本要求分鐘」計算已提供比例，退款小數採對消費者有利的進位。受理時先凍結受影響部分，退款最晚於資料齊全後
          15 日內處理。
        </p>
      </article>
      <article>
        <h2>積分狀態</h2>
        <p>
          申請中課程會同等醒目標示，核准前不能正式學習、進直播或發積分證明。平台「已完課」與認可單位「積分已登錄」分開。
        </p>
      </article>
      <dl className="operating-data">
        {operatingFields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || "尚未完成正式設定"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
