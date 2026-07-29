"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CouponAdminWorkspace } from "@/application/workspace";

const dateTime = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "medium",
  timeStyle: "short",
});

function benefitLabel(campaign: CouponAdminWorkspace["campaigns"][number]) {
  if (campaign.benefitKind === "fixed_twd") {
    return `折抵 NT$ ${(campaign.fixedDiscountTwd ?? 0).toLocaleString("zh-TW")}`;
  }
  const off = (campaign.percentOffBps ?? 0) / 100;
  return `折扣 ${off}%${campaign.maxDiscountTwd ? `，最高 NT$ ${campaign.maxDiscountTwd.toLocaleString("zh-TW")}` : ""}`;
}

function CampaignActionPanel({
  campaign,
}: {
  campaign: CouponAdminWorkspace["campaigns"][number];
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function act(action: "approve" | "pause" | "resume" | "end") {
    if (busy || reason.trim().length < 10) {
      setMessage("請先填寫至少 10 個字的操作原因。");
      return;
    }
    if (
      action === "end" &&
      !window.confirm("永久結束後不能恢復，確定要結束這個折扣券活動嗎？")
    ) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/staff/coupons/campaigns/${campaign.campaignId}/actions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({ action, reason }),
        },
      );
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "ACTION_REJECTED");
      setReason("");
      setMessage("狀態已更新。");
      router.refresh();
    } catch (error) {
      const code = error instanceof Error ? error.message : "ACTION_REJECTED";
      setMessage(
        code.includes("APPROVAL_REJECTED")
          ? "建立者不能自行核准，需由另一位具財務權限的人員完成。"
          : "操作未完成，請確認 AAL2 權限、狀態與有效期限。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="coupon-admin-actions">
      <label>
        操作原因
        <input
          maxLength={500}
          minLength={10}
          onChange={(event) => setReason(event.target.value)}
          placeholder="至少 10 個字，會寫入稽核紀錄"
          value={reason}
        />
      </label>
      <div>
        {campaign.status === "draft" && (
          <button
            disabled={busy}
            onClick={() => void act("approve")}
            type="button"
          >
            第二人核准啟用
          </button>
        )}
        {campaign.status === "active" && (
          <button
            disabled={busy}
            onClick={() => void act("pause")}
            type="button"
          >
            暫停領取與使用
          </button>
        )}
        {campaign.status === "paused" && (
          <button
            disabled={busy}
            onClick={() => void act("resume")}
            type="button"
          >
            恢復活動
          </button>
        )}
        {campaign.status !== "ended" && (
          <button
            className="danger"
            disabled={busy}
            onClick={() => void act("end")}
            type="button"
          >
            永久結束
          </button>
        )}
      </div>
      <p aria-live="polite">{message}</p>
    </div>
  );
}

export function CouponAdminCenter({
  workspace,
}: {
  workspace: CouponAdminWorkspace;
}) {
  const router = useRouter();
  const [benefitKind, setBenefitKind] = useState<"percent_off" | "fixed_twd">(
    "percent_off",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);

  async function createCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formElement = event.currentTarget;
    setBusy(true);
    setMessage("");
    setGeneratedCode(null);
    const form = new FormData(formElement);
    const percentOff = Number(form.get("percentOff") || 0);
    const fixedDiscount = Number(form.get("fixedDiscount") || 0);
    const maxDiscount = Number(form.get("maxDiscount") || 0);
    const selectedCourses = form
      .getAll("courseVersionIds")
      .map(String)
      .filter(Boolean);
    const validFrom = new Date(String(form.get("validFrom")));
    const validUntil = new Date(String(form.get("validUntil")));
    try {
      const response = await fetch("/api/staff/coupons/campaigns", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          title: String(form.get("title") ?? ""),
          description: String(form.get("description") ?? ""),
          code: String(form.get("code") ?? ""),
          benefitKind,
          percentOffBps:
            benefitKind === "percent_off" ? Math.round(percentOff * 100) : null,
          fixedDiscountTwd: benefitKind === "fixed_twd" ? fixedDiscount : null,
          maxDiscountTwd:
            benefitKind === "percent_off" && maxDiscount > 0
              ? maxDiscount
              : null,
          minimumSubtotalTwd: Number(form.get("minimumSubtotal") || 0),
          validFrom: validFrom.toISOString(),
          validUntil: validUntil.toISOString(),
          totalClaimLimit: Number(form.get("claimLimit")),
          totalRedemptionLimit: Number(form.get("redemptionLimit")),
          courseVersionIds: selectedCourses,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "CREATE_REJECTED");
      setGeneratedCode(result.data.couponCode);
      setMessage(
        "草稿已建立。請立即保存下方完整代碼，再由另一位財務權限人員核准。",
      );
      formElement.reset();
      setBenefitKind("percent_off");
      router.refresh();
    } catch {
      setMessage("活動未建立，請檢查代碼是否重複、日期、折扣與數量限制。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="coupon-admin-center">
      <section className="coupon-admin-create">
        <p className="eyebrow">新增活動</p>
        <h2>建立折扣券草稿</h2>
        <p>
          完整折扣碼只在建立成功時顯示一次。經濟條件建立後不可修改，需由另一位具財務權限的人員核准。
        </p>
        <form onSubmit={createCampaign}>
          <label>
            活動名稱
            <input maxLength={120} minLength={2} name="title" required />
          </label>
          <label>
            學員說明
            <textarea
              maxLength={500}
              minLength={2}
              name="description"
              required
            />
          </label>
          <label>
            折扣碼
            <input
              autoCapitalize="characters"
              maxLength={32}
              minLength={4}
              name="code"
              pattern="[A-Za-z0-9-]+"
              required
            />
          </label>
          <label>
            折扣方式
            <select
              onChange={(event) =>
                setBenefitKind(
                  event.target.value as "percent_off" | "fixed_twd",
                )
              }
              value={benefitKind}
            >
              <option value="percent_off">百分比折扣</option>
              <option value="fixed_twd">固定金額折抵</option>
            </select>
          </label>
          {benefitKind === "percent_off" ? (
            <>
              <label>
                折扣百分比（15 代表 85 折）
                <input
                  max={99}
                  min={1}
                  name="percentOff"
                  required
                  type="number"
                />
              </label>
              <label>
                最高折抵金額（選填）
                <input min={1} name="maxDiscount" type="number" />
              </label>
            </>
          ) : (
            <label>
              固定折抵金額
              <input min={1} name="fixedDiscount" required type="number" />
            </label>
          )}
          <label>
            最低課程金額
            <input
              defaultValue={0}
              min={0}
              name="minimumSubtotal"
              required
              type="number"
            />
          </label>
          <label>
            開始時間
            <input name="validFrom" required type="datetime-local" />
          </label>
          <label>
            結束時間
            <input name="validUntil" required type="datetime-local" />
          </label>
          <label>
            最多領取張數
            <input min={1} name="claimLimit" required type="number" />
          </label>
          <label>
            最多核銷張數
            <input min={1} name="redemptionLimit" required type="number" />
          </label>
          <fieldset>
            <legend>適用課程</legend>
            <p>不勾選代表所有個人課程；折扣券不適用機構點數。</p>
            {workspace.courseOptions.length === 0 ? (
              <small>目前沒有可選的已發布課程。</small>
            ) : (
              workspace.courseOptions.map((course) => (
                <label key={course.courseVersionId}>
                  <input
                    name="courseVersionIds"
                    type="checkbox"
                    value={course.courseVersionId}
                  />
                  {course.title}
                </label>
              ))
            )}
          </fieldset>
          <button className="button" disabled={busy} type="submit">
            {busy ? "建立中…" : "建立草稿"}
          </button>
        </form>
        {generatedCode && (
          <div className="coupon-admin-generated" role="status">
            <strong>請立即保存完整折扣碼</strong>
            <code>{generatedCode}</code>
            <small>重新整理後只會看到遮罩提示，資料庫不保存明碼。</small>
          </div>
        )}
        <p aria-live="polite">{message}</p>
      </section>

      <section className="coupon-admin-list">
        <p className="eyebrow">活動管理</p>
        <h2>折扣券活動</h2>
        {workspace.campaigns.length === 0 ? (
          <p>目前尚未建立折扣券活動。</p>
        ) : (
          workspace.campaigns.map((campaign) => (
            <article key={campaign.campaignId}>
              <header>
                <div>
                  <span className={`status status-${campaign.status}`}>
                    {campaign.status === "draft"
                      ? "待第二人核准"
                      : campaign.status === "active"
                        ? "進行中"
                        : campaign.status === "paused"
                          ? "已暫停"
                          : "已結束"}
                  </span>
                  <h3>{campaign.title}</h3>
                  <p>{campaign.description}</p>
                </div>
                <strong>{benefitLabel(campaign)}</strong>
              </header>
              <dl>
                <div>
                  <dt>代碼提示</dt>
                  <dd>{campaign.codeHint}</dd>
                </div>
                <div>
                  <dt>活動期間</dt>
                  <dd>
                    {dateTime.format(new Date(campaign.validFrom))}－
                    {dateTime.format(new Date(campaign.validUntil))}
                  </dd>
                </div>
                <div>
                  <dt>領取／上限</dt>
                  <dd>
                    {campaign.claimCount}／{campaign.totalClaimLimit}
                  </dd>
                </div>
                <div>
                  <dt>保留／已核銷</dt>
                  <dd>
                    {campaign.reservedCount}／{campaign.redeemedCount}
                  </dd>
                </div>
                <div>
                  <dt>適用課程</dt>
                  <dd>
                    {campaign.scopeType === "all_b2c"
                      ? "所有個人課程"
                      : campaign.courses
                          .map((course) => course.title)
                          .join("、") || "尚未指定課程"}
                  </dd>
                </div>
              </dl>
              <CampaignActionPanel campaign={campaign} />
            </article>
          ))
        )}
      </section>
    </div>
  );
}
