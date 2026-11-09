import { apiErrorResponse, assertSameOrigin, jsonResponse, readJsonBody } from "@/lib/api-errors";
import { interpretWithOpenAI, parseIntentRequest } from "@/lib/intent";
import { requireApiOwner } from "@/lib/server-auth";
import { getServerConfig } from "@/lib/server-config";
import { getDb } from "@/db";
import { budgetedAIFetch } from "@/lib/ai-budget";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const ownerId = await requireApiOwner(request);
    assertSameOrigin(request);
    const input = parseIntentRequest(await readJsonBody(request, 24_000));
    const interpretation = await interpretWithOpenAI(input, getServerConfig(), budgetedAIFetch(ownerId, () => getDb().$client));
    return jsonResponse({ mode: "live_ai", interpretation });
  } catch (error) { return apiErrorResponse(error); }
}
