import assert from "node:assert/strict";
import test from "node:test";
import {
  applyConsent,
  createDemoScenario,
  evaluateOriginalScenario,
  evaluateScenario,
  getEffectiveConsent,
  getQuantityRange,
  getScenarioConditionsKey,
  getScenarioFingerprintInput,
  parseScenario,
  proposeScenario,
  ScenarioValidationError,
  updateBuyer,
} from "../lib/engine.ts";
import type { BuyerId, Scenario } from "../lib/domain.ts";

function withLargeBudgets(scenario = createDemoScenario()): Scenario {
  for (const id of ["luma", "juniper", "forma"] as BuyerId[]) {
    scenario = updateBuyer(scenario, id, { budgetCents: 100_000_000 });
  }
  return scenario;
}

test("the fixture is explicitly fictional and cloned independently", () => {
  const first = createDemoScenario();
  const second = createDemoScenario();
  assert.equal(first.metadata.fictional, true);
  assert.equal(first.metadata.supplierVerified, false);
  first.supplier.baseUnitCents.kraft = 1;
  first.buyers[0].quantity = 1;
  assert.equal(second.supplier.baseUnitCents.kraft, 120);
  assert.equal(second.buyers[0].quantity, 40);
});

test("100 mixed boxes do not meet two different base-variant MOQs", () => {
  const result = evaluateScenario(createDemoScenario());
  assert.equal(result.totalQuantity, 100);
  assert.equal(result.feasible, false);
  assert.equal(result.priceStatus, "conditional-estimate");
  assert.deepEqual(result.groups.map(({ baseVariant, quantity, shortfall }) => ({ baseVariant, quantity, shortfall })), [
    { baseVariant: "kraft", quantity: 60, shortfall: 40 },
    { baseVariant: "black", quantity: 40, shortfall: 60 },
  ]);
  assert.equal(result.issues.filter((issue) => issue.code === "MOQ_NOT_MET").length, 2);
  assert.equal(result.buyerQuotes.find((quote) => quote.buyerId === "luma")!.substitutionApplied, false);
});

test("a feasible proposal is hypothetical and cannot become a payment-ready evaluation", () => {
  const scenario = createDemoScenario();
  const before = JSON.stringify(scenario);
  const proposal = proposeScenario(scenario);
  assert.equal(proposal.status, "needs-consent");
  assert.equal(proposal.feasibleIfAccepted, true);
  assert.equal(proposal.candidate!.constraintsSatisfied, true);
  assert.equal(proposal.candidate!.feasible, false);
  assert.equal(proposal.candidate!.isHypothetical, true);
  assert.equal(proposal.candidate!.totalCents, 19700);
  assert.deepEqual(proposal.requiredConsents.map((item) => item.buyerId), ["luma"]);
  assert.equal(evaluateScenario(scenario).feasible, false);
  assert.equal(JSON.stringify(scenario), before);
});

test("explicit accepted substitution yields the exact 197-dollar itemized quote", () => {
  const original = createDemoScenario();
  const accepted = applyConsent(original, "luma", "accepted");
  const result = evaluateScenario(accepted);
  assert.equal(result.feasible, true);
  assert.equal(result.isHypothetical, false);
  assert.equal(result.priceStatus, "orderable");
  assert.deepEqual(result.buyerQuotes.map(({ buyerId, baseCents, brandingCents, setupCents, shippingCents, totalCents }) => ({
    buyerId, baseCents, brandingCents, setupCents, shippingCents, totalCents,
  })), [
    { buyerId: "luma", baseCents: 4800, brandingCents: 1400, setupCents: 1200, shippingCents: 800, totalCents: 8200 },
    { buyerId: "juniper", baseCents: 4200, brandingCents: 525, setupCents: 1050, shippingCents: 800, totalCents: 6575 },
    { buyerId: "forma", baseCents: 3000, brandingCents: 375, setupCents: 750, shippingCents: 800, totalCents: 4925 },
  ]);
  assert.equal(result.totalCents, 19700);
  assert.equal(result.buyerQuotes[0].brandingFinish, "black-branded-sleeve");
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].baseVariant, "kraft");
  assert.equal(result.groups[0].quantity, 100);
  assert.deepEqual(result.issues, []);
  assert.equal(original.buyers[0].substitutionConsent.decision, "pending");
});

test("the original MOQ assessment remains distinct after a substitution is accepted", () => {
  const accepted = applyConsent(createDemoScenario(), "luma", "accepted");
  assert.equal(evaluateScenario(accepted).feasible, true);
  const original = evaluateOriginalScenario(accepted);
  assert.equal(original.feasible, false);
  assert.equal(original.groups.length, 2);
  assert.equal(original.buyerQuotes[0].baseVariant, "black");
  assert.equal(getEffectiveConsent(accepted, "luma"), "accepted");
});

test("a decline never applies the substitution and is not silently reproposed", () => {
  const scenario = applyConsent(createDemoScenario(), "luma", "declined");
  assert.equal(evaluateScenario(scenario).feasible, false);
  assert.equal(evaluateScenario(scenario).buyerQuotes[0].baseVariant, "black");
  assert.equal(proposeScenario(scenario).status, "declined");
  assert.equal(proposeScenario(scenario).candidate, null);
  assert.equal(proposeScenario(scenario).feasibleIfAccepted, false);
});

test("an unchanged configuration that already meets both MOQs is preferred", () => {
  let scenario = withLargeBudgets();
  scenario = updateBuyer(scenario, "luma", { quantity: 100 });
  scenario = updateBuyer(scenario, "juniper", { quantity: 75 });
  const proposal = proposeScenario(scenario);
  assert.equal(proposal.status, "already-feasible");
  assert.equal(proposal.current.feasible, true);
  assert.equal(proposal.candidate, null);
  assert.deepEqual(proposal.requiredConsents, []);
  assert.equal(proposal.current.buyerQuotes[0].baseVariant, "black");
  assert.equal(proposal.current.buyerQuotes.reduce((sum, buyer) => sum + buyer.setupCents, 0), 6000);
});

test("quantities above 100 and non-divisible setup shares retain every cent", () => {
  let scenario = withLargeBudgets();
  scenario = updateBuyer(scenario, "luma", { quantity: 41 });
  scenario = applyConsent(scenario, "luma", "accepted");
  const result = evaluateScenario(scenario);
  assert.equal(result.feasible, true);
  assert.equal(result.totalQuantity, 101);
  assert.deepEqual(result.buyerQuotes.map((buyer) => buyer.setupCents), [1218, 1040, 742]);
  assert.equal(result.buyerQuotes.reduce((sum, buyer) => sum + buyer.setupCents, 0), 3000);
  assert.equal(result.totalCents, 19855);
  for (const quote of result.buyerQuotes) assert.equal(Number.isSafeInteger(quote.totalCents), true);
});

test("setup rounding is deterministic even if input buyers are reordered", () => {
  let scenario = withLargeBudgets();
  scenario = updateBuyer(scenario, "luma", { quantity: 34 });
  scenario = updateBuyer(scenario, "juniper", { quantity: 34 });
  scenario = updateBuyer(scenario, "forma", { quantity: 33 });
  scenario = applyConsent(scenario, "luma", "accepted");
  const first = evaluateScenario(scenario);
  scenario.buyers.reverse();
  const second = evaluateScenario(scenario);
  assert.deepEqual(second, first);
  assert.deepEqual(first.buyerQuotes.map((buyer) => buyer.setupCents), [1010, 1010, 980]);
});

test("exact budget is accepted and one cent below it is blocked", () => {
  let scenario = updateBuyer(createDemoScenario(), "luma", { budgetCents: 8200 });
  scenario = applyConsent(scenario, "luma", "accepted");
  assert.equal(evaluateScenario(scenario).feasible, true);
  scenario = updateBuyer(scenario, "luma", { budgetCents: 8199 });
  const proposal = proposeScenario(scenario);
  assert.equal(proposal.feasibleIfAccepted, false);
  assert.equal(proposal.status, "blocked");
  assert.equal(proposal.candidate!.issues.some((issue) => issue.code === "BUDGET_EXCEEDED" && issue.buyerIds.includes("luma") && issue.shortfall === 1), true);
  assert.equal(evaluateScenario(applyConsent(scenario, "luma", "accepted")).feasible, false);
});

test("all buyers' deadlines are checked, including after a physical substitution", () => {
  let scenario = updateBuyer(createDemoScenario(), "forma", { maxLeadDays: 6 });
  assert.equal(proposeScenario(scenario).feasibleIfAccepted, false);
  scenario = applyConsent(scenario, "luma", "accepted");
  const result = evaluateScenario(scenario);
  assert.equal(result.feasible, false);
  assert.equal(result.issues.some((issue) => issue.code === "LEAD_TIME_EXCEEDED" && issue.buyerIds.includes("forma")), true);
  scenario = updateBuyer(scenario, "forma", { maxLeadDays: 7 });
  scenario = applyConsent(scenario, "luma", "accepted");
  assert.equal(evaluateScenario(scenario).feasible, true);
});

test("withdrawal removes quantity, setup allocation and shipping instead of preserving a stale success", () => {
  let scenario = applyConsent(createDemoScenario(), "luma", "accepted");
  scenario = updateBuyer(scenario, "forma", { active: false });
  assert.equal(getEffectiveConsent(scenario, "luma"), "pending");
  const result = evaluateScenario(scenario);
  assert.equal(result.feasible, false);
  assert.equal(result.totalQuantity, 75);
  assert.equal(result.buyerQuotes.some((buyer) => buyer.buyerId === "forma"), false);
  assert.equal(proposeScenario(scenario).feasibleIfAccepted, false);
});

test("remaining buyers can still order when they independently meet the unchanged rules", () => {
  let scenario = withLargeBudgets();
  scenario = updateBuyer(scenario, "luma", { active: false });
  scenario = updateBuyer(scenario, "juniper", { quantity: 75 });
  const result = evaluateScenario(scenario);
  assert.equal(result.feasible, true);
  assert.equal(result.totalQuantity, 100);
  assert.equal(result.buyerQuotes.length, 2);
  assert.equal(proposeScenario(scenario).status, "already-feasible");
});

test("no buyers is empty, never a free or feasible order", () => {
  let scenario = createDemoScenario();
  for (const id of ["luma", "juniper", "forma"] as BuyerId[]) scenario = updateBuyer(scenario, id, { active: false });
  const result = evaluateScenario(scenario);
  assert.equal(result.feasible, false);
  assert.equal(result.status, "empty");
  assert.equal(result.totalCents, 0);
  assert.deepEqual(result.buyerQuotes, []);
  assert.equal(result.issues[0].code, "NO_ACTIVE_BUYERS");
  assert.equal(proposeScenario(scenario).feasibleIfAccepted, false);
});

test("direct quantity or membership mutation cannot reuse a previous consent", () => {
  const scenario = applyConsent(createDemoScenario(), "luma", "accepted");
  scenario.buyers[1].quantity += 1;
  assert.equal(getEffectiveConsent(scenario, "luma"), "pending");
  assert.equal(evaluateScenario(scenario).buyerQuotes[0].baseVariant, "black");
  assert.equal(evaluateScenario(scenario).feasible, false);
  const second = applyConsent(createDemoScenario(), "luma", "accepted");
  second.buyers[2].active = false;
  assert.equal(evaluateScenario(second).buyerQuotes[0].substitutionApplied, false);
});

test("request edits invalidate decisions while a no-op update preserves them", () => {
  const original = applyConsent(createDemoScenario(), "luma", "accepted");
  const unchanged = updateBuyer(original, "juniper", { quantity: 35 });
  assert.equal(getEffectiveConsent(unchanged, "luma"), "accepted");
  assert.equal(unchanged.revision, original.revision);
  const changed = updateBuyer(original, "juniper", { maxLeadDays: 9 });
  assert.equal(getEffectiveConsent(changed, "luma"), "pending");
  assert.equal(changed.revision, original.revision + 1);
  assert.equal(getEffectiveConsent(original, "luma"), "accepted");
});

test("canonical conditions are distinct from an authorized quote fingerprint input", () => {
  const pending = createDemoScenario();
  const accepted = applyConsent(pending, "luma", "accepted");
  assert.equal(getScenarioConditionsKey(pending), getScenarioConditionsKey(accepted));
  assert.notEqual(getScenarioFingerprintInput(pending), getScenarioFingerprintInput(accepted));
});

test("client-controlled prices, MOQ or misleading fixture metadata are rejected", () => {
  const edits = [
    (scenario: Scenario) => { scenario.supplier.baseUnitCents.kraft = 1; },
    (scenario: Scenario) => { scenario.supplier.moqPerBaseVariant = 1; },
    (scenario: Scenario) => { scenario.supplier.shippingCentsPerBuyer = 0; },
    (scenario: Scenario) => { Object.assign(scenario.metadata, { supplierVerified: true }); },
  ];
  for (const edit of edits) {
    const scenario = createDemoScenario();
    edit(scenario);
    assert.throws(() => parseScenario(scenario), ScenarioValidationError);
    assert.throws(() => evaluateScenario(scenario), ScenarioValidationError);
  }
});

test("malformed money, counts, deadlines, duplicate identities and unsupported fields fail closed", () => {
  const edits = [
    (scenario: Scenario) => { scenario.buyers[0].quantity = 0; },
    (scenario: Scenario) => { scenario.buyers[0].quantity = 1.5; },
    (scenario: Scenario) => { scenario.buyers[0].budgetCents = 8199.5; },
    (scenario: Scenario) => { scenario.buyers[0].budgetCents = -1; },
    (scenario: Scenario) => { scenario.buyers[0].budgetCents = Number.NaN; },
    (scenario: Scenario) => { scenario.buyers[0].maxLeadDays = Number.POSITIVE_INFINITY; },
    (scenario: Scenario) => { scenario.buyers[0].maxLeadDays = 0; },
    (scenario: Scenario) => { scenario.buyers[1] = { ...scenario.buyers[0] }; },
    (scenario: Scenario) => { Object.assign(scenario.buyers[0].substitutionConsent, { decision: ["accepted"], conditionsKey: getScenarioConditionsKey(scenario) }); },
    (scenario: Scenario) => { Object.assign(scenario, { totalCents: 1 }); },
  ];
  for (const edit of edits) {
    const scenario = createDemoScenario();
    edit(scenario);
    assert.throws(() => parseScenario(scenario), ScenarioValidationError);
  }
});

test("only active LUMA can consent to this disclosed physical substitution", () => {
  assert.throws(() => applyConsent(createDemoScenario(), "juniper", "accepted"), ScenarioValidationError);
  const inactive = updateBuyer(createDemoScenario(), "luma", { active: false });
  assert.throws(() => applyConsent(inactive, "luma", "accepted"), ScenarioValidationError);
  const cleared = applyConsent(applyConsent(createDemoScenario(), "luma", "accepted"), "luma", "pending");
  assert.equal(getEffectiveConsent(cleared, "luma"), "pending");
  assert.equal(evaluateScenario(cleared).feasible, false);
});

test("legacy requests remain exact and serialization adds no quantity range", () => {
  const scenario = applyConsent(createDemoScenario(), "luma", "accepted");
  const fingerprint = getScenarioFingerprintInput(scenario);
  const parsed = parseScenario(JSON.parse(fingerprint));
  assert.ok(parsed.buyers.every((buyer) => !Object.hasOwn(buyer, "quantityRange")));
  assert.deepEqual(getQuantityRange(parsed.buyers[0]), { min: 40, max: 40 });
  assert.equal(getScenarioFingerprintInput(parsed), fingerprint);
  assert.equal(getEffectiveConsent(parsed, "luma"), "accepted");
  assert.equal(evaluateScenario(parsed).totalCents, 19700);
});

test("a range edit invalidates consent, an equal range is a no-op, and null restores exact quantity", () => {
  const accepted = applyConsent(createDemoScenario(), "luma", "accepted");
  const ranged = updateBuyer(accepted, "luma", { quantityRange: { min: 38, max: 40 } });
  assert.equal(getEffectiveConsent(ranged, "luma"), "pending");
  assert.notEqual(getScenarioFingerprintInput(ranged), getScenarioFingerprintInput(accepted));
  assert.deepEqual(getQuantityRange(ranged.buyers[0]), { min: 38, max: 40 });
  const same = updateBuyer(ranged, "luma", { quantityRange: { min: 38, max: 40 } });
  assert.equal(same.revision, ranged.revision);
  const exact = updateBuyer(ranged, "luma", { quantityRange: null });
  assert.equal(Object.hasOwn(exact.buyers[0], "quantityRange"), false);
  assert.deepEqual(getQuantityRange(exact.buyers[0]), { min: 40, max: 40 });
});

test("malformed ranges or desired quantities outside a declared range fail closed", () => {
  for (const quantityRange of [{ min: 41, max: 45 }, { min: 38, max: 39 }, { min: 41, max: 38 }, { min: 0, max: 40 }, { min: 38.5, max: 40 }, { min: 38, max: 100001 }]) {
    assert.throws(() => updateBuyer(createDemoScenario(), "luma", { quantityRange }), ScenarioValidationError);
  }
  const ranged = updateBuyer(createDemoScenario(), "luma", { quantityRange: { min: 38, max: 40 } });
  assert.throws(() => updateBuyer(ranged, "luma", { quantity: 37 }), ScenarioValidationError);
  assert.equal(updateBuyer(ranged, "luma", { quantity: 38 }).buyers[0].quantity, 38);
});
