import { describe, expect, it } from "vitest";

import {
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
});
