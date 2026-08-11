"use client";

import { useEffect, useState } from "react";
import type { OrganizationWorkspaceDetails } from "@/application/workspace";
import {
  OrganizationBatchAssignment,
  type OrganizationAssignmentCourse,
  type OrganizationAssignmentMember,
} from "@/components/organization-batch-assignment";

async function deviceHash() {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      [
        navigator.userAgent,
        navigator.language,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        `${screen.width}x${screen.height}`,
      ].join("|"),
    ),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function post(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "REQUEST_REJECTED");
  return result.data;
}

async function waitForRosterScan(uploadId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(
      `/api/uploads/quarantine?uploadId=${encodeURIComponent(uploadId)}`,
      { cache: "no-store" },
    );
    const result = await response.json();
    if (result.data?.status === "promoted") return;
    if (["rejected", "failed"].includes(result.data?.status)) {
      throw new Error("ROSTER_SCAN_REJECTED");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  throw new Error("ROSTER_SCAN_PENDING");
}

export function OrganizationApplicationForm() {
  const [message, setMessage] = useState("");
  return (
    <form
      className="single-step-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void post("/api/organizations/applications", {
          legalName: form.get("legalName"),
          taxId: form.get("taxId"),
          invoiceEmail: form.get("invoiceEmail"),
        })
          .then(() =>
            setMessage("申請已送出。平台管理員核准前不會開放錢包或員工資料。"),
          )
          .catch((error: Error) =>
            setMessage(
              error.message === "VERIFIED_ORGANIZATION_EMAIL_REQUIRED"
                ? "請先在個人設定完成相同 Email 的驗證。"
                : "目前無法送出；統編若已存在，請聯絡客服加入既有機構。",
            ),
          );
      }}
    >
      <h2>申請機構</h2>
      <label>
        機構正式名稱
        <input name="legalName" required maxLength={200} />
      </label>
      <label>
        統一編號
        <input name="taxId" required inputMode="numeric" pattern="[0-9]{8}" />
      </label>
      <label>
        已驗證的發票 Email
        <input name="invoiceEmail" required type="email" />
      </label>
      <button className="button" type="submit">
        送出審核
      </button>
      <p aria-live="polite">{message}</p>
    </form>
  );
}

export function OrganizationActions({
  organizationId,
  role,
  members,
  courses,
  details,
}: {
  organizationId: string;
  role: string;
  members: OrganizationAssignmentMember[];
  courses: OrganizationAssignmentCourse[];
  details: OrganizationWorkspaceDetails | null;
}) {
  const [message, setMessage] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [liveAssignmentId, setLiveAssignmentId] = useState("");
  const [changeBookingId, setChangeBookingId] = useState("");
  const [acceptance, setAcceptance] = useState<{
    acceptanceId: string;
    confirmAvailableAt: string;
    secondConfirmedAt: string | null;
    documentId: string;
  } | null>(null);
  useEffect(() => {
    const update = () => setCurrentTime(Date.now());
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="organization-tools">
      {["owner", "training_manager"].includes(role) && (
        <>
          <form
            className="single-step-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void post(`/api/organizations/${organizationId}/invitations`, {
                phone: form.get("phone"),
                role: form.get("role"),
                employeeName: form.get("employeeName"),
                employeeNumber: form.get("employeeNumber"),
                department: form.get("department"),
              })
                .then(() =>
                  setMessage(
                    "邀請已進入耐久佇列；電話與一次性 token 只以加密形式保存。",
                  ),
                )
                .catch(() =>
                  setMessage("邀請未建立；請檢查手機、權限與 KMS 狀態。"),
                );
            }}
          >
            <h2>手機邀請員工</h2>
            <label>
              台灣手機
              <input
                name="phone"
                inputMode="tel"
                placeholder="0912345678"
                required
              />
            </label>
            <label>
              權限
              <select name="role" defaultValue="member">
                <option value="member">員工</option>
                {role === "owner" && (
                  <>
                    <option value="training_manager">培訓管理員</option>
                    <option value="finance">財務</option>
                  </>
                )}
              </select>
            </label>
            <label>
              姓名（選填）
              <input name="employeeName" maxLength={100} />
            </label>
            <label>
              員工編號（選填）
              <input name="employeeNumber" maxLength={100} />
            </label>
            <label>
              部門（選填）
              <input name="department" maxLength={100} />
            </label>
            <button className="button secondary" type="submit">
              建立 7 天邀請
            </button>
          </form>
          <form
            className="single-step-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const upload = new FormData();
              upload.set("purpose", "organization_roster");
              upload.set("file", form.get("roster")!);
              void fetch("/api/uploads/quarantine", {
                method: "POST",
                body: upload,
              })
                .then(async (response) => {
                  const result = await response.json();
                  if (!response.ok || !result.data?.uploadId) {
                    throw new Error("UPLOAD_REJECTED");
                  }
                  await waitForRosterScan(result.data.uploadId);
                  return post(
                    `/api/organizations/${organizationId}/invitations/import`,
                    { uploadId: result.data.uploadId },
                  );
                })
                .then((result) =>
                  setMessage(
                    result.imported
                      ? `已原子匯入 ${result.rowCount} 筆邀請。`
                      : `未匯入；錯誤預覽：${result.errors
                          .map(
                            (error: { row: number; message: string }) =>
                              `第 ${error.row} 列 ${error.message}`,
                          )
                          .join("；")}`,
                  ),
                )
                .catch(() =>
                  setMessage("名冊未匯入；檔案、掃描、KMS 或權限未通過。"),
                );
            }}
          >
            <h2>Excel 批次邀請（最多 1,000 筆）</h2>
            <p>
              單一工作表；欄名：手機（必填）、姓名、員工編號、部門、角色。任何一列錯誤都只顯示預覽，不匯入部分資料。
            </p>
            <label>
              XLSX 名冊
              <input
                name="roster"
                type="file"
                accept="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                required
              />
            </label>
            <button className="button secondary" type="submit">
              隔離掃描、預覽並全批匯入
            </button>
          </form>
          <section className="single-step-form">
            <h2>待接受邀請</h2>
            <p>
              可重新寄送原本的一次性邀請，或立即撤銷；兩種操作都會留下稽核紀錄。
            </p>
            <div className="record-list">
              {details?.invitations
                .filter((invitation) =>
                  ["pending", "sent", "expired"].includes(invitation.status),
                )
                .filter(
                  (invitation) =>
                    role === "owner" || invitation.role === "member",
                )
                .map((invitation) => (
                  <article key={invitation.invitationId}>
                    <strong>{invitation.maskedPhone}</strong>
                    <p>
                      {invitation.role === "training_manager"
                        ? "培訓管理員"
                        : invitation.role === "finance"
                          ? "財務"
                          : "員工"}
                      ・有效至{" "}
                      {new Date(invitation.expiresAt).toLocaleString("zh-TW")}
                    </p>
                    <div className="page-actions">
                      <button
                        className="button secondary"
                        onClick={() => {
                          void post(
                            `/api/organizations/${organizationId}/invitations/${invitation.invitationId}`,
                            { operation: "resend" },
                          )
                            .then(() => {
                              setMessage(
                                "邀請已重新排入簡訊佇列，有效期延長 7 天。",
                              );
                              window.location.reload();
                            })
                            .catch(() =>
                              setMessage(
                                "邀請未重寄；請確認邀請狀態、角色與簡訊設定。",
                              ),
                            );
                        }}
                        type="button"
                      >
                        重新寄送
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => {
                          if (!window.confirm("確定撤銷這筆尚未接受的邀請？")) {
                            return;
                          }
                          void post(
                            `/api/organizations/${organizationId}/invitations/${invitation.invitationId}`,
                            { operation: "revoke" },
                          )
                            .then(() => {
                              setMessage("邀請已撤銷，原連結立即失效。");
                              window.location.reload();
                            })
                            .catch(() =>
                              setMessage(
                                "邀請未撤銷；請確認邀請狀態與操作權限。",
                              ),
                            );
                        }}
                        type="button"
                      >
                        撤銷邀請
                      </button>
                    </div>
                  </article>
                ))}
              {!details?.invitations.some(
                (invitation) =>
                  ["pending", "sent", "expired"].includes(invitation.status) &&
                  (role === "owner" || invitation.role === "member"),
              ) && <p className="closed-note">目前沒有可操作的待接受邀請。</p>}
            </div>
          </section>
        </>
      )}

      {["owner", "finance"].includes(role) && (
        <>
          <section className="single-step-form">
            <h2>人工匯款購點</h2>
            {!acceptance ? (
              <button
                className="button secondary"
                onClick={async () =>
                  post(`/api/organizations/${organizationId}/contract`, {
                    deviceHash: await deviceHash(),
                  })
                    .then(setAcceptance)
                    .catch(() => setMessage("B2B 契約或營運設定尚未完成。"))
                }
              >
                開始 B2B 契約審閱
              </button>
            ) : (
              <>
                <a
                  href={`/api/legal/documents/${acceptance.documentId}`}
                  className="button secondary"
                >
                  下載 B2B 契約
                </a>
                <p>
                  第二次確認開放：
                  {new Date(acceptance.confirmAvailableAt).toLocaleString(
                    "zh-TW",
                  )}
                </p>
                {!acceptance.secondConfirmedAt && (
                  <button
                    className="button"
                    disabled={
                      currentTime < Date.parse(acceptance.confirmAvailableAt)
                    }
                    onClick={async () =>
                      post("/api/legal/acceptances", {
                        phase: "confirm",
                        acceptanceId: acceptance.acceptanceId,
                        deviceHash: await deviceHash(),
                      })
                        .then((result) =>
                          setAcceptance((current) =>
                            current ? { ...current, ...result } : current,
                          ),
                        )
                        .catch(() => setMessage("72 小時審閱期尚未完成。"))
                    }
                  >
                    第二次確認契約
                  </button>
                )}
              </>
            )}
            {acceptance?.secondConfirmedAt && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const points = Number(
                    new FormData(event.currentTarget).get("points"),
                  );
                  void post(`/api/organizations/${organizationId}/topups`, {
                    points,
                    legalAcceptanceId: acceptance.acceptanceId,
                  })
                    .then((result) =>
                      window.location.assign(
                        `/organization/topups/${result.topupId}`,
                      ),
                    )
                    .catch(() => setMessage("購點功能目前保持關閉。"));
                }}
              >
                <label>
                  購買點數（1 點 = NT$1）
                  <input
                    name="points"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={10_000_000}
                    required
                  />
                </label>
                <button className="button" type="submit">
                  建立購點匯款單
                </button>
              </form>
            )}
          </section>
          <form
            className="single-step-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void post(`/api/organizations/${organizationId}/point-refunds`, {
                pointTopupId: form.get("pointTopupId"),
                points: Number(form.get("points")),
                reason: form.get("reason"),
                bankName: form.get("bankName"),
                bankCode: form.get("bankCode"),
                accountNumber: form.get("accountNumber"),
                accountName: form.get("accountName"),
              })
                .then((result) =>
                  setMessage(
                    `已凍結 ${result.points} 個未使用點數；退款案件等待兩位財務人員核准。`,
                  ),
                )
                .catch(() =>
                  setMessage(
                    "退款未受理；只能退回原購點 lot 尚未使用的點數，且帳戶資料加密服務必須可用。",
                  ),
                );
            }}
          >
            <h2>申請退回未使用點數</h2>
            <p>只退原實付價，每點 NT$1；已保留或已使用點數不會被扣除。</p>
            <label>
              原購點紀錄
              <select name="pointTopupId" required defaultValue="">
                <option value="" disabled>
                  請選擇已確認的購點紀錄
                </option>
                {(details?.topups ?? [])
                  .filter((topup) => topup.status === "paid")
                  .map((topup) => (
                    <option key={topup.topupId} value={topup.topupId}>
                      {topup.referenceNumber}－{topup.points} 點
                    </option>
                  ))}
              </select>
            </label>
            <label>
              退款點數
              <input
                name="points"
                type="number"
                inputMode="numeric"
                min={1}
                max={10_000_000}
                required
              />
            </label>
            <label>
              銀行
              <input name="bankName" minLength={2} required />
            </label>
            <label>
              銀行代碼
              <input
                name="bankCode"
                inputMode="numeric"
                pattern="[0-9]{3}"
                required
              />
            </label>
            <label>
              帳號
              <input
                name="accountNumber"
                inputMode="numeric"
                pattern="[0-9]{6,20}"
                required
              />
            </label>
            <label>
              戶名
              <input name="accountName" minLength={2} required />
            </label>
            <label>
              原因（至少 10 字）
              <textarea name="reason" minLength={10} required />
            </label>
            <button className="button secondary" type="submit">
              加密帳戶並凍結未使用點數
            </button>
          </form>
        </>
      )}

      {["owner", "training_manager"].includes(role) && (
        <>
          <OrganizationBatchAssignment
            courses={courses}
            members={members}
            organizationId={organizationId}
          />
          <form
            className="single-step-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const assignmentId = String(form.get("assignmentId"));
              const component =
                details?.assignments.find(
                  (assignment) => assignment.assignmentId === assignmentId,
                )?.liveComponentId ?? null;
              void post(
                `/api/organizations/assignments/${assignmentId}/session`,
                {
                  liveSessionId: form.get("liveSessionId"),
                  liveComponentId: component || null,
                },
              )
                .then(() => setMessage("直播場次已選定。"))
                .catch(() =>
                  setMessage("場次已滿、太接近開課或 component 不符。"),
                );
            }}
          >
            <h2>為點數指派選擇直播場次</h2>
            <label>
              員工與課程
              <select
                name="assignmentId"
                required
                value={liveAssignmentId}
                onChange={(event) => setLiveAssignmentId(event.target.value)}
              >
                <option value="">請選擇尚未選場的指派</option>
                {(details?.assignments ?? [])
                  .filter(
                    (assignment) => assignment.eligibleLiveSessions.length > 0,
                  )
                  .map((assignment) => (
                    <option
                      key={assignment.assignmentId}
                      value={assignment.assignmentId}
                    >
                      {assignment.memberLabel}－{assignment.courseTitle}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              可選場次
              <select name="liveSessionId" required defaultValue="">
                <option value="" disabled>
                  請選擇場次
                </option>
                {(details?.assignments ?? [])
                  .find(
                    (assignment) =>
                      assignment.assignmentId === liveAssignmentId,
                  )
                  ?.eligibleLiveSessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.title}－
                      {new Date(session.startsAt).toLocaleString("zh-TW")}
                    </option>
                  ))}
              </select>
            </label>
            <button className="button secondary" type="submit">
              選擇場次
            </button>
          </form>
          <form
            className="single-step-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const bookingId = String(form.get("bookingId"));
              void post(
                `/api/organizations/live-bookings/${bookingId}/change`,
                { replacementSessionId: form.get("replacementSessionId") },
              )
                .then(() => setMessage("已在 24 小時截止前更換場次。"))
                .catch(() => setMessage("更換已鎖定或新場次不可用。"));
            }}
          >
            <h2>截止前更換場次</h2>
            <label>
              目前的員工與場次
              <select
                name="bookingId"
                required
                value={changeBookingId}
                onChange={(event) => setChangeBookingId(event.target.value)}
              >
                <option value="">請選擇可更換的場次</option>
                {(details?.liveBookings ?? [])
                  .filter((booking) => booking.canChange)
                  .map((booking) => (
                    <option key={booking.bookingId} value={booking.bookingId}>
                      {booking.memberLabel}－{booking.sessionTitle}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              新場次
              <select name="replacementSessionId" required defaultValue="">
                <option value="" disabled>
                  請選擇新場次
                </option>
                {(details?.liveBookings ?? [])
                  .find((booking) => booking.bookingId === changeBookingId)
                  ?.replacementSessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.title}－
                      {new Date(session.startsAt).toLocaleString("zh-TW")}
                    </option>
                  ))}
              </select>
            </label>
            <button className="button secondary" type="submit">
              更換場次
            </button>
          </form>
          <form
            className="single-step-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const assignmentId = String(form.get("assignmentId"));
              void post(
                `/api/organizations/assignments/${assignmentId}/release`,
                { reason: form.get("reason") },
              )
                .then(() =>
                  setMessage("未使用指派已釋放，原 point lots 已歸還。"),
                )
                .catch(() =>
                  setMessage("已有使用或已進入 24 小時截止，不能釋放。"),
                );
            }}
          >
            <h2>釋放未使用指派</h2>
            <label>
              員工與課程
              <select name="assignmentId" required defaultValue="">
                <option value="" disabled>
                  請選擇可收回的指派
                </option>
                {(details?.assignments ?? [])
                  .filter((assignment) => assignment.canRelease)
                  .map((assignment) => (
                    <option
                      key={assignment.assignmentId}
                      value={assignment.assignmentId}
                    >
                      {assignment.memberLabel}－{assignment.courseTitle}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              理由
              <textarea name="reason" minLength={10} required />
            </label>
            <button className="button secondary" type="submit">
              釋放並歸還保留點數
            </button>
          </form>
        </>
      )}
      {details?.capabilities.canExportTrainingReport && (
        <form
          className="single-step-form"
          method="get"
          action={`/api/organizations/${organizationId}/reports/training`}
        >
          <h2>匯出機構培訓報表</h2>
          <p>
            Excel
            僅含本機構出資的摘要、員工成果、直播出席與點數異動；不含證號、逐題答案、調查文字或原始事件。
          </p>
          <label>
            課程（選填）
            <select name="courseVersionId" defaultValue="">
              <option value="">全部課程</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            直播場次（選填）
            <select name="liveSessionId" defaultValue="">
              <option value="">全部場次</option>
              {(details?.liveBookings ?? []).map((booking) => (
                <option key={booking.bookingId} value={booking.sessionId}>
                  {booking.sessionTitle}－
                  {new Date(booking.startsAt).toLocaleDateString("zh-TW")}
                </option>
              ))}
            </select>
          </label>
          <label>
            部門（選填）
            <input name="department" maxLength={100} />
          </label>
          <label>
            指派狀態（選填）
            <select name="status" defaultValue="">
              <option value="">全部</option>
              <option value="reserved">已保留</option>
              <option value="active">進行中</option>
              <option value="consumed">已使用點數</option>
              <option value="completed">已完成</option>
              <option value="released">已收回</option>
              <option value="refunded">已退款</option>
            </select>
          </label>
          <button className="button secondary" type="submit">
            下載去敏感 Excel
          </button>
        </form>
      )}
      <p className="flow-message" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
