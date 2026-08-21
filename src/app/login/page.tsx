import type { Metadata } from "next";
import Link from "next/link";
import { PhoneLogin } from "@/components/phone-login";
import { localProvidersAllowed } from "@/domain/identity";

export const metadata: Metadata = { title: "手機登入" };

export default function LoginPage() {
  const localTestMode = localProvidersAllowed({
    nodeEnv: process.env.NODE_ENV,
    appEnv: process.env.APP_ENV,
    allowMocks: process.env.ALLOW_LOCAL_MOCK_PROVIDERS,
  });
  return (
    <section className="auth-page shell">
      <PhoneLogin
        localTestMode={localTestMode}
        turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
      />
      <aside className="auth-help">
        <h2>沒有收到簡訊？</h2>
        <ol>
          <li>確認號碼是台灣 09 開頭手機。</li>
          <li>等待 60 秒再重新傳送。</li>
          <li>重新開機或確認沒有封鎖簡訊。</li>
          <li>仍無法收到時，請直接聯絡客服，不必先登入。</li>
        </ol>
        <p>客服不會向你索取完整簡訊驗證碼。</p>
        <Link className="button secondary auth-support-link" href="/support">
          查看客服電話與處理方式
        </Link>
        <Link
          className="button secondary auth-support-link"
          href="/staff/login"
        >
          工作人員帳密登入
        </Link>
      </aside>
    </section>
  );
}
