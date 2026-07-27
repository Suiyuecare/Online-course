"use client";

import { useState } from "react";
import type { PlatformPrerequisiteOptions } from "@/application/workspace";
import { presentErrorCode } from "@/domain/presentation";

async function submit(body: unknown) {
  const response = await fetch("/api/staff/setup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error ?? "REQUEST_REJECTED");
  return result?.data;
}

function iso(value: FormDataEntryValue | null) {
  return new Date(String(value)).toISOString();
}

export function PlatformSetupPanel({
  options,
}: {
  options: PlatformPrerequisiteOptions;
}) {
  const [message, setMessage] = useState("");

  function run(body: unknown) {
    setMessage("保存中…");
    void submit(body)
      .then(() => {
        setMessage("草稿已保存並留下稽核紀錄。請重新整理查看最新選項。");
      })
      .catch((error: Error) =>
        setMessage(
          presentErrorCode(
            error.message,
            "未保存；角色、資料或前置條件不符合。",
          ),
        ),
      );
  }

  return (
    <div className="organization-tools">
      <div className="warning-panel">
        <strong>建立資料不等於核准</strong>
        <p>
          法律文件、積分核定與 Zoom
          主持資源在此只建立草稿。正式核准仍須由具權限的不同人員完成審核，不能在建立時勾選通過。
        </p>
      </div>
      <form
        className="single-step-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          run({
            kind: "organizing_body",
            legalName: form.get("legalName"),
            qualificationReference: form.get("qualificationReference"),
            qualificationValidFrom: form.get("qualificationValidFrom"),
            qualificationValidUntil:
              String(form.get("qualificationValidUntil") ?? "") || null,
            contactName: form.get("contactName"),
            contactEmail: form.get("contactEmail"),
            reason: form.get("reason"),
          });
        }}
      >
        <h2>主辦單位資格草稿</h2>
        <label>
          正式名稱
          <input name="legalName" required />
        </label>
        <label>
          資格依據／字號
          <input name="qualificationReference" required />
        </label>
        <label>
          資格起日
          <input name="qualificationValidFrom" type="date" required />
        </label>
        <label>
          資格迄日（選填）
          <input name="qualificationValidUntil" type="date" />
        </label>
        <label>
          聯絡人
          <input name="contactName" required />
        </label>
        <label>
          聯絡 Email
          <input name="contactEmail" type="email" required />
        </label>
        <label>
          建立理由
          <textarea name="reason" minLength={10} required />
        </label>
        <button className="button" type="submit">
          建立主辦單位草稿
        </button>
      </form>
      <form
        className="single-step-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          run({
            kind: "accreditation_authority",
            name: form.get("name"),
            submissionMethod: form.get("submissionMethod"),
            contactName: form.get("contactName"),
            contactEmail: form.get("contactEmail"),
            reason: form.get("reason"),
          });
        }}
      >
        <h2>認可／主管機關資料</h2>
        <label>
          機關名稱
          <input name="name" required />
        </label>
        <label>
          送審方式
          <textarea name="submissionMethod" required />
        </label>
        <label>
          聯絡人
          <input name="contactName" required />
        </label>
        <label>
          聯絡 Email
          <input name="contactEmail" type="email" required />
        </label>
        <label>
          建立理由
          <textarea name="reason" minLength={10} required />
        </label>
        <button className="button" type="submit">
          建立機關資料草稿
        </button>
      </form>
      <form
        className="single-step-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          run({
            kind: "retention_policy_revision",
            policyName: form.get("policyName"),
            purpose: form.get("purpose"),
            legalBasis: form.get("legalBasis"),
            retentionDays: Number(form.get("retentionDays")),
            effectiveAt: iso(form.get("effectiveAt")),
            reason: form.get("reason"),
          });
        }}
      >
        <h2>資料保存政策 revision</h2>
        <label>
          政策名稱
          <input name="policyName" required />
        </label>
        <label>
          保存目的
          <textarea name="purpose" minLength={10} required />
        </label>
        <label>
          法律依據
          <textarea name="legalBasis" minLength={5} required />
        </label>
        <label>
          保存天數
          <input
            name="retentionDays"
            type="number"
            min={1}
            max={36500}
            required
          />
        </label>
        <label>
          預定生效時間
          <input name="effectiveAt" type="datetime-local" required />
        </label>
        <label>
          建立理由
          <textarea name="reason" minLength={10} required />
        </label>
        <button className="button" type="submit">
          建立保存政策草稿
        </button>
      </form>
      <form
        className="single-step-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          run({
            kind: "legal_document_revision",
            documentKind: form.get("documentKind"),
            title: form.get("title"),
            content: form.get("content"),
            effectiveAt: iso(form.get("effectiveAt")),
            reason: form.get("reason"),
          });
        }}
      >
        <h2>法律文件 revision 草稿</h2>
        <label>
          文件類型
          <select name="documentKind">
            <option value="b2c_terms">個人購課條款</option>
            <option value="b2b_terms">機構契約</option>
            <option value="privacy">隱私權政策</option>
            <option value="accreditation_disclosure">積分揭露</option>
          </select>
        </label>
        <label>
          標題
          <input name="title" required />
        </label>
        <label>
          完整內容
          <textarea name="content" minLength={100} required />
        </label>
        <label>
          預定生效時間
          <input name="effectiveAt" type="datetime-local" required />
        </label>
        <label>
          建立理由
          <textarea name="reason" minLength={10} required />
        </label>
        <button className="button" type="submit">
          建立未核准法律草稿
        </button>
      </form>
      <form
        className="single-step-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          run({
            kind: "zoom_host_resource",
            hostUserReference: form.get("hostUserReference"),
            backupHostReference:
              String(form.get("backupHostReference") ?? "") || null,
            verifiedTotalCapacity: Number(form.get("verifiedTotalCapacity")),
            concurrencySlot: Number(form.get("concurrencySlot")),
            licenseVerifiedAt: iso(form.get("licenseVerifiedAt")),
            reason: form.get("reason"),
          });
        }}
      >
        <h2>Zoom 主持授權資源草稿</h2>
        <label>
          主持帳號參照
          <input name="hostUserReference" required />
        </label>
        <label>
          備援主持參照（選填）
          <input name="backupHostReference" />
        </label>
        <label>
          已驗證授權總容量
          <input
            name="verifiedTotalCapacity"
            type="number"
            min={1}
            max={200}
            required
          />
        </label>
        <label>
          並行時段數
          <input
            name="concurrencySlot"
            type="number"
            min={1}
            max={20}
            defaultValue={1}
            required
          />
        </label>
        <label>
          授權查核時間
          <input name="licenseVerifiedAt" type="datetime-local" required />
        </label>
        <label>
          查核依據
          <textarea name="reason" minLength={10} required />
        </label>
        <button className="button" type="submit">
          建立未啟用主持資源
        </button>
      </form>
      <form
        className="single-step-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          run({
            kind: "accreditation_revision",
            courseId: form.get("courseId"),
            organizingBodyId: form.get("organizingBodyId"),
            authorityId: form.get("authorityId"),
            applicationReference: form.get("applicationReference"),
            sourceDocumentPath: form.get("sourceDocumentPath"),
            sourceDocumentSha256: form.get("sourceDocumentSha256"),
            validFrom: iso(form.get("validFrom")),
            validUntil: iso(form.get("validUntil")),
            reason: form.get("reason"),
          });
        }}
      >
        <h2>課程積分申請 revision 草稿</h2>
        <label>
          課程
          <select name="courseId" required defaultValue="">
            <option value="" disabled>
              請選擇課程
            </option>
            {options.courses.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          主辦單位
          <select name="organizingBodyId" required defaultValue="">
            <option value="" disabled>
              請選擇
            </option>
            {options.organizingBodies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          認可單位
          <select name="authorityId" required defaultValue="">
            <option value="" disabled>
              請選擇
            </option>
            {options.authorities.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          申請字號
          <input name="applicationReference" required />
        </label>
        <label>
          來源文件私有路徑
          <input name="sourceDocumentPath" required />
        </label>
        <label>
          來源文件 SHA-256
          <input name="sourceDocumentSha256" pattern="[a-f0-9]{64}" required />
        </label>
        <label>
          申請／核定適用起始
          <input name="validFrom" type="datetime-local" required />
        </label>
        <label>
          申請／核定適用截止
          <input name="validUntil" type="datetime-local" required />
        </label>
        <label>
          建立理由
          <textarea name="reason" minLength={10} required />
        </label>
        <button className="button" type="submit">
          建立 draft／applying 前資料
        </button>
      </form>
      <form
        className="single-step-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          run({
            kind: "operating_setting",
            settingKey: form.get("settingKey"),
            enabled: form.get("enabled") === "true",
            effectiveAt: iso(form.get("effectiveAt")),
            reason: form.get("reason"),
          });
        }}
      >
        <h2>功能開關 revision</h2>
        <label>
          功能
          <select name="settingKey">
            <option value="commerce_b2c">個人購課</option>
            <option value="commerce_b2b">機構購點</option>
            <option value="recorded_learning">錄播</option>
            <option value="live_learning">直播</option>
            <option value="hybrid_learning">混合課</option>
            <option value="certificate_issuance">發證</option>
            <option value="accreditation_exports">積分匯出</option>
          </select>
        </label>
        <label>
          狀態
          <select name="enabled" defaultValue="false">
            <option value="false">保持關閉</option>
            <option value="true">申請開啟（仍需伺服器門檻）</option>
          </select>
        </label>
        <label>
          生效時間
          <input name="effectiveAt" type="datetime-local" required />
        </label>
        <label>
          變更理由
          <textarea name="reason" minLength={10} required />
        </label>
        <button className="button" type="submit">
          建立設定 revision
        </button>
      </form>
      <p className="flow-message" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
