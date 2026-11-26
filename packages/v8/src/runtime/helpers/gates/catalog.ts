import type { GatePhase } from "./constants";
import type { GatePredicate } from "./types";
import { requireAuthOrDependency } from "./predicates/RequireAuthOrDependency";
import { requireCheckpointConflict } from "./predicates/RequireCheckpointConflict";
import { requireClarificationAfterDecide } from "./predicates/RequireClarificationAfterDecide";
import { requireClarificationAfterPlan } from "./predicates/RequireClarificationAfterPlan";
import { requireContinueAfterVerifyCapped } from "./predicates/RequireContinueAfterVerifyCapped";
import { requireContinueOnBudgetOrStall } from "./predicates/RequireContinueOnBudgetOrStall";
import { requireContinueOnProvider } from "./predicates/RequireContinueOnProvider";
import { requireExternalSideEffectApproval } from "./predicates/RequireExternalSideEffectApproval";
import { requireGrantExpansion } from "./predicates/RequireGrantExpansion";
import { requireMutationApproval } from "./predicates/RequireMutationApproval";
import { requirePlanApproval } from "./predicates/RequirePlanApproval";
import { completePlanMode } from "./predicates/CompletePlanMode";

/** Phase → ordered predicates (first hit wins). Data + wiring only. */
export function predicatesForPhase(
  phase: GatePhase,
  options?: { enableExtendedGates?: boolean },
): readonly GatePredicate[] {
  const extended = options?.enableExtendedGates === true;

  switch (phase) {
    case "on_resume":
      // Always registered; predicate no-ops unless ctx.checkpointConflict.
      return [requireCheckpointConflict];
    case "after_decide":
      return [requireClarificationAfterDecide];
    case "after_plan":
      return [
        requireClarificationAfterPlan,
        requirePlanApproval,
        completePlanMode,
      ];
    case "after_tool": {
      const list: GatePredicate[] = [requireGrantExpansion];
      if (extended) {
        list.push(requireExternalSideEffectApproval);
      }
      list.push(requireMutationApproval);
      return list;
    }
    case "mid_loop":
      return extended ? [requireAuthOrDependency] : [];
    case "on_budget":
      return [requireContinueOnProvider, requireContinueOnBudgetOrStall];
    case "after_verify":
      return [requireContinueAfterVerifyCapped];
    default:
      return [];
  }
}
