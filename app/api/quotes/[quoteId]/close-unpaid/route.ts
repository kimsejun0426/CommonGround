import { ApiError, apiErrorResponse, assertSameOrigin, exactBody, jsonResponse, readJsonBody, requireId } from "@/lib/api-errors";
import { requireApiOwner } from "@/lib/server-auth";
import { closeUnpaidQuote, withWorkspaceLock } from "@/lib/common-store";
import { getServerConfig } from "@/lib/server-config";
import { PayPalClient } from "@/lib/paypal";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ quoteId: string }> }) {
  try {
    const ownerId = await requireApiOwner(request);
    assertSameOrigin(request);
    exactBody(await readJsonBody(request, 1000), []);
    const quoteId = requireId((await context.params).quoteId, "quote ID");
    const config = getServerConfig();
    if (!config.paypalReady) throw new ApiError(503, "PAYPAL_NOT_CONFIGURED", "Connect PayPal Sandbox before checking and closing an unpaid quote.");
    await withWorkspaceLock(ownerId, () => closeUnpaidQuote(ownerId, quoteId, new PayPalClient(config.paypalClientId, config.paypalClientSecret)));
    return jsonResponse({ quoteId, closed: true, readyToProceed: false, refunded: false });
  } catch (error) { return apiErrorResponse(error); }
}
