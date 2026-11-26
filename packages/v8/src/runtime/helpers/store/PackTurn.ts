import type { ContextBundle } from "../../contracts/enrich/ContextBundle";
import type { TaskList } from "../../../modules/task-list";
import { toModelToolSurface } from "../../tools/ToModelToolSurface";
import type { GrantSurface } from "../../tools/CheckToolAgainstGrant";
import { formatTaskListForBriefcase } from "../task/FormatTaskListForBriefcase";
import {
  cacheBreakpointsForCapability,
  flattenBriefcaseSlots,
  layoutBriefcaseSlots,
  type BriefcaseSlots,
  type CacheBreakpointMark,
} from "./LayoutBriefcaseSlots";
import {
  resolvePromptCacheCapability,
  type PromptCacheCapability,
} from "./PromptCacheCapability";

export interface PackTurnInput {
  systemPrefix?: string;
  messages: Array<{ role: string; content: string }>;
  grant: GrantSurface;
  contextBundleSummary?: string;
  /** Prefer full ContextBundle when available (S11-BRIEF). */
  contextBundle?: ContextBundle;
  /** Live TaskList for workingMaterials (S11-TASK). */
  taskList?: TaskList;
  /** Prompt-cache capability (§11.4) — never model-name branching. */
  promptCache?: PromptCacheCapability;
  supportsPromptCaching?: boolean;
}

export interface ModelRequestSketch {
  systemPrefix: string;
  messages: Array<{ role: string; content: string }>;
  tools: string[];
  /** Ordered Briefcase layout for cache discipline. */
  briefcaseSlots?: BriefcaseSlots;
  cacheBreakpoints?: CacheBreakpointMark[];
  promptCacheCapability?: PromptCacheCapability;
  reasonCodes: string[];
}

/**
 * Build a throwaway ModelRequest — tools always ⊆ grant (§11 / prompt⊆grant).
 * Layouts ContextBundle + TaskList into stable → semi → volatile.
 */
export function packTurn(input: PackTurnInput): ModelRequestSketch {
  const tools = toModelToolSurface(input.grant);
  const messages = [...input.messages];
  const capability = resolvePromptCacheCapability({
    promptCache: input.promptCache,
    supportsPromptCaching: input.supportsPromptCaching,
  });

  let working = "";
  let briefcaseSlots: BriefcaseSlots | undefined;
  let cacheBreakpoints: CacheBreakpointMark[] | undefined;
  const reasonCodes = ["pack_turn_grant_surface"];

  const taskFmt = formatTaskListForBriefcase(input.taskList);
  reasonCodes.push(...taskFmt.reasonCodes);

  if (input.contextBundle) {
    briefcaseSlots = layoutBriefcaseSlots({
      bundle: input.contextBundle,
      taskListMarkdown: taskFmt.promptBlock,
      taskListWorkingSet: taskFmt.workingSet,
    });
    working = flattenBriefcaseSlots(briefcaseSlots);
    cacheBreakpoints = cacheBreakpointsForCapability(
      capability,
      briefcaseSlots,
    );
    reasonCodes.push("pack_turn_context_bundle", "pack_turn_cache_layout");
    if (cacheBreakpoints.length > 0) {
      reasonCodes.push(`pack_turn_cache_${capability}`);
    } else {
      reasonCodes.push("pack_turn_cache_none");
    }
  } else if (input.contextBundleSummary || taskFmt.workingSet || taskFmt.promptBlock) {
    working = [
      input.contextBundleSummary,
      taskFmt.workingSet ?? taskFmt.promptBlock,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (working) {
    messages.unshift({
      role: "system",
      content: working,
    });
  }

  return {
    systemPrefix: input.systemPrefix ?? "",
    messages,
    tools,
    ...(briefcaseSlots ? { briefcaseSlots } : {}),
    ...(cacheBreakpoints && cacheBreakpoints.length > 0
      ? { cacheBreakpoints }
      : {}),
    promptCacheCapability: capability,
    reasonCodes,
  };
}
