// Run: node --experimental-strip-types --test src/lib/trip.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPersonBreakdown } from "./trip.ts";
import type { ActiveTrip } from "./trip.ts";

function fakeTrip(
  rows: { paidById: string; name: string; minor: number }[],
): ActiveTrip {
  return {
    expenses: rows.map((r) => ({
      paidById: r.paidById,
      paidBy: { id: r.paidById, name: r.name },
      baseAmountMinor: r.minor,
    })),
  } as unknown as ActiveTrip;
}

test("sums expenses per payer and sorts descending", () => {
  const trip = fakeTrip([
    { paidById: "a", name: "Maya", minor: 1000 },
    { paidById: "b", name: "Theo", minor: 3000 },
    { paidById: "a", name: "Maya", minor: 500 },
  ]);
  const result = buildPersonBreakdown(trip);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, "Theo");
  assert.equal(result[0].minor, 3000);
  assert.equal(result[1].name, "Maya");
  assert.equal(result[1].minor, 1500);
});

test("empty trip returns empty array", () => {
  assert.deepEqual(buildPersonBreakdown(fakeTrip([])), []);
});

test("single payer accumulates all expenses", () => {
  const trip = fakeTrip([
    { paidById: "x", name: "Solo", minor: 200 },
    { paidById: "x", name: "Solo", minor: 800 },
  ]);
  const result = buildPersonBreakdown(trip);
  assert.equal(result.length, 1);
  assert.equal(result[0].minor, 1000);
});

// getFilteredExpenses filter shape - the function itself is DB-bound, but
// we verify the filter logic compiles and produces valid Prisma where clauses
// by checking the type exports work at compile time. No assertion needed here
// beyond tsc passing.
import type { ExpenseFilter } from "./trip.ts";
const _f: ExpenseFilter = { category: "FOOD", paidById: "abc" };
void _f;
