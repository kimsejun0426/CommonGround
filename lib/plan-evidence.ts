import type { BaseVariant, BuyerId, MOQGroupStatus } from "./domain.ts";
import type { PlanningOverview, PlanningPlan } from "./planning.ts";

export interface EvidenceGroup {
  baseVariant: BaseVariant;
  quantity: number;
  minimum: number;
  shortfall: number;
  met: boolean;
  /** Visual progress only; the printed quantity is never capped at the minimum. */
  fillPercent: number;
}

export interface BrandEvidence {
  buyerId: BuyerId;
  name: string;
  requestedQuantity: number;
  proposedQuantity: number;
  quantityDelta: number;
  quantityWithinBounds: boolean;
  totalCents: number;
  budgetCents: number;
  budgetHeadroomCents: number;
  withinBudget: boolean;
  productionDays: number;
  maximumProductionDays: number;
  withinProductionTime: boolean;
  quantityApprovalRequired: boolean;
  materialApprovalRequired: boolean;
  materialChangeDeclined: boolean;
}

export interface PlanEvidenceData {
  state: "empty" | "blocked" | "ready-for-review";
  originalRequestFeasible: boolean;
  originalGroups: EvidenceGroup[];
  selectedGroups: EvidenceGroup[];
  requestedTotal: number;
  selectedTotal: number;
  brands: BrandEvidence[];
  allNumericChecksPass: boolean;
  pendingChangeApprovals: BuyerId[];
  additionalUnitsByBuyer: number;
  reducedUnitsByBuyer: number;
  /** A quantity-only counterfactual. Never a measured saving or supplier offer. */
  originalMaterialComparison: {
    totalQuantity: number;
    additionalToRequestedTotal: number;
    fewerTotalBoxesInSelectedPlan: number;
    comparisonFitsBuyerRules: boolean;
  } | null;
}

function groupEvidence(group: MOQGroupStatus): EvidenceGroup {
  return {
    baseVariant: group.baseVariant,
    quantity: group.quantity,
    minimum: group.moq,
    shortfall: group.shortfall,
    met: group.met,
    fillPercent: group.moq > 0
      ? Math.min(100, Math.max(0, group.quantity / group.moq * 100))
      : 0,
  };
}

/**
 * Explain an already-computed plan. This does not search, authorize a change,
 * estimate commercial savings, or turn a hypothetical plan into a payable quote.
 */
export function buildPlanEvidence(
  overview: PlanningOverview,
  plan: PlanningPlan,
): PlanEvidenceData {
  const original = overview.originalRequested;
  const selected = plan.evaluation;
  const originalByBuyer = new Map(original.buyerQuotes.map((quote) => [quote.buyerId, quote]));
  const brands = selected.buyerQuotes.map((quote): BrandEvidence => {
    const requested = originalByBuyer.get(quote.buyerId);
    // Both evaluations come from the same planning overview and active cohort.
    if (!requested) throw new Error("Plan evidence requires the same active buyer cohort.");
    return {
      buyerId: quote.buyerId,
      name: quote.buyerName,
      requestedQuantity: requested.quantity,
      proposedQuantity: quote.quantity,
      quantityDelta: quote.quantity - requested.quantity,
      quantityWithinBounds: !plan.blockers.some((blocker) =>
        blocker.code === "QUANTITY_OUT_OF_RANGE" && blocker.buyerIds.includes(quote.buyerId)),
      totalCents: quote.totalCents,
      budgetCents: quote.budgetCents,
      budgetHeadroomCents: quote.budgetCents - quote.totalCents,
      withinBudget: quote.withinBudget,
      productionDays: quote.leadDays,
      maximumProductionDays: quote.maxLeadDays,
      withinProductionTime: quote.withinLeadTime,
      quantityApprovalRequired: plan.requiredApprovals.includes(quote.buyerId),
      materialApprovalRequired: plan.physicalConsentRequired.includes(quote.buyerId),
      materialChangeDeclined: plan.blockers.some((blocker) =>
        blocker.code === "SUBSTITUTION_DECLINED" && blocker.buyerIds.includes(quote.buyerId)),
    };
  });
  const originalMaterialPlan = overview.plans.find((candidate) => candidate.kind === "original-minimums");
  const hasBuyers = brands.length > 0;
  return {
    state: !hasBuyers ? "empty" : plan.feasibleIfApproved ? "ready-for-review" : "blocked",
    originalRequestFeasible: original.feasible,
    originalGroups: original.groups.map(groupEvidence),
    selectedGroups: selected.groups.map(groupEvidence),
    requestedTotal: original.totalQuantity,
    selectedTotal: selected.totalQuantity,
    brands,
    allNumericChecksPass: hasBuyers && selected.groups.length > 0
      && selected.groups.every((group) => group.met)
      && brands.every((buyer) => buyer.quantityWithinBounds && buyer.withinBudget && buyer.withinProductionTime),
    pendingChangeApprovals: brands
      .filter((buyer) => buyer.quantityApprovalRequired || buyer.materialApprovalRequired)
      .map((buyer) => buyer.buyerId),
    additionalUnitsByBuyer: brands.reduce((sum, buyer) => sum + Math.max(0, buyer.quantityDelta), 0),
    reducedUnitsByBuyer: brands.reduce((sum, buyer) => sum + Math.max(0, -buyer.quantityDelta), 0),
    originalMaterialComparison: hasBuyers && originalMaterialPlan ? {
      totalQuantity: originalMaterialPlan.evaluation.totalQuantity,
      additionalToRequestedTotal: originalMaterialPlan.evaluation.totalQuantity - original.totalQuantity,
      fewerTotalBoxesInSelectedPlan: originalMaterialPlan.evaluation.totalQuantity - selected.totalQuantity,
      comparisonFitsBuyerRules: originalMaterialPlan.feasibleIfApproved,
    } : null,
  };
}
