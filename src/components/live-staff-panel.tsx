"use client";

import { useMemo, useState } from "react";
import { presentErrorCode } from "@/domain/presentation";

export type DraftBreak = { id: number; startsAt: string; endsAt: string };
type Option = { id: string; label: string };
type LiveCourseVersionOption = Option & { components: Option[] };

export function BreakIntervalEditor({
  intervals,
  onChange,
}: {
  intervals: DraftBreak[];
  onChange: (intervals: DraftBreak[]) => void;
}) {
  return (
    <fieldset className="break-editor">
      <legend>正式休息區段</legend>
      <p>逐段填寫實際起訖；系統只排除這些區段，不接受人工填總秒數。</p>
      {intervals.map((interval, index) => (
        <div className="break-row" key={interval.id}>
          <label>
            第 {index + 1} 段開始
            <input
              type="datetime-local"
              value={interval.startsAt}
              onChange={(event) =>
                onChange(
                  intervals.map((item) =>
                    item.id === interval.id
                      ? { ...item, startsAt: event.target.value }
                      : item,
                  ),
                )
              }
              required
            />
          </label>
          <label>
            第 {index + 1} 段結束
            <input
              type="datetime-local"
              value={interval.endsAt}
              onChange={(event) =>
                onChange(
                  intervals.map((item) =>
                    item.id === interval.id
                      ? { ...item, endsAt: event.target.value }
                      : item,
                  ),
                )
              }
              required
            />
          </label>
          <button
            className="button secondary"
            onClick={() =>
              onChange(intervals.filter((item) => item.id !== interval.id))
            }
            type="button"
          >
            移除此段
          </button>
        </div>
      ))}
      <button
        className="button secondary"
        disabled={intervals.length >= 20}
        onClick={() =>
          onChange([
            ...intervals,
            {
              id: Math.max(0, ...intervals.map((item) => item.id)) + 1,
              startsAt: "",
              endsAt: "",
            },
          ])
        }
        type="button"
      >
        新增休息區段
      </button>
      {intervals.length === 0 && <p>這個場次沒有正式休息區段。</p>}
    </fieldset>
  );
}

export function toBreakPayload(intervals: DraftBreak[]) {
  return intervals.map((interval) => ({
    startsAt: new Date(interval.startsAt).toISOString(),
    endsAt: new Date(interval.endsAt).toISOString(),
  }));
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
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error ?? "REQUEST_REJECTED");
  return result?.data;
}

export function LiveStaffPanel({
  courseVersions,
  hosts,
}: {
  courseVersions: LiveCourseVersionOption[];
  hosts: Option[];
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [courseVersionId, setCourseVersionId] = useState("");
  const [breaks, setBreaks] = useState<DraftBreak[]>([]);
  const components = useMemo(
    () =>
      courseVersions.find((course) => course.id === courseVersionId)
        ?.components ?? [],
    [courseVersionId, courseVersions],
  );
  const canCreate = courseVersions.length > 0 && hosts.length > 0;

  if (!canCreate) {
    return (
      <div className="warning-panel">
        <strong>目前不能建立直播場次</strong>
        <p>
          請先完成課程版本與 Zoom
          主持資源的審核。系統不接受手動貼上內部編號繞過前置條件。
        </p>
      </div>
    );
  }

  return (
    <form
      className="single-step-form"
      onSubmit={(event) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        const asIso = (name: string) =>
          new Date(String(form.get(name))).toISOString();
        setBusy(true);
        setMessage("建立中…");
        void post("/api/staff/live/sessions", {
          courseVersionId,
          hybridComponentId:
            String(form.get("hybridComponentId") ?? "").trim() || null,
          hostResourceId: form.get("hostResourceId"),
          title: form.get("title"),
          startsAt: asIso("startsAt"),
          endsAt: asIso("endsAt"),
          bookingCloseAt: asIso("bookingCloseAt"),
          learnerCapacity: Number(form.get("learnerCapacity")),
          verifiedZoomTotalCapacity: Number(
            form.get("verifiedZoomTotalCapacity"),
          ),
          hostSeats: Number(form.get("hostSeats")),
          cohostSeats: Number(form.get("cohostSeats")),
          reservedSupportSeats: Number(form.get("reservedSupportSeats")),
          breakIntervals: toBreakPayload(breaks),
          presenceThreshold: Number(form.get("presenceThreshold")),
          cameraThreshold: Number(form.get("cameraThreshold")),
        })
          .then(() => {
            setMessage("Zoom 場次已建立；請到直播案件清單繼續排程與管理。");
            setBreaks([]);
            formElement.reset();
            setCourseVersionId("");
          })
          .catch((error: Error) =>
            setMessage(
              presentErrorCode(
                error.message,
                "場次未建立；請確認時段、容量與主持資源。",
              ),
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <h2>建立 Zoom 同步場次</h2>
      <p>
        課程與主持資源只能從已審核清單選取。建立後的修改、結算與取消請從直播案件進入該場次。
      </p>
      <label>
        課程版本
        <select
          required
          value={courseVersionId}
          onChange={(event) => setCourseVersionId(event.target.value)}
        >
          <option value="" disabled>
            請選擇
          </option>
          {courseVersions.map((course) => (
            <option key={course.id} value={course.id}>
              {course.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        混合課直播單元
        <select
          disabled={!courseVersionId || components.length === 0}
          key={courseVersionId}
          name="hybridComponentId"
          defaultValue=""
        >
          <option value="">
            {components.length === 0
              ? "整門純直播課"
              : "請選擇（純直播可不選）"}
          </option>
          {components.map((component) => (
            <option key={component.id} value={component.id}>
              {component.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Zoom 主持資源
        <select name="hostResourceId" required defaultValue="">
          <option value="" disabled>
            請選擇
          </option>
          {hosts.map((host) => (
            <option key={host.id} value={host.id}>
              {host.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        場次名稱（須含「線上同步課程」）
        <input name="title" required />
      </label>
      {[
        ["startsAt", "開始"],
        ["endsAt", "結束"],
        ["bookingCloseAt", "報名截止"],
      ].map(([name, label]) => (
        <label key={name}>
          {label}
          <input name={name} type="datetime-local" required />
        </label>
      ))}
      <label>
        學員容量
        <input
          name="learnerCapacity"
          type="number"
          min={1}
          max={200}
          defaultValue={100}
          required
        />
      </label>
      <label>
        Zoom 已實測總容量
        <input
          name="verifiedZoomTotalCapacity"
          type="number"
          min={1}
          max={200}
          defaultValue={100}
          required
        />
      </label>
      <label>
        主持人席
        <input
          name="hostSeats"
          type="number"
          min={1}
          defaultValue={1}
          required
        />
      </label>
      <label>
        共同主持席
        <input
          name="cohostSeats"
          type="number"
          min={0}
          defaultValue={0}
          required
        />
      </label>
      <label>
        支援保留席
        <input
          name="reservedSupportSeats"
          type="number"
          min={0}
          defaultValue={0}
          required
        />
      </label>
      <label>
        出席門檻（%）
        <input
          name="presenceThreshold"
          type="number"
          min={1}
          max={100}
          defaultValue={80}
          required
        />
      </label>
      <label>
        鏡頭證據門檻（%）
        <input
          name="cameraThreshold"
          type="number"
          min={1}
          max={100}
          defaultValue={80}
          required
        />
      </label>
      <BreakIntervalEditor intervals={breaks} onChange={setBreaks} />
      <button className="button" disabled={busy} type="submit">
        {busy ? "建立中…" : "保留主持資源並建立場次"}
      </button>
      <p className="flow-message" aria-live="polite">
        {message}
      </p>
    </form>
  );
}
