import { ApiError } from "./api-errors.ts";
import type { PaymentAttempt } from "./paypal-service.ts";
import { summarizeCohort } from "./server-cohort.ts";
import { verifyApprovedQuote, type ApprovedQuote } from "./server-quotes.ts";

/** Injected storage keeps the protection policy testable without D1 or a provider. */
export interface CheckoutProtectionStore {
  activeQuote(ownerId: string): Promise<ApprovedQuote | null>;
  attempts(ownerId: string, quoteId: string): Promise<PaymentAttempt[]>;
}

export async function findActiveCheckout(ownerId: string, store: CheckoutProtectionStore): Promise<ApprovedQuote | null> {
  const quote = await store.activeQuote(ownerId);
  if (quote && quote.ownerId !== ownerId) throw new ApiError(404, "QUOTE_NOT_FOUND", "This checkout does not belong to your workspace.");
  return quote;
}

/** Call inside the same workspace mutex as the subsequent replacement/invalidation.
 * Expiry permits archiving, never a refund or a new capture on the old quote.
 * All verified payments remain in their original immutable quote after completion.
 */
export async function assertWorkspaceMayChange(
  ownerId: string, store: CheckoutProtectionStore, now = Date.now(), targetProposalId?: string,
): Promise<void> {
  const quote = await findActiveCheckout(ownerId, store);
  if (!quote || (targetProposalId && quote.proposalId !== targetProposalId) || quote.expiresAt <= now) return;
  const attempts = await store.attempts(ownerId, quote.id);
  if (!attempts.length) return;
  // Uncertain creates, unverified completions, and partial payments all retain the lock.
  if (attempts.some(attempt => attempt.ownerId !== ownerId || attempt.quoteId !== quote.id)) {
    throw new ApiError(409, "CHECKOUT_IN_PROGRESS", "A saved checkout needs to be recovered before this workspace can change.");
  }
  const evaluation = await verifyApprovedQuote(quote, ownerId, now, true);
  if (!summarizeCohort(evaluation, attempts, true).readyToProceed) {
    throw new ApiError(409, "CHECKOUT_IN_PROGRESS", "A Sandbox checkout is already in progress. Recover its saved quote and finish checking those payments before creating or changing a plan.");
  }
}

export type GuidanceStatus = "ready" | "not_configured" | "skipped" | "error" | "limited";
/** Optional explanatory guidance must never gate canonical quote calculation. */
export async function resolveOptionalGuidance<T>(requested: boolean, configured: boolean, select: () => Promise<T>) {
  if (!requested || !configured) return {
    selection: null as T | null, guidanceStatus: (!requested ? "skipped" : "not_configured") as GuidanceStatus,
  };
  try { return { selection: await select(), guidanceStatus: "ready" as GuidanceStatus }; }
  catch (error) {
    if (error instanceof ApiError && error.code === "AI_DAILY_LIMIT") {
      return { selection: null, guidanceStatus: "limited" as GuidanceStatus, guidanceError: error.message };
    }
    return { selection: null as T | null, guidanceStatus: "error" as GuidanceStatus,
      guidanceError: "AI guidance is unavailable. The supplier rules and prices were still checked without AI." };
  }
}
