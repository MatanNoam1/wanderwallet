import { readFile } from "fs/promises";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { uploadAbsPath } from "@/lib/uploads";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;

  const expense = await prisma.expense.findUnique({
    where: { id },
    select: { tripId: true, imagePath: true },
  });
  if (!expense) return new Response("Not found", { status: 404 });

  const allowed = await prisma.trip.findFirst({
    where: {
      id: expense.tripId,
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    select: { id: true },
  });
  if (!allowed) return new Response("Forbidden", { status: 403 });

  if (!expense.imagePath) return new Response("No image", { status: 404 });

  let buffer: Buffer;
  try {
    buffer = await readFile(uploadAbsPath(expense.imagePath));
  } catch {
    return new Response("Image file missing", { status: 404 });
  }

  const ext = expense.imagePath.split(".").pop() ?? "jpg";
  const contentType = ext === "png" ? "image/png" : "image/jpeg";

  return new Response(new Uint8Array(buffer), { headers: { "Content-Type": contentType } });
}
