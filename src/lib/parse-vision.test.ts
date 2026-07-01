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
