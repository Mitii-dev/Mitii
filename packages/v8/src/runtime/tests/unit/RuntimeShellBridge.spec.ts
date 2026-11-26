import { describe, expect, it } from "vitest";

import { AGENT_ENGINE_SCHEMA_VERSION } from "../../../engine/v8-engine/legacy/constants";
import { EchoLlmPort } from "../../../modules/model-gateway";
import { composeAgentEngine } from "../../../engine/v8-engine/adapters/composeAgentEngine";
import {
  createAgentRunHandleFromRuntimeResult,
  mapRuntimeGateToSuspensionKind,
} from "../../adapters/bridge/AgentRunHandleFromRuntimeResult";
import { adaptEngineResumeToRuntime } from "../../adapters/bridge/AdaptEngineResumeToRuntime";

describe("runtime shell bridge", () => {
  it("maps mutation gate to approval_required", () => {
    expect(mapRuntimeGateToSuspensionKind("mutation_approval_required")).toBe(
      "approval_required",
    );
  });

  it("builds AgentRunHandle from suspended RuntimeRunResult", async () => {
    const handle = createAgentRunHandleFromRuntimeResult({
      schemaVersion: 1,
      runId: "bridge-1",
      status: "suspended",
      route: "clarify",
      gateKind: "clarification_required",
      reasonCodes: ["runtime_start_suspended"],
    });
    const result = await handle.result;
    expect(result.status).toBe("suspended");
    expect(result.suspension?.kind).toBe("clarification_required");
    expect(result.reasonCodes).toContain("clarification_suspended");
  });

  it("adaptEngineResumeToRuntime maps approval to mutation target", () => {
    const adapted = adaptEngineResumeToRuntime({
      input: {
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId: "r1",
        approval: { approvalId: "a1", decision: "approved" },
      },
      fallbackMessage: "refactor packages/v8/src/runtime",
      mode: "agent",
    });
    expect(adapted).toMatchObject({
      decision: "approve",
      target: "mutation",
    });
  });

  it("preferRuntimeShell routes engine.start through runtime", async () => {
    const llm = new EchoLlmPort();
    const { engine, runtime } = composeAgentEngine({
      understandingLlm: llm,
      runLlm: llm,
      enablePlanning: false,
      preferRuntimeShell: true,
    });
    expect(runtime.stepIds[0]).toBe("1-window-policy");

    const handle = engine.start({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      request: {
        sessionId: "s1",
        mode: "ask",
        userMessage: "fix it",
        workspace: { workspaceId: "ws1" },
      },
    });
    const result = await handle.result;
    expect(result.status).toBe("suspended");
    expect(result.route).toBe("clarify");
    expect(result.suspension?.kind).toBe("clarification_required");
  });
});
