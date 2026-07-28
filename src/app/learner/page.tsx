import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readLearnerCenterRows } from "@/application/learner-center";
import { readOwnOrders } from "@/application/workspace";
import { IdentityRecoveryForm } from "@/components/identity-recovery-form";
import { LearnerCountdown } from "@/components/learner-countdown";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import { ShowcaseCourseCard } from "@/components/showcase-course-card";
import { showcaseCourses } from "@/content/showcase-courses";
import { presentStatus } from "@/domain/presentation";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

const deliveryLabels = {
  recorded: "預錄課",
  live: "直播課",
  hybrid: "混合課",
};

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

function courseImage(title: string) {
  return (
    showcaseCourses.find((course) => course.title === title)?.coverImage ??
    "/images/suiyue-original/course-dementia-care.jpg"
  );
}

export default async function LearnerDashboard({
  searchParams,
}: {
  searchParams: Promise<{ restricted?: string }>;
}) {
  const restricted = (await searchParams).restricted === "1";
  const { supabase, user } = await requireUser().catch(() =>
    redirect("/login"),
  );
  const [rows, orders] = await Promise.all([
    readLearnerCenterRows(supabase).catch(() => []),
    readOwnOrders(supabase, { limit: 4 }).catch(() => []),
  ]);
  const name =
    typeof user.user_metadata.display_name === "string" &&
    user.user_metadata.display_name.trim()
      ? user.user_metadata.display_name.trim()
      : "歲悅學員";
  const upcoming = rows
    .filter((row) => row.next_live_starts_at)
    .sort(
      (a, b) =>
        Date.parse(a.next_live_starts_at ?? "") -
        Date.parse(b.next_live_starts_at ?? ""),
    );
  const activeRows = rows.filter((row) =>
    ["active", "needs_correction"].includes(row.enrollment_status),
  );
  const completedRows = rows.filter((row) =>
    ["completed", "submitted", "credited"].includes(row.enrollment_status),
  );
  const certificateRows = rows.filter((row) => row.certificate_id);
  const recommendationCourses = showcaseCourses
    .filter((course) => !rows.some((row) => row.course_title === course.title))
    .slice(0, 3);

  return (
    <div className="learner-dashboard">
      <section className="learner-dashboard-hero">
        <div className="learner-portal-shell-width">
          <div>
            <p className="learner-kicker">我的課程</p>
            <h1>{name}，今天想從哪裡開始？</h1>
            <p>上課倒數、學習進度、訂單與結訓證明都整理在同一個地方。</p>
          </div>
          <Link className="learner-hero-action" href="/learner/catalog">
            <span>
              <LearnerPortalIcon name="search" />
            </span>
            <div>
              <small>還想學更多？</small>
              <strong>探索長照課程</strong>
            </div>
            <LearnerPortalIcon name="chevron" />
          </Link>
        </div>
      </section>

      <div className="learner-portal-shell-width learner-dashboard-content">
        {restricted && (
          <div className="warning-panel">
            <strong>這次登入需要再確認</strong>
            <p>
              為保護付款、身分與證明資料，部分功能已暫時鎖定，完成確認後就能繼續。
            </p>
            <IdentityRecoveryForm />
          </div>
        )}

        <section aria-labelledby="learning-overview-title">
          <div className="learner-section-heading">
            <div>
              <p className="learner-kicker">你的學習概況</p>
              <h2 id="learning-overview-title">一眼看懂目前進度</h2>
            </div>
          </div>
          <div className="learner-overview-stats">
            <article>
              <span aria-hidden="true">
                <LearnerPortalIcon name="book" />
              </span>
              <strong>{activeRows.length}</strong>
              <p>學習中課程</p>
            </article>
            <article>
              <span aria-hidden="true">
                <LearnerPortalIcon name="home" />
              </span>
              <strong>{upcoming.length}</strong>
              <p>即將開始</p>
            </article>
            <article>
              <span aria-hidden="true">
                <LearnerPortalIcon name="certificate" />
              </span>
              <strong>{certificateRows.length}</strong>
              <p>結訓證明</p>
            </article>
            <article>
              <span aria-hidden="true">
                <LearnerPortalIcon name="order" />
              </span>
              <strong>{orders.length}</strong>
              <p>近期訂單</p>
            </article>
          </div>
        </section>

        <section aria-labelledby="upcoming-title">
          <div className="learner-section-heading">
            <div>
              <p className="learner-kicker">上課倒數</p>
              <h2 id="upcoming-title">接下來要上的課</h2>
            </div>
            <span>時間皆為台灣時間</span>
          </div>
          {upcoming.length > 0 ? (
            <div className="learner-upcoming-grid">
              {upcoming.slice(0, 3).map((row) => (
                <article key={row.enrollment_id}>
                  <div className="learner-upcoming-cover">
                    <Image
                      alt=""
                      fill
                      sizes="(max-width: 760px) 100vw, 40vw"
                      src={courseImage(row.course_title)}
                    />
                  </div>
                  <div>
                    <span>{deliveryLabels[row.delivery_type]}</span>
                    <h3>{row.course_title}</h3>
                    <time dateTime={row.next_live_starts_at ?? undefined}>
                      {formatTaipei(row.next_live_starts_at ?? "")}
                    </time>
                    <LearnerCountdown
                      startsAt={row.next_live_starts_at ?? ""}
                    />
                    <Link href={`/learner/courses/${row.enrollment_id}`}>
                      查看上課準備
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="learner-available-now">
              <span aria-hidden="true">
                <LearnerPortalIcon name="book" size={30} />
              </span>
              <div>
                <strong>目前沒有等待開課的直播場次</strong>
                <p>已購買的預錄課會立即出現在下方「我的課程」，可直接開始。</p>
              </div>
              <Link href="#my-learning-list">查看我的課程</Link>
            </div>
          )}
        </section>

        <section aria-labelledby="my-learning-title" id="my-learning-list">
          <div className="learner-section-heading">
            <div>
              <p className="learner-kicker">已購買與機構指派</p>
              <h2 id="my-learning-title">我的課程</h2>
            </div>
            {rows.length > 0 && (
              <span>
                {activeRows.length} 門學習中・{completedRows.length} 門已完成
              </span>
            )}
          </div>
          {rows.length === 0 ? (
            <div className="learner-friendly-empty learner-dashboard-empty">
              <span aria-hidden="true">
                <LearnerPortalIcon name="book" size={40} />
              </span>
              <h2>還沒有可上課的課程</h2>
              <p>匯款資料送出後，仍要等財務確認實際入帳才會開通上課權限。</p>
              <Link className="button" href="/learner/catalog">
                去找第一門課
              </Link>
            </div>
          ) : (
            <div className="learner-course-list">
              {rows.map((row) => {
                const status = presentStatus(
                  "enrollment",
                  row.enrollment_status,
                );
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
                    <div className="learner-course-list-cover">
                      <Image
                        alt=""
                        fill
                        sizes="(max-width: 760px) 100vw, 240px"
                        src={courseImage(row.course_title)}
                      />
                      <span>{deliveryLabels[row.delivery_type]}</span>
                    </div>
                    <div className="learner-course-list-body">
                      <div>
                        <span className={`status status-${status.tone}`}>
                          {status.label}
                        </span>
                        <h3>{row.course_title}</h3>
                        <p>{status.nextAction ?? status.description}</p>
                      </div>
                      <div className="learner-progress-copy">
                        <span>有效觀看</span>
                        <strong>
                          {Math.floor(row.confirmed_valid_seconds / 60)}／
                          {Math.ceil(row.required_seconds / 60)} 分鐘
                        </strong>
                      </div>
                      <div
                        aria-label={`完成 ${progress}%`}
                        aria-valuemax={100}
                        aria-valuemin={0}
                        aria-valuenow={progress}
                        className="learner-course-progress"
                        role="progressbar"
                      >
                        <span style={{ width: `${progress}%` }} />
                      </div>
                      <div className="learner-course-list-actions">
                        <Link
                          className="button"
                          href={`/learner/courses/${row.enrollment_id}`}
                        >
                          {progress > 0 ? "繼續上課" : "開始上課"}
                        </Link>
                        {row.certificate_id && (
                          <Link href="/learner/certificates">查看證明</Link>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="certificate-summary-title">
          <div className="learner-section-heading">
            <div>
              <p className="learner-kicker">學習成果</p>
              <h2 id="certificate-summary-title">結訓證明</h2>
            </div>
            <Link href="/learner/certificates">查看全部</Link>
          </div>
          <div className="learner-certificate-summary">
            <div className="learner-certificate-summary-icon">
              <LearnerPortalIcon name="certificate" size={38} />
            </div>
            <div>
              <strong>
                {certificateRows.length > 0
                  ? `目前有 ${certificateRows.length} 份證明`
                  : "完成條件後會自動產生證明"}
              </strong>
              <p>平台完課、正式證明、認可單位審核與積分登錄會分開標示。</p>
            </div>
            <Link href="/learner/certificates">管理證明</Link>
          </div>
        </section>

        <section aria-labelledby="recommendation-title">
          <div className="learner-section-heading">
            <div>
              <p className="learner-kicker">猜你會需要</p>
              <h2 id="recommendation-title">為你推薦的課程</h2>
            </div>
            <Link href="/learner/catalog">查看全部課程</Link>
          </div>
          <div className="course-grid">
            {recommendationCourses.map((course) => (
              <ShowcaseCourseCard
                course={course}
                key={course.slug}
                learnerMode
              />
            ))}
          </div>
        </section>

        <section aria-labelledby="purchase-history-title">
          <div className="learner-section-heading">
            <div>
              <p className="learner-kicker">購買紀錄</p>
              <h2 id="purchase-history-title">最近的訂單</h2>
            </div>
            <Link href="/learner/orders">查看全部訂單</Link>
          </div>
          {orders.length > 0 ? (
            <div className="learner-order-preview">
              {orders.slice(0, 3).map((order) => {
                const status = presentStatus("order", order.status);
                return (
                  <Link href={`/orders/${order.orderId}`} key={order.orderId}>
                    <div>
                      <span className={`status status-${status.tone}`}>
                        {status.label}
                      </span>
                      <strong>{order.courseTitle}</strong>
                      <small>訂單 {order.orderNumber}</small>
                    </div>
                    <span>
                      NT$ {order.amountDueTwd.toLocaleString("zh-TW")}
                    </span>
                    <LearnerPortalIcon name="chevron" size={20} />
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="learner-available-now">
              <span aria-hidden="true">
                <LearnerPortalIcon name="order" size={30} />
              </span>
              <div>
                <strong>目前沒有訂單紀錄</strong>
                <p>建立匯款訂單後，期限、補件與確認狀態會保留在這裡。</p>
              </div>
              <Link href="/learner/catalog">查看課程</Link>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
