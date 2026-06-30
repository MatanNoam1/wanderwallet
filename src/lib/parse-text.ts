import type { Job } from "@prisma/client";
import { ExpenseStatus, Category } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toMinor, convertMinor, fmt } from "@/lib/money";
import { getRate } from "@/lib/fx";
import { CATEGORY_KEYS } from "@/lib/categories";
import { sendTelegramReply } from "@/lib/telegram";

interface ParsePayload {
  text: string;
  tripId: string;
  userId: string;
  chatId: string;
  baseCurrency: string;
}

interface GeminiParsed {
  amount: number;
  currency: string;
  category: string;
  merchant: string | null;
  note: string | null;
}

const SYSTEM_PROMPT = `You are a travel expense parser. Extract expense info from a user message.
Return ONLY valid JSON with these fields:
- amount: number (required, the spend amount as a positive float)
- currency: string (ISO 4217, 3-letter uppercase, infer from symbols: $ -> USD, € -> EUR, £ -> GBP, ¥ -> JPY, ฿ -> THB; default USD if ambiguous)
- category: one of ${CATEGORY_KEYS.join(", ")} (pick best match, default OTHER)
- merchant: string or null (merchant/vendor name if mentioned)
- note: string or null (short description, max 60 chars)

Examples:
"$24 lunch" -> {"amount":24,"currency":"USD","category":"FOOD","merchant":null,"note":"lunch"}
"spent 3200 yen on train" -> {"amount":3200,"currency":"JPY","category":"ACTIVITIES","merchant":null,"note":"train"}
"hotel €150 Marriott" -> {"amount":150,"currency":"EUR","category":"HOTELS","merchant":"Marriott","note":null}`;

async function callGemini(text: string): Promise<GeminiParsed> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    }
  );

  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Empty Gemini response");

  const parsed = JSON.parse(raw) as GeminiParsed;
  if (!parsed.amount || parsed.amount <= 0) throw new Error("Parsed amount invalid");

  parsed.currency = (parsed.currency ?? "USD").toUpperCase();
  if (!CATEGORY_KEYS.includes(parsed.category as Category)) parsed.category = "OTHER";

  return parsed;
}

export async function handleTextParse(job: Job): Promise<void> {
  const payload = JSON.parse(job.payloadJson ?? "{}") as ParsePayload;
  const { text, chatId, baseCurrency } = payload;

  const parsed = await callGemini(text);

  const originalMinor = toMinor(parsed.amount, parsed.currency);
  const rate = await getRate(parsed.currency, baseCurrency);
  const baseMinor = convertMinor(originalMinor, parsed.currency, baseCurrency, rate);
  const fxRate = parsed.currency === baseCurrency ? null : rate;
  const fxRateDate = fxRate ? new Date() : null;

  await prisma.expense.update({
    where: { id: job.expenseId! },
    data: {
      originalAmountMinor: originalMinor,
      originalCurrency: parsed.currency,
      baseAmountMinor: baseMinor,
      fxRate,
      fxRateDate,
      category: parsed.category as Category,
      merchant: parsed.merchant ?? null,
      note: parsed.note ?? null,
      status: ExpenseStatus.CONFIRMED,
      rawParseJson: JSON.stringify(parsed),
    },
  });

  const display = fmt(originalMinor, parsed.currency);
  const suffix =
    parsed.currency !== baseCurrency
      ? ` (${fmt(baseMinor, baseCurrency)} ${baseCurrency})`
      : "";
  const label = parsed.merchant ?? parsed.note ?? "expense";
  await sendTelegramReply(chatId, `Added: ${display}${suffix} - ${label}`);
}
