"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useMemo,
  useState,
} from "react";
import {
  demoCourses,
  demoEmployees,
  demoLiveSessions,
  demoOrganization,
  demoPointEvents,
  type DemoEmployee,
} from "./data";
import { publicSupportDefaults } from "@/content/public-support";
import styles from "./organization-demo.module.css";

type DemoView = "overview" | "members" | "assignment" | "reports";
type Notice = { tone: "success" | "info"; text: string } | null;

const viewLabels: Record<DemoView, string> = {
  overview: "培訓總覽",
  members: "員工與邀請",
  assignment: "批次派課",
  reports: "成果與出席",
};

function Icon({
  name,
  size = 20,
}: {
  name:
    | "wallet"
    | "people"
    | "course"
    | "report"
    | "plus"
    | "upload"
    | "check"
    | "clock"
    | "video"
    | "download"
    | "arrow";
  size?: number;
}) {
  const paths: Record<string, ReactNode> = {
    wallet: (
      <>
        <path d="M4 7.25A2.25 2.25 0 0 1 6.25 5h11.5A2.25 2.25 0 0 1 20 7.25v9.5A2.25 2.25 0 0 1 17.75 19H6.25A2.25 2.25 0 0 1 4 16.75v-9.5Z" />
        <path d="M16 11h4v4h-4a2 2 0 1 1 0-4Z" />
        <path d="M7 5V3.75A1.75 1.75 0 0 1 8.75 2h7.5A1.75 1.75 0 0 1 18 3.75V5" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3.25" />
        <path d="M3 20v-2.25A4.75 4.75 0 0 1 7.75 13h2.5A4.75 4.75 0 0 1 15 17.75V20" />
        <path d="M15.5 5.25a3 3 0 0 1 0 5.5M17 13.5a4.25 4.25 0 0 1 4 4.25V20" />
      </>
    ),
    course: (
      <>
        <path d="M4 4.75A1.75 1.75 0 0 1 5.75 3h12.5A1.75 1.75 0 0 1 20 4.75v14.5A1.75 1.75 0 0 1 18.25 21H5.75A1.75 1.75 0 0 1 4 19.25V4.75Z" />
        <path d="M8 7h8M8 11h8M8 15h5" />
      </>
    ),
    report: (
      <>
        <path d="M5 21V10M12 21V3M19 21v-7" />
        <path d="M3 21h18" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    upload: (
      <>
        <path d="m7 9 5-5 5 5M12 4v11" />
        <path d="M5 14v4.25A1.75 1.75 0 0 0 6.75 20h10.5A1.75 1.75 0 0 0 19 18.25V14" />
      </>
    ),
    check: <path d="m5 12.5 4.25 4.25L19 7" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </>
    ),
    video: (
      <>
        <rect height="12" rx="2" width="14" x="3" y="6" />
        <path d="m17 10 4-2v8l-4-2" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12M7 10l5 5 5-5" />
        <path d="M5 20h14" />
      </>
    ),
    arrow: <path d="m9 5 7 7-7 7" />,
  };

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
      {paths[name]}
    </svg>
  );
}

function StatusPill({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "success" | "warning" | "info" | "neutral";
}) {
  return <span className={`${styles.pill} ${styles[tone]}`}>{children}</span>;
}

function MetricCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: "wallet" | "people" | "course" | "report";
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className={styles.metricCard}>
      <span className={styles.metricIcon}>
        <Icon name={icon} size={23} />
      </span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

export function OrganizationDemo() {
  const [view, setView] = useState<DemoView>("overview");
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([
    "emp-001",
    "emp-004",
  ]);
  const [selectedCourseId, setSelectedCourseId] = useState(demoCourses[0]!.id);
  const [selectedSessionId, setSelectedSessionId] = useState(
    demoLiveSessions[0]!.id,
  );
  const [notice, setNotice] = useState<Notice>(null);
  const [importName, setImportName] = useState("");
  const [memberFilter, setMemberFilter] = useState("全部");

  const selectedCourse =
    demoCourses.find((course) => course.id === selectedCourseId) ??
    demoCourses[0]!;
  const assignmentTotal = selectedCourse.points * selectedEmployees.length;
  const filteredEmployees = useMemo(
    () =>
      memberFilter === "全部"
        ? demoEmployees
        : demoEmployees.filter(
            (employee) => employee.department === memberFilter,
          ),
    [memberFilter],
  );

  function showNotice(text: string, tone: "success" | "info" = "success") {
    setNotice({ tone, text });
    window.setTimeout(() => setNotice(null), 5200);
  }

  function toggleEmployee(employeeId: string) {
    setSelectedEmployees((current) =>
      current.includes(employeeId)
        ? current.filter((id) => id !== employeeId)
        : [...current, employeeId],
    );
  }

  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const name = String(fields.get("name") ?? "").trim();
    showNotice(
      `操作示範完成：已在此頁模擬寄出「${name || "新員工"}」的邀請，沒有傳送簡訊或建立帳號。`,
    );
    form.reset();
  }

  function chooseImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setImportName(file?.name ?? "");
    if (file) {
      showNotice(
        `已在瀏覽器內預覽 ${file.name}；示範模式不會上傳檔案或匯入正式名單。`,
        "info",
      );
    }
  }

  function downloadCsv() {
    const header = [
      "員工編號",
      "姓名",
      "部門",
      "課程",
      "狀態",
      "觀看分鐘",
      "測驗成績",
      "證明",
    ];
    const rows = demoEmployees.map((employee) => [
      employee.employeeNumber,
      employee.name,
      employee.department,
      employee.courseTitle ?? "尚未指派",
      employee.courseStatus,
      String(employee.learningMinutes),
      employee.quizScore === null ? "" : String(employee.quizScore),
      employee.certificate,
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
    );
    link.download = "歲悅學苑_機構培訓示範報表.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    showNotice("示範報表已下載；內容只包含本頁的虛構資料。", "info");
  }

  return (
    <div className={styles.page}>
      <div className={styles.demoBanner} role="status">
        <span>操作示範</span>
        <p>
          本頁使用虛構資料；邀請、派課與匯入只在畫面中演示，不會扣點、寄信或寫入正式系統。
        </p>
        <a href="/demo">返回 Demo 導覽</a>
      </div>

      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>SUIYUE ORGANIZATION WORKSPACE</p>
          <h1>機構培訓，一個畫面就掌握。</h1>
          <p>
            從點數、員工邀請、批次派課，到觀看分鐘、測驗與直播出席，都能依部門清楚追蹤。
          </p>
        </div>
        <div className={styles.organizationCard}>
          <span className={styles.orgMark} aria-hidden="true">
            悅
          </span>
          <div>
            <small>目前操作機構</small>
            <strong>{demoOrganization.name}</strong>
            <p>
              {demoOrganization.taxId}・{demoOrganization.role}
            </p>
          </div>
        </div>
      </section>

      <div className={styles.workspace}>
        <nav aria-label="機構示範功能" className={styles.sideNav}>
          <div className={styles.navHeader}>
            <span>機構工作台</span>
            <small>展示資料更新於 07/30 09:30</small>
          </div>
          {(Object.keys(viewLabels) as DemoView[]).map((item) => {
            const icon =
              item === "overview"
                ? "wallet"
                : item === "members"
                  ? "people"
                  : item === "assignment"
                    ? "course"
                    : "report";
            return (
              <button
                aria-current={view === item ? "page" : undefined}
                className={view === item ? styles.activeNav : ""}
                key={item}
                onClick={() => setView(item)}
                type="button"
              >
                <Icon name={icon} />
                <span>{viewLabels[item]}</span>
                <Icon name="arrow" size={17} />
              </button>
            );
          })}
          <div className={styles.helpCard}>
            <strong>需要協助？</strong>
            <p>正式環境可由客服協助核對點數、名單與異常紀錄。</p>
            <span>客服專線 {publicSupportDefaults.phone}</span>
          </div>
        </nav>

        <div className={styles.content}>
          <div className={styles.contentHeading}>
            <div>
              <p className={styles.eyebrow}>機構培訓管理</p>
              <h2>{viewLabels[view]}</h2>
            </div>
            <span className={styles.secureLabel}>
              <Icon name="check" size={17} />
              僅顯示機構出資紀錄
            </span>
          </div>

          {view === "overview" && (
            <Overview onNavigate={setView} onNotice={showNotice} />
          )}
          {view === "members" && (
            <Members
              filteredEmployees={filteredEmployees}
              importName={importName}
              memberFilter={memberFilter}
              onFilter={setMemberFilter}
              onImport={chooseImport}
              onInvite={submitInvite}
              onPreviewImport={() =>
                showNotice(
                  "操作示範完成：6 筆資料格式正確、1 筆手機號碼重複；尚未建立邀請。",
                  "info",
                )
              }
            />
          )}
          {view === "assignment" && (
            <Assignment
              assignmentTotal={assignmentTotal}
              onAssign={() => {
                if (selectedEmployees.length === 0) {
                  showNotice("請先勾選至少一位員工。", "info");
                  return;
                }
                showNotice(
                  `操作示範完成：已模擬為 ${selectedEmployees.length} 人保留 ${assignmentTotal.toLocaleString("zh-TW")} 點；正式點數未異動。`,
                );
              }}
              onCourse={setSelectedCourseId}
              onEmployee={toggleEmployee}
              onSession={setSelectedSessionId}
              selectedCourseId={selectedCourseId}
              selectedEmployees={selectedEmployees}
              selectedSessionId={selectedSessionId}
            />
          )}
          {view === "reports" && <Reports onDownload={downloadCsv} />}
        </div>
      </div>

      <footer className={styles.nextDemo}>
        <div>
          <small>DEMO 02 / 03</small>
          <strong>機構端看完後，接著看平台如何建課與審核。</strong>
          <span>下一段會展示課程發布、匯款核對、資格審查與權限稽核。</span>
        </div>
        <a href="/demo/staff">
          下一段：管理後台
          <span aria-hidden="true">→</span>
        </a>
      </footer>

      {notice && (
        <div
          className={`${styles.toast} ${notice.tone === "info" ? styles.toastInfo : ""}`}
          role="status"
        >
          <span>
            <Icon
              name={notice.tone === "success" ? "check" : "clock"}
              size={19}
            />
          </span>
          <p>{notice.text}</p>
          <button
            aria-label="關閉提示"
            onClick={() => setNotice(null)}
            type="button"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function Overview({
  onNavigate,
  onNotice,
}: {
  onNavigate: (view: DemoView) => void;
  onNotice: (text: string, tone?: "success" | "info") => void;
}) {
  const pointPackages = [10_000, 30_000, 50_000] as const;
  const [pointPackage, setPointPackage] = useState<number>(30_000);
  const [purchaseStage, setPurchaseStage] = useState<
    "select" | "instructions" | "submitted"
  >("select");
  const usedPercent = Math.round(
    ((demoOrganization.consumedPoints + demoOrganization.reservedPoints) /
      demoOrganization.totalPurchasedPoints) *
      100,
  );

  return (
    <div className={styles.viewStack}>
      <section aria-label="機構培訓數據" className={styles.metrics}>
        <MetricCard
          detail="未使用點數不過期"
          icon="wallet"
          label="可用點數"
          value={`${demoOrganization.availablePoints.toLocaleString("zh-TW")} 點`}
        />
        <MetricCard
          detail={`${demoOrganization.invitedMembers} 人等待接受邀請`}
          icon="people"
          label="有效員工"
          value={`${demoOrganization.activeMembers} 人`}
        />
        <MetricCard
          detail="機構出資的有效課程"
          icon="course"
          label="學習中"
          value={`${demoOrganization.assignedLearners} 人次`}
        />
        <MetricCard
          detail="可下載證明與成果"
          icon="report"
          label="已完成"
          value={`${demoOrganization.completedLearners} 人次`}
        />
      </section>

      <section className={`${styles.panel} ${styles.pointPurchasePanel}`}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.kicker}>機構點數購買</p>
            <h3>先建立訂單，再依專屬資訊完成帳號匯款</h3>
          </div>
          <StatusPill tone={purchaseStage === "submitted" ? "warning" : "info"}>
            {purchaseStage === "submitted" ? "等待財務核對" : "NT$1＝1 點"}
          </StatusPill>
        </div>

        {purchaseStage === "select" && (
          <div className={styles.pointPurchaseGrid}>
            <div className={styles.pointPackageChoices}>
              <span>選擇購買點數</span>
              <div>
                {pointPackages.map((amount) => (
                  <button
                    aria-pressed={pointPackage === amount}
                    className={
                      pointPackage === amount ? styles.selectedPackage : ""
                    }
                    key={amount}
                    onClick={() => setPointPackage(amount)}
                    type="button"
                  >
                    <strong>{amount.toLocaleString("zh-TW")} 點</strong>
                    <small>NT$ {amount.toLocaleString("zh-TW")}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.pointOrderSummary}>
              <dl>
                <div>
                  <dt>購買機構</dt>
                  <dd>{demoOrganization.name}</dd>
                </div>
                <div>
                  <dt>本次點數</dt>
                  <dd>{pointPackage.toLocaleString("zh-TW")} 點</dd>
                </div>
                <div>
                  <dt>應付金額</dt>
                  <dd>NT$ {pointPackage.toLocaleString("zh-TW")}</dd>
                </div>
              </dl>
              <p>
                正式流程會保存訂單與匯款識別碼；財務雙人覆核後，點數才會入帳。
              </p>
              <button
                className={styles.primaryButton}
                onClick={() => {
                  setPurchaseStage("instructions");
                  onNotice(
                    "已建立模擬點數訂單；畫面沒有產生正式款項或匯款帳號。",
                    "info",
                  );
                }}
                type="button"
              >
                建立模擬匯款訂單
              </button>
            </div>
          </div>
        )}

        {purchaseStage === "instructions" && (
          <div className={styles.transferInstructions}>
            <span className={styles.transferIcon}>
              <Icon name="wallet" size={28} />
            </span>
            <div>
              <small>模擬訂單 ORG-DEMO-0730</small>
              <h4>
                應匯 NT$ {pointPackage.toLocaleString("zh-TW")}・識別碼 73052
              </h4>
              <p>
                正式站只會在訂單成立後顯示經核准的收款帳號；這個 Demo
                不顯示真實銀行資料，也不會要求客戶實際匯款。
              </p>
            </div>
            <div className={styles.transferActions}>
              <button
                className={styles.secondaryButton}
                onClick={() => setPurchaseStage("select")}
                type="button"
              >
                返回修改
              </button>
              <button
                className={styles.primaryButton}
                onClick={() => {
                  setPurchaseStage("submitted");
                  onNotice(
                    "操作示範完成：已送出模擬匯款回報，現在等待財務雙人覆核。",
                  );
                }}
                type="button"
              >
                模擬回報已匯款
              </button>
            </div>
          </div>
        )}

        {purchaseStage === "submitted" && (
          <div className={styles.purchaseSubmitted} role="status">
            <span>
              <Icon name="clock" size={27} />
            </span>
            <div>
              <small>付款狀態</small>
              <h4>已回報匯款，等待財務雙人覆核</h4>
              <p>
                核對成功後才增加 {pointPackage.toLocaleString("zh-TW")}
                點；付款結果頁本身不能開通點數。
              </p>
            </div>
            <button
              className={styles.secondaryButton}
              onClick={() => setPurchaseStage("select")}
              type="button"
            >
              重新操作
            </button>
          </div>
        )}
      </section>

      <div className={styles.twoColumns}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.kicker}>點數錢包</p>
              <h3>NT$1 等於 1 點</h3>
            </div>
            <StatusPill tone="success">正常使用中</StatusPill>
          </div>
          <div className={styles.walletAmount}>
            <span>目前可用</span>
            <strong>
              {demoOrganization.availablePoints.toLocaleString("zh-TW")}
              <small>點</small>
            </strong>
          </div>
          <div
            aria-label={`已配置 ${usedPercent}% 點數`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={usedPercent}
            className={styles.progressTrack}
            role="progressbar"
          >
            <span style={{ width: `${usedPercent}%` }} />
          </div>
          <div className={styles.walletLegend}>
            <span>
              <i className={styles.dotConsumed} />
              已使用 {demoOrganization.consumedPoints.toLocaleString("zh-TW")}
            </span>
            <span>
              <i className={styles.dotReserved} />
              已保留 {demoOrganization.reservedPoints.toLocaleString("zh-TW")}
            </span>
            <span>
              <i className={styles.dotAvailable} />
              可使用 {demoOrganization.availablePoints.toLocaleString("zh-TW")}
            </span>
          </div>
          <div className={styles.noExpiry}>
            <Icon name="check" size={18} />
            <div>
              <strong>沒有即將到期的點數</strong>
              <p>所有尚未使用的機構點數皆不過期。</p>
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.kicker}>待辦提醒</p>
              <h3>今天最值得先處理</h3>
            </div>
          </div>
          <div className={styles.todoList}>
            <button onClick={() => onNavigate("members")} type="button">
              <span className={styles.todoIcon}>
                <Icon name="people" />
              </span>
              <span>
                <strong>4 位員工尚未接受邀請</strong>
                <small>可重新寄送，或確認手機號碼是否正確</small>
              </span>
              <Icon name="arrow" size={18} />
            </button>
            <button onClick={() => onNavigate("assignment")} type="button">
              <span className={styles.todoIcon}>
                <Icon name="course" />
              </span>
              <span>
                <strong>8 位員工尚未指派本季課程</strong>
                <small>可依部門一次勾選多人批次派課</small>
              </span>
              <Icon name="arrow" size={18} />
            </button>
            <button onClick={() => onNavigate("reports")} type="button">
              <span className={styles.todoIcon}>
                <Icon name="video" />
              </span>
              <span>
                <strong>直播課將於 4 天後開始</strong>
                <small>32 人已報名，3 人尚未完成設備檢查</small>
              </span>
              <Icon name="arrow" size={18} />
            </button>
          </div>
        </section>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.kicker}>近期紀錄</p>
            <h3>點數異動都有來源可查</h3>
          </div>
          <button
            className={styles.textButton}
            onClick={() => onNavigate("reports")}
            type="button"
          >
            查看完整成果 <Icon name="arrow" size={16} />
          </button>
        </div>
        <div className={styles.eventList}>
          {demoPointEvents.map((event) => (
            <article key={`${event.date}-${event.reference}`}>
              <span className={styles.eventDate}>{event.date}</span>
              <div>
                <strong>{event.label}</strong>
                <small>{event.reference}</small>
              </div>
              <b
                className={event.delta > 0 ? styles.positive : styles.negative}
              >
                {event.delta > 0 ? "+" : ""}
                {event.delta.toLocaleString("zh-TW")} 點
              </b>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Members({
  filteredEmployees,
  importName,
  memberFilter,
  onFilter,
  onImport,
  onInvite,
  onPreviewImport,
}: {
  filteredEmployees: DemoEmployee[];
  importName: string;
  memberFilter: string;
  onFilter: (filter: string) => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onInvite: (event: FormEvent<HTMLFormElement>) => void;
  onPreviewImport: () => void;
}) {
  return (
    <div className={styles.viewStack}>
      <section className={`${styles.panel} ${styles.invitePanel}`}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.kicker}>新增員工</p>
            <h3>單筆邀請或 Excel 批次預覽</h3>
          </div>
          <StatusPill tone="info">邀請 7 天內有效</StatusPill>
        </div>
        <div className={styles.inviteGrid}>
          <form className={styles.inviteForm} onSubmit={onInvite}>
            <h4>
              <Icon name="plus" size={18} />
              單筆手機邀請
            </h4>
            <label>
              姓名
              <input
                autoComplete="off"
                name="name"
                placeholder="例如：林美華"
                required
              />
            </label>
            <label>
              台灣手機號碼
              <input
                autoComplete="off"
                inputMode="tel"
                name="phone"
                pattern="09[0-9]{8}"
                placeholder="0912345678"
                required
              />
            </label>
            <label>
              部門
              <select defaultValue="板橋 A 組" name="department">
                <option>板橋 A 組</option>
                <option>新莊 B 組</option>
                <option>三重 C 組</option>
              </select>
            </label>
            <button className={styles.primaryButton} type="submit">
              <Icon name="plus" size={18} />
              模擬寄出邀請
            </button>
          </form>

          <div className={styles.importCard}>
            <span className={styles.uploadIcon}>
              <Icon name="upload" size={28} />
            </span>
            <h4>Excel 批次匯入</h4>
            <p>先檢查必填欄位、重複手機與危險公式，全部確認後才會建立邀請。</p>
            <label className={styles.fileButton}>
              選擇 Excel 或 CSV
              <input
                accept=".xlsx,.xls,.csv"
                aria-label="選擇員工名單 Excel 或 CSV"
                onChange={onImport}
                type="file"
              />
            </label>
            {importName && <small>已選擇：{importName}</small>}
            <button
              className={styles.secondaryButton}
              disabled={!importName}
              onClick={onPreviewImport}
              type="button"
            >
              預覽檢查結果
            </button>
            <span className={styles.templateLink}>
              範本欄位：手機、姓名、員編、部門
            </span>
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.tableToolbar}>
          <div>
            <p className={styles.kicker}>員工名冊</p>
            <h3>共 40 位（含 4 位待接受）</h3>
          </div>
          <label>
            <span>部門篩選</span>
            <select
              aria-label="依部門篩選員工"
              onChange={(event) => onFilter(event.target.value)}
              value={memberFilter}
            >
              <option>全部</option>
              <option>板橋 A 組</option>
              <option>新莊 B 組</option>
              <option>三重 C 組</option>
            </select>
          </label>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>員工</th>
                <th>員工編號</th>
                <th>部門</th>
                <th>邀請狀態</th>
                <th>目前學習</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((employee) => (
                <tr key={employee.id}>
                  <td>
                    <strong>{employee.name}</strong>
                    <small>{employee.maskedPhone}</small>
                  </td>
                  <td>{employee.employeeNumber}</td>
                  <td>{employee.department}</td>
                  <td>
                    <StatusPill
                      tone={
                        employee.invitationStatus === "已加入"
                          ? "success"
                          : "warning"
                      }
                    >
                      {employee.invitationStatus}
                    </StatusPill>
                  </td>
                  <td>
                    <strong className={styles.courseCell}>
                      {employee.courseTitle ?? "尚未指派課程"}
                    </strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Assignment({
  assignmentTotal,
  onAssign,
  onCourse,
  onEmployee,
  onSession,
  selectedCourseId,
  selectedEmployees,
  selectedSessionId,
}: {
  assignmentTotal: number;
  onAssign: () => void;
  onCourse: (id: string) => void;
  onEmployee: (id: string) => void;
  onSession: (id: string) => void;
  selectedCourseId: string;
  selectedEmployees: string[];
  selectedSessionId: string;
}) {
  const selectedCourse = demoCourses.find(
    (course) => course.id === selectedCourseId,
  )!;
  const balanceAfter = demoOrganization.availablePoints - assignmentTotal;

  return (
    <div className={styles.assignmentLayout}>
      <section className={styles.panel}>
        <div className={styles.stepHeading}>
          <span>1</span>
          <div>
            <p className={styles.kicker}>選擇員工</p>
            <h3>可一次指派多人</h3>
          </div>
          <strong>已選 {selectedEmployees.length} 人</strong>
        </div>
        <div className={styles.selectionList}>
          {demoEmployees.map((employee) => (
            <label key={employee.id}>
              <input
                checked={selectedEmployees.includes(employee.id)}
                onChange={() => onEmployee(employee.id)}
                type="checkbox"
              />
              <span className={styles.employeeAvatar} aria-hidden="true">
                {employee.name.slice(0, 1)}
              </span>
              <span>
                <strong>{employee.name}</strong>
                <small>
                  {employee.employeeNumber}・{employee.department}
                </small>
              </span>
              <StatusPill
                tone={
                  employee.courseStatus === "尚未指派" ? "warning" : "neutral"
                }
              >
                {employee.courseStatus}
              </StatusPill>
            </label>
          ))}
        </div>
      </section>

      <div className={styles.assignmentRight}>
        <section className={styles.panel}>
          <div className={styles.stepHeading}>
            <span>2</span>
            <div>
              <p className={styles.kicker}>選擇課程</p>
              <h3>每位員工只扣一次點數</h3>
            </div>
          </div>
          <div className={styles.courseChoices}>
            {demoCourses.map((course) => (
              <label
                className={
                  selectedCourseId === course.id
                    ? styles.selectedCourse
                    : undefined
                }
                key={course.id}
              >
                <input
                  checked={selectedCourseId === course.id}
                  name="course"
                  onChange={() => onCourse(course.id)}
                  type="radio"
                />
                <span className={styles.deliveryIcon}>
                  <Icon
                    name={course.delivery === "直播" ? "video" : "course"}
                  />
                </span>
                <span>
                  <strong>{course.title}</strong>
                  <small>
                    {course.delivery}・{course.duration}
                  </small>
                </span>
                <b>{course.points.toLocaleString("zh-TW")} 點／人</b>
              </label>
            ))}
          </div>

          {selectedCourse.delivery === "直播" && (
            <label className={styles.sessionPicker}>
              選擇直播場次
              <select
                onChange={(event) => onSession(event.target.value)}
                value={selectedSessionId}
              >
                {demoLiveSessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.date} {session.time}（{session.seats}）
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>

        <section className={`${styles.panel} ${styles.assignmentSummary}`}>
          <div className={styles.stepHeading}>
            <span>3</span>
            <div>
              <p className={styles.kicker}>確認指派</p>
              <h3>先確認，再建立學習權限</h3>
            </div>
          </div>
          <dl>
            <div>
              <dt>選擇人數</dt>
              <dd>{selectedEmployees.length} 人</dd>
            </div>
            <div>
              <dt>課程單價</dt>
              <dd>{selectedCourse.points.toLocaleString("zh-TW")} 點／人</dd>
            </div>
            <div>
              <dt>本次保留點數</dt>
              <dd>{assignmentTotal.toLocaleString("zh-TW")} 點</dd>
            </div>
            <div>
              <dt>指派後可用</dt>
              <dd>{balanceAfter.toLocaleString("zh-TW")} 點</dd>
            </div>
          </dl>
          <p className={styles.summaryNote}>
            員工首次有效觀看後，名額才會轉為已使用；未開始前可依規則收回。
          </p>
          <button
            className={styles.primaryButton}
            disabled={selectedEmployees.length === 0 || balanceAfter < 0}
            onClick={onAssign}
            type="button"
          >
            確認模擬指派
          </button>
        </section>
      </div>
    </div>
  );
}

function Reports({ onDownload }: { onDownload: () => void }) {
  return (
    <div className={styles.viewStack}>
      <section className={styles.reportHero}>
        <div>
          <p className={styles.kicker}>本季培訓成果</p>
          <h3>完成率 68%</h3>
          <p>19 人已完成，6 人進行中，3 人等待開課。</p>
        </div>
        <div className={styles.donut} aria-label="本季培訓完成率 68%">
          <span>
            <strong>68%</strong>
            <small>完成率</small>
          </span>
        </div>
        <button
          className={styles.lightButton}
          onClick={onDownload}
          type="button"
        >
          <Icon name="download" size={18} />
          下載示範報表
        </button>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.kicker}>直播場次</p>
            <h3>居家緊急應變實務</h3>
          </div>
          <StatusPill tone="info">4 天後開課</StatusPill>
        </div>
        <div className={styles.sessionSummary}>
          <article>
            <Icon name="clock" />
            <span>
              <small>上課時間</small>
              <strong>08/03 09:00–12:00</strong>
            </span>
          </article>
          <article>
            <Icon name="people" />
            <span>
              <small>已報名</small>
              <strong>32 / 50 人</strong>
            </span>
          </article>
          <article>
            <Icon name="video" />
            <span>
              <small>設備檢查</small>
              <strong>29 人已完成</strong>
            </span>
          </article>
        </div>
        <div className={styles.liveAlert}>
          <span>
            <Icon name="clock" size={19} />
          </span>
          <div>
            <strong>3 位學員尚未完成設備檢查</strong>
            <p>正式環境會顯示提醒狀態；機構無法代替學員完成簽到或改寫出席。</p>
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.tableToolbar}>
          <div>
            <p className={styles.kicker}>員工成果</p>
            <h3>分鐘、成績與證明分開呈現</h3>
          </div>
          <StatusPill tone="neutral">不含個人自費課程</StatusPill>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>員工</th>
                <th>課程</th>
                <th>觀看進度</th>
                <th>有效分鐘</th>
                <th>測驗</th>
                <th>證明</th>
              </tr>
            </thead>
            <tbody>
              {demoEmployees
                .filter((employee) => employee.courseTitle)
                .map((employee) => (
                  <tr key={employee.id}>
                    <td>
                      <strong>{employee.name}</strong>
                      <small>{employee.department}</small>
                    </td>
                    <td>
                      <strong className={styles.courseCell}>
                        {employee.courseTitle}
                      </strong>
                    </td>
                    <td>
                      <div className={styles.miniProgress}>
                        <span style={{ width: `${employee.progress ?? 0}%` }} />
                      </div>
                      <small>{employee.progress ?? 0}%</small>
                    </td>
                    <td>{employee.learningMinutes} 分鐘</td>
                    <td>{employee.quizScore ?? "尚未測驗"}</td>
                    <td>
                      <StatusPill
                        tone={
                          employee.certificate === "已取得"
                            ? "success"
                            : employee.certificate === "待完成"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {employee.certificate}
                      </StatusPill>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
