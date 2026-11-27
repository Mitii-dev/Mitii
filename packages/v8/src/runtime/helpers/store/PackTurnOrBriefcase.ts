/**
 * Prefer PromptConstruction briefcase when port + decision are present (S11-BRIEF).
 */

import type { ContextBundle } from "../../contracts/enrich/ContextBundle";
import type { RuntimeDecisionSketch } from "../../flow/steps/5-Decide";
import type { RuntimePromptConstructionPort } from "../../ports/RuntimePromptConstructionPort";
import type { TaskList } from "../../../modules/task-list";
import type { GrantSurface } from "../../tools/CheckToolAgainstGrant";
import { buildBriefcaseViaPC } from "./BuildBriefcaseViaPC";
import { packTurn, type ModelRequestSketch } from "./PackTurn";

function priorMessagesForPack(
  conversation: Array<{ role: string; content: string }> | undefined,
  currentMessage: string,
): Array<{ role: string; content: string }> {
  if (!conversation || conversation.length === 0) return [];
  const prior = conversation.filter(
    (m) =>
      (m.role === "user" || m.role === "assistant" || m.role === "system") &&
      m.content.trim().length > 0,
  );
  const last = prior[prior.length - 1];
  if (
    last?.role === "user" &&
    last.content.trim() === currentMessage.trim()
  ) {
    return prior.slice(0, -1);
  }
  return prior;
}

export function packTurnOrBriefcase(input: {
  message: string;
  grant: GrantSurface;
  decision?: RuntimeDecisionSketch;
  promptConstruction?: RuntimePromptConstructionPort;
  contextBundle?: ContextBundle;
  contextBundleSummary?: string;
  taskList?: TaskList;
  contextWindowTokens?: number;
  conversation?: Array<{ role: string; content: string }>;
}): ModelRequestSketch {
  const priorMessages = priorMessagesForPack(
    input.conversation,
    input.message,
  );
  if (input.promptConstruction && input.decision) {
    return buildBriefcaseViaPC({
      message: input.message,
      grant: input.grant,
      decision: input.decision,
      promptConstruction: input.promptConstruction,
      contextBundle: input.contextBundle,
      taskList: input.taskList,
      contextWindowTokens: input.contextWindowTokens,
      ...(priorMessages.length > 0 ? { priorMessages } : {}),
    });
  }
  return packTurn({
    messages: [
      ...priorMessages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
      { role: "user", content: input.message },
    ],
    grant: input.grant,
    contextBundleSummary: input.contextBundleSummary,
    ...(input.contextBundle ? { contextBundle: input.contextBundle } : {}),
    ...(input.taskList ? { taskList: input.taskList } : {}),
  });
}
