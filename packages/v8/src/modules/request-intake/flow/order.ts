/** Single source of flow step order. Pipeline must follow this list. */
export const FLOW_ORDER = [
  "1-sanitize",
  "2-classify-command",
  "3-extract-mentions",
  "4-normalize-attachments",
  "5-resolve-mode",
  "6-build-envelope",
] as const;
export type FlowStepId = (typeof FLOW_ORDER)[number];
