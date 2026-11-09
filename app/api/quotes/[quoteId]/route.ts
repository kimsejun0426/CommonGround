import { apiErrorResponse, jsonResponse, requireId } from "@/lib/api-errors";
import { requireApiOwner } from "@/lib/server-auth";
import { getApprovedQuote } from "@/lib/common-store";
import { quoteStatus } from "@/lib/server-quote-status";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ quoteId: string }> }) {
  try {
    const ownerId = await requireApiOwner(request);
    const quoteId = requireId((await context.params).quoteId, "quote ID");
    return jsonResponse(await quoteStatus(await getApprovedQuote(ownerId, quoteId)));
  } catch (error) { return apiErrorResponse(error); }
}
