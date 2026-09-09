import type { ModelMessage } from "../../../modules/model-gateway";
import { WORKING_SET_MARKER } from "../../../modules/task-list";

import type { RecoverabilityWorkingSetInput } from "../actions/serializeRecoverabilityWorkingSet";
import { serializeRecoverabilityWorkingSet } from "../actions/serializeRecoverabilityWorkingSet";

/**
 * Keep a live recoverability block at the end of the loop transcript so
 * compaction can drop it and the next turn can restore it without rewriting
 * the system prefix.
 *
 * Always upserts a working set for execute/repair loops — never leave the
 * model without live checklist / mutation / observation state.
 */
export function upsertTrailingWorkingSet(
  messages: ModelMessage[],
  input?: RecoverabilityWorkingSetInput,
): void {
  const content =
    serializeRecoverabilityWorkingSet(input ?? {}) ??
    serializeMinimalWorkingSet();
  const existing = messages.findIndex(
    (message) =>
      message.role === "user" && message.content.includes(WORKING_SET_MARKER),
  );
  const next: ModelMessage = { role: "user", content };
  if (existing >= 0) {
    messages.splice(existing, 1);
  }
  messages.push(next);
}

function serializeMinimalWorkingSet(): string {
  return [
    WORKING_SET_MARKER,
    "Live execution state for this turn. Prefer this over dropped tool history.",
    "",
    "## Checklist",
    "No live checklist yet. If this is a multi-step run, after the first read/diagnose tool turn call update_todos with type=replace. Each title must name a concrete file, failure, or user-visible behavior.",
    "</working_set>",
  ].join("\n");
}
