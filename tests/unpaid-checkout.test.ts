import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../lib/api-errors.ts";
import { verifyUnpaidCheckout } from "../lib/unpaid-checkout.ts";
import type { PaymentAttempt } from "../lib/paypal-service.ts";
import type { PayPalOrder } from "../lib/paypal.ts";

const now = 1_800_000_000_000;
function fixture() {
  const attempt: PaymentAttempt = {
    id: "attempt-luma", ownerId: "owner", quoteId: "quote", buyerId: "luma", quoteHash: "hash", quoteJson: "{}",
    expectedAmountCents: 8200, currency: "USD", createRequestId: "create", captureRequestId: "capture",
    paypalOrderId: "ORDER123456", captureId: null, approvalUrl: null, status: "CREATED", verifiedAt: null,
    lockUntil: 0, lastErrorCode: null, createdAt: now - 1000, updatedAt: now,
  };
  const order: PayPalOrder = { id: attempt.paypalOrderId!, status: "CREATED", intent: "CAPTURE",
    purchase_units: [{ reference_id: attempt.id, custom_id: attempt.id, amount: { currency_code: "USD", value: "82.00" } }] };
  let reads = 0;
  return { attempt, order, get reads() { return reads; }, provider: { async getOrder() { reads++; return structuredClone(order); } } };
}
const code = (wanted: string) => (error: unknown) => error instanceof ApiError && error.code === wanted;

test("unpaid closure verifies authoritative provider state without changing payment records", async () => {
  for (const status of ["CREATED", "PAYER_ACTION_REQUIRED", "VOIDED"]) {
    const f = fixture(); f.order.status = status;
    const before = JSON.stringify(f.attempt);
    await verifyUnpaidCheckout("owner", "quote", [f.attempt], f.provider, now);
    assert.equal(f.reads, 1); assert.equal(JSON.stringify(f.attempt), before);
  }
});
test("provider approval, completion and unknown states keep the quote protected", async () => {
  for (const status of ["APPROVED", "COMPLETED", "SAVED", "UNKNOWN", undefined]) {
    const f = fixture(); f.order.status = status;
    await assert.rejects(verifyUnpaidCheckout("owner", "quote", [f.attempt], f.provider, now), code("CHECKOUT_RECONCILIATION_REQUIRED"));
  }
});
test("a stale CREATED status cannot conceal pending captures or authorizations", async () => {
  for (const payments of [{ captures: [{ status: "PENDING" }] }, { authorizations: [{ status: "CREATED" }] }, { captures: {} }]) {
    const f = fixture(); f.order.purchase_units![0].payments = payments as NonNullable<PayPalOrder["purchase_units"]>[number]["payments"];
    await assert.rejects(verifyUnpaidCheckout("owner", "quote", [f.attempt], f.provider, now), code("CHECKOUT_RECONCILIATION_REQUIRED"));
  }
});
test("captured local records are protected before reading the provider", async () => {
  for (const patch of [{ status: "COMPLETED" }, { captureId: "CAPTURE1234" }, { verifiedAt: now }]) {
    const f = fixture(); Object.assign(f.attempt, patch);
    await assert.rejects(verifyUnpaidCheckout("owner", "quote", [f.attempt], f.provider, now), code("CHECKOUT_HAS_PAYMENT"));
    assert.equal(f.reads, 0);
  }
});
test("unknown create results and active transfers cannot be discarded", async () => {
  for (const patch of [{ paypalOrderId: null }, { lockUntil: now + 1 }, { currency: "EUR" }]) {
    const f = fixture(); Object.assign(f.attempt, patch);
    await assert.rejects(verifyUnpaidCheckout("owner", "quote", [f.attempt], f.provider, now), code("CHECKOUT_RECONCILIATION_REQUIRED"));
    assert.equal(f.reads, 0);
  }
});
test("order identity, merchant quote binding, intent and price must all match", async () => {
  for (const mutate of [
    (o: PayPalOrder) => { o.id = "OTHER123456"; },
    (o: PayPalOrder) => { o.intent = "AUTHORIZE"; },
    (o: PayPalOrder) => { o.purchase_units![0].custom_id = "other"; },
    (o: PayPalOrder) => { o.purchase_units![0].amount!.value = "81.00"; },
    (o: PayPalOrder) => { o.purchase_units![0].amount!.currency_code = "EUR"; },
    (o: PayPalOrder) => { o.purchase_units!.push({}); },
  ]) {
    const f = fixture(); mutate(f.order);
    await assert.rejects(verifyUnpaidCheckout("owner", "quote", [f.attempt], f.provider, now), code("PAYMENT_VERIFICATION_FAILED"));
  }
});
test("ownership, duplicate buyers and provider outages fail closed", async () => {
  const f = fixture();
  await assert.rejects(verifyUnpaidCheckout("other", "quote", [f.attempt], f.provider, now), code("QUOTE_NOT_FOUND"));
  await assert.rejects(verifyUnpaidCheckout("owner", "other", [f.attempt], f.provider, now), code("QUOTE_NOT_FOUND"));
  await assert.rejects(verifyUnpaidCheckout("owner", "quote", [f.attempt, f.attempt], f.provider, now), code("CHECKOUT_RECONCILIATION_REQUIRED"));
  await assert.rejects(verifyUnpaidCheckout("owner", "quote", [f.attempt], { async getOrder() { throw new Error("unavailable"); } }, now), /unavailable/);
  assert.equal(f.reads, 0);
});
test("an unstarted quote needs no provider read", async () => {
  const f = fixture(); await verifyUnpaidCheckout("owner", "quote", [], f.provider, now); assert.equal(f.reads, 0);
});
