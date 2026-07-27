import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
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

export interface ClarificationPayload {
  clarificationPrompt: string;
  clarificationOptions: ClarificationOptionPayload[];
}

/**
 * Build a short, UI-safe clarification question + options.
 * Never dump the full composed host prompt into the suspension.
 */
export function buildClarificationPayload(
  understanding: RequestUnderstandingResult,
  fallbackRationale?: string,
): ClarificationPayload {
  const fromIntent = understanding.intent.clarification;
  if (fromIntent && fromIntent.options.length > 0) {
    return {
      clarificationPrompt: truncatePrompt(fromIntent.question),
      clarificationOptions: fromIntent.options.map((option) => ({
        id: option.intent,
        label: option.label,
        description: option.description,
      })),
    };
  }

  const alternatives = understanding.intent.classification.alternatives ?? [];
  if (alternatives.length > 0) {
    return {
      clarificationPrompt: truncatePrompt(
        fromIntent?.question ?? "What outcome do you want from this request?",
      ),
      clarificationOptions: alternatives.slice(0, 4).map((alt) => ({
        id: alt.intent,
        label: humanizeIntent(alt.intent),
        description: `Confidence ${(alt.confidence * 100).toFixed(0)}%`,
      })),
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
