import { describe, expect, it } from "vitest";

import { evaluateMutationCritic } from "../evaluateMutationCritic";
import { compileDecisionBrief } from "../../../../modules/decision-policy";
import type { ExecutionDecision } from "../../../../modules/decision-policy";
import { DECISION_POLICY_SCHEMA_VERSION } from "../../../../modules/decision-policy";

function writeDecision(): ExecutionDecision {
  return {
    schemaVersion: DECISION_POLICY_SCHEMA_VERSION,
    route: "execute",
    planningDepth: "none",
    planGate: "none",
    runDisposition: "continue",
    repositoryContextRequired: true,
    toolGrant: {
      maximumWorkspaceEffect: "write",
      allowedTools: ["read_file", "apply_patch"],
      allowedEffects: ["workspace_read", "workspace_write"],
      pathScopes: ["src"],
      approvalMode: "when_required",
      limits: {
        maxToolCalls: 40,
        maxWallTimeMs: 60_000,
        maxOutputBytes: 1_000_000,
      },
    },
    verification: {
      required: false,
      minimumEvidence: [],
      allowUnavailable: true,
    },
    reasonCodes: ["mutation_execute"],
    rationale: "test",
    warnings: [],
  };
}

describe("evaluateMutationCritic", () => {
  it("passes when mode is off", () => {
    const result = evaluateMutationCritic({
      decision: writeDecision(),
      mutationToolNames: ["apply_patch"],
      intendedPaths: ["other/file.ts"],
      mode: "off",
    });
    expect(result.verdict).toBe("pass");
    expect(result.shadowWouldBlock).toBe(false);
  });

  it("shadow mode logs but passes", () => {
    const result = evaluateMutationCritic({
      decision: writeDecision(),
      mutationToolNames: ["apply_patch"],
      intendedPaths: ["other/file.ts"],
      mode: "shadow",
    });
    expect(result.verdict).toBe("pass");
    expect(result.shadowWouldBlock).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("enforce stops ungranted tools", () => {
    const result = evaluateMutationCritic({
      decision: writeDecision(),
      mutationToolNames: ["delete_file"],
      mode: "enforce",
    });
    expect(result.verdict).toBe("stop_and_clarify");
  });

  it("uses mutationPathScopes when present instead of pathScopes", () => {
    const decision = writeDecision();
    decision.toolGrant = {
      ...decision.toolGrant,
      pathScopes: ["."],
      mutationPathScopes: ["docs"],
    };
    const result = evaluateMutationCritic({
      decision,
      mutationToolNames: ["apply_patch"],
      intendedPaths: ["app/loading.tsx"],
      mode: "enforce",
    });
    expect(result.verdict).toBe("stop_and_clarify");
    expect(result.reasons.some((r) => /out of grant scope/i.test(r))).toBe(true);
  });

  it("uses brief for change-impact revise signal", () => {
    const decision = {
      ...writeDecision(),
      reasonCodes: ["mutation_execute", "change_impact_recommended"] as const,
    };
    const brief = compileDecisionBrief({ decision: decision as ExecutionDecision });
    const result = evaluateMutationCritic({
      decision: decision as ExecutionDecision,
      brief,
      mutationToolNames: ["apply_patch"],
      intendedPaths: ["src/a.ts"],
      proposedSummary: "I will patch the file now",
      mode: "enforce",
    });
    expect(["revise", "pass"]).toContain(result.verdict);
  });
});
