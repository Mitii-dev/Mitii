import { describe, expect, it } from "vitest";

import {
  compileDecisionBrief,
  formatDecisionBriefForPrompt,
} from "../actions/CompileDecisionBrief";
import type { ExecutionDecision } from "../contracts";
import { DECISION_POLICY_SCHEMA_VERSION } from "../constants";

function baseDecision(
  overrides: Partial<ExecutionDecision> = {},
): ExecutionDecision {
  return {
    schemaVersion: DECISION_POLICY_SCHEMA_VERSION,
    route: "execute",
    planningDepth: "internal",
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
      required: true,
      minimumEvidence: ["diagnostics"],
      allowUnavailable: true,
    },
    reasonCodes: ["mutation_execute", "change_impact_recommended"],
    rationale: "test",
    warnings: [],
    ...overrides,
  };
}

describe("compileDecisionBrief", () => {
  it("includes playbooks for reason codes and authority note", () => {
    const brief = compileDecisionBrief({ decision: baseDecision() });
    expect(brief.mission).toMatch(/Complete/);
    expect(brief.mustDo.some((m) => /change-impact|analyze_change_impact/i.test(m))).toBe(
      true,
    );
    expect(brief.authorityNote).toMatch(/Decision Policy/);
    const text = formatDecisionBriefForPrompt(brief);
    expect(text).toContain("## Decision brief");
    expect(text).toContain("Must do:");
  });

  it("forbids write claims on diagnose routes", () => {
    const brief = compileDecisionBrief({
      decision: baseDecision({
        route: "diagnose",
        reasonCodes: ["diagnosis_readonly"],
        toolGrant: {
          ...baseDecision().toolGrant,
          maximumWorkspaceEffect: "read",
          allowedTools: ["read_file"],
          allowedEffects: ["workspace_read"],
        },
      }),
    });
    expect(brief.mustNotDo.some((m) => /applying edits/i.test(m))).toBe(true);
  });
});
