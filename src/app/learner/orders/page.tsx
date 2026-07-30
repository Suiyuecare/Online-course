import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  learnerOrderHistoryCategorySchema,
  readOwnOrderHistory,
} from "@/application/workspace";
import { LearnerOrderHistoryView } from "@/components/learner-order-history";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "訂單紀錄" };

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LearnerOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const parsedCategory = learnerOrderHistoryCategorySchema.safeParse(
    single(query.category) ?? "all",
  );
  const category = parsedCategory.success ? parsedCategory.data : "all";
  const beforeAt = single(query.beforeAt);
  const beforeId = single(query.beforeId);
  const validBefore =
    beforeAt &&
    Number.isFinite(Date.parse(beforeAt)) &&
    beforeId &&
    z.uuid().safeParse(beforeId).success
      ? { createdAt: beforeAt, orderId: beforeId }
      : null;

  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const history = await readOwnOrderHistory(supabase, {
    category,
    limit: 12,
    before: validBefore,
  }).catch(() => null);

  if (!history) {
    return (
      <section className="learner-order-unavailable learner-portal-shell-width">
        <span aria-hidden="true">
          <LearnerPortalIcon name="order" size={40} />
        </span>
        <p className="learner-kicker">訂單紀錄</p>
        <h1>目前無法安全讀取訂單</h1>
        <p>
          系統不會改用管理員權限或示範資料代替。請稍後重新整理，原有訂單不會因此消失。
        </p>
        <div>
          <Link className="button" href="/learner/orders">
            重新讀取
          </Link>
          <Link className="button secondary" href="/support">
            聯絡客服
          </Link>
        </div>
      </section>
    );
  }

  return (
    <LearnerOrderHistoryView
      activeCategory={category}
      history={history}
      paginated={Boolean(validBefore)}
    />
  );
}
