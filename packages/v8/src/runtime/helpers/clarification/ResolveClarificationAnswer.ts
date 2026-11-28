import {
  extractPrimaryUserMessage,
  MITII_HOST_CONTEXT_MARKER,
  MITII_USER_MESSAGE_MARKER,
  parseClarificationOptionId,
} from "../../../modules/request-understanding";
import type { ClarificationFactPatch } from "../../../modules/request-understanding";
import type { ClarificationSession } from "./ClarificationTypes";

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
