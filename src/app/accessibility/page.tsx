import type { Metadata } from "next";
import Link from "next/link";
import { publicSupportDefaults } from "@/content/public-support";

export const metadata: Metadata = {
  title: "無障礙與閱讀協助",
  description:
    "了解歲悅學苑的鍵盤操作、放大文字、減少動畫、字幕與客服協助方式。",
};

const support = {
  email: process.env.SUPPORT_EMAIL ?? publicSupportDefaults.email,
  phone: process.env.SUPPORT_PHONE ?? publicSupportDefaults.phone,
  phoneHref: process.env.SUPPORT_PHONE_HREF ?? publicSupportDefaults.phoneHref,
  hours: process.env.SUPPORT_HOURS ?? publicSupportDefaults.hours,
};

export default function AccessibilityPage() {
  return (
    <section className="page-shell narrow shell accessibility-page">
      <p className="eyebrow">ACCESSIBILITY</p>
      <h1>讓每位學員都能看得懂、按得到、跟得上</h1>
      <p className="lead">
        歲悅學苑以手機操作與長照第一線使用情境為優先。若任何畫面讓你無法完成報名、上課、測驗或取得證明，我們會提供替代方式並追蹤改善。
      </p>

      <nav aria-label="本頁內容" className="accessibility-page-nav">
        <a href="#available">目前可使用</a>
        <a href="#classroom">上課協助</a>
        <a href="#feedback">回報問題</a>
      </nav>

      <section id="available">
        <h2>目前可使用的閱讀與操作協助</h2>
        <div className="accessibility-feature-grid">
          <article>
            <span aria-hidden="true">Aa</span>
            <h3>放大文字與高對比</h3>
            <p>
              登入後可到「帳號與個人資料 →
              閱讀偏好」放大介面文字、提高對比並減少動畫。
            </p>
          </article>
          <article>
            <span aria-hidden="true">⌨</span>
            <h3>鍵盤與焦點操作</h3>
            <p>
              可使用 Tab 移動、Enter 或空白鍵操作；彈出視窗支援 Escape
              關閉並把焦點送回原按鈕。
            </p>
          </article>
          <article>
            <span aria-hidden="true">◎</span>
            <h3>清楚的狀態與錯誤</h3>
            <p>
              重要操作不只用顏色表示，並提供文字結果、下一步與可聯絡的客服管道。
            </p>
          </article>
          <article>
            <span aria-hidden="true">44</span>
            <h3>手機觸控尺寸</h3>
            <p>
              主要按鈕與導覽以至少 44px 的可觸控範圍設計，避免手指誤按相鄰操作。
            </p>
          </article>
        </div>
      </section>

      <section id="classroom">
        <h2>上課時遇到困難</h2>
        <ol className="accessibility-steps">
          <li>
            <strong>先保留畫面</strong>
            <span>不要重複送出付款、測驗或簽到；可先截圖錯誤訊息。</span>
          </li>
          <li>
            <strong>切換閱讀偏好</strong>
            <span>放大文字、提高對比或減少動畫不會改變學習紀錄。</span>
          </li>
          <li>
            <strong>聯絡客服</strong>
            <span>
              說明使用的手機／電腦、所在頁面與想完成的事情，不必提供驗證碼或完整證號。
            </span>
          </li>
        </ol>
        <div className="warning-panel">
          <strong>字幕、逐字稿與教材替代格式</strong>
          <p>
            正式課程發布檢查會確認影片字幕與必要教材。若現有格式仍無法使用，請建立客服案件，我們會依課程內容提供可行的替代方式。
          </p>
        </div>
      </section>

      <section id="feedback">
        <h2>回報無障礙問題</h2>
        <p>
          電話：<a href={support.phoneHref}>{support.phone}</a>（{support.hours}
          ）
          <br />
          Email：<a href={`mailto:${support.email}`}>{support.email}</a>
        </p>
        <div className="button-row">
          <Link className="button" href="/support">
            前往客服中心
          </Link>
          <Link className="button secondary" href="/learner/settings">
            調整閱讀偏好
          </Link>
        </div>
        <p className="closed-note">
          這份說明會隨產品改善更新；正式對外營運前，仍會安排目標學員、鍵盤與手機輔助操作的人工驗收。
        </p>
      </section>
    </section>
  );
}
