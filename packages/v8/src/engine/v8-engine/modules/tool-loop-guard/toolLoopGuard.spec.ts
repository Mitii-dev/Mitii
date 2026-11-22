import { describe, expect, it } from "vitest";

import {
  ToolLoopGuard,
  forceFinalToolLoopMessage,
  softToolLoopNudgeMessage,
} from "./index";
import { V8_ENGINE_THRESHOLDS } from "../../policy";

describe("ToolLoopGuard", () => {
  const call = { name: "read_file", arguments: { path: "a.ts" } };

  it("allows unique batches then soft-nudges at the soft limit", () => {
    const guard = new ToolLoopGuard({
      softIdenticalLimit: V8_ENGINE_THRESHOLDS.toolLoopSoftIdentical,
      hardIdenticalLimit: V8_ENGINE_THRESHOLDS.toolLoopHardIdentical,
    });

    expect(guard.observeCalls([call]).type).toBe("allow");
    expect(guard.observeCalls([call]).type).toBe("allow");
    const soft = guard.observeCalls([call]);
    expect(soft.type).toBe("soft");
    if (soft.type === "soft") {
      expect(soft.repeatCount).toBe(3);
      expect(softToolLoopNudgeMessage(soft.repeatCount)).toContain(
        "Potential tool loop",
      );
    }
  });

  it("force_final then reject until exhausted", () => {
    const guard = new ToolLoopGuard({
      softIdenticalLimit: 2,
      hardIdenticalLimit: 3,
      forcedRejectLimit: 2,
    });

    expect(guard.observeCalls([call]).type).toBe("allow");
    expect(guard.observeCalls([call]).type).toBe("soft");
    const force = guard.observeCalls([call]);
    expect(force.type).toBe("force_final");
    if (force.type === "force_final") {
      expect(forceFinalToolLoopMessage(force.repeatCount)).toContain(
        "Do not call tools",
      );
    }
    expect(guard.isForcingFinalResponse()).toBe(true);

    const reject1 = guard.observeCalls([call]);
    expect(reject1.type).toBe("reject");
    if (reject1.type === "reject") {
      expect(reject1.exhausted).toBe(false);
    }
    const reject2 = guard.observeCalls([call]);
    expect(reject2.type).toBe("reject");
    if (reject2.type === "reject") {
      expect(reject2.exhausted).toBe(true);
    }
  });

  it("force_final when identical call+result pairs hit the limit", () => {
    const guard = new ToolLoopGuard({
      identicalCallAndResultLimit: 2,
    });
    const result = {
      name: "read_file",
      success: true,
      output: "same",
    };

    guard.observeCalls([call]);
    expect(guard.observeResults([result]).forcedFinalResponse).toBe(false);
    guard.observeCalls([call]);
    const decision = guard.observeResults([result]);
    expect(decision.forcedFinalResponse).toBe(true);
    expect(guard.isForcingFinalResponse()).toBe(true);
  });

  it("resets identical count when the batch signature changes", () => {
    const guard = new ToolLoopGuard({ softIdenticalLimit: 2 });
    guard.observeCalls([call]);
    guard.observeCalls([call]);
    expect(guard.observeCalls([call]).type).toBe("soft");
    const other = {
      name: "read_file",
      arguments: { path: "b.ts" },
    };
    expect(guard.observeCalls([other]).type).toBe("allow");
  });

  it("allows progressive same-path read_file windows without soft nudge", () => {
    const guard = new ToolLoopGuard({
      softIdenticalLimit: 3,
      hardIdenticalLimit: 6,
    });
    const windowA = {
      name: "read_file",
      arguments: { path: "apps/vscode/src/sidebar.ts", startLine: 1, endLine: 80 },
    };
    const windowB = {
      name: "read_file",
      arguments: {
        path: "apps/vscode/src/sidebar.ts",
        startLine: 81,
        endLine: 160,
      },
    };
    const windowC = {
      name: "read_file",
      arguments: {
        path: "apps/vscode/src/sidebar.ts",
        startLine: 161,
        endLine: 240,
      },
    };
    const windowD = {
      name: "read_file",
      arguments: {
        path: "apps/vscode/src/sidebar.ts",
        startLine: 241,
        endLine: 320,
      },
    };
    expect(guard.observeCalls([windowA]).type).toBe("allow");
    expect(guard.observeCalls([windowB]).type).toBe("allow");
    expect(guard.observeCalls([windowC]).type).toBe("allow");
    expect(guard.observeCalls([windowD]).type).toBe("allow");
  });

  it("soft-nudges when the exact same read_file window repeats", () => {
    const guard = new ToolLoopGuard({
      softIdenticalLimit: 3,
      hardIdenticalLimit: 6,
    });
    const sameWindow = {
      name: "read_file",
      arguments: { path: "apps/vscode/src/sidebar.ts", startLine: 1, endLine: 80 },
    };
    expect(guard.observeCalls([sameWindow]).type).toBe("allow");
    expect(guard.observeCalls([sameWindow]).type).toBe("allow");
    expect(guard.observeCalls([sameWindow]).type).toBe("soft");
  });
});
