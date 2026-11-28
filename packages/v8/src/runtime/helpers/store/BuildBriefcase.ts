/**
 * Thin Briefcase builder (S11-BRIEF) — packTurn + TaskList workingMaterials.
 * Full PromptConstructionPipeline remains module-owned; this is the runtime seam.
 */

import type { ContextBundle } from "../../contracts/enrich/ContextBundle";
import type { TaskList } from "../../../modules/task-list";
import type { GrantSurface } from "../../tools/CheckToolAgainstGrant";
import { packTurn, type ModelRequestSketch, type PackTurnInput } from "./PackTurn";
import type { PromptCacheCapability } from "./PromptCacheCapability";

export interface BuildBriefcaseInput {
  message: string;
  grant: GrantSurface;
  contextBundle?: ContextBundle;
  taskList?: TaskList;
  systemPrefix?: string;
  priorMessages?: Array<{ role: string; content: string }>;
  promptCache?: PromptCacheCapability;
  supportsPromptCaching?: boolean;
}

export type BriefcaseSketch = ModelRequestSketch;

export function buildBriefcase(input: BuildBriefcaseInput): BriefcaseSketch {
  const packInput: PackTurnInput = {
    systemPrefix: input.systemPrefix,
    messages: [
      ...(input.priorMessages ?? []),
      { role: "user", content: input.message },
    ],
    grant: input.grant,
    ...(input.contextBundle ? { contextBundle: input.contextBundle } : {}),
    ...(input.taskList ? { taskList: input.taskList } : {}),
    promptCache: input.promptCache,
    supportsPromptCaching: input.supportsPromptCaching,
  };
  const packed = packTurn(packInput);
  return {
    ...packed,
    reasonCodes: [...packed.reasonCodes, "briefcase_built"],
  };
}
