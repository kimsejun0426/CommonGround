import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../lib/api-errors.ts";
import { buildSelectionContext, selectWithOpenAI, validateAISelection } from "../lib/ai-proposal.ts";
import { applyConsent, createDemoScenario, getEffectiveConsent, getQuantityRange, getScenarioFingerprintInput, proposeScenario, updateBuyer } from "../lib/engine.ts";
import { applyNegotiationOption, buildNegotiationOptions, NegotiationError } from "../lib/negotiation.ts";
import { buildPlanningOverview } from "../lib/planning.ts";

const blocked = () => updateBuyer(createDemoScenario(), "luma", { budgetCents: 8000 });
const hasCode = (code: string) => (error: unknown) =>
  (error instanceof NegotiationError || error instanceof ApiError) && error.code === code;

test("a fixed $80 brief offers computed budget and quantity questions without changing saved conditions", () => {
  const scenario = blocked();
  const before = JSON.stringify(scenario);
  const options = buildNegotiationOptions(scenario);
  assert.deepEqual(options.map((option) => option.kind), ["budget", "quantity"]);
  const [budget, quantity] = options;
  assert.deepEqual(budget.requiredApprovals, ["luma"]);
  assert.deepEqual(budget.changes.map((change) => [change.buyerId, change.fromBudgetCents, change.toBudgetCents]), [["luma", 8000, 8200]]);
  assert.deepEqual(budget.evaluation.buyerQuotes.map((quote) => quote.totalCents), [8200, 6575, 4925]);
  assert.deepEqual(quantity.quantities, { luma: 38, juniper: 35, forma: 27 });
  assert.deepEqual(quantity.requiredApprovals, ["luma", "forma"]);
  assert.deepEqual(quantity.evaluation.buyerQuotes.map((quote) => quote.totalCents), [7830, 6575, 5255]);
  assert.equal(JSON.stringify(scenario), before);
  for (const option of options) {
    assert.equal(option.inputFingerprint, getScenarioFingerprintInput(scenario));
    assert.equal(option.numericFit, true);
    assert.equal(option.evaluation.feasible, false);
    assert.equal(option.evaluation.isHypothetical, true);
    assert.equal(option.evaluation.priceStatus, "conditional-estimate");
    assert.deepEqual(option.physicalConsentRequired, ["luma"]);
    assert.equal(option.evaluation.requiredConsents[0].conditionsKey, "negotiation-preview-only");
  }
});

test("reviewing the quantity question expands only approved ranges; exact allocations remain a separate decision", () => {
  const scenario = blocked();
  const option = buildNegotiationOptions(scenario).find((item) => item.kind === "quantity")!;
  const next = applyNegotiationOption(scenario, option.id, ["luma", "forma"], option.inputFingerprint);
  assert.deepEqual(next.buyers.map((buyer) => buyer.quantity), [40, 35, 25]);
  assert.deepEqual(next.buyers.map(getQuantityRange), [{ min: 38, max: 40 }, { min: 35, max: 35 }, { min: 25, max: 27 }]);
  assert.deepEqual(next.buyers.map((buyer) => buyer.budgetCents), [8000, 7000, 5500]);
  assert.equal(getEffectiveConsent(next, "luma"), "pending");
  const overview = buildPlanningOverview(next);
  const recommended = overview.plans.find((plan) => plan.id === overview.recommendedPlanId)!;
  assert.deepEqual(recommended.quantities, { luma: 38, juniper: 35, forma: 27 });
  assert.deepEqual(recommended.requiredApprovals, ["luma", "forma"]);
  assert.equal(recommended.evaluation.feasible, false);
});

test("reviewing a budget question updates only its authorized cap and invalidates prior material consent", () => {
  const scenario = applyConsent(blocked(), "luma", "accepted");
  const option = buildNegotiationOptions(scenario).find((item) => item.kind === "budget")!;
  const next = applyNegotiationOption(scenario, option.id, ["luma"], option.inputFingerprint);
  assert.deepEqual(next.buyers.map((buyer) => buyer.budgetCents), [8200, 7000, 5500]);
  assert.deepEqual(next.buyers.map((buyer) => buyer.quantity), [40, 35, 25]);
  assert.deepEqual(next.buyers.map(getQuantityRange), [{ min: 40, max: 40 }, { min: 35, max: 35 }, { min: 25, max: 25 }]);
  assert.equal(getEffectiveConsent(next, "luma"), "pending");
  assert.equal(proposeScenario(next).status, "needs-consent");
});

test("every newly affected buyer must approve and approvals cannot be duplicated or borrowed", () => {
  const scenario = blocked();
  const option = buildNegotiationOptions(scenario).find((item) => item.kind === "quantity")!;
  for (const ids of [[], ["luma"], ["forma"], ["luma", "forma", "forma"], ["luma", "juniper", "forma"]]) {
    assert.throws(() => applyNegotiationOption(scenario, option.id, ids as Array<"luma" | "juniper" | "forma">, option.inputFingerprint), hasCode("NEGOTIATION_APPROVAL_REQUIRED"));
  }
  assert.throws(() => applyNegotiationOption(scenario, "quantity-1-1-98", ["luma", "forma"], option.inputFingerprint), hasCode("UNKNOWN_NEGOTIATION"));
});

test("changed source conditions or decisions invalidate a previously reviewed question", () => {
  const scenario = blocked();
  const option = buildNegotiationOptions(scenario)[0];
  const changed = updateBuyer(scenario, "juniper", { budgetCents: 7100 });
  assert.throws(() => applyNegotiationOption(changed, option.id, option.requiredApprovals, option.inputFingerprint), hasCode("STALE_NEGOTIATION"));
  const declined = applyConsent(scenario, "luma", "declined");
  assert.throws(() => applyNegotiationOption(declined, option.id, option.requiredApprovals, option.inputFingerprint), hasCode("STALE_NEGOTIATION"));
  assert.throws(() => applyNegotiationOption(declined, option.id, option.requiredApprovals, getScenarioFingerprintInput(declined)), hasCode("UNKNOWN_NEGOTIATION"));
});

test("negotiation respects a decline and cannot repair an impossible production deadline", () => {
  assert.deepEqual(buildNegotiationOptions(applyConsent(blocked(), "luma", "declined")), []);
  assert.deepEqual(buildNegotiationOptions(updateBuyer(blocked(), "juniper", { maxLeadDays: 6 })), []);
  let empty = blocked();
  for (const id of ["luma", "juniper", "forma"] as const) empty = updateBuyer(empty, id, { active: false });
  assert.deepEqual(buildNegotiationOptions(empty), []);
});

test("saved permissions are used before requesting any larger commitment", () => {
  let scenario = updateBuyer(blocked(), "luma", { quantityRange: { min: 38, max: 40 } });
  scenario = updateBuyer(scenario, "forma", { quantityRange: { min: 25, max: 30 } });
  assert.ok(buildPlanningOverview(scenario).recommendedPlanId);
  assert.deepEqual(buildNegotiationOptions(scenario), []);
  assert.deepEqual(buildNegotiationOptions(createDemoScenario()), []);
  const context = buildSelectionContext(scenario, proposeScenario(scenario));
  assert.equal(context.actions[0].actionId, "review_permitted_quantities");
});

test("an unfinished wide-range search never asks for wider permissions or claims impossibility", () => {
  let scenario = updateBuyer(createDemoScenario(), "luma", { quantity: 100_000, budgetCents: 15_502_300 });
  for (const id of ["juniper", "forma"] as const) {
    scenario = updateBuyer(scenario, id, { quantity: 1, quantityRange: { min: 1, max: 100_000 }, budgetCents: 100_000_000 });
  }
  const planning = buildPlanningOverview(scenario);
  assert.equal(planning.search.complete, false);
  // Validated candidates can still be shown; lack of an exhaustive ranking
  // must not become a request to expand commitments that are already allowed.
  assert.ok(planning.plans.some((plan) => plan.feasibleIfApproved));
  assert.deepEqual(buildNegotiationOptions(scenario), []);
  const context = buildSelectionContext(scenario, proposeScenario(scenario));
  assert.match(context.facts.search_incomplete, /not exhaustive/);
  assert.match(context.facts.search_incomplete, /does not prove impossibility/);
  assert.equal(context.actions.some((action) => action.optionId), false);
});

test("AI chooses between verified questions and receives trusted option identity only after validation", () => {
  const scenario = blocked();
  const context = buildSelectionContext(scenario, proposeScenario(scenario));
  assert.equal(context.actions.length, 2);
  for (const action of context.actions) {
    const result = validateAISelection({ actionId: action.actionId, buyerId: action.buyerId, questionId: action.questionId,
      factIds: [context.optionFactIds![action.actionId], "permission_question"] }, context);
    assert.equal(result.optionId, action.optionId);
    assert.equal(result.inputFingerprint, getScenarioFingerprintInput(scenario));
    assert.equal(result.source, "openai");
    assert.match(result.explanation, /not feasible plans under current permissions/);
  }
  const action = context.actions[0];
  const fact = context.optionFactIds![action.actionId];
  const otherFact = context.optionFactIds![context.actions[1].actionId];
  const valid = { actionId: action.actionId, buyerId: action.buyerId, questionId: action.questionId, factIds: [fact] };
  for (const payload of [
    { ...valid, factIds: ["moq_rule"] },
    { ...valid, factIds: [otherFact] },
    { ...valid, factIds: [fact, otherFact] },
    { ...valid, optionId: "forged" },
    { ...valid, questionId: context.actions[1].questionId },
  ]) assert.throws(() => validateAISelection(payload, context), hasCode("AI_UNGROUNDED_SELECTION"));
});

test("the provider schema exposes both computed questions, not a single scripted action", async () => {
  const scenario = blocked();
  const context = buildSelectionContext(scenario, proposeScenario(scenario));
  const chosen = context.actions.find((action) => action.optionId?.startsWith("quantity-"))!;
  let calls = 0;
  const fakeFetch = (async (_url: unknown, init: RequestInit) => {
    calls += 1;
    const body = JSON.parse(init.body as string);
    const properties = body.text.format.schema.properties;
    assert.deepEqual(properties.actionId.enum, context.actions.map((action) => action.actionId));
    assert.deepEqual(properties.questionId.enum, context.actions.map((action) => action.questionId));
    assert.match(body.input[0].content, /no unsaved user preferences/);
    return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{
      type: "output_text", text: JSON.stringify({ actionId: chosen.actionId, buyerId: chosen.buyerId, questionId: chosen.questionId,
        factIds: [context.optionFactIds![chosen.actionId], "permission_question"] }),
    }] }] });
  }) as typeof fetch;
  const selection = await selectWithOpenAI(scenario, proposeScenario(scenario), { aiReady: true, openaiApiKey: "test-only", openaiModel: "gpt-5.4-mini" }, fakeFetch);
  assert.equal(calls, 1);
  assert.equal(selection.optionId, chosen.optionId);
  assert.equal(selection.inputFingerprint, getScenarioFingerprintInput(scenario));
});
