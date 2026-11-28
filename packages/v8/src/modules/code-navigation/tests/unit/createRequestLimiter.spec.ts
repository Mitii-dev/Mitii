import { describe, expect, it } from "vitest";

import {
  RequestLimiterAbortError,
  RequestLimiterTimeoutError,
  createRequestLimiter,
} from "../../helpers/createRequestLimiter";

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

  it("does not emit unhandledRejection when a fire-and-forget request times out", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const limit = createRequestLimiter({ limit: 1, timeoutMs: 10 });
      void limit(() => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 60)));
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("still rejects awaiting callers with RequestLimiterTimeoutError", async () => {
    const limit = createRequestLimiter({ limit: 1, timeoutMs: 10 });
    await expect(
      limit(() => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 60))),
    ).rejects.toBeInstanceOf(RequestLimiterTimeoutError);
  });

  it("rejects (not throws) and frees the slot when the creator throws synchronously", async () => {
    const limit = createRequestLimiter({ limit: 1, timeoutMs: 1000 });
    const failing = limit((): Promise<string> => {
      throw new Error("sync boom");
    });
    const next = limit(async () => "ok");
    await expect(failing).rejects.toThrow("sync boom");
    await expect(next).resolves.toBe("ok");
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
