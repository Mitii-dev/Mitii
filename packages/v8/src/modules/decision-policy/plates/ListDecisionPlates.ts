import { clarifyPlate } from "./routes/clarify";
import { answerResearchPlate } from "./routes/answer";
import { diagnosePlate } from "./routes/diagnose";
import { planVisiblePlate } from "./routes/plan";
import {
  executeFastPathPlate,
  executeMutatePlate,
  executeVisiblePlate,
} from "./routes/execute";
import { askModeSeal } from "./modes/ask";
import { planModeSeal } from "./modes/plan";
import { agentModeDefault } from "./modes/agent";
import { databaseModeSeal } from "./modes/database";
import { antiNagClarifyClamp } from "./clamps/anti_nag_clarify";
import { injectionClamp } from "./clamps/injection_clamp";
import { userSafetyIntersectClamp } from "./clamps/user_safety_intersect";
import { unlockRunCommandUpgrade } from "./upgrades/unlock_run_command";
import { expandWritePathsUpgrade } from "./upgrades/expand_write_paths";
import { promoteDiagnoseToExecuteUpgrade } from "./upgrades/promote_diagnose_to_execute";
import { unlockNetworkUpgrade } from "./upgrades/unlock_network";
import type { DecisionPlate } from "./types";

/** Route plates used by selectDecisionPlate. */
export const ROUTE_DECISION_PLATES: readonly DecisionPlate[] = [
  clarifyPlate,
  answerResearchPlate,
  diagnosePlate,
  planVisiblePlate,
  executeFastPathPlate,
  executeMutatePlate,
  executeVisiblePlate,
];

export function listDecisionPlates(): readonly DecisionPlate[] {
  return ROUTE_DECISION_PLATES;
}

/** Registry surface for clamps / mode seals / upgrades (S2C). */
export const DECISION_PLATE_REGISTRY = {
  routes: ROUTE_DECISION_PLATES,
  modes: [askModeSeal, planModeSeal, agentModeDefault, databaseModeSeal],
  clamps: [antiNagClarifyClamp, injectionClamp, userSafetyIntersectClamp],
  upgrades: [
    unlockRunCommandUpgrade,
    expandWritePathsUpgrade,
    promoteDiagnoseToExecuteUpgrade,
    unlockNetworkUpgrade,
  ],
} as const;
