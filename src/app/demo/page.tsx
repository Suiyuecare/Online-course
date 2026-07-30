import type { Metadata } from "next";
import Link from "next/link";
import styles from "./demo.module.css";

export const metadata: Metadata = {
  title: "客戶操作示範",
  description: "歲悅學苑個人學員、機構培訓與平台管理後台的安全操作示範入口。",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
};

const demoPaths = [
  {
    number: "01",
    eyebrow: "B2C · 個人學員",
    title: "從學員中心到進入教室",
    description:
      "先看上課倒數、學習進度、證明、訂單與收藏，再進入課程介紹及教室體驗完整學習流程。",
    status: "可立即操作",
    statusTone: "ready",
    href: "/demo/learner",
    action: "進入學員示範",
    secondaryHref: "/courses",
    secondaryAction: "瀏覽課程總覽",
    highlights: ["學員中心與購課紀錄", "影音教室與大綱", "10 分鐘在席機制"],
    icon: (
      <svg aria-hidden="true" viewBox="0 0 48 48">
        <path d="M24 22.4a8.2 8.2 0 1 0 0-16.4 8.2 8.2 0 0 0 0 16.4Z" />
        <path d="M9.5 42c.8-9.4 5.7-14.1 14.5-14.1S37.7 32.6 38.5 42" />
        <path d="m33.4 22.7 3.1 3.1 6.2-7" />
      </svg>
    ),
  },
  {
    number: "02",
    eyebrow: "B2B · 機構培訓",
    title: "購買點數、派課與追蹤成果",
    description:
      "示範機構申請、員工邀請、點數帳本、課程指派，以及主管查看分鐘、測驗、出席與證明。",
    status: "可立即操作",
    statusTone: "ready",
    href: "/demo/organization",
    action: "進入機構示範",
    secondaryHref: "/organization",
    secondaryAction: "了解機構培訓",
    highlights: ["員工邀請與名冊", "點數帳本與派課", "機構成果報表"],
    icon: (
      <svg aria-hidden="true" viewBox="0 0 48 48">
        <path d="M8 42V15h22v27M30 23h10v19M14 22h4m6 0h1m-11 7h4m6 0h1m-11 7h4m6 0h1m11-7h1m-1 7h1" />
        <path d="M6 42h36M13 15v-5h12v5" />
      </svg>
    ),
  },
  {
    number: "03",
    eyebrow: "OPS · 平台管理員",
    title: "建課、審核與營運處理",
    description:
      "帶看課程建立、影音與題庫、發布檢查、匯款核對、積分資料審核及客服待辦的權限分工。",
    status: "可立即操作",
    statusTone: "ready",
    href: "/demo/staff",
    action: "進入後台示範",
    secondaryHref: "/legal",
    secondaryAction: "查看治理原則",
    highlights: ["課程與題庫管理", "財務及資格審核", "角色權限與稽核"],
    icon: (
      <svg aria-hidden="true" viewBox="0 0 48 48">
        <path d="M24 5.8 39 12v10.4c0 9.1-5.2 16.2-15 20-9.8-3.8-15-10.9-15-20V12l15-6.2Z" />
        <path d="m17.3 24.2 4.5 4.6 9.4-10" />
      </svg>
    ),
  },
] as const;

const agenda = [
  {
    time: "3 分鐘",
    title: "先看平台全貌",
    description: "確認三種使用者如何共用同一套課程、權限與成果資料。",
  },
  {
    time: "8 分鐘",
    title: "個人學員實際操作",
    description: "從找課、看課程介紹，到進入教室了解在席與完課條件。",
  },
  {
    time: "6 分鐘",
    title: "機構培訓工作台",
    description: "查看點數、員工、派課與主管可追蹤的培訓成果。",
  },
  {
    time: "6 分鐘",
    title: "管理後台與風險控管",
    description: "帶看建課、審核、發布檢查、角色權限與稽核紀錄。",
  },
] as const;

export default function DemoHubPage() {
  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="demo-title">
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.shell}>
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <p className={styles.kicker}>SUIYUE ACADEMY · GUIDED DEMO</p>
              <h1 id="demo-title">
                三種角色，
                <span>一次看懂完整學習流程。</span>
              </h1>
              <p className={styles.heroLead}>
                從學員選課、機構派課，到管理員建課與審核，依照下方路徑即可安全展示歲悅學苑。
              </p>
              <div className={styles.heroActions}>
                <a className={styles.primaryButton} href="#demo-paths">
                  選擇示範角色
                </a>
                <a className={styles.secondaryButton} href="#demo-agenda">
                  查看建議流程
                </a>
              </div>
            </div>

            <aside className={styles.safetyCard} aria-label="示範環境說明">
              <span className={styles.safetyIcon} aria-hidden="true">
                <svg viewBox="0 0 32 32">
                  <path d="M16 3 27 7.5v7.6c0 6.7-3.8 11.9-11 14.7-7.2-2.8-11-8-11-14.7V7.5L16 3Z" />
                  <path d="m10.9 16 3.3 3.4 7-7.4" />
                </svg>
              </span>
              <p>安全展示模式</p>
              <strong>操作示範，不產生正式訂單或學習紀錄</strong>
              <ul>
                <li>公開示範課不會計入觀看分鐘</li>
                <li>不會發出正式積分或結訓證明</li>
                <li>機構與管理頁只使用合成展示資料</li>
              </ul>
            </aside>
          </div>
        </div>
      </section>

      <section
        className={`${styles.section} ${styles.pathsSection}`}
        id="demo-paths"
        aria-labelledby="paths-title"
      >
        <div className={styles.shell}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.kicker}>CHOOSE A PATH</p>
              <h2 id="paths-title">你想先從哪個角色開始？</h2>
            </div>
            <p>建議由個人學員開始，再依序帶看機構與管理後台。</p>
          </div>

          <div className={styles.pathGrid}>
            {demoPaths.map((path) => (
              <article className={styles.pathCard} key={path.title}>
                <div className={styles.pathTop}>
                  <span className={styles.pathNumber}>{path.number}</span>
                  <span
                    className={`${styles.statusBadge} ${
                      styles[path.statusTone]
                    }`}
                  >
                    <span aria-hidden="true" />
                    {path.status}
                  </span>
                </div>
                <span className={styles.roleIcon}>{path.icon}</span>
                <p className={styles.pathEyebrow}>{path.eyebrow}</p>
                <h3>{path.title}</h3>
                <p className={styles.pathDescription}>{path.description}</p>
                <ul className={styles.highlightList}>
                  {path.highlights.map((highlight) => (
                    <li key={highlight}>{highlight}</li>
                  ))}
                </ul>
                <div className={styles.cardActions}>
                  <Link className={styles.cardPrimary} href={path.href}>
                    {path.action}
                    <span aria-hidden="true">→</span>
                  </Link>
                  <Link
                    className={styles.cardSecondary}
                    href={path.secondaryHref}
                  >
                    {path.secondaryAction}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        className={`${styles.section} ${styles.agendaSection}`}
        id="demo-agenda"
        aria-labelledby="agenda-title"
      >
        <div className={`${styles.shell} ${styles.agendaGrid}`}>
          <div className={styles.agendaIntro}>
            <p className={styles.kicker}>25-MINUTE WALKTHROUGH</p>
            <h2 id="agenda-title">明天建議照這個順序 Demo</h2>
            <p>
              先讓客戶看懂使用者價值，再展示後台治理；完整流程約 25
              分鐘，仍保留問答時間。
            </p>
            <div className={styles.demoPromise}>
              <strong>現場展示原則</strong>
              <span>只使用展示資料，不輸入客戶真實個資、不上傳正式憑證。</span>
            </div>
          </div>

          <ol className={styles.timeline}>
            {agenda.map((item, index) => (
              <li key={item.title}>
                <span className={styles.timelineIndex} aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <span className={styles.timelineTime}>{item.time}</span>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        className={styles.readinessSection}
        aria-labelledby="ready-title"
      >
        <div className={styles.shell}>
          <div className={styles.readinessPanel}>
            <div>
              <p className={styles.kicker}>DEMO READINESS</p>
              <h2 id="ready-title">開始前 30 秒快速確認</h2>
            </div>
            <ul className={styles.checkGrid}>
              <li>
                <span aria-hidden="true">✓</span>
                使用 Chrome 或 Safari 最新版
              </li>
              <li>
                <span aria-hidden="true">✓</span>
                公開示範課可直接開啟
              </li>
              <li>
                <span aria-hidden="true">✓</span>
                機構與管理頁可直接安全操作
              </li>
              <li>
                <span aria-hidden="true">✓</span>
                全程不輸入真實個資
              </li>
            </ul>
            <Link
              className={styles.startButton}
              href="/courses/demo/dementia-compassionate-care"
            >
              開始第一段示範
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
