import { ApiError, apiErrorResponse, assertSameOrigin, exactBody, jsonResponse, readJsonBody } from "@/lib/api-errors";
import { requireApiOwner } from "@/lib/server-auth";
import { getServerConfig } from "@/lib/server-config";
import { getDb } from "@/db";
import { budgetedAIFetch } from "@/lib/ai-budget";
import { evaluatedProposal, fingerprintScenario, QUOTE_LIFETIME_MS, type StoredProposal } from "@/lib/server-quotes";
import { selectWithOpenAI } from "@/lib/ai-proposal";
import { saveProposal, withWorkspaceLock } from "@/lib/common-store";
import { resolveOptionalGuidance } from "@/lib/workspace-protection";
import { buildNegotiationOptions } from "@/lib/negotiation";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const ownerId = await requireApiOwner(request);
    assertSameOrigin(request);
    const input = await readJsonBody(request);
    const hasGuidance = !!input && typeof input === "object" && Object.hasOwn(input, "guidance");
    const body = exactBody(input, hasGuidance ? ["scenario", "guidance"] : ["scenario"]);
    if (hasGuidance && typeof body.guidance !== "boolean") throw new ApiError(400, "INVALID_GUIDANCE", "Guidance must be true or false.");
    const { scenario, proposal } = evaluatedProposal(body.scenario);
    const config = getServerConfig();
    const guidance = await resolveOptionalGuidance(body.guidance !== false, config.aiReady, () =>
      selectWithOpenAI(scenario, proposal, config, budgetedAIFetch(ownerId, () => getDb().$client)));
    const aiSelection = guidance.selection;
    const now = Date.now();
    const record: StoredProposal = {
      id: `proposal_${crypto.randomUUID()}`, ownerId,
      fingerprint: await fingerprintScenario(scenario),
      scenarioJson: JSON.stringify(scenario), proposalJson: JSON.stringify(proposal),
      mode: aiSelection ? "live_ai" : "rules_demo",
      aiSelectionJson: aiSelection ? JSON.stringify(aiSelection) : null,
      createdAt: now, expiresAt: now + QUOTE_LIFETIME_MS,
    };
    await withWorkspaceLock(ownerId, () => saveProposal(record));
    return jsonResponse({ proposalId: record.id, fingerprint: record.fingerprint, mode: record.mode,
      proposal, aiSelection, negotiationOptions: buildNegotiationOptions(scenario), guidanceStatus: guidance.guidanceStatus,
      ...(guidance.guidanceError ? { guidanceError: guidance.guidanceError } : {}),
      expiresAt: record.expiresAt, supplierVerified: false,
      workspaceMode: "single-owner-persona-simulation" });
  } catch (error) { return apiErrorResponse(error); }
}
