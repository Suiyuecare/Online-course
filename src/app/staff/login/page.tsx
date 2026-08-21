import type { Metadata } from "next";
import Link from "next/link";
import { StaffEmailLogin } from "@/components/staff-email-login";

export const metadata: Metadata = { title: "工作人員登入" };

export default function StaffLoginPage() {
  return (
    <section className="auth-page shell">
      <StaffEmailLogin />
      <aside className="auth-help">
        <h2>教學品管部登入說明</h2>
        <ol>
          <li>請使用公司核發的職員帳號。</li>
          <li>第一次登入後，系統會要求更換臨時密碼。</li>
          <li>依畫面設定驗證器 App，完成後即可進入後台。</li>
          <li>請勿把密碼或六位數驗證碼交給任何人。</li>
        </ol>
        <p>無法登入時，請由內部管道聯絡系統管理員協助重設。</p>
        <Link className="button secondary auth-support-link" href="/">
          返回歲悅學苑首頁
        </Link>
      </aside>
    </section>
  );
}
