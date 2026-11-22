import type { ModelMessage } from "../../../modules/model-gateway";
import type { TokenEstimatorPort } from "../../../modules/prompt-construction";

import { estimateModelMessagesTokens } from "./compactionTokenEstimate";

export function insertAfterSystemMessages(
  messages: readonly ModelMessage[],
  insert: ModelMessage,
): ModelMessage[] {
  let insertAt = 0;
  while (insertAt < messages.length && messages[insertAt]?.role === "system") {
    insertAt += 1;
  }
  return [
    ...messages.slice(0, insertAt),
    insert,
    ...messages.slice(insertAt),
  ];
}

export const MEMORY_REINJECT_MARKER = "[memory reinjected after compaction]";
export const ESTABLISHED_FACTS_MARKER =
  "[established observations after compaction]";

export function reinjectPinnedFacts(params: {
  messages: ModelMessage[];
  facts: readonly { id: string; content: string }[];
  marker: string;
  maxChars: number;
  estimator: TokenEstimatorPort;
  budgetTokens: number;
}): { messages: ModelMessage[]; reinjected: boolean } {
  if (params.messages.some((message) => message.content.includes(params.marker))) {
    return { messages: params.messages, reinjected: false };
  }

  const lines: string[] = [params.marker];
  let chars = params.marker.length;
  for (const fact of params.facts) {
    const line = `- (${fact.id}) ${fact.content.replace(/\s+/g, " ").trim()}`;
    if (chars + line.length + 1 > params.maxChars) {
      break;
    }
    lines.push(line);
    chars += line.length + 1;
  }
  if (lines.length <= 1) {
    return { messages: params.messages, reinjected: false };
  }

  const next = insertAfterSystemMessages(params.messages, {
    role: "user",
    content: lines.join("\n"),
  });
  const used = estimateModelMessagesTokens(next, params.estimator);
  if (used > params.budgetTokens) {
    return { messages: params.messages, reinjected: false };
  }
  return { messages: next, reinjected: true };
}
