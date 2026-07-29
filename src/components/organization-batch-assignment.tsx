"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { OrganizationBatchAssignmentResult } from "@/application/platform";

export type OrganizationAssignmentMember = {
  personId: string;
  displayName: string;
  employeeNumber: string | null;
  department: string | null;
};

export type OrganizationAssignmentCourse = {
  id: string;
  title: string;
  points: number;
  deliveryType: "recorded" | "live" | "hybrid";
  liveSessions: {
    id: string;
    title: string;
    startsAt: string;
    bookingCloseAt: string;
  }[];
};

export const ORGANIZATION_BATCH_ASSIGNMENT_LIMIT = 200;

type SelectableOrganizationMember = {
  personId: string;
};

function normalizeOrganizationBatchSelection(
  currentMemberIds: readonly string[],
  members: readonly SelectableOrganizationMember[],
) {
  const availableMemberIds = new Set(members.map((member) => member.personId));
  const selectedMemberIds: string[] = [];
  const selectedMemberIdSet = new Set<string>();

  for (const personId of currentMemberIds) {
    if (
      availableMemberIds.has(personId) &&
      !selectedMemberIdSet.has(personId) &&
      selectedMemberIds.length < ORGANIZATION_BATCH_ASSIGNMENT_LIMIT
    ) {
      selectedMemberIds.push(personId);
      selectedMemberIdSet.add(personId);
    }
  }

  return { selectedMemberIds, selectedMemberIdSet };
}

export function fillOrganizationBatchSelection(
  currentMemberIds: readonly string[],
  members: readonly SelectableOrganizationMember[],
) {
  const { selectedMemberIds, selectedMemberIdSet } =
    normalizeOrganizationBatchSelection(currentMemberIds, members);

  for (const member of members) {
    if (selectedMemberIds.length >= ORGANIZATION_BATCH_ASSIGNMENT_LIMIT) break;
    if (!selectedMemberIdSet.has(member.personId)) {
      selectedMemberIds.push(member.personId);
      selectedMemberIdSet.add(member.personId);
    }
  }

  return selectedMemberIds;
}

export function updateOrganizationBatchMemberSelection(
  currentMemberIds: readonly string[],
  members: readonly SelectableOrganizationMember[],
  personId: string,
  checked: boolean,
) {
  const { selectedMemberIds, selectedMemberIdSet } =
    normalizeOrganizationBatchSelection(currentMemberIds, members);

  if (!checked) {
    return selectedMemberIds.filter(
      (selectedPersonId) => selectedPersonId !== personId,
    );
  }
  if (
    selectedMemberIdSet.has(personId) ||
    selectedMemberIds.length >= ORGANIZATION_BATCH_ASSIGNMENT_LIMIT
  ) {
    return selectedMemberIds;
  }
  if (!members.some((member) => member.personId === personId)) {
    return selectedMemberIds;
  }
  return [...selectedMemberIds, personId];
}

export function isOrganizationBatchSelectionValid(
  selectedMemberIds: readonly string[],
) {
  return (
    selectedMemberIds.length >= 1 &&
    selectedMemberIds.length <= ORGANIZATION_BATCH_ASSIGNMENT_LIMIT &&
    new Set(selectedMemberIds).size === selectedMemberIds.length
  );
}

export function translateOrganizationBatchAssignmentError(errorCode: string) {
  const normalizedCode = errorCode.trim().toUpperCase().replaceAll(" ", "_");
  if (
    normalizedCode === "TOO_BIG" ||
    normalizedCode.includes("BATCH_LIMIT") ||
    normalizedCode.includes("MEMBER_LIMIT") ||
    normalizedCode.includes("TOO_MANY_MEMBER")
  ) {
    return `單批最多只能指派 ${ORGANIZATION_BATCH_ASSIGNMENT_LIMIT} 位員工，請保留 ${ORGANIZATION_BATCH_ASSIGNMENT_LIMIT} 位以內後重新送出。`;
  }

  const labels: Record<string, string> = {
    IDEMPOTENCY_REQUEST_CONFLICT:
      "相同送出識別碼的內容不一致，請重新選擇後再試。",
    COMPLETION_DEADLINE_INVALID: "完成期限必須晚於現在。",
    COMPLETION_DEADLINE_BEFORE_SESSION_END: "完成期限必須晚於直播結束時間。",
    LIVE_SESSION_REQUIRED: "直播課必須先選擇場次。",
  };
  return (
    labels[normalizedCode] ??
    "整批尚未送出；請確認權限、課程狀態與系統開關後再試。"
  );
}

const assignmentErrorLabels: Record<string, string> = {
  ORGANIZATION_MEMBER_REQUIRED: "不是本機構的有效成員",
  DUPLICATE_ASSIGNMENT: "已經擁有這門課",
  INSUFFICIENT_POINTS: "機構可用點數不足",
  LIVE_SESSION_FULL: "直播場次已額滿",
  LIVE_SESSION_NOT_BOOKABLE: "直播場次已截止或不開放",
  ASSIGNMENT_SESSION_SELECTION_REJECTED: "無法替這位員工選擇場次",
  ASSIGNMENT_COMPONENT_MISMATCH: "場次與混合課組件不相符",
  ORGANIZATION_ASSIGNMENT_CLOSED: "派課功能目前暫停",
};

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

function taipeiEndOfDay(date: string) {
  return new Date(`${date}T23:59:59+08:00`).toISOString();
}

function todayInTaipei() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function postBatchAssignment(
  organizationId: string,
  body: {
    memberPersonIds: string[];
    courseVersionId: string;
    liveSessionId: string | null;
    completionDueAt: string | null;
  },
  idempotencyKey: string,
) {
  const response = await fetch(
    `/api/organizations/${organizationId}/assignments/batch`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(body),
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error ?? "REQUEST_REJECTED");
  }
  return result.data as OrganizationBatchAssignmentResult;
}

export function OrganizationBatchAssignment({
  organizationId,
  members,
  courses,
}: {
  organizationId: string;
  members: OrganizationAssignmentMember[];
  courses: OrganizationAssignmentCourse[];
}) {
  const router = useRouter();
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [selectedLiveSessionId, setSelectedLiveSessionId] = useState("");
  const [completionDate, setCompletionDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] =
    useState<OrganizationBatchAssignmentResult | null>(null);
  const requestIdentity = useRef<{
    fingerprint: string;
    idempotencyKey: string;
  } | null>(null);

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedCourseId) ?? null,
    [courses, selectedCourseId],
  );
  const selectedMembers = new Set(selectedMemberIds);
  const selectableMemberCount = Math.min(
    members.length,
    ORGANIZATION_BATCH_ASSIGNMENT_LIMIT,
  );
  const allSelected =
    selectableMemberCount > 0 &&
    selectedMemberIds.length === selectableMemberCount;
  const remainingCapacity = Math.max(
    0,
    ORGANIZATION_BATCH_ASSIGNMENT_LIMIT - selectedMemberIds.length,
  );
  const liveSessionRequired = selectedCourse?.deliveryType === "live";
  const validMemberSelection =
    isOrganizationBatchSelectionValid(selectedMemberIds);
  const canSubmit =
    !busy &&
    validMemberSelection &&
    Boolean(selectedCourse) &&
    (!liveSessionRequired || Boolean(selectedLiveSessionId));
  const selectionCapacityHelpId = `batch-selection-capacity-${organizationId}`;
  const submitHelpId = `batch-submit-help-${organizationId}`;
  const submitHelp =
    selectedMemberIds.length === 0
      ? "請至少選擇 1 位員工。"
      : selectedMemberIds.length > ORGANIZATION_BATCH_ASSIGNMENT_LIMIT
        ? `單批最多只能指派 ${ORGANIZATION_BATCH_ASSIGNMENT_LIMIT} 位員工。`
        : !selectedCourse
          ? "請先選擇課程。"
          : liveSessionRequired && !selectedLiveSessionId
            ? "直播課必須先選擇場次。"
            : busy
              ? "正在安全處理這批派課，請稍候。"
              : "資料已可送出。";

  return (
    <section className="single-step-form organization-batch-assignment">
      <div>
        <p className="eyebrow">培訓派課</p>
        <h2>一次指派多位員工</h2>
        <p>
          同一批只選一門課與一個直播場次。每位員工會分開驗證，只有成功列才保留點數。
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!selectedCourse || !canSubmit) return;
          const payload = {
            memberPersonIds: selectedMemberIds,
            courseVersionId: selectedCourse.id,
            liveSessionId: selectedLiveSessionId || null,
            completionDueAt: completionDate
              ? taipeiEndOfDay(completionDate)
              : null,
          };
          const fingerprint = JSON.stringify(payload);
          if (requestIdentity.current?.fingerprint !== fingerprint) {
            requestIdentity.current = {
              fingerprint,
              idempotencyKey: crypto.randomUUID(),
            };
          }

          setBusy(true);
          setMessage("正在逐位驗證成員、點數與直播名額…");
          setResult(null);
          void postBatchAssignment(
            organizationId,
            payload,
            requestIdentity.current.idempotencyKey,
          )
            .then((nextResult) => {
              setResult(nextResult);
              setMessage(
                nextResult.failedCount === 0
                  ? `已完成 ${nextResult.succeededCount} 位員工的派課，共保留 ${nextResult.reservedPoints.toLocaleString("zh-TW")} 點。`
                  : `成功 ${nextResult.succeededCount} 位、失敗 ${nextResult.failedCount} 位；失敗列沒有扣點。`,
              );
              setSelectedMemberIds(
                nextResult.results
                  .filter((item) => item.status === "failed")
                  .map((item) => item.memberPersonId),
              );
              requestIdentity.current = null;
              router.refresh();
            })
            .catch((error: Error) => {
              setMessage(
                translateOrganizationBatchAssignmentError(error.message),
              );
            })
            .finally(() => setBusy(false));
        }}
      >
        <label>
          課程
          <select
            name="courseVersionId"
            required
            value={selectedCourseId}
            onChange={(event) => {
              setSelectedCourseId(event.target.value);
              setSelectedLiveSessionId("");
              setResult(null);
              requestIdentity.current = null;
            }}
          >
            <option value="">請選擇一門課</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}－每人 {course.points} 點
              </option>
            ))}
          </select>
        </label>

        {selectedCourse && selectedCourse.deliveryType !== "recorded" && (
          <label>
            直播場次
            <select
              name="liveSessionId"
              required={liveSessionRequired}
              value={selectedLiveSessionId}
              onChange={(event) => {
                setSelectedLiveSessionId(event.target.value);
                setResult(null);
                requestIdentity.current = null;
              }}
            >
              <option value="">
                {liveSessionRequired
                  ? "直播課必須選擇場次"
                  : "混合課可先派課、稍後選場"}
              </option>
              {selectedCourse.liveSessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title}－{formatTaipei(session.startsAt)}
                </option>
              ))}
            </select>
            {selectedCourse.liveSessions.length === 0 && (
              <span className="closed-note">
                目前沒有仍開放且符合這門課的直播場次。
              </span>
            )}
          </label>
        )}

        <label>
          完成期限（選填）
          <input
            min={todayInTaipei()}
            name="completionDate"
            type="date"
            value={completionDate}
            onChange={(event) => {
              setCompletionDate(event.target.value);
              setResult(null);
              requestIdentity.current = null;
            }}
          />
          <span>期限以台灣時間當日 23:59 計算，學員也會在我的課程看到。</span>
        </label>

        <fieldset className="organization-member-picker">
          <legend>
            選擇員工（最多 {ORGANIZATION_BATCH_ASSIGNMENT_LIMIT} 位）
          </legend>
          <p
            aria-live="polite"
            className="closed-note"
            id={selectionCapacityHelpId}
            role="status"
          >
            已選 {selectedMemberIds.length} /{" "}
            {ORGANIZATION_BATCH_ASSIGNMENT_LIMIT} 位；還可選 {remainingCapacity}{" "}
            位。
            {members.length > ORGANIZATION_BATCH_ASSIGNMENT_LIMIT
              ? ` 目前共有 ${members.length} 位有效成員；全選會保留您已手動勾選的人，再依名單順序補滿本批，其餘成員請另開一批。`
              : ""}
          </p>
          <label className="organization-member-select-all">
            <input
              aria-describedby={selectionCapacityHelpId}
              checked={allSelected}
              disabled={members.length === 0 || busy}
              onChange={(event) => {
                setSelectedMemberIds(
                  event.target.checked
                    ? fillOrganizationBatchSelection(selectedMemberIds, members)
                    : [],
                );
                setResult(null);
                requestIdentity.current = null;
              }}
              type="checkbox"
            />
            全選目前有效成員（超過 {ORGANIZATION_BATCH_ASSIGNMENT_LIMIT}{" "}
            位時只選滿本批）
          </label>
          <div className="organization-member-options">
            {members.map((member) => {
              const memberSelected = selectedMembers.has(member.personId);
              const capacityReached =
                remainingCapacity === 0 && !memberSelected;
              return (
                <label key={member.personId}>
                  <input
                    aria-describedby={selectionCapacityHelpId}
                    checked={memberSelected}
                    disabled={busy || capacityReached}
                    onChange={(event) => {
                      setSelectedMemberIds((current) =>
                        updateOrganizationBatchMemberSelection(
                          current,
                          members,
                          member.personId,
                          event.target.checked,
                        ),
                      );
                      setResult(null);
                      requestIdentity.current = null;
                    }}
                    title={
                      capacityReached
                        ? `本批已選滿 ${ORGANIZATION_BATCH_ASSIGNMENT_LIMIT} 位；取消一位後即可改選。`
                        : undefined
                    }
                    type="checkbox"
                    value={member.personId}
                  />
                  <span>
                    <strong>{member.displayName}</strong>
                    <small>
                      {member.employeeNumber || "未填員編"}・
                      {member.department || "未填部門"}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
          {members.length === 0 && (
            <p className="closed-note">目前沒有可指派的有效成員。</p>
          )}
        </fieldset>

        <div className="organization-batch-summary">
          <span>
            將保留最多{" "}
            <strong>
              {(
                (selectedCourse?.points ?? 0) * selectedMemberIds.length
              ).toLocaleString("zh-TW")}
            </strong>{" "}
            點
          </span>
          <button
            aria-describedby={`${selectionCapacityHelpId} ${submitHelpId}`}
            className="button"
            disabled={!canSubmit}
            type="submit"
          >
            {busy ? "安全處理中…" : `指派 ${selectedMemberIds.length} 位員工`}
          </button>
          <span className="closed-note" id={submitHelpId}>
            {submitHelp}
          </span>
        </div>
      </form>

      <p aria-live="polite">{message}</p>

      {result && (
        <div className="organization-batch-results">
          <h3>逐列結果</h3>
          <div className="record-list">
            {result.results.map((item) => {
              const member = members.find(
                (candidate) => candidate.personId === item.memberPersonId,
              );
              return (
                <article key={item.memberPersonId}>
                  <strong>{member?.displayName ?? "機構成員"}</strong>
                  <span>
                    {item.status === "assigned" ? "指派成功" : "未指派"}
                  </span>
                  <p>
                    {item.status === "assigned"
                      ? `已保留 ${item.reservedPoints.toLocaleString("zh-TW")} 點${item.liveBookingId ? "，直播座位已確認" : ""}`
                      : (assignmentErrorLabels[item.errorCode ?? ""] ??
                        "安全檢查未通過，未扣點")}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
