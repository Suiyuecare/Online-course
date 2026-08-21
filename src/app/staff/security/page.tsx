import { redirect } from "next/navigation";
import { StaffMfaSetup } from "@/components/staff-mfa-setup";
import {
  isProtectedStaffMetadata,
  mustChangeStaffPassword,
} from "@/domain/staff-password";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function StaffSecurityPage() {
  const { user } = await requireUser().catch(() => redirect("/staff/login"));
  if (
    isProtectedStaffMetadata(user.app_metadata) &&
    mustChangeStaffPassword(user.app_metadata)
  ) {
    redirect("/staff/password");
  }
  return (
    <main className="page-shell shell">
      <p className="eyebrow">工作人員安全</p>
      <h1>設定第二階段驗證</h1>
      <StaffMfaSetup />
    </main>
  );
}
