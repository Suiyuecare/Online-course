import { redirect } from "next/navigation";
import {
  readLaunchControlWorkspace,
  readPlatformPrerequisiteOptions,
} from "@/application/workspace";
import { LaunchControlPanel } from "@/components/launch-control-panel";
import { LiveStaffPanel } from "@/components/live-staff-panel";
import { PlatformSetupPanel } from "@/components/platform-setup-panel";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function StaffSetupPage() {
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const { data } = await supabase.rpc("authorize_staff_action", {
    p_required_role: "platform_admin",
    p_action: "staff.platform_setup",
    p_target: "platform",
  });
  if (!data) redirect("/staff/security");
  let options;
  let launchControl: Awaited<
    ReturnType<typeof readLaunchControlWorkspace>
  > | null = null;
  try {
    options = await readPlatformPrerequisiteOptions(supabase);
  } catch {
    return (
      <section className="page-shell shell">
        <p className="eyebrow">平台設定</p>
        <h1>先決資料管理尚未準備完成</h1>
        <div className="warning-panel">
          <strong>乾淨資料庫不會自動假造核准資料</strong>
          <p>
            目前無法讀取法務核准、主辦資格、積分 revision、保存政策與 Zoom
            主持授權；資料恢復前課程會維持不可發布。
          </p>
        </div>
      </section>
    );
  }
  try {
    launchControl = await readLaunchControlWorkspace(supabase);
  } catch {
    // Existing prerequisite authoring remains usable. Launch controls fail
    // closed and never fall back to direct reads of private control tables.
  }
  return (
    <section className="page-shell shell">
      <p className="eyebrow">平台管理員</p>
      <h1>建立正式營運先決資料</h1>
      <p className="lead">
        依序建立主辦／認可單位、保存與法律 revision、Zoom
        主持資源及積分申請資料。每筆資料都由伺服器授權並寫入稽核事件。
      </p>
      {launchControl ? (
        <LaunchControlPanel workspace={launchControl} />
      ) : (
        <div className="warning-panel">
          <strong>正式營運控制台尚未準備完成</strong>
          <p>
            法務、財務、事故負責人、人工匯款帳戶與供應商驗證都會保持未核准；資料庫投影恢復前不提供表級
            fallback。
          </p>
        </div>
      )}
      <PlatformSetupPanel options={options} />
      <LiveStaffPanel
        courseVersions={options.liveCourseVersions}
        hosts={options.zoomHosts}
      />
    </section>
  );
}
