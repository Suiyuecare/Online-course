import Link from "next/link";
import { redirect } from "next/navigation";
import {
  buildOwnProfessionalProfilePageData,
  emptyProfessionalProfile,
  readOwnProfessionalProfile,
} from "@/application/professional-profile";
import { readLearnerCenterRows } from "@/application/learner-center";
import { readInstructorDashboard } from "@/application/workspace";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import { ProfessionalProfileEditor } from "@/components/professional-profile-editor";
import { requireUser } from "@/infrastructure/supabase/server";

export default async function LearnerAccountPage() {
  const { supabase, user } = await requireUser().catch(() =>
    redirect("/login"),
  );
  const metadataName =
    typeof user.user_metadata.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : "";
  const fallbackName = metadataName || "歲悅學員";
  const [rows, profile, instructorDashboard, unreadResult] = await Promise.all([
    readLearnerCenterRows(supabase).catch(() => []),
    readOwnProfessionalProfile(supabase, fallbackName).catch(() =>
      emptyProfessionalProfile(fallbackName),
    ),
    readInstructorDashboard(supabase).catch(() => null),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
  ]);
  const data = buildOwnProfessionalProfilePageData({
    profile,
    learnerRows: rows,
    instructorDashboard,
  });
  const unreadCount = unreadResult.count ?? 0;
  const shortcuts = [
    {
      href: "/learner/favorites",
      icon: "bookmark" as const,
      title: "我的收藏",
      detail: "稍後想看的課程",
    },
    {
      href: "/learner/certificates",
      icon: "certificate" as const,
      title: "結訓證明",
      detail: `${data.certificateCount} 份可查看`,
    },
    {
      href: "/learner/orders",
      icon: "order" as const,
      title: "訂單紀錄",
      detail: "匯款、付款與退款狀態",
    },
    {
      href: "/learner/notifications",
      icon: "notification" as const,
      title: "通知中心",
      detail: unreadCount ? `${unreadCount} 則未讀` : "目前沒有未讀通知",
    },
    {
      href: "/learner/settings",
      icon: "settings" as const,
      title: "帳號設定",
      detail: "閱讀偏好與登入安全",
    },
    {
      href: "/support",
      icon: "support" as const,
      title: "客服中心",
      detail: "登入、付款或上課問題",
    },
  ];

  return (
    <div className="learner-professional-profile-page">
      <div className="learner-portal-shell-width">
        <header className="learner-page-heading professional">
          <div>
            <p className="learner-kicker">個人檔案</p>
            <h1>你的長照專業個人頁</h1>
            <p>
              整理專長與學習成果，自行決定哪些內容可以被分享；正式身分資料仍維持私密。
            </p>
          </div>
        </header>

        <ProfessionalProfileEditor initialData={data} />

        <section
          aria-labelledby="account-tools-title"
          className="learner-account-tools"
        >
          <div className="learner-section-heading">
            <div>
              <p className="learner-kicker">帳號與學習工具</p>
              <h2 id="account-tools-title">其他常用功能</h2>
            </div>
          </div>
          <div className="learner-account-shortcuts">
            {shortcuts.map((item) => (
              <Link href={item.href} key={item.href}>
                <span aria-hidden="true">
                  <LearnerPortalIcon name={item.icon} />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <LearnerPortalIcon name="chevron" size={20} />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
