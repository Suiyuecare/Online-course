"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeDollarSign,
  BookOpenCheck,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  MailPlus,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Send,
  TicketCheck,
  UserPlus,
  Users,
} from "lucide-react";

type OrganizationContext = {
  organizationId: string;
  role: "owner" | "manager" | "member";
  organization: {
    id: string;
    name: string;
    tax_id: string | null;
    status: string;
    active: boolean;
    invoice_email?: string | null;
    contact_name?: string | null;
    contact_phone?: string | null;
  };
};

type Member = {
  user_id: string;
  role: string;
  employee_code?: string | null;
  department?: string | null;
  fullName: string;
  email: string;
};

type Invitation = {
  id: string;
  email: string;
  invitee_name?: string | null;
  employee_code?: string | null;
  department?: string | null;
  role: string;
  status: string;
  expires_at: string;
};

type Course = {
  id: string;
  title: string;
  delivery: "recorded" | "live";
  accredited: boolean;
};

type PriceTier = {
  id: string;
  course_id: string;
  min_quantity: number;
  max_quantity: number | null;
  unit_price_twd: number;
  effective_at: string;
  expires_at: string | null;
  active: boolean;
};

type SeatLot = {
  id: string;
  source_order_id?: string;
  course_id: string;
  purchased_quantity?: number;
  total_quantity?: number;
  available_quantity?: number;
  assigned_quantity?: number;
  consumed_quantity?: number;
  refunded_quantity?: number;
  valid_until: string;
  status: string;
  course?: Course | null;
};

type Allocation = {
  id: string;
  lot_id?: string;
  seat_lot_id?: string;
  learner_id: string;
  course_id: string;
  live_session_id?: string | null;
  due_at?: string | null;
  status: string;
  course?: Course | null;
};

type Order = {
  id: string;
  merchant_trade_no?: string | null;
  status: string;
  amount_twd: number;
  paid_at?: string | null;
  created_at: string;
};

type Invoice = {
  id: string;
  order_id: string;
  refund_id?: string | null;
  record_type: "invoice" | "allowance" | "void";
  status: string;
  amount_twd: number;
  invoice_number?: string | null;
  invoice_date?: string | null;
  allowance_number?: string | null;
  allowance_status?: string | null;
  allowance_expires_at?: string | null;
  error_message?: string | null;
};

type Refund = {
  id: string;
  order_id: string;
  status: string;
  amount_twd: number;
  seat_quantity?: number | null;
  created_at: string;
};

type LiveSession = {
  id: string;
  course_id: string;
  title: string;
  starts_at: string;
  ends_at?: string;
  status?: string;
  capacity: number;
  live_session_bookings?: Array<{ id: string; status: string }>;
};

type AssignmentFailure = {
  learnerId: string;
  learnerName: string;
  reason: string;
};

type AssignmentSummary = {
  successCount: number;
  failures: AssignmentFailure[];
};

type Enrollment = {
  id: string;
  learner_id: string;
  course_id: string;
  live_session_id?: string | null;
  status: string;
  progress_percent?: number;
  quiz_passed?: boolean;
  satisfaction_completed?: boolean;
};

type AccreditationStatus = {
  enrollment_id: string;
  status: "draft" | "submitted" | "verified" | "needs_correction" | "rejected";
};

type WorkspaceData = {
  context: OrganizationContext;
  generatedAt: string;
  liveCoursesEnabled: boolean;
  members: Member[];
  invitations: Invitation[];
  seatLots: SeatLot[];
  allocations: Allocation[];
  orders: Order[];
  invoices: Invoice[];
  refunds: Refund[];
  courses: Course[];
  reportCourses: Course[];
  priceTiers: PriceTier[];
  liveSessions: LiveSession[];
  enrollments: Enrollment[];
  accreditationStatuses: AccreditationStatus[];
};

type ImportPreview = {
  mode?: "preview" | "commit";
  valid: boolean;
  totalRows?: number;
  summary?: {
    totalRows?: number;
    create?: number;
    renew?: number;
    skipped?: number;
    persisted?: number;
    emailSent?: number;
    emailPending?: number;
    failed?: number;
  };
  rows?: Array<{
    rowNumber: number;
    email: string;
    name?: string;
    employeeNumber?: string;
    department?: string;
  }>;
  errors?: Array<{ rowNumber?: number; field?: string; message: string }>;
  failures?: Array<{ rowNumber?: number; email?: string; message: string }>;
};

const tabs = [
  ["overview", "總覽"],
  ["people", "員工與邀請"],
  ["training", "名額與指派"],
  ["billing", "訂單與發票"],
  ["reports", "機構報表"],
] as const;

const reportCompletionOptions = [
  ["", "全部完成狀態"],
  ["not_started", "尚未開始"],
  ["in_progress", "進行中"],
  ["completed", "已完成"],
  ["expired", "已逾期"],
] as const;

type ReportCompletionStatus = (typeof reportCompletionOptions)[number][0];

export function EnterpriseWorkspace({
  initialContext,
}: {
  initialContext: OrganizationContext;
}) {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number][0]>(
    initialContext.role === "member" ? "training" : "overview",
  );
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const manager =
    initialContext.role === "owner" || initialContext.role === "manager";

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/enterprise/workspace?organizationId=${initialContext.organizationId}`,
        { cache: "no-store" },
      );
      const result = (await response.json().catch(() => null)) as
        | WorkspaceData
        | { error?: string }
        | null;
      if (!response.ok || !result || !("context" in result)) {
        setMessage("工作台資料載入失敗，請重新整理或聯絡客服。");
        return;
      }
      setData(result);
    } catch {
      setMessage("工作台資料載入失敗，請檢查網路後重試。");
    } finally {
      setBusy(false);
    }
  }, [initialContext.organizationId]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `/api/enterprise/workspace?organizationId=${initialContext.organizationId}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => ({
        ok: response.ok,
        result: (await response.json().catch(() => null)) as
          | WorkspaceData
          | { error?: string }
          | null,
      }))
      .then(({ ok, result }) => {
        if (!ok || !result || !("context" in result)) {
          setMessage("工作台資料載入失敗，請重新整理或聯絡客服。");
          return;
        }
        setData(result);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMessage("工作台資料載入失敗，請檢查網路後重試。");
      });
    return () => controller.abort();
  }, [initialContext.organizationId]);

  const metrics = useMemo(() => {
    const lots = data?.seatLots ?? [];
    const total = lots.reduce(
      (sum, lot) => sum + Number(lot.purchased_quantity ?? lot.total_quantity ?? 0),
      0,
    );
    const available = lots.reduce(
      (sum, lot) => sum + Number(lot.available_quantity ?? 0),
      0,
    );
    const assigned = (data?.allocations ?? []).filter((item) =>
      ["assigned", "booked"].includes(item.status),
    ).length;
    const consumed = (data?.allocations ?? []).filter(
      (item) => item.status === "consumed",
    ).length;
    const generatedAt = Date.parse(data?.generatedAt ?? "");
    const expiring = lots.filter(
      (lot) =>
        Number.isFinite(generatedAt) &&
        Date.parse(lot.valid_until) > generatedAt &&
        Date.parse(lot.valid_until) < generatedAt + 30 * 86_400_000,
    ).length;
    return { total, available, assigned, consumed, expiring };
  }, [data]);

  async function mutate(
    url: string,
    options: RequestInit,
    successMessage: string,
  ) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(url, options);
      const result = (await response.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null;
      if (!response.ok) {
        setMessage(errorMessage(result?.error, result?.message));
        return false;
      }
      setMessage(successMessage);
      await reload();
      return true;
    } catch {
      setMessage("網路連線失敗，請稍後重試；本次操作尚未確認完成。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="panel grid min-h-64 place-items-center p-8 text-center">
        <div>
          <LoaderCircle className="mx-auto size-8 animate-spin text-[#B45309]" />
          <p className="mt-4 font-bold text-slate-600">
            正在安全載入機構資料…
          </p>
          {message && <p className="mt-3 text-sm text-rose-700">{message}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <aside className="panel h-fit p-3 lg:sticky lg:top-5">
        <div className="rounded-xl bg-[#FFF8ED] p-4">
          <p className="text-xs font-black text-[#B45309]">機構工作台</p>
          <p className="mt-2 font-black text-[#302318]">
            {data.context.organization.name}
          </p>
          <p className="mt-1 text-xs font-bold text-slate-500">
            {roleLabel(data.context.role)}
          </p>
        </div>
        <nav className="mt-3 grid gap-1" aria-label="機構工作台選單">
          {tabs
            .filter(([key]) => manager || key === "training")
            .map(([key, label]) => (
              <button
                type="button"
                key={key}
                onClick={() => setActiveTab(key)}
                className={`min-h-11 rounded-xl px-4 text-left text-sm font-black ${
                  activeTab === key
                    ? "bg-[#B45309] text-white"
                    : "text-[#665647] hover:bg-[#FFF8ED]"
                }`}
              >
                {label}
              </button>
            ))}
        </nav>
      </aside>

      <div className="min-w-0">
        <div className="mb-5 flex min-h-11 items-center justify-between gap-3">
          <p
            className={`text-sm font-bold ${message.includes("失敗") || message.includes("不能") ? "text-rose-700" : "text-emerald-700"}`}
            role="status"
          >
            {message}
          </p>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={busy}
            className="button-secondary shrink-0"
          >
            <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
            更新
          </button>
        </div>

        {activeTab === "overview" && manager && (
          <Overview
            data={data}
            metrics={metrics}
            busy={busy}
            mutate={mutate}
          />
        )}
        {activeTab === "people" && manager && (
          <PeoplePanel
            data={data}
            busy={busy}
            mutate={mutate}
            setMessage={setMessage}
            reload={reload}
          />
        )}
        {activeTab === "training" && (
          <TrainingPanel
            data={data}
            busy={busy}
            manager={manager}
            mutate={mutate}
            setMessage={setMessage}
            reload={reload}
          />
        )}
        {activeTab === "billing" && manager && (
          <BillingPanel data={data} busy={busy} setMessage={setMessage} />
        )}
        {activeTab === "reports" && manager && (
          <ReportsPanel data={data} />
        )}
      </div>
    </div>
  );
}

function Overview({
  data,
  metrics,
  busy,
  mutate,
}: {
  data: WorkspaceData;
  metrics: {
    total: number;
    available: number;
    assigned: number;
    consumed: number;
    expiring: number;
  };
  busy: boolean;
  mutate: (
    url: string,
    options: RequestInit,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric icon={<TicketCheck />} value={metrics.total} label="已購名額" />
        <Metric icon={<BadgeDollarSign />} value={metrics.available} label="可用名額" />
        <Metric icon={<Send />} value={metrics.assigned} label="已指派" />
        <Metric icon={<BookOpenCheck />} value={metrics.consumed} label="已開始使用" />
        <Metric icon={<CalendarDays />} value={metrics.expiring} label="30 天內到期批次" />
      </section>
      <section className="panel p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-[#FFF0D5] text-[#B45309]">
            <CircleAlert />
          </span>
          <div>
            <h2 className="font-black text-[#302318]">待處理事項</h2>
            <p className="mt-1 text-sm text-slate-500">
              只顯示需要管理者處理的項目。
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <Notice
            title="待接受邀請"
            value={data.invitations.filter((item) => item.status === "pending").length}
          />
          <Notice
            title="開票異常"
            value={data.invoices.filter((item) => item.status === "failed").length}
          />
          <Notice
            title="待審退費"
            value={data.refunds.filter((item) => item.status === "manual_review").length}
          />
        </div>
      </section>
      {data.context.role === "owner" && (
        <OrganizationSettings data={data} busy={busy} mutate={mutate} />
      )}
    </div>
  );
}

function OrganizationSettings({
  data,
  busy,
  mutate,
}: {
  data: WorkspaceData;
  busy: boolean;
  mutate: (
    url: string,
    options: RequestInit,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  async function updateOrganization(formData: FormData) {
    await mutate(
      "/api/enterprise/organization",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: data.context.organizationId,
          name: formData.get("name"),
          contactName: formData.get("contactName"),
          contactPhone: formData.get("contactPhone"),
          invoiceEmail: formData.get("invoiceEmail"),
        }),
      },
      "機構資料已更新。",
    );
  }

  const organization = data.context.organization;
  return (
    <section className="panel p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#FFF0D5] text-[#B45309]">
          <Building2 className="size-5" />
        </span>
        <div>
          <h2 className="font-black text-[#302318]">機構資料設定</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            只有機構擁有者可以修改；統編如需變更，請聯絡歲悅客服重新核對。
          </p>
        </div>
      </div>
      <form
        action={updateOrganization}
        className="mt-5 grid gap-4 md:grid-cols-2"
        key={`${organization.name}-${organization.contact_name}-${organization.contact_phone}-${organization.invoice_email}`}
      >
        <Field label="機構名稱">
          <input
            className="field"
            name="name"
            defaultValue={organization.name}
            minLength={2}
            maxLength={120}
            required
          />
        </Field>
        <Field label="統一編號（不可自行修改）">
          <input
            className="field bg-slate-50 text-slate-500"
            value={organization.tax_id ?? ""}
            readOnly
            aria-readonly="true"
          />
        </Field>
        <Field label="聯絡人">
          <input
            className="field"
            name="contactName"
            defaultValue={organization.contact_name ?? ""}
            minLength={2}
            maxLength={80}
            required
          />
        </Field>
        <Field label="聯絡電話">
          <input
            className="field"
            name="contactPhone"
            type="tel"
            defaultValue={organization.contact_phone ?? ""}
            minLength={8}
            maxLength={30}
            required
          />
        </Field>
        <Field label="發票通知 Email">
          <input
            className="field"
            name="invoiceEmail"
            type="email"
            defaultValue={organization.invoice_email ?? ""}
            maxLength={80}
            required
          />
        </Field>
        <button className="button-primary self-end" disabled={busy}>
          儲存機構資料
        </button>
      </form>
    </section>
  );
}

function PeoplePanel({
  data,
  busy,
  mutate,
  setMessage,
  reload,
}: {
  data: WorkspaceData;
  busy: boolean;
  mutate: (
    url: string,
    options: RequestInit,
    successMessage: string,
  ) => Promise<boolean>;
  setMessage: (value: string) => void;
  reload: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);

  async function invite(formData: FormData) {
    setInviteBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/enterprise/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: data.context.organizationId,
          email: formData.get("email"),
          fullName: formData.get("fullName"),
          employeeCode: formData.get("employeeCode"),
          department: formData.get("department"),
          role: formData.get("role"),
        }),
      });
      const result = (await response.json().catch(() => null)) as
        | {
            error?: string;
            message?: string;
            emailSent?: boolean;
            emailPending?: boolean;
            deliveryReason?: string;
          }
        | null;
      if (!response.ok) {
        setMessage(errorMessage(result?.error, result?.message));
        return;
      }
      setMessage(
        result?.emailSent
          ? "邀請已寄出，有效期限為 7 天。"
          : "邀請已建立，但 Email 尚待寄送；可在名冊中按重寄。",
      );
      await reload();
    } catch {
      setMessage("邀請送出失敗，請檢查網路後重試。");
    } finally {
      setInviteBusy(false);
    }
  }

  async function importRoster(mode: "preview" | "commit") {
    if (!file) return setMessage("請先選擇 Excel 名冊。");
    const retryEmails =
      mode === "commit" && preview?.mode === "commit"
        ? [
            ...new Set(
              (preview.failures ?? [])
                .map((failure) => failure.email?.trim().toLowerCase())
                .filter((email): email is string => Boolean(email)),
            ),
          ]
        : [];
    if (mode === "commit" && preview?.mode === "commit" && !retryEmails.length) {
      setMessage("沒有可自動重試的 Email；請保留畫面並聯絡歲悅客服確認。");
      return;
    }
    setUploadBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("organizationId", data.context.organizationId);
      body.set("mode", mode);
      if (retryEmails.length)
        body.set("retryEmails", JSON.stringify(retryEmails));
      const response = await fetch("/api/enterprise/invitations/import", {
        method: "POST",
        body,
      });
      const result = (await response.json().catch(() => null)) as
        | ImportPreview
        | { error?: string; imported?: number }
        | null;
      if (!result || !("valid" in result)) {
        setMessage("名冊處理失敗，請確認格式後重試。");
        return;
      }
      if (mode === "preview") {
        setPreview(result as ImportPreview);
        setMessage(
          (result as ImportPreview).valid
            ? "名冊檢查通過，可正式匯入。"
            : "名冊仍有錯誤；修正前不會建立任何邀請。",
        );
        return;
      }
      const commit = result as ImportPreview;
      const persisted = commit.summary?.persisted ?? 0;
      const failed = commit.summary?.failed ?? commit.failures?.length ?? 0;
      const pending = commit.summary?.emailPending ?? 0;
      setPreview(commit);
      await reload();
      if (!response.ok || !commit.valid || failed > 0 || pending > 0) {
        setMessage(
          `已建立或更新 ${persisted} 筆；${failed} 筆寫入失敗、${pending} 封 Email 待寄送。檔案已保留，可查看明細後重試。`,
        );
        return;
      }
      setPreview(null);
      setFile(null);
      setMessage(`已建立 ${persisted} 筆邀請並完成寄送。`);
    } catch {
      setMessage("名冊處理失敗，請檢查網路後重試。");
    } finally {
      setUploadBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="panel p-6">
          <div className="flex items-center gap-3">
            <MailPlus className="text-[#B45309]" />
            <h2 className="text-lg font-black text-[#302318]">單筆邀請</h2>
          </div>
          <form action={invite} className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Email（必填）">
              <input className="field" name="email" type="email" required />
            </Field>
            <Field label="姓名（選填）">
              <input className="field" name="fullName" maxLength={100} />
            </Field>
            <Field label="員工編號（選填）">
              <input className="field" name="employeeCode" maxLength={60} />
            </Field>
            <Field label="部門（選填）">
              <input className="field" name="department" maxLength={100} />
            </Field>
            <Field label="權限">
              <select className="field" name="role" defaultValue="member">
                <option value="member">一般成員</option>
                {data.context.role === "owner" && (
                  <option value="manager">機構管理者</option>
                )}
              </select>
            </Field>
            <button
              className="button-primary self-end"
              disabled={busy || inviteBusy}
            >
              {inviteBusy && <LoaderCircle className="size-4 animate-spin" />}
              <UserPlus className="size-4" /> 寄送邀請
            </button>
          </form>
        </section>

        <section className="panel p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="text-[#B45309]" />
              <h2 className="text-lg font-black text-[#302318]">Excel 批次邀請</h2>
            </div>
            <a
              className="text-link inline-flex"
              href={`/api/enterprise/invitations/template?organizationId=${data.context.organizationId}`}
            >
              <Download className="size-4" /> 下載範本
            </a>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Email 必填；姓名、員工編號與部門選填。系統會先完整檢查，全部通過才匯入。
          </p>
          <input
            className="field mt-4 pt-3"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
            }}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="button-secondary"
              disabled={!file || uploadBusy}
              onClick={() => void importRoster("preview")}
            >
              {uploadBusy && <LoaderCircle className="size-4 animate-spin" />}
              檢查名冊
            </button>
            <button
              type="button"
              className="button-primary"
              disabled={
                !preview ||
                (!preview.valid && preview.mode !== "commit") ||
                (preview.mode === "commit" &&
                  !(preview.failures ?? []).some((failure) => failure.email)) ||
                uploadBusy
              }
              onClick={() => void importRoster("commit")}
            >
              {preview?.mode === "commit" ? "只重試失敗項目" : "正式匯入"}
            </button>
          </div>
          {preview && (
            <div className={`mt-4 rounded-xl p-4 text-sm ${preview.valid ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
              共 {preview.totalRows ?? preview.summary?.totalRows ?? 0} 筆；
              {preview.valid
                ? "全部通過"
                : `${(preview.errors?.length ?? 0) + (preview.failures?.length ?? 0)} 個待處理項目`}
              {(preview.errors ?? []).slice(0, 6).map((error, index) => (
                <p key={`${error.rowNumber}-${error.field}-${index}`} className="mt-1">
                  {error.rowNumber ? `第 ${error.rowNumber} 列：` : ""}{error.message}
                </p>
              ))}
              {(preview.failures ?? []).slice(0, 6).map((failure, index) => (
                <p
                  key={`${failure.rowNumber}-${failure.email}-${index}`}
                  className="mt-1"
                >
                  {failure.rowNumber ? `第 ${failure.rowNumber} 列：` : ""}
                  {failure.email ? `${failure.email}：` : ""}
                  {failure.message}
                </p>
              ))}
            </div>
          )}
        </section>
      </div>

      <RosterTable
        members={data.members}
        invitations={data.invitations}
        organizationId={data.context.organizationId}
        owner={data.context.role === "owner"}
        busy={busy}
        mutate={mutate}
      />
    </div>
  );
}

function TrainingPanel({
  data,
  busy,
  manager,
  mutate,
  setMessage,
  reload,
}: {
  data: WorkspaceData;
  busy: boolean;
  manager: boolean;
  mutate: (
    url: string,
    options: RequestInit,
    successMessage: string,
  ) => Promise<boolean>;
  setMessage: (value: string) => void;
  reload: () => Promise<void>;
}) {
  const [selectedLotId, setSelectedLotId] = useState(data.seatLots[0]?.id ?? "");
  const [selectedLearnerIds, setSelectedLearnerIds] = useState<string[]>([]);
  const [selectedLiveSessionId, setSelectedLiveSessionId] = useState("");
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [assignmentSummary, setAssignmentSummary] =
    useState<AssignmentSummary | null>(null);
  const activeLots = data.seatLots.filter(
    (lot) =>
      lot.status === "active" &&
      (data.liveCoursesEnabled || lot.course?.delivery !== "live"),
  );
  const effectiveLotId = activeLots.some((lot) => lot.id === selectedLotId)
    ? selectedLotId
    : (activeLots[0]?.id ?? "");
  const selectedLot = activeLots.find((lot) => lot.id === effectiveLotId);
  const generatedAt = Date.parse(data.generatedAt);
  const sessions = data.liveSessions.filter(
    (session) =>
      session.course_id === selectedLot?.course_id &&
      Date.parse(session.starts_at) > generatedAt &&
      Date.parse(session.starts_at) <=
        Date.parse(selectedLot?.valid_until ?? ""),
  );

  async function assign(formData: FormData) {
    if (!selectedLot || !effectiveLotId) {
      setMessage("目前沒有可用的名額批次。");
      return;
    }
    const selectedMembers = data.members.filter((member) =>
      selectedLearnerIds.includes(member.user_id),
    );
    if (selectedMembers.length === 0) {
      setMessage("請至少選擇一位員工。");
      return;
    }
    if (
      selectedMembers.length > Number(selectedLot.available_quantity ?? 0)
    ) {
      setMessage(
        `本批次只剩 ${selectedLot.available_quantity ?? 0} 個名額，請減少勾選人數。`,
      );
      return;
    }
    const dueAt = String(formData.get("dueAt") ?? "");
    setAssignmentBusy(true);
    setAssignmentSummary(null);
    setMessage("");
    let successCount = 0;
    const failures: AssignmentFailure[] = [];

    for (const member of selectedMembers) {
      try {
        const response = await fetch("/api/enterprise/allocations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organizationId: data.context.organizationId,
            lotId: effectiveLotId,
            learnerId: member.user_id,
            dueAt: dueAt ? dateInputToTaipeiDeadline(dueAt) : null,
            liveSessionId:
              selectedLot.course?.delivery === "live" &&
              selectedLiveSessionId
                ? selectedLiveSessionId
                : null,
          }),
        });
        const result = (await response.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        if (response.ok) {
          successCount += 1;
        } else {
          failures.push({
            learnerId: member.user_id,
            learnerName: member.fullName || member.email,
            reason: errorMessage(result?.error, result?.message),
          });
        }
      } catch {
        failures.push({
          learnerId: member.user_id,
          learnerName: member.fullName || member.email,
          reason: "網路連線中斷，請稍後重試。",
        });
      }
    }

    setAssignmentBusy(false);
    setAssignmentSummary({ successCount, failures });
    setSelectedLearnerIds(failures.map((failure) => failure.learnerId));
    setMessage(
      failures.length
        ? `批次指派完成：成功 ${successCount} 人、失敗 ${failures.length} 人。`
        : `已成功指派 ${successCount} 人，學員會收到 Email 通知。`,
    );
    await reload();
  }

  async function release(allocationId: string) {
    await mutate(
      "/api/enterprise/allocations",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "release",
          organizationId: data.context.organizationId,
          allocationId,
        }),
      },
      "名額已收回並回到原批次。",
    );
  }

  return (
    <div className="space-y-6">
      {manager && (
        <section className="panel p-6">
          <div className="flex items-center gap-3">
            <Send className="text-[#B45309]" />
            <div>
              <h2 className="text-lg font-black text-[#302318]">指派課程名額</h2>
              <p className="mt-1 text-sm text-slate-500">
                可一次勾選多位員工；直播名額可以先指派，之後再替員工選場。
              </p>
            </div>
          </div>
          <form action={assign} className="mt-5 grid min-w-0 gap-5 lg:grid-cols-2">
            <div className="grid min-w-0 content-start gap-4">
              <Field label="名額批次">
              <select
                className="field"
                name="lotId"
                required
                value={effectiveLotId}
                onChange={(event) => {
                  setSelectedLotId(event.target.value);
                  setSelectedLiveSessionId("");
                  setAssignmentSummary(null);
                }}
              >
                {activeLots.length === 0 && <option value="">目前沒有可用名額</option>}
                {activeLots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.course?.title ?? "課程"}（可用 {lot.available_quantity ?? 0}）
                  </option>
                ))}
              </select>
              </Field>
              <Field label="完成／選填期限">
                <input
                  className="field"
                  type="date"
                  name="dueAt"
                  min={taipeiDateInput(data.generatedAt)}
                  max={
                    selectedLot
                      ? taipeiDateInput(selectedLot.valid_until)
                      : undefined
                  }
                />
              </Field>
              {selectedLot?.course?.delivery === "live" && (
                <Field label="直播場次（可稍後再選）">
                  <select
                    className="field max-w-full"
                    name="liveSessionId"
                    value={selectedLiveSessionId}
                    onChange={(event) =>
                      setSelectedLiveSessionId(event.target.value)
                    }
                  >
                    <option value="">先指派通用名額，稍後選場</option>
                    {sessions.map((session) => {
                      const remaining = remainingSessionSeats(session);
                      return (
                        <option
                          key={session.id}
                          value={session.id}
                          disabled={remaining <= 0}
                        >
                          {session.title}・{formatDate(session.starts_at)}・剩餘 {remaining}
                        </option>
                      );
                    })}
                  </select>
                </Field>
              )}
              <div className="rounded-xl bg-[#FFF8ED] p-4 text-sm leading-6 text-[#694115]">
                本批次可用 <strong>{selectedLot?.available_quantity ?? 0}</strong> 個；
                已勾選 <strong>{selectedLearnerIds.length}</strong> 人。
                {selectedLot?.course?.delivery === "live" && !selectedLiveSessionId && (
                  <span className="mt-1 block">指派後可在下方「直播選場」逐人安排場次。</span>
                )}
              </div>
            </div>

            <div className="min-w-0">
              <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-black text-[#493625]">選擇員工</p>
                <button
                  type="button"
                  className="min-h-11 px-2 text-sm font-black text-[#B45309]"
                  onClick={() =>
                    setSelectedLearnerIds((current) =>
                      data.members.length > 0 &&
                      data.members.every((member) =>
                        current.includes(member.user_id),
                      )
                        ? []
                        : data.members.map((member) => member.user_id),
                    )
                  }
                >
                  {data.members.length > 0 &&
                  data.members.every((member) =>
                    selectedLearnerIds.includes(member.user_id),
                  )
                    ? "取消全選"
                    : "全部選擇"}
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-xl border border-[#EADFCF] bg-white p-2">
                {data.members.map((member) => {
                  const checked = selectedLearnerIds.includes(member.user_id);
                  return (
                    <label
                      key={member.user_id}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-[#FFF8ED]"
                    >
                      <input
                        type="checkbox"
                        className="size-5 shrink-0 accent-[#B45309]"
                        checked={checked}
                        onChange={() =>
                          setSelectedLearnerIds((current) =>
                            checked
                              ? current.filter((id) => id !== member.user_id)
                              : [...current, member.user_id],
                          )
                        }
                      />
                      <span className="min-w-0 text-sm">
                        <strong className="block truncate text-[#302318]">
                          {member.fullName || member.email}
                        </strong>
                        <span className="block truncate text-xs text-slate-500">
                          {member.department || "未填部門"}・{member.email}
                        </span>
                      </span>
                    </label>
                  );
                })}
                {data.members.length === 0 && (
                  <p className="p-4 text-center text-sm text-slate-500">
                    請先邀請員工加入機構。
                  </p>
                )}
              </div>
            </div>

            <button
              className="button-primary lg:col-span-2"
              disabled={
                busy ||
                assignmentBusy ||
                !effectiveLotId ||
                selectedLearnerIds.length === 0
              }
            >
              {assignmentBusy && <LoaderCircle className="size-4 animate-spin" />}
              指派給 {selectedLearnerIds.length} 位員工
            </button>
          </form>
          {assignmentSummary && (
            <div
              className={`mt-4 rounded-xl p-4 text-sm leading-6 ${assignmentSummary.failures.length ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}
              role="status"
            >
              <p className="font-black">
                成功 {assignmentSummary.successCount} 人・失敗 {assignmentSummary.failures.length} 人
              </p>
              {assignmentSummary.failures.length > 0 && (
                <ul className="mt-2 grid gap-1">
                  {assignmentSummary.failures.map((failure) => (
                    <li key={failure.learnerId} className="break-words">
                      {failure.learnerName}：{failure.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {manager && data.liveCoursesEnabled &&
        data.allocations.some(
          (allocation) =>
            allocation.status === "assigned" &&
            allocation.course?.delivery === "live",
        ) && (
          <section className="panel p-6">
            <div className="flex items-start gap-3">
              <CalendarDays className="mt-0.5 shrink-0 text-[#B45309]" />
              <div>
                <h2 className="text-lg font-black text-[#302318]">直播選場與改場</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  顯示即時剩餘容量；已有場次者須在開課 24 小時前完成自行改場。
                </p>
              </div>
            </div>
            <div className="mt-5 grid min-w-0 gap-4 xl:grid-cols-2">
              {data.allocations
                .filter(
                  (allocation) =>
                    allocation.status === "assigned" &&
                    allocation.course?.delivery === "live",
                )
                .map((allocation) => (
                  <LiveSessionAllocationCard
                    key={allocation.id}
                    allocation={allocation}
                    data={data}
                    busy={busy}
                    mutate={mutate}
                  />
                ))}
            </div>
          </section>
        )}

      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 p-6">
          <div>
            <h2 className="text-lg font-black text-[#302318]">
              {manager ? "學習追蹤" : "機構指派課程"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              個人購課與機構指派紀錄分開顯示。
            </p>
          </div>
          <span className="rounded-full bg-[#FFF0D5] px-3 py-1.5 text-xs font-black text-[#8A4800]">
            {data.allocations.length} 筆
          </span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>員工</th>
                <th>課程／場次</th>
                <th>期限</th>
                <th>進度</th>
                <th>積分資料</th>
                <th>狀態</th>
                {manager && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {data.allocations.map((allocation) => {
                const member = data.members.find(
                  (item) => item.user_id === allocation.learner_id,
                );
                const enrollment = data.enrollments.find(
                  (item) =>
                    item.learner_id === allocation.learner_id &&
                    item.course_id === allocation.course_id &&
                    (item.live_session_id ?? null) ===
                      (allocation.live_session_id ?? null),
                );
                const session = data.liveSessions.find(
                  (item) => item.id === allocation.live_session_id,
                );
                const accreditation = enrollment
                  ? data.accreditationStatuses.find(
                      (item) => item.enrollment_id === enrollment.id,
                    )
                  : undefined;
                return (
                  <tr key={allocation.id}>
                    <td>
                      <strong>{member?.fullName || member?.email || "學員"}</strong>
                      {manager && <span className="mt-1 block text-xs">{member?.department || "未填部門"}</span>}
                    </td>
                    <td>
                      {allocation.course?.title ?? "企業課程"}
                      {session ? (
                        <span className="mt-1 block text-xs">{session.title}</span>
                      ) : allocation.course?.delivery === "live" ? (
                        <span className="mt-1 block text-xs font-black text-amber-700">
                          尚未選擇直播場次
                        </span>
                      ) : null}
                    </td>
                    <td>{allocation.due_at ? formatDate(allocation.due_at) : "未設定"}</td>
                    <td>{enrollment ? `${Number(enrollment.progress_percent ?? 0)}%` : "—"}</td>
                    <td>
                      {allocation.course?.accredited
                        ? accreditationLabel(accreditation?.status)
                        : "不適用"}
                    </td>
                    <td><StatusBadge value={allocation.status} /></td>
                    {manager && (
                      <td>
                        {["assigned", "booked"].includes(allocation.status) && (
                          <button
                            type="button"
                            className="min-h-11 text-sm font-black text-[#B45309]"
                            onClick={() => void release(allocation.id)}
                            disabled={busy}
                          >
                            <RotateCcw className="mr-1 inline size-4" /> 收回
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {data.allocations.length === 0 && (
                <tr><td colSpan={manager ? 7 : 6} className="text-center">尚無機構指派課程。</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function LiveSessionAllocationCard({
  allocation,
  data,
  busy,
  mutate,
}: {
  allocation: Allocation;
  data: WorkspaceData;
  busy: boolean;
  mutate: (
    url: string,
    options: RequestInit,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const currentSession = data.liveSessions.find(
    (session) => session.id === allocation.live_session_id,
  );
  const lot = data.seatLots.find(
    (candidate) =>
      candidate.id === (allocation.seat_lot_id ?? allocation.lot_id),
  );
  const generatedAt = Date.parse(data.generatedAt);
  const cutoffReached = Boolean(
    currentSession &&
      Date.parse(currentSession.starts_at) <= generatedAt + 24 * 60 * 60 * 1000,
  );
  const choices = data.liveSessions.filter(
    (session) =>
      session.course_id === allocation.course_id &&
      ["scheduled", "open"].includes(session.status ?? "") &&
      Date.parse(session.starts_at) > generatedAt &&
      Date.parse(session.starts_at) <= Date.parse(lot?.valid_until ?? ""),
  );
  const defaultSessionId = choices.some(
    (session) => session.id === allocation.live_session_id,
  )
    ? (allocation.live_session_id ?? "")
    : "";
  const [selectedSessionId, setSelectedSessionId] = useState(defaultSessionId);
  const member = data.members.find(
    (candidate) => candidate.user_id === allocation.learner_id,
  );
  const selectedSession = choices.find(
    (session) => session.id === selectedSessionId,
  );
  const selectedIsFull = Boolean(
    selectedSession &&
      selectedSession.id !== allocation.live_session_id &&
      remainingSessionSeats(selectedSession) <= 0,
  );

  async function selectSession() {
    if (!selectedSessionId) return;
    const changed = await mutate(
      "/api/enterprise/allocations",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "select_session",
          organizationId: data.context.organizationId,
          allocationId: allocation.id,
          liveSessionId: selectedSessionId,
        }),
      },
      allocation.live_session_id
        ? "直播場次已變更，學員會收到 Email 通知。"
        : "直播場次已選定，學員會收到 Email 通知。",
    );
    if (changed) setSelectedSessionId("");
  }

  return (
    <article className="min-w-0 rounded-2xl border border-[#EADFCF] bg-[#FFFDF9] p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-black text-[#302318]">
            {member?.fullName || member?.email || "學員"}
          </p>
          <p className="mt-1 truncate text-xs text-slate-500">
            {allocation.course?.title ?? "直播課程"}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${currentSession ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}
        >
          {currentSession ? "已選場" : "待選場"}
        </span>
      </div>
      {currentSession && (
        <div className="mt-3 rounded-xl bg-white p-3 text-sm text-slate-600">
          <p className="font-black text-[#493625]">目前：{currentSession.title}</p>
          <p className="mt-1 text-xs">{formatDate(currentSession.starts_at)}</p>
        </div>
      )}
      {cutoffReached ? (
        <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold leading-6 text-rose-800">
          已進入課前 24 小時限制；如需改場，請聯絡歲悅管理員處理。
        </p>
      ) : (
        <div className="mt-3 grid gap-3">
          <Field label={currentSession ? "改到其他場次" : "選擇場次"}>
            <select
              className="field max-w-full"
              value={selectedSessionId}
              onChange={(event) => setSelectedSessionId(event.target.value)}
            >
              <option value="">請選擇可用場次</option>
              {choices.map((session) => {
                const remaining = remainingSessionSeats(session);
                const current = session.id === allocation.live_session_id;
                return (
                  <option
                    key={session.id}
                    value={session.id}
                    disabled={!current && remaining <= 0}
                  >
                    {session.title}・{formatDate(session.starts_at)}・
                    {current ? "目前場次" : `剩餘 ${remaining}/${session.capacity}`}
                  </option>
                );
              })}
            </select>
          </Field>
          <button
            type="button"
            className="button-primary w-full"
            disabled={
              busy ||
              !selectedSessionId ||
              selectedSessionId === allocation.live_session_id ||
              selectedIsFull
            }
            onClick={() => void selectSession()}
          >
            {currentSession ? "確認改場" : "確認選場"}
          </button>
          {choices.length === 0 && (
            <p className="text-sm leading-6 text-slate-500">
              名額效期內目前沒有可選的未來場次，請稍後再查看。
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function BillingPanel({
  data,
  busy,
  setMessage,
}: {
  data: WorkspaceData;
  busy: boolean;
  setMessage: (value: string) => void;
}) {
  const [courseId, setCourseId] = useState(data.courses[0]?.id ?? "");
  const [quantity, setQuantity] = useState(5);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [refundBusy, setRefundBusy] = useState(false);
  const checkoutAttempt = useRef<{ signature: string; key: string } | null>(
    null,
  );
  const refundAttempt = useRef<{ signature: string; key: string } | null>(null);
  const pricing = useMemo(() => {
    const timestamp = Date.parse(data.generatedAt);
    const tiers = data.priceTiers
      .filter(
        (tier) => {
          const effectiveAt = Date.parse(tier.effective_at);
          const expiresAt = tier.expires_at
            ? Date.parse(tier.expires_at)
            : null;
          return (
            tier.active &&
            tier.course_id === courseId &&
            quantity >= tier.min_quantity &&
            (tier.max_quantity === null || quantity <= tier.max_quantity) &&
            Number.isFinite(timestamp) &&
            Number.isFinite(effectiveAt) &&
            effectiveAt <= timestamp &&
            (expiresAt === null ||
              (Number.isFinite(expiresAt) && expiresAt > timestamp))
          );
        },
      )
      .sort((a, b) => b.min_quantity - a.min_quantity);
    return tiers[0] ?? null;
  }, [courseId, data.generatedAt, data.priceTiers, quantity]);

  async function checkout(formData: FormData) {
    setMessage("");
    setCheckoutBusy(true);
    const signature = JSON.stringify({
      courseId,
      quantity,
      invoiceTitle: formData.get("invoiceTitle"),
      invoiceTaxId: formData.get("invoiceTaxId"),
      invoiceEmail: formData.get("invoiceEmail"),
    });
    if (checkoutAttempt.current?.signature !== signature)
      checkoutAttempt.current = { signature, key: crypto.randomUUID() };
    let response: Response;
    try {
      response = await fetch("/api/enterprise/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: data.context.organizationId,
          courseId,
          quantity,
          invoiceTitle: formData.get("invoiceTitle"),
          invoiceTaxId: formData.get("invoiceTaxId"),
          invoiceEmail: formData.get("invoiceEmail"),
          idempotencyKey: checkoutAttempt.current.key,
        }),
      });
    } catch {
      setCheckoutBusy(false);
      setMessage("無法連線到付款服務，請稍後重試。");
      return;
    }
    const result = (await response.json().catch(() => null)) as
      | { action?: string; fields?: Record<string, string>; error?: string }
      | null;
    if (!response.ok || !result?.action || !result.fields) {
      setCheckoutBusy(false);
      if (result?.error === "CHECKOUT_QUOTE_EXPIRED")
        checkoutAttempt.current = null;
      setMessage(errorMessage(result?.error));
      return;
    }
    submitProviderForm(result.action, result.fields);
  }

  async function requestRefund(formData: FormData) {
    setMessage("");
    const lot = data.seatLots.find(
      (candidate) => candidate.id === formData.get("seatLotId"),
    );
    if (!lot?.source_order_id) {
      setMessage("找不到原始訂單，請聯絡客服。");
      return;
    }
    const refundInput = {
      organizationId: data.context.organizationId,
      orderId: lot.source_order_id,
      quantity: Number(formData.get("quantity")),
      reason: String(formData.get("reason") ?? "").trim(),
    };
    const signature = JSON.stringify(refundInput);
    if (refundAttempt.current?.signature !== signature)
      refundAttempt.current = { signature, key: crypto.randomUUID() };
    setRefundBusy(true);
    let response: Response;
    try {
      response = await fetch("/api/enterprise/refunds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...refundInput,
          idempotencyKey: refundAttempt.current.key,
        }),
      });
    } catch {
      setRefundBusy(false);
      setMessage("退費申請連線失敗；再次送出會沿用同一申請編號。");
      return;
    }
    const result = (await response.json().catch(() => null)) as
      | { error?: string; message?: string }
      | null;
    setRefundBusy(false);
    if (response.ok) refundAttempt.current = null;
    setMessage(
      response.ok
        ? "部分退費申請已送出，將由歲悅管理員人工審核。"
        : result?.error === "INSUFFICIENT_UNUSED_SEATS"
          ? "可退名額不足；已開始學習、已簽到或已發證的名額不能退回。"
          : result?.message || "退費申請失敗。",
    );
  }

  return (
    <div className="space-y-6">
      <section className="panel p-6">
        <div className="flex items-center gap-3">
          <BadgeDollarSign className="text-[#B45309]" />
          <div>
            <h2 className="text-lg font-black text-[#302318]">購買課程名額</h2>
            <p className="mt-1 text-sm text-slate-500">
              限綠界信用卡一次付清；付款確認後才建立一年效期名額並開立統編電子發票。
            </p>
          </div>
        </div>
        <form action={checkout} className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="課程">
            <select className="field" value={courseId} onChange={(event) => setCourseId(event.target.value)} required>
              {data.courses.map((course) => (
                <option key={course.id} value={course.id}>{course.title}（{course.delivery === "live" ? "直播" : "錄播"}）</option>
              ))}
            </select>
          </Field>
          <Field label="名額數量">
            <input className="field" type="number" min="1" max="1000" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} required />
          </Field>
          <div className="rounded-xl bg-[#FFF8ED] p-4">
            <p className="text-xs font-black text-[#694115]">伺服器級距試算</p>
            <p className="mt-2 text-xl font-black text-[#B45309]">
              {pricing ? `NT$ ${(pricing.unit_price_twd * quantity).toLocaleString("zh-TW")}` : "此數量無售價"}
            </p>
            {pricing && <p className="mt-1 text-xs text-slate-500">每名 NT$ {pricing.unit_price_twd.toLocaleString("zh-TW")}</p>}
          </div>
          <Field label="發票抬頭">
            <input className="field" name="invoiceTitle" maxLength={60} defaultValue={data.context.organization.name} required />
          </Field>
          <Field label="統一編號">
            <input className="field" name="invoiceTaxId" inputMode="numeric" pattern="[0-9]{8}" defaultValue={data.context.organization.tax_id ?? ""} required />
          </Field>
          <Field label="發票通知 Email">
            <input className="field" name="invoiceEmail" type="email" defaultValue={data.context.organization.invoice_email ?? ""} required />
          </Field>
          <button className="button-primary md:col-span-2 xl:col-span-3" disabled={busy || checkoutBusy || !pricing}>
            {checkoutBusy && <LoaderCircle className="size-4 animate-spin" />}
            前往綠界信用卡付款
          </button>
        </form>
      </section>

      <section className="panel p-6">
        <div className="flex items-center gap-3">
          <RotateCcw className="text-[#B45309]" />
          <div>
            <h2 className="text-lg font-black text-[#302318]">未使用名額退費</h2>
            <p className="mt-1 text-sm text-slate-500">
              以購買時單價計算，不重新套用級距；申請後由歲悅人工審核。
            </p>
          </div>
        </div>
        <form action={requestRefund} className="mt-5 grid gap-4 md:grid-cols-3">
          <Field label="名額批次">
            <select className="field" name="seatLotId" required>
              {data.seatLots
                .filter(
                  (lot) =>
                    lot.status === "active" &&
                    Number(lot.available_quantity ?? 0) > 0,
                )
                .map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.course?.title ?? "課程"}（可退 {lot.available_quantity}）
                  </option>
                ))}
            </select>
          </Field>
          <Field label="退回數量">
            <input
              className="field"
              name="quantity"
              type="number"
              min="1"
              required
            />
          </Field>
          <Field label="申請原因">
            <input
              className="field"
              name="reason"
              minLength={5}
              maxLength={500}
              required
            />
          </Field>
          <button
            className="button-secondary md:col-span-3"
            disabled={
              busy ||
              refundBusy ||
              !data.seatLots.some(
                (lot) => Number(lot.available_quantity ?? 0) > 0,
              )
            }
          >
            {refundBusy && <LoaderCircle className="size-4 animate-spin" />}
            送出人工退費申請
          </button>
        </form>
      </section>

      <section className="panel overflow-hidden">
        <div className="flex items-center gap-3 p-6">
          <ReceiptText className="text-[#B45309]" />
          <h2 className="text-lg font-black text-[#302318]">訂單、發票與退費</h2>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>建立日期</th><th>訂單</th><th>金額</th><th>付款</th><th>發票</th><th>折讓</th><th>退費</th></tr></thead>
            <tbody>
              {data.orders.map((order) => {
                const invoice = data.invoices.find(
                  (item) =>
                    item.order_id === order.id && item.record_type === "invoice",
                );
                const allowances = data.invoices.filter(
                  (item) =>
                    item.order_id === order.id && item.record_type === "allowance",
                );
                const refunds = data.refunds.filter((item) => item.order_id === order.id);
                return (
                  <tr key={order.id}>
                    <td>{formatDate(order.created_at)}</td>
                    <td>{order.merchant_trade_no ?? order.id.slice(0, 8)}</td>
                    <td>NT$ {order.amount_twd.toLocaleString("zh-TW")}</td>
                    <td><StatusBadge value={order.status} /></td>
                    <td>
                      <StatusBadge value={invoice?.status ?? "pending"} />
                      {invoice?.invoice_number && <span className="mt-1 block text-xs">{invoice.invoice_number}</span>}
                    </td>
                    <td>
                      {allowances.length
                        ? allowances.map((allowance) => (
                            <span key={allowance.id} className="mb-1 block">
                              <StatusBadge
                                value={allowance.allowance_status ?? allowance.status}
                              />
                              {allowance.allowance_number && (
                                <span className="mt-1 block text-xs">
                                  {allowance.allowance_number}
                                </span>
                              )}
                            </span>
                          ))
                        : "—"}
                    </td>
                    <td>{refunds.length ? refunds.map((item) => <StatusBadge key={item.id} value={item.status} />) : "—"}</td>
                  </tr>
                );
              })}
              {data.orders.length === 0 && <tr><td colSpan={7} className="text-center">尚無企業訂單。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ReportsPanel({ data }: { data: WorkspaceData }) {
  const [courseId, setCourseId] = useState("");
  const [liveSessionId, setLiveSessionId] = useState("");
  const [department, setDepartment] = useState("");
  const [completionStatus, setCompletionStatus] =
    useState<ReportCompletionStatus>("");
  const reportCourses = useMemo(() => {
    const courseIds = new Set([
      ...data.seatLots.map((lot) => lot.course_id),
      ...data.allocations.map((allocation) => allocation.course_id),
    ]);
    return data.reportCourses.filter((course) => courseIds.has(course.id));
  }, [data.allocations, data.reportCourses, data.seatLots]);
  const reportLiveSessions = useMemo(() => {
    const allocatedSessionIds = new Set(
      data.allocations.flatMap((allocation) =>
        allocation.live_session_id ? [allocation.live_session_id] : [],
      ),
    );
    return data.liveSessions
      .filter(
        (session) =>
          allocatedSessionIds.has(session.id) &&
          (!courseId || session.course_id === courseId),
      )
      .sort(
        (left, right) =>
          Date.parse(right.starts_at) - Date.parse(left.starts_at),
      );
  }, [courseId, data.allocations, data.liveSessions]);
  const departments = useMemo(
    () =>
      [...new Set(data.members.map((member) => member.department?.trim()))]
        .filter((value): value is string => Boolean(value))
        .sort((left, right) => left.localeCompare(right, "zh-TW")),
    [data.members],
  );
  const reportUrl = useMemo(() => {
    const params = new URLSearchParams({
      organizationId: data.context.organizationId,
    });
    if (courseId) params.set("courseId", courseId);
    if (liveSessionId) params.set("liveSessionId", liveSessionId);
    if (department) params.set("department", department);
    if (completionStatus)
      params.set("completionStatus", completionStatus);
    return `/api/enterprise/report?${params.toString()}`;
  }, [
    completionStatus,
    courseId,
    data.context.organizationId,
    department,
    liveSessionId,
  ]);

  return (
    <section className="panel p-6">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#FFF0D5] text-[#B45309]"><FileSpreadsheet /></span>
        <div>
          <h2 className="text-lg font-black text-[#302318]">機構培訓 Excel</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            匯出培訓摘要、員工成果、直播出席與名額異動；不含身分證明文、測驗作答或原始敏感事件。
          </p>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="課程">
          <select
            className="field"
            value={courseId}
            onChange={(event) => {
              setCourseId(event.target.value);
              setLiveSessionId("");
            }}
          >
            <option value="">全部課程</option>
            {reportCourses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="直播場次">
          <select
            className="field"
            value={liveSessionId}
            onChange={(event) => setLiveSessionId(event.target.value)}
          >
            <option value="">全部場次</option>
            {reportLiveSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title}・{formatDate(session.starts_at)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="部門">
          <select
            className="field"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          >
            <option value="">全部部門</option>
            {departments.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="完成狀態">
          <select
            className="field"
            value={completionStatus}
            onChange={(event) =>
              setCompletionStatus(
                event.target.value as ReportCompletionStatus,
              )
            }
          >
            {reportCompletionOptions.map(([value, label]) => (
              <option key={value || "all"} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <a className="button-primary w-full sm:w-auto" href={reportUrl}>
          <Download className="size-4" /> 下載篩選報表
        </a>
        <p className="text-xs font-bold text-slate-500">
          系統只會匯出目前機構範圍內符合篩選條件的資料。
        </p>
      </div>
      <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {["培訓摘要", "員工成果", "直播出席", "名額異動"].map((name) => (
          <div key={name} className="rounded-xl border border-[#EADFCF] bg-[#FFFDF9] p-4">
            <CheckCircle2 className="size-5 text-emerald-600" />
            <p className="mt-2 font-black text-[#302318]">{name}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function RosterTable({
  members,
  invitations,
  organizationId,
  owner,
  busy,
  mutate,
}: {
  members: Member[];
  invitations: Invitation[];
  organizationId: string;
  owner: boolean;
  busy: boolean;
  mutate: (
    url: string,
    options: RequestInit,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  async function updateRole(member: Member) {
    const role = member.role === "manager" ? "member" : "manager";
    await mutate(
      "/api/enterprise/members",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, userId: member.user_id, role }),
      },
      role === "manager"
        ? "已將成員設為機構管理者。"
        : "已將機構管理者調整為一般成員。",
    );
  }
  async function updateInvitation(
    invitation: Invitation,
    action: "resend" | "revoke",
  ) {
    await mutate(
      "/api/enterprise/invitations",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          invitationId: invitation.id,
          action,
        }),
      },
      action === "revoke"
        ? "邀請已撤銷。"
        : "邀請已更新；若 Email 暫時未送達，可稍後再次重寄。",
    );
  }
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-6">
        <div className="flex items-center gap-3"><Users className="text-[#B45309]" /><h2 className="text-lg font-black text-[#302318]">員工名冊</h2></div>
        <span className="text-xs font-black text-slate-500">已加入 {members.length}・邀請 {invitations.length}</span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>姓名／Email</th><th>員工編號</th><th>部門</th><th>權限</th><th>狀態</th><th>操作</th></tr></thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.user_id}>
                <td><strong>{member.fullName || "未填姓名"}</strong><span className="mt-1 block text-xs">{member.email}</span></td>
                <td>{member.employee_code || "—"}</td><td>{member.department || "—"}</td><td>{roleLabel(member.role)}</td><td><StatusBadge value="accepted" /></td>
                <td>
                  {owner && member.role !== "owner" ? (
                      <button
                        type="button"
                        className="min-h-11 text-sm font-black text-[#B45309]"
                        disabled={busy}
                        onClick={() => void updateRole(member)}
                      >
                        {member.role === "manager" ? "改為成員" : "設為管理者"}
                      </button>
                  ) : "—"}
                </td>
              </tr>
            ))}
            {invitations.filter((item) => item.status !== "accepted").map((item) => (
              <tr key={item.id}>
                <td><strong>{item.invitee_name || "待加入"}</strong><span className="mt-1 block text-xs">{item.email}</span></td>
                <td>{item.employee_code || "—"}</td><td>{item.department || "—"}</td><td>{roleLabel(item.role)}</td><td><StatusBadge value={item.status} /></td>
                <td>
                  {!owner && item.role === "manager" ? "僅擁有者可操作" : (
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        className="min-h-11 text-sm font-black text-[#B45309]"
                        disabled={busy}
                        onClick={() => void updateInvitation(item, "resend")}
                      >
                        重寄
                      </button>
                      {item.status === "pending" && (
                        <button
                          type="button"
                          className="min-h-11 text-sm font-black text-rose-700"
                          disabled={busy}
                          onClick={() => void updateInvitation(item, "revoke")}
                        >
                          撤銷
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Metric({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return <div className="metric-card"><span className="text-[#B45309] [&_svg]:size-6">{icon}</span><p className="mt-4 text-2xl font-black text-[#302318]">{value}</p><p className="mt-1 text-xs font-bold text-slate-500">{label}</p></div>;
}

function Notice({ title, value }: { title: string; value: number }) {
  return <div className="rounded-xl border border-[#EADFCF] p-4"><p className="text-sm font-bold text-slate-500">{title}</p><p className={`mt-2 text-2xl font-black ${value ? "text-[#B45309]" : "text-emerald-700"}`}>{value}</p></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-2 text-sm font-black text-[#493625]"><span>{label}</span>{children}</label>;
}

function StatusBadge({ value }: { value: string }) {
  const good = ["approved", "accepted", "active", "paid", "issued", "completed", "consumed"].includes(value);
  const bad = ["rejected", "suspended", "failed", "revoked", "expired"].includes(value);
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${good ? "bg-emerald-100 text-emerald-800" : bad ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-900"}`}>{statusLabel(value)}</span>;
}

function roleLabel(value: string) {
  return value === "owner" ? "機構擁有者" : value === "manager" ? "機構管理者" : "一般成員";
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    pending: "待處理", approved: "已通過", rejected: "未通過", suspended: "已停權",
    accepted: "已加入", revoked: "已撤銷", expired: "已逾期", active: "有效",
    assigned: "已指派", booked: "已選場", consumed: "已開始", released: "已收回",
    paid: "已付款", partially_refunded: "部分退費", refunded: "已退費", issued: "已開立",
    failed: "異常", manual_review: "人工審核", completed: "已完成",
    none: "尚無折讓", processing: "處理中", pending_consent: "待同意折讓",
    ambiguous: "待人工對帳", allowance_issued: "折讓已開立",
  };
  return labels[value] ?? value;
}

function accreditationLabel(value?: AccreditationStatus["status"]) {
  if (!value || value === "draft") return "未填";
  if (value === "submitted") return "待驗證";
  if (value === "verified") return "已驗證";
  return "待補正";
}

function remainingSessionSeats(session: LiveSession) {
  const occupied = (session.live_session_bookings ?? []).filter((booking) =>
    ["held", "confirmed"].includes(booking.status),
  ).length;
  return Math.max(0, Number(session.capacity) - occupied);
}

function dateInputToTaipeiDeadline(value: string) {
  return new Date(`${value}T23:59:59+08:00`).toISOString();
}

function taipeiDateInput(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Taipei",
  }).format(timestamp);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: value.includes("T") ? "short" : undefined, timeZone: "Asia/Taipei" }).format(date);
}

function errorMessage(code?: string, detail?: string) {
  const labels: Record<string, string> = {
    FEATURE_DISABLED: "企業功能尚未開放。",
    LIVE_FEATURE_DISABLED: "直播企業功能目前尚未開放。",
    ORGANIZATION_NOT_ACTIVE: "機構目前未核准或已暫停，請聯絡歲悅客服。",
    FORBIDDEN: "目前帳號沒有這項操作權限。",
    NO_AVAILABLE_SEATS: "這個批次已沒有可用名額。",
    ALREADY_ENTITLED: "該學員已擁有相同課程或場次。",
    LIVE_SESSION_FULL: "直播場次已滿，請選擇其他場次。",
    CHANGE_WINDOW_CLOSED: "已超過課前 24 小時自行改場期限。",
    PRICE_TIER_NOT_AVAILABLE: "此數量沒有適用的企業級距售價。",
    CHECKOUT_QUOTE_EXPIRED:
      "付款報價已超過 15 分鐘，請再次點選付款取得最新價格。",
    INVOICE_NOT_CONFIGURED:
      "企業付款暫停：電子發票環境尚未完成或與金流環境不一致。",
    INVOICE_TAX_ID_MISMATCH:
      "發票統編必須與已核准的機構統編相同。",
    IDEMPOTENCY_SNAPSHOT_MISMATCH:
      "結帳資料已改變，請更新工作台後重新結帳。",
  };
  return labels[code ?? ""] ?? detail ?? "操作失敗，請稍後再試。";
}

function submitProviderForm(action: string, fields: Record<string, string>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.style.display = "none";
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

export function EnterpriseFeatureGate() {
  return (
    <div className="mx-auto max-w-2xl rounded-3xl border border-[#EADFCF] bg-white p-8 text-center shadow-xl sm:p-12">
      <span className="mx-auto grid size-18 place-items-center rounded-full bg-[#FFF0D5] text-[#B45309]"><Building2 className="size-9" /></span>
      <p className="section-kicker mt-6">CONTROLLED ROLLOUT</p>
      <h1 className="mt-3 text-3xl font-black text-[#302318]">企業與機構培訓尚未對外開放</h1>
      <p className="mt-4 leading-8 text-slate-500">功能已納入第四階段，將依序完成內部錄播機構、非積分直播機構及正式積分機構驗證後開放。</p>
      <Link className="button-primary mt-8" href="/courses">回到課程目錄</Link>
    </div>
  );
}
