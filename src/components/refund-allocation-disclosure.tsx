import type { CatalogCourse } from "@/infrastructure/supabase/catalog";

export function RefundAllocationDisclosure({
  course,
}: {
  course: CatalogCourse;
}) {
  const rows = [
    ...(course.recorded_refund_allocation_twd > 0 ||
    course.delivery_type === "recorded"
      ? [
          {
            key: "recorded",
            label: "錄播內容",
            amount: course.recorded_refund_allocation_twd,
            rule: "依契約按已認列的有效觀看分鐘計算未提供比例",
          },
        ]
      : []),
    ...course.live_refund_allocations.map((allocation) => ({
      key: allocation.componentId,
      label: allocation.title,
      amount: allocation.amountTwd,
      rule: "尚未開始時依契約以此元件配置金額計算",
    })),
  ];

  return (
    <section className="refund-allocation-disclosure">
      <h2>購買價格與退款配置</h2>
      <p>
        這些金額會在建立訂單時由伺服器重新確認並保存快照；符合退款條件時，各部分分開計算。
      </p>
      <dl className="compact-data-list">
        {rows.map((row) => (
          <div key={row.key}>
            <dt>{row.label}</dt>
            <dd>
              NT$ {row.amount.toLocaleString("zh-TW")}・{row.rule}
            </dd>
          </div>
        ))}
        <div>
          <dt>合計</dt>
          <dd>NT$ {course.price_twd.toLocaleString("zh-TW")}</dd>
        </div>
      </dl>
      <p className="closed-note">
        歲悅取消、核定未完成或服務未能提供等例外，仍依契約的全額退款條款處理。
      </p>
    </section>
  );
}
