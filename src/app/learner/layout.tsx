import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { readOwnCourseFavorites } from "@/application/course-favorites";
import { readOwnLearnerCart } from "@/application/learner-cart";
import { readMyCoupons } from "@/application/workspace";
import { LearnerPortalShell } from "@/components/learner-portal-shell";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

function maskPhone(phone: string | undefined) {
  if (!phone) return "手機號碼未提供";
  const local = phone.replace(/^\+886/, "0");
  if (!/^09\d{8}$/.test(local)) return "手機號碼已驗證";
  return `${local.slice(0, 4)} *** ${local.slice(-3)}`;
}

export default async function LearnerLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { supabase, user } = await requireUser().catch(() =>
    redirect("/login"),
  );
  const [{ data: professionalProfile }, favorites, coupons, cartResult] =
    await Promise.all([
      supabase
        .from("professional_profiles")
        .select("public_name,avatar_upload_id,updated_at")
        .maybeSingle(),
      readOwnCourseFavorites(supabase).catch(() => []),
      readMyCoupons(supabase, { category: "available", limit: 1 }).catch(
        () => null,
      ),
      readOwnLearnerCart(supabase)
        .then((cart) => ({ available: true, cart }))
        .catch(() => ({
          available: false,
          cart: { items: [], rejectedCourseVersionIds: [] },
        })),
    ]);
  const metadataName =
    typeof user.user_metadata.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : typeof user.user_metadata.name === "string"
        ? user.user_metadata.name.trim()
        : "";

  return (
    <LearnerPortalShell
      identity={{
        accountId: user.id,
        displayName:
          professionalProfile?.public_name || metadataName || "歲悅學員",
        maskedPhone: maskPhone(user.phone),
        phoneVerified: Boolean(user.phone_confirmed_at),
        avatarUrl: professionalProfile?.avatar_upload_id
          ? `/api/profile/media/avatar?v=${encodeURIComponent(
              professionalProfile.updated_at,
            )}`
          : null,
      }}
      availableCouponCount={coupons?.counts.available ?? 0}
      initialCart={cartResult.cart.items}
      initialCartAvailable={cartResult.available}
      initialFavoriteSlugs={favorites.flatMap((favorite) =>
        favorite.slug ? [favorite.slug] : [],
      )}
    >
      {children}
    </LearnerPortalShell>
  );
}
