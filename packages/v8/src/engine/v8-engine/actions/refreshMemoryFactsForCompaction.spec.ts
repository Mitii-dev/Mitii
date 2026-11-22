import { describe, expect, it, vi } from "vitest";

import {
  clipMemoryFacts,
  refreshMemoryFactsForCompaction,
} from "./refreshMemoryFactsForCompaction";

describe("refreshMemoryFactsForCompaction", () => {
  it("clips facts to the reinject char budget", () => {
    const facts = clipMemoryFacts(
      [
        { id: "a", content: "alpha fact" },
        { id: "b", content: "beta ".repeat(40) },
        { id: "c", content: "gamma" },
      ],
      40,
    );
    expect(facts.map((fact) => fact.id)).toEqual(["a"]);
  });

  it("skips retrieve when pressure is only warn", async () => {
    const retrieve = vi.fn();
    const result = await refreshMemoryFactsForCompaction({
      memory: { retrieve },
      workspaceId: "ws",
      query: "what about auth?",
      maxChars: 800,
      previous: [{ id: "old", content: "kept" }],
      pressure: "warn",
      now: "2026-09-30T00:00:00.000Z",
    });
    expect(retrieve).not.toHaveBeenCalled();
    expect(result.status).toBe("skipped");
    expect(result.facts).toEqual([{ id: "old", content: "kept" }]);
  });

  it("refreshes facts on auto pressure when Memory port returns instructions", async () => {
    const retrieve = vi.fn().mockResolvedValue({
      status: "complete",
      instructions: [
        { id: "m1", title: "Auth", content: "Users auth via OAuth.", priority: 1 },
        { id: "m2", title: "DB", content: "Postgres primary.", priority: 1 },
      ],
      layers: undefined,
      omissions: [],
      warnings: [],
    });
    const result = await refreshMemoryFactsForCompaction({
      memory: { retrieve },
      workspaceId: "ws-1",
      query: "how does auth work?",
      maxChars: 4_000,
      previous: [{ id: "stale", content: "old" }],
      pressure: "auto",
      now: "2026-09-30T00:00:00.000Z",
      fileTargets: ["src/auth.ts"],
    });
    expect(retrieve).toHaveBeenCalledOnce();
    expect(result.refreshed).toBe(true);
    expect(result.status).toBe("refreshed");
    expect(result.facts.map((fact) => fact.id)).toEqual(["m1", "m2"]);
    expect(result.facts[0]?.content).toContain("OAuth");
  });

  it("keeps previous facts when retrieve returns empty", async () => {
    const result = await refreshMemoryFactsForCompaction({
      memory: {
        retrieve: vi.fn().mockResolvedValue({
          status: "empty",
          instructions: [],
          omissions: [],
          warnings: [],
        }),
      },
      workspaceId: "ws",
      query: "q",
      maxChars: 800,
      previous: [{ id: "keep", content: "still useful" }],
      pressure: "hard",
      now: "2026-09-30T00:00:00.000Z",
    });
    expect(result.refreshed).toBe(false);
    expect(result.status).toBe("kept_previous");
    expect(result.facts).toEqual([{ id: "keep", content: "still useful" }]);
  });
});
