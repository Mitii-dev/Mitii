import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import { parseClarificationOptionId } from "../../../modules/request-understanding";
import type {
  ClarificationOptionPayload,
  ClarificationPayload,
  ClarificationSessionOption,
} from "./ClarificationTypes";

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
      clarificationOptions: toUiOptions(sessionOptions),
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
      clarificationOptions: toUiOptions(sessionOptions),
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

/**
 * UI / AgentRunResult require description to be absent or non-empty.
 * Never emit "" — zod `.min(1).optional()` rejects empty strings.
 */
function toUiOptions(
  options: readonly ClarificationSessionOption[],
): ClarificationOptionPayload[] {
  return options.map((option) => {
    const description = option.description?.trim();
    return {
      id: option.id,
      label: option.label,
      ...(description ? { description } : {}),
    };
  });
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
      clarificationOptions: toUiOptions(sessionOptions),
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
    clarificationOptions: toUiOptions(sessionOptions),
    clarificationSession: {
      question: preferred.question,
      slotKind: preferred.kind,
      options: sessionOptions,
    },
  };
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
