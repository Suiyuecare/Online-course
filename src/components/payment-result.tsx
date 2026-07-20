"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, LoaderCircle, ShieldAlert } from "lucide-react";

type State = "checking" | "paid" | "pending" | "error";
type OrderKind = "individual_course" | "enterprise_seat_pack";

type OrderStatusResponse = {
  order?: {
    status?: string;
    order_kind?: OrderKind;
    organization_id?: string | null;
    order_items?: Array<{
      courses?: { slug?: string | null } | null;
    }>;
  };
};

export function PaymentResult({ tradeNo }: { tradeNo?: string }) {
  const [state, setState] = useState<State>(tradeNo ? "checking" : "error");
  const [orderKind, setOrderKind] = useState<OrderKind | null>(null);
  const [courseSlug, setCourseSlug] = useState("dementia-care-pilot");
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  useEffect(() => {
    if (!tradeNo) return;
    let stopped = false;
    let attempt = 0;
    async function check() {
      attempt += 1;
      try {
        const response = await fetch(
          `/api/payments/orders/${encodeURIComponent(tradeNo!)}`,
          { cache: "no-store" },
        );
        const result = (await response.json()) as OrderStatusResponse;
        if (!response.ok) {
          if (!stopped) setState("error");
          return;
        }
        const order = result.order;
        if (
          !order ||
          (order.order_kind !== "individual_course" &&
            order.order_kind !== "enterprise_seat_pack")
        ) {
          if (!stopped) setState("error");
          return;
        }
        if (!stopped) setOrderKind(order.order_kind);
        if (!stopped && order.organization_id)
          setOrganizationId(order.organization_id);
        const relation = order.order_items?.[0]?.courses;
        if (!stopped && relation?.slug) setCourseSlug(relation.slug);
        if (order.status === "paid") {
          if (!stopped) setState("paid");
          return;
        }
        if (attempt < 8) window.setTimeout(check, 1500);
        else if (!stopped) setState("pending");
      } catch {
        if (!stopped) setState("pending");
      }
    }
    check();
    return () => {
      stopped = true;
    };
  }, [tradeNo]);

  const enterpriseOrder = orderKind === "enterprise_seat_pack";
  const content =
    state === "paid"
      ? enterpriseOrder
        ? {
            icon: <CheckCircle2 className="size-9" />,
            color: "bg-emerald-100 text-emerald-700",
            title: "付款通知已確認，企業名額已建立",
            text: "課程名額已加入機構工作台，現在可以邀請員工並進行課程指派。",
          }
        : {
          icon: <CheckCircle2 className="size-9" />,
          color: "bg-emerald-100 text-emerald-700",
          title: "付款通知已確認，課程已開通",
          text: "觀看權限已由伺服器建立，現在可以安全開始上課。",
        }
      : state === "checking"
        ? {
            icon: <LoaderCircle className="size-9 animate-spin" />,
            color: "bg-[#FFF0D5] text-[#B45309]",
            title: "正在確認付款通知",
            text: enterpriseOrder
              ? "綠界返回頁不會直接建立企業名額；我們正在等待伺服器付款通知。"
              : "綠界返回付款頁不會直接解鎖；我們正在等待伺服器通知。",
          }
        : state === "pending"
          ? enterpriseOrder
            ? {
                icon: <Clock3 className="size-9" />,
                color: "bg-amber-100 text-amber-700",
                title: "企業付款結果仍在確認中",
                text: "收到綠界伺服器通知後會自動建立名額，可到機構工作台查看最新狀態。",
              }
            : {
              icon: <Clock3 className="size-9" />,
              color: "bg-amber-100 text-amber-700",
              title: "付款結果仍在確認中",
              text: "可以先回到我的學習，系統收到綠界通知後會自動開課。",
            }
          : {
              icon: <ShieldAlert className="size-9" />,
              color: "bg-rose-100 text-rose-700",
              title: "無法讀取這筆訂單",
              text: "請確認已登入原購買帳號；課程不會因瀏覽器返回頁而誤開權限。",
            };
  return (
    <div className="w-full max-w-xl rounded-3xl border border-[#EADFCF] bg-white p-7 text-center shadow-xl sm:p-10">
      <span
        className={`mx-auto grid size-18 place-items-center rounded-full ${content.color}`}
      >
        {content.icon}
      </span>
      <h1 className="mt-6 text-2xl font-black text-[#302318]">
        {content.title}
      </h1>
      <p className="mt-3 leading-7 text-slate-500">{content.text}</p>
      {tradeNo && (
        <p className="mt-4 text-xs font-bold text-slate-400">
          訂單編號：{tradeNo}
        </p>
      )}
      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        {enterpriseOrder && state !== "error" && (
          <Link
            className="button-primary"
            href={
              organizationId
                ? `/enterprise?organizationId=${encodeURIComponent(organizationId)}`
                : "/enterprise"
            }
          >
            {state === "paid" ? "管理企業名額" : "前往企業工作台"}
          </Link>
        )}
        {!enterpriseOrder && state === "paid" && (
          <Link className="button-primary" href={`/learn/${courseSlug}`}>
            開始上課
          </Link>
        )}
        <Link
          className={
            state === "paid" || (enterpriseOrder && state !== "error")
              ? "button-secondary"
              : "button-primary sm:col-span-2"
          }
          href="/dashboard"
        >
          前往我的學習
        </Link>
      </div>
    </div>
  );
}
