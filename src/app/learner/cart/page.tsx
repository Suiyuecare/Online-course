"use client";

import Image from "next/image";
import Link from "next/link";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import { useLearnerPortal } from "@/components/learner-portal-store";

const deliveryLabels = {
  recorded: "預錄課",
  live: "直播課",
  hybrid: "混合課",
};

export default function LearnerCartPage() {
  const { cart, hydrated, removeCartItem } = useLearnerPortal();
  const total = cart.reduce((sum, item) => sum + item.priceTwd, 0);

  return (
    <section className="learner-portal-page learner-portal-shell-width">
      <header className="learner-page-heading">
        <div>
          <p className="learner-kicker">購物車</p>
          <h1>準備購買的課程</h1>
          <p>加入購物車不會保留直播名額，成立訂單時才會重新確認。</p>
        </div>
        {hydrated && cart.length > 0 && <strong>{cart.length} 門課程</strong>}
      </header>

      {!hydrated ? (
        <div className="learner-loading-card" aria-live="polite">
          正在讀取購物車…
        </div>
      ) : cart.length === 0 ? (
        <div className="learner-friendly-empty">
          <span aria-hidden="true">
            <LearnerPortalIcon name="cart" size={40} />
          </span>
          <h2>購物車目前是空的</h2>
          <p>找到合適的課程後，按「加入購物車」就會放在這裡。</p>
          <Link className="button" href="/learner/catalog">
            去看課程
          </Link>
        </div>
      ) : (
        <div className="learner-cart-layout">
          <div className="learner-cart-list">
            {cart.map((item) => (
              <article key={item.courseVersionId}>
                <div className="learner-cart-cover">
                  {item.coverUrl ? (
                    <Image
                      alt=""
                      fill
                      sizes="160px"
                      src={item.coverUrl}
                      unoptimized
                    />
                  ) : (
                    <LearnerPortalIcon name="book" size={36} />
                  )}
                </div>
                <div>
                  <span>{deliveryLabels[item.deliveryType]}</span>
                  <h2>{item.title}</h2>
                  <strong>NT$ {item.priceTwd.toLocaleString("zh-TW")}</strong>
                </div>
                <div className="learner-cart-item-actions">
                  <Link href={`/courses/${item.slug}`}>查看課程</Link>
                  <button
                    onClick={() => removeCartItem(item.courseVersionId)}
                    type="button"
                  >
                    移除
                  </button>
                </div>
              </article>
            ))}
          </div>
          <aside className="learner-cart-summary">
            <span>課程小計</span>
            <strong>NT$ {total.toLocaleString("zh-TW")}</strong>
            <div className="learner-cart-coupon-note">
              <LearnerPortalIcon name="discount" size={22} />
              <div>
                <strong>有折扣券嗎？</strong>
                <p>每門課成立一筆訂單，可在契約流程最後一步選用一張。</p>
              </div>
              <Link href="/learner/discounts">查看折扣券</Link>
            </div>
            <p>目前採匯款購課，每門課需個別確認條款、積分狀態與直播場次。</p>
            <Link className="button" href={`/courses/${cart[0].slug}`}>
              從第一門開始確認
            </Link>
            <small>正式訂單金額以伺服器結帳頁重新計算為準。</small>
          </aside>
        </div>
      )}
    </section>
  );
}
