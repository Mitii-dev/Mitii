import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { composeAgentEngine } from "../../../engine/v8-engine/adapters/composeAgentEngine";
import { EchoLlmPort } from "../../../modules/model-gateway";
import { composeRuntime, checkToolAgainstGrant } from "../../index";

const v8SrcRoot = join(__dirname, "../../..");

describe("P8 cutover seams", () => {
  it("composeAgentEngine dual-runs RuntimePipeline", () => {
    const llm = new EchoLlmPort();
    const { runtime } = composeAgentEngine({
      understandingLlm: llm,
      runLlm: llm,
      enablePlanning: false,
    });
    expect(runtime.stepIds).toContain("11-verify-finish");
    expect(composeRuntime().stepIds).toEqual(runtime.stepIds);
  });

  it("ValidateGrant imports runtime checkToolAgainstGrant", () => {
    const text = readFileSync(
      join(v8SrcRoot, "engine/tool-runtime/actions/ValidateGrant.ts"),
      "utf8",
    );
    expect(text).toContain("checkToolAgainstGrant");
    expect(
      checkToolAgainstGrant({
        toolId: "read_file",
        grant: { allowedTools: ["read_file"] },
      }).ok,
    ).toBe(true);
  });

  it("discoveryBudgets is a window-budget shim", () => {
    const text = readFileSync(
      join(
        v8SrcRoot,
        "engine/v8-engine/modules/plan-discovery/discoveryBudgets.ts",
      ),
      "utf8",
    );
    expect(text).toContain("window-budget");
  });

  it("runtime.start is the shell twin of engine.start", async () => {
    const llm = new EchoLlmPort();
    const { runtime } = composeAgentEngine({
      understandingLlm: llm,
      runLlm: llm,
      enablePlanning: false,
    });
    const result = await runtime.start({
      start: { message: "fix it" },
      mode: "agent",
      runId: "p8-start",
    });
    expect(result.status).toBe("suspended");
    expect(typeof runtime.resume).toBe("function");
  });

  it("default preferRuntimeShell routes composed engine.start via shell", async () => {
    const llm = new EchoLlmPort();
    const { engine, eventBusEngine } = composeAgentEngine({
      understandingLlm: llm,
      runLlm: llm,
      enablePlanning: false,
    });
    expect(engine).not.toBe(eventBusEngine);

    const result = await engine.start({
      schemaVersion: 1,
      request: {
        sessionId: "p8-shell",
        mode: "ask",
        userMessage: "fix it",
        workspace: { workspaceId: "ws_p8" },
      },
    }).result;
    expect(result.status).toBe("suspended");
    expect(result.route).toBe("clarify");
  });
});
