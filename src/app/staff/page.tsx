import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

const queues = [
  {
    title: "課程與影片",
    href: "/staff/courses",
    queue: "courses",
    roles: ["course_admin", "accreditation_reviewer"],
  },
  {
    title: "積分審核與送審",
    href: "/staff/accreditation",
    queue: "accreditation",
    roles: ["accreditation_reviewer"],
  },
  {
    title: "測驗作答作廢覆核",
    href: "/staff/accreditation/quiz-invalidation",
    queue: "quiz-invalidation",
    roles: ["accreditation_reviewer"],
  },
  {
    title: "證明撤銷與問卷調查",
    href: "/staff/quality",
    queue: "quality",
    roles: ["accreditation_reviewer", "platform_admin"],
  },
  {
    title: "匯款、發票與退款",
    href: "/staff/finance",
    queue: "finance",
    roles: ["finance"],
  },
  {
    title: "直播與出席",
    href: "/staff/live",
    queue: "live",
    roles: ["course_admin"],
  },
  {
    title: "客服案件",
    href: "/staff/support",
    queue: "support",
    roles: ["support"],
    exactRole: true,
  },
  {
    title: "機構與點數",
    href: "/staff/organizations",
    queue: "organizations",
    roles: ["platform_admin"],
  },
  {
    title: "供應商與事故",
    href: "/staff/operations",
    queue: "operations",
    roles: ["platform_admin"],
  },
] as const;

export default async function StaffHome() {
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const visibleQueues = (
    await Promise.all(
      queues.map(async (queue) => {
        if ("exactRole" in queue && queue.exactRole) {
          const { data } = await supabase.rpc("authorize_exact_staff_role", {
            p_required_role: queue.roles[0],
          });
          return data === true ? queue : null;
        }
        const authorizations = await Promise.all(
          queue.roles.map((role) =>
            supabase.rpc("authorize_staff_action", {
              p_required_role: role,
              p_action: `staff.queue.${queue.queue}`,
              p_target: queue.queue,
            }),
          ),
        );
        return authorizations.some(({ data }) => data === true) ? queue : null;
      }),
    )
  ).filter((queue) => queue !== null);
  if (visibleQueues.length === 0) {
    const { data: instructor } = await supabase.rpc(
      "authorize_exact_staff_role",
      { p_required_role: "instructor" },
    );
    if (instructor === true) redirect("/instructor");
    redirect("/staff/security");
  }
  return (
    <section className="dashboard-page shell">
      <div className="warning-panel">
        <strong>後台需要手機 OTP＋TOTP AAL2</strong>
        <p>
          敏感操作還要重新完成 TOTP，取得綁定動作、目標與 nonce
          的五分鐘一次性授權。
        </p>
      </div>
      <p className="eyebrow">工作人員後台</p>
      <h1>今天的工作佇列</h1>
      <div className="staff-grid">
        {visibleQueues.map(({ title, href }) => (
          <Link href={href} key={href}>
            <span>查看待辦</span>
            <strong>{title}</strong>
          </Link>
        ))}
      </div>
    </section>
  );
}
