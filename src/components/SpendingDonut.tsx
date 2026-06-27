import { fmt } from "@/lib/money";
import type { Summary } from "@/lib/trip";

// Pure-CSS donut via a conic-gradient ring - no chart library. Each category
// gets an arc sized by its share of total spend.
export function SpendingDonut({
  summary,
  currency,
}: {
  summary: Summary;
  currency: string;
}) {
  if (summary.categories.length === 0) {
    return (
      <section className="card">
        <h2 className="card-title">Spending</h2>
        <p className="muted">No expenses yet.</p>
      </section>
    );
  }

  const { stops } = summary.categories.reduce(
    (state, c) => {
      const to = state.acc + c.pct;
      state.stops.push(`${c.color} ${state.acc}% ${to}%`);
      return { acc: to, stops: state.stops };
    },
    { acc: 0, stops: [] as string[] },
  );

  return (
    <section className="card">
      <h2 className="card-title">Spending by category</h2>
      <div className="donut-wrap">
        <div
          className="donut"
          style={{ background: `conic-gradient(${stops.join(", ")})` }}
          role="img"
          aria-label="Spending breakdown by category"
        >
          <div className="donut-hole">
            <span className="muted small">Total</span>
            <strong>{fmt(summary.spentMinor, currency)}</strong>
          </div>
        </div>
        <ul className="legend">
          {summary.categories.map((c) => (
            <li key={c.key}>
              <span className="legend-dot" style={{ background: c.color }} />
              <span className="legend-label">
                {c.icon} {c.label}
              </span>
              <span className="legend-val">
                {fmt(c.minor, currency)} · {Math.round(c.pct)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
