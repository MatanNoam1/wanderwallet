import { prisma } from "@/lib/prisma";
import { ExpenseSource, ExpenseStatus, JobStatus, JobType } from "@prisma/client";
import { sendTelegramReply } from "@/lib/telegram";

export const runtime = "nodejs";

// ---------- Telegram types (only fields we use) ----------
interface TgUser {
  id: number;
}

interface TgChat {
  id: number;
}

interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

// ---------- Handlers ----------
async function handleLink(chatId: number, code: string) {
  const linkCode = await prisma.telegramLinkCode.findUnique({ where: { code } });

  if (!linkCode || linkCode.expiresAt < new Date()) {
    await sendTelegramReply(String(chatId), "Code not found or expired. Generate a new one in the app.");
    return;
  }

  await prisma.$transaction([
    prisma.telegramLink.upsert({
      where: { userId: linkCode.userId },
      create: { userId: linkCode.userId, chatId: String(chatId) },
      update: { chatId: String(chatId) },
    }),
    prisma.telegramLinkCode.delete({ where: { code } }),
  ]);

  await sendTelegramReply(String(chatId), "Linked! Send me an expense like \"$24 lunch\" and I'll add it.");
}

async function handleText(chatId: number, text: string) {
  const link = await prisma.telegramLink.findUnique({
    where: { chatId: String(chatId) },
  });

  if (!link) {
    await sendTelegramReply(String(chatId), "Not linked yet. Open Wanderwallet -> Settings -> Link Telegram.");
    return;
  }

  const activeTrip = await prisma.trip.findFirst({
    where: {
      isActive: true,
      OR: [
        { ownerId: link.userId },
        { members: { some: { userId: link.userId } } },
      ],
    },
    select: { id: true, baseCurrency: true },
  });

  if (!activeTrip) {
    await sendTelegramReply(String(chatId), "No active trip found. Start a trip in the app first.");
    return;
  }

  // Create PROCESSING expense + TEXT_PARSE job in one transaction
  const { expense } = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        tripId: activeTrip.id,
        paidById: link.userId,
        source: ExpenseSource.TELEGRAM_TEXT,
        status: ExpenseStatus.PROCESSING,
        originalAmountMinor: 0, // worker fills this in
        originalCurrency: activeTrip.baseCurrency,
        baseAmountMinor: 0,
      },
    });

    await tx.job.create({
      data: {
        type: JobType.TEXT_PARSE,
        expenseId: expense.id,
        status: JobStatus.QUEUED,
        payloadJson: JSON.stringify({
          text,
          tripId: activeTrip.id,
          userId: link.userId,
          chatId: String(chatId),
          baseCurrency: activeTrip.baseCurrency,
        }),
      },
    });

    return { expense };
  });

  await sendTelegramReply(String(chatId), `Got it - processing "${text}". Check the app in a moment.`);
  console.log(`[telegram] queued TEXT_PARSE job for expense ${expense.id}`);
}

// ---------- Webhook entry ----------
export async function POST(req: Request) {
  // Verify Telegram's secret token header
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new Response("Forbidden", { status: 403 });
  }

  const update: TgUpdate = await req.json().catch(() => null);
  if (!update?.update_id) return new Response("OK");

  // Idempotency: Telegram retries failed deliveries
  try {
    await prisma.telegramUpdate.create({ data: { updateId: String(update.update_id) } });
  } catch {
    return new Response("OK"); // already processed
  }

  const msg = update.message;
  if (!msg?.text) return new Response("OK"); // ignore non-text (photos handled in P3)

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  try {
    if (text.startsWith("/link ")) {
      await handleLink(chatId, text.slice(6).trim());
    } else if (text === "/start" || text === "/help") {
      await sendTelegramReply(String(chatId), "Send an expense like \"$24 lunch\" or use /link <code> to connect your account.");
    } else {
      await handleText(chatId, text);
    }
  } catch (err) {
    // Roll back idempotency so Telegram can retry on handler failure
    await prisma.telegramUpdate.delete({ where: { updateId: String(update.update_id) } }).catch(() => {});
    throw err;
  }

  return new Response("OK");
}
