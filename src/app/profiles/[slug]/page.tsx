import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { readPublicProfessionalProfile } from "@/application/professional-profile";
import { ProfessionalProfileView } from "@/components/professional-profile-view";
import { serviceSupabase } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

const getProfile = cache(async (slug: string) =>
  readPublicProfessionalProfile(serviceSupabase(), slug).catch(() => null),
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const profile = await getProfile((await params).slug);
  if (!profile) return { title: "找不到個人檔案" };
  return {
    title: `${profile.profile.publicName}的專業個人頁`,
    description:
      profile.profile.headline || "在歲悅學苑累積長照專業知識與持續學習成果。",
    robots: { index: false, follow: false },
  };
}

export default async function PublicProfessionalProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const profile = await getProfile((await params).slug);
  if (!profile) notFound();

  return (
    <div className="public-professional-profile-page">
      <div className="shell">
        <ProfessionalProfileView data={profile} mode="public" />
      </div>
    </div>
  );
}
