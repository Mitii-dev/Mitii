import { describe, expect, it } from "vitest";

import {
  HashMemoryEmbedding,
  InMemoryMemoryStore,
  MemoryError,
  MemoryPipeline,
  MEMORY_SCHEMA_VERSION,
} from "..";
import type { MemoryFactDraft } from "..";

const now = "2026-07-26T12:00:00.000Z";

const seed: MemoryFactDraft[] = [
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

  it("commits without a hard 30-day expiry", async () => {
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
    expect(result.expiresAt).toBeUndefined();
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.expiresAt).toBeUndefined();
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

  it("retrieves file-targeted facts that do not overlap the query text", async () => {
    const pipeline = new MemoryPipeline({
      store: new InMemoryMemoryStore([
        {
          id: "m-button",
          content: "Always use the shared Button component.",
          scope: { kind: "workspace", workspaceId: "ws" },
          files: ["src/LoginForm.tsx", "src/ui/Button.tsx"],
          concepts: ["button"],
          privacy: "shareable",
          createdAt: "2026-07-10T00:00:00.000Z",
          source: "user",
        },
        {
          id: "m-logos",
          content: "The team prefers blue logos.",
          scope: { kind: "workspace", workspaceId: "ws" },
          tags: ["design"],
          privacy: "shareable",
          createdAt: "2026-07-10T00:00:00.000Z",
          source: "user",
        },
      ]),
    });

    const result = await pipeline.retrieve({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      query:
        "When the user clicks Sign in, show a loading label and disable it.",
      scope: { kind: "workspace", workspaceId: "ws" },
      fileTargets: ["src/LoginForm.tsx"],
      now,
    });

    expect(result.status).toBe("retrieved");
    expect(result.reasonCodes).toContain("memory_file_boosted");
    expect(result.instructions.map((block) => block.id)).toContain("m-button");
    expect(result.instructions.map((block) => block.id)).not.toContain(
      "m-logos",
    );
  });

  it("derives concepts on commit when the host omits them", async () => {
    const store = new InMemoryMemoryStore();
    const pipeline = new MemoryPipeline({
      store,
      idGenerator: { next: () => "mem_concepts" },
    });

    await pipeline.commit({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      content: "Prefer vitest for unit tests.",
      scope: { kind: "project", projectId: "proj" },
      tags: ["vitest"],
      privacy: "shareable",
      now,
    });

    const stored = store.list()[0];
    expect(stored?.concepts).toContain("vitest");
    expect(stored?.contentHash).toEqual(expect.any(String));
    expect(stored?.isLatest).toBe(true);
  });

  it("omits superseded facts from retrieve", async () => {
    const pipeline = new MemoryPipeline({
      store: new InMemoryMemoryStore([
        {
          id: "m-old",
          content: "This workspace uses yarn.",
          scope: { kind: "workspace", workspaceId: "ws" },
          tags: ["yarn", "package"],
          privacy: "shareable",
          createdAt: "2026-01-01T00:00:00.000Z",
          source: "user",
          isLatest: false,
        },
        {
          id: "m-new",
          content: "This workspace uses pnpm.",
          scope: { kind: "workspace", workspaceId: "ws" },
          tags: ["pnpm", "package"],
          privacy: "shareable",
          createdAt: "2026-07-01T00:00:00.000Z",
          source: "user",
        },
      ]),
    });

    const result = await pipeline.retrieve({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      query: "install packages with pnpm",
      scope: { kind: "workspace", workspaceId: "ws" },
      now,
    });

    expect(result.reasonCodes).toContain("memory_superseded");
    expect(result.instructions.map((block) => block.id)).toEqual(["m-new"]);
  });

  it("redacts secrets on commit", async () => {
    const store = new InMemoryMemoryStore();
    const pipeline = new MemoryPipeline({
      store,
      idGenerator: { next: () => "mem_secret" },
    });

    const result = await pipeline.commit({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      content: "Rotate this token: sk-ant-abcdefghijklmnopqrstuvwxyz123456 and keep pnpm.",
      scope: { kind: "workspace", workspaceId: "ws" },
      privacy: "shareable",
      now,
    });

    expect(result.status).toBe("committed");
    expect(result.reasonCodes).toContain("privacy_redacted");
    expect(store.list()[0]?.content).toContain("[REDACTED_SECRET]");
    expect(store.list()[0]?.content).not.toContain("sk-ant-");
  });

  it("supersedes a near-duplicate latest fact", async () => {
    const store = new InMemoryMemoryStore([
      {
        id: "m-old-pnpm",
        content: "This workspace uses pnpm for package management.",
        scope: { kind: "workspace", workspaceId: "ws" },
        tags: ["pnpm"],
        privacy: "shareable",
        createdAt: "2026-07-01T00:00:00.000Z",
        source: "user",
      },
    ]);
    const pipeline = new MemoryPipeline({
      store,
      idGenerator: { next: () => "mem_next" },
    });

    const result = await pipeline.commit({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      content: "This workspace uses pnpm for package management and lockfiles.",
      scope: { kind: "workspace", workspaceId: "ws" },
      privacy: "shareable",
      now,
    });

    expect(result.status).toBe("committed");
    expect(result.reasonCodes).toContain("memory_superseded");
    expect(store.list().find((fact) => fact.id === "m-old-pnpm")?.isLatest).toBe(
      false,
    );
    expect(store.list().find((fact) => fact.id === "mem_next")?.supersedes).toEqual(
      ["m-old-pnpm"],
    );
  });

  it("rejects an exact duplicate inside the dedup window", async () => {
    const pipeline = new MemoryPipeline({
      store: new InMemoryMemoryStore(),
      idGenerator: { next: () => "mem_dup" },
    });

    const input = {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      content: "Always use the shared Button component.",
      scope: { kind: "workspace" as const, workspaceId: "ws" },
      privacy: "shareable" as const,
      now,
    };

    const first = await pipeline.commit(input);
    const second = await pipeline.commit(input);

    expect(first.status).toBe("committed");
    expect(second.status).toBe("rejected");
    expect(second.reasonCodes).toContain("memory_duplicate");
  });

  it("records access on retrieved facts", async () => {
    const store = new InMemoryMemoryStore(seed);
    const pipeline = new MemoryPipeline({ store });

    await pipeline.retrieve({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      query: "install packages with pnpm",
      scope: { kind: "workspace", workspaceId: "ws" },
      now,
    });

    expect(store.list().find((fact) => fact.id === "m-pnpm")?.accessCount).toBeGreaterThan(
      0,
    );
  });

  it("fuses hashed embeddings when a port is injected", async () => {
    const pipeline = new MemoryPipeline({
      store: new InMemoryMemoryStore(seed),
      embedding: new HashMemoryEmbedding(),
    });

    const result = await pipeline.retrieve({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      query: "which package manager does this repo use",
      scope: { kind: "workspace", workspaceId: "ws" },
      now,
    });

    expect(result.reasonCodes).toContain("memory_hybrid");
    expect(result.instructions.map((block) => block.id)).toContain("m-pnpm");
  });
});
