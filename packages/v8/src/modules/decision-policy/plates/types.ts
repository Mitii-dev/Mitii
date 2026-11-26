import type { GrantProfile } from "../helpers/SelectGrantProfile";
import type { ExecutionRoute } from "../contracts";
import type { PlanningDepth, PlanGate } from "../contracts";

/**
 * One decision plate — route/grant/plan knobs (§5.12).
 * Live ExecutionRoute may still use direct_answer/repository_answer until answer merge.
 */
export interface DecisionPlate {
  id: string;
  route: ExecutionRoute | "answer";
  grantProfile: GrantProfile;
  planningDepth: PlanningDepth;
  planGate: PlanGate;
  reasonCodes: string[];
}
