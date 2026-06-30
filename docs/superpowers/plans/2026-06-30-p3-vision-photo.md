# P3 Vision Parse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add photo receipt intake via app camera and Telegram, parse receipts with Gemini Vision, and let users confirm/discard via a dedicated review page.

**Architecture:** Photos are saved to disk before a VISION_PARSE job is queued. The existing poll worker runs the job, calls Gemini Vision with the base64 image inline, writes LineItems, sets the expense to NEEDS_REVIEW, and fires SSE. The user then reviews and confirms at `/expenses/[id]/review`.

**Tech Stack:** Next.js 16 App Router, Prisma 7, SQLite, Auth.js v5, Gemini 2.0 Flash Vision, node:test + node:assert/strict

## Global Constraints

- All commands run from `General Projects/Projects/wanderwallet/`
- TypeScript check: `node_modules/.bin/tsc --noEmit`
- Test runner: `node --experimental-strip-types --test <file>`
- Money is always integer minor units; use `toMinor()`/`convertMinor()`/`fromMinor()` from `src/lib/money.ts`
- No new npm packages; use existing: prisma, next, zod, node built-ins
- Route params in App Router are `Promise<{ id: string }>` - always `await params`
- `uploads/` dir at project root, gitignored, created on first write via `mkdir({ recursive: true })`
- Gemini model: `gemini-2.0-flash`
- Max upload: 10 MB
- Photo expenses always land in `NEEDS_REVIEW` (never auto-CONFIRMED)
- No schema changes - all required models already exist (LineItem, VISION_PARSE, NEEDS_REVIEW, APP_PHOTO, TELEGRAM_PHOTO, imagePath, ocrConfidence)
- `sendTelegramReply(chatId: string, text: string)` takes a string chatId (Telegram Bot API accepts string in JSON)

---

### Task 1: Shared libs + branch setup

**Files:**
- Create: `src/lib/telegram.ts`
- Create: `src/lib/uploads.ts`
- Modify: `src/lib/parse-text.ts` - remove local `sendTelegramReply`, import from telegram.ts
- Modify: `src/app/api/telegram/route.ts` - remove local `reply()`, import from telegram.ts
- Modify: `.gitignore`

**Interfaces:**
- Produces: `sendTelegramReply(chatId: string, text: string): Promise<void>` from `@/lib/telegram`
- Produces: `saveUpload(id: string, buffer: Buffer, ext: string): Promise<string>` - returns `"uploads/<id>.<ext>"`
- Produces: `uploadAbsPath(relativePath: string): string` - returns absolute fs path from `@/lib/uploads`

- [ ] **Step 1: Checkout main, pull, create branch**

```bash
git checkout main
git pull origin main
git checkout -b p3-vision-photo
```

- [ ] **Step 2: Create `src/lib/telegram.ts`**

```typescript
export async function sendTelegramReply(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}
```

- [ ] **Step 3: Create `src/lib/uploads.ts`**

```typescript
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const UPLOADS_DIR = join(process.cwd(), "uploads");

export async function saveUpload(id: string, buffer: Buffer, ext: string): Promise<string> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const filename = `${id}.${ext}`;
  await writeFile(join(UPLOADS_DIR, filename), buffer);
  return `uploads/${filename}`;
}

export function uploadAbsPath(relativePath: string): string {
  return join(process.cwd(), relativePath);
}
```

- [ ] **Step 4: Update `src/lib/parse-text.ts`**

Remove the local `sendTelegramReply` function (lines 69-77):
```typescript
async function sendTelegramReply(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}
```

Add import at top of file with the other imports:
```typescript
import { sendTelegramReply } from "@/lib/telegram";
```

The `sendTelegramReply` call at line 113 stays unchanged - signature is identical.

- [ ] **Step 5: Update `src/app/api/telegram/route.ts`**

Remove the local `reply()` function (lines 28-36):
```typescript
async function reply(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return; // silently skip in dev before bot is created
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}
```

Add import at top:
```typescript
import { sendTelegramReply } from "@/lib/telegram";
```

Replace all four `reply(chatId, ...)` call sites with `sendTelegramReply(String(chatId), ...)`:

In `handleLink`:
```typescript
await sendTelegramReply(String(chatId), "Code not found or expired. Generate a new one in the app.");
// ...
await sendTelegramReply(String(chatId), "Linked! Send me an expense like \"$24 lunch\" and I'll add it.");
```

In `handleText`:
```typescript
await sendTelegramReply(String(chatId), "Not linked yet. Open Wanderwallet -> Settings -> Link Telegram.");
// ...
await sendTelegramReply(String(chatId), "No active trip found. Start a trip in the app first.");
// ...
await sendTelegramReply(String(chatId), `Got it - processing "${text}". Check the app in a moment.`);
```

In `POST` handler:
```typescript
await sendTelegramReply(String(chatId), "Send an expense like \"$24 lunch\" or use /link <code> to connect your account.");
```

- [ ] **Step 6: Add `uploads/` to .gitignore**

Append to `.gitignore`:
```
uploads/
```

- [ ] **Step 7: Type-check**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 8: Commit**

```bash
git add src/lib/telegram.ts src/lib/uploads.ts src/lib/parse-text.ts src/app/api/telegram/route.ts .gitignore
git commit -m "refactor(telegram): extract shared sendTelegramReply; add uploads helper"
```

---

### Task 2: parse-vision.ts + wire worker

**Files:**
- Create: `src/lib/parse-vision.ts`
- Create: `src/lib/parse-vision.test.ts`
- Modify: `src/lib/worker.ts` - replace VISION_PARSE stub with real handler

**Interfaces:**
- Consumes: `uploadAbsPath` from `@/lib/uploads`
- Consumes: `sendTelegramReply` from `@/lib/telegram`
- Consumes: `toMinor`, `convertMinor`, `fromMinor` from `@/lib/money`
- Consumes: `getRate` from `@/lib/fx`
- Consumes: `CATEGORY_KEYS` from `@/lib/categories`
- Produces: `handleVisionParse(job: Job): Promise<void>` exported from `@/lib/parse-vision`
- Produces: `mapVisionResult(parsed, baseCurrency, rate)` exported from `@/lib/parse-vision` (pure, testable)

- [ ] **Step 1: Write failing test**

Create `src/lib/parse-vision.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapVisionResult } from "./parse-vision.ts";

test("mapVisionResult converts Gemini output to minor units", () => {
  const result = mapVisionResult(
    { total: 24.5, currency: "USD", merchant: "Nobu", category: "FOOD", confidence: 0.95, items: [] },
    "USD",
    1
  );
  assert.equal(result.originalAmountMinor, 2450);
  assert.equal(result.baseAmountMinor, 2450);
  assert.equal(result.fxRate, null);
  assert.equal(result.category, "FOOD");
  assert.equal(result.merchant, "Nobu");
  assert.equal(result.ocrConfidence, 0.95);
});

test("mapVisionResult applies FX when currencies differ", () => {
  const result = mapVisionResult(
    { total: 100, currency: "EUR", merchant: null, category: "HOTELS", confidence: 0.8, items: [] },
    "USD",
    1.1
  );
  assert.equal(result.originalAmountMinor, 10000);
  assert.equal(result.baseAmountMinor, 11000);
  assert.ok(result.fxRate !== null);
});

test("mapVisionResult falls back to OTHER for unknown category", () => {
  const result = mapVisionResult(
    { total: 10, currency: "USD", merchant: null, category: "UNKNOWN", confidence: 0.5, items: [] },
    "USD",
    1
  );
  assert.equal(result.category, "OTHER");
});
```

- [ ] **Step 2: Run test - expect failure**

```bash
node --experimental-strip-types --test src/lib/parse-vision.test.ts
```

Expected: FAIL - `Cannot find module './parse-vision.ts'`

- [ ] **Step 3: Create `src/lib/parse-vision.ts`**

```typescript
import { readFile } from "fs/promises";
import type { Job } from "@prisma/client";
import { ExpenseStatus, Category } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toMinor, convertMinor } from "@/lib/money";
import { getRate } from "@/lib/fx";
import { CATEGORY_KEYS } from "@/lib/categories";
import { uploadAbsPath } from "@/lib/uploads";
import { sendTelegramReply } from "@/lib/telegram";

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
          category: CATEGORY_KEYS.includes(it.category as Category)
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
```

- [ ] **Step 4: Run tests - expect 3 passing**

```bash
node --experimental-strip-types --test src/lib/parse-vision.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Wire VISION_PARSE in `src/lib/worker.ts`**

Replace lines 37-38:
```typescript
      case JobType.VISION_PARSE:
        throw new Error("VISION_PARSE not implemented (P3)");
```

With:
```typescript
      case JobType.VISION_PARSE: {
        const { handleVisionParse } = await import("@/lib/parse-vision");
        await handleVisionParse(job);
        break;
      }
```

- [ ] **Step 6: Type-check**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/parse-vision.ts src/lib/parse-vision.test.ts src/lib/worker.ts
git commit -m "feat(worker): implement VISION_PARSE handler with Gemini Vision"
```

---

### Task 3: Photo upload API

**Files:**
- Create: `src/app/api/expenses/photo/route.ts`

**Interfaces:**
- Consumes: `saveUpload` from `@/lib/uploads`
- Consumes: `getCurrentUser` from `@/lib/session`
- Produces: `POST /api/expenses/photo` - accepts `multipart/form-data` with `photo: File` and `tripId: string`. Returns `{ expenseId: string }` (201).

- [ ] **Step 1: Create `src/app/api/expenses/photo/route.ts`**

```typescript
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
```

- [ ] **Step 2: Type-check**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/expenses/photo/route.ts
git commit -m "feat(api): photo upload endpoint - save image, queue VISION_PARSE"
```

---

### Task 4: Image serve API

**Files:**
- Create: `src/app/api/expenses/[id]/image/route.ts`

**Interfaces:**
- Consumes: `uploadAbsPath` from `@/lib/uploads`
- Produces: `GET /api/expenses/[id]/image` - streams image bytes. Returns 401/403/404 on error.

- [ ] **Step 1: Create `src/app/api/expenses/[id]/image/route.ts`**

```typescript
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

  return new Response(buffer, { headers: { "Content-Type": contentType } });
}
```

- [ ] **Step 2: Type-check**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/expenses/[id]/image/route.ts
git commit -m "feat(api): auth-gated image serve endpoint"
```

---

### Task 5: Confirm API

**Files:**
- Create: `src/app/api/expenses/[id]/confirm/route.ts`

**Interfaces:**
- Consumes: `toMinor`, `convertMinor`, `SUPPORTED_CURRENCIES` from `@/lib/money`
- Consumes: `getRate` from `@/lib/fx`
- Consumes: `sendTelegramReply` from `@/lib/telegram`
- Produces: `PATCH /api/expenses/[id]/confirm`
  - Discard body: `{ discard: true }`
  - Confirm body: `{ discard: false, amount: number, currency: string, merchant?: string, category: string, note?: string, items: Array<{ name: string, qty: number, unitPrice: number, total: number, category: string | null }> }`
  - Returns `{}` (200).

- [ ] **Step 1: Create `src/app/api/expenses/[id]/confirm/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { toMinor, convertMinor, SUPPORTED_CURRENCIES } from "@/lib/money";
import { getRate } from "@/lib/fx";
import { CATEGORY_KEYS } from "@/lib/categories";
import { sendTelegramReply } from "@/lib/telegram";
import { ExpenseSource, ExpenseStatus } from "@prisma/client";

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
    select: { tripId: true, source: true, status: true },
  });
  if (!expense) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (expense.status !== ExpenseStatus.NEEDS_REVIEW) {
    return NextResponse.json({ error: "NOT_NEEDS_REVIEW" }, { status: 409 });
  }

  const trip = await prisma.trip.findFirst({
    where: {
      id: expense.tripId,
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    select: { id: true, baseCurrency: true },
  });
  if (!trip) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.discard) {
    await prisma.expense.update({ where: { id }, data: { status: ExpenseStatus.FAILED } });
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
          category: it.category as never,
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
        category: b.category as never,
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
      await sendTelegramReply(
        chatId,
        `Receipt confirmed: ${b.currency} ${b.amount}${b.merchant ? ` - ${b.merchant}` : ""}`
      );
    }
  }

  return NextResponse.json({});
}
```

- [ ] **Step 2: Type-check**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/expenses/[id]/confirm/route.ts
git commit -m "feat(api): confirm/discard endpoint for NEEDS_REVIEW expenses"
```

---

### Task 6: Review page + dashboard pending section

**Files:**
- Create: `src/app/expenses/[id]/review/ReviewForm.tsx`
- Create: `src/app/expenses/[id]/review/page.tsx`
- Modify: `src/lib/trip.ts` - add `getPendingExpenses`
- Modify: `src/app/page.tsx` - add pending section + import PhotoAdd placeholder
- Modify: `src/app/globals.css` - add review styles

**Interfaces:**
- Consumes: `GET /api/expenses/[id]/image`
- Consumes: `PATCH /api/expenses/[id]/confirm`
- Consumes: `fromMinor(minor: number, currency: string): number` from `@/lib/money`
- Produces: `getPendingExpenses(userId: string)` from `@/lib/trip`
- Produces: `/expenses/[id]/review` page

- [ ] **Step 1: Add `getPendingExpenses` to `src/lib/trip.ts`**

Append to the end of `src/lib/trip.ts`:

```typescript
export async function getPendingExpenses(userId: string) {
  return prisma.expense.findMany({
    where: {
      status: { in: ["PROCESSING", "NEEDS_REVIEW"] },
      trip: {
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
    },
    select: {
      id: true,
      status: true,
      source: true,
      merchant: true,
      category: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}
```

- [ ] **Step 2: Add CSS to `src/app/globals.css`**

Append:
```css
/* ---------- review page ---------- */
.btn-danger {
  background: #ef4444;
  color: #fff;
  border: none;
  border-radius: 12px;
  padding: 14px;
  font-weight: 700;
  font-size: 1rem;
  cursor: pointer;
}
.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.review-img {
  width: 100%;
  border-radius: 12px;
  object-fit: contain;
  max-height: 300px;
  background: rgba(255, 255, 255, 0.04);
}
.items-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.items-table th {
  text-align: left;
  color: var(--muted);
  padding: 4px 6px;
  font-weight: 600;
}
.items-table td {
  padding: 6px;
  border-bottom: 1px solid var(--card-border);
}
.items-table input {
  background: transparent;
  border: 1px solid var(--card-border);
  border-radius: 6px;
  color: var(--text);
  padding: 4px 6px;
  width: 100%;
  font-size: 0.82rem;
}
.review-actions {
  display: flex;
  gap: 10px;
}
.review-actions .btn-primary,
.review-actions .btn-danger {
  flex: 1;
}
```

- [ ] **Step 3: Create `src/app/expenses/[id]/review/ReviewForm.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORY_KEYS, CATEGORIES } from "@/lib/categories";
import { SUPPORTED_CURRENCIES, fromMinor } from "@/lib/money";
import type { Expense, LineItem } from "@prisma/client";

type ExpenseWithItems = Expense & { items: LineItem[] };

export function ReviewForm({
  expense,
  baseCurrency,
}: {
  expense: ExpenseWithItems;
  baseCurrency: string;
}) {
  const router = useRouter();
  void baseCurrency; // available for future FX display

  const [amount, setAmount] = useState(
    expense.originalAmountMinor > 0
      ? String(fromMinor(expense.originalAmountMinor, expense.originalCurrency))
      : ""
  );
  const [currency, setCurrency] = useState(expense.originalCurrency);
  const [merchant, setMerchant] = useState(expense.merchant ?? "");
  const [category, setCategory] = useState<string>(expense.category);
  const [note, setNote] = useState(expense.note ?? "");
  const [items, setItems] = useState(
    expense.items.map((it) => ({
      name: it.name,
      qty: String(it.qty),
      unitPrice: String(fromMinor(it.unitPriceMinor, expense.originalCurrency)),
      total: String(fromMinor(it.lineTotalMinor, expense.originalCurrency)),
      category: it.category ?? "",
    }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(discard: boolean) {
    setError(null);
    setBusy(true);
    try {
      const body = discard
        ? { discard: true }
        : {
            discard: false,
            amount: parseFloat(amount),
            currency,
            merchant: merchant || undefined,
            category,
            note: note || undefined,
            items: items.map((it) => ({
              name: it.name,
              qty: parseFloat(it.qty),
              unitPrice: parseFloat(it.unitPrice),
              total: parseFloat(it.total),
              category: it.category || null,
            })),
          };

      const res = await fetch(`/api/expenses/${expense.id}/confirm`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        setError(`Failed (${res.status})`);
        return;
      }
      router.push("/");
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="quickadd">
        <div>
          <label className="muted small">Amount</label>
          <input
            className="text-input"
            style={{ marginTop: 4, display: "block", width: "100%" }}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
          />
        </div>

        <div className="pillrow">
          {SUPPORTED_CURRENCIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`pill ${currency === c ? "pill-on" : ""}`}
              onClick={() => setCurrency(c)}
            >
              {c}
            </button>
          ))}
        </div>

        <input
          className="text-input"
          placeholder="Merchant"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
        />

        <div className="pillrow wrap">
          {CATEGORY_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              className={`pill ${category === k ? "pill-on" : ""}`}
              onClick={() => setCategory(k)}
            >
              {CATEGORIES[k].icon} {CATEGORIES[k].label}
            </button>
          ))}
        </div>

        <input
          className="text-input"
          placeholder="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {items.length > 0 && (
          <div>
            <p className="muted small" style={{ marginBottom: 8 }}>Line items</p>
            <table className="items-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        value={it.name}
                        onChange={(e) => {
                          const next = [...items];
                          next[i] = { ...next[i], name: e.target.value };
                          setItems(next);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        value={it.qty}
                        style={{ width: 40 }}
                        onChange={(e) => {
                          const next = [...items];
                          next[i] = { ...next[i], qty: e.target.value };
                          setItems(next);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        value={it.unitPrice}
                        style={{ width: 60 }}
                        onChange={(e) => {
                          const next = [...items];
                          next[i] = { ...next[i], unitPrice: e.target.value };
                          setItems(next);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        value={it.total}
                        style={{ width: 60 }}
                        onChange={(e) => {
                          const next = [...items];
                          next[i] = { ...next[i], total: e.target.value };
                          setItems(next);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <div className="review-actions">
          <button className="btn-primary" onClick={() => submit(false)} disabled={busy}>
            {busy ? "Saving..." : "Confirm"}
          </button>
          <button className="btn-danger" onClick={() => submit(true)} disabled={busy}>
            Discard
          </button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create `src/app/expenses/[id]/review/page.tsx`**

```tsx
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
```

- [ ] **Step 5: Update `src/app/page.tsx`**

Add imports at top (alongside existing imports):
```typescript
import { getActiveTrip, buildSummary, tripPeople, getPendingExpenses } from "@/lib/trip";
```

Add pending query inside `Home()`, after the `methods` query:
```typescript
const pending = await getPendingExpenses(user.id);
```

Add pending section in JSX, between `<QuickAdd .../>` and `<SpendingDonut .../>`:
```tsx
{pending.length > 0 && (
  <section className="card">
    <h2 className="card-title">Needs review ({pending.length})</h2>
    <ul className="feed">
      {pending.map((e) => (
        <li key={e.id} className="feed-row">
          <div className="feed-main">
            <div className="feed-title">{e.merchant ?? e.category}</div>
            <div className="feed-sub muted">
              {e.status === "PROCESSING" ? "Processing..." : "Tap to review"}
            </div>
          </div>
          {e.status === "NEEDS_REVIEW" && (
            <Link
              href={`/expenses/${e.id}/review`}
              className="btn-ghost"
              style={{ fontSize: "0.82rem" }}
            >
              Review
            </Link>
          )}
        </li>
      ))}
    </ul>
  </section>
)}
```

`Link` is already imported at the top of `page.tsx`.

- [ ] **Step 6: Type-check**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/expenses/ src/lib/trip.ts src/app/page.tsx src/app/globals.css
git commit -m "feat(ui): review page for NEEDS_REVIEW expenses + pending section on dashboard"
```

---

### Task 7: PhotoAdd component

**Files:**
- Create: `src/components/PhotoAdd.tsx`
- Modify: `src/app/page.tsx` - add `<PhotoAdd>`

**Interfaces:**
- Consumes: `POST /api/expenses/photo`
- Produces: `<PhotoAdd tripId={string} />` - camera button, handles upload, shows status

- [ ] **Step 1: Create `src/components/PhotoAdd.tsx`**

```tsx
"use client";
import { useRef, useState } from "react";
import Link from "next/link";

type State =
  | { type: "idle" }
  | { type: "uploading" }
  | { type: "queued"; expenseId: string }
  | { type: "error"; msg: string };

export function PhotoAdd({ tripId }: { tripId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ type: "idle" });

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setState({ type: "uploading" });

    try {
      const form = new FormData();
      form.append("photo", file);
      form.append("tripId", tripId);

      const res = await fetch("/api/expenses/photo", { method: "POST", body: form });

      if (!res.ok) {
        setState({ type: "error", msg: `Upload failed (${res.status})` });
        return;
      }

      const { expenseId } = (await res.json()) as { expenseId: string };
      setState({ type: "queued", expenseId });
    } catch {
      setState({ type: "error", msg: "Network error" });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="card">
      <h2 className="card-title">Scan a receipt</h2>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handleFile}
      />

      {state.type === "idle" && (
        <button className="btn-primary" onClick={() => inputRef.current?.click()}>
          Take photo
        </button>
      )}

      {state.type === "uploading" && <p className="muted">Uploading...</p>}

      {state.type === "queued" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="muted small">
            Receipt sent for processing. We will update the feed when ready.
          </p>
          <Link
            href={`/expenses/${state.expenseId}/review`}
            className="btn-ghost"
            style={{ textAlign: "center" }}
          >
            Check status
          </Link>
          <button
            className="btn-primary"
            onClick={() => setState({ type: "idle" })}
          >
            Scan another
          </button>
        </div>
      )}

      {state.type === "error" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="error">{state.msg}</p>
          <button
            className="btn-primary"
            onClick={() => setState({ type: "idle" })}
          >
            Try again
          </button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Add `<PhotoAdd>` to `src/app/page.tsx`**

Add import:
```typescript
import { PhotoAdd } from "@/components/PhotoAdd";
```

Add component in JSX after `<QuickAdd .../>` and before the pending section:
```tsx
<QuickAdd tripId={trip.id} people={people} methods={methods} />
<PhotoAdd tripId={trip.id} />
{pending.length > 0 && (
```

- [ ] **Step 3: Type-check**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/PhotoAdd.tsx src/app/page.tsx
git commit -m "feat(ui): PhotoAdd camera component with upload and status feedback"
```

---

### Task 8: Telegram photo handler

**Files:**
- Modify: `src/app/api/telegram/route.ts`

**Interfaces:**
- Consumes: `saveUpload` from `@/lib/uploads`
- Adds internal `handlePhoto(chatId: number, photos: TgPhotoSize[])` function

- [ ] **Step 1: Add `TgPhotoSize` type and `photo?` to `TgMessage` in `src/app/api/telegram/route.ts`**

Add `TgPhotoSize` interface before `TgUser`:
```typescript
interface TgPhotoSize {
  file_id: string;
  file_size?: number;
  width: number;
  height: number;
}
```

Add `photo?: TgPhotoSize[]` field to `TgMessage`:
```typescript
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  photo?: TgPhotoSize[];
}
```

- [ ] **Step 2: Add imports to `src/app/api/telegram/route.ts`**

Add alongside existing imports at top:
```typescript
import { saveUpload } from "@/lib/uploads";
import { randomUUID } from "crypto";
```

`ExpenseSource`, `ExpenseStatus`, `JobStatus`, `JobType` are already imported.

- [ ] **Step 3: Add `handlePhoto` function after `handleText`**

```typescript
async function handlePhoto(chatId: number, photos: TgPhotoSize[]) {
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

  const largest = photos[photos.length - 1];
  const token = process.env.TELEGRAM_BOT_TOKEN!;

  const fileRes = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${largest.file_id}`
  );
  if (!fileRes.ok) {
    await sendTelegramReply(String(chatId), "Could not retrieve photo. Please try again.");
    return;
  }
  const fileData = (await fileRes.json()) as { result?: { file_path?: string } };
  const filePath = fileData.result?.file_path;
  if (!filePath) {
    await sendTelegramReply(String(chatId), "Could not retrieve photo. Please try again.");
    return;
  }

  const photoRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!photoRes.ok) {
    await sendTelegramReply(String(chatId), "Could not download photo. Please try again.");
    return;
  }

  const buffer = Buffer.from(await photoRes.arrayBuffer());
  const ext = filePath.split(".").pop() ?? "jpg";
  const imagePath = await saveUpload(randomUUID(), buffer, ext);

  const expense = await prisma.expense.create({
    data: {
      tripId: activeTrip.id,
      paidById: link.userId,
      source: ExpenseSource.TELEGRAM_PHOTO,
      status: ExpenseStatus.PROCESSING,
      originalAmountMinor: 0,
      originalCurrency: activeTrip.baseCurrency,
      baseAmountMinor: 0,
      imagePath,
    },
  });

  await prisma.job.create({
    data: {
      type: JobType.VISION_PARSE,
      expenseId: expense.id,
      status: JobStatus.QUEUED,
      payloadJson: JSON.stringify({
        imagePath,
        chatId: String(chatId),
        tripId: activeTrip.id,
        userId: link.userId,
      }),
    },
  });

  await sendTelegramReply(
    String(chatId),
    "Got your receipt - processing now. I will send you a review link when ready."
  );
  console.log(`[telegram] queued VISION_PARSE job for expense ${expense.id}`);
}
```

- [ ] **Step 4: Update the `POST` handler dispatch block**

Replace the section after the idempotency check (current lines 139-153) with:

```typescript
  const msg = update.message;
  if (!msg) return new Response("OK");

  const chatId = msg.chat.id;
  const text = msg.text?.trim() ?? "";

  try {
    if (msg.photo && msg.photo.length > 0) {
      await handlePhoto(chatId, msg.photo);
    } else if (!text) {
      // non-text, non-photo message (sticker, location, etc.) - ignore
    } else if (text.startsWith("/link ")) {
      await handleLink(chatId, text.slice(6).trim());
    } else if (text === "/start" || text === "/help") {
      await sendTelegramReply(
        String(chatId),
        "Send an expense like \"$24 lunch\" or use /link <code> to connect your account."
      );
    } else {
      await handleText(chatId, text);
    }
  } catch (err) {
    await prisma.telegramUpdate
      .delete({ where: { updateId: String(update.update_id) } })
      .catch(() => {});
    throw err;
  }

  return new Response("OK");
```

- [ ] **Step 5: Final type-check + tests**

```bash
node_modules/.bin/tsc --noEmit
node --experimental-strip-types --test src/lib/parse-vision.test.ts
```

Expected: tsc clean, 3 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/telegram/route.ts
git commit -m "feat(telegram): handle photo messages - download, store, queue VISION_PARSE"
```

---

### After all tasks: open PR

```bash
git push -u origin p3-vision-photo
gh pr create --title "feat(p3): vision parse - photo receipts, review UI, Telegram photos" --body "$(cat <<'EOF'
## Summary
- App camera via `<PhotoAdd>` component (native `<input capture>`)
- Telegram photo handler: download, store to disk, queue VISION_PARSE
- Gemini Vision parser: base64 inline, extracts total/currency/merchant/category/line items
- `/expenses/[id]/review` page: editable fields + line items table + confirm/discard
- `PATCH /api/expenses/[id]/confirm` endpoint
- Dashboard "Needs review" section for PROCESSING/NEEDS_REVIEW expenses
- Shared `src/lib/telegram.ts` + `src/lib/uploads.ts` extracted

## Test plan
- [ ] `node_modules/.bin/tsc --noEmit` clean
- [ ] `node --experimental-strip-types --test src/lib/parse-vision.test.ts` - 3 passing
- [ ] Upload a receipt photo in app - appears in "Needs review" after worker runs
- [ ] Send a photo to Telegram bot - bot replies with review link
- [ ] Review page shows image, parsed fields, line items - confirm redirects to dashboard
- [ ] Discard sets expense FAILED, redirects to dashboard
- [ ] Telegram reply sent on confirm for TELEGRAM_PHOTO source

🤖 Generated with Claude Code
EOF
)"
```
