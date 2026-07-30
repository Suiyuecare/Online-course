"use client";

import Image from "next/image";
import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import { LearnerPreferencePanel } from "@/components/learner-preference-panel";

export type LearnerProfessionalRole = {
  id: string;
  category: string;
  title: string;
};

export type LearnerAccountSettingsModel = {
  accountId: string;
  displayName: string;
  avatarUrl: string | null;
  maskedPhone: string;
  phoneVerified: boolean;
  verifiedEmail: string;
  emailVerified: boolean;
  gender: string;
  birthDate: string;
  currentStatus: string;
  professionalRoles: LearnerProfessionalRole[];
  learningGoals: string[];
  interests: string[];
  version: number;
};

const genders = [
  { value: "undisclosed", label: "不提供" },
  { value: "female", label: "女性" },
  { value: "male", label: "男性" },
  { value: "non_binary", label: "非二元性別" },
  { value: "other", label: "其他" },
] as const;

const currentStatuses = [
  { value: "care_professional", label: "長照從業人員" },
  { value: "organization_manager", label: "機構管理／培訓人員" },
  { value: "medical_professional", label: "醫事專業人員" },
  { value: "student", label: "相關科系學生" },
  { value: "family_caregiver", label: "家庭照顧者" },
  { value: "other", label: "其他" },
  { value: "undisclosed", label: "暫不提供" },
] as const;

const roleOptions = [
  {
    value: "long_term_care",
    label: "長期照顧",
    titles: [
      { value: "care_worker", label: "照顧服務員" },
      { value: "home_service_supervisor", label: "居家服務督導員" },
      { value: "care_manager", label: "照顧管理專員" },
      { value: "case_manager", label: "個案管理員" },
      { value: "institution_manager", label: "長照機構管理者" },
    ],
  },
  {
    value: "medical_health",
    label: "醫事／保健",
    titles: [
      { value: "nurse", label: "護理師" },
      { value: "physician", label: "醫師" },
      { value: "physical_therapist", label: "物理治療師" },
      { value: "occupational_therapist", label: "職能治療師" },
      { value: "dietitian", label: "營養師" },
      { value: "pharmacist", label: "藥師" },
    ],
  },
  {
    value: "social_work",
    label: "社會工作／社區",
    titles: [
      { value: "social_worker", label: "社會工作師／員" },
      { value: "community_coordinator", label: "社區服務人員" },
    ],
  },
  {
    value: "operations",
    label: "行政／營運",
    titles: [
      { value: "administrator", label: "行政人員" },
      { value: "training_coordinator", label: "教育訓練承辦人" },
      { value: "quality_manager", label: "品質管理人員" },
    ],
  },
  {
    value: "student_other",
    label: "學生／其他",
    titles: [
      { value: "student", label: "學生" },
      { value: "family_caregiver", label: "家庭照顧者" },
      { value: "other", label: "其他" },
    ],
  },
] as const;

const learningGoalOptions = [
  { value: "earn_credits", label: "取得長照積分" },
  { value: "care_skills", label: "精進照顧技能" },
  { value: "new_staff_training", label: "新人培訓" },
  { value: "career_growth", label: "職涯成長" },
  { value: "regulation_updates", label: "掌握法規新知" },
  { value: "organization_management", label: "機構經營管理" },
  { value: "personal_growth", label: "自我成長" },
] as const;

const interestOptions = [
  {
    value: "career_entry",
    label: "長照入門與職涯",
    description: "新人、轉職與基礎知識",
  },
  {
    value: "daily_care",
    label: "日常照顧實務",
    description: "生活照護與溝通技巧",
  },
  {
    value: "special_needs",
    label: "失智與特殊需求",
    description: "認知、精神與特殊照護",
  },
  {
    value: "reablement",
    label: "復能與健康促進",
    description: "活動設計與自立支持",
  },
  {
    value: "quality_safety",
    label: "品質與安全",
    description: "感染、風險與服務品質",
  },
  {
    value: "supervision_management",
    label: "督導與機構管理",
    description: "帶人、營運與團隊管理",
  },
  {
    value: "ethics_rights",
    label: "倫理與權益",
    description: "尊嚴、自主與專業倫理",
  },
  {
    value: "policy_law",
    label: "政策與法規",
    description: "制度、申報與法規更新",
  },
] as const;

type EditableState = Pick<
  LearnerAccountSettingsModel,
  | "gender"
  | "birthDate"
  | "currentStatus"
  | "professionalRoles"
  | "learningGoals"
  | "interests"
>;

function editableState(settings: LearnerAccountSettingsModel): EditableState {
  return {
    gender: settings.gender || "undisclosed",
    birthDate: settings.birthDate || "",
    currentStatus: settings.currentStatus || "undisclosed",
    professionalRoles: settings.professionalRoles,
    learningGoals: settings.learningGoals,
    interests: settings.interests,
  };
}

function stateSnapshot(state: EditableState) {
  return JSON.stringify({
    ...state,
    professionalRoles: state.professionalRoles.map(({ category, title }) => ({
      category,
      title,
    })),
  });
}

function newRole(): LearnerProfessionalRole {
  return {
    id: crypto.randomUUID(),
    category: "",
    title: "",
  };
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof result?.error === "string" ? result.error : "REQUEST_REJECTED",
    );
  }
  return result;
}

function VerificationBadge({ verified }: { verified: boolean }) {
  return (
    <span
      className={
        verified
          ? "learner-account-verified"
          : "learner-account-verified is-pending"
      }
    >
      <span aria-hidden="true">{verified ? "✓" : "!"}</span>
      {verified ? "驗證完成" : "待驗證"}
    </span>
  );
}

function AccountSettingsSidebar({
  settings,
}: {
  settings: LearnerAccountSettingsModel;
}) {
  return (
    <aside
      aria-label="帳號設定分區"
      className="learner-account-settings-sidebar"
    >
      <div className="learner-account-settings-identity">
        <span className="learner-account-settings-avatar" aria-hidden="true">
          {settings.avatarUrl ? (
            <Image
              alt=""
              fill
              sizes="84px"
              src={settings.avatarUrl}
              unoptimized
            />
          ) : (
            settings.displayName.slice(0, 1)
          )}
        </span>
        <span>
          <strong>{settings.displayName}</strong>
          <small>{settings.maskedPhone}</small>
        </span>
      </div>
      <nav>
        <a href="#personal-information">
          <LearnerPortalIcon name="account" size={21} />
          個人資料
        </a>
        <a href="#login-security">
          <LearnerPortalIcon name="settings" size={21} />
          登入與安全
        </a>
        <a href="#reading-preferences">
          <LearnerPortalIcon name="eye" size={21} />
          閱讀偏好
        </a>
      </nav>
      <p>
        你的身分與聯絡資料不會顯示在公開專業頁。公開內容請至
        <Link href="/learner/account">我的專業頁</Link>
        管理。
      </p>
    </aside>
  );
}

export function AccountSettingsCenter({
  initialSettings,
}: {
  initialSettings: LearnerAccountSettingsModel;
}) {
  const [state, setState] = useState(() => editableState(initialSettings));
  const [version, setVersion] = useState(initialSettings.version);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "conflict" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [choiceMessage, setChoiceMessage] = useState("");
  const [email, setEmail] = useState(initialSettings.verifiedEmail);
  const [emailVerified, setEmailVerified] = useState(
    initialSettings.emailVerified,
  );
  const [editingEmail, setEditingEmail] = useState(
    !initialSettings.emailVerified,
  );
  const [emailStep, setEmailStep] = useState<"entry" | "code">("entry");
  const [emailCode, setEmailCode] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    stateSnapshot(editableState(initialSettings)),
  );
  const [savedEmailSnapshot, setSavedEmailSnapshot] = useState(() =>
    JSON.stringify({
      email: initialSettings.verifiedEmail,
      emailVerified: initialSettings.emailVerified,
      editingEmail: !initialSettings.emailVerified,
      emailStep: "entry",
      emailCode: "",
    }),
  );

  const currentSnapshot = useMemo(() => stateSnapshot(state), [state]);
  const currentEmailSnapshot = useMemo(
    () =>
      JSON.stringify({
        email,
        emailVerified,
        editingEmail,
        emailStep,
        emailCode,
      }),
    [editingEmail, email, emailCode, emailStep, emailVerified],
  );
  const profileDirty = currentSnapshot !== savedSnapshot;
  const emailDirty = currentEmailSnapshot !== savedEmailSnapshot;
  const hasUnsavedChanges = profileDirty || emailDirty;

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const warnBeforeNavigation = (event: globalThis.MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      ) {
        return;
      }
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      ) {
        return;
      }
      const destination = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      const isSamePageAnchor =
        destination.origin === current.origin &&
        destination.pathname === current.pathname &&
        destination.search === current.search &&
        destination.hash.length > 0;
      if (
        !isSamePageAnchor &&
        !window.confirm("尚有未完成或未儲存的變更，確定要離開這個頁面嗎？")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    document.addEventListener("click", warnBeforeNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeLeaving);
      document.removeEventListener("click", warnBeforeNavigation, true);
    };
  }, [hasUnsavedChanges]);

  function updateRole(id: string, field: "category" | "title", value: string) {
    setState((current) => ({
      ...current,
      professionalRoles: current.professionalRoles.map((role) =>
        role.id === id
          ? {
              ...role,
              [field]: value,
              ...(field === "category" ? { title: "" } : {}),
            }
          : role,
      ),
    }));
    setSaveStatus("idle");
  }

  function toggleChoice(
    field: "learningGoals" | "interests",
    value: string,
    limit: number,
  ) {
    const values = state[field];
    if (values.includes(value)) {
      setState((current) => ({
        ...current,
        [field]: current[field].filter((item) => item !== value),
      }));
      setChoiceMessage("");
      setSaveStatus("idle");
      return;
    }
    if (values.length >= limit) {
      setChoiceMessage(
        field === "learningGoals"
          ? "學習目標最多選 3 個，請先取消一個再新增。"
          : "興趣分類最多選 8 個。",
      );
      return;
    }
    setState((current) => ({
      ...current,
      [field]: [...current[field], value],
    }));
    setChoiceMessage("");
    setSaveStatus("idle");
  }

  async function requestEmailCode() {
    if (!email.trim()) {
      setEmailMessage("請先輸入通知 Email。");
      return;
    }
    setEmailBusy(true);
    setEmailMessage("");
    try {
      await postJson("/api/profile/email/request", { email: email.trim() });
      setEmailStep("code");
      setEmailMessage("六位數驗證碼已寄出，請在 10 分鐘內輸入。");
    } catch {
      setEmailMessage("目前無法寄送驗證碼，請稍後再試。");
    } finally {
      setEmailBusy(false);
    }
  }

  async function verifyEmailCode() {
    if (!/^\d{6}$/.test(emailCode)) {
      setEmailMessage("請輸入六位數驗證碼。");
      return;
    }
    setEmailBusy(true);
    setEmailMessage("");
    try {
      await postJson("/api/profile/email/verify", {
        email: email.trim(),
        code: emailCode,
      });
      const verifiedEmail = email.trim();
      setEmail(verifiedEmail);
      setEmailVerified(true);
      setEditingEmail(false);
      setEmailStep("entry");
      setEmailCode("");
      setSavedEmailSnapshot(
        JSON.stringify({
          email: verifiedEmail,
          emailVerified: true,
          editingEmail: false,
          emailStep: "entry",
          emailCode: "",
        }),
      );
      setEmailMessage("通知 Email 已驗證完成。");
    } catch {
      setEmailMessage("驗證碼錯誤、已過期或嘗試次數過多，請重新確認。");
    } finally {
      setEmailBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const incompleteRole = state.professionalRoles.some(
      (role) => !role.category || !role.title,
    );
    if (incompleteRole) {
      setSaveStatus("error");
      setMessage("每一筆職務都要同時選擇職務類別與職稱。");
      document.getElementById("professional-roles")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }
    setSaveStatus("saving");
    setMessage("");
    try {
      const response = await fetch("/api/profile/account", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          expectedVersion: version,
          gender: state.gender,
          birthDate: state.birthDate || null,
          currentStatus: state.currentStatus,
          professionalRoles: state.professionalRoles.map(
            ({ category, title }) => ({ category, title }),
          ),
          learningGoals: state.learningGoals,
          interests: state.interests,
        }),
      });
      const result = await response.json().catch(() => null);
      if (response.status === 409) {
        setSaveStatus("conflict");
        setMessage(
          "資料已在另一個視窗更新。請重新載入後再修改，避免蓋掉新資料。",
        );
        return;
      }
      if (!response.ok) throw new Error("SAVE_REJECTED");
      const payload = result?.data ?? result ?? {};
      const nextVersion =
        payload.version ?? payload.settings?.version ?? version + 1;
      setVersion(nextVersion);
      setSavedSnapshot(currentSnapshot);
      setSaveStatus("saved");
      setMessage("帳號與個人資料已安全儲存。");
    } catch {
      setSaveStatus("error");
      setMessage(
        "目前無法儲存，請確認網路後再試一次；尚未儲存的內容仍保留在畫面上。",
      );
    }
  }

  const maxBirthDate = new Date().toISOString().slice(0, 10);

  return (
    <div className="learner-account-settings-page">
      <header className="learner-account-settings-hero">
        <div className="learner-portal-shell-width">
          <p className="learner-kicker">帳號與個人資料</p>
          <h1>把重要資料整理好，上課更順利</h1>
          <p>
            聯絡方式、長照職務與學習偏好集中在這裡。正式積分課需要的身分資料，會在報名時另外以加密方式收集。
          </p>
        </div>
      </header>

      <div className="learner-account-settings-layout learner-portal-shell-width">
        <AccountSettingsSidebar settings={initialSettings} />

        <form
          className="learner-account-settings-form"
          noValidate
          onSubmit={save}
        >
          <section
            aria-labelledby="personal-information-title"
            className="learner-account-settings-section"
            id="personal-information"
          >
            <div className="learner-account-settings-section-heading">
              <span aria-hidden="true">
                <LearnerPortalIcon name="account" />
              </span>
              <div>
                <p>個人資料</p>
                <h2 id="personal-information-title">聯絡資訊</h2>
              </div>
            </div>

            <div className="learner-account-contact-list">
              <div className="learner-account-contact-row">
                <div>
                  <span
                    className="learner-account-contact-icon"
                    aria-hidden="true"
                  >
                    <LearnerPortalIcon name="notification" size={21} />
                  </span>
                  <span>
                    <small>登入手機號碼</small>
                    <strong>{initialSettings.maskedPhone}</strong>
                    <em>用於登入與重要安全通知</em>
                  </span>
                </div>
                <VerificationBadge verified={initialSettings.phoneVerified} />
              </div>
              <div className="learner-account-phone-help">
                門號更換或手機遺失時，為保護積分與證明紀錄，不會直接在此改號。
                <Link href="/support">前往安全復原與客服</Link>
              </div>

              <div className="learner-account-contact-row is-email">
                <div>
                  <span
                    className="learner-account-contact-icon"
                    aria-hidden="true"
                  >
                    @
                  </span>
                  <span>
                    <small>通知 Email</small>
                    {!editingEmail && emailVerified ? (
                      <>
                        <strong>{email}</strong>
                        <em>用於課程提醒、報名與結訓通知</em>
                      </>
                    ) : (
                      <label className="learner-account-email-field">
                        <span className="sr-only">通知 Email</span>
                        <input
                          autoComplete="email"
                          onChange={(event) => {
                            setEmail(event.target.value);
                            setEmailVerified(false);
                            setEmailStep("entry");
                            setEmailMessage("");
                          }}
                          placeholder="name@example.com"
                          type="email"
                          value={email}
                        />
                      </label>
                    )}
                  </span>
                </div>
                {!editingEmail && emailVerified ? (
                  <div className="learner-account-contact-actions">
                    <VerificationBadge verified />
                    <button
                      onClick={() => {
                        setEditingEmail(true);
                        setEmailVerified(false);
                        setEmailMessage("");
                      }}
                      type="button"
                    >
                      更換
                    </button>
                  </div>
                ) : (
                  <button
                    className="learner-account-inline-button"
                    disabled={emailBusy || !email.includes("@")}
                    onClick={() => void requestEmailCode()}
                    type="button"
                  >
                    {emailBusy
                      ? "寄送中…"
                      : emailStep === "code"
                        ? "重新寄送"
                        : "寄出驗證碼"}
                  </button>
                )}
              </div>
              {editingEmail && emailStep === "code" && (
                <div className="learner-account-email-code">
                  <label>
                    六位數驗證碼
                    <input
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(event) =>
                        setEmailCode(
                          event.target.value.replace(/\D/g, "").slice(0, 6),
                        )
                      }
                      pattern="[0-9]{6}"
                      placeholder="000000"
                      value={emailCode}
                    />
                  </label>
                  <button
                    className="learner-account-inline-button"
                    disabled={emailBusy || emailCode.length !== 6}
                    onClick={() => void verifyEmailCode()}
                    type="button"
                  >
                    {emailBusy ? "確認中…" : "完成驗證"}
                  </button>
                </div>
              )}
              {emailMessage && (
                <p
                  aria-live="polite"
                  className="learner-account-inline-message"
                >
                  {emailMessage}
                </p>
              )}
            </div>

            <div className="learner-account-settings-subsection">
              <div className="learner-account-settings-title-row">
                <div>
                  <h3>基本資料</h3>
                  <p>這些欄位都是選填，只用於提供更合適的課程資訊。</p>
                </div>
                <span>非公開</span>
              </div>
              <div className="learner-account-form-grid">
                <label>
                  性別
                  <select
                    onChange={(event) => {
                      setState((current) => ({
                        ...current,
                        gender: event.target.value,
                      }));
                      setSaveStatus("idle");
                    }}
                    value={state.gender}
                  >
                    {genders.map((gender) => (
                      <option key={gender.value} value={gender.value}>
                        {gender.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  生日
                  <input
                    max={maxBirthDate}
                    onChange={(event) => {
                      setState((current) => ({
                        ...current,
                        birthDate: event.target.value,
                      }));
                      setSaveStatus("idle");
                    }}
                    type="date"
                    value={state.birthDate}
                  />
                  <small>可留空；不會顯示在公開個人頁。</small>
                </label>
              </div>
            </div>

            <div className="learner-account-settings-subsection">
              <div className="learner-account-settings-title-row">
                <div>
                  <h3>職業資訊</h3>
                  <p>協助我們推薦適合的長照積分課與實務課程。</p>
                </div>
              </div>
              <label className="learner-account-status-field">
                目前身分
                <select
                  onChange={(event) => {
                    setState((current) => ({
                      ...current,
                      currentStatus: event.target.value,
                    }));
                    setSaveStatus("idle");
                  }}
                  value={state.currentStatus}
                >
                  {currentStatuses.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>

              <div
                className="learner-professional-role-list"
                id="professional-roles"
              >
                <div className="learner-professional-role-header">
                  <span>職務類別與職稱</span>
                  <small>最多 5 筆</small>
                </div>
                {state.professionalRoles.map((role, index) => {
                  const titles =
                    roleOptions.find(
                      (category) => category.value === role.category,
                    )?.titles ?? [];
                  return (
                    <div
                      className="learner-professional-role-row"
                      key={role.id}
                    >
                      <span aria-hidden="true">{index + 1}</span>
                      <label>
                        <span>職務類別</span>
                        <select
                          aria-label={`第 ${index + 1} 筆職務類別`}
                          onChange={(event) =>
                            updateRole(role.id, "category", event.target.value)
                          }
                          value={role.category}
                        >
                          <option value="">選擇類別</option>
                          {roleOptions.map((category) => (
                            <option key={category.value} value={category.value}>
                              {category.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>職稱</span>
                        <select
                          aria-label={`第 ${index + 1} 筆職稱`}
                          disabled={!role.category}
                          onChange={(event) =>
                            updateRole(role.id, "title", event.target.value)
                          }
                          value={role.title}
                        >
                          <option value="">選擇職稱</option>
                          {titles.map((title) => (
                            <option key={title.value} value={title.value}>
                              {title.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        aria-label={`刪除第 ${index + 1} 筆職務`}
                        onClick={() => {
                          setState((current) => ({
                            ...current,
                            professionalRoles: current.professionalRoles.filter(
                              (item) => item.id !== role.id,
                            ),
                          }));
                          setSaveStatus("idle");
                        }}
                        type="button"
                      >
                        <LearnerPortalIcon name="x" size={19} />
                      </button>
                    </div>
                  );
                })}
                {state.professionalRoles.length < 5 && (
                  <button
                    className="learner-add-professional-role"
                    onClick={() => {
                      setState((current) => ({
                        ...current,
                        professionalRoles: [
                          ...current.professionalRoles,
                          newRole(),
                        ],
                      }));
                      setSaveStatus("idle");
                    }}
                    type="button"
                  >
                    <LearnerPortalIcon name="plus" size={20} />
                    新增職務
                  </button>
                )}
              </div>
            </div>

            <div className="learner-account-settings-subsection">
              <div className="learner-account-settings-title-row">
                <div>
                  <h3>你的學習方向</h3>
                  <p>用來調整課程推薦，不會影響積分審核與上課權限。</p>
                </div>
              </div>
              <fieldset className="learner-account-chip-fieldset">
                <legend>
                  學習目標
                  <span>{state.learningGoals.length} / 3</span>
                </legend>
                <div className="learner-account-chip-list">
                  {learningGoalOptions.map((option) => (
                    <button
                      aria-pressed={state.learningGoals.includes(option.value)}
                      key={option.value}
                      onClick={() =>
                        toggleChoice("learningGoals", option.value, 3)
                      }
                      type="button"
                    >
                      {option.label}
                      {state.learningGoals.includes(option.value) && (
                        <span aria-hidden="true">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="learner-account-interest-fieldset">
                <legend>
                  有興趣的領域
                  <span>{state.interests.length} / 8</span>
                </legend>
                <div className="learner-account-interest-grid">
                  {interestOptions.map((option) => {
                    const selected = state.interests.includes(option.value);
                    return (
                      <button
                        aria-pressed={selected}
                        key={option.value}
                        onClick={() =>
                          toggleChoice("interests", option.value, 8)
                        }
                        type="button"
                      >
                        <span aria-hidden="true">{selected ? "✓" : "+"}</span>
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.description}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              {choiceMessage && (
                <p
                  aria-live="polite"
                  className="learner-account-choice-message"
                >
                  {choiceMessage}
                </p>
              )}
            </div>
          </section>

          <section
            aria-labelledby="login-security-title"
            className="learner-account-settings-section"
            id="login-security"
          >
            <div className="learner-account-settings-section-heading">
              <span aria-hidden="true">
                <LearnerPortalIcon name="settings" />
              </span>
              <div>
                <p>帳號保護</p>
                <h2 id="login-security-title">登入與安全</h2>
              </div>
            </div>
            <div className="learner-account-security-grid">
              <article>
                <span aria-hidden="true">
                  <LearnerPortalIcon name="account" />
                </span>
                <div>
                  <strong>手機驗證碼登入</strong>
                  <p>
                    {initialSettings.phoneVerified
                      ? "手機已驗證，不需要記住密碼。"
                      : "手機尚未完成驗證，部分功能可能受限。"}
                  </p>
                </div>
                <VerificationBadge verified={initialSettings.phoneVerified} />
              </article>
              <article>
                <span aria-hidden="true">
                  <LearnerPortalIcon name="support" />
                </span>
                <div>
                  <strong>遺失手機或更換門號</strong>
                  <p>透過人工覆核保護已購課程、學習時數與結訓證明。</p>
                </div>
                <Link href="/support">
                  前往處理
                  <LearnerPortalIcon name="chevron" size={18} />
                </Link>
              </article>
            </div>
            <div className="learner-account-security-note">
              <strong>收到不是本人要求的驗證碼？</strong>
              不要提供給任何人，也不要點擊陌生連結；請直接聯絡歲悅客服。
            </div>
          </section>

          <section
            aria-labelledby="reading-preferences-title"
            className="learner-account-settings-section"
            id="reading-preferences"
          >
            <div className="learner-account-settings-section-heading">
              <span aria-hidden="true">
                <LearnerPortalIcon name="eye" />
              </span>
              <div>
                <p>使用體驗</p>
                <h2 id="reading-preferences-title">閱讀偏好</h2>
              </div>
            </div>
            <LearnerPreferencePanel accountId={initialSettings.accountId} />
          </section>

          <div className="learner-account-save-bar">
            <div>
              <span aria-hidden="true">✓</span>
              <p>
                <strong>
                  {profileDirty
                    ? "尚有未儲存的變更"
                    : emailDirty
                      ? "通知 Email 尚未完成驗證"
                      : "目前資料已同步"}
                </strong>
                <small>
                  我們只蒐集提供課程與積分服務所需的資料，不會出售個人資料。
                  <Link href="/legal#privacy">查看資料使用摘要</Link>
                </small>
              </p>
            </div>
            <div>
              {message && (
                <p
                  aria-live="polite"
                  className={`learner-account-save-message is-${saveStatus}`}
                >
                  {message}
                </p>
              )}
              {saveStatus === "conflict" && (
                <button
                  className="learner-account-reload-button"
                  onClick={() => window.location.reload()}
                  type="button"
                >
                  重新載入
                </button>
              )}
              <button
                className="button"
                disabled={!profileDirty || saveStatus === "saving"}
                type="submit"
              >
                {saveStatus === "saving" ? "安全儲存中…" : "儲存變更"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
