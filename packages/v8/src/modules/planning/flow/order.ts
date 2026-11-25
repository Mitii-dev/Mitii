/** Single source of flow step order for plan(). Pipeline must follow this list. */
export const FLOW_ORDER = [
  "1-resolve-strategy",
  "2-draft-skeleton",
  "3-apply-discovery-draft",
  "4-enforce-discovery-quality",
  "5-draft-clarify",
  "6-validate-plan",
  "7-apply-working-sets",
  "8-compact-plan",
  "9-finalize-result",
] as const;

export type FlowStepId = (typeof FLOW_ORDER)[number];
