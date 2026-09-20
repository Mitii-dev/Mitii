import { describe, expect, it, vi } from "vitest";

import type { DiagnosticItem, DiagnosticsPort } from "../../contracts";
import {
  collectPostEditDiagnostics,
  settleDiagnosticsPort,
  summarizePostEditDiagnostics,
} from "../collectPostEditDiagnostics";
import { filterNewDiagnostics } from "../filterNewDiagnostics";

function diagnostic(
  partial: Partial<DiagnosticItem> & Pick<DiagnosticItem, "path" | "message">,
): DiagnosticItem {
  return {
    severity: "error",
    ...partial,
  };
}

describe("filterNewDiagnostics", () => {
  it("returns after when baseline is empty", () => {
    const after = [diagnostic({ path: "a.ts", message: "x" })];
    expect(filterNewDiagnostics({ after, baseline: [] })).toEqual(after);
  });

  it("excludes baseline identity matches", () => {
    const shared = diagnostic({
      path: "a.ts",
      message: "same",
      startLine: 1,
      startColumn: 1,
    });
    const neu = diagnostic({
      path: "a.ts",
      message: "new",
      startLine: 2,
      startColumn: 1,
    });
    expect(
      filterNewDiagnostics({ after: [shared, neu], baseline: [shared] }),
    ).toEqual([neu]);
  });
});

describe("summarizePostEditDiagnostics", () => {
  it("counts severities and sets requiresRepair for errors only", () => {
    const summary = summarizePostEditDiagnostics({
      settled: true,
      newDiagnostics: [
        diagnostic({ path: "a.ts", message: "e", severity: "error" }),
        diagnostic({ path: "a.ts", message: "w", severity: "warning" }),
        diagnostic({ path: "a.ts", message: "i", severity: "info" }),
      ],
    });
    expect(summary.errorCount).toBe(1);
    expect(summary.warningCount).toBe(1);
    expect(summary.infoCount).toBe(1);
    expect(summary.requiresRepair).toBe(true);
  });

  it("does not require repair for warnings alone", () => {
    const summary = summarizePostEditDiagnostics({
      settled: true,
      newDiagnostics: [
        diagnostic({ path: "a.ts", message: "w", severity: "warning" }),
      ],
    });
    expect(summary.requiresRepair).toBe(false);
  });
});

describe("settleDiagnosticsPort", () => {
  it("delegates to host settleDiagnostics when present", async () => {
    const settleDiagnostics = vi.fn(async () => undefined);
    const port: DiagnosticsPort = {
      readDiagnostics: vi.fn(async () => []),
      settleDiagnostics,
    };
    await settleDiagnosticsPort(port, {
      workspaceRoot: "/ws",
      paths: ["a.ts"],
      timeoutMs: 100,
      pollIntervalMs: 10,
      stableReads: 2,
    });
    expect(settleDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRoot: "/ws",
        paths: ["a.ts"],
        timeoutMs: 100,
      }),
    );
  });

  it("polls until consecutive snapshots match when settle is absent", async () => {
    let calls = 0;
    const port: DiagnosticsPort = {
      readDiagnostics: vi.fn(async () => {
        calls += 1;
        return [
          diagnostic({
            path: "a.ts",
            message: calls < 2 ? "warming" : "stable",
          }),
        ];
      }),
    };
    await settleDiagnosticsPort(port, {
      workspaceRoot: "/ws",
      paths: ["a.ts"],
      timeoutMs: 500,
      pollIntervalMs: 1,
      stableReads: 2,
    });
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});

describe("collectPostEditDiagnostics", () => {
  it("returns empty summary when no changed paths", async () => {
    const port: DiagnosticsPort = {
      readDiagnostics: vi.fn(async () => [
        diagnostic({ path: "a.ts", message: "x" }),
      ]),
      settleDiagnostics: vi.fn(async () => undefined),
    };
    const summary = await collectPostEditDiagnostics({
      diagnostics: port,
      workspaceRoot: "/ws",
      changedPaths: [],
      baseline: [],
    });
    expect(summary.newDiagnostics).toEqual([]);
    expect(summary.settled).toBe(false);
    expect(port.readDiagnostics).not.toHaveBeenCalled();
  });

  it("settles then returns only new diagnostics", async () => {
    const baseline = [
      diagnostic({ path: "a.ts", message: "old", startLine: 1 }),
    ];
    const after = [
      ...baseline,
      diagnostic({ path: "a.ts", message: "new", startLine: 2 }),
    ];
    const port: DiagnosticsPort = {
      settleDiagnostics: vi.fn(async () => undefined),
      readDiagnostics: vi.fn(async () => after),
    };
    const summary = await collectPostEditDiagnostics({
      diagnostics: port,
      workspaceRoot: "/ws",
      changedPaths: ["a.ts"],
      baseline,
    });
    expect(summary.settled).toBe(true);
    expect(summary.newDiagnostics).toHaveLength(1);
    expect(summary.newDiagnostics[0]?.message).toBe("new");
    expect(summary.requiresRepair).toBe(true);
  });

  it("never throws when diagnostics fail", async () => {
    const port: DiagnosticsPort = {
      settleDiagnostics: vi.fn(async () => {
        throw new Error("settle failed");
      }),
      readDiagnostics: vi.fn(async () => {
        throw new Error("read failed");
      }),
    };
    const summary = await collectPostEditDiagnostics({
      diagnostics: port,
      workspaceRoot: "/ws",
      changedPaths: ["a.ts"],
      baseline: [],
    });
    expect(summary.newDiagnostics).toEqual([]);
    expect(summary.settled).toBe(false);
  });
});
