"use client";

import { useState } from "react";
import type { PlatformPrerequisiteOptions } from "@/application/workspace";
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

function moveId(ids: string[], id: string, direction: -1 | 1) {
  const current = ids.indexOf(id);
  const next = current + direction;
  if (current < 0 || next < 0 || next >= ids.length) return ids;
  const reordered = [...ids];
  [reordered[current], reordered[next]] = [
    reordered[next]!,
    reordered[current]!,
  ];
  return reordered;
}

function SortButtons({
  index,
  count,
  busy,
  onMove,
}: {
  index: number;
  count: number;
  busy: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <span className="page-actions">
      <button
        aria-label="往上移"
        className="button secondary"
        disabled={busy || index === 0}
        onClick={() => onMove(-1)}
        type="button"
      >
        上移
      </button>
      <button
        aria-label="往下移"
        className="button secondary"
        disabled={busy || index === count - 1}
        onClick={() => onMove(1)}
        type="button"
      >
        下移
      </button>
    </span>
  );
}

export function CourseDraftStructureManager({ draft }: { draft: CourseDraft }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "以下操作只會修改目前尚未送審的草稿；已發布版本永遠不會被覆寫。",
  );
  const structurePath = `/api/staff/courses/${draft.id}/structure`;
  const questionPath = `/api/staff/courses/${draft.id}/questions/manage`;

  function run(
    path: string,
    body: unknown,
    success: string,
    confirmation?: string,
  ) {
    if (confirmation && !window.confirm(confirmation)) return;
    setBusy(true);
    setMessage("保存中…");
    void post(path, body)
      .then(() => {
        setMessage(success);
        window.setTimeout(() => window.location.reload(), 500);
      })
      .catch((error: Error) =>
        setMessage(
          presentErrorCode(
            error.message,
            "未保存；只有草稿建立者或平台管理員能修改未送審版本。",
          ),
        ),
      )
      .finally(() => setBusy(false));
  }

  return (
    <section className="single-step-form">
      <h2>編輯、刪除與排序草稿內容</h2>
      <p>
        這裡只允許移除尚未送審的草稿內容；已發布版本、影音資產與既有稽核證據不會被覆寫。調整內容後，發布檢查仍會重新驗證講師、單元、至少
        20 題題庫與影片狀態。
      </p>

      <h3>講師</h3>
      {draft.instructors.length === 0 && (
        <p className="closed-note">尚未加入講師。</p>
      )}
      {draft.instructors.map((instructor, index) => (
        <form
          className="context-action-form"
          key={instructor.id}
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            run(
              structurePath,
              {
                operation: "instructor_update",
                instructorId: instructor.id,
                displayName: form.get("displayName"),
                biography: form.get("biography"),
                credentials: form.get("credentials"),
              },
              "講師資料已更新。",
            );
          }}
        >
          <strong>講師 {index + 1}</strong>
          <label>
            公開姓名
            <input
              name="displayName"
              defaultValue={instructor.label}
              minLength={2}
              maxLength={100}
              required
            />
          </label>
          <label>
            簡介
            <textarea
              name="biography"
              defaultValue={instructor.biography}
              minLength={10}
              maxLength={3000}
              required
            />
          </label>
          <label>
            專業資歷
            <textarea
              name="credentials"
              defaultValue={instructor.credentials}
              minLength={5}
              maxLength={1000}
              required
            />
          </label>
          <div className="page-actions">
            <button className="button secondary" disabled={busy} type="submit">
              保存講師
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                run(
                  structurePath,
                  {
                    operation: "instructor_delete",
                    instructorId: instructor.id,
                  },
                  "講師已從草稿移除。",
                  `確定要從此草稿移除「${instructor.label}」嗎？`,
                )
              }
              type="button"
            >
              移除講師
            </button>
            <SortButtons
              busy={busy}
              count={draft.instructors.length}
              index={index}
              onMove={(direction) =>
                run(
                  structurePath,
                  {
                    operation: "instructor_reorder",
                    orderedIds: moveId(
                      draft.instructors.map((item) => item.id),
                      instructor.id,
                      direction,
                    ),
                  },
                  "講師順序已更新。",
                )
              }
            />
          </div>
        </form>
      ))}

      <h3>章節與單元</h3>
      {draft.modules.map((module, moduleIndex) => (
        <article className="context-action-form" key={module.id}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              run(
                structurePath,
                {
                  operation: "module_update",
                  moduleId: module.id,
                  title: form.get("title"),
                },
                "章節名稱已更新。",
              );
            }}
          >
            <label>
              第 {moduleIndex + 1} 章
              <input
                name="title"
                defaultValue={module.label}
                minLength={2}
                maxLength={200}
                required
              />
            </label>
            <div className="page-actions">
              <button
                className="button secondary"
                disabled={busy}
                type="submit"
              >
                保存章節
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  run(
                    structurePath,
                    { operation: "module_delete", moduleId: module.id },
                    "章節及其草稿單元已移除。",
                    `確定從草稿移除「${module.label}」與其所有單元嗎？`,
                  )
                }
                type="button"
              >
                移除章節
              </button>
              <SortButtons
                busy={busy}
                count={draft.modules.length}
                index={moduleIndex}
                onMove={(direction) =>
                  run(
                    structurePath,
                    {
                      operation: "module_reorder",
                      orderedIds: moveId(
                        draft.modules.map((item) => item.id),
                        module.id,
                        direction,
                      ),
                    },
                    "章節順序已更新。",
                  )
                }
              />
            </div>
          </form>

          {module.lessons.map((lesson, lessonIndex) => (
            <form
              className="context-action-form"
              key={lesson.id}
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                run(
                  structurePath,
                  {
                    operation: "lesson_update",
                    lessonId: lesson.id,
                    title: form.get("title"),
                    contentType: form.get("contentType"),
                    preview: form.get("preview") === "on",
                  },
                  "單元已更新。",
                );
              }}
            >
              <strong>
                {moduleIndex + 1}-{lessonIndex + 1}
              </strong>
              <label>
                單元名稱
                <input
                  name="title"
                  defaultValue={lesson.label}
                  minLength={2}
                  maxLength={200}
                  required
                />
              </label>
              <label>
                類型
                <select
                  name="contentType"
                  defaultValue={lesson.contentType}
                  required
                >
                  <option value="video">影片</option>
                  <option value="material">教材</option>
                  <option value="quiz">測驗</option>
                  <option value="survey">滿意度</option>
                </select>
              </label>
              <label>
                <input
                  name="preview"
                  type="checkbox"
                  defaultChecked={lesson.preview}
                />{" "}
                可免費試看
              </label>
              <div className="page-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  type="submit"
                >
                  保存單元
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    run(
                      structurePath,
                      { operation: "lesson_delete", lessonId: lesson.id },
                      "單元已從草稿移除。",
                      `確定從草稿移除「${lesson.label}」嗎？已建立的影音與稽核證據不會被抹除。`,
                    )
                  }
                  type="button"
                >
                  移除單元
                </button>
                <SortButtons
                  busy={busy}
                  count={module.lessons.length}
                  index={lessonIndex}
                  onMove={(direction) =>
                    run(
                      structurePath,
                      {
                        operation: "lesson_reorder",
                        moduleId: module.id,
                        orderedIds: moveId(
                          module.lessons.map((item) => item.id),
                          lesson.id,
                          direction,
                        ),
                      },
                      "單元順序已更新。",
                    )
                  }
                />
              </div>
            </form>
          ))}
        </article>
      ))}

      <h3>題庫（學員考試仍由伺服器隨機抽題）</h3>
      {draft.questions.length === 0 && (
        <p className="closed-note">尚未建立題目。</p>
      )}
      {draft.questions.map((question, questionIndex) => (
        <details className="context-action-form" key={question.id}>
          <summary>
            第 {questionIndex + 1} 題：{question.prompt}
          </summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              run(
                questionPath,
                {
                  operation: "question_update",
                  questionId: question.id,
                  prompt: form.get("prompt"),
                  topic: form.get("topic"),
                  explanation: form.get("explanation"),
                  options: [0, 1, 2, 3].map((index) =>
                    form.get(`option${index}`),
                  ),
                  correctIndex: Number(form.get("correctIndex")),
                },
                "題目已建立新版並停用舊版。",
              );
            }}
          >
            <label>
              題目
              <textarea
                name="prompt"
                defaultValue={question.prompt}
                minLength={5}
                maxLength={2000}
                required
              />
            </label>
            <label>
              主題
              <input
                name="topic"
                defaultValue={question.topic}
                minLength={2}
                maxLength={200}
                required
              />
            </label>
            {question.options.map((option, optionIndex) => (
              <label key={optionIndex}>
                選項 {optionIndex + 1}
                <input
                  name={`option${optionIndex}`}
                  defaultValue={option}
                  maxLength={1000}
                  required
                />
              </label>
            ))}
            <label>
              正確答案
              <select
                name="correctIndex"
                defaultValue={String(question.correctIndex)}
              >
                {[0, 1, 2, 3].map((index) => (
                  <option key={index} value={index}>
                    選項 {index + 1}
                  </option>
                ))}
              </select>
            </label>
            <label>
              解析
              <textarea
                name="explanation"
                defaultValue={question.explanation}
                minLength={5}
                maxLength={4000}
                required
              />
            </label>
            <div className="page-actions">
              <button
                className="button secondary"
                disabled={busy}
                type="submit"
              >
                保存題目新版
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  run(
                    questionPath,
                    {
                      operation: "question_delete",
                      questionId: question.id,
                    },
                    "題目已停用。",
                    "確定停用此題嗎？既有測驗 snapshot 不會被改寫。",
                  )
                }
                type="button"
              >
                停用題目
              </button>
              <SortButtons
                busy={busy}
                count={draft.questions.length}
                index={questionIndex}
                onMove={(direction) =>
                  run(
                    questionPath,
                    {
                      operation: "question_reorder",
                      orderedIds: moveId(
                        draft.questions.map((item) => item.id),
                        question.id,
                        direction,
                      ),
                    },
                    "題庫管理順序已更新。",
                  )
                }
              />
            </div>
          </form>
        </details>
      ))}
      <p aria-live="polite">{message}</p>
    </section>
  );
}
