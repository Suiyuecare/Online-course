"use client";

import { useState } from "react";
import type { OrganizationWorkspaceDetails } from "@/application/workspace";
import { presentErrorCode } from "@/domain/presentation";

async function post(path: string, body: unknown) {
  const response = await fetch(path, {
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

const roleLabels: Record<string, string> = {
  owner: "機構負責人",
  training_manager: "培訓管理員",
  finance: "財務",
  member: "員工",
};

const blockLabels: Record<string, string> = {
  active_or_unsettled_assignment: "仍有進行中或尚未結清的課程指派",
  active_live_booking: "仍有尚未結束或釋放的直播預約",
  last_active_owner: "機構至少必須保留一位有效負責人",
};

export function OrganizationManagementPanel({
  organizationId,
  details,
}: {
  organizationId: string;
  details: OrganizationWorkspaceDetails;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function run(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("處理中…");
    void operation()
      .then(() => {
        setMessage(success);
        window.location.reload();
      })
      .catch((error: Error) =>
        setMessage(
          presentErrorCode(
            error.message,
            "異動未完成；請確認權限、至少保留一位負責人，並先結清課程指派與直播預約。",
          ),
        ),
      )
      .finally(() => setBusy(false));
  }

  return (
    <div className="organization-tools">
      {details.capabilities.canEditProfile && (
        <form
          className="single-step-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            run(
              () =>
                post(`/api/organizations/${organizationId}/profile`, {
                  contactName: form.get("contactName"),
                  contactEmail: form.get("contactEmail"),
                  invoiceEmail: form.get("invoiceEmail"),
                  invoiceRecipient: form.get("invoiceRecipient"),
                  invoiceAddress: form.get("invoiceAddress"),
                }),
              "機構聯絡與發票資料已更新。",
            );
          }}
        >
          <h2>機構聯絡與發票資料</h2>
          <p>統編、審核狀態、點數與銀行資料不在此表單中，無法由前台變更。</p>
          <label>
            聯絡人
            <input
              defaultValue={details.organizationProfile.contactName}
              maxLength={100}
              name="contactName"
            />
          </label>
          <label>
            聯絡 Email
            <input
              defaultValue={details.organizationProfile.contactEmail}
              maxLength={320}
              name="contactEmail"
              type="email"
            />
          </label>
          <label>
            發票收件 Email
            <input
              defaultValue={details.organizationProfile.invoiceEmail ?? ""}
              maxLength={320}
              name="invoiceEmail"
              required
              type="email"
            />
          </label>
          <label>
            發票抬頭／收件人
            <input
              defaultValue={details.organizationProfile.invoiceRecipient ?? ""}
              maxLength={200}
              name="invoiceRecipient"
            />
          </label>
          <label>
            發票地址
            <textarea
              defaultValue={details.organizationProfile.invoiceAddress ?? ""}
              maxLength={500}
              name="invoiceAddress"
            />
          </label>
          <button className="button" disabled={busy} type="submit">
            儲存機構資料
          </button>
        </form>
      )}

      {details.capabilities.canManageMembers && (
        <section className="single-step-form">
          <h2>成員角色與離職</h2>
          <p>
            離職前必須先結清進行中的指派與直播預約。離職當下會保存機構出資成果快照，之後不再顯示該人新的個人學習活動。
          </p>
          <div className="record-list">
            {details.members.map((member) => (
              <form
                key={member.personId}
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  run(
                    () =>
                      post(
                        `/api/organizations/${organizationId}/members/${member.personId}`,
                        {
                          role: form.get("role"),
                          active: form.get("active") === "true",
                          employeeNumber: form.get("employeeNumber"),
                          department: form.get("department"),
                          reason: form.get("reason"),
                        },
                      ),
                    "成員資料已更新。",
                  );
                }}
              >
                <strong>{member.displayName}</strong>
                <span>
                  {roleLabels[member.role] ?? "成員"}・
                  {member.status === "active" ? "有效" : "已離職"}
                </span>
                {member.canManage ? (
                  <>
                    <label>
                      角色
                      <select
                        defaultValue={member.role}
                        disabled={!member.canChangeRole}
                        name="role"
                      >
                        {Object.entries(roleLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!member.canChangeRole && (
                      <input name="role" type="hidden" value={member.role} />
                    )}
                    <label>
                      員工編號
                      <input
                        defaultValue={member.employeeNumber ?? ""}
                        maxLength={100}
                        name="employeeNumber"
                      />
                    </label>
                    <label>
                      部門
                      <input
                        defaultValue={member.department ?? ""}
                        maxLength={100}
                        name="department"
                      />
                    </label>
                    <label>
                      狀態
                      <select
                        defaultValue={String(member.status === "active")}
                        name="active"
                      >
                        <option value="true">有效</option>
                        <option
                          disabled={
                            member.status === "active" && !member.canDeactivate
                          }
                          value="false"
                        >
                          已離職
                        </option>
                      </select>
                    </label>
                    {member.offboardingBlock && (
                      <p className="closed-note">
                        暫時不能離職：
                        {blockLabels[member.offboardingBlock] ??
                          "請先完成相關營運作業"}
                      </p>
                    )}
                    <label>
                      異動原因
                      <textarea
                        maxLength={2000}
                        minLength={10}
                        name="reason"
                        required
                      />
                    </label>
                    <button
                      className="button secondary"
                      disabled={busy}
                      type="submit"
                    >
                      儲存成員異動
                    </button>
                  </>
                ) : (
                  <p className="closed-note">
                    你的角色不能管理此成員。培訓管理員不能異動負責人、財務或其他管理員。
                  </p>
                )}
              </form>
            ))}
          </div>
        </section>
      )}
      {message && <p aria-live="polite">{message}</p>}
    </div>
  );
}
