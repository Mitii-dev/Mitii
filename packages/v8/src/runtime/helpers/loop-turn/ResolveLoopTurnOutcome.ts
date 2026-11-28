import { AGENT_ENGINE_THRESHOLDS } from "../../../engine/v8-engine/legacy/policy";
import { shouldRecoverIncompleteAssistantTurn } from "./IsIncompleteAssistantTurn";
import {
  isUnfulfilledExecute,
  needsWorkspaceGroundingRecovery,
  recoverOrExhaustUnfulfilled,
} from "./UnfulfilledExecute";
import type {
  ResolveLoopTurnOutcome,
  ResolveLoopTurnOutcomeInput,
} from "./LoopTurnTypes";

export type {
  LoopTurnDisposition,
  ResolveLoopTurnOutcome,
  ResolveLoopTurnOutcomeInput,
} from "./LoopTurnTypes";
export { LOOP_TURN_DISPOSITIONS } from "./LoopTurnTypes";

export function resolveLoopTurnOutcome(
  input: ResolveLoopTurnOutcomeInput,
): ResolveLoopTurnOutcome {
  if (input.toolCallCount > 0) {
    return {
      disposition: "execute_tools",
      reasonCode: "tools_executed",
    };
  }

  const unfulfilled = isUnfulfilledExecute(input);
  const truncated = input.truncated || input.finishReason === "length";

  if (truncated) {
    if (unfulfilled) {
      return recoverOrExhaustUnfulfilled(input, "output_truncated");
    }
    // Workspace already changed — finish rather than another continuation turn
    // that can burn the remaining harness wall clock (benchmark exit 124).
    if (input.changedFileCount > 0) {
      return {
        disposition: "complete_answer",
        reasonCode: "output_truncation_finish_after_mutation",
      };
    }
    if (input.content.trim().length > 0) {
      return {
        disposition: "recover_truncated_text",
        reasonCode: "output_truncated",
      };
    }
  }

  if (unfulfilled) {
    return recoverOrExhaustUnfulfilled(input);
  }

  if (needsWorkspaceGroundingRecovery(input)) {
    const maxIncomplete =
      input.thresholds?.maxIncompleteAnswerRecoveries ??
      AGENT_ENGINE_THRESHOLDS.maxIncompleteAnswerRecoveries;
    if (input.recoveries.incompleteAnswer < maxIncomplete) {
      return {
        disposition: "recover_incomplete_narration",
        reasonCode: "incomplete_answer_recovered",
        recoveryMessage:
          "You claimed the workspace/files were unavailable, but this is a repository question. Call read_file, search_files, or glob_files now and answer from the file contents. Do not guess.",
      };
    }
  }

  const incomplete = shouldRecoverIncompleteAssistantTurn({
    content: input.content,
    toolCallCount: 0,
    changedFileCount: input.changedFileCount,
    fileReadCalls: input.fileReadCalls,
  });
  if (incomplete) {
    const maxIncomplete =
      input.thresholds?.maxIncompleteAnswerRecoveries ??
      AGENT_ENGINE_THRESHOLDS.maxIncompleteAnswerRecoveries;
    if (input.recoveries.incompleteAnswer < maxIncomplete) {
      return {
        disposition: "recover_incomplete_narration",
        reasonCode: "incomplete_answer_recovered",
      };
    }
    return {
      disposition: "complete_answer",
      reasonCode: "incomplete_answer_fallback",
    };
  }

  return {
    disposition: "complete_answer",
    reasonCode: "answer_produced",
  };
}

