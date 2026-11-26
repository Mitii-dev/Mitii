import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { RepoBuildState } from "../../../modules/verification";
import type { ToolLoopOutcome } from "./types";

export type VerificationRepairState = {
  currentOutcome: ToolLoopOutcome;
  decision: ExecutionDecision;
  afterState?: RepoBuildState;
  repairAttempts: number;
  previousAfterErrorCount?: number;
  consecutiveStalledRepairs: number;
};
