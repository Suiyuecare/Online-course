import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  buildOwnProfessionalProfilePageData,
  emptyProfessionalProfile,
  readOwnProfessionalProfile,
} from "@/application/professional-profile";
import { readLearnerCenterRows } from "@/application/learner-center";
import { readInstructorDashboard } from "@/application/workspace";
import { ProfessionalProfileView } from "@/components/professional-profile-view";
import { requireUser } from "@/infrastructure/supabase/server";

export const metadata: Metadata = {
  title: "預覽個人檔案",
  robots: { index: false, follow: false },
};

export default async function ProfessionalProfilePreviewPage() {
  const { supabase, user } = await requireUser().catch(() =>
    redirect("/login"),
  );
  const fallbackName =
    typeof user.user_metadata.display_name === "string" &&
    user.user_metadata.display_name.trim()
      ? user.user_metadata.display_name.trim()
      : "歲悅學員";
  const [rows, profile, instructorDashboard] = await Promise.all([
    readLearnerCenterRows(supabase).catch(() => []),
    readOwnProfessionalProfile(supabase, fallbackName).catch(() =>
      emptyProfessionalProfile(fallbackName),
    ),
    readInstructorDashboard(supabase).catch(() => null),
  ]);
  const data = buildOwnProfessionalProfilePageData({
    profile,
    learnerRows: rows,
    instructorDashboard,
  });

  return (
    <div className="learner-professional-profile-page preview">
      <div className="learner-portal-shell-width">
        <ProfessionalProfileView data={data} mode="preview" />
      </div>
    </div>
  );
}
