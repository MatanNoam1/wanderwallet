import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { saveUpload } from "@/lib/uploads";
import { ExpenseSource, ExpenseStatus, JobStatus, JobType } from "@prisma/client";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 });
  }

  const file = formData.get("photo") as File | null;
  const tripId = formData.get("tripId") as string | null;

  if (!file || !tripId) {
    return NextResponse.json({ error: "Missing photo or tripId" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 413 });
  }

  const trip = await prisma.trip.findFirst({
    where: {
      id: tripId,
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    select: { id: true, baseCurrency: true },
  });
  if (!trip) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const ext = file.type === "image/png" ? "png" : "jpg";
  const buffer = Buffer.from(await file.arrayBuffer());
  const imagePath = await saveUpload(randomUUID(), buffer, ext);

  const expense = await prisma.expense.create({
    data: {
      tripId,
      paidById: user.id,
      source: ExpenseSource.APP_PHOTO,
      status: ExpenseStatus.PROCESSING,
      originalAmountMinor: 0,
      originalCurrency: trip.baseCurrency,
      baseAmountMinor: 0,
      imagePath,
    },
  });

  await prisma.job.create({
    data: {
      type: JobType.VISION_PARSE,
      expenseId: expense.id,
      status: JobStatus.QUEUED,
      payloadJson: JSON.stringify({ imagePath, tripId, userId: user.id }),
    },
  });

  return NextResponse.json({ expenseId: expense.id }, { status: 201 });
}
