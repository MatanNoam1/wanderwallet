import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const CreateBody = z.object({
  label: z.string().trim().min(1).max(40),
  last4: z.string().regex(/^\d{4}$/).optional(),
  kind: z.enum(["CARD", "CASH", "OTHER"]).default("CARD"),
});

export async function GET() {
  const user = await requireUser();
  const methods = await prisma.paymentMethod.findMany({
    where: { userId: user.id, archived: false },
    select: { id: true, label: true, last4: true, kind: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(methods);
}

export async function POST(req: Request) {
  const user = await requireUser();
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { label, last4, kind } = parsed.data;
  const method = await prisma.paymentMethod.create({
    data: { userId: user.id, label, last4: last4 ?? null, kind },
  });
  return NextResponse.json({ id: method.id }, { status: 201 });
}
