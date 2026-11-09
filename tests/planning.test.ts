import assert from "node:assert/strict";
import test from "node:test";
import { applyConsent, createDemoScenario, evaluateScenario, getEffectiveConsent, getQuantityRange, updateBuyer } from "../lib/engine.ts";
import { applyPlanningPlan, buildPlanningOverview, PlanningError } from "../lib/planning.ts";
import type { BuyerId, Scenario } from "../lib/domain.ts";

function tightBudget(): Scenario {
  let scenario = updateBuyer(createDemoScenario(), "luma", { budgetCents: 8000, quantityRange: { min: 38, max: 40 } });
  return updateBuyer(scenario, "forma", { quantityRange: { min: 25, max: 30 } });
}
function ampleBudgets(scenario = createDemoScenario()): Scenario {
  for (const id of ["luma", "juniper", "forma"] as BuyerId[]) scenario = updateBuyer(scenario, id, { budgetCents: 100000 });
  return scenario;
}
function errorCode(code: string) {
  return (error: unknown) => error instanceof PlanningError && error.code === code;
}

test("default comparison preserves the original request and recommends the 197-dollar shared plan", () => {
  const scenario = createDemoScenario();
  const original = JSON.stringify(scenario);
  const overview = buildPlanningOverview(scenario);
  const shared = overview.plans.find((plan) => plan.kind === "shared-base")!;
  assert.equal(overview.source, "curated-demo-rules");
  assert.equal(overview.supplierVerified, false);
  assert.equal(overview.originalRequested.totalQuantity, 100);
  assert.equal(overview.originalRequested.feasible, false);
  assert.equal(overview.recommendedPlanId, shared.id);
  assert.equal(shared.evaluation.totalCents, 19700);
  assert.deepEqual(shared.evaluation.buyerQuotes.map((buyer) => buyer.totalCents), [8200, 6575, 4925]);
  assert.equal(shared.feasibleIfApproved, true);
  assert.deepEqual(shared.quantityDeltas, []);
  assert.deepEqual(shared.requiredApprovals, []);
  assert.deepEqual(shared.physicalConsentRequired, ["luma"]);
  assert.equal(JSON.stringify(scenario), original);
});

test("keeping original base materials is a 200-box 394-dollar comparison, not a feasible cheap baseline", () => {
  const original = buildPlanningOverview(createDemoScenario()).plans.find((plan) => plan.kind === "original-minimums")!;
  assert.deepEqual(original.quantities, { luma: 100, juniper: 60, forma: 40 });
  assert.equal(original.evaluation.totalQuantity, 200);
  assert.equal(original.evaluation.totalCents, 39400);
  assert.deepEqual(original.evaluation.buyerQuotes.map((buyer) => buyer.totalCents), [21300, 10700, 7400]);
  assert.equal(original.totalExtraUnits, 100);
  assert.equal(original.feasibleIfApproved, false);
  assert.deepEqual(original.budgetDeltas.map((buyer) => buyer.shortfallCents), [12300, 3700, 1900]);
  assert.equal(original.blockers.filter((issue) => issue.code === "BUDGET_EXCEEDED").length, 3);
  assert.deepEqual(original.physicalConsentRequired, []);
  assert.deepEqual(original.requiredApprovals, ["luma", "juniper", "forma"]);
});

test("every planning evaluation remains hypothetical, including mathematically feasible plans", () => {
  const overview = buildPlanningOverview(tightBudget());
  assert.ok(overview.plans.some((plan) => plan.feasibleIfApproved));
  for (const plan of overview.plans) {
    assert.equal(plan.evaluation.feasible, false);
    assert.equal(plan.evaluation.isHypothetical, true);
    assert.equal(plan.evaluation.priceStatus, "conditional-estimate");
    assert.equal(Object.prototype.hasOwnProperty.call(plan, "scenario"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(plan, "acceptedScenario"), false);
  }
});

test("an 80-dollar LUMA budget gets an exact 38/35/27 counteroffer", () => {
  const overview = buildPlanningOverview(tightBudget());
  const recommendation = overview.plans.find((plan) => plan.id === overview.recommendedPlanId)!;
  const shared = overview.plans.find((plan) => plan.kind === "shared-base")!;
  assert.equal(shared.feasibleIfApproved, false);
  assert.equal(shared.budgetDeltas[0].shortfallCents, 200);
  assert.equal(recommendation.kind, "quantity-rebalance");
  assert.deepEqual(recommendation.quantities, { luma: 38, juniper: 35, forma: 27 });
  assert.equal(recommendation.evaluation.totalQuantity, 100);
  assert.equal(recommendation.evaluation.totalCents, 19660);
  assert.deepEqual(recommendation.evaluation.buyerQuotes.map((buyer) => buyer.totalCents), [7830, 6575, 5255]);
  assert.deepEqual(recommendation.requiredApprovals, ["luma", "forma"]);
  assert.deepEqual(recommendation.physicalConsentRequired, ["luma"]);
  assert.equal(recommendation.risks.some((risk) => risk.includes("2 fewer")), true);
  assert.equal(recommendation.risks.some((risk) => risk.includes("2 additional")), true);
});

test("permitted alternatives are distinct, meet the MOQ and satisfy unchanged budgets", () => {
  const scenario = updateBuyer(tightBudget(), "juniper", { quantityRange: { min: 35, max: 40 } });
  const plans = buildPlanningOverview(scenario).plans.filter((plan) => plan.kind === "quantity-rebalance");
  assert.ok(plans.length >= 2);
  assert.ok(plans.length <= 3);
  assert.equal(new Set(plans.map((plan) => plan.id)).size, plans.length);
  for (const plan of plans) {
    assert.ok(plan.evaluation.totalQuantity >= scenario.supplier.moqPerBaseVariant);
    assert.equal(plan.feasibleIfApproved, true);
    assert.ok(plan.budgetDeltas.every((buyer) => buyer.shortfallCents === 0));
    assert.ok(scenario.buyers.every((buyer) => {
      const range = getQuantityRange(buyer);
      return plan.quantities[buyer.id] >= range.min && plan.quantities[buyer.id] <= range.max;
    }));
    assert.deepEqual(plan.budgetDeltas.map((buyer) => buyer.budgetCents), [8000, 7000, 5500]);
  }
});

test("a permitted lower total rescues 45 requested boxes at an 82-dollar budget", () => {
  const scenario = updateBuyer(createDemoScenario(), "luma", {
    quantity: 45, quantityRange: { min: 40, max: 45 }, budgetCents: 8200,
  });
  const before = JSON.stringify(scenario);
  const overview = buildPlanningOverview(scenario);
  const plan = overview.plans.find((item) => item.id === overview.recommendedPlanId)!;
  assert.equal(overview.search.complete, true);
  assert.deepEqual(plan.quantities, { luma: 40, juniper: 35, forma: 25 });
  assert.equal(plan.evaluation.totalQuantity, 100);
  assert.equal(plan.evaluation.totalCents, 19700);
  assert.deepEqual(plan.requiredApprovals, ["luma"]);
  assert.deepEqual(plan.physicalConsentRequired, ["luma"]);
  assert.equal(plan.evaluation.feasible, false);
  assert.throws(() => applyPlanningPlan(scenario, plan.id, [], plan.inputFingerprint), errorCode("APPROVAL_REQUIRED"));
  assert.equal(JSON.stringify(scenario), before);
});

test("the full permitted range is searched beyond the former five-box window", () => {
  const scenario = updateBuyer(createDemoScenario(), "luma", {
    quantity: 60, quantityRange: { min: 40, max: 60 }, budgetCents: 8200,
  });
  const overview = buildPlanningOverview(scenario);
  const plan = overview.plans.find((item) => item.id === overview.recommendedPlanId)!;
  assert.equal(overview.search.complete, true);
  assert.deepEqual(plan.quantities, { luma: 40, juniper: 35, forma: 25 });
  assert.equal(plan.totalReducedUnits, 20);
  assert.equal(plan.explanation.includes("five boxes"), false);
  const adopted = applyPlanningPlan(scenario, plan.id, ["luma"], plan.inputFingerprint);
  assert.equal(getEffectiveConsent(adopted, "luma"), "pending");
  assert.equal(evaluateScenario(applyConsent(adopted, "luma", "accepted")).feasible, true);
});

test("wide permission cannot invent affordability when even the lowest quantities exceed budget", () => {
  let scenario = createDemoScenario();
  for (const id of ["luma", "juniper", "forma"] as BuyerId[]) scenario = updateBuyer(scenario, id, {
    quantity: 100000, quantityRange: { min: 1, max: 100000 }, budgetCents: 800,
  });
  const overview = buildPlanningOverview(scenario);
  assert.equal(overview.search.complete, true);
  assert.equal(overview.recommendedPlanId, null);
  assert.equal(overview.plans.some((plan) => plan.kind === "quantity-rebalance"), false);
});

test("maximum-size ranges return bounded work and disclose any unfinished optimality search", () => {
  let scenario = updateBuyer(createDemoScenario(), "luma", { quantity: 100000, budgetCents: 15502300 });
  for (const id of ["juniper", "forma"] as BuyerId[]) scenario = updateBuyer(scenario, id, {
    quantity: 1, quantityRange: { min: 1, max: 100000 }, budgetCents: 100000000,
  });
  const overview = buildPlanningOverview(scenario);
  assert.ok(overview.search.exploredNodes <= 8000);
  assert.equal(overview.search.complete, false);
  const alternatives = overview.plans.filter((plan) => plan.kind === "quantity-rebalance");
  assert.ok(alternatives.length > 0 && alternatives.length <= 3);
  for (const plan of alternatives) {
    assert.equal(plan.feasibleIfApproved, true);
    assert.equal(plan.quantities.luma, 100000);
    assert.ok(plan.budgetDeltas.every((buyer) => buyer.shortfallCents === 0));
    assert.equal(plan.evaluation.feasible, false);
  }
});

test("completed search matches an exhaustive canonical-engine oracle across small permitted ranges", () => {
  const scenarios = [7800, 7900, 8000, 8100].map((budgetCents) => {
    let scenario = updateBuyer(createDemoScenario(), "luma", { quantityRange: { min: 37, max: 42 }, budgetCents });
    scenario = updateBuyer(scenario, "juniper", { quantityRange: { min: 33, max: 38 } });
    return updateBuyer(scenario, "forma", { quantityRange: { min: 24, max: 29 } });
  });
  scenarios.push(updateBuyer(updateBuyer(createDemoScenario(), "luma", {
    quantity: 45, quantityRange: { min: 40, max: 45 }, budgetCents: 8200,
  }), "forma", { quantityRange: { min: 23, max: 27 } }));
  for (const scenario of scenarios) {
    const expected: Array<{ id: string; changedUnits: number; approvals: number; headroom: number; total: number }> = [];
    const ranges = scenario.buyers.map(getQuantityRange);
    for (let luma = ranges[0].min; luma <= ranges[0].max; luma++) {
      for (let juniper = ranges[1].min; juniper <= ranges[1].max; juniper++) {
        for (let forma = ranges[2].min; forma <= ranges[2].max; forma++) {
          const quantities = [luma, juniper, forma];
          if (quantities.every((quantity, index) => quantity === scenario.buyers[index].quantity)) continue;
          const draft = structuredClone(scenario);
          draft.buyers.forEach((buyer, index) => { buyer.quantity = quantities[index]; });
          const result = evaluateScenario(applyConsent(draft, "luma", "accepted"));
          if (!result.feasible) continue;
          expected.push({
            id: `rebalance-${quantities.join("-")}`,
            changedUnits: quantities.reduce((total, quantity, index) => total + Math.abs(quantity - scenario.buyers[index].quantity), 0),
            approvals: quantities.filter((quantity, index) => quantity !== scenario.buyers[index].quantity).length,
            headroom: Math.min(...result.buyerQuotes.map((quote) => quote.budgetCents - quote.totalCents)),
            total: result.totalCents,
          });
        }
      }
    }
    expected.sort((a, b) => a.changedUnits - b.changedUnits || a.approvals - b.approvals
      || b.headroom - a.headroom || a.total - b.total || a.id.localeCompare(b.id));
    const overview = buildPlanningOverview(scenario);
    assert.equal(overview.search.complete, true);
    assert.deepEqual(overview.plans.filter((plan) => plan.kind === "quantity-rebalance").map((plan) => plan.id), expected.slice(0, 3).map((plan) => plan.id));
  }
});

test("adopting a counteroffer changes only approved quantities and leaves physical consent pending", () => {
  const scenario = tightBudget();
  const before = JSON.stringify(scenario);
  const overview = buildPlanningOverview(scenario);
  const plan = overview.plans.find((candidate) => candidate.id === overview.recommendedPlanId)!;
  const adopted = applyPlanningPlan(scenario, plan.id, ["forma", "luma"], plan.inputFingerprint);
  assert.deepEqual(adopted.buyers.map((buyer) => buyer.quantity), [38, 35, 27]);
  assert.deepEqual(adopted.buyers.map((buyer) => buyer.budgetCents), [8000, 7000, 5500]);
  assert.deepEqual(adopted.buyers.map((buyer) => buyer.maxLeadDays), [10, 10, 10]);
  assert.equal(getEffectiveConsent(adopted, "luma"), "pending");
  assert.equal(evaluateScenario(adopted).feasible, false);
  const accepted = applyConsent(adopted, "luma", "accepted");
  assert.equal(evaluateScenario(accepted).feasible, true);
  assert.equal(evaluateScenario(accepted).totalCents, 19660);
  assert.equal(JSON.stringify(scenario), before);
});

test("missing, duplicate, unrelated or extra buyer approvals cannot adopt a quantity change", () => {
  const scenario = tightBudget();
  const overview = buildPlanningOverview(scenario);
  const plan = overview.plans.find((candidate) => candidate.id === overview.recommendedPlanId)!;
  for (const ids of [[], ["luma"], ["forma"], ["juniper"], ["luma", "luma"], ["luma", "forma", "juniper"]] as BuyerId[][]) {
    assert.throws(() => applyPlanningPlan(scenario, plan.id, ids, plan.inputFingerprint), errorCode("APPROVAL_REQUIRED"));
  }
});

test("the shared plan never automatically accepts LUMA's physical change", () => {
  const scenario = createDemoScenario();
  const plan = buildPlanningOverview(scenario).plans.find((item) => item.kind === "shared-base")!;
  const adopted = applyPlanningPlan(scenario, plan.id, [], plan.inputFingerprint);
  assert.equal(getEffectiveConsent(adopted, "luma"), "pending");
  assert.equal(evaluateScenario(adopted).feasible, false);
  assert.deepEqual(adopted.buyers.map((buyer) => buyer.quantity), [40, 35, 25]);
});

test("a changed input cannot reuse approvals for a stale plan", () => {
  const scenario = tightBudget();
  const overview = buildPlanningOverview(scenario);
  const plan = overview.plans.find((item) => item.id === overview.recommendedPlanId)!;
  const changed = updateBuyer(scenario, "juniper", { budgetCents: 6900 });
  assert.throws(() => applyPlanningPlan(changed, plan.id, plan.requiredApprovals, plan.inputFingerprint), errorCode("STALE_PLAN"));
});

test("unknown plans and blocked original-material plans cannot be applied", () => {
  const scenario = createDemoScenario();
  const overview = buildPlanningOverview(scenario);
  const original = overview.plans.find((plan) => plan.kind === "original-minimums")!;
  assert.throws(() => applyPlanningPlan(scenario, "invented-discount", [], original.inputFingerprint), errorCode("UNKNOWN_PLAN"));
  assert.throws(() => applyPlanningPlan(scenario, original.id, original.requiredApprovals, original.inputFingerprint), errorCode("PLAN_BLOCKED"));
  assert.deepEqual(scenario.buyers.map((buyer) => buyer.budgetCents), [9000, 7000, 5500]);
});

test("a declined substitution stays blocked and is not revived by quantity search", () => {
  const scenario = applyConsent(tightBudget(), "luma", "declined");
  const overview = buildPlanningOverview(scenario);
  assert.equal(overview.recommendedPlanId, null);
  assert.equal(overview.plans.some((plan) => plan.kind === "quantity-rebalance"), false);
  const shared = overview.plans.find((plan) => plan.kind === "shared-base")!;
  assert.equal(shared.feasibleIfApproved, false);
  assert.equal(shared.blockers.some((issue) => issue.code === "SUBSTITUTION_DECLINED"), true);
  assert.equal(getEffectiveConsent(scenario, "luma"), "declined");
});

test("a six-day production requirement has no invented faster alternative", () => {
  const scenario = updateBuyer(createDemoScenario(), "forma", { maxLeadDays: 6 });
  const overview = buildPlanningOverview(scenario);
  assert.equal(overview.recommendedPlanId, null);
  assert.equal(overview.plans.every((plan) => !plan.feasibleIfApproved), true);
  assert.equal(overview.blockers.some((issue) => issue.code === "LEAD_TIME_EXCEEDED" && issue.buyerIds.includes("forma")), true);
  assert.equal(scenario.buyers[2].maxLeadDays, 6);
});

test("withdrawn demand is not invented back into a minimum-quantity rescue", () => {
  const scenario = updateBuyer(createDemoScenario(), "forma", { active: false });
  const overview = buildPlanningOverview(scenario);
  assert.equal(overview.recommendedPlanId, null);
  assert.equal(overview.plans.some((plan) => plan.kind === "quantity-rebalance"), false);
  const shared = overview.plans.find((plan) => plan.kind === "shared-base")!;
  assert.equal(shared.evaluation.totalQuantity, 75);
  assert.equal(shared.blockers.some((issue) => issue.code === "MOQ_NOT_MET" && issue.shortfall === 25), true);
  assert.equal(shared.evaluation.buyerQuotes.some((buyer) => buyer.buyerId === "forma"), false);
});

test("a nearby one-box shortfall gets an explicit additional-quantity request", () => {
  const scenario = updateBuyer(createDemoScenario(), "forma", { quantity: 24, quantityRange: { min: 24, max: 25 } });
  const overview = buildPlanningOverview(scenario);
  const plan = overview.plans.find((item) => item.id === overview.recommendedPlanId)!;
  assert.equal(plan.kind, "quantity-rebalance");
  assert.deepEqual(plan.quantities, { luma: 40, juniper: 35, forma: 25 });
  assert.deepEqual(plan.requiredApprovals, ["forma"]);
  assert.equal(plan.totalExtraUnits, 1);
  assert.equal(plan.evaluation.totalQuantity, 100);
  assert.equal(evaluateScenario(scenario).feasible, false);
});

test("quantities above the MOQ are preserved instead of truncated to 100", () => {
  const scenario = updateBuyer(createDemoScenario(), "luma", { quantity: 41 });
  const overview = buildPlanningOverview(scenario);
  const shared = overview.plans.find((plan) => plan.kind === "shared-base")!;
  assert.equal(shared.evaluation.totalQuantity, 101);
  assert.equal(shared.evaluation.totalCents, 19855);
  assert.equal(shared.quantities.luma, 41);
  assert.equal(overview.recommendedPlanId, shared.id);
});

test("already viable original configurations are preferred without forced substitution", () => {
  let scenario = ampleBudgets();
  scenario = updateBuyer(scenario, "luma", { quantity: 100 });
  scenario = updateBuyer(scenario, "juniper", { quantity: 75 });
  const overview = buildPlanningOverview(scenario);
  assert.equal(overview.originalRequested.feasible, true);
  assert.equal(overview.recommendedPlanId, "original-minimums");
  const original = overview.plans.find((plan) => plan.id === "original-minimums")!;
  assert.deepEqual(original.quantityDeltas, []);
  assert.deepEqual(original.physicalConsentRequired, []);
  const adopted = applyPlanningPlan(scenario, original.id, [], original.inputFingerprint);
  assert.equal(evaluateScenario(adopted).feasible, true);
  assert.equal(evaluateScenario(adopted).buyerQuotes[0].baseVariant, "black");
});

test("no active buyers never yields a recommendation or a free order", () => {
  let scenario = createDemoScenario();
  for (const id of ["luma", "juniper", "forma"] as BuyerId[]) scenario = updateBuyer(scenario, id, { active: false });
  const overview = buildPlanningOverview(scenario);
  assert.equal(overview.recommendedPlanId, null);
  assert.equal(overview.plans.every((plan) => !plan.feasibleIfApproved), true);
  assert.equal(overview.blockers.some((issue) => issue.code === "NO_ACTIVE_BUYERS"), true);
});

test("an exact 40-box request cannot be rescued by silently reducing LUMA to 38", () => {
  const scenario = updateBuyer(createDemoScenario(), "luma", { budgetCents: 8000 });
  const overview = buildPlanningOverview(scenario);
  assert.equal(overview.recommendedPlanId, null);
  assert.equal(overview.plans.some((plan) => plan.kind === "quantity-rebalance"), false);
  assert.throws(() => applyPlanningPlan(scenario, "rebalance-38-35-27", ["luma", "forma"], overview.plans[0].inputFingerprint), errorCode("UNKNOWN_PLAN"));
});

test("a rich buyer still cannot approve a MOQ top-up beyond their prior allowed range", () => {
  const scenario = ampleBudgets();
  const plan = buildPlanningOverview(scenario).plans.find((item) => item.kind === "original-minimums")!;
  assert.equal(plan.evaluation.totalCents, 39400);
  assert.equal(plan.evaluation.constraintsSatisfied, false);
  assert.equal(plan.feasibleIfApproved, false);
  assert.deepEqual(plan.blockers.filter((item) => item.code === "QUANTITY_OUT_OF_RANGE").flatMap((item) => item.buyerIds), ["luma", "juniper", "forma"]);
  assert.throws(() => applyPlanningPlan(scenario, plan.id, plan.requiredApprovals, plan.inputFingerprint), errorCode("PLAN_BLOCKED"));
});

test("one flexible buyer cannot assign extra boxes to another fixed buyer", () => {
  const scenario = updateBuyer(createDemoScenario(), "luma", { budgetCents: 8000, quantityRange: { min: 38, max: 40 } });
  assert.equal(buildPlanningOverview(scenario).recommendedPlanId, null);
});

test("reducing a previously allowed range invalidates a proposed counteroffer", () => {
  const scenario = tightBudget();
  const plan = buildPlanningOverview(scenario).plans.find((item) => item.kind === "quantity-rebalance")!;
  const changed = updateBuyer(scenario, "forma", { quantityRange: { min: 25, max: 26 } });
  assert.throws(() => applyPlanningPlan(changed, plan.id, plan.requiredApprovals, plan.inputFingerprint), errorCode("STALE_PLAN"));
  assert.equal(buildPlanningOverview(changed).recommendedPlanId, null);
});
