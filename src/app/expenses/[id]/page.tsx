import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { TopBar } from "@/components/TopBar";
import { ExpenseDetail } from "@/components/ExpenseDetail";
import { tripPeople } from "@/lib/trip";

export default async function ExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: {
      paidBy: { select: { id: true, name: true } },
      paymentMethod: { select: { id: true, label: true } },
      items: true,
    },
  });
  if (!expense || expense.status === "PROCESSING") redirect("/");

  const trip = await prisma.trip.findFirst({
    where: {
      id: expense.tripId,
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    include: {
      owner: { select: { id: true, name: true, image: true } },
      members: { include: { user: { select: { id: true, name: true, image: true } } } },
      expenses: { where: { id: "never" } }, // empty - satisfy ActiveTrip type
    },
  });
  if (!trip) redirect("/");

  const people = tripPeople({
    ...trip,
    expenses: [],
  });

  const methods = await prisma.paymentMethod.findMany({
    where: { userId: { in: people.map((p) => p.id) }, archived: false },
    select: { id: true, label: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="shell">
      <TopBar subtitle="Expense" />
      {expense.imagePath && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/expenses/${id}/image`}
          alt="Receipt"
          className="review-img"
        />
      )}
      <ExpenseDetail
        expense={{
          id: expense.id,
          merchant: expense.merchant,
          category: expense.category,
          note: expense.note,
          paidById: expense.paidById,
          paidByName: expense.paidBy.name,
          paymentMethodId: expense.paymentMethod?.id ?? null,
          paymentMethodLabel: expense.paymentMethod?.label ?? null,
          originalAmountMinor: expense.originalAmountMinor,
          originalCurrency: expense.originalCurrency,
          baseAmountMinor: expense.baseAmountMinor,
          baseCurrency: trip.baseCurrency,
          occurredAt: expense.occurredAt.toISOString(),
          items: expense.items.map((li) => ({
            id: li.id,
            description: li.name,
            amountMinor: li.lineTotalMinor,
            currency: expense.originalCurrency,
          })),
        }}
        people={people}
        methods={methods}
      />
    </main>
  );
}
