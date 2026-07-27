"use client";

import { useState } from "react";
import {
  surveyInvestigationResultSchema,
  type SurveyInvestigationResult,
  type SurveyInvestigationWorkspace,
} from "@/domain/quality-staff";
import { presentErrorCode } from "@/domain/presentation";
import { obtainStepUp } from "@/infrastructure/supabase/step-up-client";

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

export function SurveyInvestigationPanel({
  workspace,
}: {
  workspace: SurveyInvestigationWorkspace;
}) {
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [message, setMessage] = useState(
    "清單不包含文字意見。只有填寫必要性並完成 fresh TOTP 後，系統才會另行讀取原文並留下稽核紀錄。",
  );
  const [investigation, setInvestigation] = useState<{
    courseTitle: string;
    result: SurveyInvestigationResult;
  } | null>(null);

  return (
    <section className="organization-records">
      <section>
        <p className="eyebrow">去識別清單</p>
        <h2>問卷原文調查候選</h2>
        <p className="muted-copy">
          下列清單只含課程、評分摘要與時間，不含文字原文、學員或修課編號。
        </p>
        <div className="record-list">
          {workspace.items.map((item) => (
            <article key={item.surveyResponseId}>
              <strong>{item.courseTitle}</strong>
              <span>
                第 {item.revision} 版・平均 {item.averageRating.toFixed(1)} 分・
                {item.hasComment ? "有文字意見" : "未填文字意見"}
              </span>
              <p>
                送出時間：
                {new Date(item.submittedAt).toLocaleString("zh-TW")}
              </p>
              {item.hasComment && (
                <form
                  className="context-action-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const reason = String(form.get("reason") ?? "");
                    setBusyTarget(item.surveyResponseId);
                    setInvestigation(null);
                    void obtainStepUp("pii_decrypt", item.surveyResponseId)
                      .then((stepUpNonce) =>
                        post(
                          `/api/staff/surveys/${item.surveyResponseId}/investigate`,
                          { reason, stepUpNonce },
                        ),
                      )
                      .then((result) => {
                        const parsed =
                          surveyInvestigationResultSchema.parse(result);
                        setInvestigation({
                          courseTitle: item.courseTitle,
                          result: parsed,
                        });
                        setMessage(
                          "原文已依本次必要性授權讀取；離開或重新整理頁面後不保留。",
                        );
                      })
                      .catch((error: Error) =>
                        setMessage(
                          presentErrorCode(
                            error.message,
                            "原文調查未授權；請確認角色、理由與 fresh TOTP。",
                          ),
                        ),
                      )
                      .finally(() => setBusyTarget(null));
                  }}
                >
                  <label>
                    查閱必要性
                    <textarea
                      name="reason"
                      minLength={10}
                      maxLength={1000}
                      required
                    />
                  </label>
                  <button
                    className="button secondary"
                    disabled={busyTarget !== null}
                    type="submit"
                  >
                    {busyTarget === item.surveyResponseId
                      ? "驗證與讀取中…"
                      : "Fresh TOTP 後調查原文"}
                  </button>
                </form>
              )}
            </article>
          ))}
          {workspace.items.length === 0 && (
            <p className="closed-note">目前沒有符合條件的問卷回覆。</p>
          )}
        </div>
      </section>

      <section>
        <p className="eyebrow">單次授權結果</p>
        <h2>問卷文字原文</h2>
        {investigation ? (
          <>
            <dl className="compact-data-list">
              <div>
                <dt>課程</dt>
                <dd>{investigation.courseTitle}</dd>
              </div>
              <div>
                <dt>評分</dt>
                <dd>{investigation.result.ratings.join("、")}</dd>
              </div>
              <div>
                <dt>送出時間</dt>
                <dd>
                  {new Date(investigation.result.submittedAt).toLocaleString(
                    "zh-TW",
                  )}
                </dd>
              </div>
              <div>
                <dt>文字原文</dt>
                <dd>{investigation.result.comment ?? "本次未填文字意見"}</dd>
              </div>
            </dl>
            <button
              className="button secondary"
              onClick={() => setInvestigation(null)}
              type="button"
            >
              關閉原文
            </button>
          </>
        ) : (
          <div className="empty-state">
            <h3>尚未授權讀取</h3>
            <p>從左側選擇一筆有文字意見的問卷，填寫必要性後再讀取。</p>
          </div>
        )}
        <p aria-live="polite">{message}</p>
      </section>
    </section>
  );
}
