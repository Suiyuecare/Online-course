import { notFound, redirect } from "next/navigation";
import { z } from "zod";

export default async function LegacyOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  if (!z.uuid().safeParse(orderId).success) notFound();
  redirect(`/learner/orders/${orderId}`);
}
