"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import {
  LearnerPortalProvider,
  useLearnerPortal,
} from "@/components/learner-portal-store";
import { SignOutButton } from "@/components/sign-out-button";

type LearnerIdentity = {
  accountId: string;
  displayName: string;
  maskedPhone: string;
  phoneVerified: boolean;
  avatarUrl: string | null;
};

function isClassroomPath(pathname: string) {
  return /^\/learner\/courses\/[^/]+\/?$/.test(pathname);
}

function isCurrent(pathname: string, href: string) {
  if (href === "/learner") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function CartBadge() {
  const { cart, hydrated } = useLearnerPortal();
  if (!hydrated || cart.length === 0) return null;
  return (
    <span aria-hidden="true" className="learner-cart-badge">
      {cart.length > 99 ? "99+" : cart.length}
    </span>
  );
}

function AccountDrawer({
  identity,
  mobile = false,
}: {
  identity: Omit<LearnerIdentity, "accountId">;
  mobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function closeDrawer() {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  return (
    <>
      <button
        aria-controls={drawerId}
        aria-expanded={open}
        aria-label="開啟帳號選單"
        className={
          mobile
            ? "learner-mobile-account-trigger"
            : "learner-icon-button learner-avatar-button"
        }
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        {mobile ? (
          <>
            <span>
              <LearnerPortalIcon name="account" />
            </span>
            帳號
          </>
        ) : (
          <span aria-hidden="true">
            {identity.avatarUrl ? (
              <Image
                alt=""
                fill
                sizes="40px"
                src={identity.avatarUrl}
                unoptimized
              />
            ) : (
              identity.displayName.slice(0, 1)
            )}
          </span>
        )}
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            aria-label="帳號選單"
            aria-modal="true"
            className="learner-drawer-layer"
            id={drawerId}
            role="dialog"
          >
            <button
              aria-label="關閉帳號選單"
              className="learner-drawer-backdrop"
              onClick={closeDrawer}
              type="button"
            />
            <aside className="learner-account-drawer" ref={drawerRef}>
              <div className="learner-drawer-topbar">
                <strong>我的帳號</strong>
                <button
                  aria-label="關閉帳號選單"
                  className="learner-icon-button"
                  onClick={closeDrawer}
                  ref={closeRef}
                  type="button"
                >
                  <LearnerPortalIcon name="x" />
                </button>
              </div>
              <Link
                className="learner-account-summary"
                href="/learner/account"
                onClick={closeDrawer}
              >
                <span className="learner-account-avatar" aria-hidden="true">
                  {identity.avatarUrl ? (
                    <Image
                      alt=""
                      fill
                      sizes="64px"
                      src={identity.avatarUrl}
                      unoptimized
                    />
                  ) : (
                    identity.displayName.slice(0, 1)
                  )}
                </span>
                <span>
                  <strong>{identity.displayName}</strong>
                  <small>
                    {identity.maskedPhone}・
                    {identity.phoneVerified ? "手機已驗證" : "待確認"}
                  </small>
                </span>
                <LearnerPortalIcon name="chevron" size={20} />
              </Link>
              <div className="learner-account-progress">
                <span>
                  <LearnerPortalIcon name="certificate" size={22} />
                </span>
                <div>
                  <small>學習與積分進度</small>
                  <strong>查看結訓證明與認列狀態</strong>
                </div>
                <Link href="/learner/certificates" onClick={closeDrawer}>
                  查看
                </Link>
              </div>
              <nav aria-label="帳號功能" className="learner-account-menu">
                <p>學習</p>
                <Link href="/learner/account" onClick={closeDrawer}>
                  <LearnerPortalIcon name="account" />
                  我的專業頁
                </Link>
                <Link href="/learner/favorites" onClick={closeDrawer}>
                  <LearnerPortalIcon name="bookmark" />
                  我的收藏
                </Link>
                <Link href="/learner/certificates" onClick={closeDrawer}>
                  <LearnerPortalIcon name="certificate" />
                  結訓證明
                </Link>
                <Link href="/learner/notifications" onClick={closeDrawer}>
                  <LearnerPortalIcon name="notification" />
                  通知中心
                </Link>
                <p>交易</p>
                <Link href="/learner/orders" onClick={closeDrawer}>
                  <LearnerPortalIcon name="order" />
                  訂單紀錄
                </Link>
                <Link href="/learner/discounts" onClick={closeDrawer}>
                  <LearnerPortalIcon name="discount" />
                  我的優惠
                </Link>
                <p>設定與協助</p>
                <Link href="/learner/settings" onClick={closeDrawer}>
                  <LearnerPortalIcon name="settings" />
                  帳號與個人資料
                </Link>
                <Link href="/support" onClick={closeDrawer}>
                  <LearnerPortalIcon name="support" />
                  客服中心
                </Link>
              </nav>
              <div className="learner-drawer-signout">
                <SignOutButton compact />
              </div>
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}

function PortalChrome({
  children,
  identity,
}: {
  children: ReactNode;
  identity: LearnerIdentity;
}) {
  const pathname = usePathname();
  const { cart, hydrated } = useLearnerPortal();

  if (isClassroomPath(pathname)) return children;

  const cartLabel = hydrated ? `購物車，${cart.length} 門課程` : "購物車";
  const navItems = [
    {
      href: "/learner/catalog",
      label: "課程總覽",
      icon: "search" as const,
    },
    {
      href: "/learner",
      label: "我的課程",
      icon: "book" as const,
    },
  ];

  return (
    <div className="learner-portal">
      <header className="learner-portal-header">
        <div className="learner-portal-header-inner">
          <Link
            aria-label="歲悅學苑學員首頁"
            className="learner-portal-brand"
            href="/learner"
          >
            <Image
              alt=""
              height={44}
              priority
              src="/suiyue-milk.png"
              width={44}
            />
            <span>
              <strong>歲悅學苑</strong>
              <small>我的學習中心</small>
            </span>
          </Link>
          <nav aria-label="學員主要選單" className="learner-desktop-nav">
            {navItems.map((item) => (
              <Link
                aria-current={
                  isCurrent(pathname, item.href) ? "page" : undefined
                }
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="learner-header-actions">
            <Link
              aria-label="搜尋課程"
              className="learner-icon-button learner-search-button"
              href="/learner/catalog#course-search"
            >
              <LearnerPortalIcon name="search" />
            </Link>
            <Link
              aria-current={
                isCurrent(pathname, "/learner/cart") ? "page" : undefined
              }
              aria-label={cartLabel}
              className="learner-icon-button learner-cart-button"
              href="/learner/cart"
            >
              <LearnerPortalIcon name="cart" />
              <CartBadge />
            </Link>
            <AccountDrawer identity={identity} />
          </div>
        </div>
      </header>
      <main className="learner-portal-main">{children}</main>
      <nav aria-label="學員手機選單" className="learner-mobile-nav">
        {[
          ...navItems,
          {
            href: "/learner/cart",
            label: "購物車",
            icon: "cart" as const,
          },
        ].map((item) => (
          <Link
            aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
            aria-label={item.href === "/learner/cart" ? cartLabel : item.label}
            href={item.href}
            key={item.href}
          >
            <span>
              <LearnerPortalIcon name={item.icon} />
              {item.href === "/learner/cart" && <CartBadge />}
            </span>
            {item.label}
          </Link>
        ))}
        <AccountDrawer identity={identity} mobile />
      </nav>
    </div>
  );
}

export function LearnerPortalShell({
  children,
  identity,
  initialFavoriteSlugs,
}: {
  children: ReactNode;
  identity: LearnerIdentity;
  initialFavoriteSlugs: string[];
}) {
  return (
    <LearnerPortalProvider
      accountId={identity.accountId}
      initialFavoriteSlugs={initialFavoriteSlugs}
    >
      <PortalChrome identity={identity}>{children}</PortalChrome>
    </LearnerPortalProvider>
  );
}
