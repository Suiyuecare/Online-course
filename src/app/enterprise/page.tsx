import Link from "next/link";
import { Clock3, LockKeyhole, ShieldAlert } from "lucide-react";
import { EnterpriseApplicationForm } from "@/components/enterprise-application-form";
import {
  EnterpriseFeatureGate,
  EnterpriseWorkspace,
} from "@/components/enterprise-workspace";
import { DashboardHeader } from "@/components/site-header";
import { isEnterpriseEnabled } from "@/lib/enterprise-core";
import {
  getOrganizationContexts,
  organizationContextForClient,
} from "@/lib/enterprise";
import type { OrganizationContext } from "@/lib/enterprise";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function EnterprisePage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string }>;
}) {
  const requestedOrganizationId = (await searchParams).organizationId;
  const enabled = isEnterpriseEnabled();
  const configured = isSupabaseConfigured();
  const userId = enabled && configured ? await getAuthenticatedUserId() : null;
  const admin = userId ? createSupabaseAdminClient() : null;
  let contextLoadFailed = false;
  let contexts: OrganizationContext[] = [];
  if (userId && admin) {
    try {
      contexts = await getOrganizationContexts(admin, userId);
    } catch {
      contextLoadFailed = true;
    }
  }
  const context =
    contexts.find(
      (item) => item.organizationId === requestedOrganizationId,
    ) ?? contexts[0] ?? null;

  if (!enabled)
    return (
      <div className="min-h-screen bg-[#FFF8ED]">
        <DashboardHeader context="enterprise" />
        <main className="grid min-h-[75vh] place-items-center p-5">
          <EnterpriseFeatureGate />
        </main>
      </div>
    );

  return (
    <div className="min-h-screen bg-[#FFFDF9]">
      <DashboardHeader context="enterprise" />
      <main className="dashboard-shell">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="section-kicker">ENTERPRISE TRAINING</p>
            <h1 className="mt-2 text-3xl font-black text-[#302318]">
              企業與機構培訓
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              購買名額、邀請員工、指派課程、追蹤成果與下載機構報表。
            </p>
          </div>
          <Link href="/dashboard" className="button-secondary">
            回到我的學習
          </Link>
        </div>

        {!configured && (
          <StateCard
            icon={<ShieldAlert />}
            title="服務尚未設定"
            text="請先完成 Supabase 連線與第四階段 migration，企業資料才會啟用。"
          />
        )}
        {configured && !userId && (
          <StateCard
            icon={<LockKeyhole />}
            title="請先登入歲悅帳號"
            text="機構管理者與員工都沿用 Email 驗證碼帳號，不需建立另一組企業密碼。"
            action={
              <Link
                className="button-primary mt-5"
                href="/login?next=/enterprise"
              >
                前往登入
              </Link>
            }
          />
        )}
        {configured && userId && contextLoadFailed && (
          <StateCard
            icon={<ShieldAlert />}
            title="機構資料暫時無法載入"
            text="請稍後重試；若持續發生，請確認第四階段 migration 與資料庫連線。"
          />
        )}
        {configured && userId && !contextLoadFailed && !context && (
          <div className="mt-7">
            <EnterpriseApplicationForm />
          </div>
        )}
        {context && contexts.length > 1 && (
          <OrganizationSwitcher contexts={contexts} selectedId={context.organizationId} />
        )}
        {context &&
          (context.organization.status !== "approved" ||
            !context.organization.active) && (
          <StateCard
            icon={<Clock3 />}
            title={
              context.organization.status === "submitted"
                ? "機構申請審核中"
                : context.organization.status === "suspended" ||
                    !context.organization.active
                  ? "機構服務已暫停"
                  : "機構申請未通過"
            }
            text={
              context.organization.status === "submitted"
                ? "首次審核完成後會寄送 Email；通過前不會開放付款或邀請。"
                : "請查看 Email 說明，或聯絡歲悅客服協助處理。"
            }
          />
        )}
        {context &&
          context.organization.status === "approved" &&
          context.organization.active && (
          <div className="mt-7">
            <EnterpriseWorkspace
              initialContext={organizationContextForClient(context)}
            />
          </div>
        )}
      </main>
    </div>
  );
}

function OrganizationSwitcher({
  contexts,
  selectedId,
}: {
  contexts: OrganizationContext[];
  selectedId: string;
}) {
  return (
    <section className="panel mt-7 p-4" aria-label="切換機構">
      <p className="text-xs font-black text-[#8A4800]">我的機構</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {contexts.map((context) => (
          <Link
            key={context.organizationId}
            href={`/enterprise?organizationId=${encodeURIComponent(context.organizationId)}`}
            aria-current={context.organizationId === selectedId ? "page" : undefined}
            className={
              context.organizationId === selectedId
                ? "button-primary"
                : "button-secondary"
            }
          >
            {context.organization.name}
            {(context.organization.status !== "approved" ||
              !context.organization.active) && (
              <span className="ml-1 text-xs opacity-80">
                （{context.organization.active
                  ? organizationStatusLabel(context.organization.status)
                  : "已停權"}）
              </span>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}

function organizationStatusLabel(status: string) {
  if (status === "submitted") return "審核中";
  if (status === "suspended") return "已停權";
  if (status === "rejected") return "未通過";
  return status;
}

function StateCard({
  icon,
  title,
  text,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="panel mx-auto mt-8 max-w-2xl p-8 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-full bg-[#FFF0D5] text-[#B45309]">
        {icon}
      </span>
      <h2 className="mt-5 text-xl font-black text-[#302318]">{title}</h2>
      <p className="mt-3 leading-7 text-slate-500">{text}</p>
      {action}
    </section>
  );
}
