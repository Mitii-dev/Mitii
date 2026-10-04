import { describe, expect, it } from "vitest";

import { runV8MutationCritic } from "./index";
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
      allowedTools: ["read_file", "apply_patch", "run_command"],
      allowedEffects: ["workspace_read", "workspace_write"],
      pathScopes: ["src"],
      mutationPathScopes: ["src"],
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

describe("runV8MutationCritic", () => {
  it("passes when mode is off", () => {
    const decision = runV8MutationCritic({
      decision: writeDecision(),
      toolCalls: [
        {
          id: "1",
          name: "apply_patch",
          arguments: { path: "src/a.ts", oldText: "a", newText: "b" },
        },
      ],
      turnContent: "applying patch",
      mode: "off",
    });
    expect(decision.kind).toBe("pass");
  });

  it("stops when mutation paths are out of grant scope (enforce)", () => {
    const decision = runV8MutationCritic({
      decision: writeDecision(),
      toolCalls: [
        {
          id: "1",
          name: "apply_patch",
          arguments: { path: "other/secret.ts", oldText: "a", newText: "b" },
        },
      ],
      turnContent: "patch outside scope",
      mode: "enforce",
    });
    expect(decision.kind).toBe("stop");
  });

  it("shadow mode never blocks but flags would-block", () => {
    const decision = runV8MutationCritic({
      decision: writeDecision(),
      toolCalls: [
        {
          id: "1",
          name: "apply_patch",
          arguments: { path: "other/secret.ts", oldText: "a", newText: "b" },
        },
      ],
      turnContent: "shadow",
      mode: "shadow",
    });
    expect(decision.kind).toBe("pass");
    expect(decision.result.shadowWouldBlock).toBe(true);
  });

  it("revises when mutation targets miss explicit ask-scoped files", () => {
    const decision = runV8MutationCritic({
      decision: writeDecision(),
      toolCalls: [
        {
          id: "1",
          name: "apply_patch",
          arguments: {
            patches: [
              { path: "src/unrelated.ts", oldText: "a", newText: "b" },
            ],
          },
        },
      ],
      turnContent: "patching wrong file",
      mode: "enforce",
      brief: {
        mission: "Edit the auth service.",
        routeIntent: "Route=execute; effect=write",
        mustDo: [],
        mustNotDo: [],
        evidenceNeeded: [],
        verification: [],
        openRisks: [],
        authorityNote: "test",
      },
      understanding: {
        intent: {} as never,
        taskAnalysis: {
          scope: "single_location",
          complexity: "simple",
          risk: "low",
          clarity: "clear",
          targets: [
            { kind: "file", value: "src/auth/service.ts", explicit: true },
          ],
          constraints: [],
          requestedOutcomes: [],
          recommendsRepositoryDiscovery: false,
          recommendsPlanning: false,
          recommendsVerification: false,
          recommendsTaskClarification: false,
          taskSize: "small",
          planningHint: "none",
        },
      },
    });
    expect(decision.kind).toBe("revise");
    expect(decision.result.reasons.some((r) => /ask-scoped/i.test(r))).toBe(
      true,
    );
  });

  it("treats github/ and .github/ ask scopes as the same CI tree", () => {
    const decisionWithDot = writeDecision();
    decisionWithDot.toolGrant.pathScopes = [".github"];
    decisionWithDot.toolGrant.mutationPathScopes = [".github"];

    const pass = runV8MutationCritic({
      decision: decisionWithDot,
      toolCalls: [
        {
          id: "1",
          name: "apply_patch",
          arguments: {
            patches: [
              {
                path: ".github/workflows/ci.yml",
                oldText: "a",
                newText: "b",
              },
            ],
          },
        },
      ],
      turnContent: "add workflow",
      mode: "enforce",
      brief: {
        mission: "Add CI workflow.",
        routeIntent: "Route=execute; effect=write",
        mustDo: [],
        mustNotDo: [],
        evidenceNeeded: [],
        verification: [],
        openRisks: [],
        authorityNote: "test",
      },
      understanding: {
        intent: {
          classification: {
            primaryTaskIntent: "config",
            interactionIntent: "act",
          },
        } as never,
        taskAnalysis: {
          scope: "single_location",
          complexity: "simple",
          risk: "low",
          clarity: "clear",
          targets: [
            {
              kind: "file",
              value: "github/workflows/ci.yml",
              explicit: true,
            },
          ],
          constraints: [],
          requestedOutcomes: [],
          recommendsRepositoryDiscovery: false,
          recommendsPlanning: false,
          recommendsVerification: false,
          recommendsTaskClarification: false,
          taskSize: "small",
          planningHint: "none",
        },
      },
    });
    expect(pass.kind).toBe("pass");
    expect(pass.result.reasons).toEqual([]);
  });
});
