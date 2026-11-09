import type { BuyerId, Evaluation, QuantityRange, Scenario } from "./domain.ts";
import {
  applyConsent,
  evaluateScenario,
  getEffectiveConsent,
  getQuantityRange,
  getScenarioFingerprintInput,
  parseScenario,
  updateBuyer,
} from "./engine.ts";
import { buildPlanningOverview } from "./planning.ts";

export interface NegotiationCopy { en: string; ko: string; }
export interface NegotiationChange {
  buyerId: BuyerId;
  buyerName: string;
  /** Quantities in the comparison, not a change to the saved desired quantity. */
  fromQuantity: number;
  toQuantity: number;
  fromBudgetCents: number;
  toBudgetCents: number;
  fromRange: QuantityRange;
  toRange: QuantityRange;
}
export interface NegotiationOption {
  id: string;
  kind: "budget" | "quantity";
  inputFingerprint: string;
  title: NegotiationCopy;
  question: NegotiationCopy;
  explanation: NegotiationCopy;
  changes: NegotiationChange[];
  /** Every buyer whose budget or permitted quantity range would change. */
  requiredApprovals: BuyerId[];
  quantities: Record<BuyerId, number>;
  /** This object is never orderable. All values are conditional comparisons. */
  evaluation: Evaluation;
  /** Numeric checks on the hypothetical conditions, not permission to order. */
  numericFit: boolean;
  physicalConsentRequired: BuyerId[];
}

export class NegotiationError extends Error {
  readonly code: "STALE_NEGOTIATION" | "UNKNOWN_NEGOTIATION" | "NEGOTIATION_APPROVAL_REQUIRED";
  constructor(code: NegotiationError["code"], message: string) {
    super(message);
    this.name = "NegotiationError";
    this.code = code;
  }
}

const IDS: readonly BuyerId[] = ["luma", "juniper", "forma"];
// Questions explore only small, disclosed changes. This is not an exhaustive
// search for new permissions; the ordinary planner searches saved permissions.
const QUESTION_RADIUS = 5;
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const quantitiesOf = (scenario: Scenario) => Object.fromEntries(
  scenario.buyers.map((buyer) => [buyer.id, buyer.quantity]),
) as Record<BuyerId, number>;

/** Private arithmetic clone. Neither its permission nor consent escapes. */
function preview(scenario: Scenario, quantities: Record<BuyerId, number>, budgets?: Partial<Record<BuyerId, number>>): Evaluation {
  let arithmetic = parseScenario(scenario);
  for (const buyer of scenario.buyers.filter((item) => item.active)) {
    const quantity = quantities[buyer.id];
    const range = getQuantityRange(buyer);
    arithmetic = updateBuyer(arithmetic, buyer.id, {
      quantity,
      quantityRange: { min: Math.min(range.min, quantity), max: Math.max(range.max, quantity) },
      ...(budgets?.[buyer.id] === undefined ? {} : { budgetCents: budgets[buyer.id] }),
    });
  }
  if (arithmetic.buyers.some((buyer) => buyer.id === "luma" && buyer.active)) {
    arithmetic = applyConsent(arithmetic, "luma", "accepted");
  }
  return evaluateScenario(arithmetic);
}

function changesFor(
  scenario: Scenario, quantities: Record<BuyerId, number>, budgets: Partial<Record<BuyerId, number>> = {},
): NegotiationChange[] {
  return scenario.buyers.filter((buyer) => buyer.active).flatMap((buyer) => {
    const fromRange = getQuantityRange(buyer);
    const quantity = quantities[buyer.id];
    const toBudgetCents = budgets[buyer.id] ?? buyer.budgetCents;
    const toRange = { min: Math.min(fromRange.min, quantity), max: Math.max(fromRange.max, quantity) };
    if (quantity === buyer.quantity && toBudgetCents === buyer.budgetCents) return [];
    return [{
      buyerId: buyer.id, buyerName: buyer.name,
      fromQuantity: buyer.quantity, toQuantity: quantity,
      fromBudgetCents: buyer.budgetCents, toBudgetCents,
      fromRange, toRange,
    }];
  });
}

function requiresPermission(change: NegotiationChange): boolean {
  return change.fromBudgetCents !== change.toBudgetCents ||
    change.fromRange.min !== change.toRange.min || change.fromRange.max !== change.toRange.max;
}

function makeOption(
  scenario: Scenario,
  kind: NegotiationOption["kind"],
  quantities: Record<BuyerId, number>,
  changes: NegotiationChange[],
  numeric: Evaluation,
): NegotiationOption {
  const requiredApprovals = changes.filter(requiresPermission).map((change) => change.buyerId);
  const physicalConsentRequired: BuyerId[] = scenario.buyers.some((buyer) => buyer.active && buyer.id === "luma") ? ["luma"] : [];
  const title = kind === "budget"
    ? { en: "Keep the requested quantities", ko: "원하는 수량 유지하기" }
    : { en: "Keep every budget limit", ko: "각자의 예산 지키기" };
  const termsEn = changes.map((change) => kind === "budget"
    ? `${change.buyerName}: budget ${money(change.fromBudgetCents)} → ${money(change.toBudgetCents)}`
    : `${change.buyerName}: ${change.fromQuantity} → ${change.toQuantity} boxes`).join("; ");
  const termsKo = changes.map((change) => kind === "budget"
    ? `${change.buyerName} 예산 ${money(change.fromBudgetCents)} → ${money(change.toBudgetCents)}`
    : `${change.buyerName} ${change.fromQuantity}개 → ${change.toQuantity}개`).join(" · ");
  const id = kind === "budget"
    ? `budget-${changes.map((change) => `${change.buyerId}-${change.toBudgetCents}`).join("-")}`
    : `quantity-${IDS.map((id) => quantities[id]).join("-")}`;
  const consent = physicalConsentRequired.length ? [{
    buyerId: "luma" as const, changeId: "kraft-with-black-sleeve" as const, from: "black" as const, to: "kraft" as const,
    brandingFinish: "black-branded-sleeve" as const,
    description: "LUMA must separately approve the common kraft base and branded black sleeve after conditions are reviewed.",
    conditionsKey: "negotiation-preview-only",
  }] : [];
  return {
    id, kind, inputFingerprint: getScenarioFingerprintInput(scenario), title,
    question: kind === "budget" ? {
      en: `Would the affected brands consider these budget limits? ${termsEn}.`,
      ko: `해당 브랜드가 이 예산 변경을 허용할까요? ${termsKo}.`,
    } : {
      en: `Could these brands allow a quantity range that includes this proposal? ${termsEn}.`,
      ko: `이 수량을 포함하도록 변경 허용 범위를 열어둘까요? ${termsKo}.`,
    },
    explanation: kind === "budget" ? {
      en: "The shared-base estimate keeps every requested quantity. Each increased budget needs its owner's approval; material changes and final quotes are reviewed afterwards.",
      ko: "공통 상자를 쓰면서 원하는 수량을 유지하는 계산이에요. 예산을 늘리는 브랜드가 각각 허용한 뒤, 소재 변경과 최종 견적을 검토해요.",
    } : {
      en: `A nearby comparison keeps all current budgets and totals ${numeric.totalQuantity} boxes. This step asks only for quantity flexibility; the exact allocation and material change still need review.`,
      ko: `현재 예산을 모두 지키며 총 ${numeric.totalQuantity}개를 맞추는 비교예요. 여기서는 수량 변경 범위만 허용해요. 실제 배분과 소재 변경은 다음 단계에서 검토해요.`,
    },
    changes, requiredApprovals, quantities: { ...quantities },
    numericFit: numeric.constraintsSatisfied,
    physicalConsentRequired,
    evaluation: {
      ...numeric, feasible: false, isHypothetical: true, status: "blocked", priceStatus: "conditional-estimate",
      requiredConsents: consent,
      issues: [...numeric.issues, ...consent.map((item) => ({
        code: "SUBSTITUTION_CONSENT_REQUIRED" as const, buyerIds: [item.buyerId],
        message: "This comparison does not grant physical-change consent or final quote approval.",
      }))],
    },
  };
}

/** Computes questions about changing conditions; it never relaxes saved conditions. */
export function buildNegotiationOptions(input: Scenario): NegotiationOption[] {
  const scenario = parseScenario(input);
  const active = scenario.buyers.filter((buyer) => buyer.active);
  if (!active.length || getEffectiveConsent(scenario, "luma") === "declined" ||
      active.some((buyer) => buyer.maxLeadDays < scenario.supplier.leadDays)) return [];
  // Existing permissions come first. Do not ask for broader commitments when a
  // valid plan is already available under the buyer's saved boundaries.
  const planning = buildPlanningOverview(scenario);
  if (planning.recommendedPlanId || !planning.search.complete) return [];

  const quantities = quantitiesOf(scenario);
  const unchanged = preview(scenario, quantities);
  const options: NegotiationOption[] = [];
  // A budget question cannot fix unmet production minimums or a missed deadline.
  if (unchanged.groups.every((group) => group.met) && unchanged.issues.length &&
      unchanged.issues.every((issue) => issue.code === "BUDGET_EXCEEDED")) {
    const budgets = Object.fromEntries(unchanged.buyerQuotes.filter((quote) => !quote.withinBudget)
      .map((quote) => [quote.buyerId, quote.totalCents])) as Partial<Record<BuyerId, number>>;
    const numeric = preview(scenario, quantities, budgets);
    const changes = changesFor(scenario, quantities, budgets);
    if (numeric.constraintsSatisfied && changes.length) options.push(makeOption(scenario, "budget", quantities, changes, numeric));
  }

  // Bounded nearby questions, at most 11^3 candidates. Unlike the ordinary
  // planner, these can ask to widen an exact quantity, so they are never plans.
  // Preserve requested total when it meets MOQ; otherwise consider MOQ top-up.
  const target = Math.max(active.reduce((sum, buyer) => sum + buyer.quantity, 0), scenario.supplier.moqPerBaseVariant);
  const candidates: Array<{ quantities: Record<BuyerId, number>; changes: NegotiationChange[]; numeric: Evaluation }> = [];
  function visit(index: number, sum: number, next: Record<BuyerId, number>): void {
    if (index === active.length) {
      if (sum !== target) return;
      const changes = changesFor(scenario, next);
      if (!changes.some(requiresPermission)) return;
      const numeric = preview(scenario, next);
      if (numeric.constraintsSatisfied) candidates.push({ quantities: { ...next }, changes, numeric });
      return;
    }
    const buyer = active[index];
    const low = Math.max(1, buyer.quantity - QUESTION_RADIUS);
    const high = Math.min(100_000, buyer.quantity + QUESTION_RADIUS);
    const remaining = active.slice(index + 1);
    const minRemaining = remaining.reduce((n, item) => n + Math.max(1, item.quantity - QUESTION_RADIUS), 0);
    const maxRemaining = remaining.reduce((n, item) => n + Math.min(100_000, item.quantity + QUESTION_RADIUS), 0);
    for (let quantity = low; quantity <= high; quantity += 1) {
      const subtotal = sum + quantity;
      if (subtotal + minRemaining > target || subtotal + maxRemaining < target) continue;
      visit(index + 1, subtotal, { ...next, [buyer.id]: quantity });
    }
  }
  visit(0, 0, quantities);
  const cost = (candidate: typeof candidates[number]) => candidate.changes.reduce((sum, item) => sum + Math.abs(item.toQuantity - item.fromQuantity), 0);
  const headroom = (candidate: typeof candidates[number]) => Math.min(...candidate.numeric.buyerQuotes.map((quote) => quote.budgetCents - quote.totalCents));
  candidates.sort((a, b) => cost(a) - cost(b) || a.changes.filter(requiresPermission).length - b.changes.filter(requiresPermission).length ||
    headroom(b) - headroom(a) || a.numeric.totalCents - b.numeric.totalCents ||
    IDS.map((id) => a.quantities[id]).join("-").localeCompare(IDS.map((id) => b.quantities[id]).join("-")));
  const best = candidates[0];
  if (best) options.push(makeOption(scenario, "quantity", best.quantities, best.changes, best.numeric));
  return options;
}

/** Re-derives the option. Client-carried prices, patches and permissions are not accepted. */
export function applyNegotiationOption(
  input: Scenario, optionId: string, approvedBuyerIds: BuyerId[], expectedFingerprint: string,
): Scenario {
  const scenario = parseScenario(input);
  if (getScenarioFingerprintInput(scenario) !== expectedFingerprint) {
    throw new NegotiationError("STALE_NEGOTIATION", "The request changed. Review the new questions before changing any conditions.");
  }
  const option = buildNegotiationOptions(scenario).find((candidate) => candidate.id === optionId);
  if (!option || !option.numericFit) throw new NegotiationError("UNKNOWN_NEGOTIATION", "This question is no longer available for the current conditions.");
  if (!Array.isArray(approvedBuyerIds) || new Set(approvedBuyerIds).size !== approvedBuyerIds.length ||
      JSON.stringify([...approvedBuyerIds].sort()) !== JSON.stringify([...option.requiredApprovals].sort())) {
    throw new NegotiationError("NEGOTIATION_APPROVAL_REQUIRED", "Every brand whose budget or quantity permission changes must explicitly approve.");
  }
  let next = scenario;
  for (const change of option.changes.filter(requiresPermission)) {
    next = updateBuyer(next, change.buyerId, option.kind === "budget"
      ? { budgetCents: change.toBudgetCents }
      : { quantityRange: change.toRange });
  }
  // updateBuyer invalidates old material consent; quantities are still the
  // original request. Existing plan review chooses/approves a concrete result.
  return next;
}
