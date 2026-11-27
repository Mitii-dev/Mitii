import { describe, expect, it } from "vitest";

import { StoreManager } from "../../helpers/store";
import {
  appendToolInvocation,
  buildIdempotencyKey,
  findByIdempotencyKey,
  settleToolInvocation,
} from "../../helpers/tool-journal";
import { evaluateSoftRails } from "../../helpers/rails";
import {
  checkToolAgainstGrant,
  toModelToolSurface,
} from "../../tools";
import { runThroughTurnLoop } from "../../flow/RunThroughTurnLoop";
import { defaultGrantFromDecision } from "../../flow/steps/10-TurnLoop";
import type { RuntimeDecisionSketch } from "../../flow/steps/5-Decide";

describe("defaultGrantFromDecision", () => {
  it("prefers plate-compiled toolGrant over stub profiles", () => {
    const decision = {
      grantProfile: "research",
      toolGrant: {
        maximumWorkspaceEffect: "read",
        allowedTools: [
          "read_file",
          "glob_files",
          "list_directory",
          "search_files",
        ],
        allowedEffects: ["workspace_read"],
        pathScopes: ["."],
        approvalMode: "never",
        limits: {
          maxToolCalls: 24,
          maxWallTimeMs: 90_000,
          maxOutputBytes: 256_000,
        },
      },
    } as RuntimeDecisionSketch;

    const grant = defaultGrantFromDecision(decision);
    expect(grant.allowedTools).toEqual(
      expect.arrayContaining(["glob_files", "list_directory", "search_files"]),
    );
    expect(grant.pathScopes).toEqual(["."]);
  });

  it("falls back to discovery tools for research when toolGrant missing", () => {
    const grant = defaultGrantFromDecision({
      grantProfile: "research",
    } as RuntimeDecisionSketch);
    expect(grant.allowedTools).toEqual(
      expect.arrayContaining(["glob_files", "list_directory", "read_file"]),
    );
  });

  it("forwards commandRules from compiled toolGrant", () => {
    const decision = {
      grantProfile: "agent_execute",
      toolGrant: {
        maximumWorkspaceEffect: "write",
        allowedTools: ["read_file", "run_readonly_command", "apply_patch"],
        allowedEffects: ["workspace_read", "workspace_write", "process_execute"],
        pathScopes: ["."],
        approvalMode: "never",
        commandRules: [
          { prefixes: ["node", "pnpm", "git status"], allowShellMetacharacters: false },
        ],
        limits: {
          maxToolCalls: 24,
          maxWallTimeMs: 90_000,
          maxOutputBytes: 256_000,
        },
      },
    } as RuntimeDecisionSketch;
    const grant = defaultGrantFromDecision(decision);
    expect(grant.commandRules?.[0]?.prefixes).toEqual(
      expect.arrayContaining(["node", "pnpm"]),
    );
  });
});

describe("prompt ⊆ grant", () => {
  it("packTurn tools never exceed allowedTools", () => {
    const mgr = StoreManager.create("pack-1");
    const packed = mgr.packTurn({
      messages: [{ role: "user", content: "hi" }],
      grant: { allowedTools: ["read_file", "search_code"] },
    });
    expect(packed.tools).toEqual(["read_file", "search_code"]);
    expect(toModelToolSurface({ allowedTools: ["a"] })).toEqual(["a"]);
  });

  it("denies tools outside grant", () => {
    expect(
      checkToolAgainstGrant({
        toolId: "apply_patch",
        effect: "mutate",
        grant: {
          allowedTools: ["read_file"],
          maximumWorkspaceEffect: "read",
        },
      }),
    ).toEqual({ ok: false, reason: "tool_not_allowed" });
  });
});

describe("tool journal idempotency", () => {
  it("replays succeeded invocation instead of double-append", () => {
    const key = buildIdempotencyKey({
      toolId: "read_file",
      args: { path: "a.ts" },
    });
    let journal = appendToolInvocation([], {
      invocationId: "1",
      toolId: "read_file",
      idempotencyKey: key,
      status: "pending",
      inputHash: key,
      effectClass: "read",
      startedAt: "t0",
    });
    journal = settleToolInvocation(journal, {
      invocationId: "1",
      status: "succeeded",
      finishedAt: "t1",
    });
    expect(findByIdempotencyKey(journal, key)?.status).toBe("succeeded");
  });
});

describe("soft rails + cancel", () => {
  it("emits thrash nudge without suspending", () => {
    const nudges = evaluateSoftRails({ repeatedToolCalls: 4 });
    expect(nudges.some((n) => n.kind === "thrash_nudge")).toBe(true);
  });

  it("turn loop respects cancel flag", async () => {
    const result = await runThroughTurnLoop({
      start: { message: "refactor packages/v8/src/runtime please" },
      mode: "agent",
      runId: "cancel-1",
    });
    result.store.requestCancel();
    const again = await runThroughTurnLoop({
      start: { message: "refactor packages/v8/src/runtime please" },
      mode: "agent",
      runId: "cancel-2",
      simulatedToolCalls: [{ toolId: "apply_patch", effect: "mutate" }],
    });
    // Fresh run — cancel only applies when store already cancelling before loop
    expect(again.turnLoop?.cancelled).toBe(false);

    const store = StoreManager.create("c3");
    store.requestCancel();
    // Direct shell path
    const { turnLoopShell } = await import("../../flow/steps/10-TurnLoop");
    const sketch = turnLoopShell({
      store,
      input: { message: "x" },
      mode: "agent",
    });
    expect(sketch.cancelled).toBe(true);
  });

  it("denies mutate under research grant in turn shell", async () => {
    const result = await runThroughTurnLoop({
      start: { message: "how does packages/v8/src/runtime work?" },
      mode: "ask",
      runId: "deny-1",
      simulatedToolCalls: [
        { toolId: "apply_patch", effect: "mutate" },
        { toolId: "read_file", effect: "read" },
      ],
    });
    expect(result.turnLoop?.denials).toContain("tool_not_allowed");
    expect(
      result.turnLoop?.journal.some((j) => j.toolId === "read_file"),
    ).toBe(true);
  });
});
