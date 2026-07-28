import type { Metadata } from "next";

export const metadata: Metadata = { title: "契約、退款與隱私說明" };

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
      <h1>服務契約、退款與隱私原則</h1>
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
      <article id="privacy">
        <h2>帳號資料與課程偏好</h2>
        <p>
          登入手機只顯示遮罩與驗證狀態；通知 Email
          需完成驗證才會替換。職務、學習目的與興趣皆為選填，只用於改善課程推薦，不影響購買、上課、考試或積分資格，也可由本人隨時清空。
        </p>
        <p>
          性別與生日若由本人選擇提供，會存放在不對瀏覽器、機構或客服開放的加密區域。正式姓名、身分證／居留證、長照字號與送審資料則只在積分課報名流程另行蒐集、驗證及保存，不會以一般帳號偏好直接覆寫。
        </p>
        <p>
          正式收費前，歲悅會另行發布經審核且可下載的完整個資告知版本，載明蒐集目的、資料類別、利用期間與地區、利用對象與方式，以及查詢、更正、停止利用與刪除的申請方式。
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
