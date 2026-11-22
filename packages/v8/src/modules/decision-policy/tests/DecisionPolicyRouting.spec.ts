import { describe, expect, it } from "vitest";
import { DecisionPolicyPipeline } from "../index";
import { createInput, createUnderstanding } from "./fixtures/decisionCases";

describe("DecisionPolicyPipeline routing", () => {
  it("pins repository state reference when provided", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: "Explain repository indexing",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          taskAnalysis: {
            recommendsRepositoryDiscovery: true,
          },
        }),
        repositoryState: {
          reference: { workspaceId: "ws_a", stateToken: "tok_a" },
          readiness: "degraded",
        },
      }),
    );

    expect(decision.repositoryContextRequired).toBe(true);
    expect(decision.pinnedState).toEqual({
      workspaceId: "ws_a",
      stateToken: "tok_a",
    });
    expect(decision.reasonCodes).toContain("repository_state_degraded");
  });

  it("routes ask-mode Review UI prompts to diagnose with structured findings", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "ask",
        message:
          "Review the current git changes. Use emit_review_finding for each issue with path, content, existingCode, severity, and category.\n\n# Review prep (workspace, effort=medium, rounds=2)\nSelected 3 file(s).",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "multi_file",
            clarity: "unclear",
            recommendsRepositoryDiscovery: true,
          },
        }),
      }),
    );

    expect(decision.route).toBe("diagnose");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("read");
    expect(decision.toolGrant.allowedTools).toContain("emit_review_finding");
    expect(decision.reasonCodes).toContain("diagnosis_readonly");
    expect(decision.reasonCodes).toContain("review_pipeline_required");
    expect(decision.reasonCodes).toContain("review_findings_structured");
    expect(decision.reasonCodes).toContain("mode_ask_readonly");
  });

  it("does not force structured review for free-form code-review questions", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "ask",
        message:
          "can you show the code on how it detects the unused files for code review?",
        understanding: createUnderstanding({
          primaryTaskIntent: "review",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "repository",
            clarity: "unclear",
            recommendsRepositoryDiscovery: true,
          },
        }),
      }),
    );

    expect(decision.route).toBe("diagnose");
    expect(decision.reasonCodes).toContain("diagnosis_readonly");
    expect(decision.reasonCodes).not.toContain("review_pipeline_required");
    expect(decision.reasonCodes).not.toContain("review_findings_structured");
  });

  it("does not force structured review for free-form review phrasing without host markers", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "ask",
        message: "Review the current git changes for bugs",
        understanding: createUnderstanding({
          primaryTaskIntent: "review",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "multi_file",
            recommendsRepositoryDiscovery: true,
          },
        }),
      }),
    );

    expect(decision.reasonCodes).not.toContain("review_pipeline_required");
    expect(decision.reasonCodes).not.toContain("review_findings_structured");
  });

  it("routes ask-mode project questions to repository_answer with read tools", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "ask",
        message: "Deep analysis of this project and how to run it",
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

    expect(decision.route).toBe("repository_answer");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("read");
    expect(decision.toolGrant.allowedTools).toContain("read_file");
    expect(decision.toolGrant.allowedTools).toContain("search_files");
    expect(decision.repositoryContextRequired).toBe(true);
  });

  it("routes deictic 'in this' capability asks to repository_answer", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "ask",
        message: "Is headless supported in this ?",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "unknown",
            clarity: "unclear",
            recommendsRepositoryDiscovery: false,
            recommendsVerification: false,
          },
        }),
      }),
    );

    expect(decision.route).toBe("repository_answer");
    expect(decision.reasonCodes).toContain("repository_grounded_answer");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("read");
    expect(decision.toolGrant.allowedTools).toContain("read_file");
    expect(decision.repositoryContextRequired).toBe(true);
  });

  it("routes 'does this support' asks to repository_answer", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "ask",
        message: "Does this support parallel tablet runs?",
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

    expect(decision.route).toBe("repository_answer");
    expect(decision.toolGrant.allowedTools).toContain("search_files");
  });

  it("routes ask follow-ups about implementing prior findings to repository_answer", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "ask",
        message: "If I have to implement it ?? what shoudl i do ?",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "unknown",
            clarity: "unclear",
            recommendsRepositoryDiscovery: false,
            recommendsVerification: false,
          },
        }),
      }),
    );

    expect(decision.route).toBe("repository_answer");
    expect(decision.reasonCodes).toContain("repository_grounded_answer");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("read");
  });

  it("routes ask follow-ups about running headless on linux to repository_answer", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "ask",
        message: "Can I make headless and run in linux ??",
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

    expect(decision.route).toBe("repository_answer");
    expect(decision.toolGrant.allowedTools).toContain("read_file");
  });

  it("routes ask-mode API design requests to repository_answer even when classified as a question", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "ask",
        message: [
          "I need an api to get the analytic results based on the user query",
          "the analytics will be based on the bill and items",
          "I need to design an api It accepts the user message and ask llm with a prompt and get the results from db",
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

    expect(decision.route).toBe("repository_answer");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("read");
    expect(decision.toolGrant.allowedTools).toContain("read_file");
    expect(decision.toolGrant.allowedTools).toContain("search_files");
    expect(decision.repositoryContextRequired).toBe(true);
  });

  it("keeps pure knowledge questions on direct_answer without tools", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "ask",
        message: "What is a binary search?",
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

    expect(decision.route).toBe("direct_answer");
    expect(decision.toolGrant.allowedTools).toEqual([]);
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("none");
  });

  it("upgrades ask direct_answer to repository_answer when MCP is attached", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "ask",
        message: "List the first 10 Cardiology Doctors",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "unknown",
            recommendsRepositoryDiscovery: false,
            recommendsVerification: false,
          },
        }),
        requiredMcpServerIds: ["mongo"],
      }),
    );

    expect(decision.route).toBe("repository_answer");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("read");
    expect(decision.toolGrant.allowedTools.length).toBeGreaterThan(0);
    expect(decision.toolGrant.allowedMcpServerIds).toEqual(["mongo"]);
    expect(decision.reasonCodes).toContain("mcp_attach_required");
    expect(decision.reasonCodes).toContain("repository_grounded_answer");
  });

  it("routes agent run-tests asks to diagnose with process tools", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message:
          "Can you run the tests and see what all are failing and passing ??",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "unknown",
            clarity: "unclear",
            recommendsRepositoryDiscovery: false,
            recommendsVerification: false,
          },
        }),
      }),
    );

    expect(decision.route).toBe("diagnose");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("read");
    expect(decision.toolGrant.allowedTools).toContain("run_readonly_command");
    expect(decision.toolGrant.allowedTools).not.toContain("apply_patch");
    expect(decision.reasonCodes).toContain("verification_run_requested");
  });

  it("routes ask-mode can-you-test to diagnose instead of direct_answer", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "ask",
        message: "can you test",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "unknown",
            recommendsRepositoryDiscovery: false,
          },
        }),
      }),
    );

    expect(decision.route).toBe("diagnose");
    expect(decision.toolGrant.allowedTools).toContain("read_file");
    expect(decision.toolGrant.allowedTools).toContain("run_readonly_command");
  });

  it("keeps how-to-run questions on repository_answer", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "ask",
        message: "How do I run the inventory spec?",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "unknown",
            recommendsRepositoryDiscovery: true,
          },
        }),
      }),
    );

    expect(decision.route).toBe("repository_answer");
    expect(decision.reasonCodes).not.toContain("verification_run_requested");
  });
});
