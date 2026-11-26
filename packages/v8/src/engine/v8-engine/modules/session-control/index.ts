/**
 * Shim — owner is runtime/helpers/session-control.
 * Injects engine `compactModelLoopMessages` for `/compact`.
 */
export {
  SESSION_CONTROL_HELP_TEXT,
  SESSION_CONTROL_MIN_MESSAGES_TO_KEEP,
} from "../../../../runtime/helpers/session-control";
export type {
  SessionControlCommand,
  SessionControlCompactStats,
  SessionControlResult,
  ForceCompactConversationResult,
  CompactModelLoopMessagesPort,
} from "../../../../runtime/helpers/session-control";

export { forceCompactConversation } from "./forceCompactConversation";
export { handleMetaCommand } from "./handleMetaCommand";
export type { HandleMetaCommandInput } from "./handleMetaCommand";
