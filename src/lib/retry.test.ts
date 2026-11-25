import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { graphError } from "../../tests/graph-fakes";
import { retryDelay, withRetry, type RetryWait } from "./retry";

/** like the Graph SDK: a failed fetch becomes a GraphError with statusCode -1 and the original error name as code */
const networkError = () => Object.assign(new Error("Failed to fetch"), { statusCode: -1, code: "TypeError" });

describe("retryDelay", () => {
  it("retries throttling, server hiccups and lost connections with growing pauses", () => {
    expect(retryDelay(graphError(503), 1)).toBe(2);
    expect(retryDelay(graphError(504), 3)).toBe(10);
    expect(retryDelay(networkError(), 2)).toBe(5);
    expect(retryDelay(Object.assign(new Error("signal timed out"), { statusCode: -1, code: "TimeoutError" }), 1)).toBe(2);
  });

  it("waits at least as long as Retry-After asks", () => {
    const throttled = Object.assign(graphError(429), { headers: new Headers({ "Retry-After": "45" }) });
    expect(retryDelay(throttled, 1)).toBe(45);
    const excessive = Object.assign(graphError(429), { headers: new Headers({ "Retry-After": "99999" }) });
    expect(retryDelay(excessive, 1)).toBe(600);
  });

  it("does not retry what waiting cannot fix", () => {
    expect(retryDelay(graphError(401), 1)).toBeUndefined();
    expect(retryDelay(graphError(404), 1)).toBeUndefined();
    expect(retryDelay(graphError(410), 1)).toBeUndefined();
    // sign-in needed: MSAL errors arrive with statusCode -1, too
    expect(retryDelay(Object.assign(new Error("interaction_required"), { statusCode: -1, code: "InteractionRequiredAuthError" }), 1)).toBeUndefined();
  });

  it("gives up after seven retries", () => {
    expect(retryDelay(graphError(503), 7)).toBe(60);
    expect(retryDelay(graphError(503), 8)).toBeUndefined();
  });
});

describe("withRetry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits out temporary failures and reports the pauses", async () => {
    const fn = vi.fn().mockRejectedValueOnce(graphError(503)).mockRejectedValueOnce(networkError()).mockResolvedValue("ok");
    const waits: (RetryWait | undefined)[] = [];
    const result = withRetry(fn, { onWait: (w) => waits.push(w) });

    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toBe("ok");
    expect(waits.map((w) => w?.reason)).toEqual([
      "Microsoft 365 antwortet gerade nicht (HTTP 503).",
      "Keine Verbindung zu Microsoft 365.",
      undefined,
    ]);
  });

  it("passes permanent errors on immediately", async () => {
    const fn = vi.fn().mockRejectedValue(graphError(403, "Forbidden"));
    await expect(withRetry(fn)).rejects.toThrow("Forbidden");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops waiting when cancelled", async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue(graphError(429));
    const result = expect(withRetry(fn, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    await result;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
