import Link from "next/link";
import { redirect } from "next/navigation";
import { readLearnerCenterRows } from "@/application/learner-center";
import { CertificateDownloadButton } from "@/components/certificate-download-button";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import { presentStatus } from "@/domain/presentation";
import { requireUser } from "@/infrastructure/supabase/server";

export default async function LearnerCertificatesPage() {
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const learningState = await readLearnerCenterRows(supabase)
    .then((data) => ({ available: true as const, data }))
    .catch(() => ({ available: false as const, data: [] }));
  const rows = learningState.data;
  const certificates = rows.filter(
    (row) => row.certificate_id && row.certificate_status,
  );

  if (!learningState.available) {
    return (
      <section className="learner-order-unavailable learner-portal-shell-width">
        <span aria-hidden="true">
          <LearnerPortalIcon name="certificate" size={40} />
        </span>
        <p className="learner-kicker">結訓證明</p>
        <h1>目前無法安全讀取結訓證明</h1>
        <p>
          系統不會把連線問題顯示成「沒有證明」。請稍後重新讀取，已核發的成果不會因此消失。
        </p>
        <div>
          <Link className="button" href="/learner/certificates">
            重新讀取
          </Link>
          <Link className="button secondary" href="/support">
            聯絡客服
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="learner-portal-page learner-portal-shell-width">
      <header className="learner-page-heading">
        <div>
          <p className="learner-kicker">結訓證明</p>
          <h1>我的學習成果</h1>
          <p>平台完課、正式證明與積分登錄是不同階段，會分開顯示狀態。</p>
        </div>
        {certificates.length > 0 && (
          <strong>{certificates.length} 份證明</strong>
        )}
      </header>
      {certificates.length === 0 ? (
        <div className="learner-friendly-empty">
          <span aria-hidden="true">
            <LearnerPortalIcon name="certificate" size={40} />
          </span>
          <h2>目前還沒有結訓證明</h2>
          <p>完成觀看、測驗、滿意度與必要身分審核後，結果會出現在這裡。</p>
          <Link className="button" href="/learner">
            回到我的課程
          </Link>
        </div>
      ) : (
        <div className="learner-certificate-grid">
          {certificates.map((row) => {
            const status = presentStatus("certificate", row.certificate_status);
            const downloadable = ["active", "submitted", "credited"].includes(
              row.certificate_status ?? "",
            );
            return (
              <article key={row.certificate_id}>
                <div className="learner-certificate-seal" aria-hidden="true">
                  <LearnerPortalIcon name="certificate" size={34} />
                </div>
                <span className={`status status-${status.tone}`}>
                  {status.label}
                </span>
                <h2>{row.course_title}</h2>
                <p>{status.nextAction ?? status.description}</p>
                {downloadable && row.certificate_id ? (
                  <CertificateDownloadButton
                    certificateId={row.certificate_id}
                  />
                ) : (
                  <Link href={`/learner/courses/${row.enrollment_id}`}>
                    查看缺少的條件
                  </Link>
                )}
              </article>
            );
          })}
        </div>
      )}
      <aside className="learner-regulation-note">
        <strong>請留意</strong>
        <p>
          「已完課」代表完成平台規定；只有認可單位確認並完成登錄，才代表長照積分已正式認列。
        </p>
      </aside>
    </section>
  );
}
