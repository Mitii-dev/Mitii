import { describe, expect, it } from "vitest";

import {
  buildToolGrant,
  selectGrantProfile,
} from "../../actions/BuildToolGrant";
import { DecisionPolicyPipeline } from "../../pipeline/DecisionPolicyPipeline";
import {
  createInput,
  createUnderstanding,
} from "../fixtures/decisionCases";

describe("selectGrantProfile", () => {
  it("maps mode×route to profiles (ask/plan never agent_execute)", () => {
    expect(
      selectGrantProfile({
        mode: "agent",
        route: "execute",
        hasNetworkTools: false,
      }),
    ).toBe("agent_execute");
    expect(
      selectGrantProfile({
        mode: "agent",
        route: "diagnose",
        hasNetworkTools: false,
      }),
    ).toBe("readonly");
    expect(
      selectGrantProfile({
        mode: "ask",
        route: "execute",
        hasNetworkTools: false,
      }),
    ).toBe("readonly");
    expect(
      selectGrantProfile({
        mode: "plan",
        route: "execute",
        hasNetworkTools: false,
      }),
    ).toBe("readonly");
    expect(
      selectGrantProfile({
        mode: "agent",
        route: "clarify",
        hasNetworkTools: false,
      }),
    ).toBe("none");
    expect(
      selectGrantProfile({
        mode: "agent",
        route: "direct_answer",
        hasNetworkTools: true,
      }),
    ).toBe("network_only");
    expect(
      selectGrantProfile({
        mode: "agent",
        route: "direct_answer",
        hasNetworkTools: false,
      }),
    ).toBe("none");
  });
});

describe("BuildToolGrant profiles", () => {
  it("agent execute always includes apply_patch and write effect", () => {
    const result = buildToolGrant({
      mode: "agent",
      route: "execute",
      understanding: createUnderstanding({
        primaryTaskIntent: "bugfix",
        interactionIntent: "act",
      }),
      message: "Fix the login button in src/LoginForm.tsx",
    });
    expect(result.grantProfile).toBe("agent_execute");
    expect(result.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(result.toolGrant.allowedTools).toContain("apply_patch");
    expect(result.toolGrant.allowedEffects).toContain("workspace_write");
    expect(result.reasonCodes).toContain("grant_profile_agent_execute");
    expect(result.reasonCodes).toContain("mutation_execute");
  });

  it("agent diagnose never includes apply_patch", () => {
    const result = buildToolGrant({
      mode: "agent",
      route: "diagnose",
      understanding: createUnderstanding({
        primaryTaskIntent: "diagnose",
        interactionIntent: "question",
      }),
      message: "Why is the preview blank?",
    });
    expect(result.grantProfile).toBe("readonly");
    expect(result.toolGrant.maximumWorkspaceEffect).toBe("read");
    expect(result.toolGrant.allowedTools).not.toContain("apply_patch");
    expect(result.toolGrant.allowedTools).toContain("run_readonly_command");
    expect(result.reasonCodes).toContain("grant_profile_readonly");
    expect(result.reasonCodes).toContain("diagnosis_readonly");
  });

  it("ask mode seals execute-shaped routes to readonly without apply_patch", () => {
    const result = buildToolGrant({
      mode: "ask",
      route: "repository_answer",
      understanding: createUnderstanding({
        primaryTaskIntent: "question",
        interactionIntent: "question",
      }),
      message: "How does auth work in this repo?",
    });
    expect(result.grantProfile).toBe("readonly");
    expect(result.toolGrant.allowedTools).not.toContain("apply_patch");
    expect(result.reasonCodes).toContain("mode_ask_readonly");
  });
});

describe("DecisionPolicyPipeline grant profile honesty", () => {
  const pipeline = new DecisionPolicyPipeline();

  it("execute decision exposes grant_profile_agent_execute and apply_patch", () => {
    const decision = pipeline.decide(
      createInput({
        mode: "agent",
        message: "Fix the TypeScript error in src/auth/login.ts",
        understanding: createUnderstanding({
          primaryTaskIntent: "bugfix",
          interactionIntent: "act",
          taskAnalysis: {
            scope: "single_location",
            complexity: "simple",
            risk: "low",
            targets: [
              { kind: "file", value: "src/auth/login.ts", explicit: true },
            ],
          },
        }),
      }),
    );
    expect(decision.route).toBe("execute");
    expect(decision.toolGrant.allowedTools).toContain("apply_patch");
    expect(decision.reasonCodes).toContain("grant_profile_agent_execute");
  });

  it("diagnose decision never grants apply_patch", () => {
    const decision = pipeline.decide(
      createInput({
        mode: "agent",
        message: "Inspect build logs and identify the compilation error",
        understanding: createUnderstanding({
          primaryTaskIntent: "diagnose",
          interactionIntent: "help",
          taskAnalysis: { scope: "repository", recommendsVerification: false },
        }),
      }),
    );
    expect(decision.route).toBe("diagnose");
    expect(decision.toolGrant.allowedTools).not.toContain("apply_patch");
    expect(decision.reasonCodes).toContain("grant_profile_readonly");
  });
});
