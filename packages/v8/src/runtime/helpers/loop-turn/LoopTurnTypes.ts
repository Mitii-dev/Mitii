import type {
  ExecutionRoute,
  MutationBudget,
  ToolGrant,
} from "../../../modules/decision-policy";
import type { AgentReasonCode } from "../../../engine/v8-engine/contracts";
import type { AgentEngineThresholds } from "../../../engine/v8-engine/actions/resolveAgentEngineThresholds";

export const LOOP_TURN_DISPOSITIONS = [
  "execute_tools",
  "complete_answer",
  "recover_unfulfilled_execute",
  "recover_incomplete_narration",
  "recover_truncated_tools",
  "recover_truncated_text",
] as const;

export type LoopTurnDisposition = (typeof LOOP_TURN_DISPOSITIONS)[number];

export interface ResolveLoopTurnOutcomeInput {
  route: ExecutionRoute;
  maximumWorkspaceEffect: ToolGrant["maximumWorkspaceEffect"];
  primaryTaskIntent: string;
  toolCallCount: number;
  changedFileCount: number;
  content: string;
  finishReason?: string;
  truncated: boolean;
  mutationBudget?: MutationBudget;
  /** Optional grant/decision reason codes (e.g. mutation_execute). */
  reasonCodes?: readonly string[];
  /** Grant tool ids — used to skip apply_patch chase when file edits are denied. */
  allowedTools?: readonly string[];
  /** Cumulative file reads this run — used for repository_answer grounding. */
  fileReadCalls?: number;
  recoveries: {
    truncation: number;
    incompleteAnswer: number;
    unfulfilledExecute: number;
  };
  thresholds?: Pick<
    AgentEngineThresholds,
    "maxIncompleteAnswerRecoveries" | "maxUnfulfilledExecuteRecoveries"
  >;
}

export interface ResolveLoopTurnOutcome {
  disposition: LoopTurnDisposition;
  reasonCode: AgentReasonCode;
  recoveryMessage?: string;
}

/**
 * Decide whether a text-only (or truncated) model turn may complete the loop.
 * Execute + write + mutation intent with zero files changed is not success.
 */
