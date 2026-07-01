# P6: Backlog Cleanup - Design

**Status:** Approved
**Scope:** 8 independent, mechanical fixes carried over from P4 and P5 code review findings. No new user-facing features. No schema migrations.

## Why

P4 and P5 both shipped with a small tail of Minor-severity review findings that were correctly deferred rather than blocking merge. They're accumulating. P6 clears the backlog in one pass before starting new feature work, so future reviews aren't re-flagging the same known issues.

## Non-goals

- Item #5 from the P4 backlog (`FAILED` status overloaded for both worker-failure and user-discard) is explicitly out of scope. Fixing it needs a new Prisma enum value and a migration, for a purely historical-reporting gap on a 2-person self-hosted app. Not worth the migration right now.
- No new features, no OAuth work (still deferred to deploy per the 2026-07-01 decision log entry), no deploy/ops work.

## Items

### 1. Telegram ack reply can crash the webhook handler

**File:** `src/app/api/telegram/route.ts:207` (calls `src/lib/telegram.ts:4-8` `sendTelegramReply`)

**Current behavior:** `handlePhoto()` awaits `sendTelegramReply(...)` after the DB transaction has already committed. `sendTelegramReply` has no error handling - a failed `fetch` (Telegram API down, bad token, network blip) throws unhandled, which propagates out of the webhook handler.

**Fix:** Wrap the `sendTelegramReply` call in try/catch at the call site in `handlePhoto`. Log the error (`console.error` matching this file's existing error-logging style) and continue - the expense/job is already persisted, so a failed ack reply is a UX nicety, not a correctness issue. Do not retry the send.

### 2. `as never` casts on category in confirm route

**File:** `src/app/api/expenses/[id]/confirm/route.ts:85` (`lineItem.createMany`) and `:98` (`expense.update`)

**Current behavior:** Both lines cast the Zod-validated category value `as never` to satisfy Prisma's generated types, which suppresses type-checking entirely rather than asserting the real type.

**Fix:** Import the `Category` type (check `src/lib/categories.ts` for how it's exported, or derive from `@prisma/client` if that's where the enum type lives - match whatever pattern `src/app/api/expenses/[id]/route.ts` already uses for its `category` cast, since that route was written in P5 with a real type, not `as never`). Line 85 (`LineItem.category`, nullable per schema) casts `as Category | null`. Line 98 (`Expense.category`, non-nullable) casts `as Category`.

### 3. Confirm route leaks expense existence via check ordering

**File:** `src/app/api/expenses/[id]/confirm/route.ts:45-54`

**Current behavior:** Checks run in this order: (1) expense exists? -> 404, (2) status is `NEEDS_REVIEW`? -> 409, (3) caller is a trip member? -> 403. An unauthorized (non-member) caller who guesses/knows an expense ID gets a 409 for an already-confirmed expense vs a 404 for one that doesn't exist - leaking existence and status to someone with no access.

**Fix:** Reorder so the membership/authorization check runs immediately after the existence check, before the status check: exists (404) -> member (403) -> status (409). This matches the ordering already used in `src/app/api/expenses/[id]/route.ts` (Task 1 of P5), which checks membership before doing any state-dependent logic.

### 4. Orphaned upload files on discard and permanent worker failure

**Files:**
- Discard path: `src/app/api/expenses/[id]/confirm/route.ts:63` (sets `status: ExpenseStatus.FAILED` on user discard)
- Permanent-failure path: `src/lib/worker.ts:75` (sets `status: ExpenseStatus.FAILED` after max retry attempts)

**Current behavior:** Neither path deletes the receipt image file from disk (`UPLOADS_DIR`). Files accumulate indefinitely.

**Fix:** In both paths, after the DB status update succeeds, delete the file at `expense.imagePath` (if set) using `fs.unlink`, wrapped in try/catch - a failed unlink (file already gone, permission issue) should be logged, not thrown, and must never block or roll back the status transition that already succeeded. Look at how `UPLOADS_DIR` is resolved elsewhere (likely `src/lib/uploads.ts` or similar) and reuse that path-joining logic rather than hand-rolling it.

### 5. Duplicate "View all expenses" links on the dashboard

**Files:** `src/components/ExpenseFeed.tsx` (conditional link when `trip.expenses.length > 8`) and `src/app/page.tsx` (unconditional link added in P5 Task 3, directly below `<ExpenseFeed trip={trip} />`)

**Current behavior:** With more than 8 expenses, the dashboard shows two separate "View all" links to `/expenses` - one inside the feed card, one right below it.

**Fix:** Remove the conditional link and its surrounding `{trip.expenses.length > 8 && (...)}` block from `ExpenseFeed.tsx`. Keep `page.tsx`'s unconditional link - the P5 plan's stated intent was for the dashboard link to always be visible regardless of expense count, so that's the one that should survive.

### 6. `≈` regressed to `=` for FX-converted amounts

**Files:** `src/components/ExpenseFeed.tsx`, `src/app/expenses/page.tsx`, `src/components/ExpenseDetail.tsx` - everywhere a converted base-currency amount is shown next to the original (search for the pattern `{fmt(...baseAmountMinor...)}` preceded by a literal `=`).

**Current behavior:** All three P5-era components show `= {fmt(baseAmountMinor, baseCurrency)}` next to the original amount when currencies differ. This is a converted estimate (uses a cached/daily FX rate), not an exact equality.

**Fix:** Replace the literal `=` with `≈` in all three locations. No other logic changes.

### 7. `getFilteredExpenses` has no membership check of its own

**File:** `src/lib/trip.ts` (function `getFilteredExpenses(tripId, filter)`)

**Current behavior:** Takes a bare `tripId` and queries without verifying the caller has access to that trip. Safe today because its only caller (`src/app/expenses/page.tsx`) always passes a `trip.id` already obtained from `getActiveTrip(user.id)`, which is itself user-scoped.

**Fix:** Doc comment only, no behavior change. Add a one-line comment above the function noting it trusts the caller to have already verified trip membership, and must not be called with an unvalidated `tripId`. Do not add a redundant DB check - the existing scoping is sound, this just guards against a future caller getting it wrong silently.

### 8. Type-stub test asserts nothing

**File:** `src/lib/trip.ts` (`getFilteredExpenses`), `src/lib/trip.test.ts` (the stub near the bottom that constructs an `ExpenseFilter` and `void`s it, added in P5 Task 3)

**Current behavior:** The "test" only exercises the TypeScript compiler (constructs a typed object, discards it) - it runs under `npm test` but asserts nothing about runtime behavior, padding the test count without adding coverage.

**Fix:** Extract the filter-matching logic into a pure, exported function `matchesExpenseFilter(expense: { category: string; paidById: string; status: string }, filter: ExpenseFilter): boolean` in `src/lib/trip.ts`, that checks `status === "CONFIRMED"` plus optional `category`/`paidById` equality - the same conditions currently inlined into the Prisma `where` clause. Rewrite `getFilteredExpenses` to build its Prisma `where` clause the same way it does now (this is a DB query, the predicate function is a separate reusable piece, not a replacement for the query - do not try to filter in memory instead of in SQL). Replace the type-stub in `trip.test.ts` with 3-4 real unit tests against `matchesExpenseFilter` using plain object fakes (no DB, no mocks), covering: no filter (matches any confirmed), category filter matches/doesn't match, paidById filter matches/doesn't match, non-CONFIRMED status never matches regardless of other filters.

## File Map

| File | Action | Items |
|------|--------|-------|
| `src/app/api/telegram/route.ts` | Modify | 1 |
| `src/app/api/expenses/[id]/confirm/route.ts` | Modify | 2, 3, 4 |
| `src/lib/worker.ts` | Modify | 4 |
| `src/components/ExpenseFeed.tsx` | Modify | 5, 6 |
| `src/app/expenses/page.tsx` | Modify | 6 |
| `src/components/ExpenseDetail.tsx` | Modify | 6 |
| `src/lib/trip.ts` | Modify | 7, 8 |
| `src/lib/trip.test.ts` | Modify | 8 |

## Testing

- Items 1-4, 7 have no new automated tests (API/integration-level fixes on existing DB-gated routes, consistent with how P4/P5 API routes were tested - manual/tsc-only, no dev server available in isolated worktrees).
- Item 8 adds real unit tests for the extracted predicate function - this is the one item in this plan with new test coverage.
- All items: `npx tsc --noEmit` must stay clean, `npm test` must show no regressions on the existing suite.

## Execution

Same pattern as P4/P5: subagent-driven-development in an isolated worktree, one task-brief per file-group (grouping by file so no two dispatches touch the same file), task review per group, final whole-branch review before merge.
