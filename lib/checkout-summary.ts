import type { BuyerId, BuyerQuote } from "./domain.ts";

type Receipt = { kind: "sample" | "sandbox"; amountCents: number; reference: string };

/** Sample references and real saved Sandbox quote IDs must never share provenance. */
export function checkoutReference(mode: Receipt["kind"], quoteId: string | null, revision: number): string | null {
  return mode === "sample" ? `SAMPLE-CG001-R${revision}` : quoteId;
}

/** Presentation totals only. A matching receipt must already have passed the checkout's verification path. */
export function buildCheckoutSummary(
  quotes: BuyerQuote[],
  receipts: Partial<Record<BuyerId, Receipt>>,
  mode: Receipt["kind"],
) {
  const rows = quotes.map((quote) => {
    const receipt = receipts[quote.buyerId];
    const complete = Boolean(receipt && receipt.kind === mode && receipt.amountCents === quote.totalCents && receipt.reference);
    return { buyerId: quote.buyerId, name: quote.buyerName, amountCents: quote.totalCents, complete };
  });
  const totalCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
  const completedCents = rows.reduce((sum, row) => sum + (row.complete ? row.amountCents : 0), 0);
  const completedCount = rows.filter((row) => row.complete).length;
  return {
    rows, totalCents, completedCents, remainingCents: totalCents - completedCents,
    completedCount, totalCount: rows.length,
    pendingNames: rows.filter((row) => !row.complete).map((row) => row.name),
    progressPercent: totalCents > 0 ? Math.min(100, completedCents / totalCents * 100) : 0,
    allComplete: rows.length > 0 && completedCount === rows.length,
  };
}
