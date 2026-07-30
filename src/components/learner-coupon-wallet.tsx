import Link from "next/link";
import type {
  LearnerCoupon,
  LearnerCouponCategory,
  LearnerCouponWallet,
} from "@/application/workspace";
import { CouponCodeForm } from "@/components/coupon-code-form";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";

const dateTime = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const categories: {
  value: LearnerCouponCategory;
  label: string;
  description: string;
  countKey: keyof LearnerCouponWallet["counts"];
}[] = [
  {
    value: "available",
    label: "可使用",
    description: "購課時可以選用",
    countKey: "available",
  },
  {
    value: "reserved",
    label: "待付款",
    description: "已綁定匯款訂單",
    countKey: "reserved",
  },
  {
    value: "used",
    label: "已使用",
    description: "付款確認後核銷",
    countKey: "used",
  },
  {
    value: "expired",
    label: "已失效",
    description: "過期、暫停或結束",
    countKey: "expired",
  },
];

function money(value: number) {
  return `NT$ ${value.toLocaleString("zh-TW")}`;
}

function benefit(coupon: LearnerCoupon) {
  if (coupon.benefitKind === "fixed_twd") {
    return {
      amount: money(coupon.fixedDiscountTwd ?? 0),
      unit: "現金折抵",
    };
  }
  const payableBps = 10_000 - (coupon.percentOffBps ?? 0);
  const fold = payableBps / 1_000;
  return {
    amount: Number.isInteger(fold) ? `${fold}` : fold.toFixed(1),
    unit: "折",
  };
}

function CouponCard({ coupon }: { coupon: LearnerCoupon }) {
  const display = benefit(coupon);
  const course = coupon.applicableCourses[0];
  const isAvailable = coupon.status === "available";

  return (
    <article className={`learner-coupon-card coupon-${coupon.status}`}>
      <div className="learner-coupon-value">
        <small>歲悅折扣券</small>
        <strong>{display.amount}</strong>
        <span>{display.unit}</span>
      </div>
      <div className="learner-coupon-copy">
        <div>
          <span className={`status coupon-status-${coupon.status}`}>
            {coupon.status === "available"
              ? "可使用"
              : coupon.status === "reserved"
                ? "已套用・待付款"
                : coupon.status === "used"
                  ? "已使用"
                  : "已失效"}
          </span>
          <small>代碼 {coupon.codeHint ?? "專屬發放"}</small>
        </div>
        <h2>{coupon.title}</h2>
        <p>{coupon.description}</p>
        <ul>
          <li>
            {coupon.minimumSubtotalTwd > 0
              ? `單堂滿 ${money(coupon.minimumSubtotalTwd)} 可用`
              : "不限最低購課金額"}
          </li>
          <li>
            {coupon.scopeType === "all_b2c"
              ? "適用所有個人長照積分課程"
              : `適用 ${coupon.applicableCourses.length} 門指定課程`}
          </li>
          <li>有效至 {dateTime.format(new Date(coupon.validUntil))}</li>
        </ul>

        <details>
          <summary>查看使用規則</summary>
          <p>
            每張個人訂單限用一張折扣券，不適用機構點數。待匯款訂單會先保留此券；未付款訂單失效後，券仍在效期內才會釋回。付款確認後即核銷，退款不重新發券。
          </p>
        </details>

        {coupon.status === "reserved" && coupon.reservation ? (
          <Link
            className="button"
            href={`/learner/orders/${coupon.reservation.orderId}`}
          >
            前往訂單匯款
          </Link>
        ) : isAvailable && course ? (
          <Link className="button" href={`/courses/${course.slug}`}>
            查看適用課程
          </Link>
        ) : isAvailable ? (
          <Link className="button" href="/learner/catalog">
            選擇適用課程
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export function LearnerCouponWalletView({
  activeCategory,
  paginated,
  wallet,
}: {
  activeCategory: LearnerCouponCategory;
  paginated: boolean;
  wallet: LearnerCouponWallet;
}) {
  const next = wallet.nextCursor;
  const nextQuery = next
    ? new URLSearchParams({
        category: activeCategory,
        beforeAt: next.claimedAt,
        beforeId: next.claimId,
      }).toString()
    : null;
  const total = Object.values(wallet.counts).reduce(
    (sum, count) => sum + count,
    0,
  );

  return (
    <div className="learner-coupon-wallet">
      <section className="learner-coupon-hero">
        <div className="learner-portal-shell-width">
          <div>
            <p className="learner-kicker">個人購課優惠</p>
            <h1>我的折扣券</h1>
            <p>領取、待付款、已使用與失效紀錄都會保留在這裡。</p>
          </div>
          <span aria-hidden="true">
            <LearnerPortalIcon name="discount" size={54} />
          </span>
        </div>
      </section>

      <div className="learner-portal-shell-width learner-coupon-content">
        <CouponCodeForm />

        <nav aria-label="折扣券狀態" className="learner-coupon-categories">
          {categories.map((category) => {
            const count = wallet.counts[category.countKey];
            return (
              <Link
                aria-current={
                  activeCategory === category.value ? "page" : undefined
                }
                href={`/learner/discounts?category=${category.value}`}
                key={category.value}
              >
                <strong>
                  {category.label}
                  {count > 0 && <span>{count}</span>}
                </strong>
                <small>{category.description}</small>
              </Link>
            );
          })}
        </nav>

        {wallet.coupons.length === 0 ? (
          <section className="learner-coupon-empty">
            <span aria-hidden="true">
              <LearnerPortalIcon name="discount" size={44} />
            </span>
            <h2>
              {total === 0 ? "目前還沒有折扣券" : "這個分類目前沒有折扣券"}
            </h2>
            <p>
              {total === 0
                ? "有折扣碼時可以直接在上方加入；也可以先探索適合的長照積分課程。"
                : "切換其他分類，就能查看待付款、已使用或失效紀錄。"}
            </p>
            <Link
              className="button"
              href={
                total === 0
                  ? "/learner/catalog"
                  : "/learner/discounts?category=available"
              }
            >
              {total === 0 ? "探索課程" : "查看可用折扣券"}
            </Link>
          </section>
        ) : (
          <section aria-label="折扣券列表" className="learner-coupon-list">
            {wallet.coupons.map((coupon) => (
              <CouponCard coupon={coupon} key={coupon.claimId} />
            ))}
          </section>
        )}

        {(paginated || wallet.hasMore) && (
          <nav aria-label="折扣券分頁" className="learner-coupon-pagination">
            {paginated && (
              <Link
                className="button secondary"
                href={`/learner/discounts?category=${activeCategory}`}
              >
                回到最新折扣券
              </Link>
            )}
            {wallet.hasMore && nextQuery && (
              <Link
                className="button secondary"
                href={`/learner/discounts?${nextQuery}`}
              >
                查看較舊折扣券
              </Link>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
