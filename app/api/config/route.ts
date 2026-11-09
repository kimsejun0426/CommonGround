import { apiErrorResponse, jsonResponse } from "@/lib/api-errors";
import { getPublicConfig } from "@/lib/server-config";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return jsonResponse(getPublicConfig()); }
  catch (error) { return apiErrorResponse(error); }
}
