# P6: Backlog Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear 8 Minor-severity findings carried over from P4/P5 code review (crash-on-error handling, type-safety casts, an info-disclosure ordering bug, disk leak, dead UI, a display regression, and a test that asserts nothing). No new features, no schema migrations.

**Architecture:** Eight independent, small changes grouped into 5 tasks by file overlap (two tasks can't touch the same file, so items sharing a file are merged into one task). No task depends on another's code - all can run in any order.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma 7 + SQLite, Zod, Node built-in test runner.

## Global Constraints

- No new npm dependencies.
- No schema migrations (Prisma schema is unchanged by this plan).
- No em dashes or en dashes anywhere in code/comments/commits.
- Conventional commits; each task ends with a commit.
- Test runner: `npm test` (Node built-in test runner, no jest/vitest).
- `npx tsc --noEmit` must stay clean after every task.
- No dev server is available in an isolated worktree - skip live/manual testing steps that require one; note the skip in each task's report instead of attempting it.

---

## Task 1: Confirm route hardening (auth ordering, type casts, file cleanup)

**Files:**
- Modify: `src/app/api/expenses/[id]/confirm/route.ts`

**Interfaces:**
- Consumes: `Category` type from `@prisma/client` (already imports `ExpenseSource, ExpenseStatus` from there - add `Category` to that import). `uploadAbsPath` from `@/lib/uploads` (existing export, see Task 2 for its signature - it is not modified, just consumed here too).
- Produces: no new exports; route behavior only.

This task fixes three things in the same file: the 403/409 check ordering (item 3), the `as never` casts (item 2), and file cleanup on discard (part of item 4 - the other half, worker.ts, is Task 2).

- [ ] **Step 1: Reorder the existence/membership/status checks**

Current code (lines 41-57) does: exists (404) -> status is NEEDS_REVIEW (409) -> membership (403). Change the order to: exists (404) -> membership (403) -> status (409), so an unauthorized caller never learns the expense's status via the response code.

Read the current file first, then replace this block:

```ts
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
```

with:

```ts
  const expense = await prisma.expense.findUnique({
    where: { id },
    select: { tripId: true, source: true, status: true, imagePath: true },
  });
  if (!expense) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const trip = await prisma.trip.findFirst({
    where: {
      id: expense.tripId,
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    select: { id: true, baseCurrency: true },
  });
  if (!trip) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  if (expense.status !== ExpenseStatus.NEEDS_REVIEW) {
    return NextResponse.json({ error: "NOT_NEEDS_REVIEW" }, { status: 409 });
  }
```

(Note `imagePath: true` was added to the `select` - it's needed by Step 3 below.)

- [ ] **Step 2: Fix the `as never` casts**

Add `Category` to the existing Prisma import at the top of the file:

```ts
import { ExpenseSource, ExpenseStatus, Category } from "@prisma/client";
```

Then find these two lines (inside the `$transaction` block) and fix their casts:

```ts
          category: it.category as never,
```
becomes:
```ts
          category: it.category as Category | null,
```

and:

```ts
        category: b.category as never,
```
becomes:
```ts
        category: b.category as Category,
```

- [ ] **Step 3: Delete the uploaded file on discard**

Add the import at the top of the file:

```ts
import { uploadAbsPath } from "@/lib/uploads";
import { unlink } from "fs/promises";
```

Find the discard branch:

```ts
  if (parsed.data.discard) {
    await prisma.expense.update({ where: { id }, data: { status: ExpenseStatus.FAILED } });
    return NextResponse.json({});
  }
```

Replace with:

```ts
  if (parsed.data.discard) {
    await prisma.expense.update({ where: { id }, data: { status: ExpenseStatus.FAILED } });
    if (expense.imagePath) {
      await unlink(uploadAbsPath(expense.imagePath)).catch((err) => {
        console.error(`[confirm] failed to delete discarded upload ${expense.imagePath}:`, err);
      });
    }
    return NextResponse.json({});
  }
```

The DB status update happens first and is not rolled back if the unlink fails - the file cleanup is best-effort and must never block the discard from succeeding.

- [ ] **Step 4: Verify TypeScript**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet" && npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 5: Manual verification (skip if no dev server)**

If a dev server is available: PATCH a NEEDS_REVIEW expense as a non-member, confirm you get 403 (not 409, not a status-revealing response). Discard a NEEDS_REVIEW expense with an `imagePath` set, confirm the file under `uploads/` is deleted. If no dev server is available in this environment, skip and note it in the report - `tsc` clean is the verification for this task.

- [ ] **Step 6: Commit**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet"
git add src/app/api/expenses/[id]/confirm/route.ts
git commit -m "fix(api): reorder auth before status check, fix category casts, delete file on discard"
```

---

## Task 2: Telegram reply error handling + worker file cleanup

**Files:**
- Modify: `src/app/api/telegram/route.ts`
- Modify: `src/lib/worker.ts`

**Interfaces:**
- Consumes: `uploadAbsPath` from `@/lib/uploads` (existing, signature: `uploadAbsPath(relativePath: string): string`, joins `process.cwd()` with the relative path - same helper Task 1 uses).
- Produces: no new exports.

This task fixes the unguarded Telegram ack-reply await (item 1) and the missing file cleanup on permanent worker failure (the other half of item 4).

- [ ] **Step 1: Guard the Telegram ack reply in `handlePhoto`**

In `src/app/api/telegram/route.ts`, find the end of `handlePhoto` (around line 207):

```ts
  await sendTelegramReply(
    String(chatId),
    "Got your receipt - processing now. I will send you a review link when ready."
  );
  console.log(`[telegram] queued VISION_PARSE job for expense ${expense.id}`);
```

Replace with:

```ts
  await sendTelegramReply(
    String(chatId),
    "Got your receipt - processing now. I will send you a review link when ready."
  ).catch((err) => {
    console.error(`[telegram] failed to send photo-ack reply for expense ${expense.id}:`, err);
  });
  console.log(`[telegram] queued VISION_PARSE job for expense ${expense.id}`);
```

The expense and job are already committed to the DB by this point (the `$transaction` above completed) - a failed ack reply must not throw and must not undo that.

- [ ] **Step 2: Delete the uploaded file on permanent worker failure**

In `src/lib/worker.ts`, add the imports at the top:

```ts
import { unlink } from "fs/promises";
import { uploadAbsPath } from "@/lib/uploads";
```

Find the `catch` block inside `execute`:

```ts
  } catch (err) {
    const failed = job.attempts >= job.maxAttempts;
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: failed ? JobStatus.FAILED : JobStatus.QUEUED,
        lastError: String(err),
        ...(failed ? {} : { runAfter: new Date(Date.now() + backoffMs(job.attempts)) }),
      },
    });
    if (failed && job.expenseId) {
      await prisma.expense.update({
        where: { id: job.expenseId },
        data: { status: ExpenseStatus.FAILED },
      });
    }
    console.error(`[worker] ${job.type} ${jobId} ${failed ? "FAILED" : "retry in backoff"}:`, err);
  }
```

Replace the `if (failed && job.expenseId)` block with:

```ts
    if (failed && job.expenseId) {
      const exp = await prisma.expense.update({
        where: { id: job.expenseId },
        data: { status: ExpenseStatus.FAILED },
        select: { imagePath: true },
      });
      if (exp.imagePath) {
        await unlink(uploadAbsPath(exp.imagePath)).catch((unlinkErr) => {
          console.error(`[worker] failed to delete upload for expense ${job.expenseId}:`, unlinkErr);
        });
      }
    }
```

(`prisma.expense.update` already returns the updated row - adding `select: { imagePath: true }` gets the field without a second query.)

- [ ] **Step 3: Verify TypeScript**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet" && npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 4: Manual verification (skip if no dev server)**

Requires a running worker + a job that exhausts retries - not practical to trigger on demand without live Gemini/Telegram config. Skip and note in the report; `tsc` clean is the verification for this task.

- [ ] **Step 5: Commit**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet"
git add src/app/api/telegram/route.ts src/lib/worker.ts
git commit -m "fix: guard Telegram ack reply errors, delete upload on permanent worker failure"
```

---

## Task 3: Remove duplicate "View all" link, fix approx-equals display

**Files:**
- Modify: `src/components/ExpenseFeed.tsx`
- Modify: `src/app/expenses/page.tsx`
- Modify: `src/components/ExpenseDetail.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports; UI-only changes.

- [ ] **Step 1: Remove the conditional "View all N expenses" link from `ExpenseFeed`**

In `src/components/ExpenseFeed.tsx`, the dashboard (`src/app/page.tsx:81-84`) already renders an unconditional "View all expenses" link right after `<ExpenseFeed trip={trip} />`. Remove the redundant conditional one inside the feed component.

Find:

```tsx
          </ul>
          {trip.expenses.length > 8 && (
            <Link
              href="/expenses"
              className="btn-ghost"
              style={{ textAlign: "center", display: "block", marginTop: "8px" }}
            >
              View all {trip.expenses.length} expenses
            </Link>
          )}
        </>
```

Replace with:

```tsx
          </ul>
        </>
```

- [ ] **Step 2: Fix `≈` in `ExpenseFeed.tsx`**

In the same file, find:

```tsx
                      {e.originalCurrency !== trip.baseCurrency && (
                        <span className="muted small">
                          {" "}
                          = {fmt(e.baseAmountMinor, trip.baseCurrency)}
                        </span>
                      )}
```

Replace `= {fmt` with `≈ {fmt`:

```tsx
                      {e.originalCurrency !== trip.baseCurrency && (
                        <span className="muted small">
                          {" "}
                          ≈ {fmt(e.baseAmountMinor, trip.baseCurrency)}
                        </span>
                      )}
```

- [ ] **Step 3: Fix `≈` in `src/app/expenses/page.tsx`**

Find:

```tsx
                      {e.originalCurrency !== trip.baseCurrency && (
                        <span className="muted small">
                          {" "}= {fmt(e.baseAmountMinor, trip.baseCurrency)}
                        </span>
                      )}
```

Replace with:

```tsx
                      {e.originalCurrency !== trip.baseCurrency && (
                        <span className="muted small">
                          {" "}≈ {fmt(e.baseAmountMinor, trip.baseCurrency)}
                        </span>
                      )}
```

- [ ] **Step 4: Fix `≈` in `src/components/ExpenseDetail.tsx`**

Find:

```tsx
          {expense.originalCurrency !== expense.baseCurrency && (
            <div className="muted small">
              = {fmt(expense.baseAmountMinor, expense.baseCurrency)}
            </div>
          )}
```

Replace with:

```tsx
          {expense.originalCurrency !== expense.baseCurrency && (
            <div className="muted small">
              ≈ {fmt(expense.baseAmountMinor, expense.baseCurrency)}
            </div>
          )}
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet" && npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 6: Manual verification (skip if no dev server)**

With a dev server running: confirm the dashboard shows exactly one "View all expenses" link regardless of expense count, and that every place showing a currency-converted amount uses `≈` not `=`. If no dev server is available, skip and note it in the report.

- [ ] **Step 7: Commit**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet"
git add src/components/ExpenseFeed.tsx src/app/expenses/page.tsx src/components/ExpenseDetail.tsx
git commit -m "fix(ui): drop duplicate view-all link, restore approx-equals for FX display"
```

---

## Task 4: Extract and test `matchesExpenseFilter`, document `getFilteredExpenses` trust boundary

**Files:**
- Modify: `src/lib/trip.ts`
- Modify: `src/lib/trip.test.ts`

**Interfaces:**
- Consumes: `ExpenseFilter` type (already defined in `trip.ts`: `{ category?: CategoryKey; paidById?: string }`).
- Produces: new exported function `matchesExpenseFilter(expense: { category: string; paidById: string; status: string }, filter: ExpenseFilter): boolean` from `src/lib/trip.ts`. Later work outside this plan may reuse this for in-memory filtering (e.g. tests, or a future client-side filter) - the parameter shape is intentionally the minimal fields needed, not a full `Expense`.

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `src/lib/trip.test.ts`, replacing the existing type-stub block:

Find:

```ts
// getFilteredExpenses filter shape - the function itself is DB-bound, but
// we verify the filter logic compiles and produces valid Prisma where clauses
// by checking the type exports work at compile time. No assertion needed here
// beyond tsc passing.
import type { ExpenseFilter } from "./trip.ts";
const _f: ExpenseFilter = { category: "FOOD", paidById: "abc" };
void _f;
```

Replace with:

```ts
import { matchesExpenseFilter } from "./trip.ts";

test("matchesExpenseFilter: no filter matches any confirmed expense", () => {
  const expense = { category: "FOOD", paidById: "a", status: "CONFIRMED" };
  assert.equal(matchesExpenseFilter(expense, {}), true);
});

test("matchesExpenseFilter: category filter matches same category", () => {
  const expense = { category: "FOOD", paidById: "a", status: "CONFIRMED" };
  assert.equal(matchesExpenseFilter(expense, { category: "FOOD" }), true);
});

test("matchesExpenseFilter: category filter rejects different category", () => {
  const expense = { category: "FOOD", paidById: "a", status: "CONFIRMED" };
  assert.equal(matchesExpenseFilter(expense, { category: "HOTELS" }), false);
});

test("matchesExpenseFilter: paidById filter matches same payer", () => {
  const expense = { category: "FOOD", paidById: "a", status: "CONFIRMED" };
  assert.equal(matchesExpenseFilter(expense, { paidById: "a" }), true);
});

test("matchesExpenseFilter: paidById filter rejects different payer", () => {
  const expense = { category: "FOOD", paidById: "a", status: "CONFIRMED" };
  assert.equal(matchesExpenseFilter(expense, { paidById: "b" }), false);
});

test("matchesExpenseFilter: non-CONFIRMED status never matches, even with no filter", () => {
  const expense = { category: "FOOD", paidById: "a", status: "NEEDS_REVIEW" };
  assert.equal(matchesExpenseFilter(expense, {}), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet" && npm test 2>&1 | tail -30
```

Expected: FAIL - `matchesExpenseFilter` is not exported from `trip.ts` yet (import error or undefined function).

- [ ] **Step 3: Implement `matchesExpenseFilter` and use it in `getFilteredExpenses`**

In `src/lib/trip.ts`, find:

```ts
export type ExpenseFilter = {
  category?: CategoryKey;
  paidById?: string;
};

export async function getFilteredExpenses(tripId: string, filter: ExpenseFilter = {}) {
  return prisma.expense.findMany({
    where: {
      tripId,
      status: "CONFIRMED",
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.paidById ? { paidById: filter.paidById } : {}),
    },
    orderBy: { occurredAt: "desc" },
    include: {
      paidBy: { select: { id: true, name: true } },
      paymentMethod: { select: { label: true } },
    },
  });
}
```

Replace with:

```ts
export type ExpenseFilter = {
  category?: CategoryKey;
  paidById?: string;
};

/** Pure predicate mirroring the where-clause built in getFilteredExpenses below. */
export function matchesExpenseFilter(
  expense: { category: string; paidById: string; status: string },
  filter: ExpenseFilter,
): boolean {
  if (expense.status !== "CONFIRMED") return false;
  if (filter.category && expense.category !== filter.category) return false;
  if (filter.paidById && expense.paidById !== filter.paidById) return false;
  return true;
}

// Caller must have already verified the current user is a member of tripId
// (e.g. via getActiveTrip(userId)) - this function does not check membership itself.
export async function getFilteredExpenses(tripId: string, filter: ExpenseFilter = {}) {
  return prisma.expense.findMany({
    where: {
      tripId,
      status: "CONFIRMED",
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.paidById ? { paidById: filter.paidById } : {}),
    },
    orderBy: { occurredAt: "desc" },
    include: {
      paidBy: { select: { id: true, name: true } },
      paymentMethod: { select: { label: true } },
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet" && npm test 2>&1 | tail -30
```

Expected: all tests pass (existing 6 + 6 new = 12 total).

- [ ] **Step 5: Verify TypeScript**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet" && npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet"
git add src/lib/trip.ts src/lib/trip.test.ts
git commit -m "test: extract matchesExpenseFilter with real unit tests, document getFilteredExpenses trust boundary"
```

---

## Self-Review

### Spec coverage

| Spec item | Task |
|-----------|------|
| 1. Telegram ack reply crash | Task 2 |
| 2. `as never` casts in confirm route | Task 1 |
| 3. Confirm route existence leak via check ordering | Task 1 |
| 4. Orphaned upload files (discard + worker failure) | Task 1 (discard) + Task 2 (worker) |
| 5. FAILED status overload | Explicitly out of scope per spec - not a task |
| 6. Duplicate "View all" links | Task 3 |
| 7. `≈` → `=` regression | Task 3 |
| 8. `getFilteredExpenses` membership trust | Task 4 (doc comment) |
| 9. Type-stub test | Task 4 |

### Placeholder scan

None - every step has complete code, exact file paths, and exact commands.

### Type consistency

- `Category` imported from `@prisma/client` in Task 1, matching how `ExpenseSource`/`ExpenseStatus` are already imported in that same file.
- `uploadAbsPath` used identically in Task 1 and Task 2 (same existing signature, no changes to `src/lib/uploads.ts` itself).
- `matchesExpenseFilter`'s parameter shape (`{ category: string; paidById: string; status: string }`) is a subset of fields present on both the Prisma `Expense` model and the plain-object test fakes used in Task 4's tests - no mismatch.
- `ExpenseFilter` type is unchanged (already `{ category?: CategoryKey; paidById?: string }` from P5) - Task 4 only adds a new function next to it, doesn't modify the type.

### Execution note

Tasks 1 and 2 both touch file-cleanup logic using the same `uploadAbsPath` helper but in different files (`confirm/route.ts` vs `worker.ts`) - no file conflict, safe to run in any order. Tasks 3 and 4 touch entirely disjoint files from Tasks 1/2 and each other. All 4 tasks can run in any order; no task's implementer needs output from another task's implementer.
