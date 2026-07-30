import type { OrganizationApplicationReview } from "@/application/admin-review-workflows";

export function OrganizationApplicationReviewSummary({
  review,
}: {
  review: OrganizationApplicationReview;
}) {
  return (
    <section
      className="staff-review-panel"
      aria-labelledby="organization-review-title"
    >
      <p className="eyebrow">申請資料</p>
      <h3 id="organization-review-title">{review.legalName}</h3>
      <dl className="compact-data-list">
        <div>
          <dt>統一編號</dt>
          <dd>{review.taxIdMasked}</dd>
        </div>
        <div>
          <dt>申請聯絡人</dt>
          <dd>{review.contactName}</dd>
        </div>
        <div>
          <dt>聯絡 Email</dt>
          <dd>{review.contactEmailMasked}</dd>
        </div>
        <div>
          <dt>發票 Email</dt>
          <dd>{review.invoiceEmailMasked}</dd>
        </div>
        <div>
          <dt>送出時間</dt>
          <dd>{new Date(review.submittedAt).toLocaleString("zh-TW")}</dd>
        </div>
      </dl>
      <p>
        完整統編只用於伺服器端唯一性比對；審核畫面僅顯示尾四碼與已驗證聯絡資料。
      </p>
      {!review.canReview && (
        <p className="warning-panel">
          此申請目前不可由你審核，或案件狀態已變更。
        </p>
      )}
    </section>
  );
}
