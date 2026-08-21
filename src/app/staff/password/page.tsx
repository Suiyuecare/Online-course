import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StaffPasswordSetup } from "@/components/staff-password-setup";
import {
  isProtectedStaffMetadata,
  mustChangeStaffPassword,
} from "@/domain/staff-password";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "首次設定職員密碼" };

export default async function StaffPasswordPage() {
  const { user } = await requireUser().catch(() => redirect("/staff/login"));
  if (!isProtectedStaffMetadata(user.app_metadata)) redirect("/login");
  if (!mustChangeStaffPassword(user.app_metadata)) redirect("/staff/security");

  return (
    <main className="page-shell narrow shell">
      <p className="eyebrow">第一次登入</p>
      <h1>請先更換臨時密碼</h1>
      <StaffPasswordSetup />
    </main>
  );
}
