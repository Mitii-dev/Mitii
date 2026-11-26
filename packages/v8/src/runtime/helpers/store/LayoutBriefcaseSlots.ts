/**
 * Order Briefcase slots for prompt-cache stability (§11.4 / S11-CACHE).
 * Stable prefix stays byte-stable across turns when possible.
 */

import type { ContextBundle } from "../../contracts/enrich/ContextBundle";
import type { PromptCacheCapability } from "./PromptCacheCapability";

export interface BriefcaseSlots {
  /** CACHE-STABLE: rules, brief, skills */
  stable: string[];
  /** SEMI-STABLE: memory, plan/handoff peaks */
  semi: string[];
  /** VOLATILE: repo, diagnostics, live task cues */
  volatile: string[];
}

export interface CacheBreakpointMark {
  afterSlot: "stable" | "semi";
  kind: PromptCacheCapability;
}

export interface LayoutBriefcaseSlotsInput {
  bundle: ContextBundle;
  /** Live TaskList markdown / working set (S11-TASK) — volatile. */
  taskListMarkdown?: string;
  taskListWorkingSet?: string;
}

export function layoutBriefcaseSlots(
  bundleOrInput: ContextBundle | LayoutBriefcaseSlotsInput,
): BriefcaseSlots {
  const input: LayoutBriefcaseSlotsInput =
    "bundle" in bundleOrInput
      ? bundleOrInput
      : { bundle: bundleOrInput };
  const bundle = input.bundle;
  const stable: string[] = [];
  const semi: string[] = [];
  const volatile: string[] = [];

  if (bundle.projectRules?.text?.trim()) {
    stable.push(`rules: ${bundle.projectRules.text.trim()}`);
  }
  if (bundle.decisionBrief?.trim()) {
    stable.push(`brief: ${bundle.decisionBrief.trim()}`);
  }
  if (bundle.skills?.items.length) {
    stable.push(`skills: ${bundle.skills.items.join("\n")}`);
  }

  if (bundle.memory?.items.length) {
    semi.push(`memory: ${bundle.memory.items.join(" | ")}`);
  }
  const peaks = bundle.handoffPeaks;
  if (peaks) {
    const bits = [
      peaks.planObjective ? `objective: ${peaks.planObjective}` : "",
      peaks.activeTaskTitle
        ? `active: ${peaks.activeTaskTitle}`
        : peaks.activeTaskId
          ? `active: ${peaks.activeTaskId}`
          : "",
      peaks.previousHandoffSummary
        ? `prev: ${peaks.previousHandoffSummary}`
        : "",
    ].filter(Boolean);
    if (bits.length > 0) semi.push(bits.join("; "));
  }
  if (bundle.planRef) {
    semi.push(`planRef: ${bundle.planRef}`);
  }

  volatile.push(bundle.summary);
  if (bundle.repoContext?.items.length) {
    volatile.push(`repo: ${bundle.repoContext.items.join("\n")}`);
  }
  if (bundle.diagnostics?.length) {
    volatile.push(`diagnostics: ${bundle.diagnostics.join(" | ")}`);
  }
  if (input.taskListWorkingSet?.trim()) {
    volatile.push(input.taskListWorkingSet.trim());
  } else if (input.taskListMarkdown?.trim()) {
    volatile.push(input.taskListMarkdown.trim());
  } else if (bundle.taskListPresent) {
    volatile.push("taskList: present");
  }

  return { stable, semi, volatile };
}

export function cacheBreakpointsForCapability(
  capability: PromptCacheCapability,
  slots: BriefcaseSlots,
): CacheBreakpointMark[] {
  if (capability === "none") return [];
  const marks: CacheBreakpointMark[] = [];
  if (slots.stable.length > 0) {
    marks.push({ afterSlot: "stable", kind: capability });
  }
  if (capability === "anthropic_ephemeral" && slots.semi.length > 0) {
    marks.push({ afterSlot: "semi", kind: capability });
  }
  return marks;
}

export function flattenBriefcaseSlots(slots: BriefcaseSlots): string {
  return [...slots.stable, ...slots.semi, ...slots.volatile]
    .filter(Boolean)
    .join("\n");
}
