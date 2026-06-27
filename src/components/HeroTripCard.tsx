import { fmt } from "@/lib/money";
import type { ActiveTrip, Summary } from "@/lib/trip";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dateRange(start: Date | null, end: Date | null): string {
  if (!start || !end) return "";
  const sm = MONTHS[start.getUTCMonth()];
  const sd = start.getUTCDate();
  const ed = end.getUTCDate();
  const ey = end.getUTCFullYear();
  // Same month -> "Aug 5 - 19, 2026"; else include the end month.
  if (start.getUTCMonth() === end.getUTCMonth()) return `${sm} ${sd} - ${ed}, ${ey}`;
  return `${sm} ${sd} - ${MONTHS[end.getUTCMonth()]} ${ed}, ${ey}`;
}

function days(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  return Math.round((+end - +start) / 86_400_000) + 1;
}

export function HeroTripCard({ trip, summary }: { trip: ActiveTrip; summary: Summary }) {
  const cur = trip.baseCurrency;
  const d = days(trip.startDate, trip.endDate);
  const byId = new Map<string, string>();
  if (trip.owner.name) byId.set(trip.owner.id, trip.owner.name);
  for (const m of trip.members) {
    if (m.user?.name) byId.set(m.user.id, m.user.name);
  }
  const peopleNames = [...byId.values()].join(" & ");

  return (
    <section className="hero">
      <div className="hero-meta">
        <span className="pill-live">● ACTIVE TRIP</span>
        <span className="muted">
          {d ? `${d} days` : ""}
          {peopleNames ? ` · ${peopleNames}` : ""}
        </span>
      </div>

      <h1 className="hero-title">{trip.name}</h1>

      <div className="hero-sub">
        {trip.destination && <span>📍 {trip.destination}</span>}
        {trip.startDate && trip.endDate && (
          <span>🗓 {dateRange(trip.startDate, trip.endDate)}</span>
        )}
      </div>

      <div className="hero-spent">
        <div className="muted small">
          Spent of {fmt(summary.budgetMinor, cur)} budget
        </div>
        <div className="hero-amount">{fmt(summary.spentMinor, cur)}</div>
        <div className="hero-left">{fmt(Math.max(summary.leftMinor, 0), cur)} left</div>
      </div>

      <div className="bar">
        <div
          className="bar-fill"
          style={{ width: `${Math.min(summary.pctUsed, 100)}%` }}
        />
      </div>
      <div className="hero-footer">
        <span>{summary.pctUsed}% of budget used</span>
        <span>{fmt(summary.budgetMinor, cur)}</span>
      </div>
    </section>
  );
}
