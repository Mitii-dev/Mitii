import type { AgentMode } from "../../../request-intake";
import type {
  DecisionPolicyInput,
  ExecutionRoute,
  PlanningDepth,
} from "../../contracts";
import type { RequestUnderstandingResult } from "../../../request-understanding";

export interface DecisionCaseFixture {
  id: string;
  category:
    | "build_failure"
    | "localized_bug"
    | "feature"
    | "diagnosis"
    | "review"
    | "refactor"
    | "docs"
    | "git"
    | "architecture"
    | "ambiguous"
    | "plan_only"
    | "risky"
    | "adversarial";
  mode: AgentMode;
  message: string;
  understanding: RequestUnderstandingResult;
  repositoryState?: DecisionPolicyInput["repositoryState"];
  expected: {
    route: ExecutionRoute;
    planningDepth?: PlanningDepth;
    /** When set, maximumWorkspaceEffect must equal this. */
    maximumWorkspaceEffect?: "none" | "read" | "write";
    runDisposition?: "continue" | "clarification_required";
    /** Simple-task gate: visible plan must not appear. */
    forbidVisiblePlan?: boolean;
  };
}
