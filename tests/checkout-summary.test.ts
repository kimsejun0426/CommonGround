import test from "node:test";
import assert from "node:assert/strict";
import { buildCheckoutSummary, checkoutReference } from "../lib/checkout-summary.ts";
import { applyConsent, createDemoScenario, evaluateScenario, updateBuyer } from "../lib/engine.ts";

const scenario = applyConsent(createDemoScenario(), "luma", "accepted");
const quotes = evaluateScenario(scenario).buyerQuotes;

test("sample reference cannot inherit a saved Sandbox quote ID", () => {
  assert.equal(checkoutReference("sample", "quote-server-123", 7), "SAMPLE-CG001-R7");
});

test("Sandbox references exist only after a server quote was actually saved", () => {
  assert.equal(checkoutReference("sandbox", null, 7), null);
  assert.equal(checkoutReference("sandbox", "quote-server-123", 7), "quote-server-123");
});

test("partial sample completion retains the exact outstanding balance", () => {
  const result = buildCheckoutSummary(quotes, { luma: { kind: "sample", amountCents: 8200, reference: "SAMPLE-LUMA" } }, "sample");
  assert.equal(result.totalCents, 19700);
  assert.equal(result.completedCents, 8200);
  assert.equal(result.remainingCents, 11500);
  assert.equal(result.completedCount, 1);
  assert.deepEqual(result.pendingNames, ["JUNIPER", "FORMA"]);
  assert.equal(result.allComplete, false);
});

test("a sample receipt cannot count toward Sandbox totals", () => {
  const result = buildCheckoutSummary(quotes, { luma: { kind: "sample", amountCents: 8200, reference: "SAMPLE-LUMA" } }, "sandbox");
  assert.equal(result.completedCents, 0);
  assert.equal(result.completedCount, 0);
});

test("stale or missing receipt evidence cannot count as a completed share", () => {
  const result = buildCheckoutSummary(quotes, {
    luma: { kind: "sandbox", amountCents: 7830, reference: "CAPTURE" },
    juniper: { kind: "sandbox", amountCents: 6575, reference: "" },
  }, "sandbox");
  assert.equal(result.completedCents, 0);
});

test("all matching Sandbox receipts reconcile to the canonical total", () => {
  const receipts = Object.fromEntries(quotes.map((q) => [q.buyerId, { kind: "sandbox" as const, amountCents: q.totalCents, reference: `CAPTURE-${q.buyerId}` }]));
  const result = buildCheckoutSummary(quotes, receipts, "sandbox");
  assert.equal(result.allComplete, true);
  assert.equal(result.remainingCents, 0);
  assert.equal(result.progressPercent, 100);
});

test("inactive buyers and empty batches never fabricate a completed payment", () => {
  const active = evaluateScenario(updateBuyer(scenario, "luma", { active: false }));
  const result = buildCheckoutSummary(active.buyerQuotes, { luma: { kind: "sample", amountCents: 8200, reference: "SAMPLE-LUMA" } }, "sample");
  assert.equal(result.totalCount, 2);
  assert.equal(result.completedCents, 0);
  const empty = buildCheckoutSummary([], {}, "sample");
  assert.equal(empty.allComplete, false);
  assert.equal(empty.progressPercent, 0);
});
