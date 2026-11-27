import { describe, expect, it } from "vitest";

import { adaptHostStartToRuntime } from "../../helpers/adapt/AdaptHostStartToRuntime";
import { runEarlyPipeline } from "../../flow/RunEarlyPipeline";

describe("adaptHostStartToRuntime", () => {
  it("maps dirtyPaths skills mcp and conversation into RuntimeStartInput", () => {
    const adapted = adaptHostStartToRuntime({
      request: {
        userMessage: "fix @packages/demo please",
        mode: "agent",
        conversation: [
          { role: "user", content: "earlier ask" },
          { role: "assistant", content: "ok" },
          { role: "user", content: "fix @packages/demo please" },
        ],
      },
      dirtyPaths: ["packages/demo/src/a.ts"],
      requiredSkillIds: ["skill.x"],
      requiredMcpServerIds: ["mcp.y"],
      workspaceRoot: "/Users/me/proj",
      git: { branch: "main", dirty: true },
    });

    expect(adapted.message).toContain("fix");
    expect(adapted.mode).toBe("agent");
    expect(adapted.host?.dirtyPaths).toContain("packages/demo/src/a.ts");
    expect(adapted.host?.cwd).toBe("/Users/me/proj");
    expect(adapted.requiredSkillIds).toContain("skill.x");
    expect(adapted.requiredMcpServerIds).toContain("mcp.y");
    expect(adapted.history?.compactedTurns).toBe(2);
    expect(adapted.turnKind).toBe("follow_up");
    expect(adapted.conversation).toHaveLength(3);
    expect(adapted.git?.branch).toBe("main");
  });

  it("keeps host taskList for next-slice continuity", () => {
    const adapted = adaptHostStartToRuntime({
      request: { userMessage: "start next", mode: "agent" },
      taskList: {
        schemaVersion: 1,
        source: "agent",
        purpose: "execution",
        items: [
          { id: "s1", title: "First slice", status: "done" },
          { id: "s2", title: "Next slice", status: "pending" },
        ],
      },
      completedPlanStepIds: ["s1"],
    });
    expect(adapted.taskList?.items).toHaveLength(2);
    expect(adapted.completedPlanStepIds).toEqual(["s1"]);
  });

  it("merges runtimeSituation snapshot from desktop/SDK", () => {
    const adapted = adaptHostStartToRuntime({
      request: { userMessage: "continue", mode: "agent" },
      workspaceRoot: "/ws",
      runtimeSituation: {
        host: {
          cwd: "/ws",
          focusedFile: "apps/desktop/src/a.ts",
          dirtyPaths: ["apps/desktop/src/a.ts"],
        },
        git: { branch: "feat/host", dirty: true },
        projectRuleIds: ["rule.safety"],
      },
      instructions: {
        projectRules: [{ id: "rule.docs", content: "keep docs" }],
      },
    });
    expect(adapted.host?.focusedFile).toBe("apps/desktop/src/a.ts");
    expect(adapted.git?.branch).toBe("feat/host");
    expect(adapted.projectRuleIds).toEqual(
      expect.arrayContaining(["rule.safety", "rule.docs"]),
    );
  });

  it("early pipeline peeks via tool port when filesToRead present", async () => {
    const reads: string[] = [];
    const result = await runEarlyPipeline({
      start: {
        message: "refactor packages/v8/src/runtime/helpers/orient",
      },
      mode: "agent",
      runId: "peek1",
      deps: {
        tools: {
          execute: async (input) => {
            reads.push(String((input.args as { path?: string }).path ?? ""));
            return {
              ok: true,
              output: `contents of ${(input.args as { path?: string }).path}`,
            };
          },
        },
        model: {
          complete: async () => ({
            text: JSON.stringify({
              schemaVersion: 1,
              primaryTaskIntent: "refactor",
              interactionIntent: "act",
              difficulty: "moderate",
              taskBand: "medium",
              risk: "medium",
              scope: "multi_file",
              planningHint: "short",
              clarityConfidence: "high",
              askUserSuggested: false,
              filesToRead: ["packages/v8/src/runtime/helpers/orient/index.ts"],
              reasonCodes: [],
            }),
            toolCalls: [],
            reasonCodes: [],
          }),
        },
      },
    });

    const peeks = result.store.getSlice<{
      status: string;
      excerpts: Array<{ path: string; ok: boolean }>;
      reasonCodes: string[];
    }>("ephemeralPeeks");
    expect(peeks?.status).toBe("ok");
    expect(peeks?.excerpts[0]?.ok).toBe(true);
    expect(reads[0]).toContain("orient");
    expect(result.decision.verification.required).toBe(true);
    expect(result.decision.rationale).toContain("plate=");
  });
});
