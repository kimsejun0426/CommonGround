import { ApiError, apiErrorResponse, assertSameOrigin, exactBody, jsonResponse, readJsonBody, requireId } from "@/lib/api-errors";
import { requireApiOwner } from "@/lib/server-auth";
import { getServerConfig } from "@/lib/server-config";
import { assertCurrentProposal, getApprovedQuote, withWorkspaceLock } from "@/lib/common-store";
import { payableBuyerQuote, verifyApprovedQuote } from "@/lib/server-quotes";
import { PayPalClient } from "@/lib/paypal";
import { PaymentService } from "@/lib/paypal-service";
import { getPaymentStore } from "@/lib/payment-store";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const ownerId = await requireApiOwner(request);
    assertSameOrigin(request);
    const body = exactBody(await readJsonBody(request, 2000), ["quoteId", "buyerId"]);
    const quoteId = requireId(body.quoteId, "quote ID");
    const buyerId = requireId(body.buyerId, "buyer ID");
    const config = getServerConfig();
    if (!config.paypalReady) throw new ApiError(503, "PAYPAL_NOT_CONFIGURED", "PayPal sandbox credentials are not configured. The labeled local simulation is separate from real sandbox payments.");
    const result = await withWorkspaceLock(ownerId, async () => {
      const quote = await getApprovedQuote(ownerId, quoteId);
      await assertCurrentProposal(ownerId, quote.proposalId);
      const evaluation = await verifyApprovedQuote(quote, ownerId);
      const returnUrl = new URL(`/?paypal=return&quoteId=${encodeURIComponent(quote.id)}`, request.url).toString();
      const cancelUrl = new URL(`/?paypal=cancel&quoteId=${encodeURIComponent(quote.id)}`, request.url).toString();
      const provider = new PayPalClient(config.paypalClientId, config.paypalClientSecret, { returnUrl, cancelUrl });
      return new PaymentService(getPaymentStore(), provider).create(ownerId, payableBuyerQuote(quote, evaluation, buyerId));
    });
    return jsonResponse({ ...result, quoteId, buyerId, readyToProceed: false, atomicSettlement: false });
  } catch (error) { return apiErrorResponse(error); }
}
