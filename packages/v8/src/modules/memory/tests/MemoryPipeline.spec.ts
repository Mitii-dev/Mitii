import { describe, expect, it } from "vitest";

import {
  InMemoryMemoryStore,
  MemoryError,
  MemoryPipeline,
  MEMORY_SCHEMA_VERSION,
} from "..";
import type { MemoryFact } from "..";

const now = "2026-07-26T12:00:00.000Z";

const seed: MemoryFact[] = [
  {
    id: "m-pnpm",
    content: "This workspace uses pnpm for package management.",
    scope: { kind: "workspace", workspaceId: "ws" },
    tags: ["pnpm", "package"],
    privacy: "shareable",
    createdAt: "2026-07-01T00:00:00.000Z",
    source: "user",
  },
  {
    id: "m-stale",
    content: "Old pnpm preference that expired.",
    scope: { kind: "workspace", workspaceId: "ws" },
    tags: ["pnpm"],
    privacy: "shareable",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-07-01T00:00:00.000Z",
    source: "user",
  },
  {
    id: "m-private",
    content: "Private note about pnpm credentials.",
    scope: { kind: "user", userId: "alice" },
    tags: ["pnpm"],
    privacy: "private",
    createdAt: "2026-07-01T00:00:00.000Z",
    source: "user",
  },
  {
    id: "m-unrelated",
    content: "The team prefers blue logos.",
    scope: { kind: "workspace", workspaceId: "ws" },
    tags: ["design"],
    privacy: "shareable",
    createdAt: "2026-07-01T00:00:00.000Z",
    source: "user",
  },
];

describe("MemoryPipeline", () => {
  it("rejects invalid retrieve input", async () => {
    const pipeline = new MemoryPipeline({
      store: new InMemoryMemoryStore(seed),
    });

    await expect(
      pipeline.retrieve({
        schemaVersion: MEMORY_SCHEMA_VERSION,
        query: "pnpm",
        scope: { kind: "workspace" } as never,
      }),
    ).rejects.toBeInstanceOf(MemoryError);
  });

  it("retrieves relevant workspace memory with provenance", async () => {
    const pipeline = new MemoryPipeline({
      store: new InMemoryMemoryStore(seed),
    });

    const result = await pipeline.retrieve({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      query: "install packages with pnpm",
      scope: { kind: "workspace", workspaceId: "ws" },
      now,
    });

    expect(result.status).toBe("retrieved");
    expect(result.reasonCodes).toContain("memory_retrieved");
    expect(result.reasonCodes).toContain("stale_memory_filtered");
    expect(result.instructions.map((block) => block.id)).toEqual(["m-pnpm"]);
    expect(result.instructions[0]?.provenance.source).toBe("memory");
    expect(result.omissions.some((item) => item.memoryId === "m-unrelated")).toBe(
      true,
    );
  });

  it("filters private memory for a different requester", async () => {
    const pipeline = new MemoryPipeline({
      store: new InMemoryMemoryStore(seed),
    });

    const result = await pipeline.retrieve({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      query: "pnpm credentials",
      scope: { kind: "user", userId: "alice" },
      requesterUserId: "bob",
      now,
    });

    expect(result.status).toBe("empty");
    expect(result.reasonCodes).toContain("privacy_filtered");
    expect(result.instructions).toEqual([]);
  });

  it("omits memory that exceeds the dedicated budget", async () => {
    const pipeline = new MemoryPipeline({
      store: new InMemoryMemoryStore(seed),
    });

    const result = await pipeline.retrieve({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      query: "pnpm package management",
      scope: { kind: "workspace", workspaceId: "ws" },
      budgetTokens: 5,
      now,
    });

    expect(result.reasonCodes).toContain("budget_omitted_memory");
    expect(result.usedTokens).toBeLessThanOrEqual(5);
  });

  it("commits with default retention policy", async () => {
    const store = new InMemoryMemoryStore();
    const pipeline = new MemoryPipeline({
      store,
      idGenerator: { next: () => "mem_fixed" },
    });

    const result = await pipeline.commit({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      content: "Prefer vitest for unit tests.",
      scope: { kind: "project", projectId: "proj" },
      tags: ["vitest"],
      privacy: "shareable",
      now,
    });

    expect(result.status).toBe("committed");
    expect(result.memoryId).toBe("mem_fixed");
    expect(result.expiresAt).toBeDefined();
    expect(store.list()).toHaveLength(1);
  });

  it("rejects commits with past expiry", async () => {
    const pipeline = new MemoryPipeline({
      store: new InMemoryMemoryStore(),
    });

    const result = await pipeline.commit({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      content: "Expired fact",
      scope: { kind: "workspace", workspaceId: "ws" },
      expiresAt: "2020-01-01T00:00:00.000Z",
      now,
    });

    expect(result.status).toBe("rejected");
    expect(result.reasonCodes).toContain("commit_rejected");
  });
});
