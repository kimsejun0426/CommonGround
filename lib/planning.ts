import type { BuyerId, Evaluation, Scenario, ScenarioIssue } from "./domain.ts";
import {
  applyConsent,
  evaluateOriginalScenario,
  evaluateScenario,
  getEffectiveConsent,
  getQuantityRange,
  getScenarioFingerprintInput,
  parseScenario,
  updateBuyer,
} from "./engine.ts";

export type PlanningKind = "shared-base" | "quantity-rebalance" | "original-minimums";
export interface QuantityDelta { buyerId: BuyerId; from: number; to: number; delta: number; }
export interface BudgetDelta {
  buyerId: BuyerId;
  budgetCents: number;
  totalCents: number;
  shortfallCents: number;
  /** Signed: negative means over budget. No budget is increased by the planner. */
  headroomCents: number;
}
export interface PlanningBlocker {
  code: ScenarioIssue["code"] | "SUBSTITUTION_DECLINED" | "SEARCH_LIMIT_REACHED";
  message: string;
  buyerIds: BuyerId[];
  shortfall?: number;
}
export interface PlanningPlan {
  id: string;
  kind: PlanningKind;
  title: string;
  explanation: string;
  inputFingerprint: string;
  quantities: Record<BuyerId, number>;
  quantityDeltas: QuantityDelta[];
  budgetDeltas: BudgetDelta[];
  /** Exact buyers who must agree to the proposed quantity changes. */
  requiredApprovals: BuyerId[];
  /** Separate from quantity approval. This module never applies physical consent. */
  physicalConsentRequired: BuyerId[];
  /** Preview only: isHypothetical is true and feasible is always false. */
  evaluation: Evaluation;
  feasibleIfApproved: boolean;
  blockers: PlanningBlocker[];
  risks: string[];
  totalExtraUnits: number;
  totalReducedUnits: number;
  totalChangedUnits: number;
}
export interface PlanningOverview {
  source: "curated-demo-rules";
  supplierVerified: false;
  originalRequested: Evaluation;
  plans: PlanningPlan[];
  recommendedPlanId: string | null;
  blockers: PlanningBlocker[];
  /** A bounded search must never present an unexplored range as impossible. */
  search: { complete: boolean; exploredNodes: number };
  disclaimer: string;
}
export class PlanningError extends Error {
  readonly code: "STALE_PLAN" | "UNKNOWN_PLAN" | "PLAN_BLOCKED" | "APPROVAL_REQUIRED";
  constructor(code: "STALE_PLAN" | "UNKNOWN_PLAN" | "PLAN_BLOCKED" | "APPROVAL_REQUIRED", message: string) {
    super(message);
    this.name = "PlanningError";
    this.code = code;
  }
}

const IDS: BuyerId[] = ["luma", "juniper", "forma"];
const MAX_REBALANCED_PLANS = 3;
const MAX_SEARCH_NODES = 8_000;

function quantitiesOf(scenario: Scenario): Record<BuyerId, number> {
  return Object.fromEntries(scenario.buyers.map((buyer) => [buyer.id, buyer.quantity])) as Record<BuyerId, number>;
}

function applyQuantities(scenario: Scenario, quantities: Record<BuyerId, number>): Scenario {
  let next = scenario;
  for (const buyer of scenario.buyers) {
    if (buyer.quantity !== quantities[buyer.id]) next = updateBuyer(next, buyer.id, { quantity: quantities[buyer.id] });
  }
  return next;
}

function physicalPreview(scenario: Scenario): Evaluation {
  const luma = scenario.buyers.find((buyer) => buyer.id === "luma" && buyer.active);
  // This accepted clone is used exclusively inside the arithmetic preview. It is
  // never returned or made available for checkout or plan adoption.
  const arithmeticOnly = luma ? applyConsent(scenario, "luma", "accepted") : scenario;
  return evaluateScenario(arithmeticOnly);
}

function makePlan(
  source: Scenario,
  kind: PlanningKind,
  quantities: Record<BuyerId, number>,
  inputFingerprint: string,
): PlanningPlan {
  const rangeBlockers: PlanningBlocker[] = source.buyers.filter((buyer) => {
    const range = getQuantityRange(buyer);
    return buyer.active && (quantities[buyer.id] < range.min || quantities[buyer.id] > range.max);
  }).map((buyer) => {
    const range = getQuantityRange(buyer);
    return {
      code: "QUANTITY_OUT_OF_RANGE", buyerIds: [buyer.id],
      message: `${buyer.name}: ${quantities[buyer.id]} boxes is outside the explicitly permitted quantity ${range.min === range.max ? `of exactly ${range.min}` : `range ${range.min}–${range.max}`}. Change the buyer's request first; approving a plan cannot widen this range.`,
    };
  });
  // Price the blocked MOQ comparison without returning or adopting relaxed constraints.
  const arithmeticSource = parseScenario(source);
  for (const blocker of rangeBlockers) for (const id of blocker.buyerIds) delete arithmeticSource.buyers.find((buyer) => buyer.id === id)!.quantityRange;
  const draft = applyQuantities(arithmeticSource, quantities);
  const raw = kind === "original-minimums" ? evaluateOriginalScenario(draft) : physicalPreview(draft);
  const quantityDeltas = source.buyers.filter((buyer) => buyer.active && buyer.quantity !== quantities[buyer.id]).map((buyer) => ({
    buyerId: buyer.id, from: buyer.quantity, to: quantities[buyer.id], delta: quantities[buyer.id] - buyer.quantity,
  }));
  const needsPhysicalChange = kind !== "original-minimums" && source.buyers.some((buyer) => buyer.id === "luma" && buyer.active);
  const declined = needsPhysicalChange && getEffectiveConsent(source, "luma") === "declined";
  const physicalConsentRequired: BuyerId[] = needsPhysicalChange && getEffectiveConsent(draft, "luma") !== "accepted" ? ["luma"] : [];
  const blockers: PlanningBlocker[] = raw.issues.map((issue) => ({
    code: issue.code, message: issue.message, buyerIds: [...issue.buyerIds],
    ...(issue.shortfall === undefined ? {} : { shortfall: issue.shortfall }),
  }));
  blockers.push(...rangeBlockers);
  if (declined) blockers.push({
    code: "SUBSTITUTION_DECLINED", buyerIds: ["luma"],
    message: "LUMA declined the sleeve substitution. Keep the original design, or explicitly reopen that choice before considering a shared-base plan.",
  });

  const totalExtraUnits = quantityDeltas.reduce((total, change) => total + Math.max(0, change.delta), 0);
  const totalReducedUnits = quantityDeltas.reduce((total, change) => total + Math.max(0, -change.delta), 0);
  const budgetDeltas = raw.buyerQuotes.map((quote) => ({
    buyerId: quote.buyerId, budgetCents: quote.budgetCents, totalCents: quote.totalCents,
    shortfallCents: Math.max(0, quote.totalCents - quote.budgetCents),
    headroomCents: quote.budgetCents - quote.totalCents,
  }));
  const risks: string[] = [];
  if (kind !== "original-minimums" && needsPhysicalChange) {
    risks.push("LUMA's base material and unwrapped appearance change; its own branding is carried by the black sleeve.");
  }
  for (const change of quantityDeltas) {
    const name = source.buyers.find((buyer) => buyer.id === change.buyerId)!.name;
    risks.push(change.delta < 0
      ? `${name} receives ${-change.delta} fewer boxes than requested and must explicitly agree.`
      : `${name} buys ${change.delta} additional boxes and must explicitly accept the quantity and resulting cost.`);
  }
  if (kind === "original-minimums" && totalExtraUnits > 0) risks.push("Extra inventory is a trade-off, not a saving. Existing budget limits remain unchanged.");
  if (blockers.some((issue) => issue.code === "LEAD_TIME_EXCEEDED")) risks.push("Quantity changes cannot shorten the fictional supplier's seven-day production time.");
  if (!risks.length) risks.push("All final itemized quotes still require buyer approval before any separate payment step.");

  let title: string;
  let explanation: string;
  if (kind === "shared-base") {
    title = "Share the base. Keep your quantities.";
    explanation = "Use one compatible kraft base with separate branding. Every buyer keeps the requested quantity; any physical change still needs its own approval.";
  } else if (kind === "original-minimums") {
    title = "Keep the original materials.";
    explanation = "Buy enough of each originally requested base variant to meet its separate minimum. Extra quantities and any budget gaps are shown explicitly.";
  } else {
    const changedNames = quantityDeltas.map((change) => source.buyers.find((buyer) => buyer.id === change.buyerId)!.name);
    title = `Adjust quantities with ${changedNames.join(" + ")}.`;
    explanation = "A quantity proposal within each buyer's explicitly permitted range. It preserves the shared base minimum and is checked against each unchanged budget and production deadline; every changed quantity still needs approval.";
  }
  const id = kind === "quantity-rebalance" ? `rebalance-${IDS.map((buyerId) => quantities[buyerId]).join("-")}` : kind;
  const requiredConsents: Evaluation["requiredConsents"] = physicalConsentRequired.length ? [{
    buyerId: "luma", changeId: "kraft-with-black-sleeve", from: "black", to: "kraft",
    brandingFinish: "black-branded-sleeve",
    description: "Explicitly approve the kraft base with a LUMA-branded black sleeve after the requested quantities have been updated.",
    // The preview does not carry a usable authorization or pre-approved scenario.
    conditionsKey: "planning-preview-only",
  }] : [];
  const previewIssues: ScenarioIssue[] = raw.issues.map((issue) => ({ ...issue, buyerIds: [...issue.buyerIds] }));
  previewIssues.push(...rangeBlockers.map((issue) => ({ ...issue, code: "QUANTITY_OUT_OF_RANGE" as const })));
  if (physicalConsentRequired.length) previewIssues.push({
    code: "SUBSTITUTION_CONSENT_REQUIRED", buyerIds: ["luma"],
    message: declined ? "LUMA's previous decline is still respected. Reopen the physical choice explicitly to consider this plan." : "Physical substitution consent remains separate from quantity approval.",
  });
  return {
    id, kind, title, explanation, inputFingerprint,
    quantities: { ...quantities }, quantityDeltas, budgetDeltas,
    requiredApprovals: quantityDeltas.map((change) => change.buyerId),
    physicalConsentRequired,
    evaluation: {
      ...raw,
      constraintsSatisfied: raw.constraintsSatisfied && rangeBlockers.length === 0,
      feasible: false,
      isHypothetical: true,
      priceStatus: "conditional-estimate",
      status: raw.activeBuyerCount ? "blocked" : "empty",
      issues: previewIssues,
      requiredConsents,
    },
    feasibleIfApproved: raw.constraintsSatisfied && !declined && rangeBlockers.length === 0,
    blockers, risks, totalExtraUnits, totalReducedUnits,
    totalChangedUnits: totalExtraUnits + totalReducedUnits,
  };
}

/** A transparent top-up proposal. Five-box rounding is a suggestion, not a supplier constraint. */
function originalMinimumQuantities(scenario: Scenario): Record<BuyerId, number> {
  const quantities = quantitiesOf(scenario);
  for (const variant of ["kraft", "black"] as const) {
    const buyers = scenario.buyers.filter((buyer) => buyer.active && buyer.requestedBase === variant);
    const originalTotal = buyers.reduce((total, buyer) => total + buyer.quantity, 0);
    if (!buyers.length || originalTotal >= scenario.supplier.moqPerBaseVariant) continue;
    let remaining = scenario.supplier.moqPerBaseVariant - originalTotal;
    const deficit = remaining;
    buyers.forEach((buyer, index) => {
      const proportional = (deficit * buyer.quantity) / originalTotal;
      const extra = index === buyers.length - 1 ? remaining : Math.min(remaining, Math.max(0, Math.round(proportional / 5) * 5));
      quantities[buyer.id] += extra;
      remaining -= extra;
    });
  }
  return quantities;
}

interface SearchScore {
  changedUnits: number;
  changedBuyers: number;
  minimumHeadroom: number;
  totalCents: number;
}
interface SearchCandidate extends SearchScore { quantities: number[]; id: string; }
interface SearchNode extends SearchScore { lower: number[]; upper: number[]; minimumTotal: number; }
interface QuantitySearch {
  plans: PlanningPlan[];
  complete: boolean;
  exploredNodes: number;
}

function rankScores(a: SearchScore, b: SearchScore): number {
  return a.changedUnits - b.changedUnits
    || a.changedBuyers - b.changedBuyers
    || b.minimumHeadroom - a.minimumHeadroom
    || a.totalCents - b.totalCents;
}

/**
 * Search every permitted quantity, including lower totals, without enumerating
 * the Cartesian product. Bounds use the cheapest possible setup share in each
 * region; exact largest-remainder cents are checked before accepting a point.
 * A work budget is explicit rather than silently clipping a buyer's range.
 */
function rebalancedPlans(scenario: Scenario, inputFingerprint: string): QuantitySearch {
  const empty = { plans: [], complete: true, exploredNodes: 0 };
  const active = scenario.buyers.filter((buyer) => buyer.active);
  if (!active.length || getEffectiveConsent(scenario, "luma") === "declined") return empty;
  if (active.some((buyer) => buyer.maxLeadDays < scenario.supplier.leadDays)) return empty;
  const { setupCentsPerBaseVariant: setup, shippingCentsPerBuyer: shipping, moqPerBaseVariant: moq } = scenario.supplier;
  const unit = active.map((buyer) => scenario.supplier.baseUnitCents.kraft + (buyer.id === "luma"
    ? scenario.supplier.blackBrandedSleeveUnitCents : scenario.supplier.brandLabelUnitCents));
  const requested = active.map((buyer) => buyer.quantity);
  const initial = quantitiesOf(scenario);
  const candidates: SearchCandidate[] = [];
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const clamp = (value: number, lower: number, upper: number) => Math.max(lower, Math.min(upper, value));
  // floor(unit*q + setup*q/total) <= budget-shipping. Integer arithmetic
  // preserves the strict upper endpoint even on a one-cent budget boundary.
  const budgetUpper = (index: number, total: number) => Math.floor(
    ((active[index].budgetCents - shipping + 1) * total - 1) / (unit[index] * total + setup),
  );

  function bounded(lower: number[], upper: number[]): SearchNode | null {
    for (let i = 0; i < active.length; i++) {
      upper[i] = Math.min(upper[i], Math.floor((active[i].budgetCents - shipping) / unit[i]));
      if (lower[i] > upper[i]) return null;
    }
    let tightened: boolean;
    do {
      tightened = false;
      const maximumTotal = sum(upper);
      if (maximumTotal < moq) return null;
      for (let i = 0; i < active.length; i++) {
        const next = Math.min(upper[i], budgetUpper(i, maximumTotal));
        if (next < lower[i]) return null;
        if (next < upper[i]) { upper[i] = next; tightened = true; }
      }
    } while (tightened);

    const maximumTotal = sum(upper);
    let minimumTotal = Math.max(moq, sum(lower));
    let minimumHeadroom = Number.POSITIVE_INFINITY;
    for (let i = 0; i < active.length; i++) {
      const room = active[i].budgetCents - shipping - unit[i] * lower[i];
      if (room < 0) return null;
      // The lower quantity must be affordable even before a rounding cent.
      minimumTotal = Math.max(minimumTotal, Math.floor(setup * lower[i] / (room + 1)) + 1);
      const cheapestSetup = Math.floor(setup * lower[i] / (lower[i] + maximumTotal - upper[i]));
      minimumHeadroom = Math.min(minimumHeadroom, room - cheapestSetup);
    }
    if (minimumTotal > maximumTotal) return null;
    const nearest = requested.map((quantity, i) => clamp(quantity, lower[i], upper[i]));
    const extra = Math.max(0, minimumTotal - sum(nearest));
    const changedUnits = sum(nearest.map((quantity, i) => Math.abs(quantity - requested[i]))) + extra;
    let changedBuyers = nearest.filter((quantity, i) => quantity !== requested[i]).length;
    let extraNeedingNewBuyer = extra - sum(nearest.map((quantity, i) => quantity !== requested[i] ? upper[i] - quantity : 0));
    const unchangedCapacity = nearest.map((quantity, i) => quantity === requested[i] ? upper[i] - quantity : 0).sort((a, b) => b - a);
    for (const capacity of unchangedCapacity) {
      if (extraNeedingNewBuyer <= 0) break;
      if (capacity > 0) { extraNeedingNewBuyer -= capacity; changedBuyers += 1; }
    }
    let totalCents = setup + shipping * active.length + sum(lower.map((quantity, i) => quantity * unit[i]));
    let additional = minimumTotal - sum(lower);
    for (const index of active.map((_, i) => i).sort((a, b) => unit[a] - unit[b])) {
      const amount = Math.min(additional, upper[index] - lower[index]);
      totalCents += amount * unit[index]; additional -= amount;
    }
    return { lower, upper, minimumTotal, changedUnits, changedBuyers, minimumHeadroom, totalCents };
  }

  function consider(quantities: number[]): void {
    const total = sum(quantities);
    if (total < moq || quantities.every((quantity, i) => quantity === requested[i])) return;
    const shares = quantities.map((quantity, i) => ({ index: i, cents: Math.floor(setup * quantity / total), remainder: setup * quantity % total }));
    let unassigned = setup - sum(shares.map((share) => share.cents));
    shares.sort((a, b) => b.remainder - a.remainder || active[a.index].id.localeCompare(active[b.index].id));
    for (const share of shares) if (unassigned > 0) { share.cents += 1; unassigned -= 1; }
    const totals = quantities.map((quantity, i) => quantity * unit[i] + shipping);
    for (const share of shares) totals[share.index] += share.cents;
    if (totals.some((cost, i) => cost > active[i].budgetCents)) return;
    const allQuantities = { ...initial };
    active.forEach((buyer, i) => { allQuantities[buyer.id] = quantities[i]; });
    const candidate: SearchCandidate = {
      id: `rebalance-${IDS.map((id) => allQuantities[id]).join("-")}`,
      quantities: [...quantities],
      changedUnits: sum(quantities.map((quantity, i) => Math.abs(quantity - requested[i]))),
      changedBuyers: quantities.filter((quantity, i) => quantity !== requested[i]).length,
      minimumHeadroom: Math.min(...totals.map((cost, i) => active[i].budgetCents - cost)),
      totalCents: sum(totals),
    };
    if (candidates.some((other) => other.id === candidate.id)) return;
    candidates.push(candidate);
    candidates.sort((a, b) => rankScores(a, b) || a.id.localeCompare(b.id));
    candidates.length = Math.min(candidates.length, MAX_REBALANCED_PLANS);
  }

  const orders: number[][] = [];
  function orderings(prefix: number[], remaining: number[]) {
    if (!remaining.length) { orders.push(prefix); return; }
    for (const index of remaining) orderings([...prefix, index], remaining.filter((item) => item !== index));
  }
  orderings([], active.map((_, i) => i));
  function seed(node: SearchNode, total: number, nearby: boolean): void {
    if (total < node.minimumTotal || total > sum(node.upper)) return;
    const upper = node.upper.map((value, i) => Math.min(value, budgetUpper(i, total)));
    if (upper.some((value, i) => value < node.lower[i]) || sum(upper) < total) return;
    for (const order of orders) {
      const quantities = requested.map((quantity, i) => clamp(quantity, node.lower[i], upper[i]));
      let difference = total - sum(quantities);
      for (const i of order) {
        const change = difference > 0 ? Math.min(difference, upper[i] - quantities[i]) : Math.max(difference, node.lower[i] - quantities[i]);
        quantities[i] += change; difference -= change;
      }
      if (difference !== 0) continue;
      consider(quantities);
      if (nearby) for (let i = 0; i < active.length; i++) for (let j = 0; j < active.length; j++) {
        if (i === j || quantities[i] >= upper[i] || quantities[j] <= node.lower[j]) continue;
        const adjacent = [...quantities]; adjacent[i] += 1; adjacent[j] -= 1;
        consider(adjacent);
      }
    }
  }

  const root = bounded(active.map((buyer) => getQuantityRange(buyer).min), active.map((buyer) => getQuantityRange(buyer).max));
  if (!root) return empty;
  const requestedTotal = sum(requested);
  const nearTotal = clamp(requestedTotal, root.minimumTotal, sum(root.upper));
  // This extra seed uses a rounded-up setup share. It helps fixed large buyers
  // whose budget can only fit after other explicitly flexible buyers add units.
  let roundingSafeTotal = root.minimumTotal;
  for (let i = 0; i < active.length; i++) {
    const room = active[i].budgetCents - shipping - unit[i] * root.lower[i];
    if (room > 0) roundingSafeTotal = Math.max(roundingSafeTotal, Math.ceil(setup * root.lower[i] / room));
  }
  for (const total of new Set([nearTotal, nearTotal - 1, nearTotal + 1, root.minimumTotal, roundingSafeTotal, sum(root.upper)])) seed(root, total, true);
  // A best-bound heap reaches the most promising region first. The finite node
  // budget is independent of range width and keeps server/UI work predictable.
  const heap: SearchNode[] = [];
  const canImprove = (node: SearchNode) => candidates.length < MAX_REBALANCED_PLANS || rankScores(node, candidates[MAX_REBALANCED_PLANS - 1]) <= 0;
  function push(node: SearchNode | null): void {
    if (!node || !canImprove(node)) return;
    heap.push(node);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (rankScores(heap[parent], heap[index]) <= 0) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]]; index = parent;
    }
  }
  function pop(): SearchNode {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && rankScores(heap[child + 1], heap[child]) < 0) child += 1;
        if (rankScores(heap[index], heap[child]) <= 0) break;
        [heap[index], heap[child]] = [heap[child], heap[index]]; index = child;
      }
    }
    return first;
  }
  push(root);
  let exploredNodes = 0;
  while (heap.length && exploredNodes < MAX_SEARCH_NODES) {
    const node = pop();
    if (!canImprove(node)) continue;
    exploredNodes += 1;
    let split = 0;
    for (let i = 1; i < active.length; i++) if (node.upper[i] - node.lower[i] > node.upper[split] - node.lower[split]) split = i;
    if (node.lower[split] === node.upper[split]) { consider(node.lower); continue; }
    const nearestTotal = sum(requested.map((quantity, i) => clamp(quantity, node.lower[i], node.upper[i])));
    seed(node, Math.max(node.minimumTotal, nearestTotal), false);
    if (!canImprove(node)) continue;
    const midpoint = Math.floor((node.lower[split] + node.upper[split]) / 2);
    const lowUpper = [...node.upper]; lowUpper[split] = midpoint;
    const highLower = [...node.lower]; highLower[split] = midpoint + 1;
    push(bounded([...node.lower], lowUpper));
    push(bounded(highLower, [...node.upper]));
  }
  const plans = candidates.map((candidate) => {
    const quantities = { ...initial };
    active.forEach((buyer, i) => { quantities[buyer.id] = candidate.quantities[i]; });
    return makePlan(scenario, "quantity-rebalance", quantities, inputFingerprint);
  }).filter((plan) => plan.feasibleIfApproved);
  return { plans, complete: heap.every((node) => !canImprove(node)), exploredNodes };
}

export function buildPlanningOverview(input: Scenario): PlanningOverview {
  const scenario = parseScenario(input);
  const inputFingerprint = getScenarioFingerprintInput(scenario);
  const shared = makePlan(scenario, "shared-base", quantitiesOf(scenario), inputFingerprint);
  const original = makePlan(scenario, "original-minimums", originalMinimumQuantities(scenario), inputFingerprint);
  // Keep the unmodified request as the first choice whenever it is already feasible.
  const originalRequested = evaluateOriginalScenario(scenario);
  const search = shared.feasibleIfApproved || originalRequested.feasible
    ? { plans: [], complete: true, exploredNodes: 0 } : rebalancedPlans(scenario, inputFingerprint);
  const plans = [shared, ...search.plans, original];
  const recommendedPlanId = originalRequested.feasible ? original.id
    : shared.feasibleIfApproved ? shared.id
      : search.plans[0]?.id ?? (original.feasibleIfApproved ? original.id : null);
  return {
    source: "curated-demo-rules", supplierVerified: false,
    originalRequested, plans, recommendedPlanId,
    blockers: recommendedPlanId ? [] : [...shared.blockers, ...(!search.complete ? [{
      code: "SEARCH_LIMIT_REACHED" as const, buyerIds: activeIds(scenario),
      message: "This wide quantity range exceeded the search work limit. No matching plan has been proved impossible; narrow the permitted ranges to finish the comparison.",
    }] : [])],
    search: { complete: search.complete, exploredNodes: search.exploredNodes },
    disclaimer: "All suppliers, prices and production rules are fictional demo assumptions. Comparisons are computed scenarios, not measured savings or verified supplier offers.",
  };
}

function activeIds(scenario: Scenario): BuyerId[] {
  return scenario.buyers.filter((buyer) => buyer.active).map((buyer) => buyer.id);
}

/**
 * Applies only explicitly approved quantity changes to a fresh scenario.
 * No money limits or deadlines are relaxed; physical consent remains separate.
 */
export function applyPlanningPlan(
  input: Scenario,
  planId: string,
  approvedBuyerIds: BuyerId[],
  expectedFingerprint: string,
): Scenario {
  const scenario = parseScenario(input);
  if (getScenarioFingerprintInput(scenario) !== expectedFingerprint) {
    throw new PlanningError("STALE_PLAN", "The request changed. Recalculate the alternatives and approve the new quantities.");
  }
  const plan = buildPlanningOverview(scenario).plans.find((item) => item.id === planId);
  if (!plan) throw new PlanningError("UNKNOWN_PLAN", "This alternative is not available for the current request.");
  if (scenario.buyers.some((buyer) => {
    const range = getQuantityRange(buyer);
    return buyer.active && (plan.quantities[buyer.id] < range.min || plan.quantities[buyer.id] > range.max);
  })) throw new PlanningError("PLAN_BLOCKED", "This plan exceeds a buyer's explicitly permitted quantity range.");
  if (!plan.feasibleIfApproved) throw new PlanningError("PLAN_BLOCKED", "This option still fails a budget, production, minimum quantity or declined-change condition.");
  if (!Array.isArray(approvedBuyerIds) || new Set(approvedBuyerIds).size !== approvedBuyerIds.length
    || JSON.stringify([...approvedBuyerIds].sort()) !== JSON.stringify([...plan.requiredApprovals].sort())) {
    throw new PlanningError("APPROVAL_REQUIRED", "Every buyer whose quantity changes must explicitly approve the proposed quantity.");
  }
  let next = applyQuantities(scenario, plan.quantities);
  if (plan.kind === "original-minimums" && next.buyers.find((buyer) => buyer.id === "luma")!.substitutionConsent.decision !== "pending") {
    next = applyConsent(next, "luma", "pending");
  }
  return next;
}
