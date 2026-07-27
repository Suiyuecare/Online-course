import { notFound } from "next/navigation";
import { InvitationAccept } from "@/components/invitation-accept";

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) notFound();
  return (
    <section className="page-shell narrow shell">
      <InvitationAccept token={token} />
    </section>
  );
}
