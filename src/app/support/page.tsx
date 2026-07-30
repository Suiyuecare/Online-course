import Link from "next/link";
import { readSupportCenter } from "@/application/workspace";
import { SupportCenter } from "@/components/support-center";
import { publicSupportDefaults } from "@/content/public-support";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

const publicSupport = {
  email: process.env.SUPPORT_EMAIL ?? publicSupportDefaults.email,
  phone: process.env.SUPPORT_PHONE ?? publicSupportDefaults.phone,
  phoneHref: process.env.SUPPORT_PHONE_HREF ?? publicSupportDefaults.phoneHref,
  hours: process.env.SUPPORT_HOURS ?? publicSupportDefaults.hours,
};

function PublicSupportPage() {
  return (
    <section className="page-shell narrow shell public-support-page">
      <p className="eyebrow">登入也能求助</p>
      <h1>歲悅學苑客服中心</h1>
      <p className="support-lead">
        收不到驗證碼、手機換號或不知道下一步，都可以直接聯絡我們，不必先登入。
      </p>

      <div className="support-public-grid" id="contact">
        <article className="support-contact-card">
          <span aria-hidden="true">01</span>
          <h2>打電話最快</h2>
          <a className="support-contact-value" href={publicSupport.phoneHref}>
            {publicSupport.phone}
          </a>
          <p>{publicSupport.hours}</p>
        </article>
        <article className="support-contact-card">
          <span aria-hidden="true">02</span>
          <h2>寄 Email 留下畫面</h2>
          <a
            className="support-contact-value support-contact-email"
            href={`mailto:${publicSupport.email}?subject=${encodeURIComponent(
              "歲悅學苑登入協助",
            )}`}
          >
            {publicSupport.email}
          </a>
          <p>可附上錯誤畫面，但請遮住身分證、銀行帳號與驗證碼。</p>
        </article>
      </div>

      <div className="support-rescue-steps">
        <div>
          <p className="eyebrow">聯絡時告訴我們</p>
          <h2>三項資訊就夠了</h2>
        </div>
        <ol>
          <li>你的姓名與可聯絡手機。</li>
          <li>卡在哪一個畫面，例如「收不到驗證碼」。</li>
          <li>方便回電的時間。</li>
        </ol>
      </div>

      <div className="warning-panel">
        <strong>保護你的帳號</strong>
        <p>
          歲悅客服不會向你索取完整簡訊驗證碼、密碼、信用卡資料或要求遠端控制手機。若有人要求提供，請立即停止對話。
        </p>
      </div>

      <div className="support-public-actions">
        <Link className="button" href="/login">
          回到手機登入
        </Link>
        <Link className="button secondary" href="/courses">
          先看看課程
        </Link>
      </div>
      <p className="closed-note">
        若有人身安全、意識不清、呼吸困難或其他緊急狀況，請立即撥打
        119；客服中心不取代緊急救援。
      </p>
    </section>
  );
}

export default async function SupportPage() {
  const session = await requireUser().catch(() => null);
  if (!session) {
    return <PublicSupportPage />;
  }

  const { supabase } = session;
  const workspace = await readSupportCenter(supabase).catch(() => null);
  if (!workspace) {
    return (
      <section className="page-shell narrow shell">
        <p className="eyebrow">客服中心</p>
        <h1>客服案件目前無法讀取</h1>
        <div className="warning-panel">
          <strong>資料保持關閉</strong>
          <p>系統不會改用跨學員或跨機構查詢，請稍後再試。</p>
        </div>
        <p>
          緊急需要協助時，可撥打{" "}
          <a href={publicSupport.phoneHref}>{publicSupport.phone}</a> 或寄信至{" "}
          <a href={`mailto:${publicSupport.email}`}>{publicSupport.email}</a>。
        </p>
      </section>
    );
  }
  return (
    <section className="page-shell shell">
      <p className="eyebrow">客服中心</p>
      <h1>建立案件或查看回覆</h1>
      <SupportCenter workspace={workspace} />
    </section>
  );
}
