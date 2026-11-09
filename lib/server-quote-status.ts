import type { ApprovedQuote } from "./server-quotes.ts";
import { validatedScenario, verifyApprovedQuote, type FinalQuoteConsent } from "./server-quotes.ts";
import { getProposal, isCurrentProposal } from "./common-store.ts";
import { getPaymentStore } from "./payment-store.ts";
import { summarizeCohort } from "./server-cohort.ts";

export async function quoteStatus(quote: ApprovedQuote) {
  const evaluation = await verifyApprovedQuote(quote, quote.ownerId, Date.now(), true);
  const current = quote.expiresAt > Date.now() && await isCurrentProposal(quote.ownerId, quote.proposalId);
  const attempts = await getPaymentStore().listForQuote(quote.ownerId, quote.id);
  const scenario = validatedScenario(JSON.parse(quote.scenarioJson));
  const approvedBuyerIds = (JSON.parse(quote.consentsJson) as FinalQuoteConsent[]).map((consent) => consent.buyerId);
  const proposal = await getProposal(quote.ownerId, quote.proposalId);
  return {
    quoteId: quote.id, proposalId: quote.proposalId, fingerprint: quote.fingerprint,
    scenario, approvedBuyerIds,
    mode: proposal?.mode === "live_ai" ? "live_ai" : "rules_demo",
    evaluation, buyerQuotes: evaluation.buyerQuotes, expiresAt: quote.expiresAt, current,
    ...summarizeCohort(evaluation, attempts, current),
  };
}
