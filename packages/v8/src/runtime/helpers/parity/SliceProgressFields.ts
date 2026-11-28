/**
 * Slice / plan progress fields for RuntimeRunResult assembly.
 */

import type { TaskList } from "../../../modules/task-list";
import { buildSliceProgressHandoff } from "../task/BuildSliceProgressHandoff";

export function formatVerifyNote(input: {
  ranVerify?: boolean;
  runnerStatus?: string;
  reasonCodes?: readonly string[];
  agentEvidence?: string;
}): string | undefined {
  if (input.agentEvidence?.trim()) {
    return input.agentEvidence.trim();
  }
  if (!input.ranVerify) {
    return "Not required this turn";
  }
  switch (input.runnerStatus) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "unavailable":
      if (input.reasonCodes?.includes("verification_runner_inline")) {
        return "Finish-phase verify stub only — no checks executed";
      }
      if (input.reasonCodes?.includes("verification_runner_needs_input")) {
        return "Finish-phase verify lacked workspace pin/input";
      }
      return "Finish-phase verify unavailable — use a selective test command";
    case "blocked":
      return "Blocked";
    case "repair_requested":
    case "repair_capped":
      return `Needs repair (${input.runnerStatus})`;
    default:
      if (input.reasonCodes?.includes("verification_runner_inline")) {
        return "Finish-phase verify stub only — no checks executed";
      }
      return "Finish-phase verify ran without a clear result";
  }
}

/** True when the answer already embeds a next-slice / leftover handoff. */
export function answerAlreadyHasSliceHandoff(answer: string): boolean {
  return (
    /want me to start the next slice/i.test(answer) ||
    /related work may still be open/i.test(answer) ||
    /implementation of \*\*/i.test(answer) ||
    /next we still have \*\*/i.test(answer) ||
    /\|\s*\*\*Next\*\*\s*\|/i.test(answer)
  );
}

export function sliceProgressFields(
  store: {
    getSlice: <T>(key: string) => T | undefined;
  },
  options?: {
    appendLeftover?: boolean;
    advancedThisTurnIds?: readonly string[];
    changedFiles?: readonly string[];
    verifyNote?: string;
  },
) {
  const planArtifact = store.getSlice<Record<string, unknown>>("planArtifact");
  const taskList = store.getSlice<TaskList>("taskList");
  const completedPlanStepIds = store.getSlice<string[]>("completedPlanStepIds");
  const nextPlanPhaseOffer = store.getSlice<string>("nextPlanPhaseOffer");
  const handoff = buildSliceProgressHandoff({
    ...(planArtifact ? { plan: planArtifact } : {}),
    ...(taskList ? { taskList } : {}),
    ...(completedPlanStepIds ? { completedPlanStepIds } : {}),
    ...(typeof nextPlanPhaseOffer === "string"
      ? { nextPlanPhaseOffer }
      : {}),
    appendLeftover: options?.appendLeftover === true,
    ...(options?.advancedThisTurnIds?.length
      ? { advancedThisTurnIds: options.advancedThisTurnIds }
      : {}),
    ...(options?.changedFiles?.length
      ? { changedFiles: options.changedFiles }
      : {}),
    ...(options?.verifyNote ? { verifyNote: options.verifyNote } : {}),
  });
  return {
    ...(planArtifact ? { plan: planArtifact } : {}),
    ...(taskList ? { taskList } : {}),
    ...handoff,
  };
}

export function mergeAnswerWithLeftover(
  trimmed: string | undefined,
  leftover: string | undefined,
): string | undefined {
  if (leftover && trimmed) {
    return answerAlreadyHasSliceHandoff(trimmed)
      ? trimmed
      : `${trimmed}\n\n${leftover}`;
  }
  if (leftover && !trimmed) return leftover;
  return trimmed;
}
