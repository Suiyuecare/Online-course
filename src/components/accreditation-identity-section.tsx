"use client";

import { useState } from "react";
import { AccreditationIdentityForm } from "@/components/accreditation-identity-form";
import { presentErrorCode } from "@/domain/presentation";

type Identity = {
  status: string;
  maskedName: string | null;
  maskedNationalId: string | null;
  maskedCareWorkerId: string | null;
  reconfirmedAt: string | null;
} | null;

export function AccreditationIdentitySection({
  enrollmentId,
  identity,
}: {
  enrollmentId: string;
  identity: Identity;
}) {
  const [reconfirmedAt, setReconfirmedAt] = useState(identity?.reconfirmedAt);
  const [message, setMessage] = useState("");

  if (!identity || !["verified", "reused"].includes(identity.status)) {
    return <AccreditationIdentityForm enrollmentId={enrollmentId} />;
  }

  return (
    <section className="single-step-form">
      <h2>確認本次積分身分</h2>
      <p>
        系統找到先前已審核的加密資料。為保護個資，只顯示遮罩內容；每一門課仍要由你再次確認。
      </p>
      <dl className="compact-data-list">
        <div>
          <dt>姓名</dt>
          <dd>{identity.maskedName ?? "已保存（遮罩不可用）"}</dd>
        </div>
        <div>
          <dt>身分證／居留證</dt>
          <dd>{identity.maskedNationalId ?? "已保存（遮罩不可用）"}</dd>
        </div>
        <div>
          <dt>長照認證字號</dt>
          <dd>{identity.maskedCareWorkerId ?? "已保存（遮罩不可用）"}</dd>
        </div>
      </dl>
      {reconfirmedAt ? (
        <p className="success-note">
          已於 {new Date(reconfirmedAt).toLocaleString("zh-TW")}{" "}
          確認用於本課程。
        </p>
      ) : (
        <button
          className="button"
          onClick={() => {
            setMessage("");
            void fetch("/api/profile/accreditation/reconfirm", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "idempotency-key": crypto.randomUUID(),
              },
              body: JSON.stringify({ enrollmentId }),
            })
              .then(async (response) => {
                const result = await response.json().catch(() => null);
                if (!response.ok) {
                  throw new Error(result?.error ?? "RECONFIRM_REJECTED");
                }
                setReconfirmedAt(result.data.reconfirmedAt);
                setMessage("本次課程身分確認已保存。");
              })
              .catch((error: Error) =>
                setMessage(
                  presentErrorCode(
                    error.message,
                    "目前無法確認；沒有變更原本的加密資料。",
                  ),
                ),
              );
          }}
          type="button"
        >
          我確認遮罩資料屬於本人並用於本課程
        </button>
      )}
      <p aria-live="polite">{message}</p>
    </section>
  );
}
