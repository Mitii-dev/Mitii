import type { AgentMode, UserRequestOrigin } from "../../../request-intake";
import type {
  ApprovalMode,
  DecisionPolicyInput,
  ExecutionRoute,
  PlanningDepth,
  PlanGate,
} from "../../contracts";
import type { RequestUnderstandingResult } from "../../../request-understanding";

export type DecisionCaseCategory =
  | "baseline"
  | "route"
  | "clarify"
  | "plan"
  | "grant"
  | "mode"
  | "risk"
  | "adversarial"
  | "budget"
  | "verification"
  | "benchmark"
  | "network"
  | "origin"
  | "state"
  | "matrix";

export interface DecisionExpectation {
  route: ExecutionRoute;
  runDisposition?: "continue" | "clarification_required";
  planningDepth?: PlanningDepth;
  planGate?: PlanGate;
  maximumWorkspaceEffect?: "none" | "read" | "write";
  approvalMode?: ApprovalMode;
  pathScopes?: string[];
  mutationPathScopes?: string[];
  allowedToolsIncludes?: string[];
  allowedToolsExcludes?: string[];
  reasonCodesIncludes?: string[];
  reasonCodesExcludes?: string[];
  warningsIncludes?: string[];
  verificationRequired?: boolean;
  verificationEvidenceIncludes?: string[];
  forbidVisiblePlan?: boolean;
}

export interface GoldenDecisionCase {
  id: string;
  category: DecisionCaseCategory;
  mode: AgentMode;
  message: string;
  origin?: UserRequestOrigin;
  understanding: RequestUnderstandingResult;
  repositoryState?: DecisionPolicyInput["repositoryState"];
  approvalMode?: ApprovalMode;
  planApproval?: DecisionPolicyInput["planApproval"];
  hostCapabilities?: DecisionPolicyInput["hostCapabilities"];
  windowPolicy?: DecisionPolicyInput["windowPolicy"];
  expected: DecisionExpectation;
  /**
   * When set, runs narrow() or widen() after decide() with these params.
   * Use for grant adjustment tests — not part of initial decide().
   */
  adjustment?: {
    kind: "narrow" | "widen";
    discoveredPaths?: string[];
    extraPaths?: string[];
    residualRisk?: "low" | "medium" | "high" | "critical";
  };
}
