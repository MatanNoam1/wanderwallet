import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getActiveTrip, buildSummary } from "@/lib/trip";
import { fmt } from "@/lib/money";
import { categoryMeta } from "@/lib/categories";
import { PrintButton } from "@/components/PrintButton";

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function PrintPage() {
  const user = await requireUser();
  const trip = await getActiveTrip(user.id);
  if (!trip) redirect("/");

  const summary = buildSummary(trip);
  const cur = trip.baseCurrency;

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; color: #000 !important; }
        }
        body { font-family: system-ui, sans-serif; padding: 24px; max-width: 800px; margin: 0 auto; }
        h1 { font-size: 1.4rem; margin-bottom: 4px; }
        .meta { color: #666; font-size: 0.85rem; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        th { text-align: left; padding: 6px 8px; border-bottom: 2px solid #000; white-space: nowrap; }
        td { padding: 5px 8px; border-bottom: 1px solid #ddd; }
        td.amount { text-align: right; white-space: nowrap; }
        .summary { margin-top: 20px; display: flex; gap: 24px; flex-wrap: wrap; }
        .summary-item { font-size: 0.9rem; }
        .summary-label { color: #666; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
        .summary-value { font-weight: 600; font-size: 1.1rem; }
      `}</style>
      <div className="no-print" style={{ marginBottom: "20px" }}>
        <PrintButton />
      </div>
      <h1>{trip.name}</h1>
      <div className="meta">
        {trip.destination ? `${trip.destination} - ` : ""}
        Generated {shortDate(new Date())}
      </div>

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Merchant</th>
            <th>Category</th>
            <th>Paid By</th>
            <th>Original</th>
            <th>{cur} Amount</th>
          </tr>
        </thead>
        <tbody>
          {trip.expenses.map((e) => (
            <tr key={e.id}>
              <td>{shortDate(e.occurredAt)}</td>
              <td>{e.merchant ?? categoryMeta(e.category).label}</td>
              <td>{categoryMeta(e.category).label}</td>
              <td>{e.paidBy.name ?? "-"}</td>
              <td className="amount">
                {e.originalCurrency !== cur
                  ? fmt(e.originalAmountMinor, e.originalCurrency)
                  : "-"}
              </td>
              <td className="amount">{fmt(e.baseAmountMinor, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="summary">
        <div className="summary-item">
          <div className="summary-label">Total spent</div>
          <div className="summary-value">{fmt(summary.spentMinor, cur)}</div>
        </div>
        {summary.budgetMinor > 0 && (
          <>
            <div className="summary-item">
              <div className="summary-label">Budget</div>
              <div className="summary-value">{fmt(summary.budgetMinor, cur)}</div>
            </div>
            <div className="summary-item">
              <div className="summary-label">Remaining</div>
              <div className="summary-value">{fmt(Math.max(summary.leftMinor, 0), cur)}</div>
            </div>
          </>
        )}
        <div className="summary-item">
          <div className="summary-label">Expenses</div>
          <div className="summary-value">{trip.expenses.length}</div>
        </div>
      </div>
    </>
  );
}
