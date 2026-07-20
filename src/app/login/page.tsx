import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "登入" };

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-screen place-items-center bg-[#FFF8ED] font-bold text-[#694115]">
          載入登入頁面…
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
