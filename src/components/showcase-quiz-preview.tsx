"use client";

import { useState } from "react";

export function ShowcaseQuizPreview() {
  const [answer, setAnswer] = useState("");
  return (
    <section className="course-runner-quiz showcase-runner-quiz">
      <header>
        <div>
          <span>第 1／10 題</span>
          <strong>剩餘 29:42</strong>
        </div>
        <div className="quiz-progress-track">
          <span style={{ width: "10%" }} />
        </div>
        <small>此為介面示範，不保存答案或成績</small>
      </header>
      <fieldset>
        <legend>遇到失智長者重複詢問相同問題時，較適合的第一步是？</legend>
        {[
          ["a", "立即糾正並要求記住答案"],
          ["b", "先回應情緒與需求，再用簡短語句說明"],
          ["c", "完全不回應，等待行為停止"],
          ["d", "請其他住民代為處理"],
        ].map(([value, label], index) => (
          <label className={answer === value ? "is-selected" : ""} key={value}>
            <input
              checked={answer === value}
              name="showcase-question"
              onChange={() => setAnswer(value)}
              type="radio"
            />
            <span aria-hidden="true">{String.fromCharCode(65 + index)}</span>
            <strong>{label}</strong>
          </label>
        ))}
      </fieldset>
      <footer>
        <button className="button secondary" disabled type="button">
          上一題
        </button>
        <button className="button" disabled={!answer} type="button">
          下一題
        </button>
      </footer>
    </section>
  );
}
