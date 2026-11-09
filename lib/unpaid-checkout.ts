import { ApiError } from "./api-errors.ts";
import { decimalToCents, isPayPalOrderId, type PayPalOrder } from "./paypal.ts";
import type { PaymentAttempt } from "./paypal-service.ts";

/** Read-only provider reconciliation. The caller must hold the workspace lock
 * through both this check and closing the active proposal. No refund, void or
 * capture is sent; a closed proposal cannot initiate a later app capture. */
export async function verifyUnpaidCheckout(
  ownerId: string,
  quoteId: string,
  attempts: PaymentAttempt[],
  provider: { getOrder(orderId: string): Promise<PayPalOrder> },
  now = Date.now(),
): Promise<void> {
  if (attempts.length > 3 || new Set(attempts.map(item => item.buyerId)).size !== attempts.length) {
    throw new ApiError(409, "CHECKOUT_RECONCILIATION_REQUIRED", "This checkout needs payment reconciliation before it can be closed.");
  }
  // Validate every local record before making any provider request.
  for (const attempt of attempts) {
    if (attempt.ownerId !== ownerId || attempt.quoteId !== quoteId) {
      throw new ApiError(404, "QUOTE_NOT_FOUND", "This checkout does not belong to your workspace.");
    }
    if (attempt.verifiedAt || attempt.captureId || attempt.status === "COMPLETED") {
      throw new ApiError(409, "CHECKOUT_HAS_PAYMENT", "A payment is recorded on this quote. Closing an unpaid quote cannot refund or remove it.");
    }
    if (attempt.lockUntil > now || !isPayPalOrderId(attempt.paypalOrderId) || attempt.currency !== "USD") {
      throw new ApiError(409, "CHECKOUT_RECONCILIATION_REQUIRED", "A payment result is still uncertain. Check the existing payment before closing this quote.");
    }
  }
  await Promise.all(attempts.map(async attempt => {
    const order = await provider.getOrder(attempt.paypalOrderId!);
    const unit = order.purchase_units?.[0];
    if (order.id !== attempt.paypalOrderId || order.intent !== "CAPTURE" || order.purchase_units?.length !== 1 ||
        unit?.reference_id !== attempt.id || unit?.custom_id !== attempt.id ||
        unit?.amount?.currency_code !== "USD" || decimalToCents(unit?.amount?.value) !== attempt.expectedAmountCents) {
      throw new ApiError(502, "PAYMENT_VERIFICATION_FAILED", "The PayPal order could not be matched to this quote. It stays open.");
    }
    const captures = unit.payments?.captures;
    const authorizations = unit.payments?.authorizations;
    if (!["CREATED", "PAYER_ACTION_REQUIRED", "VOIDED"].includes(order.status ?? "") ||
        (captures !== undefined && (!Array.isArray(captures) || captures.length > 0)) ||
        (authorizations !== undefined && (!Array.isArray(authorizations) || authorizations.length > 0))) {
      throw new ApiError(409, "CHECKOUT_RECONCILIATION_REQUIRED", "PayPal shows an approved, completed or unresolved payment. Check that payment before closing this quote.");
    }
  }));
}
