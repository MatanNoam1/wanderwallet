import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { toMinor, convertMinor, SUPPORTED_CURRENCIES } from "@/lib/money";
import { getRate } from "@/lib/fx";
import { CATEGORY_KEYS } from "@/lib/categories";
import { sendTelegramReply } from "@/lib/telegram";
import { ExpenseSource, ExpenseStatus, Category } from "@prisma/client";
import { uploadAbsPath } from "@/lib/uploads";
import { unlink } from "fs/promises";

const ItemSchema = z.object({
  name: z.string().min(1).max(200),
  qty: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  total: z.number().nonnegative(),
  category: z.enum(CATEGORY_KEYS as [string, ...string[]]).nullable(),
});

const Body = z.discriminatedUnion("discard", [
  z.object({ discard: z.literal(true) }),
  z.object({
    discard: z.literal(false),
    amount: z.number().positive(),
    currency: z.enum(SUPPORTED_CURRENCIES),
    merchant: z.string().trim().max(120).optional(),
    category: z.enum(CATEGORY_KEYS as [string, ...string[]]),
    note: z.string().trim().max(500).optional(),
    items: z.array(ItemSchema),
  }),
]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { id } = await params;

  const expense = await prisma.expense.findUnique({
    where: { id },
    select: { tripId: true, source: true, status: true, imagePath: true },
  });
  if (!expense) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const trip = await prisma.trip.findFirst({
    where: {
      id: expense.tripId,
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    select: { id: true, baseCurrency: true },
  });
  if (!trip) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  if (expense.status !== ExpenseStatus.NEEDS_REVIEW) {
    return NextResponse.json({ error: "NOT_NEEDS_REVIEW" }, { status: 409 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.discard) {
    await prisma.expense.update({ where: { id }, data: { status: ExpenseStatus.FAILED } });
    if (expense.imagePath) {
      await unlink(uploadAbsPath(expense.imagePath)).catch((err) => {
        console.error(`[confirm] failed to delete discarded upload ${expense.imagePath}:`, err);
      });
    }
    return NextResponse.json({});
  }

  const b = parsed.data;
  const originalAmountMinor = toMinor(b.amount, b.currency);
  const fxRate =
    b.currency !== trip.baseCurrency ? await getRate(b.currency, trip.baseCurrency) : null;
  const baseAmountMinor = fxRate
    ? convertMinor(originalAmountMinor, b.currency, trip.baseCurrency, fxRate)
    : originalAmountMinor;

  await prisma.$transaction(async (tx) => {
    await tx.lineItem.deleteMany({ where: { expenseId: id } });
    if (b.items.length > 0) {
      await tx.lineItem.createMany({
        data: b.items.map((it) => ({
          expenseId: id,
          name: it.name,
          qty: it.qty,
          unitPriceMinor: toMinor(it.unitPrice, b.currency),
          lineTotalMinor: toMinor(it.total, b.currency),
          category: it.category as Category | null,
        })),
      });
    }
    await tx.expense.update({
      where: { id },
      data: {
        originalAmountMinor,
        originalCurrency: b.currency,
        baseAmountMinor,
        fxRate,
        fxRateDate: fxRate ? new Date() : null,
        merchant: b.merchant ?? null,
        category: b.category as Category,
        note: b.note ?? null,
        status: ExpenseStatus.CONFIRMED,
      },
    });
  });

  if (expense.source === ExpenseSource.TELEGRAM_PHOTO) {
    const job = await prisma.job.findUnique({
      where: { expenseId: id },
      select: { payloadJson: true },
    });
    const chatId = job?.payloadJson
      ? (JSON.parse(job.payloadJson) as { chatId?: string }).chatId
      : null;
    if (chatId) {
      sendTelegramReply(
        chatId,
        `Receipt confirmed: ${b.currency} ${b.amount}${b.merchant ? ` - ${b.merchant}` : ""}`
      ).catch(() => {});
    }
  }

  return NextResponse.json({});
}
