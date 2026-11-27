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

  it("guided when_required auto-approves apply_patch but gates delete_file", () => {
    expect(
      needsMutationApproval({
        effect: "mutate",
        grant: { approvalMode: "when_required" },
        toolId: "apply_patch",
      }),
    ).toBe(false);
    expect(
      needsMutationApproval({
        effect: "mutate",
        grant: { approvalMode: "when_required" },
        toolId: "delete_file",
      }),
    ).toBe(true);
  });
});

describe("host approvalMode reaches the grant", () => {
  it("pilot (never) applies apply_patch without suspending", async () => {
    const executed: string[] = [];
    const runtime = composeRuntime({
      model: {
        async complete(request) {
          if (request.tools.length === 0) {
            return {
              text: JSON.stringify({
                schemaVersion: 1,
                primaryTaskIntent: "implementation",
                interactionIntent: "request",
                difficulty: "simple",
                taskBand: "small",
                risk: "low",
                scope: "repo",
                planningHint: "none",
                clarityConfidence: "high",
                askUserSuggested: false,
                reasonCodes: ["scripted_assess"],
              }),
              toolCalls: [],
              reasonCodes: ["scripted_assess"],
            };
          }
          if (request.messages.some((m) => m.role === "tool")) {
            return {
              text: "patched",
              toolCalls: [],
              reasonCodes: ["scripted_done"],
            };
          }
          return {
            text: "",
            toolCalls: [
              {
                callId: "c1",
                toolId: "apply_patch",
                args: { path: "a.ts" },
              },
            ],
            reasonCodes: ["scripted_mutate"],
          };
        },
      },
      tools: executeViaCallback(async ({ toolId }) => {
        executed.push(toolId);
        return { ok: true, output: {} };
      }),
    });

    const result = await runtime.start({
      start: {
        message: "refactor packages/v8/src/runtime helpers for clarity",
        approvalMode: "never",
      },
      mode: "agent",
      runId: "mut-pilot",
    });

    expect(executed).toContain("apply_patch");
    expect(result.status).toBe("completed");
    expect(result.gateKind).not.toBe("mutation_approval_required");
    expect(result.reasonCodes).toContain("grant_approval_never");
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
        approvalMode: "every_mutation",
      },
      mode: "agent",
      runId: "mut-1",
    });

    expect(result.status).toBe("suspended");
    expect(result.gateKind).toBe("mutation_approval_required");
    expect(result.reasonCodes).toContain("runtime_start_mutation_gate");
    expect(executed).not.toContain("apply_patch");
  });

  it("simulated agent mutate suspends under every_mutation grant", async () => {
    const result = await runThroughTurnLoop({
      start: {
        message: "refactor packages/v8/src/runtime helpers for clarity",
        approvalMode: "every_mutation",
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
    // No checkpoint pending → settle cannot run; must not rediscover.
    expect(result.status).toBe("failed");
    expect(result.reasonCodes).toContain("resume_mutation_missing_pending");
  });

  it("approve settles pending apply_patch instead of rediscovering", async () => {
    const executed: string[] = [];
    let phase: "start" | "resume" = "start";
    const runtime = composeRuntime({
      model: {
        async complete(request) {
          // Direction assess / forced finals use tools:[].
          if (request.tools.length === 0) {
            return {
              text: JSON.stringify({
                schemaVersion: 1,
                primaryTaskIntent: "implementation",
                interactionIntent: "request",
                difficulty: "simple",
                taskBand: "small",
                risk: "low",
                scope: "repo",
                planningHint: "none",
                clarityConfidence: "high",
                askUserSuggested: false,
                reasonCodes: ["scripted_assess"],
              }),
              toolCalls: [],
              reasonCodes: ["scripted_assess"],
            };
          }
          const hasSettledPatch = request.messages.some(
            (m) =>
              m.role === "tool" &&
              typeof m.content === "string" &&
              /README|changed|ok\":true/i.test(m.content),
          );
          if (phase === "resume" || hasSettledPatch) {
            return {
              text: "README.md was updated.",
              toolCalls: [],
              reasonCodes: ["scripted_after_patch"],
            };
          }
          return {
            text: "",
            toolCalls: [
              {
                callId: "c1",
                toolId: "apply_patch",
                args: { path: "README.md", patch: "---" },
              },
            ],
            reasonCodes: ["scripted_mutate"],
          };
        },
      },
      tools: executeViaCallback(async ({ toolId }) => {
        executed.push(toolId);
        return { ok: true, output: { path: "README.md", changed: true } };
      }),
    });

    const started = await runtime.start({
      start: {
        message: "rewrite README.md with a clear project overview",
        approvalMode: "every_mutation",
      },
      mode: "agent",
      runId: "mut-settle-1",
    });
    expect(started.status).toBe("suspended");
    expect(started.gateKind).toBe("mutation_approval_required");
    expect(started.pendingApproval?.toolName).toBe("apply_patch");
    expect(executed).not.toContain("apply_patch");

    phase = "resume";
    const resumed = await runtime.resume({
      runId: "mut-settle-1",
      decision: "approve",
      target: "mutation",
      message: "rewrite README.md with a clear project overview",
      mode: "agent",
    });

    expect(executed).toContain("apply_patch");
    expect(resumed.reasonCodes).toContain("resume_mutation_approved");
    expect(resumed.reasonCodes).toContain("resume_mutation_tool_settled");
    expect(resumed.resumeReenter).toBe("tool_settle");
    expect(resumed.reasonCodes).not.toContain(
      "runtime_resume_mutation_settle_failed",
    );
    // Must not re-suspend on the same pending apply_patch after approve.
    expect(resumed.status).not.toBe("suspended");
    expect(resumed.status).toBe("completed");
  });
});
