/** Public, sanitized failures. Never place provider payloads or secrets in these messages. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  constructor(status: number, code: string, message: string, retryable = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function apiErrorResponse(error: unknown): Response {
  const known = error instanceof ApiError;
  return Response.json({
    error: known ? error.message : "The request could not be completed. Please try again.",
    code: known ? error.code : "INTERNAL_ERROR",
    retryable: known ? error.retryable : true,
    verified: false,
    readyToProceed: false,
  }, { status: known ? error.status : 500, headers: { "Cache-Control": "no-store" } });
}

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "Open CommonGround on its own site to continue.");
  }
}

export async function readJsonBody(request: Request, maxBytes = 60_000): Promise<unknown> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    throw new ApiError(415, "JSON_REQUIRED", "Send an application/json request.");
  }
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) {
    throw new ApiError(413, "REQUEST_TOO_LARGE", "The request is too large.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "INVALID_JSON", "A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "REQUEST_TOO_LARGE", "The request is too large.");
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ApiError(400, "INVALID_JSON", "The request must contain valid JSON."); }
}

export function exactBody(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "INVALID_REQUEST", "A JSON object is required.");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !keys.includes(key)) || keys.some((key) => !Object.prototype.hasOwnProperty.call(body, key))) {
    throw new ApiError(400, "UNEXPECTED_FIELD", "The request contains missing or unsupported fields. Prices and supplier facts are owned by the server.");
  }
  return body;
}

export function requireId(value: unknown, kind: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new ApiError(400, "INVALID_ID", `A valid ${kind} is required.`);
  return value;
}
