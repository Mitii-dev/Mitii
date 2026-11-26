import { describe, expect, it } from "vitest";

import { composeRuntime } from "../../adapters/compose/ComposeRuntime";
import { scriptedModelPort } from "../../adapters/model/ScriptedModelPort";
import { executeViaCallback } from "../../adapters/tools/ExecuteViaCallback";
import { classifyToolEffect, needsMutationApproval } from "../../tools";
import { runThroughTurnLoop } from "../../flow/RunThroughTurnLoop";

describe("classifyToolEffect", () => {
  it("marks apply_patch as mutate and read_file as read", () => {
    expect(classifyToolEffect("apply_patch")).toBe("mutate");
    expect(classifyToolEffect("read_file")).toBe("read");
    expect(classifyToolEffect("fetch_url")).toBe("external");
  });
});

describe("needsMutationApproval", () => {
  it("requires approval for mutate under every_mutation", () => {
    expect(
      needsMutationApproval({
        effect: "mutate",
        grant: { approvalMode: "every_mutation" },
      }),
    ).toBe(true);
    expect(
      needsMutationApproval({
        effect: "mutate",
        grant: { approvalMode: "never" },
      }),
    ).toBe(false);
    expect(
      needsMutationApproval({
        effect: "read",
        grant: { approvalMode: "every_mutation" },
      }),
    ).toBe(false);
  });
});

describe("agent mutate mid-turn gate", () => {
  it("suspends agent execute when model requests apply_patch", async () => {
    const executed: string[] = [];
    const runtime = composeRuntime({
      model: scriptedModelPort([
        {
          text: "",
          toolCalls: [
            { callId: "c1", toolId: "apply_patch", args: { path: "a.ts" } },
          ],
          reasonCodes: ["scripted_mutate"],
        },
      ]),
      tools: executeViaCallback(async ({ toolId }) => {
        executed.push(toolId);
        return { ok: true, output: {} };
      }),
    });

    const result = await runtime.start({
      start: {
        message: "refactor packages/v8/src/runtime helpers for clarity",
      },
      mode: "agent",
      runId: "mut-1",
    });

    expect(result.status).toBe("suspended");
    expect(result.gateKind).toBe("mutation_approval_required");
    expect(result.reasonCodes).toContain("runtime_start_mutation_gate");
    expect(executed).not.toContain("apply_patch");
  });

  it("simulated agent mutate suspends under default agent grant", async () => {
    const result = await runThroughTurnLoop({
      start: {
        message: "refactor packages/v8/src/runtime helpers for clarity",
      },
      mode: "agent",
      runId: "mut-2",
      simulatedToolCalls: [{ toolId: "apply_patch", effect: "mutate" }],
    });
    expect(result.turnLoop?.gate?.kind).toBe("mutation_approval_required");
    expect(result.turnLoop?.journal.length).toBe(0);
  });

  it("resume approve target=mutation reenters tool_settle", async () => {
    const runtime = composeRuntime();
    const result = await runtime.resume({
      runId: "mut-3",
      decision: "approve",
      target: "mutation",
      message: "refactor packages/v8/src/runtime helpers for clarity",
      mode: "agent",
    });
    expect(result.resumeReenter).toBe("tool_settle");
    expect(result.reasonCodes).toContain("resume_mutation_approved");
  });
});
