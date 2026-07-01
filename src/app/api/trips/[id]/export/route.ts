import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMember } from "@/lib/session";
import { fromMinor, decimalsFor } from "@/lib/money";

function csvCell(value: string | null | undefined): string {
  const s = value ?? "";
  const safe = /^[=+\-@]/.test(s) ? `\t${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let user: { id: string };
  try {
    user = await requireMember(id);
  } catch {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const trip = await prisma.trip.findUnique({
    where: { id },
    select: { name: true, baseCurrency: true },
  });
  if (!trip) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const expenses = await prisma.expense.findMany({
    where: { tripId: id, status: "CONFIRMED" },
    include: {
      paidBy: { select: { name: true } },
      paymentMethod: { select: { label: true } },
    },
    orderBy: { occurredAt: "desc" },
  });

  const cur = trip.baseCurrency;
  const header = [
    "Date",
    "Merchant",
    "Category",
    "Paid By",
    "Payment Method",
    `Amount (${cur})`,
    "Original Amount",
    "Original Currency",
    "FX Rate",
    "Note",
    "Source",
  ].join(",");

  const rows = expenses.map((e) => {
    const baseAmt = fromMinor(e.baseAmountMinor, cur).toFixed(decimalsFor(cur));
    const origDec = decimalsFor(e.originalCurrency);
    const origAmt = fromMinor(e.originalAmountMinor, e.originalCurrency).toFixed(origDec);
    return [
      e.occurredAt.toISOString().slice(0, 10),
      csvCell(e.merchant),
      e.category,
      csvCell(e.paidBy.name),
      csvCell(e.paymentMethod?.label),
      baseAmt,
      origAmt,
      e.originalCurrency,
      e.fxRate?.toFixed(6) ?? "1",
      csvCell(e.note),
      e.source,
    ].join(",");
  });

  const csv = [header, ...rows].join("\n");
  const filename = `${trip.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-expenses.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
