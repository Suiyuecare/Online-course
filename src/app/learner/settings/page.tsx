import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readOwnLearnerAccountSettings } from "@/application/learner-account-settings";
import {
  AccountSettingsCenter,
  type LearnerAccountSettingsModel,
} from "@/components/account-settings-center";
import { requireUser } from "@/infrastructure/supabase/server";

export const metadata: Metadata = { title: "帳號與個人資料" };

function maskPhone(phone: string | undefined) {
  if (!phone) return "尚未提供手機號碼";
  const local = phone.replace(/^\+886/, "0");
  if (!/^09\d{8}$/.test(local)) return "手機號碼已受保護";
  return `${local.slice(0, 4)} *** ${local.slice(-3)}`;
}

export default async function LearnerSettingsPage() {
  const { supabase, user } = await requireUser().catch(() =>
    redirect("/login"),
  );
  const metadataName =
    typeof user.user_metadata.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : typeof user.user_metadata.name === "string"
        ? user.user_metadata.name.trim()
        : "";
  const fallbackName = metadataName || "歲悅學員";

  let initialSettings: LearnerAccountSettingsModel;
  try {
    const [profileResult, settings] = await Promise.all([
      supabase
        .from("professional_profiles")
        .select("public_name,avatar_upload_id,updated_at")
        .maybeSingle(),
      readOwnLearnerAccountSettings(supabase, {
        accountId: user.id,
        displayName: fallbackName,
        avatarUrl: null,
        maskedPhone: maskPhone(user.phone),
        phoneVerified: Boolean(user.phone_confirmed_at),
      }),
    ]);
    const professionalProfile = profileResult.data;
    initialSettings = {
      ...settings,
      displayName: professionalProfile?.public_name || fallbackName,
      avatarUrl: professionalProfile?.avatar_upload_id
        ? `/api/profile/media/avatar?v=${encodeURIComponent(
            professionalProfile.updated_at,
          )}`
        : null,
      maskedPhone: settings.maskedPhone ?? "尚未提供手機號碼",
      verifiedEmail: settings.verifiedEmail ?? "",
      birthDate: settings.birthDate ?? "",
    };
  } catch {
    return (
      <section className="learner-portal-page learner-portal-shell-width learner-narrow-page">
        <div className="learner-settings-unavailable">
          <p className="learner-kicker">帳號與個人資料</p>
          <h1>目前無法安全讀取帳號資料</h1>
          <p>
            為避免用空白內容覆蓋既有設定，這次不會開啟編輯表單。請稍後重新整理；若持續發生，再請客服協助。
          </p>
          <div>
            <Link className="button" href="/learner/settings">
              重新整理
            </Link>
            <Link className="button secondary" href="/support">
              聯絡客服
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return <AccountSettingsCenter initialSettings={initialSettings} />;
}
