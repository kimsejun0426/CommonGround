import { ApiError, apiErrorResponse, assertSameOrigin, exactBody, jsonResponse, readJsonBody, requireId } from "@/lib/api-errors";
import { requireApiOwner } from "@/lib/server-auth";
import { getServerConfig } from "@/lib/server-config";
import { getApprovedQuote, isCurrentProposal, withWorkspaceLock } from "@/lib/common-store";
import { verifyApprovedQuote } from "@/lib/server-quotes";
import { quoteStatus } from "@/lib/server-quote-status";
import { PayPalClient } from "@/lib/paypal";
import { PaymentService } from "@/lib/paypal-service";
import { getPaymentStore } from "@/lib/payment-store";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  try {
    const ownerId = await requireApiOwner(request);
    assertSameOrigin(request);
    const body = exactBody(await readJsonBody(request, 2000), ["quoteId"]);
    const quoteId = requireId(body.quoteId, "quote ID");
    const orderId = requireId((await context.params).orderId, "PayPal order ID");
    const config = getServerConfig();
    if (!config.paypalReady) throw new ApiError(503, "PAYPAL_NOT_CONFIGURED", "Connect PayPal sandbox credentials before verifying a real sandbox payment.");
    const result = await withWorkspaceLock(ownerId, async () => {
      const quote = await getApprovedQuote(ownerId, quoteId);
      // Old completed transfers can be reconciled, but edited/expired quotes can never initiate a new capture.
      await verifyApprovedQuote(quote, ownerId, Date.now(), true);
      const allowNewCapture = quote.expiresAt > Date.now() && await isCurrentProposal(ownerId, quote.proposalId);
      const service = new PaymentService(getPaymentStore(), new PayPalClient(config.paypalClientId, config.paypalClientSecret));
      const payment = await service.capture(ownerId, orderId, { quoteId, allowNewCapture });
      return { payment, cohort: await quoteStatus(quote) };
    });
    return jsonResponse(result);
  } catch (error) { return apiErrorResponse(error); }
}
