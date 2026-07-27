import { redirect } from "next/navigation";
import {
  readActiveInstructorOptions,
  readPlatformPrerequisiteOptions,
} from "@/application/workspace";
import { CourseEditor } from "@/components/course-editor";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function CourseEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const { data: authorized } = await supabase.rpc("authorize_staff_action", {
    p_required_role: "course_admin",
    p_action: "staff.course_editor",
    p_target: "course_drafts",
  });
  if (!authorized) redirect("/staff/security");

  let options;
  let instructorOptions;
  try {
    [options, instructorOptions] = await Promise.all([
      readPlatformPrerequisiteOptions(supabase),
      readActiveInstructorOptions(supabase),
    ]);
  } catch {
    return (
      <section className="page-shell shell">
        <p className="eyebrow">課程管理</p>
        <h1>目前無法讀取課程編輯資料</h1>
        <div className="warning-panel">
          <strong>系統維持安全關閉</strong>
          <p>
            正式法務、保存、積分核定或課程草稿投影不可用；網站不會要求你手動貼上資料庫編號。
          </p>
        </div>
      </section>
    );
  }
  const { draft } = await searchParams;
  const selectedDraft =
    options.courseDrafts.find((item) => item.id === draft) ?? null;

  return (
    <section className="page-shell shell">
      <p className="eyebrow">課程管理</p>
      <h1>建立與送審課程</h1>
      <p className="lead">
        依序完成草稿、章節單元、影片、題庫與送審。所有內部識別碼都由系統帶入。
      </p>
      <CourseEditor
        instructorOptions={instructorOptions}
        options={options}
        selectedDraft={selectedDraft}
      />
    </section>
  );
}
