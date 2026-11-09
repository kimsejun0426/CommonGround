import type { BuyerId, Evaluation, Proposal, Scenario } from "./domain.ts";
import { evaluateScenario, getScenarioFingerprintInput, parseScenario, proposeScenario } from "./engine.ts";
import { ApiError } from "./api-errors.ts";
import type { PayableQuote } from "./paypal.ts";

export const QUOTE_LIFETIME_MS = 60 * 60 * 1000;
export type ProposalMode = "rules_demo" | "live_ai";
export interface StoredProposal {
  id: string; ownerId: string; fingerprint: string; scenarioJson: string; proposalJson: string;
  mode: string; aiSelectionJson: string | null; createdAt: number; expiresAt: number;
}
export interface ApprovedQuote {
  id: string; ownerId: string; proposalId: string; fingerprint: string; scenarioJson: string;
  evaluationJson: string; consentsJson: string; createdAt: number; expiresAt: number;
}
export interface FinalQuoteConsent { buyerId: BuyerId; fingerprint: string; approvedAt: number; }

export function validatedScenario(input: unknown): Scenario {
  try { return parseScenario(input); }
  catch { throw new ApiError(400, "INVALID_SCENARIO", "The request must use the fixed demo supplier facts and valid buyer quantities, budgets, deadlines and decisions."); }
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}

export async function fingerprintScenario(input: Scenario): Promise<string> {
  const scenario = validatedScenario(input);
  return sha256(JSON.stringify({
    version: "commonground-quote-v1",
    scenario: getScenarioFingerprintInput(scenario),
    evaluation: evaluateScenario(scenario),
  }));
}

export function evaluatedProposal(input: unknown): { scenario: Scenario; proposal: Proposal } {
  const scenario = validatedScenario(input);
  return { scenario, proposal: proposeScenario(scenario) };
}

/** Final-price approval is separate from LUMA's physical substitution consent. */
export function validateFinalApprovals(evaluation: Evaluation, approvedBuyerIds: unknown): BuyerId[] {
  if (!evaluation.feasible || !evaluation.constraintsSatisfied || evaluation.isHypothetical || evaluation.priceStatus !== "orderable") {
    throw new ApiError(409, "COHORT_NOT_ORDERABLE", "Every MOQ, budget, deadline and current physical-change consent must be satisfied before checkout. A hypothetical proposal cannot be paid.");
  }
  const active = evaluation.buyerQuotes.map((quote) => quote.buyerId).sort();
  if (!Array.isArray(approvedBuyerIds) || approvedBuyerIds.some((id) => typeof id !== "string") ||
      new Set(approvedBuyerIds).size !== approvedBuyerIds.length ||
      JSON.stringify([...approvedBuyerIds].sort()) !== JSON.stringify(active)) {
    throw new ApiError(409, "FINAL_QUOTE_APPROVAL_REQUIRED", "Approve each active persona's own final itemized quote before starting any sandbox payment.");
  }
  return active;
}

export async function approveProposal(
  proposal: StoredProposal,
  input: { ownerId: string; fingerprint: string; scenario: unknown; approvedBuyerIds: unknown },
  now = Date.now(),
): Promise<ApprovedQuote> {
  if (proposal.ownerId !== input.ownerId) throw new ApiError(404, "PROPOSAL_NOT_FOUND", "This proposal does not belong to your workspace.");
  if (proposal.expiresAt <= now) throw new ApiError(409, "QUOTE_EXPIRED", "Refresh the proposal and approve the updated quotes.");
  const scenario = validatedScenario(input.scenario);
  const fingerprint = await fingerprintScenario(scenario);
  if (fingerprint !== proposal.fingerprint || input.fingerprint !== fingerprint ||
      getScenarioFingerprintInput(scenario) !== getScenarioFingerprintInput(validatedScenario(JSON.parse(proposal.scenarioJson)))) {
    throw new ApiError(409, "STALE_QUOTE", "The request changed. Generate a new proposal and approve all final quotes again.");
  }
  const evaluation = evaluateScenario(scenario);
  const ids = validateFinalApprovals(evaluation, input.approvedBuyerIds);
  const consents: FinalQuoteConsent[] = ids.map((buyerId) => ({ buyerId, fingerprint, approvedAt: now }));
  return {
    id: `quote_${crypto.randomUUID()}`, ownerId: input.ownerId, proposalId: proposal.id, fingerprint,
    scenarioJson: JSON.stringify(scenario), evaluationJson: JSON.stringify(evaluation),
    consentsJson: JSON.stringify(consents), createdAt: now, expiresAt: proposal.expiresAt,
  };
}

/** Recompute from immutable server snapshots on every checkout, never from browser amounts. */
export async function verifyApprovedQuote(quote: ApprovedQuote, ownerId: string, now = Date.now(), allowExpired = false): Promise<Evaluation> {
  if (quote.ownerId !== ownerId) throw new ApiError(404, "QUOTE_NOT_FOUND", "This quote does not belong to your workspace.");
  if (!allowExpired && quote.expiresAt <= now) throw new ApiError(409, "QUOTE_EXPIRED", "This quote expired. Generate and approve a new quote.");
  const scenario = validatedScenario(JSON.parse(quote.scenarioJson));
  const evaluation = evaluateScenario(scenario);
  let consents: unknown;
  try { consents = JSON.parse(quote.consentsJson); } catch { throw new ApiError(409, "INVALID_CONSENT", "The saved approvals could not be verified."); }
  if (!Array.isArray(consents) || consents.some((value) => !value || typeof value !== "object" ||
    value.fingerprint !== quote.fingerprint || !Number.isSafeInteger(value.approvedAt) || value.approvedAt < quote.createdAt)) {
    throw new ApiError(409, "INVALID_CONSENT", "The saved approvals do not match this quote.");
  }
  validateFinalApprovals(evaluation, consents.map((value) => value.buyerId));
  if (await fingerprintScenario(scenario) !== quote.fingerprint || JSON.stringify(evaluation) !== quote.evaluationJson) {
    throw new ApiError(409, "STALE_QUOTE", "The saved quote no longer matches the current pricing rules. Review a new quote.");
  }
  return evaluation;
}

export function payableBuyerQuote(quote: ApprovedQuote, evaluation: Evaluation, buyerId: string): PayableQuote {
  const buyer = evaluation.buyerQuotes.find((item) => item.buyerId === buyerId);
  if (!buyer) throw new ApiError(400, "UNKNOWN_BUYER", "Choose an active buyer from this approved quote.");
  return {
    quoteId: quote.id, buyerId: buyer.buyerId, projectName: `${buyer.buyerName} demo packaging`,
    currency: "USD", totalCents: buyer.totalCents,
    items: [
      { id: `${buyer.buyerId}-base`, title: `${buyer.baseVariant} gift box`, quantity: buyer.quantity, unitPriceCents: buyer.unitBaseCents, totalCents: buyer.baseCents },
      { id: `${buyer.buyerId}-branding`, title: buyer.brandingFinish === "black-branded-sleeve" ? "Branded black paper sleeve" : "Brand label", quantity: buyer.quantity, unitPriceCents: buyer.unitBrandingCents, totalCents: buyer.brandingCents },
      { id: `${buyer.buyerId}-setup`, title: "Allocated shared setup fee", quantity: 1, unitPriceCents: buyer.setupCents, totalCents: buyer.setupCents },
      { id: `${buyer.buyerId}-shipping`, title: "Individual packing and shipping", quantity: 1, unitPriceCents: buyer.shippingCents, totalCents: buyer.shippingCents },
    ].filter((item) => item.totalCents > 0),
  };
}
