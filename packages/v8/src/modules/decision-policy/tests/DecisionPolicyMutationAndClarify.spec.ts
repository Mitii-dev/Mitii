import { describe, expect, it } from "vitest";
import { DecisionPolicyPipeline } from "../index";
import { createInput, createUnderstanding } from "./fixtures/decisionCases";

describe("DecisionPolicyPipeline mutation and clarification", () => {
  it("keeps discovery pathScopes at workspace root; mentions are focus not fence", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: "check in @packages and fix it",
        understanding: createUnderstanding({
          primaryTaskIntent: "bugfix",
          interactionIntent: "act",
          taskAnalysis: {
            scope: "multi_file",
            recommendsRepositoryDiscovery: true,
            targets: [
              {
                kind: "file",
                value: "apps/docs/src/components/live-demo-mui.tsx",
                explicit: true,
              },
              {
                kind: "folder",
                value: "packages",
                explicit: true,
              },
            ],
          },
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.toolGrant.pathScopes).toEqual(["."]);
    // Folder/file mentions alone never set mutationPathScopes (focus ≠ fence).
    expect(decision.toolGrant.mutationPathScopes).toBeUndefined();
    expect(decision.toolGrant.scopes?.readPaths).toEqual(["."]);
    expect(decision.toolGrant.allowedTools).toContain("search_files");
    expect(decision.toolGrant.allowedTools).toContain("glob_files");
    expect(decision.toolGrant.allowedTools).toContain("list_directory");
  });

  it("routes agent mutation intents to execute even when interaction is question", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: "Can you add parallel emulator support to the tablet runner?",
        understanding: createUnderstanding({
          primaryTaskIntent: "feature",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "multi_file",
            complexity: "moderate",
            risk: "medium",
          },
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.toolGrant.allowedTools).toContain("apply_patch");
    expect(decision.toolGrant.allowedTools).toContain("move_file");
    expect(decision.toolGrant.allowedTools).toContain("run_command");
  });

  it("routes start-implementation follow-ups to execute even with stale question intent", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: "STart the implemnetation",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          taskAnalysis: {
            clarity: "unclear",
            scope: "unknown",
            complexity: "simple",
            risk: "low",
          },
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.runDisposition).toBe("continue");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.toolGrant.allowedTools).toContain("apply_patch");
  });

  it("routes continuation artifact requests to execute even with stale question intent", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: "I need fields and FormBuilder and Renderer as well",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          taskAnalysis: {
            clarity: "unclear",
            scope: "unknown",
            complexity: "simple",
            risk: "low",
            recommendsRepositoryDiscovery: false,
            recommendsVerification: false,
          },
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.runDisposition).toBe("continue");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.toolGrant.allowedTools).toContain("apply_patch");
    expect(decision.reasonCodes).toContain("mutation_execute");
  });

  it("does not clarify short nav-label change asks under soft Officer ambiguity", () => {
    // "Change the nav label to Docs" must execute — not clarify chips.
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: "Change the nav label to Docs",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          confidence: 0.62,
          confidenceMargin: 0.08,
          status: "clarification_required",
          recommendsClarification: true,
          needsClarification: true,
          taskAnalysis: {
            clarity: "unclear",
            recommendsTaskClarification: true,
            scope: "package",
            complexity: "simple",
            taskSize: "small",
            risk: "low",
          },
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.runDisposition).toBe("continue");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.planningDepth).not.toBe("visible");
  });

  it("does not clarify clear agent implement asks even when understanding is soft-ambiguous", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message:
          "Can you implement multi emulator testing in the tab so I can configure and run parallel test cases",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          status: "clarification_required",
          recommendsClarification: true,
          needsClarification: true,
          taskAnalysis: {
            clarity: "unclear",
            recommendsTaskClarification: true,
            scope: "repository",
            complexity: "complex",
            risk: "medium",
          },
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.runDisposition).toBe("continue");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
  });

  it("does not clarify path-targeted Add/create asks under low-confidence soft flags", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message:
          "Add app/error.tsx for the home route following Next.js App Router conventions.",
        understanding: createUnderstanding({
          primaryTaskIntent: "feature",
          interactionIntent: "act",
          confidence: 0.62,
          confidenceMargin: 0.08,
          status: "clarification_required",
          recommendsClarification: true,
          needsClarification: true,
          taskAnalysis: {
            clarity: "unclear",
            recommendsTaskClarification: true,
            scope: "single_location",
            complexity: "simple",
            risk: "low",
          },
        }),
      }),
    );

    expect(decision.route).toBe("execute");
    expect(decision.runDisposition).toBe("continue");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
  });

  it("clarifies agent style asks when understanding flags low-confidence ambiguity", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message:
          "In the website landing page I see so many start which is not so profesional can you make it professional and Elegant",
        understanding: createUnderstanding({
          primaryTaskIntent: "style",
          interactionIntent: "act",
          confidence: 0.72,
          confidenceMargin: 0.2,
          status: "clarification_required",
          recommendsClarification: true,
          needsClarification: true,
          taskAnalysis: {
            clarity: "unclear",
            recommendsTaskClarification: true,
            scope: "multi_file",
            risk: "low",
          },
        }),
      }),
    );

    expect(decision.route).toBe("clarify");
    expect(decision.runDisposition).toBe("clarification_required");
    expect(decision.reasonCodes).toContain("clarification_material");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("none");
  });

  it("clarifies agent fallback question ballots under unclear + low confidence", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message:
          "In the website landing page I see so many start which is not so profesional can you make it professional and Elegant",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          confidence: 0.45,
          confidenceMargin: 0.45,
          status: "accepted",
          recommendsClarification: false,
          needsClarification: false,
          taskAnalysis: {
            clarity: "unclear",
            recommendsTaskClarification: false,
            scope: "unknown",
            risk: "low",
          },
        }),
      }),
    );

    expect(decision.route).toBe("clarify");
    expect(decision.runDisposition).toBe("clarification_required");
    expect(decision.reasonCodes).toContain("clarification_material");
  });

  it("clarifies investigate-vs-fix forks even when the message looks actionable", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message:
          "Shouws loading... I am running did npx server Can you look into this?",
        understanding: createUnderstanding({
          primaryTaskIntent: "diagnose",
          interactionIntent: "act",
          confidence: 0.6,
          confidenceMargin: 0.05,
          needsClarification: true,
          recommendsClarification: true,
          alternatives: [
            { intent: "diagnose", confidence: 0.55 },
            { intent: "bugfix", confidence: 0.5 },
          ],
          ambiguityQuestion:
            "Should I investigate the loading hang, or apply a fix?",
          taskAnalysis: {
            clarity: "unclear",
            recommendsTaskClarification: true,
            scope: "unknown",
          },
        }),
      }),
    );

    expect(decision.route).toBe("clarify");
    expect(decision.runDisposition).toBe("clarification_required");
    expect(decision.reasonCodes).toContain("clarification_material");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("none");
  });

  it("suppresses clarify for automation origin and continues best-effort", () => {
    const base = createInput({
      mode: "agent",
      message: "fix it",
      understanding: createUnderstanding({
        primaryTaskIntent: "bugfix",
        interactionIntent: "act",
        confidence: 0.6,
        confidenceMargin: 0.05,
        needsClarification: true,
        recommendsClarification: true,
        alternatives: [
          { intent: "diagnose", confidence: 0.55 },
          { intent: "bugfix", confidence: 0.5 },
        ],
        ambiguityQuestion:
          "Should I investigate the loading hang, or apply a fix?",
        taskAnalysis: {
          clarity: "unclear",
          recommendsTaskClarification: true,
          scope: "unknown",
        },
      }),
    });
    const decision = new DecisionPolicyPipeline().decide({
      ...base,
      envelope: { ...base.envelope, origin: "automation" },
    });

    expect(decision.route).not.toBe("clarify");
    expect(decision.runDisposition).toBe("continue");
    expect(decision.reasonCodes).toContain("automation_origin");
    expect(decision.reasonCodes).toContain("automation_clarify_suppressed");
  });

  it("diagnoses agent loading/server symptoms instead of tool-less direct_answer", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: "Shouws loading... I am running did npx server",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          confidence: 0.7,
          taskAnalysis: {
            clarity: "unclear",
            scope: "unknown",
            recommendsRepositoryDiscovery: false,
          },
        }),
      }),
    );

    expect(decision.route).toBe("diagnose");
    expect(decision.runDisposition).toBe("continue");
    expect(decision.reasonCodes).toContain("workspace_symptom_diagnose");
    expect(decision.toolGrant.maximumWorkspaceEffect).not.toBe("none");
    expect(decision.toolGrant.allowedTools).toContain("read_file");
  });

  it("routes agent past-tense follow-ups about prior work to repository_answer", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: "did you clear the old files ??",
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

    expect(decision.route).toBe("repository_answer");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("read");
    expect(decision.toolGrant.allowedTools).not.toContain("apply_patch");
  });
});
