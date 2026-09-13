import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { AmbiguousSlotKind } from "../../../modules/request-understanding/intent/schema";
import {
  parseClarificationOptionId,
  type ClarificationFactPatch,
} from "../../../modules/request-understanding/intent/applyClarificationFactPatch";
import {
  extractPrimaryUserMessage,
  MITII_HOST_CONTEXT_MARKER,
  MITII_USER_MESSAGE_MARKER,
} from "../../../modules/request-understanding/intent/extractPrimaryUserMessage";

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

/**
 * Build a short, UI-safe clarification question + options.
 * Never dump the full composed host prompt into the suspension.
 *
 * When ballotV2 is true, prefer situation ambiguousSlots from understanding.
 */
export function buildClarificationPayload(
  understanding: RequestUnderstandingResult,
  fallbackRationale?: string,
  options?: { ballotV2?: boolean },
): ClarificationPayload {
  const ballotV2 = options?.ballotV2 === true;

  if (ballotV2) {
    const fromSlots = buildFromAmbiguousSlots(understanding);
    if (fromSlots) {
      return fromSlots;
    }
  }

  const fromIntent = understanding.intent.clarification;
  if (fromIntent && fromIntent.options.length > 0) {
    const sessionOptions: ClarificationSessionOption[] = fromIntent.options.map(
      (option) => {
        const id = option.id || (option.intent ? `intent:${option.intent}` : option.label);
        const patch = parseClarificationOptionId(id, option.label);
        if (option.intent && !patch.primaryTaskIntent) {
          patch.primaryTaskIntent = option.intent;
        }
        return {
          id,
          label: option.label,
          description: option.description,
          patch,
        };
      },
    );
    return {
      clarificationPrompt: truncatePrompt(fromIntent.question),
      clarificationOptions: sessionOptions.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
      })),
      clarificationSession: {
        question: fromIntent.question,
        slotKind: fromIntent.slotKind ?? "intent",
        options: sessionOptions,
      },
    };
  }

  const alternatives = understanding.intent.classification.alternatives ?? [];
  if (alternatives.length > 0) {
    const sessionOptions: ClarificationSessionOption[] = alternatives
      .slice(0, 4)
      .map((alt) => {
        const id = `intent:${alt.intent}`;
        return {
          id,
          label: humanizeIntent(alt.intent),
          description: `Confidence ${(alt.confidence * 100).toFixed(0)}%`,
          patch: parseClarificationOptionId(id, humanizeIntent(alt.intent)),
        };
      });
    return {
      clarificationPrompt: truncatePrompt(
        fromIntent?.question ?? "What outcome do you want from this request?",
      ),
      clarificationOptions: sessionOptions.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
      })),
      clarificationSession: {
        question:
          fromIntent?.question ?? "What outcome do you want from this request?",
        slotKind: "intent",
        options: sessionOptions,
      },
    };
  }

  const unclearEvidence = understanding.taskAnalysis.signals
    .filter(
      (signal) =>
        signal.type === "clarity" &&
        (signal.value === "unclear" || signal.value === "partially_clear"),
    )
    .map((signal) => signal.evidence)
    .find((evidence) => evidence.trim().length > 0);

  const prompt =
    unclearEvidence?.trim() ||
    (fallbackRationale && !looksLikeTechnicalRationale(fallbackRationale)
      ? fallbackRationale
      : null) ||
    "I need a bit more detail before continuing. What should I do?";

  return {
    clarificationPrompt: truncatePrompt(prompt),
    clarificationOptions: [],
  };
}

function buildFromAmbiguousSlots(
  understanding: RequestUnderstandingResult,
): ClarificationPayload | undefined {
  // Prefer SuperIntent clarification when it already preferred a non-intent slot.
  if (
    understanding.intent.clarification?.slotKind &&
    understanding.intent.clarification.slotKind !== "intent" &&
    understanding.intent.clarification.options.length >= 2
  ) {
    const sessionOptions: ClarificationSessionOption[] =
      understanding.intent.clarification.options.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
        patch: parseClarificationOptionId(option.id, option.label),
      }));
    return {
      clarificationPrompt: truncatePrompt(
        understanding.intent.clarification.question,
      ),
      clarificationOptions: sessionOptions.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
      })),
      clarificationSession: {
        question: understanding.intent.clarification.question,
        slotKind: understanding.intent.clarification.slotKind,
        options: sessionOptions,
      },
    };
  }

  const slots =
    understanding.intent.classification.taskHints?.ambiguousSlots ?? [];
  const preferred = slots.find((s) => s.options.length >= 2);
  if (!preferred) {
    return undefined;
  }
  const sessionOptions: ClarificationSessionOption[] = preferred.options.map(
    (option) => ({
      id: option.id,
      label: option.label,
      description: option.description,
      patch: parseClarificationOptionId(option.id, option.label),
    }),
  );
  return {
    clarificationPrompt: truncatePrompt(preferred.question),
    clarificationOptions: sessionOptions.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description,
    })),
    clarificationSession: {
      question: preferred.question,
      slotKind: preferred.kind,
      options: sessionOptions,
    },
  };
}

/**
 * Resolve a clarification answer against a persisted session.
 * Returns a fact patch when the answer matches an option id or label.
 */
export function resolveClarificationAnswer(
  answer: string,
  session?: ClarificationSession,
): ClarificationFactPatch | undefined {
  const trimmed = answer.trim();
  if (!trimmed || !session || session.options.length === 0) {
    return trimmed.includes(":") ? parseClarificationOptionId(trimmed) : undefined;
  }
  const byId = session.options.find(
    (option) => option.id === trimmed || option.id.toLowerCase() === trimmed.toLowerCase(),
  );
  if (byId) return byId.patch;
  const byLabel = session.options.find(
    (option) => option.label.toLowerCase() === trimmed.toLowerCase(),
  );
  if (byLabel) return byLabel.patch;
  // Answer may already be a namespaced id without session match
  if (trimmed.includes(":")) {
    return parseClarificationOptionId(trimmed);
  }
  return undefined;
}

/**
 * Merge a clarification answer into the primary user ask while preserving
 * any host-context markers/blocks attached by adapters.
 */
export function amendMessageWithClarification(
  composedMessage: string,
  clarificationAnswer: string,
): string {
  const answer = clarificationAnswer.trim();
  if (!answer) return composedMessage;

  const primary = extractPrimaryUserMessage(composedMessage);
  const clarifiedPrimary = primary
    ? `${primary}\n\nClarification: ${answer}`
    : `Clarification: ${answer}`;

  const userIdx = composedMessage.indexOf(MITII_USER_MESSAGE_MARKER);
  if (userIdx >= 0) {
    const afterMarker = composedMessage.slice(
      userIdx + MITII_USER_MESSAGE_MARKER.length,
    );
    const hostIdx = afterMarker.indexOf(MITII_HOST_CONTEXT_MARKER);
    if (hostIdx >= 0) {
      const hostBlock = afterMarker.slice(hostIdx).trimStart();
      return `${MITII_USER_MESSAGE_MARKER}\n${clarifiedPrimary}\n\n${hostBlock}`;
    }
    return `${MITII_USER_MESSAGE_MARKER}\n${clarifiedPrimary}`;
  }

  return clarifiedPrimary;
}

function truncatePrompt(text: string, maxChars = 480): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars - 1)}…`;
}

function looksLikeTechnicalRationale(text: string): boolean {
  return /^mode=/.test(text.trim()) || /reasons=/.test(text);
}

function humanizeIntent(intent: string): string {
  return intent
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
