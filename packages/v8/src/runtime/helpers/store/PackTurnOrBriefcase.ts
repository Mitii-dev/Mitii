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

export function packTurnOrBriefcase(input: {
  message: string;
  grant: GrantSurface;
  decision?: RuntimeDecisionSketch;
  promptConstruction?: RuntimePromptConstructionPort;
  contextBundle?: ContextBundle;
  contextBundleSummary?: string;
  taskList?: TaskList;
  contextWindowTokens?: number;
}): ModelRequestSketch {
  if (input.promptConstruction && input.decision) {
    return buildBriefcaseViaPC({
      message: input.message,
      grant: input.grant,
      decision: input.decision,
      promptConstruction: input.promptConstruction,
      contextBundle: input.contextBundle,
      taskList: input.taskList,
      contextWindowTokens: input.contextWindowTokens,
    });
  }
  return packTurn({
    messages: [{ role: "user", content: input.message }],
    grant: input.grant,
    contextBundleSummary: input.contextBundleSummary,
    ...(input.contextBundle ? { contextBundle: input.contextBundle } : {}),
    ...(input.taskList ? { taskList: input.taskList } : {}),
  });
}
