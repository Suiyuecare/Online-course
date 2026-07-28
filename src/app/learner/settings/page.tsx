import { redirect } from "next/navigation";
import { LearnerPreferencePanel } from "@/components/learner-preference-panel";
import { requireUser } from "@/infrastructure/supabase/server";

export default async function LearnerSettingsPage() {
  const { user } = await requireUser().catch(() => redirect("/login"));

  return (
    <section className="learner-portal-page learner-portal-shell-width learner-narrow-page">
      <header className="learner-page-heading">
        <div>
          <p className="learner-kicker">帳號設定</p>
          <h1>讓網站更好閱讀</h1>
          <p>先調整介面閱讀方式；手機號碼與登入安全由驗證流程保護。</p>
        </div>
      </header>
      <div className="learner-settings-card">
        <h2>閱讀偏好</h2>
        <LearnerPreferencePanel accountId={user.id} />
      </div>
      <div className="learner-settings-card">
        <h2>登入與安全</h2>
        <dl className="learner-account-details">
          <div>
            <dt>登入方式</dt>
            <dd>手機簡訊驗證碼</dd>
          </div>
          <div>
            <dt>手機狀態</dt>
            <dd>{user.phone_confirmed_at ? "已驗證" : "待確認"}</dd>
          </div>
        </dl>
        <p>若手機遺失、門號更換或收到不是本人要求的驗證碼，請立即聯絡客服。</p>
      </div>
    </section>
  );
}
