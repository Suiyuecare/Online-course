import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  learnerCouponCategorySchema,
  readMyCoupons,
} from "@/application/workspace";
import { LearnerCouponWalletView } from "@/components/learner-coupon-wallet";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "我的折扣券" };

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LearnerDiscountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const parsedCategory = learnerCouponCategorySchema.safeParse(
    single(query.category) ?? "available",
  );
  const category = parsedCategory.success ? parsedCategory.data : "available";
  const beforeAt = single(query.beforeAt);
  const beforeId = single(query.beforeId);
  const validBefore =
    beforeAt &&
    Number.isFinite(Date.parse(beforeAt)) &&
    beforeId &&
    z.uuid().safeParse(beforeId).success
      ? { claimedAt: beforeAt, claimId: beforeId }
      : null;
  const { supabase } = await requireUser().catch(() => redirect("/login"));
  const wallet = await readMyCoupons(supabase, {
    category,
    limit: 12,
    before: validBefore,
  }).catch(() => null);

  if (!wallet) {
    return (
      <section className="learner-order-unavailable learner-portal-shell-width">
        <span aria-hidden="true">
          <LearnerPortalIcon name="discount" size={40} />
        </span>
        <p className="learner-kicker">我的折扣券</p>
        <h1>目前無法安全讀取折扣券</h1>
        <p>系統不會用示範資料代替。請稍後重新讀取，已領取的券不會消失。</p>
        <div>
          <Link className="button" href="/learner/discounts">
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
    <LearnerCouponWalletView
      activeCategory={category}
      paginated={Boolean(validBefore)}
      wallet={wallet}
    />
  );
}
