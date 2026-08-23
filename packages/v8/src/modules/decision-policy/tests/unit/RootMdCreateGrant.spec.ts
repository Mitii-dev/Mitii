import { describe, expect, it } from "vitest";

import { isPathWithinScopes } from "../../../../engine/tool-runtime/internal/PathContainment";
import { TaskTargetExtractor } from "../../../request-understanding/task-analyzer/analyzer/TaskTargetExtractor";
import { DecisionPolicyPipeline } from "../../pipeline/DecisionPolicyPipeline";
import { createInput, createUnderstanding } from "../fixtures/decisionCases";

const PROMPT =
  "Create me an md file with breif explaination about this project, Create the md file in the root of the project";

describe("root markdown creation grants", () => {
  it("extracts repository scope without blocking workspace-root writes", () => {
    const targets = new TaskTargetExtractor().extract(PROMPT);
    expect(
      targets.some(
        (target) => target.kind === "repository" && target.value === "repository",
      ),
    ).toBe(true);

    const understanding = createUnderstanding({
      primaryTaskIntent: "docs",
      interactionIntent: "act",
      taskAnalysis: {
        scope: "repository",
        targets,
        recommendsRepositoryDiscovery: true,
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
        scope: "repository",
        targets,
        recommendsRepositoryDiscovery: true,
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
