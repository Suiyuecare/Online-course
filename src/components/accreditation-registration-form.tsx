"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";

export function AccreditationRegistrationForm({
  courseSlug,
  liveSessionId,
  enabled,
}: {
  courseSlug: string;
  liveSessionId?: string;
  enabled: boolean;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch(
      `/api/accreditation/${courseSlug}/registration${liveSessionId ? `?session=${liveSessionId}` : ""}`,
      {
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const data = await response.json();
        if (response.ok && data.registration) {
          setStatus(data.registration.status);
          setReason(data.registration.correction_reason ?? "");
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [courseSlug, liveSessionId, enabled]);
  async function submit(formData: FormData) {
    setBusy(true);
    setMessage("");
    const payload = Object.fromEntries(formData.entries());
    const response = await fetch(
      `/api/accreditation/${courseSlug}/registration${liveSessionId ? `?session=${liveSessionId}` : ""}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, consent: payload.consent === "on" }),
      },
    );
    const data = await response.json();
    setBusy(false);
    if (!response.ok)
      return setMessage(
        data.error === "ENCRYPTION_NOT_CONFIGURED"
          ? "平台尚未完成個資加密金鑰設定，暫時不能送出。"
          : "資料送出失敗，請檢查格式或聯絡客服。",
      );
    setStatus(data.registration.status);
    setReason("");
    setMessage("積分資料已加密送出，待管理員驗證。");
  }
  return (
    <div className="panel p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#FFF0D5] text-[#B45309]">
          <ShieldCheck className="size-6" />
        </span>
        <div>
          <h2 className="text-xl font-black text-[#302318]">正式積分資料</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            僅用於積分資格核對與送審；身分資料會加密保存，客服畫面只顯示遮罩。
          </p>
        </div>
      </div>
      {status && (
        <div
          className={`mt-6 rounded-xl p-4 text-sm font-bold ${status === "verified" ? "bg-emerald-50 text-emerald-800" : status === "needs_correction" ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-900"}`}
        >
          <p>
            目前狀態：
            {status === "verified"
              ? "已驗證"
              : status === "needs_correction"
                ? "需要補正"
                : "審核中"}
          </p>
          {reason && <p className="mt-2">補正原因：{reason}</p>}
        </div>
      )}
      {status !== "verified" && (
        <form action={submit} className="mt-7 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="真實姓名">
              <input className="field" name="fullName" required />
            </Field>
            <Field label="身分證／居留證號">
              <input
                className="field uppercase"
                name="nationalId"
                autoComplete="off"
                required
              />
            </Field>
            <Field label="長照人員認證字號">
              <input
                className="field"
                name="longTermCareNumber"
                autoComplete="off"
                required
              />
            </Field>
            <Field label="聯絡電話">
              <input className="field" name="phone" inputMode="tel" required />
            </Field>
            <Field label="服務單位">
              <input className="field" name="organization" required />
            </Field>
            <Field label="人員類別">
              <select className="field" name="personnelCategory" required>
                <option value="">請選擇</option>
                <option>照顧服務人員</option>
                <option>護理人員</option>
                <option>社會工作人員</option>
                <option>長照相關專業人員</option>
                <option>其他長照人員</option>
              </select>
            </Field>
          </div>
          <label className="flex items-start gap-3 rounded-xl bg-[#FFF8ED] p-4 text-sm font-bold leading-6 text-[#694115]">
            <input className="mt-1" type="checkbox" name="consent" required />
            我確認資料正確，並同意歲悅學苑於課程核定、積分送審及主管機關查核所需範圍內處理。
          </label>
          <button
            disabled={!enabled || busy}
            className="button-primary button-large"
          >
            {busy ? (
              <LoaderCircle className="size-5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-5" />
            )}
            {status ? "重新送出補正資料" : "加密送出積分資料"}
          </button>
        </form>
      )}
      {message && (
        <p
          role="status"
          className="mt-5 rounded-xl bg-[#FFF8ED] p-4 text-sm font-bold text-[#694115]"
        >
          {message}
        </p>
      )}
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm font-black text-[#57483A]">
      <span>{label}</span>
      {children}
    </label>
  );
}
