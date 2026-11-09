import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, assertSameOrigin, exactBody, readJsonBody } from "../lib/api-errors.ts";
import { allowsLocalDemoIdentity } from "../lib/server-auth-policy.ts";
import { applyConsent, createDemoScenario, evaluateScenario, proposeScenario, updateBuyer } from "../lib/engine.ts";
import { approveProposal, fingerprintScenario, payableBuyerQuote, validatedScenario, verifyApprovedQuote, type StoredProposal } from "../lib/server-quotes.ts";
import { PayPalClient, verifyCompletedOrder, type PayableQuote, type PayPalOrder } from "../lib/paypal.ts";
import { PaymentService, type PaymentAttempt, type PaymentProvider, type PaymentStore } from "../lib/paypal-service.ts";
import { summarizeCohort } from "../lib/server-cohort.ts";
import { buildSelectionContext, extractAIOutput, selectWithOpenAI, validateAISelection } from "../lib/ai-proposal.ts";

const owner = "owner-1";
const accepted = () => applyConsent(createDemoScenario(), "luma", "accepted");
function hasCode(code: string) { return (error: unknown) => error instanceof ApiError && error.code === code; }

async function makeProposal(scenario = accepted()): Promise<StoredProposal> {
  const now = Date.now();
  return { id: "proposal_test", ownerId: owner, fingerprint: await fingerprintScenario(scenario), scenarioJson: JSON.stringify(scenario), proposalJson: JSON.stringify(proposeScenario(scenario)), mode: "rules_demo", aiSelectionJson: null, createdAt: now, expiresAt: now + 3_600_000 };
}
async function makeApproved(scenario = accepted()) {
  const proposal = await makeProposal(scenario);
  return approveProposal(proposal, { ownerId: owner, fingerprint: proposal.fingerprint, scenario, approvedBuyerIds: ["luma", "juniper", "forma"] });
}

test("the immutable approved quote is recomputed in cents, including each buyer's shipping", async () => {
  const quote = await makeApproved();
  const evaluation = await verifyApprovedQuote(quote, owner);
  assert.equal(evaluation.totalCents, 19700);
  assert.deepEqual(evaluation.buyerQuotes.map((q) => q.totalCents), [8200, 6575, 4925]);
  for (const buyer of evaluation.buyerQuotes) {
    const payable = payableBuyerQuote(quote, evaluation, buyer.buyerId);
    assert.equal(payable.items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0), buyer.totalCents);
    assert.equal(payable.items.find((i) => i.id.endsWith("shipping"))?.totalCents, 800);
  }
});

test("a promising hypothetical candidate and all-final-price ticks cannot replace physical consent", async () => {
  const scenario = createDemoScenario();
  assert.equal(proposeScenario(scenario).feasibleIfAccepted, true);
  await assert.rejects(makeApproved(scenario), hasCode("COHORT_NOT_ORDERABLE"));
});

test("every active buyer's final quote approval is required without duplicates or unknown IDs", async () => {
  const scenario = accepted();
  const proposal = await makeProposal(scenario);
  for (const ids of [["luma"], ["luma", "juniper", "juniper"], ["luma", "juniper", "forma", "outsider"], []]) {
    await assert.rejects(approveProposal(proposal, { ownerId: owner, fingerprint: proposal.fingerprint, scenario, approvedBuyerIds: ids }), hasCode("FINAL_QUOTE_APPROVAL_REQUIRED"));
  }
});

test("owner boundaries and changed scenario fingerprints reject stale final consent", async () => {
  const scenario = accepted();
  const proposal = await makeProposal(scenario);
  await assert.rejects(approveProposal(proposal, { ownerId: "attacker", fingerprint: proposal.fingerprint, scenario, approvedBuyerIds: ["luma", "juniper", "forma"] }), hasCode("PROPOSAL_NOT_FOUND"));
  const changed = updateBuyer(scenario, "forma", { quantity: 20 });
  await assert.rejects(approveProposal(proposal, { ownerId: owner, fingerprint: proposal.fingerprint, scenario: changed, approvedBuyerIds: ["luma", "juniper", "forma"] }), hasCode("STALE_QUOTE"));
  const quote = await makeApproved();
  await assert.rejects(verifyApprovedQuote(quote, "attacker"), hasCode("QUOTE_NOT_FOUND"));
});

test("forged supplier prices, browser amounts and altered persisted totals cannot become payable", async () => {
  const scenario = accepted();
  scenario.supplier.baseUnitCents.kraft = 1;
  assert.throws(() => validatedScenario(scenario), hasCode("INVALID_SCENARIO"));
  assert.throws(() => exactBody({ quoteId: "quote_test", buyerId: "luma", amount: "0.01" }, ["quoteId", "buyerId"]), hasCode("UNEXPECTED_FIELD"));
  const quote = await makeApproved();
  const forged = JSON.parse(quote.evaluationJson);
  forged.buyerQuotes[0].totalCents = 1;
  await assert.rejects(verifyApprovedQuote({ ...quote, evaluationJson: JSON.stringify(forged) }, owner), hasCode("STALE_QUOTE"));
});

test("budget, lead-time, departure and declined-substitution conflicts remain blocked", async () => {
  const scenarios = [
    applyConsent(updateBuyer(createDemoScenario(), "luma", { budgetCents: 1 }), "luma", "accepted"),
    applyConsent(updateBuyer(createDemoScenario(), "juniper", { maxLeadDays: 1 }), "luma", "accepted"),
    applyConsent(updateBuyer(createDemoScenario(), "forma", { active: false }), "luma", "accepted"),
    applyConsent(createDemoScenario(), "luma", "declined"),
  ];
  for (const scenario of scenarios) await assert.rejects(makeApproved(scenario), hasCode("COHORT_NOT_ORDERABLE"));
});

test("local identity bypass requires an explicit development setting and localhost", () => {
  const good = { isDev: true, nodeEnv: "development", enabled: "true", hostname: "localhost" };
  assert.equal(allowsLocalDemoIdentity(good), true);
  for (const patch of [{ isDev: false }, { nodeEnv: "production" }, { enabled: "" }, { hostname: "example.com" }, { hostname: "localhost.evil.test" }]) {
    assert.equal(allowsLocalDemoIdentity({ ...good, ...patch }), false);
  }
});

test("JSON body limits and origin checks fail before processing", async () => {
  assert.throws(() => assertSameOrigin(new Request("https://app.example/api", { headers: { origin: "https://attacker.example" } })), hasCode("ORIGIN_NOT_ALLOWED"));
  await assert.rejects(readJsonBody(new Request("https://app.example", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ large: "x".repeat(300) }) }), 100), hasCode("REQUEST_TOO_LARGE"));
});

test("AI cannot invent a supplier, price, action, question or evidence fact", () => {
  const scenario = createDemoScenario();
  const context = buildSelectionContext(scenario, proposeScenario(scenario));
  const valid = { actionId: "ask_luma_substitution", buyerId: "luma", questionId: "luma_kraft_black_sleeve", factIds: ["allowed_substitution", "moq_rule"] };
  assert.equal(validateAISelection(valid, context).source, "openai");
  for (const payload of [{ ...valid, price: 1 }, { ...valid, factIds: ["invented_discount"] }, { ...valid, actionId: "charge_everyone" }, { ...valid, buyerId: "forma" }, { ...valid, questionId: "invented_supplier" }]) {
    assert.throws(() => validateAISelection(payload, context), hasCode("AI_UNGROUNDED_SELECTION"));
  }
});

test("missing credentials and incomplete AI responses never masquerade as a live success", async () => {
  let called = false;
  const fakeFetch = (async () => { called = true; throw Error("forbidden"); }) as typeof fetch;
  const scenario = createDemoScenario();
  await assert.rejects(selectWithOpenAI(scenario, proposeScenario(scenario), { aiReady: false, openaiApiKey: "", openaiModel: "gpt-5.4-mini" }, fakeFetch), hasCode("AI_NOT_CONFIGURED"));
  assert.equal(called, false);
  assert.throws(() => new PayPalClient("", ""), hasCode("PAYPAL_NOT_CONFIGURED"));
  assert.throws(() => extractAIOutput({ status: "incomplete", output: [] }), hasCode("AI_INCOMPLETE"));
  assert.throws(() => extractAIOutput({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "refusal" }] }] }), hasCode("AI_REFUSED"));
});

class MemoryStore implements PaymentStore {
  rows: PaymentAttempt[] = [];
  async insertIfAbsent(row: PaymentAttempt) { if (!this.rows.some((r) => r.ownerId === row.ownerId && r.quoteId === row.quoteId && r.buyerId === row.buyerId)) this.rows.push(structuredClone(row)); }
  async findByQuoteBuyer(ownerId: string, quoteId: string, buyerId: string) { return structuredClone(this.rows.find((r) => r.ownerId === ownerId && r.quoteId === quoteId && r.buyerId === buyerId) ?? null); }
  async findByOrder(ownerId: string, orderId: string) { return structuredClone(this.rows.find((r) => r.ownerId === ownerId && r.paypalOrderId === orderId) ?? null); }
  async listForQuote(ownerId: string, quoteId: string) { return structuredClone(this.rows.filter((r) => r.ownerId === ownerId && r.quoteId === quoteId)); }
  async claim(id: string, ownerId: string, now: number, lockUntil: number) { const row = this.rows.find((r) => r.id === id && r.ownerId === ownerId && r.lockUntil <= now); if (!row) return false; row.lockUntil = lockUntil; return true; }
  async update(id: string, ownerId: string, patch: Partial<PaymentAttempt>) { const row = this.rows.find((r) => r.id === id && r.ownerId === ownerId); if (row) Object.assign(row, patch); }
}
class FakePayPal implements PaymentProvider {
  orders = new Map<string, PayPalOrder>();
  createCalls = 0; captureCalls = 0; loseCaptureResponse = false;
  async createOrder(quote: PayableQuote, attemptId: string, _requestId: string) {
    const id = `ORDER00000${++this.createCalls}`;
    const order: PayPalOrder = { id, status: "CREATED", intent: "CAPTURE", links: [{ rel: "approve", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }], purchase_units: [{ reference_id: attemptId, custom_id: attemptId, amount: { currency_code: "USD", value: (quote.totalCents / 100).toFixed(2) } }] };
    this.orders.set(id, order); return structuredClone(order);
  }
  async getOrder(id: string) { return structuredClone(this.orders.get(id)!); }
  async captureOrder(id: string, _requestId: string) {
    this.captureCalls += 1;
    const order = this.orders.get(id)!;
    order.status = "COMPLETED";
    order.purchase_units![0].payments = { captures: [{ id: `CAPTURE0000${this.captureCalls}`, status: "COMPLETED", amount: { ...order.purchase_units![0].amount } }] };
    if (this.loseCaptureResponse) throw new ApiError(503, "PAYPAL_UNAVAILABLE", "Simulated response loss", true);
    return structuredClone(order);
  }
}
async function paymentFixture() {
  const quote = await makeApproved();
  const evaluation = await verifyApprovedQuote(quote, owner);
  const store = new MemoryStore();
  const provider = new FakePayPal();
  const service = new PaymentService(store, provider);
  const payable = payableBuyerQuote(quote, evaluation, "luma");
  return { quote, evaluation, store, provider, service, payable };
}

test("create is idempotent per buyer and a quote cannot change after its order is created", async () => {
  const f = await paymentFixture();
  const first = await f.service.create(owner, f.payable);
  assert.equal((await f.service.create(owner, f.payable)).orderId, first.orderId);
  assert.equal(f.provider.createCalls, 1);
  const changed = structuredClone(f.payable);
  changed.totalCents += 1; changed.items[2].totalCents += 1; changed.items[2].unitPriceCents += 1;
  await assert.rejects(f.service.create(owner, changed), hasCode("QUOTE_LOCKED"));
});

test("capture checks approval, owner and quote binding before transferring money", async () => {
  const f = await paymentFixture();
  const order = await f.service.create(owner, f.payable);
  await assert.rejects(f.service.capture("attacker", order.orderId), hasCode("ORDER_NOT_FOUND"));
  await assert.rejects(f.service.capture(owner, order.orderId, { quoteId: "other_quote" }), hasCode("ORDER_QUOTE_MISMATCH"));
  await assert.rejects(f.service.capture(owner, order.orderId), hasCode("ORDER_NOT_APPROVED"));
  f.provider.orders.get(order.orderId)!.status = "APPROVED";
  await assert.rejects(f.service.capture(owner, order.orderId, { allowNewCapture: false }), hasCode("STALE_QUOTE"));
  assert.equal(f.provider.captureCalls, 0);
});

test("wrong USD amount or provider binding is rejected before capture", async () => {
  const f = await paymentFixture();
  const result = await f.service.create(owner, f.payable);
  const order = f.provider.orders.get(result.orderId)!;
  order.status = "APPROVED";
  order.purchase_units![0].amount!.value = "0.01";
  await assert.rejects(f.service.capture(owner, result.orderId), hasCode("PAYMENT_VERIFICATION_FAILED"));
  order.purchase_units![0].amount!.value = "82.00";
  order.purchase_units![0].custom_id = "another_attempt";
  await assert.rejects(f.service.capture(owner, result.orderId), hasCode("PAYMENT_VERIFICATION_FAILED"));
  assert.equal(f.provider.captureCalls, 0);
});

test("lost capture response is reconciled; retry does not capture a second time", async () => {
  const f = await paymentFixture();
  const result = await f.service.create(owner, f.payable);
  f.provider.orders.get(result.orderId)!.status = "APPROVED";
  f.provider.loseCaptureResponse = true;
  assert.equal((await f.service.capture(owner, result.orderId)).verified, true);
  assert.equal((await f.service.capture(owner, result.orderId, { allowNewCapture: false })).status, "COMPLETED");
  assert.equal(f.provider.captureCalls, 1);
  const cohort = summarizeCohort(f.evaluation, f.store.rows, true);
  assert.equal(cohort.cohortStatus, "PARTIALLY_PAID");
  assert.equal(cohort.readyToProceed, false);
});

test("only all verified individual captures make the current cohort ready", async () => {
  const f = await paymentFixture();
  for (const buyer of f.evaluation.buyerQuotes) {
    const order = await f.service.create(owner, payableBuyerQuote(f.quote, f.evaluation, buyer.buyerId));
    f.provider.orders.get(order.orderId)!.status = "APPROVED";
    await f.service.capture(owner, order.orderId);
  }
  assert.equal(summarizeCohort(f.evaluation, f.store.rows, true).readyToProceed, true);
  assert.equal(summarizeCohort(f.evaluation, f.store.rows, false).readyToProceed, false);
  f.store.rows[0].expectedAmountCents = 1;
  assert.equal(summarizeCohort(f.evaluation, f.store.rows, true).readyToProceed, false);
});

test("COMPLETED alone is insufficient without matching capture currency and amount", () => {
  const order: PayPalOrder = { id: "ORDER000001", status: "COMPLETED", intent: "CAPTURE", purchase_units: [{ reference_id: "attempt", custom_id: "attempt", amount: { currency_code: "USD", value: "82.00" }, payments: { captures: [{ id: "CAPTURE0001", status: "COMPLETED", amount: { currency_code: "EUR", value: "82.00" } }] } }] };
  assert.throws(() => verifyCompletedOrder(order, { orderId: "ORDER000001", attemptId: "attempt", totalCents: 8200 }), hasCode("PAYMENT_VERIFICATION_FAILED"));
});
