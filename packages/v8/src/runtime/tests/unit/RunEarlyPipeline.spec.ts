import { describe, expect, it } from "vitest";

import { runEarlyPipeline } from "../../flow/RunEarlyPipeline";

describe("runEarlyPipeline", () => {
  it("orients without fencing folder mentions as mutation prison", async () => {
    const result = await runEarlyPipeline({
      start: { message: "refactor packages/v8/src/runtime please" },
      mode: "agent",
      runId: "t1",
    });
    const pack = result.store.getSlice<{
      request: { intentCues?: { explicitEditLimit: boolean } };
      scope: {
        focusPaths: string[];
        mutationFence?: string[];
        evidence: string;
      };
      reasonCodes: string[];
    }>("situationPack");
    expect(pack?.scope.focusPaths.length).toBeGreaterThan(0);
    expect(pack?.scope.mutationFence).toBeUndefined();
    expect(pack?.scope.evidence).toBe("focus_only");
    expect(pack?.request.intentCues?.explicitEditLimit).toBe(false);
    expect(pack?.reasonCodes).toContain("scope_focus_not_fence");
    expect(result.decision.grantProfile).toBe("agent_execute");
  });

  it("orients with mutationFence when user says only edit inside a path", async () => {
    const result = await runEarlyPipeline({
      start: {
        message: "only edit packages/v8/src/runtime helpers",
      },
      mode: "agent",
      runId: "t1b",
    });
    const pack = result.store.getSlice<{
      scope: { mutationFence?: string[]; evidence: string };
      reasonCodes: string[];
    }>("situationPack");
    expect(pack?.scope.evidence).toBe("explicit_limit");
    expect(pack?.scope.mutationFence?.length).toBeGreaterThan(0);
    expect(pack?.reasonCodes).toContain("scope_explicit_mutation_fence");
  });

  it("asks clarify when message is vague", async () => {
    const result = await runEarlyPipeline({
      start: { message: "fix it" },
      mode: "agent",
      runId: "t2",
    });
    expect(result.decision.route).toBe("clarify");
    expect(result.gate?.status).toBe("suspended");
    expect(result.gate?.kind).toBe("clarification_required");
  });

  it("ask mode never selects agent_execute plate", async () => {
    const result = await runEarlyPipeline({
      start: { message: "implement a modal with data-testid" },
      mode: "ask",
      runId: "t3",
    });
    expect(result.decision.grantProfile).not.toBe("agent_execute");
  });

  it("wires host snapshot and skill pins into SituationPack", async () => {
    const result = await runEarlyPipeline({
      start: {
        message: "look at the focused file",
        requiredSkillIds: ["skill.demo"],
        requiredMcpServerIds: ["mcp.demo"],
        host: {
          focusedFile: "apps/demo/src/App.tsx",
          cwd: "/workspace",
          dirtyPaths: ["apps/demo/src/App.tsx"],
        },
      },
      mode: "agent",
      runId: "t4",
    });
    const pack = result.store.getSlice<{
      host?: { focusedFile?: string; dirtyPaths: string[] };
      pins?: { skillIds: string[]; mcpIds: string[] };
      scope: { focusPaths: string[] };
      reasonCodes: string[];
    }>("situationPack");
    expect(pack?.host?.focusedFile).toBe("apps/demo/src/App.tsx");
    expect(pack?.pins?.skillIds).toContain("skill.demo");
    expect(pack?.pins?.mcpIds).toContain("mcp.demo");
    expect(pack?.scope.focusPaths).toContain("apps/demo/src/App.tsx");
    expect(pack?.reasonCodes).toContain("orient_host_snapshot");
    expect(pack?.reasonCodes).toContain("orient_pins_attached");

    const assessment = result.store.getSlice<{
      reasonCodes: string[];
      skillsAndMcp?: { matchedSkillIds: string[] };
    }>("assessment");
    expect(assessment?.reasonCodes).toContain("assess_direction_deterministic");
    expect(assessment?.skillsAndMcp?.matchedSkillIds).toContain("skill.demo");
  });
});
