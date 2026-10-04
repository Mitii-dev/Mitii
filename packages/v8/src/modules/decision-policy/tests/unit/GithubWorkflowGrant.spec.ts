import { describe, expect, it } from "vitest";

import { TaskTargetExtractor } from "../../../request-understanding/task-analyzer/analyzer/TaskTargetExtractor";
import { DecisionPolicyPipeline } from "../../pipeline/DecisionPolicyPipeline";
import { createInput, createUnderstanding } from "../fixtures/decisionCases";
import { isPathWithinScopes } from "../helpers/pathScopes";

describe("GitHub Actions workflow grants", () => {
  it("normalizes github/ cites into .github mutation scopes", () => {
    const prompt =
      "Add a GitHub Actions workflow at github/workflows/ci.yml that runs on pull_request.";
    const targets = new TaskTargetExtractor().extract(prompt);

    expect(
      targets.some(
        (target) =>
          target.kind === "file" &&
          target.value === ".github/workflows/ci.yml",
      ),
    ).toBe(true);

    const understanding = createUnderstanding({
      primaryTaskIntent: "config",
      interactionIntent: "act",
      taskAnalysis: {
        scope: "single_location",
        targets,
        recommendsRepositoryDiscovery: false,
      },
    });

    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: prompt,
        understanding,
      }),
    );

    const mutationScopes =
      decision.toolGrant.mutationPathScopes ?? decision.toolGrant.pathScopes;

    expect(mutationScopes.some((scope) => scope.startsWith(".github"))).toBe(
      true,
    );
    expect(mutationScopes.some((scope) => scope.startsWith("github"))).toBe(
      false,
    );
    expect(
      isPathWithinScopes(".github/workflows/ci.yml", mutationScopes),
    ).toBe(true);
  });
});
