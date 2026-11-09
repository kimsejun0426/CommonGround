import { ApiError } from "./api-errors.ts";

/** This application deliberately has no production/live PayPal endpoint. */
export const PAYPAL_SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

export type PayPalAmount = { currency_code?: string; value?: string };
export type PayPalCapture = {
  id?: string;
  status?: string;
  amount?: PayPalAmount;
  final_capture?: boolean;
};
export type PayPalOrder = {
  id?: string;
  status?: string;
  intent?: string;
  links?: Array<{ rel?: string; href?: string }>;
  purchase_units?: Array<{
    reference_id?: string;
    custom_id?: string;
    invoice_id?: string;
    amount?: PayPalAmount;
    payments?: { captures?: PayPalCapture[]; authorizations?: Array<{ id?: string; status?: string }> };
  }>;
};

export type PayableQuote = {
  quoteId: string;
  buyerId: string;
  projectName: string;
  currency: "USD";
  totalCents: number;
  items: Array<{
    id: string; title: string; quantity: number; unitPriceCents: number; totalCents: number;
  }>;
};

export type VerifiedPayment = {
  orderId: string;
  captureId: string;
  status: "COMPLETED";
  verified: true;
  paymentCompleted: true;
  amount: { currencyCode: "USD"; value: string };
  mode: "sandbox";
};

export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new ApiError(422, "INVALID_AMOUNT", "The quote has an invalid amount.");
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function decimalToCents(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function isPayPalOrderId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{8,64}$/.test(value);
}

export function validatePayableQuote(quote: PayableQuote): void {
  if (
    quote.currency !== "USD" || !Number.isSafeInteger(quote.totalCents) ||
    quote.totalCents <= 0 || quote.totalCents > 1_000_000 ||
    !Array.isArray(quote.items) || quote.items.length === 0 || quote.items.length > 20
  ) {
    throw new ApiError(422, "INVALID_QUOTE", "Select valid approved items before creating a payment.");
  }
  const seen = new Set<string>();
  let total = 0;
  for (const item of quote.items) {
    if (
      seen.has(item.id) || !item.id || !item.title ||
      !Number.isSafeInteger(item.quantity) || item.quantity < 1 ||
      !Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents <= 0 ||
      !Number.isSafeInteger(item.totalCents) || item.totalCents !== item.quantity * item.unitPriceCents
    ) {
      throw new ApiError(422, "INVALID_QUOTE", "The approved quote contains an invalid line item.");
    }
    seen.add(item.id);
    total += item.totalCents;
  }
  if (total !== quote.totalCents) {
    throw new ApiError(422, "INVALID_QUOTE", "The approved quote does not match its line items.");
  }
}

/** Verify provider state and binding before any UI can call the change paid. */
export function verifyCompletedOrder(
  order: PayPalOrder,
  expected: { orderId: string; attemptId: string; totalCents: number },
): VerifiedPayment {
  if (order.id !== expected.orderId || order.status !== "COMPLETED") {
    throw new ApiError(409, "PAYMENT_NOT_COMPLETED", "PayPal has not confirmed a completed payment yet.", true);
  }
  if (order.intent !== "CAPTURE") {
    throw new ApiError(502, "PAYMENT_VERIFICATION_FAILED", "The order does not match the expected PayPal payment flow.");
  }
  const units = order.purchase_units;
  if (!Array.isArray(units) || units.length !== 1) {
    throw new ApiError(502, "PAYMENT_VERIFICATION_FAILED", "The PayPal order could not be matched to this quote.");
  }
  const unit = units[0];
  if (
    unit.reference_id !== expected.attemptId || unit.custom_id !== expected.attemptId ||
    unit.amount?.currency_code !== "USD" ||
    decimalToCents(unit.amount?.value) !== expected.totalCents
  ) {
    throw new ApiError(502, "PAYMENT_VERIFICATION_FAILED", "The PayPal order does not match the approved quote.");
  }
  const captures = unit.payments?.captures;
  if (!Array.isArray(captures) || captures.length !== 1) {
    throw new ApiError(409, "PAYMENT_NOT_COMPLETED", "PayPal has not confirmed the expected capture yet.", true);
  }
  const capture = captures[0];
  if (capture.status !== "COMPLETED") {
    throw new ApiError(409, "PAYMENT_NOT_COMPLETED", "The payment is pending or unsuccessful. The cohort is not confirmed.", true);
  }
  if (
    !isPayPalOrderId(capture.id) || capture.amount?.currency_code !== "USD" ||
    decimalToCents(capture.amount?.value) !== expected.totalCents
  ) {
    throw new ApiError(502, "PAYMENT_VERIFICATION_FAILED", "The captured amount does not match the approved quote.");
  }
  return {
    orderId: expected.orderId,
    captureId: capture.id,
    status: "COMPLETED",
    verified: true,
    paymentCompleted: true,
    amount: { currencyCode: "USD", value: centsToDecimal(expected.totalCents) },
    mode: "sandbox",
  };
}

export function getApprovalUrl(order: PayPalOrder): string | null {
  const href = order.links?.find((link) => link.rel === "approve" || link.rel === "payer-action")?.href;
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.protocol === "https:" && (url.hostname === "www.sandbox.paypal.com" || url.hostname === "sandbox.paypal.com")) {
      return url.toString();
    }
  } catch { /* A provider link is not trusted without validation. */ }
  return null;
}

export class PayPalApiError extends ApiError {
  readonly providerStatus: number;
  readonly issue: string;

  constructor(providerStatus: number, issue: string) {
    const retryable = providerStatus === 429 || providerStatus >= 500;
    const status = retryable ? 503 : providerStatus === 400 || providerStatus === 422 ? 409 : 502;
    const message = issue === "ORDER_NOT_APPROVED"
      ? "Approve the payment in the PayPal sandbox before capturing it."
      : issue === "INSTRUMENT_DECLINED"
        ? "PayPal declined this funding method. Choose another sandbox payment method."
        : "PayPal could not complete this request. No cohort has been confirmed.";
    super(status, `PAYPAL_${issue}`, message, retryable);
    this.name = "PayPalApiError";
    this.providerStatus = providerStatus;
    this.issue = issue;
  }
}

type ClientOptions = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  returnUrl?: string;
  cancelUrl?: string;
};

export class PayPalClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly returnUrl: string | undefined;
  private readonly cancelUrl: string | undefined;
  private token: { value: string; expiresAt: number } | null = null;
  private tokenPromise: Promise<string> | null = null;

  constructor(clientId: string, clientSecret: string, options: ClientOptions = {}) {
    if (!clientId || !clientSecret) {
      throw new ApiError(503, "PAYPAL_NOT_CONFIGURED", "Connect PayPal sandbox credentials to enable real sandbox checkout.");
    }
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetcher = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.returnUrl = options.returnUrl;
    this.cancelUrl = options.cancelUrl;
  }

  private async fetchWithTimeout(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetcher(`${PAYPAL_SANDBOX_BASE_URL}${path}`, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = (async () => {
      let response: Response;
      try {
        response = await this.fetchWithTimeout("/v1/oauth2/token", {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: "grant_type=client_credentials",
        });
      } catch {
        throw new ApiError(503, "PAYPAL_UNAVAILABLE", "The PayPal sandbox is temporarily unavailable. Try again.", true);
      }
      if (!response.ok) {
        throw new ApiError(503, "PAYPAL_AUTH_FAILED", "The PayPal sandbox connection could not be authenticated. Check the sandbox app configuration.", response.status >= 500);
      }
      const body = await response.json() as { access_token?: unknown; expires_in?: unknown };
      if (typeof body.access_token !== "string" || !body.access_token || typeof body.expires_in !== "number") {
        throw new ApiError(502, "PAYPAL_RESPONSE_INVALID", "PayPal returned an invalid authentication response.");
      }
      this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1_000 };
      return this.token.value;
    })();
    try {
      return await this.tokenPromise;
    } finally {
      this.tokenPromise = null;
    }
  }

  private async request<T>(path: string, method: "GET" | "POST", body?: unknown, requestId?: string): Promise<T> {
    let refreshed = false;
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = await this.getToken();
      let response: Response;
      try {
        response = await this.fetchWithTimeout(path, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(method === "POST" ? { Prefer: "return=representation" } : {}),
            ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
          },
          body: serializedBody,
        });
      } catch {
        if (attempt < 2) { await this.sleep(100 * 2 ** attempt); continue; }
        throw new ApiError(503, "PAYPAL_UNAVAILABLE", "PayPal did not confirm the request. Retry to check the same payment safely.", true);
      }
      if (response.status === 401 && !refreshed) {
        this.token = null;
        refreshed = true;
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const seconds = Number(response.headers.get("retry-after"));
        await this.sleep(Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1_000, 2_000) : 100 * 2 ** attempt);
        continue;
      }
      const payload = await response.json().catch(() => null) as T | null;
      if (!response.ok) {
        const error = payload as { name?: unknown; details?: Array<{ issue?: unknown }> } | null;
        const candidate = error?.details?.[0]?.issue ?? error?.name;
        const issue = typeof candidate === "string" && /^[A-Z0-9_]{1,80}$/.test(candidate) ? candidate : "REQUEST_FAILED";
        throw new PayPalApiError(response.status, issue);
      }
      if (!payload || typeof payload !== "object") {
        throw new ApiError(502, "PAYPAL_RESPONSE_INVALID", "PayPal returned an invalid response. The payment has not been verified.");
      }
      return payload;
    }
    throw new ApiError(503, "PAYPAL_UNAVAILABLE", "The PayPal sandbox request could not be completed.", true);
  }

  async createOrder(quote: PayableQuote, attemptId: string, requestId: string): Promise<PayPalOrder> {
    validatePayableQuote(quote);
    const amount = { currency_code: "USD", value: centsToDecimal(quote.totalCents) };
    const order = await this.request<PayPalOrder>("/v2/checkout/orders", "POST", {
      intent: "CAPTURE",
      ...(this.returnUrl && this.cancelUrl ? { payment_source: { paypal: { experience_context: {
        brand_name: "CommonGround Sandbox",
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING",
        return_url: this.returnUrl,
        cancel_url: this.cancelUrl,
      } } } } : {}),
      purchase_units: [{
        reference_id: attemptId,
        custom_id: attemptId,
        invoice_id: `CG-${attemptId}`,
        description: `CommonGround: ${quote.projectName}`.slice(0, 127),
        amount: { ...amount, breakdown: { item_total: amount } },
        items: quote.items.map((item) => ({
          name: item.title.slice(0, 127),
          sku: item.id,
          quantity: String(item.quantity),
          unit_amount: { currency_code: "USD", value: centsToDecimal(item.unitPriceCents) },
          category: "PHYSICAL_GOODS",
        })),
      }],
    }, requestId);
    if (!isPayPalOrderId(order.id)) {
      throw new ApiError(502, "PAYPAL_RESPONSE_INVALID", "PayPal did not return a valid order ID.");
    }
    return order;
  }

  getOrder(orderId: string): Promise<PayPalOrder> {
    if (!isPayPalOrderId(orderId)) throw new ApiError(400, "INVALID_ORDER_ID", "The PayPal order ID is invalid.");
    return this.request<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, "GET");
  }

  captureOrder(orderId: string, requestId: string): Promise<PayPalOrder> {
    if (!isPayPalOrderId(orderId)) throw new ApiError(400, "INVALID_ORDER_ID", "The PayPal order ID is invalid.");
    return this.request<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, "POST", {}, requestId);
  }
}
