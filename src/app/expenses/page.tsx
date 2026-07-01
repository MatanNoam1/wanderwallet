import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getActiveTrip, getFilteredExpenses, tripPeople } from "@/lib/trip";
import { TopBar } from "@/components/TopBar";
import { ExpenseFilters } from "@/components/ExpenseFilters";
import { fmt } from "@/lib/money";
import { categoryMeta } from "@/lib/categories";
import { Suspense } from "react";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; paidBy?: string }>;
}) {
  const user = await requireUser();
  const trip = await getActiveTrip(user.id);
  if (!trip) redirect("/");

  const { category, paidBy } = await searchParams;
  const expenses = await getFilteredExpenses(trip.id, {
    category: category ?? undefined,
    paidById: paidBy ?? undefined,
  });
  const people = tripPeople(trip);

  return (
    <main className="shell">
      <TopBar subtitle="All expenses" />
      <section className="card">
        <h2 className="card-title">
          {expenses.length} expense{expenses.length !== 1 ? "s" : ""}
        </h2>
        <Suspense>
          <ExpenseFilters people={people} />
        </Suspense>
        {expenses.length === 0 ? (
          <p className="muted">No expenses match these filters.</p>
        ) : (
          <ul className="feed">
            {expenses.map((e) => {
              const cat = categoryMeta(e.category);
              return (
                <li key={e.id} className="feed-row">
                  <Link
                    href={`/expenses/${e.id}`}
                    style={{ display: "contents", textDecoration: "none", color: "inherit" }}
                  >
                    <div className="feed-icon" style={{ background: cat.color + "22" }}>
                      {cat.icon}
                    </div>
                    <div className="feed-main">
                      <div className="feed-title">{e.merchant ?? cat.label}</div>
                      <div className="feed-sub muted">
                        {e.paidBy.name ?? "?"} · {cat.label} ·{" "}
                        {new Date(e.occurredAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </div>
                    </div>
                    <div className="feed-amount">
                      {fmt(e.originalAmountMinor, e.originalCurrency)}
                      {e.originalCurrency !== trip.baseCurrency && (
                        <span className="muted small">
                          {" "}= {fmt(e.baseAmountMinor, trip.baseCurrency)}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <Link href="/" className="btn-ghost" style={{ textAlign: "center", display: "block" }}>
        Back to dashboard
      </Link>
    </main>
  );
}
