import { describe, expect, it } from "vitest";

import type { RuntimeDecisionSketch } from "../../flow/steps/5-Decide";
import { selectRouteBody } from "../../helpers/routes";
import {
  applyReplateToSnapshot,
  extractPlanWriteTargets,
  intersectScopesWithPlanTargets,
  replateDecisionOnPlanApprove,
} from "../../helpers/replate";
import type { StoreSnapshot } from "../../helpers/store/StoreSnapshot";

function priorDecision(
  overrides?: Partial<RuntimeDecisionSketch>,
): RuntimeDecisionSketch {
  return {
    plateId: "plan-visible",
    route: "plan",
    grantProfile: "research",
    planningDepth: "visible",
    planGate: "required_before_execute",
    runDisposition: "continue",
    routeBody: selectRouteBody({
      route: "plan",
      planningDepth: "visible",
      planGate: "required_before_execute",
    }),
    pathScopes: ["."],
    mutationPathScopes: ["packages/demo", "packages/other"],
    toolGrant: {
      maximumWorkspaceEffect: "read",
      allowedTools: [],
      allowedEffects: [],
      pathScopes: ["."],
      approvalMode: "never",
      limits: {
        maxToolCalls: 10,
        maxFileReads: 50,
        maxFileWrites: 0,
        maxNetworkCalls: 0,
      },
    } as never,
    verification: {
      required: false,
      minimumEvidence: [],
      allowUnavailable: true,
    },
    repositoryContextRequired: true,
    rationale: "prior",
    reasonCodes: ["prior_plan"],
    ...overrides,
  };
}

describe("S10-REPLATE", () => {
  it("extractPlanWriteTargets from plan phases", () => {
    const targets = extractPlanWriteTargets({
      phases: [
        {
          id: "change",
          steps: [
            { targetRefs: ["src/a.ts", "src/b.ts"] },
            { targetRefs: ["src/a.ts"] },
          ],
        },
      ],
    });
    expect(targets).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("intersectScopesWithPlanTargets never widens past plan", () => {
    // Prior fence wider than plan → keep plan path (tighter).
    expect(
      intersectScopesWithPlanTargets(
        ["packages/demo", "packages/evil"],
        ["packages/demo/src"],
      ),
    ).toEqual(["packages/demo/src"]);
    // No prior fence → plan targets.
    expect(
      intersectScopesWithPlanTargets([], ["src/a.ts"]),
    ).toEqual(["src/a.ts"]);
    // Prior tighter under plan → keep prior.
    expect(
      intersectScopesWithPlanTargets(
        ["packages/demo/src/x.ts"],
        ["packages/demo"],
      ),
    ).toEqual(["packages/demo/src/x.ts"]);
  });

  it("replateDecisionOnPlanApprove mints execute without mutating prior", () => {
    const prior = priorDecision();
    const frozenCopy = structuredClone(prior);
    const result = replateDecisionOnPlanApprove({
      priorDecision: prior,
      plan: {
        phases: [
          {
            id: "change",
            steps: [{ targetRefs: ["packages/demo/src/x.ts"] }],
          },
        ],
      },
    });

    expect(prior).toEqual(frozenCopy);
    expect(result.decision.route).toBe("execute");
    expect(result.decision.grantProfile).toBe("agent_execute");
    expect(result.decision.planGate).toBe("none");
    expect(result.decision.planningDepth).toBe("none");
    expect(result.decision.mutationPathScopes).toEqual([
      "packages/demo/src/x.ts",
    ]);
    expect(result.decision.reasonCodes).toContain("replate_on_plan_approve");
    expect(result.decision.reasonCodes).toContain(
      "replate_scopes_subseteq_plan",
    );
    expect(result.priorDecisionFrozen.route).toBe("plan");
  });

  it("applyReplateToSnapshot stamps decision + freezes prior", () => {
    const snapshot: StoreSnapshot = {
      schemaVersion: 1,
      runId: "r1",
      cancelling: false,
      capturedAt: "2026-01-01T00:00:00.000Z",
      slices: {
        decision: priorDecision(),
        planArtifact: {
          phases: [
            {
              id: "change",
              steps: [{ targetRefs: ["apps/web/a.ts"] }],
            },
          ],
        },
      },
    };

    const applied = applyReplateToSnapshot({ snapshot });
    expect(applied.replate?.decision.route).toBe("execute");
    expect(
      (applied.snapshot?.slices.priorDecisionFrozen as RuntimeDecisionSketch)
        .route,
    ).toBe("plan");
    expect(applied.snapshot?.slices.replateMeta).toBeDefined();
    expect(
      (applied.snapshot?.slices.decision as RuntimeDecisionSketch)
        .mutationPathScopes,
    ).toEqual(["apps/web/a.ts"]);
  });
});
