import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { ReviewForm } from "./ReviewForm";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!expense || expense.status !== "NEEDS_REVIEW") redirect("/");

  const trip = await prisma.trip.findFirst({
    where: {
      id: expense.tripId,
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    select: { baseCurrency: true },
  });
  if (!trip) redirect("/");

  return (
    <main className="shell">
      <h1 style={{ fontSize: "1.2rem", fontWeight: 700 }}>Review receipt</h1>
      {expense.imagePath && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/expenses/${id}/image`}
          alt="Receipt"
          className="review-img"
        />
      )}
      <ReviewForm expense={expense} baseCurrency={trip.baseCurrency} />
    </main>
  );
}
