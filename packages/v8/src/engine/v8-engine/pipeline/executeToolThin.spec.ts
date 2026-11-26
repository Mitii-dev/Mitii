import { describe, expect, it } from "vitest";

import { finishExecuteOneTool } from "./executeToolFinish";
import { rejectIfChangeImpactOrMustReadGate } from "./executeToolFinishGates";
import { finishUpdateTodosTool } from "./executeToolFinishUpdateTodos";
import {
  DEFAULT_MUTATING_TOOL_NAMES,
  GIT_WRITE_TOOL_NAMES,
  extractHostsFromWebSearchOutput,
  refreshAuthorityAfterTools,
  toolCompletionDiagnostics,
} from "./executeToolSupport";
import { runV8ModelLoop } from "./modelLoop";
import { settleModelLoopToolTurn } from "./modelLoopSettleTools";

describe("executeTool + modelLoop settle thin", () => {
  it("exports tool-finish helpers", () => {
    expect(typeof finishExecuteOneTool).toBe("function");
    expect(typeof rejectIfChangeImpactOrMustReadGate).toBe("function");
    expect(typeof finishUpdateTodosTool).toBe("function");
  });

  it("exports tool-support helpers", () => {
    expect(DEFAULT_MUTATING_TOOL_NAMES.size).toBeGreaterThan(0);
    expect(GIT_WRITE_TOOL_NAMES.has("git_signoff_range")).toBe(true);
    expect(typeof extractHostsFromWebSearchOutput).toBe("function");
    expect(typeof refreshAuthorityAfterTools).toBe("function");
    expect(typeof toolCompletionDiagnostics).toBe("function");
  });

  it("exports modelLoop settle helper", () => {
    expect(typeof runV8ModelLoop).toBe("function");
    expect(typeof settleModelLoopToolTurn).toBe("function");
  });
});
