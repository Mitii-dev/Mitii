import { describe, expect, it } from "vitest";

import { DecisionPolicyPipeline } from "../../flow/DecisionPolicyPipeline";
import { buildToolGrant } from "../../helpers/BuildToolGrant";
import { createInput, createUnderstanding } from "../fixtures/decisionCases";

describe("ScopeVerdict → grant (S2-SCOPE)", () => {
  it("applies SituationPack mutationFence when provided", () => {
    const understanding = createUnderstanding({
      primaryTaskIntent: "bugfix",
      taskAnalysis: {
        scope: "package",
        targets: [
          { kind: "folder", value: "packages/mui-builder", explicit: true },
        ],
      },
    });

    const withoutFence = buildToolGrant({
      mode: "agent",
      route: "execute",
      understanding,
      message: "@packages/mui-builder fix ts errors",
    });
    expect(withoutFence.toolGrant.mutationPathScopes).toBeUndefined();

    const withFence = buildToolGrant({
      mode: "agent",
      route: "execute",
      understanding,
      message: "@packages/mui-builder fix ts errors",
      scopeVerdict: {
        focusPaths: ["packages/mui-builder"],
        mutationFence: ["packages/mui-builder"],
      },
    });
    expect(withFence.toolGrant.mutationPathScopes).toEqual([
      "packages/mui-builder",
    ]);
  });

  it("pipeline decide still works without scopeVerdict (focus≠fence)", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: "@packages/demo refactor helpers",
        understanding: createUnderstanding({
          primaryTaskIntent: "refactor",
          taskAnalysis: {
            scope: "package",
            targets: [
              { kind: "folder", value: "packages/demo", explicit: true },
            ],
          },
        }),
      }),
    );
    expect(decision.toolGrant.mutationPathScopes).toBeUndefined();
    expect(decision.toolGrant.pathScopes).toEqual(["."]);
  });
});
