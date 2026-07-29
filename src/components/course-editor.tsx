"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  InstructorBindingOption,
  PlatformPrerequisiteOptions,
} from "@/application/workspace";
import type { VideoMasterBackupItem } from "@/application/video-backup-workspace";
import { CourseDraftLearnerPreview } from "@/components/course-draft-learner-preview";
import { CourseLifecyclePanel } from "@/components/course-lifecycle-panel";
import { CourseDraftStructureManager } from "@/components/course-draft-structure-manager";
import { CourseDraftMetadataEditor } from "@/components/course-draft-metadata-editor";
import { QuestionCsvImporter } from "@/components/question-csv-importer";
import { VideoMasterBackupPanel } from "@/components/video-master-backup-panel";
import { presentErrorCode } from "@/domain/presentation";

type CourseDraft = PlatformPrerequisiteOptions["courseDrafts"][number];

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

function lines(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function iso(form: FormData, name: string) {
  return new Date(String(form.get(name))).toISOString();
}

async function waitForCourseAssetScan(uploadId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(
      `/api/uploads/quarantine?uploadId=${encodeURIComponent(uploadId)}`,
      { cache: "no-store" },
    );
    const result = await response.json().catch(() => null);
    const status = result?.data?.status;
    if (status === "promoted") return;
    if (["rejected", "failed"].includes(status)) {
      throw new Error("COURSE_ASSET_SCAN_REJECTED");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  throw new Error("COURSE_ASSET_SCAN_PENDING");
}

const videoStatusLabels: Record<string, string> = {
  uploading: "上傳中",
  processing: "處理中／等待母檔備份",
  ready: "可播放",
  failed: "處理失敗",
};

function DraftOutline({ draft }: { draft: CourseDraft }) {
  return (
    <section className="single-step-form">
      <h2>目前課綱與影音狀態</h2>
      {draft.modules.map((module) => (
        <article key={module.id}>
          <h3>{module.label}</h3>
          <ul>
            {module.lessons.map((lesson) => (
              <li key={lesson.id}>
                {lesson.label}（
                {lesson.contentType === "video"
                  ? `影片：${
                      lesson.videoStatus
                        ? (videoStatusLabels[lesson.videoStatus] ??
                          "狀態確認中")
                        : "尚未上傳"
                    }`
                  : lesson.contentType === "quiz"
                    ? "測驗"
                    : lesson.contentType === "survey"
                      ? "滿意度"
                      : "教材"}
                ）
              </li>
            ))}
          </ul>
        </article>
      ))}
      <button
        className="button secondary"
        onClick={() => window.location.reload()}
        type="button"
      >
        重新讀取影片狀態
      </button>
    </section>
  );
}

export function CourseEditor({
  options,
  selectedDraft,
  instructorOptions,
  videoBackupItems,
  previewMode = false,
}: {
  options: PlatformPrerequisiteOptions;
  selectedDraft: CourseDraft | null;
  instructorOptions: InstructorBindingOption[];
  videoBackupItems: VideoMasterBackupItem[] | null;
  previewMode?: boolean;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [deliveryType, setDeliveryType] = useState<
    "recorded" | "live" | "hybrid"
  >("recorded");
  const learnerPreviewOpen = Boolean(selectedDraft && previewMode);
  const [existingCourseId, setExistingCourseId] = useState("");
  const [moduleId, setModuleId] = useState(selectedDraft?.modules[0]?.id ?? "");
  const firstInstructor = instructorOptions[0] ?? null;
  const [instructorRoleId, setInstructorRoleId] = useState(
    firstInstructor?.roleId ?? "",
  );
  const [instructorDisplayName, setInstructorDisplayName] = useState(
    firstInstructor?.displayName ?? "",
  );
  const [instructorBiography, setInstructorBiography] = useState(
    firstInstructor?.biography ?? "",
  );
  const [instructorCredentials, setInstructorCredentials] = useState(
    firstInstructor?.credentials ?? "",
  );

  const prerequisitesReady =
    options.legalDocuments.length > 0 && options.retentionPolicies.length > 0;
  const videoLessons =
    selectedDraft?.modules.flatMap((module) =>
      module.lessons
        .filter((lesson) => lesson.contentType === "video")
        .map((lesson) => ({
          ...lesson,
          moduleLabel: module.label,
        })),
    ) ?? [];

  function run(
    operation: () => Promise<unknown>,
    success: string,
    reload = false,
  ) {
    setBusy(true);
    setMessage("處理中…");
    void operation()
      .then(() => {
        setMessage(success);
        if (reload) window.location.reload();
      })
      .catch((error: Error) =>
        setMessage(
          presentErrorCode(
            error.message,
            "操作未完成；請確認必填資料、前置核准與草稿狀態。",
          ),
        ),
      )
      .finally(() => setBusy(false));
  }

  return (
    <div className="organization-tools">
      <section className="single-step-form">
        <h2>選擇工作中的草稿</h2>
        <label>
          課程草稿
          <select
            value={selectedDraft?.id ?? ""}
            onChange={(event) => {
              const draft = event.target.value;
              window.location.assign(
                draft
                  ? `/staff/courses/editor?draft=${encodeURIComponent(draft)}`
                  : "/staff/courses/editor",
              );
            }}
          >
            <option value="">建立新草稿</option>
            {options.courseDrafts.map((draft) => (
              <option key={draft.id} value={draft.id}>
                {draft.label}
              </option>
            ))}
          </select>
        </label>
        {selectedDraft && (
          <div className="course-editor-preview-actions">
            <Link
              className={previewMode ? "button secondary" : "button"}
              href={
                previewMode
                  ? `/staff/courses/editor?draft=${encodeURIComponent(selectedDraft.id)}`
                  : `/staff/courses/editor?draft=${encodeURIComponent(
                      selectedDraft.id,
                    )}&preview=1#learner-preview`
              }
            >
              {previewMode ? "返回編輯模式" : "用學員視角預覽"}
            </Link>
            <p>預覽不會建立訂單、觀看分鐘、測驗作答或完課紀錄。</p>
          </div>
        )}
      </section>
      {selectedDraft && previewMode && (
        <CourseDraftLearnerPreview draft={selectedDraft} />
      )}
      {!learnerPreviewOpen && (
        <CourseLifecyclePanel versions={options.courseLifecycleVersions} />
      )}

      {!learnerPreviewOpen && !prerequisitesReady && (
        <div className="warning-panel">
          <strong>法律或保存先決資料尚未齊全</strong>
          <p>
            至少需要一份已核准的法律文件與保存政策才能建立課程。積分 revision
            可以稍後補上，但補齊前不能提交審核或發布。
          </p>
        </div>
      )}

      {!selectedDraft && (
        <form
          className="single-step-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const price = Number(form.get("priceTwd"));
            const recordedAllocation =
              deliveryType === "recorded"
                ? price
                : deliveryType === "hybrid"
                  ? Number(form.get("recordedRefundAllocationTwd"))
                  : 0;
            if (
              recordedAllocation < 0 ||
              recordedAllocation > price ||
              !Number.isInteger(recordedAllocation)
            ) {
              setMessage("錄播退款配置必須是 0 到總價之間的整數。");
              return;
            }
            const firstLessonType = String(form.get("firstLessonType"));
            setBusy(true);
            setMessage("建立草稿中…");
            void post("/api/staff/courses/drafts", {
              courseId: existingCourseId || undefined,
              slug: existingCourseId ? undefined : form.get("slug"),
              internalTitle: form.get("internalTitle"),
              title: form.get("title"),
              summary: form.get("summary"),
              description: form.get("description"),
              learningObjectives: lines(form.get("learningObjectives")),
              deliveryType,
              priceTwd: price,
              organizationPointPrice: Number(
                form.get("organizationPointPrice"),
              ),
              recordedRefundAllocationTwd: recordedAllocation,
              liveRefundAllocationTwd: deliveryType === "live" ? price : 0,
              equipmentRequirements: form.get("equipmentRequirements"),
              legalDocumentId: form.get("legalDocumentId"),
              retentionPolicyRevisionId: form.get("retentionPolicyRevisionId"),
              accreditationRevisionId:
                String(form.get("accreditationRevisionId") ?? "") || null,
              accreditationDisclosure: form.get("accreditationRevisionId")
                ? form.get("accreditationDisclosure")
                : "",
              minimumCompletionDays: Number(form.get("minimumCompletionDays")),
              commerceCloseAt: iso(form, "commerceCloseAt"),
              contentAvailableAt: iso(form, "contentAvailableAt"),
              requiredWatchSeconds: ["recorded", "hybrid"].includes(
                deliveryType,
              )
                ? Number(form.get("requiredWatchMinutes")) * 60
                : 0,
              livePresencePercent:
                deliveryType === "recorded"
                  ? null
                  : Number(form.get("livePresencePercent")),
              liveCameraPercent:
                deliveryType === "recorded"
                  ? null
                  : Number(form.get("liveCameraPercent")),
              modules: [
                {
                  title: form.get("firstModuleTitle"),
                  sortOrder: 0,
                  lessons: [
                    {
                      title: form.get("firstLessonTitle"),
                      contentType: firstLessonType,
                      preview: form.get("firstLessonPreview") === "on",
                      sortOrder: 0,
                    },
                  ],
                },
              ],
              hybridComponents:
                deliveryType === "hybrid"
                  ? [
                      {
                        componentType: "recorded",
                        title: "錄播學習",
                        required: true,
                        sortOrder: 0,
                        refundAllocationTwd: recordedAllocation,
                        dependsOnSortOrders: [],
                      },
                      {
                        componentType: "live",
                        title: "線上同步課程",
                        required: true,
                        sortOrder: 1,
                        refundAllocationTwd: price - recordedAllocation,
                        dependsOnSortOrders: [0],
                      },
                    ]
                  : [],
            })
              .then((data) => {
                const created =
                  data &&
                  typeof data === "object" &&
                  "courseVersionId" in data &&
                  typeof data.courseVersionId === "string"
                    ? data.courseVersionId
                    : "";
                if (!created) throw new Error("COURSE_DRAFT_INVALID");
                window.location.assign(
                  `/staff/courses/editor?draft=${encodeURIComponent(created)}`,
                );
              })
              .catch((error: Error) =>
                setMessage(
                  presentErrorCode(
                    error.message,
                    "草稿未建立；請檢查金額、日期與核准資料。",
                  ),
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <h2>第一步：建立版本化草稿</h2>
          <label>
            建立方式
            <select
              value={existingCourseId}
              onChange={(event) => setExistingCourseId(event.target.value)}
            >
              <option value="">全新課程</option>
              {options.courses.map((course) => (
                <option key={course.id} value={course.id}>
                  為「{course.label}」建立新版
                </option>
              ))}
            </select>
          </label>
          {!existingCourseId && (
            <label>
              網址英文代稱
              <input
                name="slug"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                placeholder="dementia-care-basics"
                required
              />
            </label>
          )}
          <label>
            內部課名
            <input name="internalTitle" required />
          </label>
          <label>
            對外課名
            <input name="title" required />
          </label>
          <label>
            課程摘要
            <textarea name="summary" minLength={10} maxLength={500} required />
          </label>
          <label>
            詳細介紹
            <textarea
              name="description"
              minLength={20}
              maxLength={10000}
              required
            />
          </label>
          <label>
            學習目標（每行一項）
            <textarea name="learningObjectives" required />
          </label>
          <label>
            課程形式
            <select
              value={deliveryType}
              onChange={(event) =>
                setDeliveryType(
                  event.target.value as "recorded" | "live" | "hybrid",
                )
              }
            >
              <option value="recorded">錄播</option>
              <option value="live">直播</option>
              <option value="hybrid">錄播＋直播混合</option>
            </select>
          </label>
          <label>
            個人售價（NT$）
            <input name="priceTwd" type="number" min={0} required />
          </label>
          <label>
            機構扣點
            <input
              name="organizationPointPrice"
              type="number"
              min={1}
              required
            />
          </label>
          {deliveryType === "hybrid" && (
            <label>
              總價中屬於錄播的退款配置（其餘自動列為直播）
              <input
                name="recordedRefundAllocationTwd"
                type="number"
                min={0}
                required
              />
            </label>
          )}
          {deliveryType !== "live" && (
            <label>
              必要有效觀看分鐘
              <input
                name="requiredWatchMinutes"
                type="number"
                min={1}
                defaultValue={60}
                required
              />
            </label>
          )}
          {deliveryType !== "recorded" && (
            <>
              <label>
                直播出席門檻（%）
                <input
                  name="livePresencePercent"
                  type="number"
                  min={80}
                  max={100}
                  defaultValue={80}
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
                  defaultValue={80}
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
              defaultValue={1}
              required
            />
          </label>
          <label>
            販售截止
            <input name="commerceCloseAt" type="datetime-local" required />
          </label>
          <label>
            最早開放學習
            <input name="contentAvailableAt" type="datetime-local" required />
          </label>
          <label>
            法律文件
            <select name="legalDocumentId" required defaultValue="">
              <option value="" disabled>
                請選擇已核准版本
              </option>
              {options.legalDocuments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            資料保存政策
            <select name="retentionPolicyRevisionId" required defaultValue="">
              <option value="" disabled>
                請選擇已核准版本
              </option>
              {options.retentionPolicies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            積分核定／申請 revision（草稿建立時可稍後補）
            <select name="accreditationRevisionId" defaultValue="">
              <option value="">尚未建立；先保存課程草稿</option>
              {options.accreditationRevisions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            學員看得到的積分揭露（選擇 revision 時必填）
            <textarea name="accreditationDisclosure" maxLength={2000} />
          </label>
          <label>
            設備需求（選填）
            <textarea name="equipmentRequirements" maxLength={2000} />
          </label>
          <label>
            第一章名稱
            <input name="firstModuleTitle" required />
          </label>
          <label>
            第一單元名稱
            <input name="firstLessonTitle" required />
          </label>
          <label>
            第一單元類型
            <select
              name="firstLessonType"
              defaultValue={deliveryType === "live" ? "material" : "video"}
              key={deliveryType}
            >
              <option value="video">影片</option>
              <option value="material">教材</option>
              <option value="quiz">測驗</option>
              <option value="survey">滿意度</option>
            </select>
          </label>
          <label>
            <input name="firstLessonPreview" type="checkbox" /> 可免費試看
          </label>
          <button
            className="button"
            disabled={busy || !prerequisitesReady}
            type="submit"
          >
            {busy ? "建立中…" : "建立草稿"}
          </button>
        </form>
      )}

      {selectedDraft && !learnerPreviewOpen && (
        <>
          <DraftOutline draft={selectedDraft} />
          <CourseDraftMetadataEditor draft={selectedDraft} options={options} />
          <CourseDraftStructureManager draft={selectedDraft} />
          <form
            className="single-step-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              run(
                () =>
                  post(`/api/staff/courses/${selectedDraft.id}/instructors`, {
                    instructorRoleId,
                    displayName: form.get("displayName"),
                    biography: form.get("biography"),
                    credentials: form.get("credentials"),
                  }),
                "版本化講師資料已加入草稿。",
              );
            }}
          >
            <h2>第二步：綁定已核准講師</h2>
            <p>
              清單只顯示有效的講師角色與公開資料，不會提供手機、Email
              或積分身分資料。
            </p>
            <label>
              講師
              <select
                disabled={instructorOptions.length === 0}
                onChange={(event) => {
                  const roleId = event.target.value;
                  const selected = instructorOptions.find(
                    (candidate) => candidate.roleId === roleId,
                  );
                  setInstructorRoleId(roleId);
                  setInstructorDisplayName(selected?.displayName ?? "");
                  setInstructorBiography(selected?.biography ?? "");
                  setInstructorCredentials(selected?.credentials ?? "");
                }}
                required
                value={instructorRoleId}
              >
                {instructorOptions.length === 0 && (
                  <option value="">尚無有效講師角色</option>
                )}
                {instructorOptions.map((candidate) => (
                  <option key={candidate.roleId} value={candidate.roleId}>
                    {candidate.label}
                    {candidate.hasProfile ? "（已有公開簡介）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              講師公開姓名
              <input
                name="displayName"
                minLength={2}
                maxLength={100}
                onChange={(event) =>
                  setInstructorDisplayName(event.target.value)
                }
                required
                value={instructorDisplayName}
              />
            </label>
            <label>
              講師簡介
              <textarea
                name="biography"
                minLength={10}
                maxLength={3000}
                onChange={(event) => setInstructorBiography(event.target.value)}
                required
                value={instructorBiography}
              />
            </label>
            <label>
              專業資歷
              <textarea
                name="credentials"
                minLength={5}
                maxLength={1000}
                onChange={(event) =>
                  setInstructorCredentials(event.target.value)
                }
                required
                value={instructorCredentials}
              />
            </label>
            <button
              className="button secondary"
              disabled={busy || !instructorRoleId}
              type="submit"
            >
              加入講師
            </button>
          </form>
          <form
            className="single-step-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const existingModule = String(form.get("moduleId") ?? "");
              const newModuleTitle = String(
                form.get("newModuleTitle") ?? "",
              ).trim();
              if (!existingModule && newModuleTitle.length < 2) {
                setMessage("建立新章節時，請輸入至少兩個字的章節名稱。");
                return;
              }
              run(
                () =>
                  post(`/api/staff/courses/${selectedDraft.id}/structure`, {
                    operation: "lesson",
                    moduleId: existingModule || null,
                    moduleTitle: existingModule ? null : newModuleTitle,
                    lessonTitle: form.get("lessonTitle"),
                    contentType: form.get("contentType"),
                    preview: form.get("preview") === "on",
                  }),
                "章節與單元已加入草稿。",
                true,
              );
            }}
          >
            <h2>第三步：新增章節或單元</h2>
            <label>
              加入位置
              <select
                name="moduleId"
                value={moduleId}
                onChange={(event) => setModuleId(event.target.value)}
              >
                <option value="">建立新章節</option>
                {selectedDraft.modules.map((module) => (
                  <option key={module.id} value={module.id}>
                    {module.label}
                  </option>
                ))}
              </select>
            </label>
            {!moduleId && (
              <label>
                新章節名稱
                <input name="newModuleTitle" minLength={2} required />
              </label>
            )}
            <label>
              單元名稱
              <input name="lessonTitle" minLength={2} required />
            </label>
            <label>
              單元類型
              <select name="contentType">
                <option value="video">影片</option>
                <option value="material">教材</option>
                <option value="quiz">測驗</option>
                <option value="survey">滿意度</option>
              </select>
            </label>
            <label>
              <input name="preview" type="checkbox" /> 可免費試看
            </label>
            <button className="button secondary" disabled={busy} type="submit">
              新增單元
            </button>
          </form>

          <QuestionCsvImporter courseVersionId={selectedDraft.id} />

          <form
            className="single-step-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const file = form.get("courseAsset");
              const assetKind = String(form.get("assetKind"));
              if (!(file instanceof File) || file.size === 0) {
                setMessage("請選擇封面或教材檔案。");
                return;
              }
              setBusy(true);
              setMessage("檔案正在隔離掃描；掃描完成前不會出現在課程中…");
              const upload = new FormData();
              upload.set("purpose", "course_material");
              upload.set("file", file);
              void fetch("/api/uploads/quarantine", {
                method: "POST",
                body: upload,
              })
                .then(async (response) => {
                  const result = await response.json().catch(() => null);
                  if (!response.ok || !result?.data?.uploadId) {
                    throw new Error(
                      result?.error ?? "COURSE_ASSET_UPLOAD_REJECTED",
                    );
                  }
                  await waitForCourseAssetScan(result.data.uploadId);
                  return result.data.uploadId as string;
                })
                .then((uploadId) =>
                  post(`/api/staff/courses/${selectedDraft.id}/structure`, {
                    operation: assetKind,
                    uploadId,
                    ...(assetKind === "material"
                      ? {
                          lessonId:
                            String(form.get("assetLessonId") ?? "") || null,
                          title: form.get("assetTitle"),
                        }
                      : {}),
                  }),
                )
                .then(() => {
                  setMessage(
                    assetKind === "cover"
                      ? "封面掃描通過並已綁定草稿。"
                      : "教材掃描通過並已綁定草稿；學員只能透過授權流程取得。",
                  );
                  window.setTimeout(() => window.location.reload(), 1000);
                })
                .catch((error: Error) =>
                  setMessage(
                    presentErrorCode(
                      error.message,
                      "檔案未綁定；請檢查格式、掃描結果與草稿狀態。",
                    ),
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <h2>第四步：上傳封面或教材</h2>
            <p>
              檔案先進 private
              隔離區，通過惡意程式掃描與格式檢查後才會綁定草稿；不接受手動貼上儲存路徑。
            </p>
            <label>
              檔案用途
              <select name="assetKind" required defaultValue="cover">
                <option value="cover">課程封面（JPG／PNG）</option>
                <option value="material">課程教材</option>
              </select>
            </label>
            <label>
              教材名稱（上傳封面時可填「課程封面」）
              <input
                name="assetTitle"
                defaultValue="課程封面"
                minLength={2}
                maxLength={200}
                required
              />
            </label>
            <label>
              綁定單元（封面或全課教材可不選）
              <select name="assetLessonId" defaultValue="">
                <option value="">不綁定特定單元</option>
                {selectedDraft.modules.flatMap((module) =>
                  module.lessons.map((lesson) => (
                    <option key={lesson.id} value={lesson.id}>
                      {module.label}／{lesson.label}
                    </option>
                  )),
                )}
              </select>
            </label>
            <label>
              檔案（JPG、PNG、PDF、XLSX 或 CSV，10 MB 內）
              <input
                name="courseAsset"
                type="file"
                accept="image/jpeg,image/png,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                required
              />
            </label>
            <button className="button secondary" disabled={busy} type="submit">
              {busy ? "掃描中…" : "隔離掃描並綁定"}
            </button>
          </form>

          {videoBackupItems ? (
            <VideoMasterBackupPanel items={videoBackupItems} />
          ) : (
            <div className="warning-panel">
              <strong>影音母檔備份清單暫時無法讀取</strong>
              <p>
                安全投影恢復前不接受手動輸入影片資產編號；課程也不會因而略過母檔備份門檻。
              </p>
            </div>
          )}

          <form
            className="single-step-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const file = form.get("video");
              if (!(file instanceof File) || file.size === 0) {
                setMessage("請選擇影片檔。");
                return;
              }
              if (file.size > 200 * 1024 * 1024) {
                setMessage(
                  "首版一次性直傳單檔上限為 200 MB；較大影片請先轉檔或分成多個課程單元。",
                );
                return;
              }
              const lessonId = String(form.get("lessonId"));
              setBusy(true);
              setMessage("正在取得一次性上傳網址…");
              void post("/api/staff/stream/direct-upload", {
                lessonId,
                maxDurationSeconds: Number(form.get("maxDurationMinutes")) * 60,
              })
                .then(async (material) => {
                  const uploadURL =
                    material &&
                    typeof material === "object" &&
                    "uploadURL" in material &&
                    typeof material.uploadURL === "string"
                      ? material.uploadURL
                      : "";
                  if (!uploadURL) throw new Error("STREAM_UPLOAD_URL_INVALID");
                  const target = new URL(uploadURL, window.location.origin);
                  const approvedTarget =
                    target.origin === window.location.origin ||
                    (target.protocol === "https:" &&
                      (target.hostname.endsWith(".videodelivery.net") ||
                        target.hostname.endsWith(".cloudflarestream.com")));
                  if (!approvedTarget) {
                    throw new Error("STREAM_UPLOAD_TARGET_REJECTED");
                  }
                  setMessage("影片正在直接上傳，請勿關閉頁面…");
                  const upload = new FormData();
                  upload.set("file", file);
                  const response = await fetch(target, {
                    method: "POST",
                    body: upload,
                    credentials: "omit",
                  });
                  if (!response.ok) throw new Error("STREAM_UPLOAD_FAILED");
                })
                .then(() => {
                  setMessage(
                    "影片已上傳，Cloudflare 正在處理；收到簽章 webhook 且母檔備份確認後才會變成可播放。",
                  );
                  window.setTimeout(() => window.location.reload(), 1000);
                })
                .catch((error: Error) =>
                  setMessage(
                    presentErrorCode(
                      error.message,
                      "影片未上傳；請檢查檔案、Stream 設定與網路。",
                    ),
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <h2>第五步：上傳課程影片</h2>
            {videoLessons.length > 0 ? (
              <>
                <label>
                  影片單元
                  <select name="lessonId" required defaultValue="">
                    <option value="" disabled>
                      請選擇
                    </option>
                    {videoLessons.map((lesson) => (
                      <option key={lesson.id} value={lesson.id}>
                        {lesson.moduleLabel}／{lesson.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  影片最長分鐘數
                  <input
                    name="maxDurationMinutes"
                    type="number"
                    min={1}
                    max={480}
                    defaultValue={120}
                    required
                  />
                </label>
                <label>
                  影片檔（MP4／MOV／WebM；一次性直傳單檔 200 MB 內）
                  <input
                    name="video"
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm"
                    required
                  />
                </label>
                <button className="button" disabled={busy} type="submit">
                  {busy ? "上傳中…" : "直接上傳到影音服務"}
                </button>
              </>
            ) : (
              <p className="closed-note">
                請先新增一個「影片」單元，才能安全建立一次性上傳網址。
              </p>
            )}
          </form>

          <form
            className="single-step-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              run(
                () =>
                  post(`/api/staff/courses/${selectedDraft.id}/questions`, {
                    prompt: form.get("prompt"),
                    topic: form.get("topic"),
                    explanation: form.get("explanation"),
                    options: [0, 1, 2, 3].map((index) =>
                      form.get(`option${index}`),
                    ),
                    correctIndex: Number(form.get("correctIndex")),
                  }),
                "四選一題目已加入題庫。可繼續新增下一題。",
              );
            }}
          >
            <h2>第七步：建立四選一題庫</h2>
            <label>
              題目
              <textarea name="prompt" minLength={5} maxLength={2000} required />
            </label>
            <label>
              主題
              <input name="topic" minLength={2} maxLength={200} required />
            </label>
            {[0, 1, 2, 3].map((index) => (
              <label key={index}>
                選項 {index + 1}
                <input name={`option${index}`} maxLength={1000} required />
              </label>
            ))}
            <label>
              正確答案
              <select name="correctIndex" defaultValue="0">
                <option value="0">選項 1</option>
                <option value="1">選項 2</option>
                <option value="2">選項 3</option>
                <option value="3">選項 4</option>
              </select>
            </label>
            <label>
              答案說明
              <textarea
                name="explanation"
                minLength={5}
                maxLength={4000}
                required
              />
            </label>
            <button className="button secondary" disabled={busy} type="submit">
              新增題目
            </button>
          </form>

          <form
            className="single-step-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              run(
                () =>
                  post(`/api/staff/courses/${selectedDraft.id}/submit`, {
                    reason: form.get("reason"),
                  }),
                "課程已送交不同的積分審核者；草稿內容現在不可直接覆寫。",
                true,
              );
            }}
          >
            <h2>第八步：提交審核</h2>
            <p>
              系統會再次檢查核定、法務、保存政策、題庫、影片狀態與退款配置；缺件時安全拒絕。
            </p>
            <label>
              送審理由
              <textarea
                name="reason"
                minLength={10}
                maxLength={1000}
                required
              />
            </label>
            <button className="button" disabled={busy} type="submit">
              提交不同人覆核
            </button>
          </form>
        </>
      )}

      <p className="flow-message" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
