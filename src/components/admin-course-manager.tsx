"use client";

import { useState } from "react";
import {
  Archive,
  BookPlus,
  Copy,
  LoaderCircle,
  PencilLine,
  ShieldCheck,
} from "lucide-react";

export type CourseRow = {
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  delivery: "recorded" | "live";
  status: string;
  price_twd: number;
  accredited: boolean;
  organizer_name?: string;
  accreditation_status: string;
  accreditation_authority?: string | null;
  accreditation_category?: string | null;
  accreditation_number?: string | null;
  accreditation_points: number;
  pass_score: number;
  completion_percent: number;
};
type LessonRow = {
  id: string;
  title: string;
  position: number;
  duration_seconds: number;
  is_preview: boolean;
  active_video_asset_id: string | null;
};
type ModuleRow = {
  id: string;
  title: string;
  position: number;
  lessons: LessonRow[];
};
type QuestionRow = {
  id: string;
  prompt: string;
  position: number;
  points: number;
  active: boolean;
};
type CourseDetail = {
  course: CourseRow;
  modules: ModuleRow[];
  questions: QuestionRow[];
};

const previewCourses: CourseRow[] = [
  {
    id: "preview",
    slug: "dementia-care-pilot",
    title: "失智照護入門：看見行為背後的需要",
    subtitle: "非積分封閉測試課",
    delivery: "recorded",
    status: "draft",
    price_twd: 100,
    accredited: false,
    accreditation_status: "not_submitted",
    accreditation_points: 0,
    pass_score: 80,
    completion_percent: 90,
  },
];

export function AdminCourseManager({
  enabled,
  preview,
  initialCourses,
}: {
  enabled: boolean;
  preview: boolean;
  initialCourses: CourseRow[];
}) {
  const [courses, setCourses] = useState(
    preview ? previewCourses : initialCourses,
  );
  const [selected, setSelected] = useState<CourseDetail | null>(null);
  const [message, setMessage] = useState(
    preview ? "預覽模式：連接資料庫後即可建立與編輯課程。" : "",
  );
  const [busy, setBusy] = useState(false);

  async function loadCourses() {
    const response = await fetch("/api/admin/courses");
    const result = await response.json();
    if (response.ok) setCourses(result.courses);
  }
  async function loadDetail(courseId: string) {
    if (preview || courseId === "preview")
      return setSelected({
        course: previewCourses[0],
        modules: [],
        questions: [],
      });
    setBusy(true);
    const response = await fetch(`/api/admin/courses/${courseId}`);
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage("讀取課程內容失敗。");
    setSelected({
      ...result,
      modules: (result.modules ?? []).map((module: ModuleRow) => ({
        ...module,
        lessons: [...(module.lessons ?? [])].sort(
          (a, b) => a.position - b.position,
        ),
      })),
    });
  }
  async function createCourse(formData: FormData) {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/admin/courses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: formData.get("title"),
        slug: formData.get("slug"),
        subtitle: formData.get("subtitle"),
        priceTwd: Number(formData.get("priceTwd")),
        accredited: formData.get("accredited") === "on",
        passScore: Number(formData.get("passScore")),
        delivery: formData.get("delivery"),
      }),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok)
      return setMessage(
        result.error === "SLUG_ALREADY_EXISTS"
          ? "網址代稱已被使用。"
          : "課程建立失敗，請檢查必填欄位。",
      );
    setMessage("課程草稿已建立。接著可設定章節、測驗與影片。");
    await loadCourses();
    await loadDetail(result.course.id);
  }
  async function saveCourse(formData: FormData) {
    if (!selected) return;
    setBusy(true);
    setMessage("");
    const payload = {
      title: formData.get("title"),
      subtitle: formData.get("subtitle"),
      price_twd: Number(formData.get("price_twd")),
      pass_score: Number(formData.get("pass_score")),
      completion_percent: Number(formData.get("completion_percent")),
      accredited: formData.get("accredited") === "on",
      organizer_name: formData.get("organizer_name"),
      accreditation_authority: formData.get("accreditation_authority") || null,
      accreditation_category: formData.get("accreditation_category") || null,
      accreditation_status: formData.get("accreditation_status"),
      accreditation_number: formData.get("accreditation_number") || null,
      accreditation_points: Number(formData.get("accreditation_points")),
    };
    const response = await fetch(`/api/admin/courses/${selected.course.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(result.message ?? "課程設定儲存失敗。");
    setMessage("課程設定已儲存並留下稽核紀錄。");
    await loadCourses();
    await loadDetail(selected.course.id);
  }
  async function courseAction(action: "archive" | "duplicate") {
    if (!selected) return;
    setBusy(true);
    setMessage("");
    const response = await fetch(
      `/api/admin/courses/${selected.course.id}/actions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      },
    );
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(result.message ?? "課程操作失敗。");
    setMessage(
      action === "archive"
        ? "課程已下架，既有稽核資料仍保留。"
        : "已建立一份新的課程草稿副本。",
    );
    setSelected(null);
    await loadCourses();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#EADFCF] p-5">
          <div>
            <p className="section-kicker">COURSE OPERATIONS</p>
            <h2 className="mt-2 text-xl font-black text-[#302318]">全部課程</h2>
          </div>
          <span className="rounded-full bg-[#FFF0D5] px-3 py-1.5 text-xs font-black text-[#8A4800]">
            {courses.length} 門
          </span>
        </div>
        <div className="divide-y divide-[#F0E7DB]">
          {courses.map((course) => (
            <button
              key={course.id}
              type="button"
              onClick={() => void loadDetail(course.id)}
              className="flex min-h-20 w-full items-center gap-4 p-5 text-left hover:bg-[#FFF8ED]"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#FFF0D5] text-[#B45309]">
                {course.accredited ? (
                  <ShieldCheck className="size-5" />
                ) : (
                  <PencilLine className="size-5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-black text-[#302318]">
                  {course.title}
                </span>
                <span className="mt-1 block text-xs font-bold text-slate-500">
                  {course.slug}・{course.delivery === "live" ? "直播" : "錄播"}
                  ・NT${course.price_twd}・{course.status}
                </span>
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-black ${course.accredited ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
              >
                {course.accredited ? "積分課" : "一般課"}
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="panel p-5 sm:p-6">
        {selected ? (
          <>
            <EditForm
              course={selected.course}
              busy={busy}
              enabled={enabled && !preview}
              onSave={saveCourse}
            />
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                disabled={!enabled || busy}
                onClick={() => void courseAction("duplicate")}
                className="button-secondary"
              >
                <Copy className="size-4" />
                複製為新草稿
              </button>
              <button
                disabled={!enabled || busy}
                onClick={() => void courseAction("archive")}
                className="button-secondary text-rose-700"
              >
                <Archive className="size-4" />
                下架課程
              </button>
            </div>
            <AdminCurriculumEditor
              detail={selected}
              enabled={enabled && !preview}
              busy={busy}
              setBusy={setBusy}
              reload={() => loadDetail(selected.course.id)}
            />
            <AdminQuizEditor
              detail={selected}
              enabled={enabled && !preview}
              busy={busy}
              setBusy={setBusy}
              reload={() => loadDetail(selected.course.id)}
            />
          </>
        ) : (
          <CreateForm
            busy={busy}
            enabled={enabled && !preview}
            onCreate={createCourse}
          />
        )}
        {message && (
          <p
            role="status"
            className="mt-5 rounded-xl bg-[#FFF8ED] p-4 text-sm font-bold leading-6 text-[#694115]"
          >
            {message}
          </p>
        )}
      </section>
    </div>
  );
}

function CreateForm({
  busy,
  enabled,
  onCreate,
}: {
  busy: boolean;
  enabled: boolean;
  onCreate: (data: FormData) => void;
}) {
  return (
    <form action={onCreate}>
      <div className="flex items-center gap-3">
        <BookPlus className="size-6 text-[#B45309]" />
        <div>
          <h2 className="text-xl font-black text-[#302318]">
            建立錄播或直播課程
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            直播課建立後請到「同步直播場次」排課與建立 Zoom 會議。
          </p>
        </div>
      </div>
      <div className="mt-6 grid gap-4">
        <Field label="課程名稱">
          <input className="field" name="title" required minLength={3} />
        </Field>
        <Field label="課程網址代稱">
          <input
            className="field"
            name="slug"
            required
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            placeholder="infection-control-2026"
          />
        </Field>
        <Field label="簡介">
          <input className="field" name="subtitle" />
        </Field>
        <Field label="授課方式">
          <select className="field" name="delivery" defaultValue="recorded">
            <option value="recorded">錄播課程</option>
            <option value="live">同步直播課程</option>
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="售價">
            <input
              className="field"
              name="priceTwd"
              type="number"
              min="0"
              defaultValue="100"
              required
            />
          </Field>
          <Field label="及格分數">
            <input
              className="field"
              name="passScore"
              type="number"
              min="60"
              max="100"
              defaultValue="80"
              required
            />
          </Field>
        </div>
        <label className="flex min-h-12 items-center gap-3 rounded-xl bg-[#FFF8ED] px-4 text-sm font-black text-[#694115]">
          <input type="checkbox" name="accredited" />
          這是一門正式積分課
        </label>
        <button disabled={!enabled || busy} className="button-primary mt-2">
          {busy && <LoaderCircle className="size-4 animate-spin" />}建立課程草稿
        </button>
      </div>
    </form>
  );
}

function EditForm({
  course,
  busy,
  enabled,
  onSave,
}: {
  course: CourseRow;
  busy: boolean;
  enabled: boolean;
  onSave: (data: FormData) => void;
}) {
  return (
    <form key={course.id} action={onSave}>
      <h2 className="text-xl font-black text-[#302318]">編輯課程設定</h2>
      <p className="mt-1 text-sm text-slate-500">
        正式積分課必須核定完成才能發布。
      </p>
      <div className="mt-6 grid gap-4">
        <Field label="課程名稱">
          <input
            className="field"
            name="title"
            defaultValue={course.title}
            required
          />
        </Field>
        <Field label="簡介">
          <input
            className="field"
            name="subtitle"
            defaultValue={course.subtitle}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="售價">
            <input
              className="field"
              name="price_twd"
              type="number"
              defaultValue={course.price_twd}
            />
          </Field>
          <Field label="及格分數">
            <input
              className="field"
              name="pass_score"
              type="number"
              min="60"
              max="100"
              defaultValue={course.pass_score}
            />
          </Field>
          <Field label="觀看門檻 %">
            <input
              className="field"
              name="completion_percent"
              type="number"
              min="1"
              max="100"
              defaultValue={course.completion_percent}
            />
          </Field>
        </div>
        <label className="flex min-h-12 items-center gap-3 rounded-xl bg-[#FFF8ED] px-4 text-sm font-black text-[#694115]">
          <input
            type="checkbox"
            name="accredited"
            defaultChecked={course.accredited}
          />
          正式積分課
        </label>
        <Field label="主辦單位">
          <input
            className="field"
            name="organizer_name"
            defaultValue={course.organizer_name ?? "歲悅學苑"}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="核定單位">
            <input
              className="field"
              name="accreditation_authority"
              defaultValue={course.accreditation_authority ?? ""}
            />
          </Field>
          <Field label="積分類別">
            <input
              className="field"
              name="accreditation_category"
              defaultValue={course.accreditation_category ?? ""}
            />
          </Field>
        </div>
        <Field label="送審狀態">
          <select
            className="field"
            name="accreditation_status"
            defaultValue={course.accreditation_status}
          >
            <option value="not_submitted">尚未送審</option>
            <option value="preparing">準備中</option>
            <option value="submitted">已送審</option>
            <option value="approved">已核定</option>
            <option value="rejected">未通過</option>
            <option value="expired">已失效</option>
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="核定字號">
            <input
              className="field"
              name="accreditation_number"
              defaultValue={course.accreditation_number ?? ""}
            />
          </Field>
          <Field label="積分數">
            <input
              className="field"
              name="accreditation_points"
              type="number"
              step="0.5"
              min="0"
              defaultValue={course.accreditation_points}
            />
          </Field>
        </div>
        <button disabled={!enabled || busy} className="button-primary">
          儲存設定
        </button>
      </div>
    </form>
  );
}

function AdminCurriculumEditor({
  detail,
  enabled,
  busy,
  setBusy,
  reload,
}: {
  detail: CourseDetail;
  enabled: boolean;
  busy: boolean;
  setBusy: (value: boolean) => void;
  reload: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  async function mutate(payload: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    const response = await fetch(
      `/api/admin/courses/${detail.course.id}/curriculum`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    setBusy(false);
    setMessage(response.ok ? "章節內容已儲存。" : "章節內容儲存失敗。");
    if (response.ok) await reload();
  }
  async function upload(lesson: LessonRow, file: File) {
    setBusy(true);
    setMessage("正在取得安全上傳位置…");
    const start = await fetch("/api/admin/stream/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lessonId: lesson.id,
        filename: file.name,
        sizeBytes: file.size,
        durationSeconds: lesson.duration_seconds,
      }),
    });
    const result = await start.json();
    if (!start.ok) {
      setBusy(false);
      return setMessage("影片上傳初始化失敗。");
    }
    const uploadResponse = await fetch(result.uploadURL, {
      method: "POST",
      body: file,
    });
    setBusy(false);
    setMessage(
      uploadResponse.ok ? "影片已上傳，處理完成後即可發布。" : "影片上傳失敗。",
    );
  }
  async function publish() {
    setBusy(true);
    setMessage("");
    const response = await fetch(
      `/api/admin/courses/${detail.course.id}/publish`,
      { method: "POST" },
    );
    const result = await response.json();
    setBusy(false);
    setMessage(
      response.ok
        ? "課程已發布，可以開始販售。"
        : (result.message ??
            "發布前請確認核定資料、題庫與每個付費單元的影片狀態。"),
    );
    if (response.ok) await reload();
  }
  return (
    <div className="mt-8 border-t border-[#EADFCF] pt-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-black text-[#302318]">章節、單元與影片</h3>
        <button
          type="button"
          onClick={() => void publish()}
          disabled={!enabled || busy}
          className="button-primary min-h-10 px-3 py-2 text-xs"
        >
          發布課程
        </button>
      </div>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void mutate({ action: "add_module", title: form.get("title") });
          event.currentTarget.reset();
        }}
      >
        <input
          className="field"
          name="title"
          placeholder="新增章節名稱"
          required
        />
        <button
          disabled={!enabled || busy}
          className="button-secondary shrink-0"
        >
          新增章節
        </button>
      </form>
      <div className="mt-4 grid gap-4">
        {detail.modules.map((module) => (
          <section
            key={module.id}
            className="rounded-xl border border-[#EADFCF] p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-black text-[#694115]">
                {module.position + 1}. {module.title}
              </p>
              <div className="flex gap-1">
                <button
                  className="button-ghost min-h-11 px-2 py-1 text-xs"
                  onClick={() => {
                    const title = window
                      .prompt("新的章節名稱", module.title)
                      ?.trim();
                    if (title)
                      void mutate({
                        action: "update_module",
                        moduleId: module.id,
                        title,
                      });
                  }}
                  type="button"
                  disabled={!enabled || busy}
                >
                  改名
                </button>
                <button
                  className="button-ghost min-h-11 px-2 py-1 text-xs"
                  onClick={() =>
                    void mutate({
                      action: "move_module",
                      moduleId: module.id,
                      direction: "up",
                    })
                  }
                  type="button"
                  disabled={!enabled || busy}
                >
                  上移
                </button>
                <button
                  className="button-ghost min-h-11 px-2 py-1 text-xs"
                  onClick={() =>
                    void mutate({
                      action: "move_module",
                      moduleId: module.id,
                      direction: "down",
                    })
                  }
                  type="button"
                  disabled={!enabled || busy}
                >
                  下移
                </button>
                <button
                  className="button-ghost min-h-11 px-2 py-1 text-xs text-rose-700"
                  onClick={() => {
                    if (
                      window.confirm(
                        "只可刪除尚未發布且沒有學習紀錄的章節，確定繼續？",
                      )
                    )
                      void mutate({
                        action: "delete_module",
                        moduleId: module.id,
                      });
                  }}
                  type="button"
                  disabled={
                    !enabled || busy || detail.course.status !== "draft"
                  }
                >
                  移除
                </button>
              </div>
            </div>
            <div className="mt-3 grid gap-2">
              {module.lessons.map((lesson) => (
                <div
                  key={lesson.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-[#FFF8ED] p-3 text-sm"
                >
                  <span className="min-w-0 flex-1 font-bold">
                    {lesson.title}
                    <small className="ml-2 text-slate-400">
                      {Math.ceil(lesson.duration_seconds / 60)} 分鐘・
                      {lesson.is_preview ? "試看" : "付費"}
                    </small>
                  </span>
                  <span
                    className={`text-xs font-black ${lesson.active_video_asset_id ? "text-emerald-700" : "text-amber-700"}`}
                  >
                    {lesson.active_video_asset_id ? "影片已就緒" : "尚未上傳"}
                  </span>
                  <button
                    type="button"
                    className="button-ghost min-h-11 px-2 py-2 text-xs"
                    disabled={!enabled || busy}
                    onClick={() => {
                      const title = window
                        .prompt("新的單元名稱", lesson.title)
                        ?.trim();
                      if (!title) return;
                      const duration = Number(
                        window.prompt(
                          "影片秒數",
                          String(lesson.duration_seconds),
                        ),
                      );
                      if (Number.isInteger(duration) && duration > 0)
                        void mutate({
                          action: "update_lesson",
                          lessonId: lesson.id,
                          title,
                          durationSeconds: duration,
                          isPreview: lesson.is_preview,
                        });
                    }}
                  >
                    編輯
                  </button>
                  <button
                    type="button"
                    className="button-ghost min-h-11 px-2 py-2 text-xs"
                    disabled={!enabled || busy}
                    onClick={() =>
                      void mutate({
                        action: "update_lesson",
                        lessonId: lesson.id,
                        title: lesson.title,
                        durationSeconds: lesson.duration_seconds,
                        isPreview: !lesson.is_preview,
                      })
                    }
                  >
                    切換試看
                  </button>
                  <button
                    type="button"
                    disabled={!enabled || busy}
                    onClick={() =>
                      void mutate({
                        action: "move_lesson",
                        lessonId: lesson.id,
                        direction: "up",
                      })
                    }
                    className="button-ghost min-h-11 px-2 py-2 text-xs"
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    disabled={!enabled || busy}
                    onClick={() =>
                      void mutate({
                        action: "move_lesson",
                        lessonId: lesson.id,
                        direction: "down",
                      })
                    }
                    className="button-ghost min-h-11 px-2 py-2 text-xs"
                  >
                    下移
                  </button>
                  <button
                    type="button"
                    disabled={
                      !enabled || busy || detail.course.status !== "draft"
                    }
                    onClick={() => {
                      if (
                        window.confirm(
                          "只可刪除沒有學習紀錄的草稿單元，確定繼續？",
                        )
                      )
                        void mutate({
                          action: "delete_lesson",
                          lessonId: lesson.id,
                        });
                    }}
                    className="button-ghost min-h-11 px-2 py-2 text-xs text-rose-700"
                  >
                    移除
                  </button>
                  <label className="button-secondary min-h-11 cursor-pointer px-3 py-2 text-xs">
                    上傳 MP4
                    <input
                      className="sr-only"
                      type="file"
                      accept="video/mp4"
                      disabled={!enabled || busy}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void upload(lesson, file);
                      }}
                    />
                  </label>
                </div>
              ))}
            </div>
            <form
              className="mt-3 grid gap-2 sm:grid-cols-[1fr_110px_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void mutate({
                  action: "add_lesson",
                  moduleId: module.id,
                  title: form.get("title"),
                  durationSeconds: Number(form.get("durationSeconds")),
                  isPreview: false,
                });
                event.currentTarget.reset();
              }}
            >
              <input
                className="field"
                name="title"
                placeholder="新增單元"
                required
              />
              <input
                className="field"
                name="durationSeconds"
                type="number"
                min="1"
                placeholder="秒數"
                required
              />
              <button disabled={!enabled || busy} className="button-secondary">
                新增單元
              </button>
            </form>
          </section>
        ))}
      </div>
      {message && (
        <p
          role="status"
          className="mt-4 rounded-xl bg-[#FFF8ED] p-3 text-sm font-bold text-[#694115]"
        >
          {message}
        </p>
      )}
    </div>
  );
}

function AdminQuizEditor({
  detail,
  enabled,
  busy,
  setBusy,
  reload,
}: {
  detail: CourseDetail;
  enabled: boolean;
  busy: boolean;
  setBusy: (value: boolean) => void;
  reload: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  async function toggleQuestion(question: QuestionRow) {
    setBusy(true);
    const response = await fetch(
      `/api/admin/courses/${detail.course.id}/quiz/${question.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !question.active }),
      },
    );
    setBusy(false);
    setMessage(
      response.ok
        ? question.active
          ? "題目已封存，不再出現在新測驗中。"
          : "題目已重新啟用。"
        : "題目狀態更新失敗。",
    );
    if (response.ok) await reload();
  }
  async function submit(formData: FormData) {
    setBusy(true);
    setMessage("");
    const correct = Number(formData.get("correct"));
    const labels = [
      String(formData.get("option0")),
      String(formData.get("option1")),
      String(formData.get("option2")),
    ];
    const response = await fetch(
      `/api/admin/courses/${detail.course.id}/quiz`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: formData.get("prompt"),
          explanation: formData.get("explanation"),
          points: Number(formData.get("points")),
          options: labels.map((label, index) => ({
            label,
            isCorrect: index === correct,
          })),
        }),
      },
    );
    setBusy(false);
    setMessage(
      response.ok
        ? "測驗題目已新增，正確答案不會傳給學員前端。"
        : "題目新增失敗，請檢查選項。",
    );
    if (response.ok) await reload();
  }
  const activeQuestions = detail.questions.filter(
    (question) => question.active,
  );
  return (
    <div className="mt-8 border-t border-[#EADFCF] pt-6">
      <div className="flex items-center justify-between">
        <h3 className="font-black text-[#302318]">課後測驗題庫</h3>
        <span className="text-xs font-black text-[#B45309]">
          啟用 {activeQuestions.length} 題・共{" "}
          {activeQuestions.reduce((sum, item) => sum + item.points, 0)} 分
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        {detail.questions.map((question) => (
          <div
            key={question.id}
            className={`flex items-center gap-3 rounded-lg p-3 text-sm font-bold ${question.active ? "bg-[#FFF8ED] text-[#694115]" : "bg-slate-100 text-slate-400"}`}
          >
            <span className="min-w-0 flex-1">
              {question.position + 1}. {question.prompt}
              <span className="ml-2 text-xs">
                {question.points} 分・{question.active ? "啟用" : "已封存"}
              </span>
            </span>
            <button
              type="button"
              disabled={!enabled || busy}
              onClick={() => void toggleQuestion(question)}
              className="button-ghost min-h-10 px-3 py-2 text-xs"
            >
              {question.active ? "封存" : "啟用"}
            </button>
          </div>
        ))}
      </div>
      <form action={submit} className="mt-4 grid gap-3">
        <input
          className="field"
          name="prompt"
          placeholder="題目內容"
          required
        />
        <input
          className="field"
          name="explanation"
          placeholder="答案解析（選填）"
        />
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            className="field"
            name="option0"
            placeholder="選項 A"
            required
          />
          <input
            className="field"
            name="option1"
            placeholder="選項 B"
            required
          />
          <input
            className="field"
            name="option2"
            placeholder="選項 C"
            required
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="正確答案">
            <select className="field" name="correct" defaultValue="0">
              <option value="0">選項 A</option>
              <option value="1">選項 B</option>
              <option value="2">選項 C</option>
            </select>
          </Field>
          <Field label="配分">
            <input
              className="field"
              name="points"
              type="number"
              min="1"
              max="100"
              defaultValue="20"
            />
          </Field>
        </div>
        <button disabled={!enabled || busy} className="button-secondary">
          新增測驗題目
        </button>
      </form>
      {message && (
        <p
          role="status"
          className="mt-4 rounded-xl bg-[#FFF8ED] p-3 text-sm font-bold text-[#694115]"
        >
          {message}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm font-black text-[#57483A]">
      <span>{label}</span>
      {children}
    </label>
  );
}
