"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CheckoutCouponOption } from "@/application/workspace";
import {
  anonymousLearnerCartStorageKey,
  learnerCartCacheStorageKey,
  legacyLearnerPortalStorageKey,
  notifyLearnerCartChanged,
  parseLearnerCartStorage,
  serializeLearnerCartStorage,
} from "@/domain/learner-cart";
import type { CatalogCourse } from "@/infrastructure/supabase/catalog";

type Acceptance = {
  acceptanceId: string;
  firstPresentedAt: string;
  confirmAvailableAt: string;
  secondConfirmedAt: string | null;
};

async function deviceHash() {
  const material = [
    navigator.userAgent,
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    `${screen.width}x${screen.height}`,
  ].join("|");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(material),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function removeOrderedCourseFromLocalCart(
  accountId: string | null,
  courseVersionId: string,
) {
  try {
    const keys = [
      anonymousLearnerCartStorageKey,
      ...(accountId
        ? [
            learnerCartCacheStorageKey(accountId),
            legacyLearnerPortalStorageKey(accountId),
          ]
        : []),
    ];
    for (const key of keys) {
      const current = parseLearnerCartStorage(window.localStorage.getItem(key));
      const next = current.filter(
        (item) => item.courseVersionId !== courseVersionId,
      );
      if (next.length === current.length) continue;
      if (next.length > 0) {
        window.localStorage.setItem(key, serializeLearnerCartStorage(next));
      } else {
        window.localStorage.removeItem(key);
      }
    }
    notifyLearnerCartChanged();
  } catch {
    // The order is already authoritative. Browser preference cleanup must
    // never hide or roll back a successfully created payment instruction.
  }
}

export function ContractPurchaseFlow({
  accountId,
  coupons,
  course,
}: {
  accountId: string | null;
  coupons: CheckoutCouponOption[];
  course: CatalogCourse;
}) {
  const [acceptance, setAcceptance] = useState<Acceptance | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [couponClaimId, setCouponClaimId] = useState("");
  useEffect(() => {
    const update = () => setCurrentTime(Date.now());
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const sessionGroups = useMemo(
    () =>
      course.live_sessions.reduce<
        Record<string, CatalogCourse["live_sessions"]>
      >((groups, session) => {
        const group = session.componentId ?? "course";
        (groups[group] ??= []).push(session);
        return groups;
      }, {}),
    [course.live_sessions],
  );
  const selectedCoupon = coupons.find(
    (coupon) => coupon.claimId === couponClaimId,
  );

  async function legalPhase(phase: "present" | "confirm") {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const body =
        phase === "present"
          ? {
              phase,
              courseVersionId: course.course_version_id,
              deviceHash: await deviceHash(),
            }
          : {
              phase,
              acceptanceId: acceptance?.acceptanceId,
              deviceHash: await deviceHash(),
            };
      const response = await fetch("/api/legal/acceptances", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "x-suiyue-account-id": accountId ?? "",
        },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(
          response.status === 401
            ? "請先用手機驗證碼登入，再開始契約審閱。"
            : result?.error === "LEARNER_ACCOUNT_VERSION_CONFLICT"
              ? "登入帳號已變更，請重新整理頁面後再繼續。"
              : result?.error === "CONTRACT_REVIEW_PERIOD_ACTIVE"
                ? "72 小時審閱期尚未結束，請於可確認時間後再回來。"
                : "目前無法保存契約審閱紀錄，收費流程保持關閉。",
        );
        return;
      }
      setAcceptance((current) => ({ ...current, ...result.data }));
      setMessage(
        phase === "present"
          ? "第一次呈現已保存。請保留契約，72 小時後回來做第二次確認。"
          : "第二次確認已保存，現在可以建立人工匯款訂單。",
      );
    } catch {
      setMessage("目前無法連線並保存契約紀錄，收費流程保持關閉。");
    } finally {
      setBusy(false);
    }
  }

  async function createOrder() {
    if (busy || !acceptance?.secondConfirmedAt) return;
    const groups = Object.keys(sessionGroups);
    if (
      course.delivery_type !== "recorded" &&
      groups.some((group) => !selections[group])
    ) {
      setMessage("請先為每個同步直播單元選擇一個場次。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          "x-suiyue-account-id": accountId ?? "",
        },
        body: JSON.stringify({
          courseVersionId: course.course_version_id,
          legalAcceptanceId: acceptance.acceptanceId,
          liveSelections: selections,
          couponClaimId: selectedCoupon?.claimId ?? null,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(
          result?.error === "LEARNER_ACCOUNT_VERSION_CONFLICT"
            ? "登入帳號已變更，請重新整理頁面後再建立訂單。"
            : result?.error === "COUPON_NOT_AVAILABLE"
              ? "這張折扣券剛剛已失效、額滿或不再適用，沒有建立原價訂單；請重新選擇。"
              : "目前不能建立訂單；伺服器會重新檢查開關、價格、核定與名額。",
        );
        return;
      }
      if (!result?.data?.orderId) {
        setMessage("訂單回應不完整，系統沒有導向匯款，也不會假設訂單已成立。");
        return;
      }
      removeOrderedCourseFromLocalCart(accountId, course.course_version_id);
      window.location.assign(`/learner/orders/${result.data.orderId}`);
    } catch {
      setMessage("目前無法連線建立訂單，請稍後重試；系統不會改用原價下單。");
    } finally {
      setBusy(false);
    }
  }

  const confirmAvailable =
    acceptance && currentTime >= Date.parse(acceptance.confirmAvailableAt);

  return (
    <div className="contract-flow">
      <section className="step-card">
        <span>步驟 1</span>
        <h2>下載並保留完整契約</h2>
        <p>
          文件雜湊：<code>{course.legal_document_sha256}</code>
        </p>
        <a
          className="button secondary"
          href={`/api/legal/documents/${course.legal_document_id}`}
        >
          下載可列印 PDF
        </a>
      </section>
      <section className="step-card">
        <span>步驟 2</span>
        <h2>開始 72 小時審閱</h2>
        {!acceptance ? (
          <button
            className="button"
            disabled={busy}
            onClick={() => legalPhase("present")}
          >
            我已取得契約，開始審閱
          </button>
        ) : (
          <p>
            第一次呈現：
            {new Date(acceptance.firstPresentedAt).toLocaleString("zh-TW")}
            <br />
            可第二次確認：
            {new Date(acceptance.confirmAvailableAt).toLocaleString("zh-TW")}
          </p>
        )}
      </section>
      <section className="step-card">
        <span>步驟 3</span>
        <h2>第二次確認</h2>
        <button
          className="button"
          disabled={
            busy ||
            !acceptance ||
            !confirmAvailable ||
            Boolean(acceptance.secondConfirmedAt)
          }
          onClick={() => legalPhase("confirm")}
        >
          {acceptance?.secondConfirmedAt ? "已完成第二次確認" : "確認接受契約"}
        </button>
      </section>
      {acceptance?.secondConfirmedAt && (
        <section className="step-card">
          <span>步驟 4</span>
          <h2>選場次並建立訂單</h2>
          {Object.entries(sessionGroups).map(([group, sessions]) => (
            <label key={group}>
              同步直播單元
              <select
                value={selections[group] ?? ""}
                onChange={(event) =>
                  setSelections((current) => ({
                    ...current,
                    [group]: event.target.value,
                  }))
                }
              >
                <option value="">請選擇</option>
                {sessions?.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.title}－
                    {new Date(session.startsAt).toLocaleString("zh-TW")}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            使用折扣券（每筆訂單限一張）
            <select
              onChange={(event) => setCouponClaimId(event.target.value)}
              value={couponClaimId}
            >
              <option value="">不使用折扣券</option>
              {coupons.map((coupon) => (
                <option key={coupon.claimId} value={coupon.claimId}>
                  {coupon.title}－折抵 NT${" "}
                  {coupon.discountTwd.toLocaleString("zh-TW")}
                </option>
              ))}
            </select>
          </label>
          {coupons.length === 0 ? (
            <p className="contract-coupon-note">
              目前沒有適用這門課的折扣券。
              <Link href="/learner/discounts">輸入折扣碼</Link>
            </p>
          ) : null}
          <div className="contract-coupon-summary" aria-live="polite">
            <span>課程原價</span>
            <strong>NT$ {course.price_twd.toLocaleString("zh-TW")}</strong>
            {selectedCoupon ? (
              <>
                <span>折扣券</span>
                <strong>
                  − NT$ {selectedCoupon.discountTwd.toLocaleString("zh-TW")}
                </strong>
              </>
            ) : null}
            <span>應付金額</span>
            <strong>
              NT${" "}
              {(
                selectedCoupon?.amountDueTwd ?? course.price_twd
              ).toLocaleString("zh-TW")}
            </strong>
          </div>
          <button className="button" disabled={busy} onClick={createOrder}>
            建立 NT${" "}
            {(selectedCoupon?.amountDueTwd ?? course.price_twd).toLocaleString(
              "zh-TW",
            )}{" "}
            匯款訂單
          </button>
          <small>
            送出時伺服器會再次確認價格、折扣券與直播名額；失效時不會自動改成原價下單。
          </small>
        </section>
      )}
      <p aria-live="polite" className="flow-message">
        {message}
      </p>
    </div>
  );
}
