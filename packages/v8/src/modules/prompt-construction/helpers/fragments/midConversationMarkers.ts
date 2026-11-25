/**
 * Canonical markers for mid-conversation context-epoch updates.
 *
 * Wire role is always `user` (not trailing `system`) so OpenAI-compatible
 * providers keep the leading system message as a stable cache prefix.
 * Engine admit and MidConversationUpdateFragment must share these markers.
 */

export const MID_CONVERSATION_UPDATE_MARKERS = {
  start: "<context_epoch_update>",
  end: "</context_epoch_update>",
} as const;

/** @deprecated Alias — prefer MID_CONVERSATION_UPDATE_MARKERS. */
export const MID_CONVERSATION_SYSTEM_MARKERS = MID_CONVERSATION_UPDATE_MARKERS;

/**
 * Wrap mid-conversation update body with stable markers.
 * Used by Prompt Construction fragments and engine context-epoch admit.
 */
export function wrapMidConversationUpdateText(text: string): string {
  const body = text.trim();
  return `${MID_CONVERSATION_UPDATE_MARKERS.start}\n${body}\n${MID_CONVERSATION_UPDATE_MARKERS.end}`;
}

/** @deprecated Alias — prefer wrapMidConversationUpdateText. */
export function wrapMidConversationSystemText(text: string): string {
  return wrapMidConversationUpdateText(text);
}
