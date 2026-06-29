import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { toMinor, convertMinor } from "../src/lib/money.ts";

// Dev seed: one active trip, two members, payment methods, and a handful of
// expenses across three currencies so the dashboard, donut, and FX path are all
// exercised. Idempotent: wipes the seeded rows and recreates them.
// Run: npm run seed

const MAYA_EMAIL = "maya@wanderwallet.dev";
const THEO_EMAIL = "theo@wanderwallet.dev";

// Fixed seed FX rates (1 unit -> USD). Real rates come from Frankfurter at runtime.
const RATES: Record<string, number> = { EUR: 1.08, JPY: 0.0064 };

function rate(from: string): number {
  return from === "USD" ? 1 : (RATES[from] ?? 1);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function main() {
  // Clean prior seed (dev only).
  await prisma.expense.deleteMany({});
  await prisma.paymentMethod.deleteMany({});
  await prisma.tripMember.deleteMany({});
  await prisma.trip.deleteMany({});
  await prisma.fxRate.deleteMany({});
  await prisma.user.deleteMany({ where: { email: { in: [MAYA_EMAIL, THEO_EMAIL] } } });

  const maya = await prisma.user.create({
    data: { email: MAYA_EMAIL, name: "Maya" },
  });
  const theo = await prisma.user.create({
    data: { email: THEO_EMAIL, name: "Theo" },
  });

  const visa = await prisma.paymentMethod.create({
    data: { userId: maya.id, label: "Visa ···4242", last4: "4242", kind: "CARD" },
  });
  const amex = await prisma.paymentMethod.create({
    data: { userId: theo.id, label: "Amex ···1009", last4: "1009", kind: "CARD" },
  });
  await prisma.paymentMethod.create({
    data: { userId: maya.id, label: "Apple Pay", kind: "OTHER" },
  });

  const trip = await prisma.trip.create({
    data: {
      name: "USA · August 2026",
      destination: "New York → Los Angeles",
      startDate: new Date(Date.UTC(2026, 7, 5)),
      endDate: new Date(Date.UTC(2026, 7, 19)),
      baseCurrency: "USD",
      budgetMinor: toMinor(8000, "USD"),
      isActive: true,
      ownerId: maya.id,
      members: {
        create: [
          { invitedEmail: MAYA_EMAIL, userId: maya.id, role: "OWNER" },
          { invitedEmail: THEO_EMAIL, userId: theo.id, role: "MEMBER" },
        ],
      },
    },
  });

  // Cache the seed FX rates so runtime math matches the seeded baseAmountMinor.
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  for (const [quote, r] of Object.entries(RATES)) {
    await prisma.fxRate.create({ data: { base: quote, quote: "USD", rate: r, date: today } });
  }

  const rows = [
    { merchant: "JFK → LAX · one-way", category: "FLIGHTS", currency: "USD", amount: 320, payer: maya.id, method: visa.id, occurredAt: daysAgo(0) },
    { merchant: "Ace Hotel · Downtown", category: "HOTELS", currency: "USD", amount: 3500, payer: theo.id, method: amex.id, occurredAt: daysAgo(0) },
    { merchant: "Nobu Malibu · dinner", category: "FOOD", currency: "USD", amount: 186, payer: maya.id, method: visa.id, occurredAt: daysAgo(1) },
    { merchant: "Return flight · booked in EU", category: "FLIGHTS", currency: "EUR", amount: 540, payer: theo.id, method: amex.id, occurredAt: daysAgo(16) },
    { merchant: "Universal Studios · 2 tickets", category: "ACTIVITIES", currency: "USD", amount: 240, payer: theo.id, method: amex.id, occurredAt: daysAgo(17) },
    { merchant: "Vintage store · Brooklyn", category: "SHOPPING", currency: "USD", amount: 95, payer: maya.id, method: visa.id, occurredAt: daysAgo(18) },
    { merchant: "Tokyo-style ramen · Little Tokyo", category: "FOOD", currency: "JPY", amount: 45000, payer: maya.id, method: visa.id, occurredAt: daysAgo(2) },
  ] as const;

  for (const r of rows) {
    const originalAmountMinor = toMinor(r.amount, r.currency);
    const fx = rate(r.currency);
    const baseAmountMinor = convertMinor(originalAmountMinor, r.currency, "USD", fx);
    await prisma.expense.create({
      data: {
        tripId: trip.id,
        paidById: r.payer,
        paymentMethodId: r.method,
        merchant: r.merchant,
        category: r.category as never,
        occurredAt: r.occurredAt,
        originalAmountMinor,
        originalCurrency: r.currency,
        baseAmountMinor,
        fxRate: r.currency === "USD" ? null : fx,
        fxRateDate: r.currency === "USD" ? null : today,
        source: "MANUAL",
        status: "CONFIRMED",
      },
    });
  }

  console.log(`Seeded trip "${trip.name}" with ${rows.length} expenses. Dev user: ${MAYA_EMAIL}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
