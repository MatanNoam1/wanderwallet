import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getActiveTrip, buildSummary, tripPeople } from "@/lib/trip";
import { TopBar } from "@/components/TopBar";
import { HeroTripCard } from "@/components/HeroTripCard";
import { QuickAdd } from "@/components/QuickAdd";
import { SpendingDonut } from "@/components/SpendingDonut";
import { ExpenseFeed } from "@/components/ExpenseFeed";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="shell">
        <p className="muted">
          You are signed out. <Link href="/login">Sign in</Link> to see your trips.
        </p>
      </main>
    );
  }

  const trip = await getActiveTrip(user.id);
  if (!trip) {
    return (
      <main className="shell">
        <TopBar subtitle="No active trip" />
        <section className="card">
          <p className="muted">No active trip yet. Seed one or create a trip.</p>
        </section>
      </main>
    );
  }

  const summary = buildSummary(trip);
  const people = tripPeople(trip);
  const methods = await prisma.paymentMethod.findMany({
    where: { userId: { in: people.map((p) => p.id) }, archived: false },
    select: { id: true, label: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="shell">
      <TopBar subtitle="Shared trip account" />
      <HeroTripCard trip={trip} summary={summary} />
      <QuickAdd tripId={trip.id} people={people} methods={methods} />
      <SpendingDonut summary={summary} currency={trip.baseCurrency} />
      <ExpenseFeed trip={trip} />
    </main>
  );
}
