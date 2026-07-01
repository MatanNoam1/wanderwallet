import Link from "next/link";
import { fmt } from "@/lib/money";
import { categoryMeta } from "@/lib/categories";
import type { ActiveTrip } from "@/lib/trip";

function when(d: Date): string {
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  if (sameDay) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ExpenseFeed({ trip }: { trip: ActiveTrip }) {
  return (
    <section className="card">
      <h2 className="card-title">Recent expenses</h2>
      {trip.expenses.length === 0 ? (
        <p className="muted">Nothing yet. Add your first expense above.</p>
      ) : (
        <>
          <ul className="feed">
            {trip.expenses.slice(0, 8).map((e) => {
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
                        {e.paidBy.name ?? "?"} · {cat.label} · {when(e.occurredAt)}
                      </div>
                    </div>
                    <div className="feed-amount">
                      {fmt(e.originalAmountMinor, e.originalCurrency)}
                      {e.originalCurrency !== trip.baseCurrency && (
                        <span className="muted small">
                          {" "}
                          ≈ {fmt(e.baseAmountMinor, trip.baseCurrency)}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
