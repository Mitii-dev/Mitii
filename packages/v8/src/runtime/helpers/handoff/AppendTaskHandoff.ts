/**
 * Append a handoff note into RunState history (newest last). Cap length.
 */

import type { TaskHandoffNote } from "../../contracts/handoff/TaskHandoffNote";

export const MAX_STORED_HANDOFFS = 24;

export function appendTaskHandoff(
  history: readonly TaskHandoffNote[] | undefined,
  note: TaskHandoffNote,
): TaskHandoffNote[] {
  return [...(history ?? []), note].slice(-MAX_STORED_HANDOFFS);
}
