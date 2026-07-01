import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getActiveTrip, buildSummary, tripPeople, getPendingExpenses } from "@/lib/trip";
import { TopBar } from "@/components/TopBar";
import { HeroTripCard } from "@/components/HeroTripCard";
import { QuickAdd } from "@/components/QuickAdd";
import { PhotoAdd } from "@/components/PhotoAdd";
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
  const pending = await getPendingExpenses(user.id);

  return (
    <main className="shell">
      <TopBar subtitle="Shared trip account" />
      <HeroTripCard trip={trip} summary={summary} />
      <QuickAdd tripId={trip.id} people={people} methods={methods} />
      <PhotoAdd tripId={trip.id} />
      {pending.length > 0 && (
        <section className="card">
          <h2 className="card-title">Needs review ({pending.length})</h2>
          <ul className="feed">
            {pending.map((e) => (
              <li key={e.id} className="feed-row">
                <div className="feed-main">
                  <div className="feed-title">{e.merchant ?? e.category}</div>
                  <div className="feed-sub muted">
                    {e.status === "PROCESSING" ? "Processing..." : "Tap to review"}
                  </div>
                </div>
                {e.status === "NEEDS_REVIEW" && (
                  <Link
                    href={`/expenses/${e.id}/review`}
                    className="btn-ghost"
                    style={{ fontSize: "0.82rem" }}
                  >
                    Review
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <SpendingDonut summary={summary} currency={trip.baseCurrency} />
      <Link href="/breakdown" className="btn-ghost" style={{ textAlign: "center", display: "block" }}>
        See full breakdown
      </Link>
      <ExpenseFeed trip={trip} />
      <Link href="/expenses" className="btn-ghost" style={{ textAlign: "center", display: "block" }}>
        View all expenses
      </Link>
    </main>
  );
}
