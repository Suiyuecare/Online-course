import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AdminEnterpriseManager,
  type EnterpriseAdminCourse,
  type EnterpriseAdminInvoice,
  type EnterpriseAdminOrganization,
  type EnterpriseAdminRefund,
  type EnterpriseAdminTier,
} from "@/components/admin-enterprise-manager";
import {
  EnterpriseAdminOperations,
  type EnterpriseAdminAllocationRow,
  type EnterpriseAdminAuditRow,
  type EnterpriseAdminLiveSessionRow,
  type EnterpriseAdminOrderRow,
  type EnterpriseAdminSeatEventRow,
  type EnterpriseAdminSeatLotRow,
} from "@/components/enterprise-admin-operations";
import { DashboardHeader } from "@/components/site-header";
import {
  createSupabaseAdminClient,
  getPlatformRole,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AdminDbRow = Record<string, unknown>;

async function actionableEnterpriseInvoices(admin: SupabaseClient) {
  const rows: AdminDbRow[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await admin
      .from("invoice_records")
      .select(
        "id,organization_id,order_id,refund_id,record_type,status,amount_twd,invoice_number,allowance_number,allowance_status,allowance_expires_at,allowance_manual_reconciliation_required,attempt_count,error_message,created_at",
      )
      .or(
        "and(record_type.eq.invoice,status.in.(pending,failed)),and(record_type.eq.allowance,allowance_status.in.(none,failed,ambiguous,pending_consent)),allowance_manual_reconciliation_required.eq.true",
      )
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + 499);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as AdminDbRow[]));
    if (!data || data.length < 500) break;
  }
  return rows;
}

async function actionableEnterpriseRefunds(admin: SupabaseClient) {
  const rows: AdminDbRow[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await admin
      .from("refunds")
      .select(
        "id,order_id,amount_twd,status,reason,seat_quantity,created_at",
      )
      .eq("refund_scope", "enterprise_seats")
      .in("status", ["manual_review", "approved"])
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + 499);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as AdminDbRow[]));
    if (!data || data.length < 500) break;
  }
  return rows;
}

export default async function AdminEnterprisePage() {
  const role = await getPlatformRole();
  const preview = !isSupabaseConfigured();
  const staff = role === "admin" || role === "support";
  const admin = staff ? createSupabaseAdminClient() : null;
  let organizations: EnterpriseAdminOrganization[] = [];
  let courses: EnterpriseAdminCourse[] = [];
  let tiers: EnterpriseAdminTier[] = [];
  let invoices: EnterpriseAdminInvoice[] = [];
  let refunds: EnterpriseAdminRefund[] = [];
  let orders: EnterpriseAdminOrderRow[] = [];
  let seatLots: EnterpriseAdminSeatLotRow[] = [];
  let seatEvents: EnterpriseAdminSeatEventRow[] = [];
  let allocations: EnterpriseAdminAllocationRow[] = [];
  let liveSessions: EnterpriseAdminLiveSessionRow[] = [];
  let audits: EnterpriseAdminAuditRow[] = [];
  if (admin) {
    const support = role === "support";
    const actionableRows = support
      ? { invoices: [] as AdminDbRow[], refunds: [] as AdminDbRow[] }
      : await Promise.all([
          actionableEnterpriseInvoices(admin),
          actionableEnterpriseRefunds(admin),
        ]).then(([actionableInvoices, actionableRefunds]) => ({
          invoices: actionableInvoices,
          refunds: actionableRefunds,
        }));
    const [organizationResult, courseResult, tierResult, invoiceResult, refundResult] =
      await Promise.all([
        support
          ? admin
              .from("organizations")
              .select("id,name,status,created_at")
              .order("created_at", { ascending: false })
          : admin
              .from("organizations")
              .select(
                "id,name,tax_id,status,contact_name,contact_phone,invoice_email,review_note,created_at",
              )
              .order("created_at", { ascending: false }),
        admin.from("courses").select("id,title,delivery,status").in("delivery", ["recorded", "live"]).neq("status", "archived").order("title"),
        admin.from("course_price_tiers").select("*").order("course_id").order("min_quantity"),
        support
          ? admin
              .from("invoice_records")
              .select(
                "id,organization_id,order_id,refund_id,record_type,status,allowance_status,allowance_expires_at,allowance_manual_reconciliation_required,attempt_count,created_at",
              )
              .order("created_at", { ascending: false })
              .limit(200)
          : admin
              .from("invoice_records")
              .select(
                "id,organization_id,order_id,refund_id,record_type,status,amount_twd,invoice_number,allowance_number,allowance_status,allowance_expires_at,allowance_manual_reconciliation_required,attempt_count,error_message,created_at",
              )
              .order("created_at", { ascending: false })
              .limit(200),
        support
          ? admin
              .from("refunds")
              .select("id,order_id,status,seat_quantity,created_at")
              .order("created_at", { ascending: false })
              .limit(200)
          : admin
              .from("refunds")
              .select(
                "id,order_id,amount_twd,status,reason,seat_quantity,created_at",
              )
              .order("created_at", { ascending: false })
              .limit(200),
      ]);
    const organizationRows = (organizationResult.data ?? []) as unknown as Array<
      Record<string, unknown>
    >;
    organizations = (support
      ? organizationRows.map((organization) => ({ ...organization, masked: true }))
      : organizationRows) as unknown as EnterpriseAdminOrganization[];
    courses = (courseResult.data ?? []) as EnterpriseAdminCourse[];
    tiers = (tierResult.data ?? []) as EnterpriseAdminTier[];
    const latestInvoiceRows = (invoiceResult.data ?? []) as unknown as Array<
      Record<string, unknown>
    >;
    const latestRefundRows = (refundResult.data ?? []) as unknown as Array<
      Record<string, unknown>
    >;
    const invoiceRows = [
      ...new Map(
        [...latestInvoiceRows, ...actionableRows.invoices].map((row) => [
          String(row.id),
          row,
        ]),
      ).values(),
    ].sort(
      (left, right) =>
        Date.parse(String(right.created_at)) - Date.parse(String(left.created_at)),
    );
    const refundRows = [
      ...new Map(
        [...latestRefundRows, ...actionableRows.refunds].map((row) => [
          String(row.id),
          row,
        ]),
      ).values(),
    ].sort(
      (left, right) =>
        Date.parse(String(right.created_at)) - Date.parse(String(left.created_at)),
    );
    invoices = support
      ? (invoiceRows.map((invoice) => ({
          ...invoice,
          amount_twd: 0,
          masked: true,
        })) as EnterpriseAdminInvoice[])
      : (invoiceRows as unknown as EnterpriseAdminInvoice[]);
    refunds = support
      ? (refundRows.map((refund) => ({
          ...refund,
          amount_twd: 0,
          reason: "內容已遮罩",
          masked: true,
        })) as EnterpriseAdminRefund[])
      : (refundRows as unknown as EnterpriseAdminRefund[]);

    const [orderResult, lotResult, eventResult, allocationResult, sessionResult, auditResult] =
      await Promise.all([
        support
          ? admin
              .from("orders")
              .select("id,organization_id,status,created_at")
              .eq("order_kind", "enterprise_seat_pack")
              .order("created_at", { ascending: false })
              .limit(200)
          : admin
              .from("orders")
              .select(
                "id,organization_id,merchant_trade_no,status,amount_twd,created_at",
              )
              .eq("order_kind", "enterprise_seat_pack")
              .order("created_at", { ascending: false })
              .limit(200),
        support
          ? admin
              .from("enterprise_seat_lots")
              .select("id,organization_id,course_id,status,valid_until,created_at")
              .order("created_at", { ascending: false })
              .limit(200)
          : admin
              .from("enterprise_seat_lots")
              .select(
                "id,organization_id,course_id,total_quantity,available_quantity,status,valid_until,created_at",
              )
              .order("created_at", { ascending: false })
              .limit(200),
        support
          ? admin
              .from("enterprise_seat_events")
              .select("id,organization_id,seat_lot_id,event_type,occurred_at")
              .order("occurred_at", { ascending: false })
              .limit(200)
          : admin
              .from("enterprise_seat_events")
              .select(
                "id,organization_id,seat_lot_id,allocation_id,event_type,quantity,available_delta,occurred_at",
              )
              .order("occurred_at", { ascending: false })
              .limit(200),
        support
          ? Promise.resolve({ data: [], error: null })
          : admin
              .from("enterprise_seat_allocations")
              .select(
                "id,organization_id,course_id,learner_id,live_session_id,status,assigned_at",
              )
              .eq("status", "assigned")
              .order("assigned_at", { ascending: false })
              .limit(200),
        admin
          .from("live_sessions")
          .select("id,course_id,title,starts_at,status")
          .in("status", ["scheduled", "open"])
          .gt("starts_at", new Date().toISOString())
          .order("starts_at")
          .limit(200),
        support
          ? admin
              .from("audit_events")
              .select("id,organization_id,action,target_type,occurred_at")
              .not("organization_id", "is", null)
              .order("id", { ascending: false })
              .limit(200)
          : admin
              .from("audit_events")
              .select(
                "id,organization_id,action,target_type,target_id,occurred_at",
              )
              .not("organization_id", "is", null)
              .order("id", { ascending: false })
              .limit(200),
      ]);
    const orderRows = (orderResult.data ?? []) as unknown as Array<Record<string, unknown>>;
    const lotRows = (lotResult.data ?? []) as unknown as Array<Record<string, unknown>>;
    const eventRows = (eventResult.data ?? []) as unknown as Array<Record<string, unknown>>;
    const auditRows = (auditResult.data ?? []) as unknown as Array<Record<string, unknown>>;
    orders = (support
      ? orderRows.map((row) => ({ ...row, masked: true }))
      : orderRows) as unknown as EnterpriseAdminOrderRow[];
    seatLots = (support
      ? lotRows.map((row) => ({ ...row, masked: true }))
      : lotRows) as unknown as EnterpriseAdminSeatLotRow[];
    seatEvents = (support
      ? eventRows.map((row) => ({ ...row, masked: true }))
      : eventRows) as unknown as EnterpriseAdminSeatEventRow[];
    allocations = (allocationResult.data ?? []) as unknown as EnterpriseAdminAllocationRow[];
    liveSessions = (sessionResult.data ?? []) as unknown as EnterpriseAdminLiveSessionRow[];
    audits = (support
      ? auditRows.map((row) => ({ ...row, masked: true }))
      : auditRows) as unknown as EnterpriseAdminAuditRow[];
  }

  return (
    <div className="min-h-screen bg-[#FFFDF9]">
      <DashboardHeader context="admin" />
      <main className="dashboard-shell">
        <Link
          href="/admin"
          className="inline-flex min-h-11 items-center text-sm font-black text-[#B45309]"
        >
          ← 回到後台首頁
        </Link>
        <div className="mt-5">
          <p className="section-kicker">PHASE FOUR OPERATIONS</p>
          <h1 className="mt-2 text-3xl font-black text-[#302318]">企業與機構管理</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            審核機構、設定課程級距、查看名額與付款、處理開票異常及人工退費。客服只能查看遮罩狀態。
          </p>
        </div>
        {(!staff || preview) && (
          <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm font-bold text-amber-900">
            目前為預覽或無後台權限；不會寫入機構、付款或發票資料。
          </p>
        )}
        <div className="mt-7">
          <AdminEnterpriseManager
            organizations={organizations}
            courses={courses}
            tiers={tiers}
            invoices={invoices}
            refunds={refunds}
            enabled={role === "admin" && !preview}
            readOnly={role !== "admin"}
          />
          <EnterpriseAdminOperations
            orders={orders}
            seatLots={seatLots}
            seatEvents={seatEvents}
            allocations={allocations}
            liveSessions={liveSessions}
            audits={audits}
            organizationNames={Object.fromEntries(
              organizations.map((organization) => [organization.id, organization.name]),
            )}
            courseNames={Object.fromEntries(
              courses.map((course) => [course.id, course.title]),
            )}
            readOnly={role !== "admin" || preview}
          />
        </div>
      </main>
    </div>
  );
}
