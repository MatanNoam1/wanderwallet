import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getActiveTrip, buildSummary, buildPersonBreakdown } from "@/lib/trip";
import { fmt } from "@/lib/money";
import { TopBar } from "@/components/TopBar";

export default async function BreakdownPage() {
  const user = await requireUser();
  const trip = await getActiveTrip(user.id);
  if (!trip) redirect("/");

  const summary = buildSummary(trip);
  const people = buildPersonBreakdown(trip);
  const cur = trip.baseCurrency;

  return (
    <main className="shell">
      <TopBar subtitle="Breakdown" />

      <section className="card">
        <h2 className="card-title">By category</h2>
        {summary.categories.length === 0 ? (
          <p className="muted">No expenses yet.</p>
        ) : (
          <ul className="feed">
            {summary.categories.map((c) => (
              <li key={c.key} className="feed-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span className="feed-icon" style={{ background: c.color + "22" }}>{c.icon}</span>
                    <span className="feed-title">{c.label}</span>
                  </span>
                  <span style={{ textAlign: "right" }}>
                    <span className="feed-amount">{fmt(c.minor, cur)}</span>
                    <span className="muted small"> {Math.round(c.pct)}%</span>
                  </span>
                </div>
                <div style={{ height: "4px", borderRadius: "2px", background: "rgba(255,255,255,0.08)" }}>
                  <div style={{ width: `${c.pct}%`, height: "100%", borderRadius: "2px", background: c.color }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">By person</h2>
        {people.length === 0 ? (
          <p className="muted">No expenses yet.</p>
        ) : (
          <ul className="feed">
            {people.map((p) => (
              <li key={p.name} className="feed-row">
                <div className="feed-main">
                  <div className="feed-title">{p.name}</div>
                  <div className="feed-sub muted">
                    {summary.spentMinor > 0
                      ? `${Math.round((p.minor / summary.spentMinor) * 100)}% of total`
                      : ""}
                  </div>
                </div>
                <div className="feed-amount">{fmt(p.minor, cur)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/" className="btn-ghost" style={{ textAlign: "center", display: "block" }}>
        Back to dashboard
      </Link>
    </main>
  );
}
