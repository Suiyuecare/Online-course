import { Suspense } from "react";
import { PaymentResult } from "@/components/payment-result";

export default async function CheckoutResultPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center bg-[#FFF8ED] p-5">
      <Suspense>
        <PaymentResult tradeNo={order} />
      </Suspense>
    </main>
  );
}
