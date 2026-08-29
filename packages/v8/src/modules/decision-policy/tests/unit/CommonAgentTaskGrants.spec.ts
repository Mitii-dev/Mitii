import { describe, expect, it } from "vitest";

import { TaskTargetExtractor } from "../../../request-understanding/task-analyzer/analyzer/TaskTargetExtractor";
import { DecisionPolicyPipeline } from "../../pipeline/DecisionPolicyPipeline";
import { createInput, createUnderstanding } from "../fixtures/decisionCases";
import { isPathWithinScopes } from "../helpers/pathScopes";
import type { RequestUnderstandingResult } from "../../../request-understanding";

function decideAgent(
  message: string,
  overrides: {
    primaryTaskIntent: RequestUnderstandingResult["intent"]["classification"]["primaryTaskIntent"];
    interactionIntent?: RequestUnderstandingResult["intent"]["classification"]["interactionIntent"];
    taskAnalysis?: Partial<RequestUnderstandingResult["taskAnalysis"]>;
  },
) {
  const extracted = new TaskTargetExtractor().extract(message);
  const understanding = createUnderstanding({
    primaryTaskIntent: overrides.primaryTaskIntent,
    interactionIntent: overrides.interactionIntent ?? "act",
    taskAnalysis: {
      targets: extracted,
      recommendsRepositoryDiscovery: true,
      recommendsVerification: true,
      ...overrides.taskAnalysis,
      ...(overrides.taskAnalysis?.targets
        ? { targets: overrides.taskAnalysis.targets }
        : {}),
    },
  });

  return new DecisionPolicyPipeline().decide(
    createInput({
      mode: "agent",
      message,
      understanding,
    }),
  );
}

function mutationScopesOf(decision: ReturnType<typeof decideAgent>): readonly string[] {
  return decision.toolGrant.mutationPathScopes ?? decision.toolGrant.pathScopes;
}

describe("common agent task grants", () => {
  it("installing packages grants write + process tools at workspace root", () => {
    const message = "Install lodash and update package.json";
    const decision = decideAgent(message, {
      primaryTaskIntent: "dependency",
      taskAnalysis: {
        scope: "repository",
        targets: [
          { kind: "file", value: "package.json", explicit: true },
        ],
      },
    });

    expect(decision.route).toBe("execute");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.toolGrant.pathScopes).toEqual(["."]);
    expect(decision.toolGrant.allowedTools).toContain("apply_patch");
    expect(decision.toolGrant.allowedTools).toContain("run_command");
    expect(decision.toolGrant.allowedEffects).toContain("process_execute");
    expect(decision.reasonCodes).toContain("process_execution_granted");

    const prefixes =
      decision.toolGrant.commandRules?.flatMap((rule) => rule.prefixes) ?? [];
    expect(prefixes).toEqual(expect.arrayContaining(["npm", "pnpm", "yarn", "bun"]));

    const mutationScopes = mutationScopesOf(decision);
    expect(isPathWithinScopes("package.json", mutationScopes)).toBe(true);
    expect(isPathWithinScopes("package-lock.json", mutationScopes)).toBe(true);
  });

  it("adding a README grants root mutation for README.md", () => {
    const message =
      "Add a README.md in the root of the project with a brief project overview";
    const decision = decideAgent(message, {
      primaryTaskIntent: "docs",
      taskAnalysis: {
        scope: "repository",
        targets: [
          { kind: "file", value: "README.md", explicit: true },
          { kind: "repository", value: "repository", explicit: true },
        ],
      },
    });

    expect(decision.route).toBe("execute");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.toolGrant.allowedTools).toContain("apply_patch");
    expect(decision.toolGrant.mutationPathScopes).toEqual(
      expect.arrayContaining(["."]),
    );

    const mutationScopes = mutationScopesOf(decision);
    expect(isPathWithinScopes("README.md", mutationScopes)).toBe(true);

    const narrowed = new DecisionPolicyPipeline().narrow({
      previous: decision,
      discoveredPaths: ["docs/.vitepress/config.ts", "package.json"],
    });
    const afterNarrow =
      narrowed.toolGrant.mutationPathScopes ?? narrowed.toolGrant.pathScopes;
    expect(isPathWithinScopes("README.md", afterNarrow)).toBe(true);
  });

  it("adding a test case grants write into the test file scope", () => {
    const message =
      "Add a unit test case for DecisionPolicyPipeline in packages/v8/src/modules/decision-policy/tests/DecisionPolicyPipeline.spec.ts";
    const decision = decideAgent(message, {
      primaryTaskIntent: "test",
      taskAnalysis: {
        scope: "single_location",
        targets: [
          {
            kind: "file",
            value:
              "packages/v8/src/modules/decision-policy/tests/DecisionPolicyPipeline.spec.ts",
            explicit: true,
          },
        ],
      },
    });

    expect(decision.route).toBe("execute");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.toolGrant.allowedTools).toContain("apply_patch");
    expect(decision.toolGrant.allowedTools).toContain("run_command");

    const mutationScopes = mutationScopesOf(decision);
    expect(
      isPathWithinScopes(
        "packages/v8/src/modules/decision-policy/tests/DecisionPolicyPipeline.spec.ts",
        mutationScopes,
      ),
    ).toBe(true);
  });

  it("fixing TS errors keeps package mutation scope and verification tools", () => {
    const message = "@packages/mui-builder fix all the ts errors";
    const decision = decideAgent(message, {
      primaryTaskIntent: "bugfix",
      taskAnalysis: {
        scope: "package",
        complexity: "moderate",
        risk: "low",
        recommendsPlanning: true,
        estimatedFilesAffected: { minimum: 8, maximum: 20 },
        targets: [
          {
            kind: "folder",
            value: "packages/mui-builder",
            explicit: true,
          },
        ],
      },
    });

    expect(decision.route).toBe("execute");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.toolGrant.pathScopes).toEqual(["."]);
    expect(decision.toolGrant.mutationPathScopes).toEqual([
      "packages/mui-builder",
    ]);
    expect(decision.toolGrant.allowedTools).toContain("apply_patch");
    expect(decision.toolGrant.allowedTools).toContain("run_readonly_command");
    expect(decision.reasonCodes).toContain("process_execution_granted");

    const mutationScopes = mutationScopesOf(decision);
    expect(
      isPathWithinScopes(
        "packages/mui-builder/src/FormBuilder.tsx",
        mutationScopes,
      ),
    ).toBe(true);
    expect(
      isPathWithinScopes("apps/docs/src/index.ts", mutationScopes),
    ).toBe(false);

    const narrowed = new DecisionPolicyPipeline().narrow({
      previous: decision,
      discoveredPaths: [
        "packages/mui-builder/src/FormBuilder.tsx",
        "packages/mui-builder/src/hooks/useFormBuilder.ts",
      ],
    });
    expect(narrowed.toolGrant.mutationPathScopes).toEqual([
      "packages/mui-builder",
    ]);
  });

  it("writing an API grants execute write for feature implementation", () => {
    const message =
      "Write a REST API endpoint for user profiles in packages/api/src/routes/users.ts";
    const decision = decideAgent(message, {
      primaryTaskIntent: "feature",
      taskAnalysis: {
        scope: "multi_file",
        complexity: "moderate",
        risk: "medium",
        targets: [
          {
            kind: "file",
            value: "packages/api/src/routes/users.ts",
            explicit: true,
          },
          {
            kind: "folder",
            value: "packages/api",
            explicit: true,
          },
        ],
      },
    });

    expect(decision.route).toBe("execute");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.toolGrant.pathScopes).toEqual(["."]);
    expect(decision.toolGrant.allowedTools).toContain("apply_patch");
    expect(decision.toolGrant.allowedTools).toContain("search_files");
    expect(decision.toolGrant.allowedTools).toContain("glob_files");

    const mutationScopes = mutationScopesOf(decision);
    expect(
      isPathWithinScopes("packages/api/src/routes/users.ts", mutationScopes),
    ).toBe(true);
    expect(
      isPathWithinScopes("packages/api/src/routes/index.ts", mutationScopes),
    ).toBe(true);
  });

  it("testing the API grants diagnose/process tools without write", () => {
    const message = "Run the API tests and tell me which ones are failing";
    const decision = decideAgent(message, {
      // Verification phrasing wins when understanding is question-shaped
      // (not primaryTaskIntent=test, which is a mutation intent).
      primaryTaskIntent: "question",
      interactionIntent: "question",
      taskAnalysis: {
        scope: "package",
        recommendsVerification: true,
        recommendsRepositoryDiscovery: true,
        targets: [
          { kind: "folder", value: "packages/api", explicit: true },
        ],
      },
    });

    expect(decision.route).toBe("diagnose");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("read");
    expect(decision.toolGrant.allowedTools).not.toContain("apply_patch");
    expect(decision.toolGrant.allowedTools).toContain("run_readonly_command");
    expect(decision.toolGrant.allowedEffects).toContain("process_execute");
    expect(decision.toolGrant.allowedEffects).not.toContain("workspace_write");

    const prefixes =
      decision.toolGrant.commandRules?.flatMap((rule) => rule.prefixes) ?? [];
    expect(prefixes).toEqual(expect.arrayContaining(["npm", "pnpm", "npx"]));
  });

  it("writing then verifying an API keeps mutation on execute and commands available", () => {
    const writeMessage =
      "Implement a GET /health API in packages/api/src/routes/health.ts";
    const writeDecision = decideAgent(writeMessage, {
      primaryTaskIntent: "feature",
      taskAnalysis: {
        scope: "multi_file",
        targets: [
          {
            kind: "file",
            value: "packages/api/src/routes/health.ts",
            explicit: true,
          },
        ],
      },
    });

    expect(writeDecision.route).toBe("execute");
    expect(writeDecision.toolGrant.allowedTools).toContain("apply_patch");
    expect(writeDecision.toolGrant.allowedTools).toContain("run_command");
    expect(
      isPathWithinScopes(
        "packages/api/src/routes/health.ts",
        mutationScopesOf(writeDecision),
      ),
    ).toBe(true);

    const testMessage = "Now run the API tests for packages/api";
    const testDecision = decideAgent(testMessage, {
      primaryTaskIntent: "test",
      interactionIntent: "act",
      taskAnalysis: {
        scope: "package",
        recommendsVerification: true,
        targets: [
          { kind: "folder", value: "packages/api", explicit: true },
        ],
      },
    });

    // Explicit act + test intent can stay on execute with write+process for
    // adding missing coverage, while still allowing package test commands.
    expect(["execute", "diagnose"]).toContain(testDecision.route);
    expect(testDecision.toolGrant.allowedEffects).toContain("process_execute");
    const prefixes =
      testDecision.toolGrant.commandRules?.flatMap((rule) => rule.prefixes) ??
      [];
    expect(prefixes).toEqual(expect.arrayContaining(["npm", "pnpm", "npx"]));
  });
});
