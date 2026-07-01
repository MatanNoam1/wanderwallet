import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireMember } from "@/lib/session";
import { CATEGORY_KEYS } from "@/lib/categories";

const PatchBody = z.object({
  merchant: z.string().trim().max(120).optional(),
  category: z.enum(CATEGORY_KEYS as [string, ...string[]]).optional(),
  note: z.string().trim().max(500).optional(),
  paidById: z.string().min(1).optional(),
  paymentMethodId: z.string().min(1).nullable().optional(),
});

async function resolveExpense(id: string, userId: string) {
  const expense = await prisma.expense.findUnique({
    where: { id },
    select: { id: true, tripId: true },
  });
  if (!expense) return null;
  try {
    await requireMember(expense.tripId);
  } catch {
    return null;
  }
  return expense;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  const { id } = await params;

  const expense = await resolveExpense(id, user.id);
  if (!expense) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.merchant !== undefined) data.merchant = parsed.data.merchant || null;
  if (parsed.data.category !== undefined) data.category = parsed.data.category;
  if (parsed.data.note !== undefined) data.note = parsed.data.note || null;
  if (parsed.data.paidById !== undefined) data.paidById = parsed.data.paidById;
  if (parsed.data.paymentMethodId !== undefined) data.paymentMethodId = parsed.data.paymentMethodId;

  const updated = await prisma.expense.update({ where: { id }, data });
  return NextResponse.json({ id: updated.id });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  const { id } = await params;

  const expense = await resolveExpense(id, user.id);
  if (!expense) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  await prisma.expense.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
