/**
 * Briefcase packing: active task + previous handoff + plan objective (S13.1/13.4).
 * Truncates doneSummary for the model; full note stays in RunState.
 */

import type { TaskHandoffNote } from "../../contracts/handoff/TaskHandoffNote";
import type { TaskList } from "../../../modules/task-list";
import { sanitizeHandoffText } from "./SanitizeHandoffText";

export interface SelectBriefcaseHandoffPeaksInput {
  taskList?: TaskList;
  /** Newest-last handoff history in RunState. */
  handoffs?: readonly TaskHandoffNote[];
  planObjective?: string;
  /** Truncation for Briefcase (full note stays stored). */
  summaryMaxChars?: number;
}

export interface BriefcaseHandoffPeaks {
  activeTaskId?: string;
  activeTaskTitle?: string;
  previousHandoffSummary?: string;
  previousFromTaskId?: string;
  planObjective?: string;
  nextMustRead: string[];
  reasonCodes: string[];
}

export function selectBriefcaseHandoffPeaks(
  input: SelectBriefcaseHandoffPeaksInput,
): BriefcaseHandoffPeaks {
  const max = input.summaryMaxChars ?? 160;
  const active = input.taskList?.items.find((i) => i.status === "active");
  const previous =
    input.handoffs && input.handoffs.length > 0
      ? input.handoffs[input.handoffs.length - 1]
      : undefined;

  const planObjective = input.planObjective
    ? sanitizeHandoffText(input.planObjective, 240)
    : undefined;

  const codes = ["briefcase_handoff_peaks"];
  if (active) codes.push("briefcase_active_task");
  if (previous) codes.push("briefcase_previous_handoff");
  if (planObjective) codes.push("briefcase_plan_objective");

  return {
    ...(active
      ? { activeTaskId: active.id, activeTaskTitle: active.title }
      : {}),
    ...(previous
      ? {
          previousHandoffSummary: sanitizeHandoffText(
            previous.doneSummary,
            max,
          ),
          previousFromTaskId: previous.fromTaskId,
        }
      : {}),
    ...(planObjective ? { planObjective } : {}),
    nextMustRead: [
      ...(previous?.nextMustRead ?? []),
      ...(active?.mustRead ?? []),
    ].slice(0, 8),
    reasonCodes: codes,
  };
}
