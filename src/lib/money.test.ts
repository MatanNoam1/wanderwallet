// Run: npm test  (node:test + node:assert, no framework needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { toMinor, fromMinor, fmt, convertMinor, decimalsFor } from "./money.ts";

test("zero-decimal currencies are not treated as cents", () => {
  assert.equal(decimalsFor("JPY"), 0);
  assert.equal(toMinor(1500, "JPY"), 1500); // 1500 yen = 1500 minor units, not 150000
  assert.equal(fromMinor(1500, "JPY"), 1500);
  assert.equal(fmt(1500, "JPY"), "¥1,500");
});

test("two-decimal currencies round to cents", () => {
  assert.equal(toMinor(12.5, "USD"), 1250);
  assert.equal(toMinor(0.1 + 0.2, "USD"), 30); // float dust rounded away
  assert.equal(fmt(524000, "USD"), "$5,240.00");
});

test("convertMinor respects target currency decimals", () => {
  // 100.00 EUR at 1.1 EUR->USD = 110.00 USD
  assert.equal(convertMinor(10000, "EUR", "USD", 1.1), 11000);
  // same currency is a no-op regardless of rate
  assert.equal(convertMinor(9999, "USD", "USD", 123), 9999);
  // 1000 JPY -> USD at 0.0064 = $6.40 = 640 minor units
  assert.equal(convertMinor(1000, "JPY", "USD", 0.0064), 640);
});
