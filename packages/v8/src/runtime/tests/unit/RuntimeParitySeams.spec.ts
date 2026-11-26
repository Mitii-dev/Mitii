import { describe, expect, it } from "vitest";

import { EchoLlmPort } from "../../../modules/model-gateway";
import { completeViaLlmPort } from "../../adapters/model/CompleteViaLlmPort";
import { composeRuntime } from "../../adapters/compose/ComposeRuntime";
import { createAgentRunHandleFromRuntimeResult } from "../../adapters/bridge/AgentRunHandleFromRuntimeResult";
import { checkPlanFreshness, buildPlanFingerprint } from "../../helpers/build/CheckPlanFreshness";
import { runEventSchema } from "../../../engine/v8-engine/contracts";

describe("runtime parity seams (mcp / handoff / freshness / context)", () => {
  it("stamps mcp ids and emits handoff on clarify suspend", async () => {
    const runtime = composeRuntime({
      mcpServerIds: ["mcp.docs"],
    });
    const started = await runtime.start({
      start: {
        message: "fix it",
        runId: "parity-1",
        mcpServerIds: ["mcp.repo"],
      },
      mode: "ask",
      runId: "parity-1",
    });
    expect(started.status).toBe("suspended");
    expect(started.mcpServerIds).toEqual(
      expect.arrayContaining(["mcp.repo", "mcp.docs"]),
    );
    expect(started.handoff?.reason).toContain("suspend:");
    expect(started.reasonCodes).toContain("mcp_attach_stamped");
    expect(started.reasonCodes).toContain("task_handoff");
  });

  it("checkPlanFreshness matches fingerprints", () => {
    const fp = buildPlanFingerprint({ runId: "r1", plateId: "p1" });
    expect(
      checkPlanFreshness({
        approvedPlanFingerprint: fp,
        storePlanFingerprint: fp,
      }),
    ).toMatchObject({ fresh: true, reasonCodes: ["plan_fresh"] });
    expect(
      checkPlanFreshness({
        approvedPlanFingerprint: fp,
        storePlanFingerprint: "other",
      }),
    ).toMatchObject({ fresh: false, reasonCodes: ["plan_stale"] });
  });

  it("bridge emits context_ready, prompt_ready, grant_narrowed, mcp/handoff warnings", async () => {
    const handle = createAgentRunHandleFromRuntimeResult({
      schemaVersion: 1,
      runId: "parity-2",
      status: "suspended",
      route: "clarify",
      grantProfile: "research",
      gateKind: "clarification_required",
      mcpServerIds: ["mcp.docs"],
      handoff: { reason: "suspend:clarification_required" },
      context: {
        summary: "route=clarify; grant=research; focus=none",
        focusPathCount: 0,
        blockCount: 1,
      },
      prompt: { toolCount: 2, status: "complete" },
      planFresh: false,
      reasonCodes: ["mcp_attach_stamped", "task_handoff", "plan_stale"],
    });
    const types: string[] = [];
    for await (const event of handle.events) {
      types.push(event.type);
      expect(() => runEventSchema.parse(event)).not.toThrow();
    }
    expect(types).toContain("context_ready");
    expect(types).toContain("prompt_ready");
    expect(types).toContain("grant_narrowed");
    expect(types).toContain("warning");
    expect(types).toContain("suspended");
  });

  it("completed ask path attaches context + prompt sketches", async () => {
    const runtime = composeRuntime({
      model: completeViaLlmPort(new EchoLlmPort()),
    });
    const shell = await runtime.start({
      start: { message: "what is 2+2 in general?", runId: "parity-3" },
      mode: "ask",
      runId: "parity-3",
    });
    expect(shell.status).toBe("completed");
    expect(shell.context?.summary).toContain("route=");
    expect(shell.prompt?.status).toBe("complete");
  });
});
