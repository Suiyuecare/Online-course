import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readSupportCenter } from "@/application/workspace";
import { PrivacyRightsCenter } from "@/components/privacy-rights-center";
import { requireUser } from "@/infrastructure/supabase/server";

export const metadata: Metadata = { title: "我的資料與帳號權利" };
export const dynamic = "force-dynamic";

export default async function LearnerPrivacyPage() {
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const workspace = await readSupportCenter(supabase).catch(() => null);

  return (
    <section className="learner-portal-page learner-portal-shell-width learner-narrow-page">
      <header className="learner-page-heading">
        <div>
          <p className="learner-kicker">隱私與帳號</p>
          <h1>我的資料與帳號權利</h1>
          <p>
            查詢、更正、限制利用或申請停用帳號，都會留下案件編號與處理紀錄，不會用一個按鈕直接刪除重要憑證。
          </p>
        </div>
        <Link className="button secondary" href="/legal#privacy">
          查看資料使用說明
        </Link>
      </header>

      {!workspace ? (
        <div className="warning-panel">
          <strong>目前無法安全讀取申請紀錄</strong>
          <p>
            系統不會把連線問題顯示成「沒有案件」，也不會在無法確認身分時接受刪除要求。請重新整理或聯絡客服。
          </p>
          <div className="button-row">
            <Link className="button" href="/learner/privacy">
              重新讀取
            </Link>
            <Link className="button secondary" href="/support">
              聯絡客服
            </Link>
          </div>
        </div>
      ) : (
        <PrivacyRightsCenter
          cases={workspace.cases.filter((item) => item.kind === "privacy")}
        />
      )}
    </section>
  );
}
