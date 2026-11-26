/**
 * Compat shim — logic lives in runtime gates hub (P1 evacuate).
 * Prefer importing from `@mitii/v8` runtime helpers going forward.
 */
export {
  shouldSuspendForPlanScopeFork,
  shouldForceCampaignPhaseLock,
} from "../../../../runtime/helpers/gates/predicates/RequireClarificationAfterPlan";
