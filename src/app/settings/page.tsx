import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { TopBar } from "@/components/TopBar";
import { PaymentMethodManager } from "@/components/PaymentMethodManager";

export default async function SettingsPage() {
  const user = await requireUser();

  const methods = await prisma.paymentMethod.findMany({
    where: { userId: user.id, archived: false },
    select: { id: true, label: true, last4: true, kind: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="shell">
      <TopBar subtitle="Settings" />
      <section className="card">
        <h2 className="card-title">Payment methods</h2>
        <PaymentMethodManager initial={methods} />
      </section>
    </main>
  );
}
