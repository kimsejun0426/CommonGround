import { apiErrorResponse, jsonResponse } from "@/lib/api-errors";
import { requireApiOwner } from "@/lib/server-auth";
import { getActiveCheckout, withWorkspaceLock } from "@/lib/common-store";
import { quoteStatus } from "@/lib/server-quote-status";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const ownerId = await requireApiOwner(request);
    const checkout = await withWorkspaceLock(ownerId, async () => {
      const quote = await getActiveCheckout(ownerId);
      return quote ? quoteStatus(quote) : null;
    });
    return jsonResponse({ checkout });
  } catch (error) { return apiErrorResponse(error); }
}
