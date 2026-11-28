/**
 * Canonical pump order (§17). Route bodies choose which stages run;
 * they do not add parallel top-level engines.
 */
export const RUNTIME_FLOW_STEP_IDS = [
  "1-window-policy",
  "2-orient-situation",
  "3-assess-direction",
  "4-ephemeral-peeks",
  "5-decide",
  "6-gates-after-decide",
  "7-plan-pipeline",
  "8-gates-after-plan",
  "9-enrich-context",
  "10-turn-loop",
  "11-verify-finish",
] as const;

export type RuntimeFlowStepId = (typeof RUNTIME_FLOW_STEP_IDS)[number];

export function isRuntimeFlowStepId(value: string): value is RuntimeFlowStepId {
  return (RUNTIME_FLOW_STEP_IDS as readonly string[]).includes(value);
}
