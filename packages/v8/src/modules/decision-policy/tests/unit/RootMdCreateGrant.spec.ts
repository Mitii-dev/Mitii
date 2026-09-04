import { describe, expect, it } from "vitest";

import { TaskTargetExtractor } from "../../../request-understanding/task-analyzer/analyzer/TaskTargetExtractor";
import { DecisionPolicyPipeline } from "../../pipeline/DecisionPolicyPipeline";
import { createInput, createUnderstanding } from "../fixtures/decisionCases";
import { isPathWithinScopes } from "../helpers/pathScopes";

const PROMPT =
  "Create me an md file with breif explaination about this project, Create the md file in the root of the project";

describe("root markdown creation grants", () => {
  it("grants workspace-root writes for root-of-project markdown without repo-wide scope", () => {
    const targets = new TaskTargetExtractor().extract(PROMPT);
    // Locative "root of the project" / "about this project" must not inflate to
    // repository-wide scope (that false-triggers plan gates). Root writes are
    // granted from the message via looksLikeWorkspaceRootMutation instead.
    expect(
      targets.some(
        (target) => target.kind === "repository" && target.value === "repository",
      ),
    ).toBe(false);

    const understanding = createUnderstanding({
      primaryTaskIntent: "docs",
      interactionIntent: "act",
      taskAnalysis: {
        scope: "single_location",
        targets,
        recommendsRepositoryDiscovery: false,
      },
    });

    const pipeline = new DecisionPolicyPipeline();
    const decision = pipeline.decide(
      createInput({
        mode: "agent",
        message: PROMPT,
        understanding,
      }),
    );

    expect(decision.toolGrant.pathScopes).toEqual(["."]);
    expect(decision.toolGrant.mutationPathScopes).toEqual(["."]);

    const narrowed = pipeline.narrow({
      previous: decision,
      discoveredPaths: ["docs/.vitepress/config.ts"],
    });

    const mutationScopes =
      narrowed.toolGrant.mutationPathScopes ?? narrowed.toolGrant.pathScopes;

    expect(
      isPathWithinScopes("PROJECT.md", mutationScopes),
      `planningDepth=${decision.planningDepth} mutationPathScopes=${JSON.stringify(narrowed.toolGrant.mutationPathScopes)}`,
    ).toBe(true);
  });

  it("does not infer mutation scopes from docs context when planning is internal", () => {
    const targets = new TaskTargetExtractor().extract(PROMPT);
    const understanding = createUnderstanding({
      primaryTaskIntent: "docs",
      interactionIntent: "act",
      taskAnalysis: {
        scope: "single_location",
        targets,
        recommendsRepositoryDiscovery: false,
      },
    });

    const pipeline = new DecisionPolicyPipeline();
    const decision = pipeline.decide(
      createInput({
        mode: "agent",
        message: PROMPT,
        understanding,
      }),
    );
    const internalPlan = {
      ...decision,
      planningDepth: "internal" as const,
    };

    const narrowed = pipeline.narrow({
      previous: internalPlan,
      discoveredPaths: ["docs/.vitepress/config.ts"],
    });

    const mutationScopes =
      narrowed.toolGrant.mutationPathScopes ?? narrowed.toolGrant.pathScopes;

    expect(
      isPathWithinScopes("PROJECT.md", mutationScopes),
      `mutationPathScopes=${JSON.stringify(narrowed.toolGrant.mutationPathScopes)}`,
    ).toBe(true);
  });

  it("allows workspace-root files when docs folder is an explicit target", () => {
    const targets = [
      ...new TaskTargetExtractor().extract(PROMPT),
      { kind: "folder" as const, value: "docs", explicit: true },
    ];
    const understanding = createUnderstanding({
      primaryTaskIntent: "docs",
      interactionIntent: "act",
      taskAnalysis: {
        scope: "repository",
        targets,
        recommendsRepositoryDiscovery: true,
      },
    });

    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: PROMPT,
        understanding,
      }),
    );

    expect(decision.toolGrant.mutationPathScopes).toEqual([".", "docs"]);

    const mutationScopes =
      decision.toolGrant.mutationPathScopes ?? decision.toolGrant.pathScopes;
    expect(
      isPathWithinScopes("PROJECT.md", mutationScopes),
      `mutationPathScopes=${JSON.stringify(decision.toolGrant.mutationPathScopes)}`,
    ).toBe(true);
  });
});
