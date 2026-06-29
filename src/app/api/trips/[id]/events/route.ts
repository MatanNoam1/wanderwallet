import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { tripEmitter } from "@/lib/emitter";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id: tripId } = await params;

  const allowed = await prisma.trip.findFirst({
    where: {
      id: tripId,
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    select: { id: true },
  });
  if (!allowed) return new Response("Forbidden", { status: 403 });

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();

      const send = (event: string, data: string) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          // client already gone
        }
      };

      send("connected", JSON.stringify({ tripId }));

      const onExpense = (expenseId: string) =>
        send("expense", JSON.stringify({ expenseId }));

      tripEmitter.on(`expense:${tripId}`, onExpense);
      const heartbeat = setInterval(() => send("ping", "{}"), 30_000);

      cleanup = () => {
        clearInterval(heartbeat);
        tripEmitter.off(`expense:${tripId}`, onExpense);
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
