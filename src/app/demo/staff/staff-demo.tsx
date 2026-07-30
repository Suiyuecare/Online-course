"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import styles from "./staff-demo.module.css";

type Panel = "course" | "finance" | "attendance" | "audit";

const tabs: { id: Panel; label: string; count?: number }[] = [
  { id: "course", label: "課程製作" },
  { id: "finance", label: "匯款審核", count: 2 },
  { id: "attendance", label: "出席異常", count: 3 },
  { id: "audit", label: "稽核紀錄" },
];

const auditEvents = [
  {
    time: "14:32",
    actor: "課程管理員 王小姐",
    action: "更新課程發布資料",
    detail: "調整第 2 單元順序；版本仍為草稿。",
  },
  {
    time: "14:18",
    actor: "財務人員 陳小姐",
    action: "要求補正匯款證明",
    detail: "案件 PAY-240730-018；未變更付款狀態。",
  },
  {
    time: "13:45",
    actor: "系統",
    action: "影片轉檔完成",
    detail: "失智症溝通技巧／單元 1；已通過播放檢查。",
  },
  {
    time: "11:06",
    actor: "平台管理員 林主任",
    action: "維持出席不合格",
    detail: "案件 ATT-0729-03；保留原始心跳與 Zoom 事件。",
  },
];

const paymentCases = [
  {
    id: "PAY-240730-021",
    amount: "NT$ 1,200",
    payer: "陳○芬",
    lastFive: "90418",
    uploadedAt: "10:42",
    course: "失智症照顧溝通",
    bankAmount: "NT$ 1,200",
    match: true,
  },
  {
    id: "PAY-240730-018",
    amount: "NT$ 6,000",
    payer: "安心居護所",
    lastFive: "無法辨識",
    uploadedAt: "09:16",
    course: "機構點數 6,000 點",
    bankAmount: "尚未自動配對",
    match: false,
  },
] as const;

const attendanceCases = [
  {
    ref: "ATT-0730-07",
    learner: "林○惠",
    issue: "錄播在席確認逾時",
    evidence: "有效 106 / 120 分鐘・最後心跳 14:06",
    state: "待處理",
    rawEvents: [
      "13:56:12　頁面前景・播放器播放中",
      "14:06:03　最後一筆有效 heartbeat",
      "14:16:03　在席確認逾時・停止計分",
    ],
  },
  {
    ref: "ATT-0729-11",
    learner: "許○明",
    issue: "直播斷線 7 分鐘",
    evidence: "鏡頭 82%・簽到退完整・Zoom 事件延遲",
    state: "建議人工覆核",
    rawEvents: [
      "09:00:18　完成簽到與設備檢查",
      "10:42:06　SDK heartbeat 中斷",
      "10:49:11　Zoom participant joined・重新連線",
      "12:01:42　完成簽退",
    ],
  },
  {
    ref: "ATT-0729-03",
    learner: "吳○玲",
    issue: "漏簽退",
    evidence: "鏡頭 91%・會議離開事件完整",
    state: "等待學員補件",
    rawEvents: [
      "13:00:10　完成簽到",
      "15:58:44　Zoom participant left",
      "16:00:00　場次結束",
      "16:30:00　簽退窗口關閉・未收到簽退",
    ],
  },
] as const;

export function StaffDemo() {
  const [active, setActive] = useState<Panel>("course");
  const [videoReady, setVideoReady] = useState(false);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string>(
    paymentCases[0].id,
  );
  const [paymentReviewStage, setPaymentReviewStage] = useState<
    "pending" | "first-review" | "approved"
  >("pending");
  const [selectedAttendanceRef, setSelectedAttendanceRef] = useState<
    string | null
  >(null);
  const [attendanceReason, setAttendanceReason] = useState("");
  const [message, setMessage] = useState(
    "可切換工作區並操作按鈕；所有結果只保留在這個瀏覽器畫面。",
  );
  const readiness = useMemo(
    () => [
      { label: "基本資料與售價", ready: true, note: "NT$ 1,200" },
      { label: "核定字號與積分", ready: true, note: "北市長照字第 A125 號" },
      {
        label: "付費單元影片",
        ready: videoReady,
        note: videoReady ? "3 / 3 可播放" : "2 / 3 可播放",
      },
      { label: "題庫與及格門檻", ready: true, note: "18 題・80 分" },
      { label: "滿意度與完課條件", ready: true, note: "設定完成" },
    ],
    [videoReady],
  );
  const readyCount = readiness.filter((item) => item.ready).length;
  const selectedPayment =
    paymentCases.find((item) => item.id === selectedPaymentId) ??
    paymentCases[0];
  const selectedAttendance =
    attendanceCases.find((item) => item.ref === selectedAttendanceRef) ?? null;

  function simulate(label: string) {
    setMessage(`${label}已完成示範；正式資料沒有被修改。`);
  }

  return (
    <div className={styles.shell}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>歲悅學苑・營運控制台</p>
          <h1>一個後台，看清楚課程、款項與學習異常</h1>
          <p>
            這條 Demo 會帶客戶看完管理員最常用的四件事：建課、審款、
            處理出席例外，以及回查誰在什麼時間做了什麼。
          </p>
        </div>
        <div className={styles.heroCard}>
          <span>今日待辦</span>
          <strong>8</strong>
          <small>2 筆匯款・3 筆出席・3 項發布檢查</small>
        </div>
      </header>

      <section className={styles.metrics} aria-label="營運摘要">
        <article>
          <span>販售中課程</span>
          <strong>12</strong>
          <small>另有 3 門草稿</small>
        </article>
        <article>
          <span>本週新學員</span>
          <strong>86</strong>
          <small>較上週 +12%</small>
        </article>
        <article>
          <span>待確認款項</span>
          <strong>NT$ 18,600</strong>
          <small>全數為帳號匯款</small>
        </article>
        <article>
          <span>系統狀態</span>
          <strong className={styles.good}>示範正常</strong>
          <small>正式服務仍維持安全關閉</small>
        </article>
      </section>

      <nav className={styles.tabs} aria-label="管理員工作區" role="tablist">
        {tabs.map((tab) => (
          <button
            aria-controls={`panel-${tab.id}`}
            aria-selected={active === tab.id}
            className={active === tab.id ? styles.activeTab : undefined}
            id={`tab-${tab.id}`}
            key={tab.id}
            onClick={() => setActive(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
            {tab.count ? <span>{tab.count}</span> : null}
          </button>
        ))}
      </nav>

      <p aria-live="polite" className={styles.liveMessage}>
        {message}
      </p>

      {active === "course" ? (
        <section
          aria-labelledby="tab-course"
          className={styles.panel}
          id="panel-course"
          role="tabpanel"
        >
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.kicker}>草稿課程・版本 3</p>
              <h2>失智症照顧溝通與異常行為應對</h2>
              <p>錄播積分課程・預計 120 分鐘・售價 NT$ 1,200</p>
            </div>
            <span className={styles.draftBadge}>尚未發布</span>
          </div>

          <div className={styles.twoColumns}>
            <div>
              <div className={styles.sectionTitle}>
                <h3>章節與影片</h3>
                <span>3 章・8 單元</span>
              </div>
              <ol className={styles.lessonList}>
                <li>
                  <span>01</span>
                  <div>
                    <strong>認識失智症與常見症狀</strong>
                    <small>影片 28:40・已完成轉檔</small>
                  </div>
                  <b className={styles.readyText}>可播放</b>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <strong>同理溝通的四個步驟</strong>
                    <small>影片 36:15・已完成轉檔</small>
                  </div>
                  <b className={styles.readyText}>可播放</b>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <strong>異常行為的觀察與回應</strong>
                    <small>
                      {videoReady
                        ? "影片 42:08・已完成轉檔"
                        : "影片 42:08・轉檔檢查中"}
                    </small>
                  </div>
                  <b
                    className={videoReady ? styles.readyText : styles.waitText}
                  >
                    {videoReady ? "可播放" : "處理中"}
                  </b>
                </li>
              </ol>
              {!videoReady ? (
                <button
                  className={styles.secondaryButton}
                  onClick={() => {
                    setVideoReady(true);
                    simulate("影片處理完成");
                  }}
                  type="button"
                >
                  模擬影片處理完成
                </button>
              ) : null}
            </div>

            <aside className={styles.readiness}>
              <div className={styles.sectionTitle}>
                <h3>發布檢查</h3>
                <span>
                  {readyCount} / {readiness.length}
                </span>
              </div>
              <div
                aria-label={`發布完成度 ${readyCount} / ${readiness.length}`}
                className={styles.progress}
                role="progressbar"
                aria-valuemax={readiness.length}
                aria-valuemin={0}
                aria-valuenow={readyCount}
              >
                <span
                  style={{
                    width: `${(readyCount / readiness.length) * 100}%`,
                  }}
                />
              </div>
              <ul>
                {readiness.map((item) => (
                  <li key={item.label}>
                    <span
                      aria-hidden="true"
                      className={item.ready ? styles.check : styles.pending}
                    >
                      {item.ready ? "✓" : "!"}
                    </span>
                    <div>
                      <strong>{item.label}</strong>
                      <small>{item.note}</small>
                    </div>
                  </li>
                ))}
              </ul>
              <button
                className={styles.primaryButton}
                disabled={!videoReady}
                onClick={() => simulate("發布檢查")}
                type="button"
              >
                {videoReady ? "送出發布檢查" : "尚有條件未完成"}
              </button>
              <p>正式發布還會由伺服器再次檢查核定、影片與題庫。</p>
            </aside>
          </div>
        </section>
      ) : null}

      {active === "finance" ? (
        <section
          aria-labelledby="tab-finance"
          className={styles.panel}
          id="panel-finance"
          role="tabpanel"
        >
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.kicker}>帳號匯款・雙人覆核</p>
              <h2>待確認款項</h2>
              <p>付款結果頁不會自行開課；只有核對完成才建立權限。</p>
            </div>
          </div>
          <div className={styles.reviewGrid}>
            <div className={styles.queue}>
              {paymentCases.map((payment) => (
                <button
                  aria-pressed={selectedPayment.id === payment.id}
                  className={
                    selectedPayment.id === payment.id
                      ? styles.selectedCase
                      : undefined
                  }
                  key={payment.id}
                  onClick={() => {
                    setSelectedPaymentId(payment.id);
                    setPaymentReviewStage("pending");
                    setMessage(`已切換至 ${payment.id}，尚未修改付款狀態。`);
                  }}
                  type="button"
                >
                  <span>{payment.id}</span>
                  <strong>{payment.amount}</strong>
                  <small>
                    {payment.payer}・末五碼 {payment.lastFive}・
                    {payment.uploadedAt} 上傳
                  </small>
                </button>
              ))}
            </div>
            <article className={styles.proofCard}>
              <div className={styles.fakeProof} aria-label="合成匯款證明預覽">
                <span>示範用匯款證明</span>
                <strong>{selectedPayment.amount}</strong>
                <small>
                  2026 / 07 / 30　帳號末五碼 {selectedPayment.lastFive}
                </small>
              </div>
              <dl>
                <div>
                  <dt>訂單應付</dt>
                  <dd>{selectedPayment.amount}</dd>
                </div>
                <div>
                  <dt>銀行入帳</dt>
                  <dd>{selectedPayment.bankAmount}</dd>
                </div>
                <div>
                  <dt>課程</dt>
                  <dd>{selectedPayment.course}</dd>
                </div>
                <div>
                  <dt>自動比對</dt>
                  <dd
                    className={
                      selectedPayment.match ? styles.good : styles.caution
                    }
                  >
                    {selectedPayment.match
                      ? "金額與末五碼相符"
                      : "資料不足，應要求補正"}
                  </dd>
                </div>
              </dl>
              <div
                aria-live="polite"
                className={`${styles.reviewState} ${
                  paymentReviewStage === "approved" ? styles.reviewApproved : ""
                }`}
              >
                <strong>
                  {paymentReviewStage === "pending"
                    ? "尚未覆核"
                    : paymentReviewStage === "first-review"
                      ? "第一位財務人員已確認，等待第二人覆核"
                      : "兩位不同財務人員已完成模擬覆核"}
                </strong>
                <span>
                  {paymentReviewStage === "approved"
                    ? "正式流程此時才會建立點數或課程權限。"
                    : "付款結果頁本身不會開通任何權限。"}
                </span>
              </div>
              <div className={styles.actions}>
                <button
                  className={styles.secondaryButton}
                  onClick={() => {
                    setPaymentReviewStage("pending");
                    simulate(`${selectedPayment.id} 補正通知`);
                  }}
                  type="button"
                >
                  要求補正
                </button>
                <button
                  className={styles.primaryButton}
                  disabled={
                    !selectedPayment.match || paymentReviewStage === "approved"
                  }
                  onClick={() => {
                    if (paymentReviewStage === "pending") {
                      setPaymentReviewStage("first-review");
                      setMessage(
                        "第一位財務人員已完成模擬確認；仍需另一位具權限人員覆核。",
                      );
                    } else {
                      setPaymentReviewStage("approved");
                      setMessage(
                        "第二位財務人員已完成模擬核准；正式資料仍未修改。",
                      );
                    }
                  }}
                  type="button"
                >
                  {paymentReviewStage === "first-review"
                    ? "模擬第二人覆核"
                    : paymentReviewStage === "approved"
                      ? "模擬覆核完成"
                      : "確認資料相符"}
                </button>
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {active === "attendance" ? (
        <section
          aria-labelledby="tab-attendance"
          className={styles.panel}
          id="panel-attendance"
          role="tabpanel"
        >
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.kicker}>只新增更正，不覆寫原始事件</p>
              <h2>學習與出席異常</h2>
              <p>系統保留心跳、在席確認與直播事件，人工判定必須填寫原因。</p>
            </div>
          </div>
          <div className={styles.exceptionList}>
            {attendanceCases.map((item) => (
              <article key={item.ref}>
                <div>
                  <span>{item.ref}</span>
                  <h3>
                    {item.learner}・{item.issue}
                  </h3>
                  <p>{item.evidence}</p>
                </div>
                <div className={styles.exceptionAction}>
                  <b>{item.state}</b>
                  <button
                    onClick={() => {
                      setSelectedAttendanceRef(item.ref);
                      setAttendanceReason("");
                      setMessage(
                        `已開啟 ${item.ref} 的合成原始證據；尚未做人工判定。`,
                      );
                    }}
                    type="button"
                  >
                    查看證據
                  </button>
                </div>
              </article>
            ))}
          </div>
          {selectedAttendance ? (
            <aside
              aria-label={`${selectedAttendance.ref} 證據與人工覆核`}
              className={styles.evidenceDrawer}
            >
              <div className={styles.evidenceHeading}>
                <div>
                  <p className={styles.kicker}>原始事件與人工更正分開保存</p>
                  <h3>
                    {selectedAttendance.ref}・{selectedAttendance.learner}
                  </h3>
                  <span>{selectedAttendance.issue}</span>
                </div>
                <button
                  aria-label="關閉證據"
                  onClick={() => setSelectedAttendanceRef(null)}
                  type="button"
                >
                  ×
                </button>
              </div>
              <ol className={styles.rawEvidenceList}>
                {selectedAttendance.rawEvents.map((event) => (
                  <li key={event}>{event}</li>
                ))}
              </ol>
              <label className={styles.reviewReason}>
                人工判定原因（必填）
                <textarea
                  onChange={(event) => setAttendanceReason(event.target.value)}
                  placeholder="例如：比對 Zoom 離開事件與 SDK 心跳後，確認斷線區段未重複計入。"
                  rows={3}
                  value={attendanceReason}
                />
              </label>
              <div className={styles.actions}>
                <button
                  className={styles.secondaryButton}
                  disabled={!attendanceReason.trim()}
                  onClick={() => {
                    simulate(`${selectedAttendance.ref} 維持不合格`);
                    setSelectedAttendanceRef(null);
                  }}
                  type="button"
                >
                  維持不合格
                </button>
                <button
                  className={styles.primaryButton}
                  disabled={!attendanceReason.trim()}
                  onClick={() => {
                    simulate(`${selectedAttendance.ref} 人工補正`);
                    setSelectedAttendanceRef(null);
                  }}
                  type="button"
                >
                  新增人工補正紀錄
                </button>
              </div>
              <p className={styles.evidenceNote}>
                Demo
                只展示流程；正式系統不允許刪除或覆寫上方原始事件，並會記錄操作者、時間與原因。
              </p>
            </aside>
          ) : null}
        </section>
      ) : null}

      {active === "audit" ? (
        <section
          aria-labelledby="tab-audit"
          className={styles.panel}
          id="panel-audit"
          role="tabpanel"
        >
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.kicker}>Append-only audit event</p>
              <h2>今日管理操作</h2>
              <p>付款、審核、補正、發布與發證都保留操作者、時間和原因。</p>
            </div>
            <button
              className={styles.secondaryButton}
              onClick={() => simulate("稽核條件篩選")}
              type="button"
            >
              篩選紀錄
            </button>
          </div>
          <ol className={styles.timeline}>
            {auditEvents.map((event) => (
              <li key={`${event.time}-${event.action}`}>
                <time>{event.time}</time>
                <span aria-hidden="true" />
                <div>
                  <strong>{event.action}</strong>
                  <small>{event.actor}</small>
                  <p>{event.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <footer className={styles.footer}>
        <div>
          <strong>三種角色已完整走完</strong>
          <span>回到導覽總覽，整理客戶問題或重新選擇任一角色。</span>
        </div>
        <Link href="/demo">完成並回到 Demo 導覽</Link>
      </footer>
    </div>
  );
}
