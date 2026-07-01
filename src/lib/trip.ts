import { prisma } from "./prisma";
import { categoryMeta } from "./categories";

// Loads the user's active trip and rolls expenses up into the numbers the
// dashboard renders. All money here is in the trip's BASE currency minor units.

export async function getActiveTrip(userId: string) {
  return prisma.trip.findFirst({
    where: {
      isActive: true,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    include: {
      owner: { select: { id: true, name: true, image: true } },
      members: {
        include: { user: { select: { id: true, name: true, image: true } } },
      },
      expenses: {
        where: { status: "CONFIRMED" },
        orderBy: { occurredAt: "desc" },
        include: {
          paidBy: { select: { id: true, name: true } },
          paymentMethod: { select: { label: true } },
        },
      },
    },
  });
}

export type ActiveTrip = NonNullable<Awaited<ReturnType<typeof getActiveTrip>>>;

export function buildSummary(trip: ActiveTrip) {
  const spentMinor = trip.expenses.reduce((sum, e) => sum + e.baseAmountMinor, 0);
  const budgetMinor = trip.budgetMinor ?? 0;
  const leftMinor = budgetMinor - spentMinor;
  const pctUsed = budgetMinor > 0 ? Math.round((spentMinor / budgetMinor) * 100) : 0;

  // Category breakdown for the donut, biggest first.
  const byCat = new Map<string, number>();
  for (const e of trip.expenses) {
    byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.baseAmountMinor);
  }
  const categories = [...byCat.entries()]
    .map(([key, minor]) => ({
      key,
      minor,
      pct: spentMinor > 0 ? (minor / spentMinor) * 100 : 0,
      ...categoryMeta(key),
    }))
    .sort((a, b) => b.minor - a.minor);

  return { spentMinor, budgetMinor, leftMinor, pctUsed, categories };
}

export type Summary = ReturnType<typeof buildSummary>;

/** Distinct people on the trip (owner + members), de-duplicated by user id. */
export function tripPeople(trip: ActiveTrip) {
  const people = new Map<string, { id: string; name: string | null }>();
  people.set(trip.owner.id, { id: trip.owner.id, name: trip.owner.name });
  for (const m of trip.members) {
    if (m.user) people.set(m.user.id, { id: m.user.id, name: m.user.name });
  }
  return [...people.values()];
}

export async function getPendingExpenses(userId: string) {
  return prisma.expense.findMany({
    where: {
      status: { in: ["PROCESSING", "NEEDS_REVIEW"] },
      trip: {
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
    },
    select: {
      id: true,
      status: true,
      source: true,
      merchant: true,
      category: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}
