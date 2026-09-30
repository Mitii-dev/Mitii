import { describe, expect, it } from "vitest";

import {
  RequestLimiterAbortError,
  RequestLimiterTimeoutError,
  createRequestLimiter,
} from "../internal/createRequestLimiter";

describe("createRequestLimiter", () => {
  it("limits concurrency and times out slow work", async () => {
    const limit = createRequestLimiter({ limit: 1, timeoutMs: 30 });
    let started = 0;
    const slow = limit(async () => {
      started += 1;
      await new Promise((resolve) => setTimeout(resolve, 80));
      return "slow";
    });
    const fast = limit(async () => {
      started += 1;
      return "fast";
    });

    await expect(slow).rejects.toBeInstanceOf(RequestLimiterTimeoutError);
    await expect(fast).resolves.toBe("fast");
    expect(started).toBeGreaterThanOrEqual(1);
  });

  it("rejects immediately when the abort signal is already aborted", async () => {
    const limit = createRequestLimiter({ limit: 2, timeoutMs: 1000 });
    const controller = new AbortController();
    controller.abort();
    await expect(
      limit(async () => "never", controller.signal),
    ).rejects.toBeInstanceOf(RequestLimiterAbortError);
  });

  it("cancels queued work when abort fires before start", async () => {
    const limit = createRequestLimiter({ limit: 1, timeoutMs: 1000 });
    const controller = new AbortController();
    let secondStarted = false;
    const first = limit(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return "first";
    });
    const second = limit(async () => {
      secondStarted = true;
      return "second";
    }, controller.signal);
    const secondSettled = expect(second).rejects.toBeInstanceOf(
      RequestLimiterAbortError,
    );
    controller.abort();
    await expect(first).resolves.toBe("first");
    await secondSettled;
    expect(secondStarted).toBe(false);
  });
});
