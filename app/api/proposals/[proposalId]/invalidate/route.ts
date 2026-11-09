import { apiErrorResponse, assertSameOrigin, exactBody, jsonResponse, readJsonBody, requireId } from "@/lib/api-errors";
import { requireApiOwner } from "@/lib/server-auth";
import { invalidateProposal, withWorkspaceLock } from "@/lib/common-store";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  try {
    const ownerId = await requireApiOwner(request);
    assertSameOrigin(request);
    exactBody(await readJsonBody(request, 1000), []);
    const proposalId = requireId((await context.params).proposalId, "proposal ID");
    await withWorkspaceLock(ownerId, () => invalidateProposal(ownerId, proposalId));
    return jsonResponse({ invalidated: true, readyToProceed: false });
  } catch (error) { return apiErrorResponse(error); }
}
