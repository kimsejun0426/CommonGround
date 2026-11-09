import assert from "node:assert/strict";
import test from "node:test";
import { applyConsent, createDemoScenario, updateBuyer } from "../lib/engine.ts";
import { buildPlanningOverview } from "../lib/planning.ts";
import { buildPlanEvidence } from "../lib/plan-evidence.ts";
import type { BuyerId } from "../lib/domain.ts";

test("evidence explains the actual split-to-shared minimum without inventing cost savings", () => {
  const overview = buildPlanningOverview(createDemoScenario());
  const plan = overview.plans.find((candidate) => candidate.kind === "shared-base")!;
  const before = JSON.stringify({ overview, plan });
  const evidence = buildPlanEvidence(overview, plan);
  assert.equal(evidence.state, "ready-for-review");
  assert.deepEqual(evidence.originalGroups.map((group) => [group.baseVariant, group.quantity, group.met]), [
    ["kraft", 60, false], ["black", 40, false],
  ]);
  assert.deepEqual(evidence.selectedGroups.map((group) => [group.baseVariant, group.quantity, group.met]), [["kraft", 100, true]]);
  assert.deepEqual(evidence.originalMaterialComparison, {
    totalQuantity: 200, additionalToRequestedTotal: 100,
    fewerTotalBoxesInSelectedPlan: 100, comparisonFitsBuyerRules: false,
  });
  assert.deepEqual(evidence.pendingChangeApprovals, ["luma"]);
  assert.equal(evidence.allNumericChecksPass, true);
  assert.equal(evidence.brands[0].budgetHeadroomCents, 800);
  assert.equal("savingsCents" in evidence, false);
  assert.equal(JSON.stringify({ overview, plan }), before);
});

test("a budget-blocked plan never becomes ready because its MOQ is met", () => {
  const scenario = updateBuyer(createDemoScenario(), "luma", { budgetCents: 8000 });
  const overview = buildPlanningOverview(scenario);
  const evidence = buildPlanEvidence(overview, overview.plans[0]);
  assert.equal(evidence.state, "blocked");
  assert.equal(evidence.selectedGroups[0].met, true);
  assert.equal(evidence.allNumericChecksPass, false);
  assert.equal(evidence.brands[0].withinBudget, false);
  assert.equal(evidence.brands[0].budgetHeadroomCents, -200);
  assert.equal(evidence.brands[0].quantityDelta, 0);
});

test("quantity reallocation reports fewer and extra units separately while preserving the cohort total", () => {
  let scenario = updateBuyer(createDemoScenario(), "luma", { budgetCents: 8000, quantityRange: { min: 38, max: 40 } });
  scenario = updateBuyer(scenario, "forma", { quantityRange: { min: 25, max: 30 } });
  const overview = buildPlanningOverview(scenario);
  const plan = overview.plans.find((candidate) => candidate.id === overview.recommendedPlanId)!;
  const evidence = buildPlanEvidence(overview, plan);
  assert.equal(evidence.state, "ready-for-review");
  assert.deepEqual(evidence.brands.map((buyer) => [buyer.requestedQuantity, buyer.proposedQuantity]), [[40, 38], [35, 35], [25, 27]]);
  assert.deepEqual(evidence.pendingChangeApprovals, ["luma", "forma"]);
  assert.equal(evidence.additionalUnitsByBuyer, 2);
  assert.equal(evidence.reducedUnitsByBuyer, 2);
  assert.equal(evidence.requestedTotal, 100);
  assert.equal(evidence.selectedTotal, 100);
  assert.equal(evidence.allNumericChecksPass, true);
  assert.deepEqual(evidence.brands.map((buyer) => buyer.totalCents), [7830, 6575, 5255]);
});

test("original-material top-up still fails a saved quantity limit even with ample money", () => {
  let scenario = createDemoScenario();
  for (const id of ["luma", "juniper", "forma"] as BuyerId[]) scenario = updateBuyer(scenario, id, { budgetCents: 100000 });
  const overview = buildPlanningOverview(scenario);
  const plan = overview.plans.find((candidate) => candidate.kind === "original-minimums")!;
  const evidence = buildPlanEvidence(overview, plan);
  assert.equal(evidence.state, "blocked");
  assert.equal(evidence.allNumericChecksPass, false);
  assert.ok(evidence.brands.every((buyer) => buyer.withinBudget && !buyer.quantityWithinBounds));
  assert.equal(evidence.originalMaterialComparison?.fewerTotalBoxesInSelectedPlan, 0);
});

test("declined material change remains blocked even when all numeric checks pass", () => {
  const overview = buildPlanningOverview(applyConsent(createDemoScenario(), "luma", "declined"));
  const evidence = buildPlanEvidence(overview, overview.plans[0]);
  assert.equal(evidence.state, "blocked");
  assert.equal(evidence.allNumericChecksPass, true);
  assert.equal(evidence.brands[0].materialChangeDeclined, true);
});

test("withdrawn buyers are omitted and their missing demand remains a visible MOQ shortfall", () => {
  const overview = buildPlanningOverview(updateBuyer(createDemoScenario(), "forma", { active: false }));
  const evidence = buildPlanEvidence(overview, overview.plans[0]);
  assert.deepEqual(evidence.brands.map((buyer) => buyer.buyerId), ["luma", "juniper"]);
  assert.equal(evidence.requestedTotal, 75);
  assert.equal(evidence.selectedGroups[0].shortfall, 25);
  assert.equal(evidence.selectedGroups[0].fillPercent, 75);
  assert.equal(evidence.state, "blocked");
  assert.equal(evidence.allNumericChecksPass, false);
});

test("production time failures identify the affected brand without calling production delivery", () => {
  const overview = buildPlanningOverview(updateBuyer(createDemoScenario(), "forma", { maxLeadDays: 6 }));
  const evidence = buildPlanEvidence(overview, overview.plans[0]);
  assert.equal(evidence.state, "blocked");
  assert.equal(evidence.brands[2].withinProductionTime, false);
  assert.equal(evidence.brands[2].productionDays, 7);
  assert.equal(evidence.brands[2].maximumProductionDays, 6);
});

test("an already viable original request is recognized without fabricating a quantity benefit", () => {
  let scenario = createDemoScenario();
  for (const id of ["luma", "juniper", "forma"] as BuyerId[]) scenario = updateBuyer(scenario, id, { budgetCents: 100000 });
  scenario = updateBuyer(scenario, "luma", { quantity: 101 });
  scenario = updateBuyer(scenario, "juniper", { quantity: 75 });
  const overview = buildPlanningOverview(scenario);
  const plan = overview.plans.find((candidate) => candidate.id === overview.recommendedPlanId)!;
  const evidence = buildPlanEvidence(overview, plan);
  assert.equal(evidence.originalRequestFeasible, true);
  assert.equal(evidence.state, "ready-for-review");
  assert.equal(evidence.originalMaterialComparison?.fewerTotalBoxesInSelectedPlan, 0);
  assert.equal(evidence.additionalUnitsByBuyer, 0);
  assert.deepEqual(evidence.pendingChangeApprovals, []);
  assert.equal(evidence.selectedGroups.find((group) => group.baseVariant === "black")?.fillPercent, 100);
  assert.equal(evidence.selectedGroups.find((group) => group.baseVariant === "black")?.quantity, 101);
});

test("an empty cohort has no green checks, comparison benefit or made-up approvals", () => {
  let scenario = createDemoScenario();
  for (const id of ["luma", "juniper", "forma"] as BuyerId[]) scenario = updateBuyer(scenario, id, { active: false });
  const overview = buildPlanningOverview(scenario);
  const evidence = buildPlanEvidence(overview, overview.plans[0]);
  assert.equal(evidence.state, "empty");
  assert.equal(evidence.allNumericChecksPass, false);
  assert.equal(evidence.originalMaterialComparison, null);
  assert.deepEqual(evidence.brands, []);
  assert.deepEqual(evidence.pendingChangeApprovals, []);
  assert.deepEqual(evidence.selectedGroups, []);
});
