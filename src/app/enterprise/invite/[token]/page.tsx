import { Building2 } from "lucide-react";
import { EnterpriseInviteAccept } from "@/components/enterprise-invite-accept";
import { SiteHeader } from "@/components/site-header";
import {
  hashInvitationToken,
  isInvitationUnexpired,
  isEnterpriseEnabled,
} from "@/lib/enterprise-core";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getAuthenticatedUserId } from "@/lib/supabase/server";

export default async function EnterpriseInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = createSupabaseAdminClient();
  const userId = await getAuthenticatedUserId();
  const { data: invitation } =
    isEnterpriseEnabled() && admin
      ? await admin
          .from("organization_invitations")
          .select("email,invitee_name,status,expires_at,organizations(name)")
          .eq("token_hash", hashInvitationToken(token))
          .maybeSingle()
      : { data: null };
  const organization = Array.isArray(invitation?.organizations)
    ? invitation.organizations[0]
    : invitation?.organizations;
  const valid =
    invitation?.status === "pending" &&
    isInvitationUnexpired(invitation.expires_at);
  return (
    <div className="min-h-screen bg-[#FFF8ED]">
      <SiteHeader />
      <main className="grid min-h-[70vh] place-items-center p-5">
        <section className="panel max-w-xl p-8 text-center sm:p-10">
          <span className="mx-auto grid size-16 place-items-center rounded-full bg-[#FFF0D5] text-[#B45309]">
            <Building2 className="size-8" />
          </span>
          <p className="section-kicker mt-5">ORGANIZATION INVITATION</p>
          <h1 className="mt-2 text-3xl font-black text-[#302318]">
            {valid ? `加入 ${organization?.name ?? "機構"}` : "邀請無法使用"}
          </h1>
          <p className="mt-4 text-sm leading-7 text-slate-500">
            {valid
              ? `請使用 ${invitation.email} 登入。接受後，機構指派的課程會出現在學習中心。`
              : "邀請已過期、被撤銷或企業功能尚未啟用，請聯絡機構管理者。"}
          </p>
          {valid && (
            <EnterpriseInviteAccept token={token} signedIn={Boolean(userId)} />
          )}
        </section>
      </main>
    </div>
  );
}
