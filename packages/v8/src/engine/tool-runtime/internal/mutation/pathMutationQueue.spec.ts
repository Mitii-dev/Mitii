import { describe, expect, it } from "vitest";

import {
  resetPathMutationQueuesForTests,
  withPathMutationQueue,
} from "./pathMutationQueue";

describe("withPathMutationQueue", () => {
  it("serializes overlapping path mutations", async () => {
    resetPathMutationQueuesForTests();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withPathMutationQueue(["a.ts"], async () => {
      order.push("first-enter");
      await firstGate;
      order.push("first-exit");
      return 1;
    });

    // Let first acquire the queue before scheduling second.
    await Promise.resolve();
    const second = withPathMutationQueue(["a.ts"], async () => {
      order.push("second");
      return 2;
    });

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(["first-enter", "first-exit", "second"]);
  });

  it("allows distinct paths to proceed without waiting on each other", async () => {
    resetPathMutationQueuesForTests();
    const started: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const a = withPathMutationQueue(["a.ts"], async () => {
      started.push("a");
      await gateA;
      return "a";
    });
    const b = withPathMutationQueue(["b.ts"], async () => {
      started.push("b");
      return "b";
    });

    // Yield until both entered (distinct paths must not serialize).
    for (let i = 0; i < 10 && started.length < 2; i += 1) {
      await Promise.resolve();
    }
    expect(started.sort()).toEqual(["a", "b"]);
    releaseA();
    await expect(Promise.all([a, b])).resolves.toEqual(["a", "b"]);
  });
});
