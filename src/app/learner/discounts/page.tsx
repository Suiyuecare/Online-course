import Link from "next/link";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";

export default function LearnerDiscountsPage() {
  return (
    <section className="learner-portal-page learner-portal-shell-width learner-narrow-page">
      <header className="learner-page-heading">
        <div>
          <p className="learner-kicker">我的優惠</p>
          <h1>優惠與購課方案</h1>
          <p>可使用的折扣會在結帳前清楚顯示，不會自動改變積分資格。</p>
        </div>
      </header>
      <div className="learner-friendly-empty">
        <span aria-hidden="true">
          <LearnerPortalIcon name="discount" size={40} />
        </span>
        <h2>目前沒有可用優惠</h2>
        <p>歲悅目前不建立個人點數或回饋金，避免和長照繼續教育積分混淆。</p>
        <Link className="button" href="/learner/catalog">
          查看課程
        </Link>
      </div>
    </section>
  );
}
