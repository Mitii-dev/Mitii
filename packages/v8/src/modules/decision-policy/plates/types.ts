import type { GrantProfile } from "../helpers/SelectGrantProfile";
import type { ExecutionRoute } from "../contracts";
import type { PlanningDepth, PlanGate } from "../contracts";

/**
 * One decision plate — route/grant/plan knobs (§5.12).
 * Canonical answer route; legacy direct/repository aliases still parse.
 */
export interface DecisionPlate {
  id: string;
  route: ExecutionRoute;
  grantProfile: GrantProfile;
  planningDepth: PlanningDepth;
  planGate: PlanGate;
  reasonCodes: string[];
}
