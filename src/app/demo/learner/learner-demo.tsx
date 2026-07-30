"use client";

import Image from "next/image";
import Link from "next/link";
import { type ReactNode, useEffect, useReducer, useState } from "react";
import { useAccessibleModal } from "@/components/use-accessible-modal";
import {
  continueLearningCourse,
  learnerDemoCertificate,
  learnerDemoOrders,
  learnerDemoPurchasedCourses,
  learnerDemoRecommendations,
  type LearnerDemoCourse,
} from "./data";
import {
  createInitialLearnerDemoState,
  demoSecondsUntil,
  demoCartSubtotal,
  demoCouponDiscount,
  filterLearnerDemoCourses,
  formatDemoSessionTimestamp,
  getLearnerDemoCourseFilterCounts,
  getLearnerDemoCartTotal,
  learnerDemoReducer,
  nextDemoSessionTimestamp,
  type LearnerDemoCourseFilter,
  type LearnerDemoOverlay,
  type LearnerDemoView,
} from "./learner-demo-state";
import styles from "./learner-demo.module.css";

type IconName =
  | "arrow"
  | "bookmark"
  | "calendar"
  | "cart"
  | "certificate"
  | "check"
  | "clock"
  | "close"
  | "coupon"
  | "heart"
  | "home"
  | "play"
  | "receipt"
  | "shield";

const viewLabels: Record<LearnerDemoView, string> = {
  overview: "學習總覽",
  courses: "我的課程",
  records: "證明與紀錄",
  saved: "收藏與優惠",
};

const courseFilterOptions = [
  { id: "all", label: "全部" },
  { id: "learning", label: "學習中" },
  { id: "upcoming", label: "等待開課" },
  { id: "completed", label: "已完成" },
] satisfies ReadonlyArray<{
  id: LearnerDemoCourseFilter;
  label: string;
}>;

const iconPaths: Record<IconName, ReactNode> = {
  arrow: <path d="m9 5 7 7-7 7" />,
  bookmark: (
    <path d="M6.5 4.75A1.75 1.75 0 0 1 8.25 3h7.5a1.75 1.75 0 0 1 1.75 1.75V21L12 17.2 6.5 21V4.75Z" />
  ),
  calendar: (
    <>
      <rect height="16" rx="2" width="18" x="3" y="5" />
      <path d="M7 3v4m10-4v4M3 10h18" />
    </>
  ),
  cart: (
    <>
      <path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.4L21 7H6" />
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
    </>
  ),
  certificate: (
    <>
      <path d="M6 3h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M8 8h8M8 12h5m-2 7 1 3 2-1 2 1 1-3" />
    </>
  ),
  check: <path d="m5 12.5 4.25 4.25L19 7" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  coupon: (
    <>
      <path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4V6Z" />
      <path d="M12 7.5v9" />
    </>
  ),
  heart: (
    <path d="M20.8 5.9a5.1 5.1 0 0 0-7.2 0L12 7.5l-1.6-1.6a5.1 5.1 0 0 0-7.2 7.2L12 22l8.8-8.9a5.1 5.1 0 0 0 0-7.2Z" />
  ),
  home: (
    <>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v11h14V10M9 21v-7h6v7" />
    </>
  ),
  play: <path d="m9 7 8 5-8 5V7Z" />,
  receipt: (
    <>
      <path d="M6 3h12v19l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6m-6 4h6m-6 4h4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 21 7v6.2c0 5.4-3.1 9.6-9 11.8-5.9-2.2-9-6.4-9-11.8V7l9-4Z" />
      <path d="m8 13 2.5 2.5L16 10" />
    </>
  ),
};

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
    >
      {iconPaths[name]}
    </svg>
  );
}

function formatCountdown(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    { value: String(days).padStart(2, "0"), label: "天" },
    { value: String(hours).padStart(2, "0"), label: "時" },
    { value: String(minutes).padStart(2, "0"), label: "分" },
    { value: String(seconds).padStart(2, "0"), label: "秒" },
  ];
}

function formatPrice(value: number) {
  return `NT$${value.toLocaleString("zh-TW")}`;
}

function CountdownCard({
  onShowCourses,
  sessionTimestamp,
}: {
  onShowCourses: () => void;
  sessionTimestamp: number;
}) {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const countdown =
    remainingSeconds === null
      ? ["天", "時", "分", "秒"].map((label) => ({ value: "--", label }))
      : formatCountdown(remainingSeconds);

  useEffect(() => {
    const update = () =>
      setRemainingSeconds(demoSecondsUntil(sessionTimestamp, Date.now()));
    update();
    const interval = window.setInterval(() => {
      update();
    }, 1000);

    return () => window.clearInterval(interval);
  }, [sessionTimestamp]);

  return (
    <article className={styles.countdownCard}>
      <div className={styles.countdownHeading}>
        <span>
          <Icon name="calendar" size={21} />
        </span>
        <div>
          <p>下一堂直播課</p>
          <strong>長者六力與整合式健康評估</strong>
        </div>
      </div>
      <div className={styles.countdown} aria-label="上課倒數">
        {countdown.map((part) => (
          <span key={part.label}>
            <strong>{part.value}</strong>
            <small>{part.label}</small>
          </span>
        ))}
      </div>
      <div className={styles.countdownFooter}>
        <span>{formatDemoSessionTimestamp(sessionTimestamp)}</span>
        <button onClick={onShowCourses} type="button">
          查看課程
        </button>
      </div>
    </article>
  );
}

function CourseCard({
  course,
  favorite,
  onToggleFavorite,
}: {
  course: LearnerDemoCourse;
  favorite: boolean;
  onToggleFavorite: () => void;
}) {
  return (
    <article className={styles.courseCard}>
      <div className={styles.courseImage}>
        <Image
          alt={course.imageAlt}
          fill
          sizes="(max-width: 760px) 92vw, (max-width: 1120px) 44vw, 350px"
          src={course.image}
        />
        <span className={styles.deliveryBadge}>{course.delivery}</span>
        <button
          aria-label={
            favorite ? `取消收藏 ${course.title}` : `收藏 ${course.title}`
          }
          aria-pressed={favorite}
          className={`${styles.favoriteButton} ${
            favorite ? styles.favoriteActive : ""
          }`}
          onClick={onToggleFavorite}
          type="button"
        >
          <Icon name="heart" size={19} />
        </button>
      </div>
      <div className={styles.courseCardBody}>
        <p>{course.category}</p>
        <h3>{course.title}</h3>
        <div className={styles.courseMeta}>
          <span>{course.duration}</span>
          <span>{course.credit}</span>
        </div>
        <div className={styles.courseCardFooter}>
          <strong>{formatPrice(course.price)}</strong>
          <Link href={`/courses/demo/${course.slug}`}>
            查看課程
            <Icon name="arrow" size={16} />
          </Link>
        </div>
      </div>
    </article>
  );
}

function DemoOverlay({
  overlay,
  onClose,
  order,
}: {
  overlay: Exclude<LearnerDemoOverlay, null>;
  onClose: () => void;
  order: (typeof learnerDemoOrders)[number];
}) {
  const dialogRef = useAccessibleModal(true, onClose);
  const overlayContent = {
    certificate: {
      eyebrow: "DEMO CERTIFICATE",
      title: "結訓證明預覽",
      content: (
        <div className={styles.certificatePreview}>
          <span className={styles.certificateSeal}>
            <Icon name="certificate" size={34} />
          </span>
          <p>歲悅學苑・結訓證明</p>
          <h3>{learnerDemoCertificate.learner}</h3>
          <span>已完成</span>
          <strong>{learnerDemoCertificate.course}</strong>
          <dl>
            <div>
              <dt>證明編號</dt>
              <dd>{learnerDemoCertificate.number}</dd>
            </div>
            <div>
              <dt>完成日期</dt>
              <dd>{learnerDemoCertificate.completedAt}</dd>
            </div>
            <div>
              <dt>學習成果</dt>
              <dd>
                {learnerDemoCertificate.duration}・
                {learnerDemoCertificate.score}
              </dd>
            </div>
          </dl>
          <small>{learnerDemoCertificate.note}</small>
        </div>
      ),
    },
    order: {
      eyebrow: "DEMO ORDER",
      title: "訂單明細示範",
      content: (
        <div className={styles.orderDetail}>
          <div>
            <span>訂單編號</span>
            <strong>{order.number}</strong>
          </div>
          <div>
            <span>建立時間</span>
            <strong>{order.placedAt}</strong>
          </div>
          <div>
            <span>付款方式</span>
            <strong>ATM／帳號匯款（示範）</strong>
          </div>
          <div>
            <span>狀態</span>
            <strong className={styles.successText}>已由管理員確認匯款</strong>
          </div>
          <div className={styles.orderItem}>
            <span>{order.item}</span>
            <strong>{formatPrice(order.amount)}</strong>
          </div>
          <p>此為合成訂單，不會建立付款、觀看權限或發票紀錄。</p>
        </div>
      ),
    },
    checkout: {
      eyebrow: "SAFE DEMO CHECKOUT",
      title: "示範到這裡就完成了",
      content: (
        <div className={styles.checkoutNotice}>
          <span>
            <Icon name="shield" size={38} />
          </span>
          <h3>不會送出訂單，也不會要求付款</h3>
          <p>
            正式服務啟用後，這一步會再次向伺服器確認課程價格、折扣與購買人，再產生匯款資訊。
          </p>
          <ul>
            <li>展示資料不會寫入正式資料庫</li>
            <li>不收集身分證、長照字號或信用卡資訊</li>
            <li>可回到課程卡繼續體驗教室與上課流程</li>
          </ul>
          <Link href="/courses/demo/dementia-compassionate-care">
            回到示範課程
            <Icon name="arrow" size={17} />
          </Link>
        </div>
      ),
    },
  }[overlay];

  return (
    <div className={styles.overlay}>
      <button
        aria-label="關閉視窗"
        className={styles.overlayBackdrop}
        onClick={onClose}
        type="button"
      />
      <div
        aria-labelledby="demo-overlay-title"
        aria-modal="true"
        className={styles.overlayPanel}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className={styles.overlayHeader}>
          <div>
            <p>{overlayContent.eyebrow}</p>
            <h2 id="demo-overlay-title">{overlayContent.title}</h2>
          </div>
          <button
            aria-label="關閉"
            data-modal-initial-focus
            onClick={onClose}
            type="button"
          >
            <Icon name="close" size={22} />
          </button>
        </div>
        {overlayContent.content}
      </div>
    </div>
  );
}

export function LearnerDemo() {
  const [state, dispatch] = useReducer(
    learnerDemoReducer,
    undefined,
    createInitialLearnerDemoState,
  );
  const [sessionTimestamp] = useState(() =>
    nextDemoSessionTimestamp(Date.now()),
  );
  const selectedOrder =
    learnerDemoOrders.find(
      (order) => order.number === state.selectedOrderNumber,
    ) ?? learnerDemoOrders[0]!;
  const cartTotal = getLearnerDemoCartTotal(state);
  const courseFilterCounts = getLearnerDemoCourseFilterCounts(
    learnerDemoPurchasedCourses,
  );
  const filteredPurchasedCourses = filterLearnerDemoCourses(
    learnerDemoPurchasedCourses,
    state.courseFilter,
  );

  useEffect(() => {
    if (!state.notice) {
      return;
    }

    const timeout = window.setTimeout(() => {
      dispatch({ type: "clear-notice" });
    }, 3200);

    return () => window.clearTimeout(timeout);
  }, [state.notice]);

  const selectView = (view: LearnerDemoView) => {
    dispatch({ type: "select-view", view });
    window.requestAnimationFrame(() => {
      document
        .getElementById("learner-demo-content")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.demoBanner}>
        <span>安全展示模式</span>
        <p>以下皆為合成學員、課程與訂單資料，不會留下正式紀錄。</p>
        <Link href="/demo">回到角色導覽</Link>
      </div>

      <section className={styles.hero} aria-labelledby="learner-demo-title">
        <div className={styles.heroDecoration} aria-hidden="true" />
        <div className={styles.shell}>
          <div className={styles.heroTopline}>
            <p>DEMO 01 / 03 · B2C LEARNER CENTER</p>
            <Link href="/demo/organization">
              下一站：機構培訓
              <Icon name="arrow" size={17} />
            </Link>
          </div>
          <div className={styles.heroGrid}>
            <div className={styles.profileIntro}>
              <div className={styles.avatar} aria-hidden="true">
                美華
              </div>
              <div>
                <span className={styles.welcome}>早安，林美華</span>
                <h1 id="learner-demo-title">今天想從哪一堂繼續？</h1>
                <p>
                  照顧服務員・手機 0912 *** 168
                  <span>展示帳號</span>
                </p>
              </div>
            </div>

            <CountdownCard
              onShowCourses={() => selectView("courses")}
              sessionTimestamp={sessionTimestamp}
            />
          </div>
        </div>
      </section>

      <nav className={styles.tabBar} aria-label="學員中心示範分頁">
        <div className={styles.shell}>
          {(Object.entries(viewLabels) as [LearnerDemoView, string][]).map(
            ([view, label]) => (
              <button
                aria-controls={`learner-panel-${view}`}
                aria-selected={state.activeView === view}
                className={state.activeView === view ? styles.activeTab : ""}
                id={`learner-tab-${view}`}
                key={view}
                onClick={() => selectView(view)}
                role="tab"
                type="button"
              >
                <Icon
                  name={
                    view === "overview"
                      ? "home"
                      : view === "courses"
                        ? "play"
                        : view === "records"
                          ? "certificate"
                          : "bookmark"
                  }
                  size={19}
                />
                {label}
                {view === "saved" && <span className={styles.navCount}>3</span>}
              </button>
            ),
          )}
        </div>
      </nav>

      <main
        className={`${styles.shell} ${styles.dashboard}`}
        id="learner-demo-content"
      >
        <div className={styles.sectionIntro}>
          <div>
            <p>MY LEARNING</p>
            <h2>{viewLabels[state.activeView]}</h2>
          </div>
          <span>
            <Icon name="shield" size={17} />
            合成資料，不具正式效力
          </span>
        </div>

        {state.activeView === "overview" && (
          <section
            aria-labelledby="learner-tab-overview"
            className={styles.panel}
            id="learner-panel-overview"
            role="tabpanel"
          >
            <div className={styles.metricGrid}>
              <button onClick={() => selectView("courses")} type="button">
                <span className={styles.metricIcon}>
                  <Icon name="play" size={22} />
                </span>
                <small>進行中的課程</small>
                <strong>1</strong>
                <em>繼續上課</em>
              </button>
              <button onClick={() => selectView("courses")} type="button">
                <span className={styles.metricIcon}>
                  <Icon name="clock" size={22} />
                </span>
                <small>上課倒數</small>
                <strong>即將</strong>
                <em>1 堂等待開課</em>
              </button>
              <button onClick={() => selectView("records")} type="button">
                <span className={styles.metricIcon}>
                  <Icon name="certificate" size={22} />
                </span>
                <small>結訓證明</small>
                <strong>1</strong>
                <em>查看證明</em>
              </button>
              <button onClick={() => selectView("saved")} type="button">
                <span className={styles.metricIcon}>
                  <Icon name="cart" size={22} />
                </span>
                <small>購物車摘要</small>
                <strong>1 堂</strong>
                <em>{formatPrice(cartTotal)}</em>
              </button>
            </div>

            <section className={styles.continueSection}>
              <div className={styles.blockHeading}>
                <div>
                  <p>CONTINUE LEARNING</p>
                  <h2>繼續學習</h2>
                </div>
                <button onClick={() => selectView("courses")} type="button">
                  查看全部我的課程
                  <Icon name="arrow" size={17} />
                </button>
              </div>
              <article className={styles.continueCard}>
                <div className={styles.continueImage}>
                  <Image
                    alt={continueLearningCourse.imageAlt}
                    fill
                    priority
                    sizes="(max-width: 820px) 92vw, 500px"
                    src={continueLearningCourse.image}
                  />
                  <span>
                    <Icon name="play" size={31} />
                  </span>
                </div>
                <div className={styles.continueBody}>
                  <div className={styles.courseLabels}>
                    <span>{continueLearningCourse.delivery}</span>
                    <span>{continueLearningCourse.category}</span>
                  </div>
                  <h3>{continueLearningCourse.title}</h3>
                  <p>上次看到：第 5 單元｜安心對話四步驟</p>
                  <div className={styles.progressSummary}>
                    <div>
                      <span>有效觀看 64 / 95 分鐘</span>
                      <strong>68%</strong>
                    </div>
                    <div
                      aria-label="課程進度 68%"
                      className={styles.progressTrack}
                      role="progressbar"
                    >
                      <span style={{ width: "68%" }} />
                    </div>
                  </div>
                  <div className={styles.continueActions}>
                    <Link
                      className={styles.primaryAction}
                      href="/courses/demo/dementia-compassionate-care/classroom"
                    >
                      <Icon name="play" size={18} />
                      從第 5 單元繼續
                    </Link>
                    <Link
                      className={styles.textAction}
                      href="/courses/demo/dementia-compassionate-care"
                    >
                      查看課程資訊
                    </Link>
                  </div>
                </div>
                <aside className={styles.learningChecklist}>
                  <p>完課條件</p>
                  <ul>
                    <li className={styles.done}>
                      <Icon name="check" size={16} />
                      身分資料已確認
                    </li>
                    <li>
                      <Icon name="clock" size={16} />
                      有效觀看尚差 31 分鐘
                    </li>
                    <li>
                      <Icon name="receipt" size={16} />
                      課後測驗尚未作答
                    </li>
                  </ul>
                </aside>
              </article>
            </section>

            <section className={styles.recommendationSection}>
              <div className={styles.blockHeading}>
                <div>
                  <p>FOR YOU</p>
                  <h2>課程推薦</h2>
                </div>
                <span>依照「照顧服務員」與最近學習主題推薦</span>
              </div>
              <div className={styles.courseGrid}>
                {learnerDemoRecommendations.map((course) => (
                  <CourseCard
                    course={course}
                    favorite={state.favoriteSlugs.includes(course.slug)}
                    key={course.slug}
                    onToggleFavorite={() =>
                      dispatch({
                        type: "toggle-favorite",
                        slug: course.slug,
                      })
                    }
                  />
                ))}
              </div>
            </section>
          </section>
        )}

        {state.activeView === "courses" && (
          <section
            aria-labelledby="learner-tab-courses"
            className={styles.panel}
            id="learner-panel-courses"
            role="tabpanel"
          >
            <div className={styles.courseFilterRow}>
              <div aria-label="篩選我的課程" role="group">
                {courseFilterOptions.map((filter) => {
                  const active = state.courseFilter === filter.id;
                  return (
                    <button
                      aria-controls="learner-demo-purchased-list"
                      aria-pressed={active}
                      className={active ? styles.filterActive : undefined}
                      key={filter.id}
                      onClick={() =>
                        dispatch({
                          type: "select-course-filter",
                          filter: filter.id,
                        })
                      }
                      type="button"
                    >
                      {filter.label} {courseFilterCounts[filter.id]}
                    </button>
                  );
                })}
              </div>
              <p>
                預錄課購買後可立即開始；有指定時間的直播／混合課會顯示上課倒數。
              </p>
            </div>
            <div
              aria-label={`目前顯示 ${filteredPurchasedCourses.length} 門課程`}
              className={styles.purchasedList}
              id="learner-demo-purchased-list"
            >
              {filteredPurchasedCourses.map((course) => (
                <article className={styles.purchasedCard} key={course.slug}>
                  <div className={styles.purchasedImage}>
                    <Image
                      alt={course.imageAlt}
                      fill
                      sizes="(max-width: 760px) 92vw, 260px"
                      src={course.image}
                    />
                  </div>
                  <div className={styles.purchasedBody}>
                    <div className={styles.purchasedTopline}>
                      <span
                        className={`${styles.statusPill} ${
                          course.status === "已完成"
                            ? styles.statusComplete
                            : course.status === "等待開課"
                              ? styles.statusWaiting
                              : styles.statusLearning
                        }`}
                      >
                        {course.status}
                      </span>
                      <span>{course.delivery}</span>
                    </div>
                    <p>{course.category}</p>
                    <h3>{course.title}</h3>
                    <div className={styles.purchasedProgress}>
                      <div>
                        <span>{course.watched}</span>
                        <strong>{course.progress}%</strong>
                      </div>
                      <div
                        aria-label={`課程進度 ${course.progress}%`}
                        className={styles.progressTrack}
                        role="progressbar"
                      >
                        <span style={{ width: `${course.progress}%` }} />
                      </div>
                    </div>
                    <small>{course.nextAction}</small>
                  </div>
                  <div className={styles.purchasedActions}>
                    {course.status === "學習中" ? (
                      <Link
                        className={styles.primaryAction}
                        href={`/courses/demo/${course.slug}/classroom`}
                      >
                        繼續上課
                        <Icon name="arrow" size={16} />
                      </Link>
                    ) : (
                      <Link
                        className={styles.secondaryAction}
                        href={`/courses/demo/${course.slug}`}
                      >
                        {course.status === "已完成"
                          ? "查看課程"
                          : "查看課前資訊"}
                      </Link>
                    )}
                    {course.status === "已完成" && (
                      <button
                        onClick={() =>
                          dispatch({
                            type: "open-overlay",
                            overlay: "certificate",
                          })
                        }
                        type="button"
                      >
                        查看結訓證明
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {filteredPurchasedCourses.length === 0 && (
                <div className={styles.emptyState} role="status">
                  <Icon name="bookmark" size={34} />
                  <h3>這個分類目前沒有課程</h3>
                  <p>切換到其他狀態，或查看全部已購買課程。</p>
                  <button
                    onClick={() =>
                      dispatch({
                        type: "select-course-filter",
                        filter: "all",
                      })
                    }
                    type="button"
                  >
                    查看全部課程
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {state.activeView === "records" && (
          <section
            aria-labelledby="learner-tab-records"
            className={styles.panel}
            id="learner-panel-records"
            role="tabpanel"
          >
            <div className={styles.recordGrid}>
              <section className={styles.certificateSection}>
                <div className={styles.blockHeading}>
                  <div>
                    <p>ACHIEVEMENTS</p>
                    <h2>結訓證明</h2>
                  </div>
                  <span>共 1 張</span>
                </div>
                <article className={styles.certificateCard}>
                  <div className={styles.certificateIcon}>
                    <Icon name="certificate" size={32} />
                  </div>
                  <div>
                    <span>已核發・非積分示範</span>
                    <h3>{learnerDemoCertificate.course}</h3>
                    <p>
                      {learnerDemoCertificate.completedAt} 完成・
                      {learnerDemoCertificate.score}
                    </p>
                    <small>編號 {learnerDemoCertificate.number}</small>
                  </div>
                  <button
                    onClick={() =>
                      dispatch({
                        type: "open-overlay",
                        overlay: "certificate",
                      })
                    }
                    type="button"
                  >
                    預覽證明
                  </button>
                </article>
              </section>

              <aside className={styles.learningSummary}>
                <p>學習成果摘要</p>
                <dl>
                  <div>
                    <dt>累積有效觀看</dt>
                    <dd>132 分鐘</dd>
                  </div>
                  <div>
                    <dt>已完成課程</dt>
                    <dd>1 堂</dd>
                  </div>
                  <div>
                    <dt>測驗平均</dt>
                    <dd>92 分</dd>
                  </div>
                </dl>
                <small>
                  正式環境只會顯示通過所有資格、觀看、測驗與滿意度條件的證明。
                </small>
              </aside>
            </div>

            <section className={styles.orderSection}>
              <div className={styles.blockHeading}>
                <div>
                  <p>PURCHASE HISTORY</p>
                  <h2>已購買的課程紀錄</h2>
                </div>
                <span>最近 2 筆合成訂單</span>
              </div>
              <div className={styles.orderTable}>
                <div className={styles.orderTableHead}>
                  <span>訂單資訊</span>
                  <span>課程</span>
                  <span>金額</span>
                  <span>狀態</span>
                  <span />
                </div>
                {learnerDemoOrders.map((order) => (
                  <article key={order.number}>
                    <div>
                      <strong>{order.number}</strong>
                      <small>{order.placedAt}</small>
                    </div>
                    <p>{order.item}</p>
                    <strong>{formatPrice(order.amount)}</strong>
                    <span className={styles.paidStatus}>
                      <Icon name="check" size={15} />
                      {order.status}
                    </span>
                    <button
                      onClick={() =>
                        dispatch({
                          type: "open-order",
                          orderNumber: order.number,
                        })
                      }
                      type="button"
                    >
                      查看明細
                    </button>
                  </article>
                ))}
              </div>
            </section>
          </section>
        )}

        {state.activeView === "saved" && (
          <section
            aria-labelledby="learner-tab-saved"
            className={styles.panel}
            id="learner-panel-saved"
            role="tabpanel"
          >
            <section className={styles.favoritesSection}>
              <div className={styles.blockHeading}>
                <div>
                  <p>SAVED COURSES</p>
                  <h2>我的收藏</h2>
                </div>
                <span>目前收藏 {state.favoriteSlugs.length} 堂</span>
              </div>
              {state.favoriteSlugs.length > 0 ? (
                <div className={styles.courseGrid}>
                  {learnerDemoRecommendations
                    .filter((course) =>
                      state.favoriteSlugs.includes(course.slug),
                    )
                    .map((course) => (
                      <CourseCard
                        course={course}
                        favorite
                        key={course.slug}
                        onToggleFavorite={() =>
                          dispatch({
                            type: "toggle-favorite",
                            slug: course.slug,
                          })
                        }
                      />
                    ))}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <Icon name="bookmark" size={36} />
                  <h3>目前沒有收藏課程</h3>
                  <p>回到學習總覽，就能把感興趣的示範課程收藏起來。</p>
                  <button onClick={() => selectView("overview")} type="button">
                    看課程推薦
                  </button>
                </div>
              )}
            </section>

            <div className={styles.commerceGrid}>
              <section className={styles.couponSection}>
                <div className={styles.blockHeading}>
                  <div>
                    <p>MY COUPONS</p>
                    <h2>我的折扣</h2>
                  </div>
                  <span>{state.couponApplied ? "已套用" : "1 張可使用"}</span>
                </div>
                <article className={styles.couponCard}>
                  <div className={styles.couponValue}>
                    <small>課程現折</small>
                    <strong>NT$100</strong>
                  </div>
                  <div className={styles.couponBody}>
                    <span>安心進修券・公開 Demo 專用</span>
                    <h3>單堂課程滿 NT$500 可使用</h3>
                    <p>示範期限 2026/08/31・每筆訂單限用一張</p>
                    <button
                      disabled={state.couponApplied}
                      onClick={() => dispatch({ type: "apply-coupon" })}
                      type="button"
                    >
                      {state.couponApplied ? "已套用至購物車" : "領取並套用"}
                    </button>
                  </div>
                </article>
              </section>

              <section className={styles.cartSection}>
                <div className={styles.blockHeading}>
                  <div>
                    <p>DEMO CART</p>
                    <h2>購物車摘要</h2>
                  </div>
                  <span>1 堂課</span>
                </div>
                <article className={styles.cartCard}>
                  <div className={styles.cartCourse}>
                    <div>
                      <Image
                        alt={continueLearningCourse.imageAlt}
                        fill
                        sizes="90px"
                        src={continueLearningCourse.image}
                      />
                    </div>
                    <p>
                      <strong>{continueLearningCourse.title}</strong>
                      <span>{continueLearningCourse.delivery}</span>
                    </p>
                    <strong>{formatPrice(demoCartSubtotal)}</strong>
                  </div>
                  <dl>
                    <div>
                      <dt>課程小計</dt>
                      <dd>{formatPrice(demoCartSubtotal)}</dd>
                    </div>
                    <div
                      className={
                        state.couponApplied ? styles.discountActive : ""
                      }
                    >
                      <dt>折扣券</dt>
                      <dd>
                        {state.couponApplied
                          ? `-${formatPrice(demoCouponDiscount)}`
                          : "尚未套用"}
                      </dd>
                    </div>
                    <div className={styles.cartTotal}>
                      <dt>示範總計</dt>
                      <dd>{formatPrice(cartTotal)}</dd>
                    </div>
                  </dl>
                  <button
                    className={styles.checkoutButton}
                    onClick={() =>
                      dispatch({
                        type: "open-overlay",
                        overlay: "checkout",
                      })
                    }
                    type="button"
                  >
                    前往示範結帳
                    <Icon name="arrow" size={17} />
                  </button>
                  <small>安全展示模式不會產生訂單、付款資訊或觀看權限。</small>
                </article>
              </section>
            </div>
          </section>
        )}
      </main>

      <section className={styles.nextDemo}>
        <div className={styles.shell}>
          <div>
            <p>完成個人學員示範了嗎？</p>
            <h2>下一站，看機構如何用點數派課給員工。</h2>
          </div>
          <Link href="/demo/organization">
            進入機構培訓 Demo
            <Icon name="arrow" size={18} />
          </Link>
        </div>
      </section>

      {state.notice && (
        <div aria-live="polite" className={styles.toast} role="status">
          <Icon name="check" size={17} />
          {state.notice}
        </div>
      )}

      {state.overlay && (
        <DemoOverlay
          onClose={() => dispatch({ type: "close-overlay" })}
          order={selectedOrder}
          overlay={state.overlay}
        />
      )}
    </div>
  );
}
