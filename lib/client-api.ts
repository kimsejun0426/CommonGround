/** Browser-side JSON requests. The deadline includes reading the response body. */
export class ClientApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; code?: string; retryable?: boolean } = {}) {
    super(message);
    this.name = "ClientApiError";
    this.status = options.status ?? 0;
    this.code = options.code ?? "REQUEST_FAILED";
    this.retryable = options.retryable ?? false;
  }
}

export interface ClientApiOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function clientApi<T>(path: string, body?: unknown, options: ClientApiOptions = {}): Promise<T> {
  if (!path.startsWith("/api/") || path.startsWith("//")) {
    throw new ClientApiError("Use the CommonGround API on this site.", { code: "INVALID_API_PATH" });
  }
  const controller = new AbortController();
  let timedOut = false;
  const requestedTimeout = options.timeoutMs ?? 25_000;
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : 25_000;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();

  try {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data: unknown;
    try { data = await response.json(); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      throw new ClientApiError("The server returned an unreadable response. Please try again.", {
        status: response.status, code: "INVALID_RESPONSE", retryable: true,
      });
    }
    if (!response.ok) {
      const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
      const error = record.error;
      const message = typeof error === "string" ? error
        : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message
        : typeof record.message === "string" ? record.message : "This request could not be completed.";
      throw new ClientApiError(message, {
        status: response.status,
        code: typeof record.code === "string" ? record.code : "REQUEST_FAILED",
        retryable: record.retryable === true,
      });
    }
    return data as T;
  } catch (error) {
    if (timedOut) throw new ClientApiError(
      "The server took too long to respond. Payment status may still be updating; check the same saved checkout before starting another.",
      { code: "REQUEST_TIMEOUT", retryable: true },
    );
    if (controller.signal.aborted) throw new ClientApiError("The request was interrupted.", { code: "REQUEST_ABORTED", retryable: true });
    if (error instanceof ClientApiError) throw error;
    throw new ClientApiError("The server could not be reached. Please try again.", { code: "NETWORK_ERROR", retryable: true });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

/** Short alias for UI callers migrating from the original workspace. */
export const api = clientApi;
