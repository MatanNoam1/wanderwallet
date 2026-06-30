# P3 Design: Vision Parse (Photo Receipts + NEEDS_REVIEW UI)

## Overview

P3 adds two photo intake paths (in-app camera and Telegram photo), a `VISION_PARSE` worker handler, and a `/expenses/[id]/review` confirm page. It extends P2's job queue and SSE patterns without changing the schema.

## Decisions

- Photo expenses always land in `NEEDS_REVIEW` -- no auto-confirm for vision output.
- Images stored to disk (`uploads/<expenseId>.<ext>`) before job is queued. Worker reads from disk, base64-encodes, sends inline to Gemini.
- App camera uses `<input type="file" accept="image/*" capture="environment">` -- no MediaDevices API.
- Review UI is a dedicated page (`/expenses/[id]/review`), not inline in the feed.

## Data Flow

```
[photo captured/received]
  -> save to uploads/<expenseId>.<ext>
  -> Expense created (PROCESSING, imagePath set, source=APP_PHOTO|TELEGRAM_PHOTO)
  -> Job created (VISION_PARSE, payloadJson: { imagePath, chatId? })
  -> worker picks up -> reads image from disk, base64-encodes
  -> Gemini Vision (gemini-2.0-flash, inline image + JSON prompt)
  -> Gemini returns: total, currency, merchant, category, confidence, items[]
  -> LineItem rows inserted
  -> Expense updated: NEEDS_REVIEW, ocrConfidence set
  -> SSE fires (expense:<tripId>) -> feed shows "needs review" badge
  -> User opens /expenses/[id]/review -> edits fields + confirms
  -> Expense -> CONFIRMED
  -> If Telegram source: send reply via Bot API
```

## Files

### New

| File | Purpose |
|------|---------|
| `src/lib/telegram.ts` | Shared `sendTelegramReply(chatId, text)` -- extracted from parse-text.ts and route.ts |
| `src/lib/uploads.ts` | `saveUpload(expenseId, buffer, ext): string` -- writes to `uploads/`, returns relative path |
| `src/lib/parse-vision.ts` | `handleVisionParse(job)` -- reads image off disk, calls Gemini Vision, writes LineItems, sets NEEDS_REVIEW |
| `src/components/PhotoAdd.tsx` | Camera button (`<input capture="environment">`), POST multipart to `/api/expenses/photo`, shows "processing..." on success |
| `src/app/api/expenses/photo/route.ts` | Auth-gated multipart endpoint: save image, create Expense + Job, return `{ expenseId }` |
| `src/app/api/expenses/[id]/confirm/route.ts` | PATCH: accept edited fields, replace LineItems, set CONFIRMED |
| `src/app/api/expenses/[id]/image/route.ts` | Auth-gated image serve: read from disk, stream bytes with correct Content-Type |
| `src/app/expenses/[id]/review/page.tsx` | Server page: loads expense + items. If not NEEDS_REVIEW, redirect to `/`. Client form for editing + confirm/discard. |

### Edited

| File | Change |
|------|--------|
| `src/app/api/telegram/route.ts` | Add `message.photo` branch: download largest photo from Telegram CDN, save via uploads.ts, queue VISION_PARSE |
| `src/lib/worker.ts` | Wire `VISION_PARSE` case to `handleVisionParse` |
| `src/lib/parse-text.ts` | Import `sendTelegramReply` from `telegram.ts`, remove local copy |
| `src/app/page.tsx` | Add `<PhotoAdd tripId={...} />` to dashboard |
| `.gitignore` | Add `uploads/` |

## Gemini Vision Prompt

Send image as `inlineData` (base64, mimeType from file ext). Prompt:

```
Extract receipt data. Return ONLY valid JSON with these fields:
- total: number (grand total charged, required, positive float)
- currency: string (ISO 4217, infer from symbol; default USD)
- merchant: string or null
- category: one of FLIGHTS, HOTELS, FOOD, ACTIVITIES, SHOPPING, OTHER
- confidence: number (0-1, your parse confidence for the total amount)
- items: array of { name: string, qty: number, unitPrice: number, total: number, category: string | null }
         (empty array if no line items visible)

If total differs from sum of items (taxes, tips, discounts), trust total.
```

`confidence` stored as `ocrConfidence`. Line items mapped to `LineItem` rows (`unitPriceMinor`, `lineTotalMinor` in minor units). If Gemini total vs sum-of-items differs > 1%, log a warning.

## Review Page (`/expenses/[id]/review`)

Server component loads expense + line items. Redirects to `/` if expense is not `NEEDS_REVIEW`.

Client form inside:
- Receipt image via `<img src="/api/expenses/[id]/image">`
- Editable: amount, currency, merchant, category, note
- Line items table: name / qty / unit price / line total -- each row editable
- **Confirm** button: PATCH `/api/expenses/[id]/confirm` with edited fields, redirect to `/`
- **Discard** button: PATCH confirm endpoint with `{ discard: true }`, sets status FAILED, redirect to `/`

## Confirm API (`PATCH /api/expenses/[id]/confirm`)

Body:
```json
{
  "amount": 24.50,
  "currency": "USD",
  "merchant": "Nobu",
  "category": "FOOD",
  "note": "dinner",
  "discard": false,
  "items": [
    { "name": "Tuna", "qty": 1, "unitPrice": 18.00, "total": 18.00, "category": "FOOD" }
  ]
}
```

Server:
1. Verify expense belongs to caller's active trip.
2. If `discard: true`: set status FAILED, return 200.
3. Else: delete existing LineItems, insert new ones, update Expense fields + status CONFIRMED.
4. If source is TELEGRAM_PHOTO: load the expense's linked Job, read `chatId` from its `payloadJson`, send Telegram reply.

## Image Serve API (`GET /api/expenses/[id]/image`)

1. Auth check: caller must be trip member.
2. Read `expense.imagePath` from DB.
3. Stream file from disk with `Content-Type` inferred from extension.
4. Return 404 if no imagePath or file missing.

## Storage

- Upload dir: `uploads/` at project root (created on first write, gitignored).
- Filename: `<expenseId>.<ext>` (ext from MIME type or Telegram file extension).
- Max upload size: 10 MB enforced in the photo API route.
- Telegram photos: download the largest `PhotoSize` in `message.photo[]`.

## Error Handling

- Upload fails to save: return 500, no Expense created.
- Gemini Vision fails: job retries (P2 backoff: 30s/120s/480s), expense stays PROCESSING. After max attempts: FAILED.
- Image missing when worker runs: job fails immediately, expense set FAILED.
- Review page accessed after confirm: redirect to `/` (status no longer NEEDS_REVIEW).

## What P3 Does Not Include

- Signed image URLs (P5).
- Litestream backup of uploads (P5).
- Multi-photo receipts.
- Re-parse after editing (discard + re-upload).
