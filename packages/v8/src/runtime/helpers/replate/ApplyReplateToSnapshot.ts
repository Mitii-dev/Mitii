/**
 * Stamp replated decision into a hydrate snapshot without mutating the
 * frozen prior in place (S10-REPLATE).
 */

import type { StoreSnapshot } from "../store/StoreSnapshot";
import type { RuntimeDecisionSketch } from "../../flow/steps/5-Decide";
import {
  replateDecisionOnPlanApprove,
  type ReplateDecisionOnPlanApproveResult,
} from "./ReplateDecisionOnPlanApprove";
import type { PlanWriteTargetSource } from "./ExtractPlanWriteTargets";

export function applyReplateToSnapshot(input: {
  snapshot?: StoreSnapshot;
  plan?: PlanWriteTargetSource;
  taskList?: PlanWriteTargetSource;
  mcpServerIds?: readonly string[];
}): {
  snapshot?: StoreSnapshot;
  replate?: ReplateDecisionOnPlanApproveResult;
  reasonCodes: string[];
} {
  if (!input.snapshot) {
    return { reasonCodes: ["replate_skip_no_snapshot"] };
  }

  const prior = input.snapshot.slices.decision as
    | RuntimeDecisionSketch
    | undefined;
  if (!prior) {
    return {
      snapshot: input.snapshot,
      reasonCodes: ["replate_skip_no_prior_decision"],
    };
  }

  const plan =
    input.plan ??
    (input.snapshot.slices.planArtifact as PlanWriteTargetSource | undefined);
  const taskList =
    input.taskList ??
    (input.snapshot.slices.taskList as PlanWriteTargetSource | undefined);

  const replate = replateDecisionOnPlanApprove({
    priorDecision: prior,
    plan,
    taskList,
    mcpServerIds: input.mcpServerIds,
  });

  return {
    snapshot: {
      ...input.snapshot,
      slices: {
        ...input.snapshot.slices,
        decision: replate.decision,
        priorDecisionFrozen: replate.priorDecisionFrozen,
        replateMeta: {
          planWriteTargets: replate.planWriteTargets,
          at: new Date().toISOString(),
        },
      },
    },
    replate,
    reasonCodes: replate.reasonCodes,
  };
}
