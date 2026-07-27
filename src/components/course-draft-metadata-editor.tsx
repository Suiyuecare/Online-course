"use client";

import { useState } from "react";
import type { PlatformPrerequisiteOptions } from "@/application/workspace";
import { presentErrorCode } from "@/domain/presentation";

type CourseDraft = PlatformPrerequisiteOptions["courseDrafts"][number];

function localDateTime(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function objectiveLines(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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

export function CourseDraftMetadataEditor({
  draft,
  options,
}: {
  draft: CourseDraft;
  options: PlatformPrerequisiteOptions;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "課型在建立版本後不可改；其他草稿欄位可在送審前修正。",
  );

  return (
    <form
      className="single-step-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const priceTwd = Number(form.get("priceTwd"));
        const hybridComponents = draft.metadata.hybridComponents.map(
          (component) => ({
            componentId: component.componentId,
            title: form.get(`hybridTitle:${component.componentId}`),
            required:
              form.get(`hybridRequired:${component.componentId}`) === "on",
            sortOrder: component.sortOrder,
            refundAllocationTwd: Number(
              form.get(`hybridRefund:${component.componentId}`),
            ),
            recordedRequiredWatchSeconds:
              component.componentType === "recorded"
                ? Number(form.get(`hybridMinutes:${component.componentId}`)) *
                  60
                : 0,
            dependsOnComponentIds: form
              .getAll(`hybridDepends:${component.componentId}`)
              .map(String),
          }),
        );
        const recordedRefundAllocationTwd =
          draft.deliveryType === "live"
            ? 0
            : draft.deliveryType === "hybrid"
              ? hybridComponents
                  .filter((component) =>
                    draft.metadata.hybridComponents.some(
                      (candidate) =>
                        candidate.componentId === component.componentId &&
                        candidate.componentType === "recorded",
                    ),
                  )
                  .reduce(
                    (sum, component) => sum + component.refundAllocationTwd,
                    0,
                  )
              : Number(form.get("recordedRefundAllocationTwd"));
        const liveAllocation = hybridComponents
          .filter((component) =>
            draft.metadata.hybridComponents.some(
              (candidate) =>
                candidate.componentId === component.componentId &&
                candidate.componentType === "live",
            ),
          )
          .reduce((sum, component) => sum + component.refundAllocationTwd, 0);
        const allocationValid =
          (draft.deliveryType === "recorded" &&
            recordedRefundAllocationTwd === priceTwd) ||
          (draft.deliveryType === "live" &&
            recordedRefundAllocationTwd === 0) ||
          (draft.deliveryType === "hybrid" &&
            recordedRefundAllocationTwd + liveAllocation === priceTwd);
        if (!allocationValid) {
          setMessage(
            "退款配置不一致：錄播配置與所有直播元件配置的合計必須等於個人售價。",
          );
          return;
        }
        const requiredWatchSeconds =
          draft.deliveryType === "live"
            ? 0
            : Number(form.get("requiredWatchMinutes")) * 60;
        const scopedRequiredSeconds = hybridComponents
          .filter(
            (component) =>
              component.required &&
              draft.metadata.hybridComponents.some(
                (candidate) =>
                  candidate.componentId === component.componentId &&
                  candidate.componentType === "recorded",
              ),
          )
          .reduce(
            (sum, component) => sum + component.recordedRequiredWatchSeconds,
            0,
          );
        if (
          draft.deliveryType === "hybrid" &&
          scopedRequiredSeconds !== requiredWatchSeconds
        ) {
          setMessage(
            "混合課的必修錄播元件分鐘合計，必須等於全課必要有效觀看分鐘。",
          );
          return;
        }
        const lessonMappings = draft.modules.flatMap((module) =>
          module.lessons
            .filter((lesson) => lesson.contentType === "video")
            .map((lesson) => ({
              lessonId: lesson.id,
              componentId: String(form.get(`hybridLesson:${lesson.id}`) ?? ""),
            })),
        );
        if (
          draft.deliveryType === "hybrid" &&
          lessonMappings.some((mapping) => !mapping.componentId)
        ) {
          setMessage("每個錄播影片單元都必須指定一個錄播元件。");
          return;
        }
        setBusy(true);
        setMessage("保存中…");
        void post(`/api/staff/courses/${draft.id}/structure`, {
          operation: "course_update",
          title: form.get("title"),
          summary: form.get("summary"),
          description: form.get("description"),
          learningObjectives: objectiveLines(form.get("learningObjectives")),
          priceTwd,
          organizationPointPrice: Number(form.get("organizationPointPrice")),
          recordedRefundAllocationTwd,
          equipmentRequirements: form.get("equipmentRequirements"),
          legalDocumentId: form.get("legalDocumentId"),
          retentionPolicyRevisionId: form.get("retentionPolicyRevisionId"),
          accreditationRevisionId: form.get("accreditationRevisionId"),
          accreditationDisclosure: form.get("accreditationDisclosure"),
          minimumCompletionDays: Number(form.get("minimumCompletionDays")),
          commerceCloseAt: new Date(
            String(form.get("commerceCloseAt")),
          ).toISOString(),
          contentAvailableAt: new Date(
            String(form.get("contentAvailableAt")),
          ).toISOString(),
          requiredWatchSeconds,
          livePresencePercent:
            draft.deliveryType === "recorded"
              ? null
              : Number(form.get("livePresencePercent")),
          liveCameraPercent:
            draft.deliveryType === "recorded"
              ? null
              : Number(form.get("liveCameraPercent")),
          hybridComponents:
            draft.deliveryType === "hybrid"
              ? hybridComponents.map((component) => ({
                  componentId: component.componentId,
                  title: component.title,
                  required: component.required,
                  sortOrder: component.sortOrder,
                  refundAllocationTwd: component.refundAllocationTwd,
                  dependsOnComponentIds: component.dependsOnComponentIds,
                }))
              : [],
        })
          .then(() =>
            draft.deliveryType === "hybrid"
              ? post(`/api/staff/courses/${draft.id}/structure`, {
                  operation: "hybrid_configuration",
                  componentRequirements: hybridComponents
                    .filter((component) =>
                      draft.metadata.hybridComponents.some(
                        (candidate) =>
                          candidate.componentId === component.componentId &&
                          candidate.componentType === "recorded",
                      ),
                    )
                    .map((component) => ({
                      componentId: component.componentId,
                      requiredWatchSeconds:
                        component.recordedRequiredWatchSeconds,
                    })),
                  lessonMappings,
                })
              : undefined,
          )
          .then(() => {
            setMessage("課程介紹、價格、門檻與正式 revision 已更新。");
            window.setTimeout(() => window.location.reload(), 500);
          })
          .catch((error: Error) =>
            setMessage(
              presentErrorCode(
                error.message,
                "未保存；請核對退款總額、正式 revision 與日期。",
              ),
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <h2>編輯課程介紹、價格與完課條件</h2>
      <label>
        對外課名
        <input
          name="title"
          defaultValue={draft.metadata.title}
          minLength={2}
          maxLength={200}
          required
        />
      </label>
      <label>
        摘要
        <textarea
          name="summary"
          defaultValue={draft.metadata.summary}
          minLength={10}
          maxLength={500}
          required
        />
      </label>
      <label>
        詳細介紹
        <textarea
          name="description"
          defaultValue={draft.metadata.description}
          minLength={20}
          maxLength={10000}
          required
        />
      </label>
      <label>
        學習目標（每行一項）
        <textarea
          name="learningObjectives"
          defaultValue={draft.metadata.learningObjectives.join("\n")}
          required
        />
      </label>
      <label>
        個人售價（NT$）
        <input
          name="priceTwd"
          type="number"
          min={0}
          step={1}
          defaultValue={draft.metadata.priceTwd}
          required
        />
      </label>
      <label>
        機構扣點
        <input
          name="organizationPointPrice"
          type="number"
          min={1}
          step={1}
          defaultValue={draft.metadata.organizationPointPrice}
          required
        />
      </label>
      {draft.deliveryType !== "live" && (
        <>
          {draft.deliveryType === "recorded" && (
            <label>
              錄播退款配置（NT$）
              <input
                name="recordedRefundAllocationTwd"
                type="number"
                min={0}
                step={1}
                defaultValue={draft.metadata.recordedRefundAllocationTwd}
                required
              />
            </label>
          )}
          <label>
            必要有效觀看分鐘
            <input
              name="requiredWatchMinutes"
              type="number"
              min={1}
              step={1}
              defaultValue={Math.ceil(draft.metadata.requiredWatchSeconds / 60)}
              required
            />
          </label>
        </>
      )}
      {draft.deliveryType !== "recorded" && (
        <>
          <label>
            直播出席門檻（%）
            <input
              name="livePresencePercent"
              type="number"
              min={80}
              max={100}
              defaultValue={draft.metadata.livePresencePercent ?? 80}
              required
            />
          </label>
          <label>
            直播鏡頭證據門檻（%）
            <input
              name="liveCameraPercent"
              type="number"
              min={80}
              max={100}
              defaultValue={draft.metadata.liveCameraPercent ?? 80}
              required
            />
          </label>
        </>
      )}
      <label>
        完課最少跨日天數
        <input
          name="minimumCompletionDays"
          type="number"
          min={1}
          max={3650}
          step={1}
          defaultValue={draft.metadata.minimumCompletionDays}
          required
        />
      </label>
      <label>
        販售截止
        <input
          name="commerceCloseAt"
          type="datetime-local"
          defaultValue={localDateTime(draft.metadata.commerceCloseAt)}
          required
        />
      </label>
      <label>
        最早開放學習
        <input
          name="contentAvailableAt"
          type="datetime-local"
          defaultValue={localDateTime(draft.metadata.contentAvailableAt)}
          required
        />
      </label>
      <label>
        法律文件
        <select
          name="legalDocumentId"
          defaultValue={draft.metadata.legalDocumentId}
          required
        >
          {options.legalDocuments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        資料保存政策
        <select
          name="retentionPolicyRevisionId"
          defaultValue={draft.metadata.retentionPolicyRevisionId}
          required
        >
          {options.retentionPolicies.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        積分申請／核定 revision
        <select
          name="accreditationRevisionId"
          defaultValue={draft.metadata.accreditationRevisionId ?? ""}
          required
        >
          <option value="" disabled>
            送審前必須選擇 revision
          </option>
          {options.accreditationRevisions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        學員看得到的積分揭露
        <textarea
          name="accreditationDisclosure"
          defaultValue={draft.metadata.accreditationDisclosure}
          minLength={10}
          maxLength={2000}
          required
        />
      </label>
      <label>
        設備需求（選填）
        <textarea
          name="equipmentRequirements"
          defaultValue={draft.metadata.equipmentRequirements}
          maxLength={2000}
        />
      </label>
      {draft.deliveryType === "hybrid" &&
        draft.metadata.hybridComponents.map((component) => (
          <fieldset key={component.componentId}>
            <legend>
              混合課元件（
              {component.componentType === "recorded" ? "錄播" : "直播"}）
            </legend>
            <label>
              元件名稱
              <input
                name={`hybridTitle:${component.componentId}`}
                defaultValue={component.title}
                minLength={2}
                maxLength={200}
                required
              />
            </label>
            {component.componentType === "recorded" && (
              <label>
                此錄播元件必要有效觀看分鐘
                <input
                  name={`hybridMinutes:${component.componentId}`}
                  type="number"
                  min={component.required ? 1 : 0}
                  step={1}
                  defaultValue={Math.ceil(
                    component.recordedRequiredWatchSeconds / 60,
                  )}
                  required
                />
              </label>
            )}
            <label>
              <input
                name={`hybridRequired:${component.componentId}`}
                type="checkbox"
                defaultChecked={component.required}
              />{" "}
              必修元件
            </label>
            <label>
              退款配置（NT$）
              <input
                name={`hybridRefund:${component.componentId}`}
                type="number"
                min={0}
                step={1}
                defaultValue={component.refundAllocationTwd}
                required
              />
            </label>
            <fieldset>
              <legend>必須先完成</legend>
              {draft.metadata.hybridComponents
                .filter(
                  (candidate) =>
                    candidate.componentId !== component.componentId,
                )
                .map((candidate) => (
                  <label key={candidate.componentId}>
                    <input
                      name={`hybridDepends:${component.componentId}`}
                      type="checkbox"
                      value={candidate.componentId}
                      defaultChecked={component.dependsOnComponentIds.includes(
                        candidate.componentId,
                      )}
                    />{" "}
                    {candidate.title}
                  </label>
                ))}
            </fieldset>
          </fieldset>
        ))}
      {draft.deliveryType === "hybrid" && (
        <fieldset>
          <legend>影片所屬錄播元件</legend>
          {draft.modules.flatMap((module) =>
            module.lessons
              .filter((lesson) => lesson.contentType === "video")
              .map((lesson) => (
                <label key={lesson.id}>
                  {module.label}／{lesson.label}
                  <select
                    name={`hybridLesson:${lesson.id}`}
                    defaultValue={lesson.hybridComponentId ?? ""}
                    required
                  >
                    <option value="" disabled>
                      請選擇錄播元件
                    </option>
                    {draft.metadata.hybridComponents
                      .filter(
                        (component) => component.componentType === "recorded",
                      )
                      .map((component) => (
                        <option
                          key={component.componentId}
                          value={component.componentId}
                        >
                          {component.title}
                        </option>
                      ))}
                  </select>
                </label>
              )),
          )}
        </fieldset>
      )}
      <button className="button" disabled={busy} type="submit">
        {busy ? "保存中…" : "保存課程草稿設定"}
      </button>
      <p aria-live="polite">{message}</p>
    </form>
  );
}
