import Link from "next/link";
import { redirect } from "next/navigation";
import { readLearnerCenterRows } from "@/application/learner-center";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import { requireUser } from "@/infrastructure/supabase/server";

function maskedPhone(phone: string | undefined) {
  if (!phone) return "尚未提供";
  const local = phone.replace(/^\+886/, "0");
  return /^09\d{8}$/.test(local)
    ? `${local.slice(0, 4)} *** ${local.slice(-3)}`
    : "已驗證手機";
}

export default async function LearnerAccountPage() {
  const { supabase, user } = await requireUser().catch(() =>
    redirect("/login"),
  );
  const rows = await readLearnerCenterRows(supabase).catch(() => []);
  const { count: unreadCount } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  const metadataName =
    typeof user.user_metadata.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : "";
  const displayName = metadataName || "歲悅學員";
  const completedCount = rows.filter((row) =>
    ["completed", "submitted", "credited"].includes(row.enrollment_status),
  ).length;
  const certificateCount = rows.filter((row) => row.certificate_id).length;

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
      detail: `${certificateCount} 份可查看`,
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
    <section className="learner-portal-page learner-portal-shell-width">
      <header className="learner-page-heading">
        <div>
          <p className="learner-kicker">帳號</p>
          <h1>{displayName}，你好</h1>
          <p>個人購課、課程紀錄與證明都集中在這裡。</p>
        </div>
      </header>
      <div className="learner-account-page-grid">
        <article className="learner-profile-card">
          <div className="learner-profile-avatar" aria-hidden="true">
            {displayName.slice(0, 1)}
          </div>
          <div>
            <span>個人檔案</span>
            <h2>{displayName}</h2>
            <p>{maskedPhone(user.phone)}</p>
          </div>
          <dl>
            <div>
              <dt>登入手機</dt>
              <dd>{user.phone_confirmed_at ? "已驗證" : "待確認"}</dd>
            </div>
            <div>
              <dt>已購／獲派課程</dt>
              <dd>{rows.length} 門</dd>
            </div>
            <div>
              <dt>已完成課程</dt>
              <dd>{completedCount} 門</dd>
            </div>
          </dl>
          <p className="learner-profile-note">
            正式積分課的姓名、長照字號與身分資料會在報名後以加密流程另外確認，不會顯示在一般個人檔案。
          </p>
        </article>
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
      </div>
    </section>
  );
}
