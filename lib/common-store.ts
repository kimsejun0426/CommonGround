import { and, eq, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { approvedQuotes, proposals, workspaces } from "@/db/schema";
import { ApiError } from "./api-errors.ts";
import type { ApprovedQuote, StoredProposal } from "./server-quotes.ts";
import { getPaymentStore } from "./payment-store.ts";
import { assertWorkspaceMayChange, findActiveCheckout, type CheckoutProtectionStore } from "./workspace-protection.ts";
import { verifyUnpaidCheckout } from "./unpaid-checkout.ts";
import type { PaymentProvider } from "./paypal-service.ts";

/** Serializes edits and transfers for one owner; other owners are independent. */
export async function withWorkspaceLock<T>(ownerId: string, work: () => Promise<T>): Promise<T> {
  const db = getDb();
  const now = Date.now();
  const token = crypto.randomUUID();
  await db.insert(workspaces).values({ ownerId, activeProposalId: null, lockUntil: 0, lockToken: null, updatedAt: now }).onConflictDoNothing();
  const claim = await db.update(workspaces).set({ lockUntil: now + 150_000, lockToken: token }).where(and(eq(workspaces.ownerId, ownerId), lte(workspaces.lockUntil, now))).returning({ ownerId: workspaces.ownerId });
  if (claim.length !== 1) throw new ApiError(409, "WORKSPACE_BUSY", "A quote or payment is being processed. Retry in a moment.", true);
  try { return await work(); }
  finally {
    await db.update(workspaces).set({ lockUntil: 0, lockToken: null }).where(and(eq(workspaces.ownerId, ownerId), eq(workspaces.lockToken, token)));
  }
}

export async function saveProposal(proposal: StoredProposal): Promise<void> {
  // The caller holds withWorkspaceLock, shared with order creation and capture.
  await assertWorkspaceMayChange(proposal.ownerId, checkoutProtectionStore());
  const db = getDb();
  await db.insert(proposals).values(proposal);
  await db.update(workspaces).set({ activeProposalId: proposal.id, updatedAt: Date.now() }).where(eq(workspaces.ownerId, proposal.ownerId));
}

export async function getProposal(ownerId: string, id: string): Promise<StoredProposal | null> {
  const [row] = await getDb().select().from(proposals).where(and(eq(proposals.id, id), eq(proposals.ownerId, ownerId))).limit(1);
  return row ?? null;
}

export async function isCurrentProposal(ownerId: string, proposalId: string): Promise<boolean> {
  const [row] = await getDb().select().from(workspaces).where(eq(workspaces.ownerId, ownerId)).limit(1);
  return row?.activeProposalId === proposalId;
}

export async function assertCurrentProposal(ownerId: string, proposalId: string): Promise<void> {
  if (!await isCurrentProposal(ownerId, proposalId)) throw new ApiError(409, "STALE_QUOTE", "This proposal was replaced or edited. Generate a new proposal and approve its final quotes.");
}

export async function invalidateProposal(ownerId: string, proposalId: string): Promise<void> {
  if (!await getProposal(ownerId, proposalId)) throw new ApiError(404, "PROPOSAL_NOT_FOUND", "This proposal does not belong to your workspace.");
  await assertWorkspaceMayChange(ownerId, checkoutProtectionStore(), Date.now(), proposalId);
  await getDb().update(workspaces).set({ activeProposalId: null, updatedAt: Date.now() }).where(and(eq(workspaces.ownerId, ownerId), eq(workspaces.activeProposalId, proposalId)));
}

/** Caller holds withWorkspaceLock, also used by order creation and capture. */
export async function closeUnpaidQuote(ownerId: string, quoteId: string, provider: Pick<PaymentProvider, "getOrder">): Promise<void> {
  const quote = await getApprovedQuote(ownerId, quoteId);
  const attempts = await getPaymentStore().listForQuote(ownerId, quoteId);
  await verifyUnpaidCheckout(ownerId, quoteId, attempts, provider);
  if (!await isCurrentProposal(ownerId, quote.proposalId)) return; // Idempotent, but never describe an old paid quote as unpaid.
  await getDb().update(workspaces).set({ activeProposalId: null, updatedAt: Date.now() })
    .where(and(eq(workspaces.ownerId, ownerId), eq(workspaces.activeProposalId, quote.proposalId)));
}

export async function saveApprovedQuote(quote: ApprovedQuote): Promise<ApprovedQuote> {
  const db = getDb();
  await db.insert(approvedQuotes).values(quote).onConflictDoNothing({ target: [approvedQuotes.ownerId, approvedQuotes.proposalId] });
  const [saved] = await db.select().from(approvedQuotes).where(and(eq(approvedQuotes.ownerId, quote.ownerId), eq(approvedQuotes.proposalId, quote.proposalId))).limit(1);
  if (!saved || saved.fingerprint !== quote.fingerprint) throw new ApiError(409, "QUOTE_LOCKED", "This proposal already has a different approved quote.");
  return saved;
}

export async function getApprovedQuote(ownerId: string, id: string): Promise<ApprovedQuote> {
  const [row] = await getDb().select().from(approvedQuotes).where(and(eq(approvedQuotes.id, id), eq(approvedQuotes.ownerId, ownerId))).limit(1);
  if (!row) throw new ApiError(404, "QUOTE_NOT_FOUND", "This quote does not belong to your workspace.");
  return row;
}

function checkoutProtectionStore(): CheckoutProtectionStore {
  return {
    async activeQuote(ownerId) {
      const [workspace] = await getDb().select().from(workspaces).where(eq(workspaces.ownerId, ownerId)).limit(1);
      if (!workspace?.activeProposalId) return null;
      const [quote] = await getDb().select().from(approvedQuotes).where(and(eq(approvedQuotes.ownerId, ownerId), eq(approvedQuotes.proposalId, workspace.activeProposalId))).limit(1);
      return quote ?? null;
    },
    attempts: (ownerId, quoteId) => getPaymentStore().listForQuote(ownerId, quoteId),
  };
}

/** Includes expired/completed snapshots so a new tab can disclose their existing records. */
export async function getActiveCheckout(ownerId: string): Promise<ApprovedQuote | null> {
  return findActiveCheckout(ownerId, checkoutProtectionStore());
}
