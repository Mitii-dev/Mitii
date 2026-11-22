import { afterEach, describe, expect, it, vi } from "vitest";

import { createDebouncedIncrementalIndexTrigger } from "./createDebouncedIncrementalIndexTrigger.js";

describe("createDebouncedIncrementalIndexTrigger", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces paths and flushes once after debounce", async () => {
    vi.useFakeTimers();
    const flushed: string[][] = [];
    const trigger = createDebouncedIncrementalIndexTrigger({
      workspaceRoot: "/tmp/mitii-index-trigger-test",
      respectIndexLock: false,
      debounceMs: 100,
      onFlush: (paths) => {
        flushed.push([...paths]);
      },
    });

    trigger.notify(["a.ts", "b.ts"]);
    trigger.notify(["b.ts", "c.ts"]);
    expect(flushed).toEqual([]);

    await vi.advanceTimersByTimeAsync(100);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]!.sort()).toEqual(["a.ts", "b.ts", "c.ts"]);

    trigger.dispose();
  });

  it("does not flush after dispose", async () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const trigger = createDebouncedIncrementalIndexTrigger({
      workspaceRoot: "/tmp/mitii-index-trigger-test",
      respectIndexLock: false,
      debounceMs: 50,
      onFlush,
    });
    trigger.notify(["a.ts"]);
    trigger.dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(onFlush).not.toHaveBeenCalled();
  });
});
