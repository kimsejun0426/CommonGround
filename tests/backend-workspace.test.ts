import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../lib/api-errors.ts";
import { applyConsent, createDemoScenario, evaluateScenario, proposeScenario } from "../lib/engine.ts";
import { approveProposal, fingerprintScenario, type ApprovedQuote, type StoredProposal } from "../lib/server-quotes.ts";
import type { PaymentAttempt } from "../lib/paypal-service.ts";
import { assertWorkspaceMayChange, findActiveCheckout, resolveOptionalGuidance, type CheckoutProtectionStore } from "../lib/workspace-protection.ts";

const ownerId = "owner-1";
const blocked = (error: unknown) => error instanceof ApiError && error.code === "CHECKOUT_IN_PROGRESS";
async function fixture() {
  const scenario = applyConsent(createDemoScenario(), "luma", "accepted");
  const now = Date.now();
  const proposal: StoredProposal = { id: "proposal_original", ownerId, fingerprint: await fingerprintScenario(scenario), scenarioJson: JSON.stringify(scenario), proposalJson: JSON.stringify(proposeScenario(scenario)), mode: "rules_demo", aiSelectionJson: null, createdAt: now, expiresAt: now + 3_600_000 };
  const quote = await approveProposal(proposal, { ownerId, fingerprint: proposal.fingerprint, scenario, approvedBuyerIds: ["luma", "juniper", "forma"] }, now);
  const prices = evaluateScenario(scenario).buyerQuotes;
  function attempt(index: number, completed = true): PaymentAttempt {
    const buyer = prices[index];
    return { id: `attempt_${buyer.buyerId}`, ownerId, quoteId: quote.id, buyerId: buyer.buyerId,
      quoteHash: "hash", quoteJson: "{}", expectedAmountCents: buyer.totalCents, currency: "USD",
      createRequestId: `create_${buyer.buyerId}`, captureRequestId: `capture_${buyer.buyerId}`,
      paypalOrderId: completed ? `ORDER${buyer.buyerId.toUpperCase()}123` : null,
      captureId: completed ? `CAPTURE${buyer.buyerId.toUpperCase()}123` : null, approvalUrl: null,
      status: completed ? "COMPLETED" : "CREATING", verifiedAt: completed ? now : null,
      lockUntil: 0, lastErrorCode: null, createdAt: now, updatedAt: now };
  }
  let active: ApprovedQuote | null = quote;
  let attempts: PaymentAttempt[] = [attempt(0)];
  const store: CheckoutProtectionStore = {
    activeQuote: async user => user === ownerId ? active : null,
    attempts: async (user, id) => attempts.filter(row => row.ownerId === user && row.quoteId === id),
  };
  return { now, quote, store, attempt, get active() { return active; }, get attempts() { return attempts; },
    setActive(value: ApprovedQuote | null) { active = value; }, setAttempts(value: PaymentAttempt[]) { attempts = value; } };
}

test("a second tab without any local reference discovers the owner's partially paid checkout", async () => {
  const f = await fixture();
  assert.equal((await findActiveCheckout(ownerId, f.store))?.id, f.quote.id);
  assert.equal(await findActiveCheckout("different-owner", f.store), null);
  assert.equal(f.attempts[0].status, "COMPLETED");
});

test("one of three completed payments blocks a second tab's proposal replacement and invalidation", async () => {
  const f = await fixture();
  let writes = 0;
  async function replaceFromAnotherTab(target?: string) {
    await assertWorkspaceMayChange(ownerId, f.store, f.now, target);
    writes++; f.setActive(null);
  }
  await assert.rejects(replaceFromAnotherTab(), blocked);
  await assert.rejects(replaceFromAnotherTab(f.quote.proposalId), blocked);
  assert.equal(writes, 0);
  assert.equal(f.active?.id, f.quote.id);
  assert.equal(f.attempts.length, 1);
});

test("an uncertain provider create locks the workspace even without an order ID", async () => {
  const f = await fixture(); f.setAttempts([f.attempt(0, false)]);
  await assert.rejects(assertWorkspaceMayChange(ownerId, f.store, f.now), blocked);
});

test("all verified completions allow a new plan while preserving original records", async () => {
  const f = await fixture(); f.setAttempts([0, 1, 2].map(i => f.attempt(i)));
  const records = JSON.stringify(f.attempts);
  await assertWorkspaceMayChange(ownerId, f.store, f.now);
  assert.equal(JSON.stringify(f.attempts), records);
  f.attempts[1].expectedAmountCents = 1;
  await assert.rejects(assertWorkspaceMayChange(ownerId, f.store, f.now), blocked);
});

test("expiry permits explicit archival without mutating or refunding partial payments", async () => {
  const f = await fixture();
  const records = JSON.stringify(f.attempts);
  await assertWorkspaceMayChange(ownerId, f.store, f.quote.expiresAt);
  assert.equal((await findActiveCheckout(ownerId, f.store))?.id, f.quote.id);
  assert.equal(JSON.stringify(f.attempts), records);
});

test("an unstarted quote or unrelated old proposal does not prevent a valid edit", async () => {
  const f = await fixture();
  await assertWorkspaceMayChange(ownerId, f.store, f.now, "unrelated_old_proposal");
  f.setAttempts([]);
  await assertWorkspaceMayChange(ownerId, f.store, f.now);
});

test("a storage ownership mismatch fails closed during recovery", async () => {
  const f = await fixture();
  const badStore: CheckoutProtectionStore = { ...f.store, activeQuote: async () => ({ ...f.quote, ownerId: "other-owner" }) };
  await assert.rejects(findActiveCheckout(ownerId, badStore), (e: unknown) => e instanceof ApiError && e.code === "QUOTE_NOT_FOUND");
});

test("guidance outage gives an explicit rules result instead of blocking quote creation", async () => {
  const result = await resolveOptionalGuidance(true, true, async () => { throw new Error("provider payload containing a secret"); });
  assert.equal(result.selection, null);
  assert.equal(result.guidanceStatus, "error");
  assert.doesNotMatch(JSON.stringify(result), /secret|provider payload/);
  assert.match(result.guidanceError ?? "", /without AI/);
});

test("checkout-only and unconfigured proposals never invoke the AI provider", async () => {
  let calls = 0;
  const select = async () => { calls++; return { fact: "known" }; };
  assert.equal((await resolveOptionalGuidance(false, true, select)).guidanceStatus, "skipped");
  assert.equal((await resolveOptionalGuidance(true, false, select)).guidanceStatus, "not_configured");
  assert.equal(calls, 0);
  const result = await resolveOptionalGuidance(true, true, select);
  assert.equal(result.guidanceStatus, "ready");
  assert.deepEqual(result.selection, { fact: "known" });
  assert.equal(calls, 1);
});
