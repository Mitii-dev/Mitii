/**
 * S11-BRIEF — Briefcase via PromptConstructionPipeline (modules own packing).
 * Tools always ⊆ grant; falls back to packTurn-shaped sketch on PC failure.
 */

import type { ContextBundle } from "../../contracts/enrich/ContextBundle";
import type { RuntimeDecisionSketch } from "../../flow/steps/5-Decide";
import type { RuntimePromptConstructionPort } from "../../ports/RuntimePromptConstructionPort";
import type { TaskList } from "../../../modules/task-list";
import { toModelToolSurface } from "../../tools/ToModelToolSurface";
import type { GrantSurface } from "../../tools/CheckToolAgainstGrant";
import { mapSketchToPromptConstructionInput } from "../../adapters/prompt/MapSketchToPromptConstructionInput";
import { buildBriefcase, type BriefcaseSketch } from "./BuildBriefcase";
import type { PromptCacheCapability } from "./PromptCacheCapability";

export interface BuildBriefcaseViaPCInput {
  message: string;
  grant: GrantSurface;
  decision: RuntimeDecisionSketch;
  promptConstruction: RuntimePromptConstructionPort;
  contextBundle?: ContextBundle;
  taskList?: TaskList;
  systemPrefix?: string;
  priorMessages?: Array<{ role: string; content: string }>;
  contextWindowTokens?: number;
  promptCache?: PromptCacheCapability;
  supportsPromptCaching?: boolean;
}

/**
 * Pack via PromptConstructionPipeline; project to ModelRequestSketch for the pump.
 */
export function buildBriefcaseViaPC(
  input: BuildBriefcaseViaPCInput,
): BriefcaseSketch {
  const grantTools = new Set(toModelToolSurface(input.grant));
  try {
    const pcInput = mapSketchToPromptConstructionInput({
      message: input.message,
      decision: input.decision,
      contextBundle: input.contextBundle,
      taskList: input.taskList,
      contextWindowTokens: input.contextWindowTokens,
      conversation: input.priorMessages,
    });
    const result = input.promptConstruction.construct(pcInput);
    const request = result.request;
    const systemParts = (request.messages ?? [])
      .filter((m) => m.role === "system")
      .map((m) => m.content);
    const nonSystem = (request.messages ?? []).filter(
      (m) => m.role !== "system",
    );
    const tools = (request.tools ?? [])
      .map((t) => t.name)
      .filter((name) => grantTools.has(name));

    return {
      systemPrefix:
        input.systemPrefix ??
        (systemParts.length > 0 ? systemParts.join("\n\n") : ""),
      messages:
        nonSystem.length > 0
          ? nonSystem.map((m) => ({ role: m.role, content: m.content }))
          : [{ role: "user", content: input.message }],
      tools,
      reasonCodes: [
        "briefcase_built",
        "briefcase_via_prompt_construction",
        `briefcase_pc_status_${result.status}`,
        ...result.reasonCodes.slice(0, 8).map(String),
      ],
    };
  } catch {
    const fallback = buildBriefcase({
      message: input.message,
      grant: input.grant,
      contextBundle: input.contextBundle,
      taskList: input.taskList,
      systemPrefix: input.systemPrefix,
      priorMessages: input.priorMessages,
      promptCache: input.promptCache,
      supportsPromptCaching: input.supportsPromptCaching,
    });
    return {
      ...fallback,
      reasonCodes: [
        ...fallback.reasonCodes,
        "briefcase_pc_fallback_pack_turn",
      ],
    };
  }
}
