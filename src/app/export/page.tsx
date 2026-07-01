import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getActiveTrip } from "@/lib/trip";
import { TopBar } from "@/components/TopBar";

export default async function ExportPage() {
  const user = await requireUser();
  const trip = await getActiveTrip(user.id);
  if (!trip) redirect("/");

  return (
    <main className="shell">
      <TopBar subtitle="Export" />
      <section className="card">
        <h2 className="card-title">Export trip data</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <a
            href={`/api/trips/${trip.id}/export`}
            className="btn-ghost"
            style={{ textAlign: "center", display: "block" }}
          >
            Download CSV
          </a>
          <Link
            href="/export/print"
            className="btn-ghost"
            style={{ textAlign: "center", display: "block" }}
          >
            Print / Save as PDF
          </Link>
        </div>
      </section>
      <Link href="/" className="btn-ghost" style={{ textAlign: "center", display: "block" }}>
        Back to dashboard
      </Link>
    </main>
  );
}
