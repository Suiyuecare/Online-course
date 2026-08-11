import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  buildOwnProfessionalProfilePageData,
  readOwnProfessionalProfile,
} from "@/application/professional-profile";
import { captureAccountRead } from "@/application/learner-account-page";
import { readLearnerCenterRows } from "@/application/learner-center";
import {
  type InstructorDashboard,
  readInstructorDashboard,
} from "@/application/workspace";
import { ProfessionalProfileView } from "@/components/professional-profile-view";
import { requireUser } from "@/infrastructure/supabase/server";

export const metadata: Metadata = {
  title: "預覽個人檔案",
  robots: { index: false, follow: false },
};

async function readOptionalInstructorDashboard(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
): Promise<InstructorDashboard | null> {
  const { data: isInstructor, error } = await supabase.rpc(
    "authorize_exact_staff_role",
    { p_required_role: "instructor" },
  );
  if (error || typeof isInstructor !== "boolean") {
    throw new Error("INSTRUCTOR_ROLE_UNAVAILABLE");
  }
  if (!isInstructor) return null;
  return readInstructorDashboard(supabase);
}

export default async function ProfessionalProfilePreviewPage() {
  const { supabase, user } = await requireUser().catch(() =>
    redirect("/login"),
  );
  const fallbackName =
    typeof user.user_metadata.display_name === "string" &&
    user.user_metadata.display_name.trim()
      ? user.user_metadata.display_name.trim()
      : "歲悅學員";
  const [rowsState, profileState, instructorState] = await Promise.all([
    captureAccountRead(readLearnerCenterRows(supabase)),
    captureAccountRead(readOwnProfessionalProfile(supabase, fallbackName)),
    captureAccountRead(readOptionalInstructorDashboard(supabase)),
  ]);
  if (
    !rowsState.available ||
    !profileState.available ||
    !instructorState.available
  ) {
    return (
      <div className="learner-professional-profile-page preview">
        <div className="learner-portal-shell-width">
          <section
            aria-labelledby="profile-preview-unavailable-title"
            className="warning-panel professional-profile-load-warning"
            role="alert"
          >
            <span aria-hidden="true">!</span>
            <div>
              <h1 id="profile-preview-unavailable-title">
                目前無法安全預覽個人檔案
              </h1>
              <p>
                系統不會用空白資料代替既有內容。請稍後重新整理；若持續發生，再請客服協助。
              </p>
              <div className="button-row">
                <Link className="button" href="/learner/account/preview">
                  重新讀取
                </Link>
                <Link className="button secondary" href="/support">
                  聯絡客服
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  const data = buildOwnProfessionalProfilePageData({
    profile: profileState.data,
    learnerRows: rowsState.data,
    instructorDashboard: instructorState.data,
  });

  return (
    <div className="learner-professional-profile-page preview">
      <div className="learner-portal-shell-width">
        <ProfessionalProfileView data={data} mode="preview" />
      </div>
    </div>
  );
}
