import type {
  AmbiguousSlotKind,
  ClarificationFactPatch,
} from "../../../modules/request-understanding";

export interface ClarificationOptionPayload {
  id: string;
  label: string;
  description?: string;
}

export interface ClarificationSessionOption {
  id: string;
  label: string;
  description?: string;
  patch: ClarificationFactPatch;
}

/**
 * Persisted on clarification suspend so resume can map option id → facts.
 */
export interface ClarificationSession {
  question: string;
  slotKind?: AmbiguousSlotKind | "intent";
  options: ClarificationSessionOption[];
}

export interface ClarificationPayload {
  clarificationPrompt: string;
  clarificationOptions: ClarificationOptionPayload[];
  clarificationSession?: ClarificationSession;
}
