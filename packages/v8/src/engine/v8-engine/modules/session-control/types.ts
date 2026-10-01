import type { ModelMessage } from "../../../../modules/model-gateway";
import type { MetaCommandLifecycle } from "../../../../modules/request-intake";

export type SessionControlCommand =
  | "stop"
  | "new"
  | "clear"
  | "compact"
  | "help"
  | "status"
  | "resume";

export interface SessionControlCompactStats {
  beforeMessages: number;
  afterMessages: number;
  omittedTokens: number;
  pressure: string;
  stagesApplied: readonly string[];
}

/**
 * Structured outcome of an intake meta command.
 * Hosts should persist `compactedConversation` when present.
 */
export interface SessionControlResult {
  command: SessionControlCommand | string;
  lifecycle: MetaCommandLifecycle;
  /** User-facing summary. */
  answer: string;
  /** Terminal run status suggested for the engine. */
  status: "completed" | "cancelled";
  reasonCodes: readonly string[];
  warnings: readonly string[];
  error?: { code: string; message: string };
  /** Compacted host conversation for `/compact` — replace session transcript. */
  compactedConversation?: readonly ModelMessage[];
  compactStats?: SessionControlCompactStats;
  /** Hint for hosts clearing chat UI / session storage. */
  sessionAction?: "new" | "clear";
}
