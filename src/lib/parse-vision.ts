import { readFile } from "fs/promises";
import type { Job } from "@prisma/client";
import { Category } from "@prisma/client";
import { toMinor, convertMinor } from "./money.ts";
import { CATEGORY_KEYS } from "./categories.ts";

interface VisionPayload {
  imagePath: string;
  chatId?: string;
  tripId: string;
  userId: string;
}

export interface GeminiVisionResult {
  total: number;
  currency: string;
  merchant: string | null;
  category: string;
  confidence: number;
  items: Array<{
    name: string;
    qty: number;
    unitPrice: number;
    total: number;
    category: string | null;
  }>;
}

const VISION_PROMPT = `Extract receipt data. Return ONLY valid JSON with these fields:
- total: number (grand total charged, required, positive float)
- currency: string (ISO 4217, infer from symbol: $ -> USD, € -> EUR, £ -> GBP, ¥ -> JPY, ฿ -> THB; default USD)
- merchant: string or null
- category: one of FLIGHTS, HOTELS, FOOD, ACTIVITIES, SHOPPING, OTHER
- confidence: number (0-1, your parse confidence for the total amount)
- items: array of { "name": string, "qty": number, "unitPrice": number, "total": number, "category": string | null } (empty array if no line items visible)

If total differs from sum of items (taxes, tips, discounts), trust total.`;

async function callGeminiVision(imagePath: string): Promise<GeminiVisionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  // Lazy-import to avoid pulling in fs/path deps at test time
  const { uploadAbsPath } = await import("@/lib/uploads");
  const buffer = await readFile(uploadAbsPath(imagePath));
  const base64 = buffer.toString("base64");
  const ext = imagePath.split(".").pop() ?? "jpg";
  const mimeType = ext === "png" ? "image/png" : "image/jpeg";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: VISION_PROMPT },
          ],
        }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    }
  );

  if (!res.ok) throw new Error(`Gemini Vision ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Empty Gemini Vision response");
  return JSON.parse(raw) as GeminiVisionResult;
}

export function mapVisionResult(
  parsed: GeminiVisionResult,
  baseCurrency: string,
  rate: number
) {
  const originalAmountMinor = toMinor(parsed.total, parsed.currency);
  const baseAmountMinor = convertMinor(originalAmountMinor, parsed.currency, baseCurrency, rate);
  const fxRate = parsed.currency === baseCurrency ? null : rate;
  const category = CATEGORY_KEYS.includes(parsed.category as Category)
    ? (parsed.category as Category)
    : Category.OTHER;

  return {
    originalAmountMinor,
    originalCurrency: parsed.currency,
    baseAmountMinor,
    fxRate,
    fxRateDate: fxRate ? new Date() : null,
    category,
    merchant: parsed.merchant ?? null,
    ocrConfidence: parsed.confidence,
  };
}

export async function handleVisionParse(job: Job): Promise<void> {
  // Lazy-load server-only modules so the pure mapVisionResult stays testable
  const { prisma } = await import("@/lib/prisma");
  const { getRate } = await import("@/lib/fx");
  const { sendTelegramReply } = await import("@/lib/telegram");
  const { ExpenseStatus } = await import("@prisma/client");

  const payload = JSON.parse(job.payloadJson ?? "{}") as VisionPayload;
  const { imagePath, chatId } = payload;

  if (!imagePath) throw new Error("VISION_PARSE job missing imagePath");

  const trip = await prisma.trip.findFirstOrThrow({
    where: {
      expenses: { some: { id: job.expenseId! } },
    },
    select: { baseCurrency: true },
  });

  const parsed = await callGeminiVision(imagePath);

  if (!parsed || typeof parsed.total !== "number" || !isFinite(parsed.total) || parsed.total <= 0) {
    throw new Error(`Invalid Gemini Vision response: total=${parsed?.total}`);
  }
  if (!parsed.currency || parsed.currency.length !== 3) {
    parsed.currency = trip.baseCurrency;
  }

  const rate = await getRate(parsed.currency, trip.baseCurrency);
  const fields = mapVisionResult(parsed, trip.baseCurrency, rate);

  const sumItems = parsed.items.reduce((s, it) => s + it.total, 0);
  if (parsed.items.length > 0 && Math.abs(sumItems - parsed.total) / parsed.total > 0.01) {
    console.warn(`[vision] total/items mismatch: total=${parsed.total} sumItems=${sumItems}`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.expense.update({
      where: { id: job.expenseId! },
      data: { ...fields, status: ExpenseStatus.NEEDS_REVIEW },
    });

    if (parsed.items.length > 0) {
      await tx.lineItem.deleteMany({ where: { expenseId: job.expenseId! } });
      await tx.lineItem.createMany({
        data: parsed.items.map((it) => ({
          expenseId: job.expenseId!,
          name: it.name,
          qty: it.qty,
          unitPriceMinor: toMinor(it.unitPrice, parsed.currency),
          lineTotalMinor: toMinor(it.total, parsed.currency),
          category: it.category && CATEGORY_KEYS.includes(it.category as Category)
            ? (it.category as Category)
            : null,
        })),
      });
    }
  });

  if (chatId) {
    const baseUrl = process.env.NEXTAUTH_URL ?? "";
    await sendTelegramReply(
      chatId,
      `Receipt scanned. Tap to review: ${baseUrl}/expenses/${job.expenseId}/review`
    );
  }
}
