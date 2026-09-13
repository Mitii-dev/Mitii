import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  FileRunCheckpointStore,
  InMemoryRunCheckpointStore,
  restorePointSchema,
  type AgentRunCheckpoint,
  type RestorePoint,
} from "..";

function sampleCheckpoint(
  overrides: Partial<AgentRunCheckpoint> = {},
): AgentRunCheckpoint {
  return {
    runId: "run_abc-123",
    requestId: "req_1",
    suspensionKind: "approval_required",
    input: {
      requestId: "req_1",
      sessionId: "session_1",
      mode: "agent",
      message: "patch login",
    } as AgentRunCheckpoint["input"],
    decision: {
      route: "execute",
    } as AgentRunCheckpoint["decision"],
    messages: [{ role: "user", content: "patch login" }],
    toolCacheEntries: [],
    changedFiles: [],
    mutationCheckpointIds: [],
    reasonCodes: [],
    warnings: [],
    usage: {
      modelCalls: 1,
      toolCalls: 0,
      loopIterations: 1,
      inputTokens: 10,
      outputTokens: 5,
    },
    startedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

function sampleRestorePoint(
  overrides: Partial<RestorePoint> = {},
): RestorePoint {
  return restorePointSchema.parse({
    schemaVersion: 1,
    restorePointId: "rp_1",
    runId: "run_abc-123",
    requestId: "req_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    interactionMode: "agent",
    mutationSnapshot: {
      checkpointId: "cp_1",
      workspaceRoot: "/tmp/ws",
      files: [
        {
          relativePath: "src/a.ts",
          kind: "existing",
          content: "const x = 1;\n",
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    mutationCheckpointIds: ["cp_1"],
    messages: [{ role: "user", content: "patch" }],
    toolCacheEntries: [],
    changedFiles: ["src/a.ts"],
    ...overrides,
  });
}

describe("FileRunCheckpointStore", () => {
  it("persists across instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mitii-checkpoints-"));
    try {
      const store = new FileRunCheckpointStore(directory);
      const checkpoint = sampleCheckpoint();
      await store.save(checkpoint);

      const reloaded = new FileRunCheckpointStore(directory);
      const loaded = await reloaded.load(checkpoint.runId);
      expect(loaded).toBeTruthy();
      expect(loaded?.runId).toBe(checkpoint.runId);
      expect(loaded?.requestId).toBe(checkpoint.requestId);
      expect(loaded?.suspensionKind).toBe("approval_required");
      expect(loaded?.messages).toEqual(checkpoint.messages);

      await reloaded.delete(checkpoint.runId);
      expect(await reloaded.load(checkpoint.runId)).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects empty directory", () => {
    expect(() => new FileRunCheckpointStore("  ")).toThrow(
      /non-empty directory/,
    );
  });

  it("persists restore points and ignores unknown schema versions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mitii-restore-"));
    try {
      const store = new FileRunCheckpointStore(directory);
      const point = sampleRestorePoint();
      await store.saveRestorePoint(point);

      const loaded = await store.loadRestorePoint(point.runId, point.restorePointId);
      expect(loaded?.restorePointId).toBe("rp_1");
      expect(loaded?.mutationSnapshot.files[0]).toMatchObject({
        relativePath: "src/a.ts",
        kind: "existing",
      });

      const listed = await store.listRestorePoints(point.runId);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.mutationCheckpointId).toBe("cp_1");

      // Unknown schemaVersion: write raw then load must return undefined.
      const { writeFile, mkdir } = await import("node:fs/promises");
      const badDir = join(directory, "restore", "run_abc-123");
      await mkdir(badDir, { recursive: true });
      await writeFile(
        join(badDir, "rp_bad.json"),
        JSON.stringify({ ...point, restorePointId: "rp_bad", schemaVersion: 99 }),
        "utf8",
      );
      expect(await store.loadRestorePoint(point.runId, "rp_bad")).toBeUndefined();

      await store.deleteRestorePoints(point.runId);
      expect(await store.listRestorePoints(point.runId)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("InMemoryRunCheckpointStore restore points", () => {
  it("saves lists and loads restore points", async () => {
    const store = new InMemoryRunCheckpointStore();
    const point = sampleRestorePoint();
    await store.saveRestorePoint(point);
    await store.saveRestorePoint(
      sampleRestorePoint({
        restorePointId: "rp_2",
        createdAt: "2026-01-01T00:01:00.000Z",
        mutationSnapshot: {
          ...point.mutationSnapshot,
          checkpointId: "cp_2",
        },
        mutationCheckpointIds: ["cp_1", "cp_2"],
      }),
    );
    const listed = await store.listRestorePoints(point.runId);
    expect(listed.map((s) => s.restorePointId)).toEqual(["rp_1", "rp_2"]);
    expect(
      (await store.loadRestorePoint(point.runId, "rp_2"))?.mutationCheckpointIds,
    ).toEqual(["cp_1", "cp_2"]);
  });
});

describe("restorePointSchema", () => {
  it("rejects unknown schemaVersion", () => {
    const result = restorePointSchema.safeParse({
      ...sampleRestorePoint(),
      schemaVersion: 2,
    });
    expect(result.success).toBe(false);
  });
});
