/**
 * Retries for long-running Graph work (scans): throttling, server hiccups and lost connections are waited out
 * instead of failing a scan that may have been running for an hour.
 */

/** Wait before the 1st, 2nd, … retry in seconds – about three minutes in total. */
const BACKOFF = [2, 5, 10, 20, 40, 60, 60];
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
/** a longer Retry-After is capped – Graph asks for seconds to a few minutes */
const MAX_RETRY_AFTER = 600;

export interface RetryWait {
  reason: string;
  /** timestamp (ms) when the next attempt starts */
  until: number;
  attempt: number;
}

export const abortError = () => new DOMException("Scan abgebrochen", "AbortError");

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

export const isAbortError = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** Waits, but stops right away when the signal aborts. */
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** HTTP status of a Graph SDK error (statusCode) or a fetch-like error (status); -1 / missing = no response. */
export function httpStatus(error: unknown): number | undefined {
  const e = (error ?? {}) as { statusCode?: unknown; status?: unknown };
  const status = typeof e.statusCode === "number" ? e.statusCode : e.status;
  return typeof status === "number" && status > 0 ? status : undefined;
}

/** No response at all: connection lost, DNS, request timeout, sleep/wake of the computer. */
function isNetworkError(error: unknown): boolean {
  const e = (error ?? {}) as { code?: unknown; name?: unknown; message?: unknown };
  if ([e.code, e.name].some((v) => v === "TypeError" || v === "TimeoutError" || v === "AbortError" || v === "NetworkError")) return true;
  return /failed to fetch|network|timed? ?out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket|nicht erreichbar/i.test(String(e.message ?? ""));
}

function retryAfterSeconds(error: unknown): number | undefined {
  const headers = (error as { headers?: unknown } | null)?.headers as { get?: (name: string) => string | null } | Record<string, string> | undefined;
  const raw = typeof headers?.get === "function" ? headers.get("Retry-After") : (headers as Record<string, string> | undefined)?.["Retry-After"];
  if (!raw) return undefined;
  const seconds = Number(raw);
  const value = Number.isFinite(seconds) ? seconds : (Date.parse(raw) - Date.now()) / 1000;
  return Number.isFinite(value) && value > 0 ? Math.min(Math.ceil(value), MAX_RETRY_AFTER) : undefined;
}

/** Seconds to wait before attempt `attempt + 1`, or undefined when retrying cannot help (or attempts are used up). */
export function retryDelay(error: unknown, attempt: number): number | undefined {
  const status = httpStatus(error);
  const transient = status !== undefined ? TRANSIENT_STATUS.has(status) : isNetworkError(error);
  if (!transient || attempt > BACKOFF.length) return undefined;
  return Math.max(BACKOFF[attempt - 1], retryAfterSeconds(error) ?? 0);
}

function describe(error: unknown): string {
  const status = httpStatus(error);
  if (status === 429) return "Microsoft drosselt die Anfragen.";
  if (status !== undefined) return `Microsoft 365 antwortet gerade nicht (HTTP ${status}).`;
  return "Keine Verbindung zu Microsoft 365.";
}

/**
 * Runs `fn` and retries temporary failures with growing pauses (and at least as long as Retry-After asks).
 * `onWait` announces each pause and is called with undefined once an attempt succeeds again.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { signal, onWait }: { signal?: AbortSignal; onWait?: (wait: RetryWait | undefined) => void } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    throwIfAborted(signal);
    try {
      const result = await fn();
      if (attempt > 1) onWait?.(undefined);
      return result;
    } catch (error) {
      throwIfAborted(signal);
      const seconds = retryDelay(error, attempt);
      if (seconds === undefined) throw error;
      onWait?.({ reason: describe(error), until: Date.now() + seconds * 1000, attempt });
      await wait(seconds * 1000, signal);
    }
  }
}
