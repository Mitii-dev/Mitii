/**
 * Public facade for ToolAdversaryPort (Phase 3 restrict-only fence).
 * Architecture boundary: do not import internal/adversary from package roots.
 */
export {
  ADVERSARY_HIGH_RISK_TOOL_IDS,
  isAdversaryHighRiskTool,
} from "./internal/adversary/ToolAdversaryPort";
export type {
  AdversaryDecision,
  AdversaryEvaluateInput,
  AdversaryEvaluateResult,
  AdversaryFailMode,
  ToolAdversaryPort,
} from "./internal/adversary/ToolAdversaryPort";
