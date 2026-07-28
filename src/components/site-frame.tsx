"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

function isClassroomPath(pathname: string): boolean {
  return (
    /^\/learner\/courses\/[^/]+\/?$/.test(pathname) ||
    /^\/courses\/demo\/[^/]+\/classroom\/?$/.test(pathname)
  );
}

export function SiteFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const classroom = isClassroomPath(pathname);

  if (classroom) {
    return <main className="classroom-site-main">{children}</main>;
  }

  return (
    <>
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}
