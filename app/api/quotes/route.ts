import { ApiError, apiErrorResponse, assertSameOrigin, exactBody, jsonResponse, readJsonBody, requireId } from "@/lib/api-errors";
import { requireApiOwner } from "@/lib/server-auth";
import { approveProposal } from "@/lib/server-quotes";
import { assertCurrentProposal, getProposal, saveApprovedQuote, withWorkspaceLock } from "@/lib/common-store";
import { quoteStatus } from "@/lib/server-quote-status";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const ownerId = await requireApiOwner(request);
    assertSameOrigin(request);
    const body = exactBody(await readJsonBody(request), ["proposalId", "fingerprint", "scenario", "approvedBuyerIds"]);
    const proposalId = requireId(body.proposalId, "proposal ID");
    if (typeof body.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(body.fingerprint)) throw new ApiError(400, "INVALID_FINGERPRINT", "Use the current server proposal fingerprint.");
    const fingerprint = body.fingerprint;
    const saved = await withWorkspaceLock(ownerId, async () => {
      const proposal = await getProposal(ownerId, proposalId);
      if (!proposal) throw new ApiError(404, "PROPOSAL_NOT_FOUND", "This proposal does not belong to your workspace.");
      await assertCurrentProposal(ownerId, proposalId);
      return saveApprovedQuote(await approveProposal(proposal, { ownerId, fingerprint, scenario: body.scenario, approvedBuyerIds: body.approvedBuyerIds }));
    });
    return jsonResponse(await quoteStatus(saved));
  } catch (error) { return apiErrorResponse(error); }
}
