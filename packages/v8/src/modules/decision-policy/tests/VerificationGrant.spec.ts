import { describe, expect, it } from "vitest";

import {
  DecisionPolicyPipeline,
  DEFAULT_AGENT_READONLY_COMMAND_PREFIXES,
  DEFAULT_VERIFICATION_COMMAND_PREFIXES,
  buildVerificationGrant,
} from "../index";
import { createInput, createUnderstanding } from "./fixtures/decisionCases";

describe("verification grant + network authority", () => {
  it("keeps agent grants on git prefixes while verification grant widens toolchains", () => {
    const decision = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "agent",
        message: "Fix the null check in src/util.ts",
        understanding: createUnderstanding({
          primaryTaskIntent: "bugfix",
          taskAnalysis: {
            targets: [
              { kind: "file", value: "src/util.ts", explicit: true },
            ],
          },
        }),
      }),
    );

    const agentPrefixes =
      decision.toolGrant.commandRules?.[0]?.prefixes ?? [];
    expect(agentPrefixes).toEqual([
      ...DEFAULT_AGENT_READONLY_COMMAND_PREFIXES,
    ]);
    expect(agentPrefixes).not.toContain("npm");

    const verification = buildVerificationGrant(decision.toolGrant);
    expect(verification.commandRules?.[0]?.prefixes).toEqual([
      ...DEFAULT_VERIFICATION_COMMAND_PREFIXES,
    ]);
    expect(verification.commandRules?.[0]?.prefixes).toContain("npm");
    expect(verification.maximumWorkspaceEffect).toBe("read");
    expect(verification.allowedTools).not.toContain("apply_patch");
  });

  it("grants fetch_url only when message includes concrete hosts", () => {
    const withUrl = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "ask",
        message: "Summarize https://docs.example.com/guide for me",
        understanding: createUnderstanding({
          primaryTaskIntent: "docs",
          interactionIntent: "question",
        }),
      }),
    );
    expect(withUrl.toolGrant.allowedTools).toContain("fetch_url");
    expect(withUrl.toolGrant.allowedEffects).toContain("network_access");
    expect(withUrl.toolGrant.networkHosts).toContain("docs.example.com");

    const withoutUrl = new DecisionPolicyPipeline().decide(
      createInput({
        mode: "ask",
        message: "What is a null check?",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
        }),
      }),
    );
    expect(withoutUrl.toolGrant.allowedTools).not.toContain("fetch_url");
    expect(withoutUrl.toolGrant.allowedEffects).not.toContain("network_access");
  });
});
