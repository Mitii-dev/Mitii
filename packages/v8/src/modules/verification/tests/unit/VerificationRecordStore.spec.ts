import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FileVerificationRecordStore,
  InMemoryVerificationRecordStore,
  VerificationError,
  buildVerificationRecord,
} from "../..";
import type { RepoBuildState } from "../..";

function buildState(phase: "before" | "after"): RepoBuildState {
  return {
    schemaVersion: 1,
    capturedAt: "2026-08-15T12:00:00.000Z",
    phase,
    scope: {
      workspaceRoot: "/repo",
      folderPrefixes: [],
      projectIds: ["web"],
      changeScope: "localized",
    },
    checks: [],
    diagnostics: [],
    summary: { errorCount: 0, warningCount: 0, failedCheckIds: [] },
    reasonCodes: [],
  };
}

describe("VerificationRecordStore", () => {
  it("saves and loads the latest workspace record in memory", async () => {
    const store = new InMemoryVerificationRecordStore();
    const first = buildVerificationRecord({
      runId: "run_old",
      requestId: "req_old",
      workspaceId: "ws_1",
      status: "captured_before",
      before: buildState("before"),
      capturedAt: "2026-08-15T11:00:00.000Z",
      updatedAt: "2026-08-15T11:00:00.000Z",
    });
    const latest = buildVerificationRecord({
      runId: "run_new",
      requestId: "req_new",
      workspaceId: "ws_1",
      status: "incomplete",
      before: buildState("before"),
      after: buildState("after"),
      capturedAt: "2026-08-15T12:00:00.000Z",
      updatedAt: "2026-08-15T12:00:00.000Z",
    });
    await store.save(first);
    await store.save(latest);
    const loaded = await store.loadLatest("ws_1");
    expect(loaded?.recordId).toBe("run_new");
    expect(loaded?.status).toBe("incomplete");
  });

  it("persists a record to disk and reloads it via the latest pointer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mitii-verify-"));
    try {
      const store = new FileVerificationRecordStore(directory);
      const record = buildVerificationRecord({
        runId: "run_disk",
        requestId: "req_disk",
        workspaceId: "ws_disk",
        status: "incomplete",
        before: buildState("before"),
        after: buildState("after"),
      });
      await store.save(record);
      const loaded = await store.load("run_disk");
      const latest = await store.loadLatest("ws_disk");
      expect(loaded?.runId).toBe("run_disk");
      expect(latest?.recordId).toBe("run_disk");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses a leaf directory that is a symbolic link", async () => {
    const parent = await mkdtemp(join(tmpdir(), "mitii-verify-parent-"));
    const real = join(parent, "real");
    const linked = join(parent, "linked");
    try {
      await mkdir(real);
      await symlink(real, linked);
      const store = new FileVerificationRecordStore(linked);
      await expect(
        store.save(
          buildVerificationRecord({
            runId: "run_link",
            requestId: "req_link",
            workspaceId: "ws_link",
            status: "captured_before",
            before: buildState("before"),
          }),
        ),
      ).rejects.toBeInstanceOf(VerificationError);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
