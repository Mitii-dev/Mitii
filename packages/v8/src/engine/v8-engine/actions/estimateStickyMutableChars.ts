import type { ModelMessage } from "../../../modules/model-gateway";
import { WORKING_SET_MARKER } from "../../../modules/task-list";

export interface StickyMutableCharEstimate {
  stickyChars: number;
  mutableChars: number;
  totalChars: number;
  workingSetChars: number;
  messageCount: number;
}

/**
 * Approximate sticky (prefix-stable) vs mutable (suffix / rewritten) payload
 * sizes for telemetry. Working-set and trailing recovery user messages count
 * as mutable; earlier transcript counts as sticky.
 */
export function estimateStickyMutableChars(
  messages: readonly ModelMessage[],
): StickyMutableCharEstimate {
  let stickyChars = 0;
  let mutableChars = 0;
  let workingSetChars = 0;

  let lastWorkingSetIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (
      message.role === "user" &&
      messageContent(message).includes(WORKING_SET_MARKER)
    ) {
      lastWorkingSetIndex = index;
    }
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    const chars = messageContent(message).length;
    const isWorkingSet =
      message.role === "user" &&
      messageContent(message).includes(WORKING_SET_MARKER);
    if (isWorkingSet) {
      workingSetChars += chars;
      mutableChars += chars;
      continue;
    }
    // Trailing user recovery / repair prompts after the live working set.
    if (
      lastWorkingSetIndex >= 0 &&
      index > lastWorkingSetIndex &&
      message.role === "user"
    ) {
      mutableChars += chars;
      continue;
    }
    stickyChars += chars;
  }

  return {
    stickyChars,
    mutableChars,
    totalChars: stickyChars + mutableChars,
    workingSetChars,
    messageCount: messages.length,
  };
}

function messageContent(message: ModelMessage): string {
  return typeof message.content === "string" ? message.content : "";
}
