import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireMember } from "@/lib/session";
import { toMinor, convertMinor, SUPPORTED_CURRENCIES } from "@/lib/money";
import { getRate } from "@/lib/fx";
import { CATEGORY_KEYS } from "@/lib/categories";

// Manual expense entry. FX-converts to the trip's base currency synchronously
// and writes a CONFIRMED expense immediately - no background job. The async
// paths (photo/Telegram) land in P2/P3 and reuse this same Expense shape.

const Body = z.object({
  tripId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.enum(SUPPORTED_CURRENCIES),
  category: z.enum(CATEGORY_KEYS as [string, ...string[]]),
  paidById: z.string().min(1),
  paymentMethodId: z.string().min(1).optional(),
  merchant: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  occurredAt: z.string().datetime().optional(),
});

export async function POST(req: Request) {
  await requireUser();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  // Authorization: caller must be a member of the trip.
  try {
    await requireMember(b.tripId);
  } catch {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const trip = await prisma.trip.findUnique({
    where: { id: b.tripId },
    select: { baseCurrency: true },
  });
  if (!trip) return NextResponse.json({ error: "TRIP_NOT_FOUND" }, { status: 404 });

  // paidBy and paymentMethod must belong to this trip's people.
  const member = await prisma.trip.findFirst({
    where: {
      id: b.tripId,
      OR: [{ ownerId: b.paidById }, { members: { some: { userId: b.paidById } } }],
    },
    select: { id: true },
  });
  if (!member) {
    return NextResponse.json({ error: "PAYER_NOT_IN_TRIP" }, { status: 400 });
  }

  const originalAmountMinor = toMinor(b.amount, b.currency);

  let baseAmountMinor = originalAmountMinor;
  let fxRate: number | null = null;
  let fxRateDate: Date | null = null;
  if (b.currency !== trip.baseCurrency) {
    fxRate = await getRate(b.currency, trip.baseCurrency);
    fxRateDate = new Date();
    baseAmountMinor = convertMinor(
      originalAmountMinor,
      b.currency,
      trip.baseCurrency,
      fxRate,
    );
  }

  const expense = await prisma.expense.create({
    data: {
      tripId: b.tripId,
      paidById: b.paidById,
      paymentMethodId: b.paymentMethodId ?? null,
      merchant: b.merchant ?? null,
      category: b.category as never,
      note: b.note ?? null,
      occurredAt: b.occurredAt ? new Date(b.occurredAt) : new Date(),
      originalAmountMinor,
      originalCurrency: b.currency,
      baseAmountMinor,
      fxRate,
      fxRateDate,
      source: "MANUAL",
      status: "CONFIRMED",
    },
  });

  return NextResponse.json({ id: expense.id }, { status: 201 });
}
