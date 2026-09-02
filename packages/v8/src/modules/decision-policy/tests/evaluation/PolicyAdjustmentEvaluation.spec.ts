import { describe, expect, it } from "vitest";

import { DecisionPolicyPipeline } from "../../index";
import { createDecisionInput, createUnderstanding } from "../fixtures/decisionFixtureHelpers";

describe("Policy adjustment evaluation", () => {
  const pipeline = new DecisionPolicyPipeline();

  it("narrow() tightens mutation scopes while preserving workspace read", () => {
    const input = createDecisionInput({
      mode: "agent",
      message: "Fix the null crash in parse.ts",
      understanding: createUnderstanding({
        primaryTaskIntent: "bugfix",
        interactionIntent: "act",
        taskAnalysis: {
          scope: "unknown",
          recommendsRepositoryDiscovery: true,
        },
      }),
    });
    const initial = pipeline.decide(input);
    expect(initial.toolGrant.pathScopes).toEqual(["."]);

    const narrowed = pipeline.narrow({
      previous: initial,
      discoveredPaths: ["src/parser/parse.ts", "src/parser/parse.test.ts"],
    });

    expect(narrowed.reasonCodes).toContain("grant_narrowed");
    expect(narrowed.toolGrant.pathScopes).toEqual(["."]);
    expect(narrowed.toolGrant.mutationPathScopes).toEqual(["src/parser"]);
    expect(narrowed.toolGrant.allowedTools).toEqual(initial.toolGrant.allowedTools);
  });

  it("narrow() raises approval and tightens budget on high residual risk", () => {
    const input = createDecisionInput({
      mode: "agent",
      message: "Fix src/pay.ts",
      understanding: createUnderstanding({
        primaryTaskIntent: "bugfix",
        taskAnalysis: {
          scope: "single_location",
          risk: "low",
          recommendsRepositoryDiscovery: false,
          targets: [
            { kind: "file", value: "src/pay.ts", explicit: true },
          ],
        },
      }),
    });
    const initial = pipeline.decide(input);
    const narrowed = pipeline.narrow({
      previous: initial,
      discoveredPaths: ["src/pay.ts"],
      residualRisk: "critical",
    });

    expect(narrowed.toolGrant.approvalMode).toBe("every_mutation");
    expect(narrowed.reasonCodes).toContain("mutation_budget_tight");
    expect(narrowed.reasonCodes).toContain("grant_narrowed");
  });

  it("widen() expands mutation scopes for out-of-grant paths", () => {
    const input = createDecisionInput({
      mode: "agent",
      message: "Update src/components/Button.tsx",
      understanding: createUnderstanding({
        primaryTaskIntent: "bugfix",
        taskAnalysis: {
          scope: "single_location",
          recommendsRepositoryDiscovery: false,
          targets: [
            { kind: "file", value: "src/components/Button.tsx", explicit: true },
          ],
        },
      }),
    });
    const initial = pipeline.decide(input);
    const widened = pipeline.widen({
      previous: initial,
      extraPaths: ["src/types/Button.ts"],
    });

    expect(widened.reasonCodes).toContain("grant_expanded");
    expect(widened.toolGrant.mutationPathScopes ?? []).toEqual(
      expect.arrayContaining(["src/types"]),
    );
  });

  it("approvalMode never keeps workspace-wide mutation and skips narrow", () => {
    const input = createDecisionInput({
      mode: "agent",
      approvalMode: "never",
      message: "Add scripts/lint.mjs and wire package.json lint script",
      understanding: createUnderstanding({
        primaryTaskIntent: "feature",
        interactionIntent: "act",
        taskAnalysis: {
          scope: "multi_file",
          recommendsRepositoryDiscovery: true,
          targets: [
            { kind: "file", value: "scripts/lint.mjs", explicit: true },
          ],
        },
      }),
    });
    const initial = pipeline.decide(input);
    expect(initial.toolGrant.approvalMode).toBe("never");
    expect(initial.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(initial.toolGrant.pathScopes).toEqual(["."]);
    expect(initial.toolGrant.mutationPathScopes).toEqual(["."]);

    const narrowed = pipeline.narrow({
      previous: initial,
      discoveredPaths: ["scripts/lint.mjs"],
    });
    expect(narrowed.toolGrant.mutationPathScopes).toEqual(["."]);
    expect(narrowed.toolGrant.pathScopes).toEqual(["."]);
  });
});
