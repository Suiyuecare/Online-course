import Link from "next/link";
import { redirect } from "next/navigation";
import { CertificateDownloadButton } from "@/components/certificate-download-button";
import { IdentityRecoveryForm } from "@/components/identity-recovery-form";
import { SignOutButton } from "@/components/sign-out-button";
import { presentStatus } from "@/domain/presentation";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

type LearnerRow = {
  enrollment_id: string;
  course_title: string;
  delivery_type: string;
  enrollment_status: string;
  confirmed_valid_seconds: number;
  required_seconds: number;
  next_live_starts_at: string | null;
  certificate_status: string | null;
  certificate_id: string | null;
};

export default async function LearnerDashboard({
  searchParams,
}: {
  searchParams: Promise<{ restricted?: string }>;
}) {
  const restricted = (await searchParams).restricted === "1";
  let rows: LearnerRow[] = [];
  try {
    const { supabase } = await requireUser();
    const { data } = await supabase.from("learner_dashboard").select("*");
    rows = (data ?? []) as LearnerRow[];
  } catch {
    redirect("/login");
  }
  return (
    <section className="dashboard-page shell">
      {restricted && (
        <div className="warning-panel">
          <strong>舊資料目前受保護</strong>
          <p>
            此次登入未通過高價值帳號風險確認。付款、身分、證明、影片與直播權限皆由資料庫封鎖，不會因瀏覽器狀態解鎖。
          </p>
          <IdentityRecoveryForm />
        </div>
      )}
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">我的學習</p>
          <h1>今天要做什麼？</h1>
        </div>
        <div className="dashboard-actions">
          <Link className="notice-button" href="/learner/notifications">
            通知中心
          </Link>
          <Link className="notice-button" href="/learner/orders">
            我的訂單
          </Link>
          <Link className="notice-button" href="/support">
            客服案件
          </Link>
          <SignOutButton />
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">
          <h2>還沒有可上課的課程</h2>
          <p>匯款資料送出後，仍要等財務確認實際入帳才會開通。</p>
          <Link className="button" href="/courses">
            去找課程
          </Link>
        </div>
      ) : (
        <div className="learning-list">
          {rows.map((row) => {
            const status = presentStatus("enrollment", row.enrollment_status);
            const progress = Math.min(
              100,
              Math.round(
                (row.confirmed_valid_seconds /
                  Math.max(row.required_seconds, 1)) *
                  100,
              ),
            );
            return (
              <article key={row.enrollment_id}>
                <div>
                  <p className={`status status-${status.tone}`}>
                    {status.label}
                  </p>
                  <h2>{row.course_title}</h2>
                  <p>
                    正式有效觀看 {Math.floor(row.confirmed_valid_seconds / 60)}{" "}
                    分鐘
                  </p>
                  {row.next_live_starts_at && (
                    <p>
                      下次直播：
                      {new Date(row.next_live_starts_at).toLocaleString(
                        "zh-TW",
                      )}
                    </p>
                  )}
                  <p>{status.nextAction ?? status.description}</p>
                </div>
                <div
                  aria-label={`完成 ${progress}%`}
                  className="progress"
                  role="progressbar"
                >
                  <span style={{ width: `${progress}%` }} />
                </div>
                <Link
                  className="button"
                  href={`/learner/courses/${row.enrollment_id}`}
                >
                  繼續上課
                </Link>
                {row.certificate_id &&
                  ["active", "submitted", "credited"].includes(
                    row.certificate_status ?? "",
                  ) && (
                    <div>
                      <p>
                        {
                          presentStatus("certificate", row.certificate_status)
                            .label
                        }
                      </p>
                      <CertificateDownloadButton
                        certificateId={row.certificate_id}
                      />
                    </div>
                  )}
              </article>
            );
          })}
        </div>
      )}
      <div className="status-explainer">
        <h2>完課不等於積分已登錄</h2>
        <p>
          「已完課」代表平台條件完成；只有認可單位確認後，才會顯示「積分已登錄」。
        </p>
      </div>
    </section>
  );
}
