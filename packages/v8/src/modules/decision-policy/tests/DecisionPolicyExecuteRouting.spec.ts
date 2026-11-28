import { describe, expect, it } from "vitest";
import { DecisionPolicyPipeline } from "../index";
import {
  WINDOW_BUDGET_SCHEMA_VERSION,
  deriveWindowPolicy,
} from "../../window-budget";
import { createInput, createUnderstanding } from "./fixtures/decisionCases";

describe("DecisionPolicyPipeline execute routing", () => {
  it("routes agent 'dont remove all … keep a few' follow-ups to execute", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: "dont remove all the starts keep few but not too many",
        understanding: createUnderstanding({
          primaryTaskIntent: "style",
          interactionIntent: "act",
          confidence: 0.92,
          taskAnalysis: {
            clarity: "clear",
            scope: "single_location",
            risk: "low",
            recommendsRepositoryDiscovery: true,
          },
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.reasonCodes).toContain("mutation_execute");
    expect(decision.reasonCodes).not.toContain("repository_grounded_answer");
  });

  it("lets ≥70% LLM act win over soft make-a-plan phrasing", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: "Make a plan to fix auth, then implement it in src/auth.ts",
        understanding: createUnderstanding({
          primaryTaskIntent: "bugfix",
          interactionIntent: "act",
          confidence: 0.9,
          needsClarification: false,
          recommendsClarification: false,
          status: "accepted",
          taskAnalysis: {
            clarity: "clear",
            scope: "single_location",
            risk: "low",
            targets: [
              { kind: "file", value: "src/auth.ts", explicit: true },
            ],
          },
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.reasonCodes).toContain("mutation_execute");
    expect(decision.reasonCodes).toContain("policy_llm_authority_write");
    expect(decision.reasonCodes).not.toContain("explicit_plan_request");
  });

  it("keeps hard plan-only even when the ballot is act ≥70%", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: "Plan only: outline how to implement the 10 APIs.",
        understanding: createUnderstanding({
          primaryTaskIntent: "feature",
          interactionIntent: "act",
          confidence: 0.92,
          needsClarification: false,
          recommendsClarification: false,
          status: "accepted",
        }),
      }),
    );

    expect(decision.route).toBe("plan");
    expect(decision.reasonCodes).toContain("explicit_plan_request");
    expect(decision.toolGrant.maximumWorkspaceEffect).not.toBe("write");
  });

  it("lets ≥70% LLM act win over soft do-not-change phrasing on follow-ups", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message:
          "Make the starfield denser again. Do not change the architecture.",
        understanding: createUnderstanding({
          primaryTaskIntent: "style",
          interactionIntent: "act",
          confidence: 0.92,
          needsClarification: false,
          recommendsClarification: false,
          status: "accepted",
          taskAnalysis: {
            clarity: "clear",
            scope: "single_location",
            risk: "low",
          },
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.reasonCodes).toContain("mutation_execute");
    expect(decision.reasonCodes).toContain("policy_llm_authority_write");
  });

  it("keeps hard read-only overrides even when LLM ballot is act ≥70%", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: "Explain the starfield. Do not change any files.",
        understanding: createUnderstanding({
          primaryTaskIntent: "style",
          interactionIntent: "act",
          confidence: 0.92,
          needsClarification: false,
          recommendsClarification: false,
          status: "accepted",
          taskAnalysis: {
            clarity: "clear",
            scope: "single_location",
            risk: "low",
            recommendsRepositoryDiscovery: true,
          },
        }),
      }),
    );

    expect(decision.route).not.toBe("execute");
    expect(decision.toolGrant.maximumWorkspaceEffect).not.toBe("write");
    expect(decision.reasonCodes).not.toContain("mutation_execute");
    expect(decision.reasonCodes).not.toContain("policy_llm_authority_write");
  });

  it("routes agent 'Can you implement…?' to execute with write tools", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message:
          "Can you implement multi emulator testing in the tab\nI should be able to configure and pass parallel test cases to run parallely\nPlease implement a system so that I can parallely execute test cases\n\nClarification: Use the existing tablet tab and WDIO config",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "repository",
            complexity: "complex",
            risk: "medium",
            recommendsRepositoryDiscovery: true,
          },
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.toolGrant.allowedTools).toContain("apply_patch");
    expect(decision.toolGrant.allowedTools).toContain("delete_file");
    expect(decision.toolGrant.allowedTools).toContain("delete_directory");
    expect(decision.toolGrant.allowedTools).toContain("move_file");
    expect(decision.toolGrant.allowedTools).toContain("run_command");
    expect(decision.toolGrant.commandRules?.[0]?.prefixes).toContain("pnpm");
    expect(decision.reasonCodes).toContain("mutation_execute");
    expect(decision.reasonCodes).toContain("process_execution_granted");
  });

  it("routes Fix asks with scoped Do-not constraints to execute, not repository_answer", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: [
          "Fix Desktop headless Chrome support and clean up Billing page-object usage.",
          "",
          "## Constraints",
          "- Do not change test intent/coverage; only encapsulate selectors/actions.",
          "- Do not refactor Tablet/Appium unless required for shared config typing.",
        ].join("\n"),
        understanding: createUnderstanding({
          primaryTaskIntent: "refactor",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "repository",
            complexity: "moderate",
            risk: "medium",
            recommendsRepositoryDiscovery: true,
          },
        }),
        windowPolicy: deriveWindowPolicy({
          schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
          contextWindowTokens: 64_000,
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.reasonCodes).toContain("mutation_execute");
    expect(decision.reasonCodes).not.toContain("repository_grounded_answer");
    expect(decision.planningDepth).not.toBe("none");
  });

  it("routes Implement asks with scoped Do-not-implement to execute", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: [
          "Implement Desktop headless Chrome support.",
          "",
          "## Constraints",
          "- Do not implement Tablet/Appium changes unless required for shared typing.",
        ].join("\n"),
        understanding: createUnderstanding({
          primaryTaskIntent: "feature",
          interactionIntent: "act",
          taskAnalysis: {
            scope: "multi_file",
            complexity: "moderate",
            risk: "medium",
            recommendsRepositoryDiscovery: true,
          },
        }),
        windowPolicy: deriveWindowPolicy({
          schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
          contextWindowTokens: 64_000,
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.reasonCodes).not.toContain("repository_grounded_answer");
  });

  it("routes pasted console runtime dumps without a trusted write ballot to diagnose", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message:
          "main.5773c013a841b85b4e93.js:97 Please, specify correct config params:  \nObject\nIs\t@\tmain.5773c013a841b85b4e93.js:97",
        understanding: createUnderstanding({
          primaryTaskIntent: "diagnose",
          interactionIntent: "question",
          confidence: 0.55,
          taskAnalysis: {
            scope: "multi_file",
            complexity: "moderate",
            risk: "low",
            clarity: "clear",
            recommendsRepositoryDiscovery: true,
          },
        }),
      }),
    );

    expect(decision.route).toBe("diagnose");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("read");
    expect(decision.toolGrant.allowedTools).not.toContain("apply_patch");
    expect(decision.reasonCodes).toContain("diagnosis_readonly");
    expect(decision.reasonCodes).not.toContain("mutation_execute");
  });

  it("executes pasted dumps when the ballot is ≥70% act/bugfix", () => {
    const decision = new DecisionPolicyPipeline().decide({
      ...createInput({
        mode: "agent",
        message:
          "main.5773c013a841b85b4e93.js:97 Please, specify correct config params:  \nObject\nIs\t@\tmain.5773c013a841b85b4e93.js:97",
        understanding: createUnderstanding({
          primaryTaskIntent: "bugfix",
          interactionIntent: "act",
          confidence: 0.9,
          needsClarification: false,
          recommendsClarification: false,
          status: "accepted",
          taskAnalysis: {
            scope: "multi_file",
            complexity: "moderate",
            risk: "low",
            clarity: "clear",
            recommendsRepositoryDiscovery: true,
          },
        }),
      }),
      // Dump heuristic yields only under policy-facts-first + trusted write ballot.
      policyFactsFirst: true,
    });

    expect(decision.route).toBe("execute");
    expect(decision.reasonCodes).toContain("mutation_execute");
    expect(decision.reasonCodes).toContain("policy_llm_authority_write");
    expect(decision.reasonCodes).not.toContain("diagnosis_readonly");
  });

  it("still executes when a console dump is paired with an explicit fix ask", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message:
          "main.5773c013a841b85b4e93.js:97 Please, specify correct config params\nObject\nPlease fix this error",
        understanding: createUnderstanding({
          primaryTaskIntent: "bugfix",
          interactionIntent: "act",
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.reasonCodes).toContain("mutation_execute");
  });

  it("routes Edit docs asks to execute even when understanding labels diagnose", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message:
          "Edit docs/loading-indicator.md only: replace border-blue-500 with border-green-500. Do not change app/loading.tsx.",
        understanding: createUnderstanding({
          primaryTaskIntent: "diagnose",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "single_location",
            clarity: "clear",
            targets: [
              { kind: "file", value: "docs/loading-indicator.md", explicit: true },
            ],
          },
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.toolGrant.allowedTools).toContain("apply_patch");
    expect(decision.reasonCodes).toContain("mutation_execute");
    expect(decision.reasonCodes).not.toContain("diagnosis_readonly");
  });

  it("routes symptom + can you fix asks to execute", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message:
          "Users say pasting their email into the signup form doesn't work even when the email is valid — can you fix that?",
        understanding: createUnderstanding({
          primaryTaskIntent: "diagnose",
          interactionIntent: "question",
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.reasonCodes).toContain("mutation_execute");
  });

  it("still routes agent how-to implement questions to repository_answer", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: "How do I implement multi emulator parallel testing?",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "repository",
            recommendsRepositoryDiscovery: true,
          },
        }),
      }),
    );

    expect(decision.route).toBe("answer");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("read");
    expect(decision.toolGrant.allowedTools).not.toContain("apply_patch");
    expect(decision.toolGrant.allowedTools).not.toContain("delete_file");
    expect(decision.toolGrant.allowedTools).not.toContain("run_command");
  });

  it("routes agent workspace bug reports with unknown scope to execute", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: [
          "I have a issue I'm unable to preview in ui anything imported from ffb-mui",
          "Preview is not at all working when I load the UI",
        ].join("\n"),
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "unknown",
            recommendsRepositoryDiscovery: false,
            recommendsVerification: false,
          },
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.toolGrant.allowedTools).toContain("read_file");
    expect(decision.toolGrant.allowedTools).toContain("search_files");
    expect(decision.toolGrant.allowedTools).toContain("apply_patch");
    expect(decision.reasonCodes).toContain("workspace_bug_execute");
    expect(decision.reasonCodes).toContain("repository_context_required");
  });

  it("routes SyntaxError / stack-trace workspace reports to execute", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: [
          "SyntaxError: Identifier 'InputTypes' has already been declared",
          "http://localhost:3000/ffb-mui-docs/components/select/introduction",
          "no preview loads in docs for mui libs @apps/docs",
        ].join("\n"),
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "unknown",
            recommendsRepositoryDiscovery: false,
            recommendsVerification: false,
          },
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.toolGrant.allowedTools).toContain("search_files");
    expect(decision.toolGrant.pathScopes).toEqual(["."]);
  });

  it("routes agent working vs mistyped-not-working localhost follow-ups to execute", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: [
          "working",
          "http://localhost:3000/core-docs/components/multi-text/basic-multi-text",
          "",
          "nbot working",
          "http://localhost:3000/ffb-mui-docs/components/select/introduction",
          "",
          "id ont know it is packacke or code editor preview",
        ].join("\n"),
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "unknown",
            recommendsRepositoryDiscovery: false,
            recommendsVerification: false,
          },
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.toolGrant.allowedTools).toContain("apply_patch");
    expect(decision.reasonCodes).toContain("workspace_bug_execute");
  });

  it("does not treat unrelated 'got working' phrasing as a workspace bug report", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: "got working preview links for the docs site",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "unknown",
            recommendsRepositoryDiscovery: false,
            recommendsVerification: false,
          },
        }),
      }),
    );

    expect(decision.route).not.toBe("execute");
    expect(decision.toolGrant.allowedTools).not.toContain("apply_patch");
  });
});
