"use client";

import { useState } from "react";
import { Building2, LoaderCircle, ShieldCheck } from "lucide-react";

export function EnterpriseApplicationForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/enterprise/organization", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          taxId: formData.get("taxId"),
          contactName: formData.get("contactName"),
          contactPhone: formData.get("contactPhone"),
          invoiceEmail: formData.get("invoiceEmail"),
        }),
      });
      const result = (await response.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null;
      if (!response.ok) {
        setMessage(
          result?.error === "TAX_ID_ALREADY_EXISTS"
            ? "此統編已有機構，請由現有管理者邀請您，或聯絡歲悅客服確認。"
            : result?.message || "申請送出失敗，請檢查資料後重試。",
        );
        return;
      }
      setSubmitted(true);
    } catch {
      setMessage("網路連線失敗，請稍後再送出申請。");
    } finally {
      setBusy(false);
    }
  }

  if (submitted)
    return (
      <div className="panel mx-auto max-w-2xl p-8 text-center sm:p-10">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-100 text-emerald-700">
          <ShieldCheck className="size-8" />
        </span>
        <h1 className="mt-5 text-2xl font-black text-[#302318]">
          機構申請已送出
        </h1>
        <p className="mt-3 leading-7 text-slate-500">
          歲悅管理員完成首次審核後會寄送 Email。通過前不會開放購買、邀請或查看報表。
        </p>
        <button
          type="button"
          className="button-secondary mt-6"
          onClick={() => window.location.reload()}
        >
          更新審核狀態
        </button>
      </div>
    );

  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <section className="rounded-3xl bg-[#A84F05] p-7 text-white sm:p-9">
        <span className="grid size-13 place-items-center rounded-2xl bg-white/15">
          <Building2 />
        </span>
        <p className="mt-7 text-xs font-black tracking-[0.14em] text-orange-100">
          ORGANIZATION APPLICATION
        </p>
        <h1 className="mt-3 text-3xl font-black">申請機構培訓帳號</h1>
        <p className="mt-4 leading-8 text-orange-50">
          首次由歲悅審核機構與統編。通過後，機構管理者可自行購買名額、邀請員工、指派課程與下載報表。
        </p>
        <ul className="mt-7 grid gap-3 text-sm font-bold text-orange-50">
          <li>• 學員沿用原本歲悅 Email 驗證碼帳號</li>
          <li>• 同一統編只建立一個機構</li>
          <li>• 身分證與長照資料不會提供給機構</li>
        </ul>
      </section>
      <section className="panel p-6 sm:p-8">
        <h2 className="text-xl font-black text-[#302318]">機構基本資料</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          請填寫與電子發票一致的資料。統編送出後需由客服協助修改。
        </p>
        <form action={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field label="機構名稱">
            <input
              className="field"
              name="name"
              minLength={2}
              maxLength={120}
              required
            />
          </Field>
          <Field label="統一編號">
            <input
              className="field"
              name="taxId"
              inputMode="numeric"
              pattern="[0-9]{8}"
              maxLength={8}
              required
            />
          </Field>
          <Field label="聯絡人">
            <input
              className="field"
              name="contactName"
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
              maxLength={120}
              required
            />
          </Field>
          <button className="button-primary self-end" disabled={busy}>
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            送出首次審核
          </button>
          {message && (
            <p
              className="rounded-xl bg-rose-50 p-4 text-sm font-bold leading-6 text-rose-800 sm:col-span-2"
              role="alert"
            >
              {message}
            </p>
          )}
        </form>
      </section>
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
    <label className="grid gap-2 text-sm font-black text-[#493625]">
      <span>{label}</span>
      {children}
    </label>
  );
}
