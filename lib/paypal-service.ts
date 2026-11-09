import { ApiError } from "./api-errors.ts";
import {
  centsToDecimal,
  decimalToCents,
  getApprovalUrl,
  isPayPalOrderId,
  validatePayableQuote,
  verifyCompletedOrder,
  type PayableQuote,
  type PayPalOrder,
  type VerifiedPayment,
} from "./paypal.ts";

export interface PaymentAttempt {
  id: string;
  ownerId: string;
  quoteId: string;
  quoteHash: string;
  quoteJson: string;
  expectedAmountCents: number;
  currency: string;
  buyerId: string;
  createRequestId: string;
  captureRequestId: string;
  paypalOrderId: string | null;
  captureId: string | null;
  approvalUrl: string | null;
  status: string;
  verifiedAt: number | null;
  lockUntil: number;
  lastErrorCode: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PaymentStore {
  insertIfAbsent(attempt: PaymentAttempt): Promise<void>;
  findByQuoteBuyer(ownerId: string, quoteId: string, buyerId: string): Promise<PaymentAttempt | null>;
  listForQuote(ownerId: string, quoteId: string): Promise<PaymentAttempt[]>;
  findByOrder(ownerId: string, orderId: string): Promise<PaymentAttempt | null>;
  claim(id: string, ownerId: string, now: number, lockUntil: number): Promise<boolean>;
  update(id: string, ownerId: string, patch: Partial<PaymentAttempt>): Promise<void>;
}

export interface PaymentProvider {
  createOrder(quote: PayableQuote, attemptId: string, requestId: string): Promise<PayPalOrder>;
  getOrder(orderId: string): Promise<PayPalOrder>;
  captureOrder(orderId: string, requestId: string): Promise<PayPalOrder>;
}

export interface CreatedPayment {
  orderId: string;
  approvalUrl: string | null;
  status: string;
  amount: { currencyCode: "USD"; value: string };
  quote: PayableQuote;
  mode: "sandbox";
  verified: boolean;
  paymentCompleted: boolean;
  captureId?: string;
}

export async function hashQuote(quote: PayableQuote): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(quote));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export class PaymentService {
  private readonly store: PaymentStore;
  private readonly provider: PaymentProvider;

  constructor(store: PaymentStore, provider: PaymentProvider) {
    this.store = store;
    this.provider = provider;
  }

  private createdResponse(attempt: PaymentAttempt): CreatedPayment {
    if (!attempt.paypalOrderId) throw new ApiError(503, "PAYMENT_IN_PROGRESS", "The order is still being created. Retry safely in a moment.", true);
    return {
      orderId: attempt.paypalOrderId,
      approvalUrl: attempt.approvalUrl,
      status: attempt.status,
      amount: { currencyCode: "USD", value: centsToDecimal(attempt.expectedAmountCents) },
      quote: JSON.parse(attempt.quoteJson) as PayableQuote,
      mode: "sandbox",
      verified: false,
      paymentCompleted: false,
    };
  }

  async create(ownerId: string, quote: PayableQuote): Promise<CreatedPayment> {
    validatePayableQuote(quote);
    const now = Date.now();
    const quoteHash = await hashQuote(quote);
    const initial: PaymentAttempt = {
      id: crypto.randomUUID(),
      ownerId,
      quoteId: quote.quoteId,
      quoteHash,
      quoteJson: JSON.stringify(quote),
      expectedAmountCents: quote.totalCents,
      currency: "USD",
      buyerId: quote.buyerId,
      createRequestId: crypto.randomUUID(),
      captureRequestId: crypto.randomUUID(),
      paypalOrderId: null,
      captureId: null,
      approvalUrl: null,
      status: "CREATING",
      verifiedAt: null,
      lockUntil: 0,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.insertIfAbsent(initial);
    const attempt = await this.store.findByQuoteBuyer(ownerId, quote.quoteId, quote.buyerId);
    if (!attempt) throw new ApiError(503, "STORAGE_UNAVAILABLE", "The approved quote could not be saved. Please try again.", true);
    if (attempt.quoteHash !== quoteHash) {
      throw new ApiError(409, "QUOTE_LOCKED", "This buyer already has an immutable approved checkout for this quote.");
    }
    if (attempt.paypalOrderId) {
      const response = this.createdResponse(attempt);
      if (attempt.status === "COMPLETED" && attempt.verifiedAt) {
        return { ...response, ...await this.capture(ownerId, attempt.paypalOrderId) };
      }
      return response;
    }
    // A response lost beyond the provider's idempotency window needs manual
    // reconciliation; do not blindly create a second order with a new key.
    if (now - attempt.createdAt > 5 * 60 * 60 * 1_000) {
      throw new ApiError(409, "PAYMENT_RECONCILIATION_REQUIRED", "An earlier order request needs reconciliation before this quote can be retried.");
    }
    if (!await this.store.claim(attempt.id, ownerId, now, now + 120_000)) {
      throw new ApiError(409, "PAYMENT_IN_PROGRESS", "This checkout is already being processed. Retry in a moment.", true);
    }
    try {
      const order = await this.provider.createOrder(quote, attempt.id, attempt.createRequestId);
      if (!isPayPalOrderId(order.id)) throw new ApiError(502, "PAYPAL_RESPONSE_INVALID", "PayPal did not return a valid order ID.");
      const updated = {
        ...attempt,
        paypalOrderId: order.id,
        approvalUrl: getApprovalUrl(order),
        status: order.status ?? "CREATED",
        updatedAt: Date.now(),
        lastErrorCode: null,
      };
      await this.store.update(attempt.id, ownerId, {
        paypalOrderId: updated.paypalOrderId,
        approvalUrl: updated.approvalUrl,
        status: updated.status,
        updatedAt: updated.updatedAt,
        lastErrorCode: null,
      });
      return this.createdResponse(updated);
    } catch (error) {
      await this.store.update(attempt.id, ownerId, { lastErrorCode: error instanceof ApiError ? error.code : "REQUEST_FAILED", updatedAt: Date.now() });
      throw error;
    } finally {
      await this.store.update(attempt.id, ownerId, { lockUntil: 0 });
    }
  }

  private async recordVerified(attempt: PaymentAttempt, order: PayPalOrder): Promise<VerifiedPayment> {
    const verified = verifyCompletedOrder(order, {
      orderId: attempt.paypalOrderId!,
      attemptId: attempt.id,
      totalCents: attempt.expectedAmountCents,
    });
    await this.store.update(attempt.id, attempt.ownerId, {
      status: "COMPLETED",
      captureId: verified.captureId,
      verifiedAt: Date.now(),
      updatedAt: Date.now(),
      lastErrorCode: null,
    });
    return verified;
  }

  async capture(ownerId: string, orderId: string, options: { quoteId?: string; allowNewCapture?: boolean } = {}): Promise<VerifiedPayment> {
    if (!isPayPalOrderId(orderId)) throw new ApiError(400, "INVALID_ORDER_ID", "The PayPal order ID is invalid.");
    const attempt = await this.store.findByOrder(ownerId, orderId);
    if (!attempt) throw new ApiError(404, "ORDER_NOT_FOUND", "This order does not belong to your CommonGround session.");
    if (options.quoteId && attempt.quoteId !== options.quoteId) throw new ApiError(409, "ORDER_QUOTE_MISMATCH", "This PayPal order belongs to a different approved quote.");
    const now = Date.now();
    if (!await this.store.claim(attempt.id, ownerId, now, now + 120_000)) {
      throw new ApiError(409, "PAYMENT_IN_PROGRESS", "This payment is already being checked. Retry in a moment.", true);
    }
    try {
      const current = await this.provider.getOrder(orderId);
      if (current.id !== orderId) throw new ApiError(502, "PAYMENT_VERIFICATION_FAILED", "PayPal returned a different order.");
      if (current.status === "COMPLETED") return await this.recordVerified(attempt, current);
      if (options.allowNewCapture === false) throw new ApiError(409, "STALE_QUOTE", "This quote was edited or expired. No new payment can be captured; already completed payments remain in its history.");
      if (current.status !== "APPROVED") {
        throw new ApiError(409, "ORDER_NOT_APPROVED", "Approve the payment in PayPal first. The cohort is not confirmed.");
      }
      // Validate the binding before initiating any transfer, not only afterward.
      const unit = current.purchase_units?.[0];
      if (current.intent !== "CAPTURE" || current.purchase_units?.length !== 1 || unit?.custom_id !== attempt.id || unit.reference_id !== attempt.id) {
        throw new ApiError(502, "PAYMENT_VERIFICATION_FAILED", "The PayPal order cannot be matched to the approved buyer quote.");
      }
      const amount = unit.amount;
      if (amount?.currency_code !== "USD" || decimalToCents(amount.value) !== attempt.expectedAmountCents) {
        throw new ApiError(502, "PAYMENT_VERIFICATION_FAILED", "The approved PayPal amount does not match this quote.");
      }
      if (unit.payments?.captures?.length) {
        throw new ApiError(409, "PAYMENT_NOT_COMPLETED", "An existing capture is still pending. Retry to check its status.", true);
      }
      try {
        await this.provider.captureOrder(orderId, attempt.captureRequestId);
      } catch (captureError) {
        // A network timeout can occur after the transfer was accepted. Recover
        // from authoritative GET state instead of creating a second payment.
        let reconciled: PayPalOrder | null = null;
        try { reconciled = await this.provider.getOrder(orderId); } catch { /* Preserve the original error. */ }
        if (reconciled?.status === "COMPLETED") return await this.recordVerified(attempt, reconciled);
        throw captureError;
      }
      const confirmed = await this.provider.getOrder(orderId);
      return await this.recordVerified(attempt, confirmed);
    } catch (error) {
      await this.store.update(attempt.id, ownerId, { lastErrorCode: error instanceof ApiError ? error.code : "REQUEST_FAILED", updatedAt: Date.now() });
      throw error;
    } finally {
      await this.store.update(attempt.id, ownerId, { lockUntil: 0 });
    }
  }
}
