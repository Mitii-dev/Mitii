import { describe, expect, it } from "vitest";

import { scopesFromVerdict } from "../../helpers/grant/ScopesFromVerdict";
import { runEarlyPipeline } from "../../flow/RunEarlyPipeline";

describe("scopesFromVerdict", () => {
  it("keeps reads workspace-wide and fences only when set", () => {
    expect(
      scopesFromVerdict({
        focusPaths: ["packages/a"],
        readHint: "package",
        evidence: "focus_only",
        relatedSeeds: [],
      }).mutationPathScopes,
    ).toBeUndefined();

    expect(
      scopesFromVerdict({
        focusPaths: ["packages/a"],
        readHint: "package",
        evidence: "explicit_limit",
        mutationFence: ["packages/a"],
        relatedSeeds: [],
      }).mutationPathScopes,
    ).toEqual(["packages/a"]);
  });

  it("decide attaches scopes from SituationPack verdict", async () => {
    const focus = await runEarlyPipeline({
      start: { message: "refactor packages/v8/src/runtime" },
      mode: "agent",
      runId: "scope1",
    });
    expect(focus.decision.pathScopes).toEqual(["."]);
    expect(focus.decision.mutationPathScopes).toBeUndefined();
    expect(focus.decision.reasonCodes).toContain("scopes_focus_not_fence");

    const fenced = await runEarlyPipeline({
      start: { message: "only edit packages/v8/src/runtime helpers" },
      mode: "agent",
      runId: "scope2",
    });
    expect(fenced.decision.mutationPathScopes?.length).toBeGreaterThan(0);
    expect(fenced.decision.reasonCodes).toContain("scopes_verdict_mutation_fence");
  });

  it("orients history git and memory when provided", async () => {
    const result = await runEarlyPipeline({
      start: {
        message: "continue the refactor",
        turnKind: "continue",
        history: {
          digest: "prior: refactor runtime",
          priorRoute: "execute",
          compactedTurns: 2,
        },
        git: { branch: "feat/x", dirty: true, recentCommits: ["abc"] },
        memory: { factCount: 3 },
      },
      mode: "agent",
      runId: "hist1",
    });
    const pack = result.store.getSlice<{
      history?: { priorRoute?: string };
      git?: { branch?: string };
      memory?: { factCount: number };
      reasonCodes: string[];
      omissions: Record<string, string>;
    }>("situationPack");
    expect(pack?.history?.priorRoute).toBe("execute");
    expect(pack?.git?.branch).toBe("feat/x");
    expect(pack?.memory?.factCount).toBe(3);
    expect(pack?.reasonCodes).toContain("orient_history_digest");
    expect(pack?.reasonCodes).toContain("orient_git_snapshot");
    expect(pack?.reasonCodes).toContain("orient_memory_facts");
    expect(pack?.omissions.catalog).toBe("not_provided");
  });
});
