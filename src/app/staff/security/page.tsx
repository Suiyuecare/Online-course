import { redirect } from "next/navigation";
import { StaffMfaSetup } from "@/components/staff-mfa-setup";
import { requireUser } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

export default async function StaffSecurityPage() {
  await requireUser().catch(() => redirect("/login"));
  return (
    <main className="page-shell shell">
      <p className="eyebrow">工作人員安全</p>
      <h1>設定第二階段驗證</h1>
      <StaffMfaSetup />
    </main>
  );
}
