import type { Evaluation } from "./domain.ts";
import type { PaymentAttempt } from "./paypal-service.ts";
import { centsToDecimal, isPayPalOrderId } from "./paypal.ts";

/** A completed individual payment never implies atomic settlement of the cohort. */
export function summarizeCohort(evaluation: Evaluation, attempts: PaymentAttempt[], current: boolean) {
  const payments = evaluation.buyerQuotes.map((quote) => {
    const attempt = attempts.find((item) => item.buyerId === quote.buyerId);
    const verified = Boolean(attempt && attempt.status === "COMPLETED" && attempt.verifiedAt &&
      attempt.currency === "USD" && attempt.expectedAmountCents === quote.totalCents &&
      isPayPalOrderId(attempt.paypalOrderId) && isPayPalOrderId(attempt.captureId));
    return {
      buyerId: quote.buyerId,
      orderId: attempt?.paypalOrderId ?? null,
      paypalOrderId: attempt?.paypalOrderId ?? null,
      approvalUrl: attempt?.approvalUrl ?? null,
      captureId: verified ? attempt?.captureId ?? null : null,
      status: verified ? "COMPLETED" : attempt?.status === "COMPLETED" ? "UNVERIFIED" : attempt?.status ?? "NOT_STARTED",
      verified,
      totalCents: quote.totalCents,
      amountCents: quote.totalCents,
      amount: { currencyCode: "USD", value: centsToDecimal(quote.totalCents) },
    };
  });
  const completed = payments.filter((payment) => payment.verified).length;
  const allComplete = payments.length > 0 && completed === payments.length;
  const cohortStatus = !current ? "STALE" : allComplete ? "COMPLETED" : completed ? "PARTIALLY_PAID" : "UNPAID";
  return {
    payments, cohortStatus, completedBuyerCount: completed,
    readyToProceed: current && evaluation.feasible && !evaluation.isHypothetical && allComplete,
    paymentMode: "sandbox" as const,
    atomicSettlement: false,
    workspaceMode: "single-owner-persona-simulation" as const,
    supplierVerified: false,
  };
}
