import Link from "next/link";
import { redirect } from "next/navigation";
import {
  accountCountDetail,
  captureAccountRead,
} from "@/application/learner-account-page";
import {
  buildOwnProfessionalProfilePageData,
  readOwnProfessionalProfile,
} from "@/application/professional-profile";
import { readLearnerCenterRows } from "@/application/learner-center";
import {
  type InstructorDashboard,
  readInstructorDashboard,
  readMyCoupons,
} from "@/application/workspace";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import { ProfessionalProfileEditor } from "@/components/professional-profile-editor";
import { requireUser } from "@/infrastructure/supabase/server";

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

export default async function LearnerAccountPage() {
  const { supabase, user } = await requireUser().catch(() =>
    redirect("/login"),
  );
  const metadataName =
    typeof user.user_metadata.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : "";
  const fallbackName = metadataName || "歲悅學員";
  const [
    learnerRowsState,
    profileState,
    instructorState,
    unreadState,
    couponState,
  ] = await Promise.all([
    captureAccountRead(readLearnerCenterRows(supabase)),
    captureAccountRead(readOwnProfessionalProfile(supabase, fallbackName)),
    captureAccountRead(readOptionalInstructorDashboard(supabase)),
    captureAccountRead(
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null)
        .then(({ count, error }) => {
          if (error || typeof count !== "number") {
            throw new Error("NOTIFICATION_COUNT_UNAVAILABLE");
          }
          return count;
        }),
    ),
    captureAccountRead(
      readMyCoupons(supabase, { category: "available", limit: 1 }),
    ),
  ]);
  const editorAvailable =
    profileState.available &&
    learnerRowsState.available &&
    instructorState.available;
  const data = editorAvailable
    ? buildOwnProfessionalProfilePageData({
        profile: profileState.data,
        learnerRows: learnerRowsState.data,
        instructorDashboard: instructorState.data,
      })
    : null;
  const certificateCount = learnerRowsState.available
    ? learnerRowsState.data.filter(
        (row) =>
          ["completed", "submitted", "credited"].includes(
            row.enrollment_status,
          ) && Boolean(row.certificate_id),
      ).length
    : null;
  const unavailableProfileSources = [
    !profileState.available ? "個人檔案" : null,
    !learnerRowsState.available ? "學習成果與結訓證明" : null,
    !instructorState.available ? "講師與授課資料" : null,
  ].filter((label): label is string => Boolean(label));
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
      detail: accountCountDetail(certificateCount, {
        empty: "目前沒有可查看的證明",
        available: (count) => `${count} 份可查看`,
      }),
    },
    {
      href: "/learner/orders",
      icon: "order" as const,
      title: "訂單紀錄",
      detail: "匯款、付款與退款狀態",
    },
    {
      href: "/learner/discounts",
      icon: "discount" as const,
      title: "我的折扣券",
      detail: accountCountDetail(
        couponState.available ? couponState.data.counts.available : null,
        {
          empty: "目前沒有可用折扣券",
          available: (count) => `${count} 張可使用`,
        },
      ),
    },
    {
      href: "/learner/notifications",
      icon: "notification" as const,
      title: "通知中心",
      detail: accountCountDetail(
        unreadState.available ? unreadState.data : null,
        {
          empty: "目前沒有未讀通知",
          available: (count) => `${count} 則未讀`,
        },
      ),
    },
    {
      href: "/learner/settings",
      icon: "settings" as const,
      title: "帳號設定",
      detail: "閱讀偏好與登入安全",
    },
    {
      href: "/learner/privacy",
      icon: "eye" as const,
      title: "我的資料與帳號權利",
      detail: "查詢、更正、限制利用或停用",
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

        {data ? (
          <ProfessionalProfileEditor initialData={data} />
        ) : (
          <section
            aria-labelledby="professional-profile-unavailable-title"
            className="warning-panel professional-profile-load-warning"
            role="alert"
          >
            <span aria-hidden="true">
              <LearnerPortalIcon name="alert" size={30} />
            </span>
            <div>
              <strong id="professional-profile-unavailable-title">
                目前無法安全讀取完整個人檔案
              </strong>
              <p>
                系統不會用空白內容取代既有資料，也不會在資料不完整時開放編輯。
                請重新讀取；原有檔案與學習成果不會因此消失。
              </p>
              <p>
                暫時無法確認：
                {unavailableProfileSources.join("、")}
              </p>
              <div className="button-row">
                <Link className="button" href="/learner/account">
                  重新讀取
                </Link>
                <Link className="button secondary" href="/support">
                  聯絡客服
                </Link>
              </div>
            </div>
          </section>
        )}

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
