/**
 * S3A-TASKLIST — 1:1 derive execution TaskList from PlanArtifact;
 * discovery temp list for readonly recon.
 * Module owns pipelines; runtime only invokes TaskListPipeline.
 */

import type { PlanArtifact } from "../../../modules/planning";
import {
  DEFAULT_MAX_TASK_DETAIL_CHARS,
  DEFAULT_MAX_TASK_PATHS,
  DEFAULT_MAX_TASK_TITLE_CHARS,
  TASK_LIST_SCHEMA_VERSION,
  taskListSchema,
  TaskListPipeline,
  type TaskList,
} from "../../../modules/task-list";

export interface DeriveTaskListAfterPlanResult {
  taskList?: TaskList;
  status: "applied" | "rejected" | "skipped";
  reasonCodes: string[];
}

const pipeline = new TaskListPipeline();

/**
 * Invented desks that must not surface as a checklist.
 * Prefer LLM plan steps or no strip — never a truncated ask dump.
 */
export function isWeakSeededTaskList(taskList: TaskList | undefined): boolean {
  if (!taskList?.items?.length) return false;
  if (taskList.source === "plan") return false;
  if (taskList.items.length === 1) {
    const title = taskList.items[0]?.title?.trim() ?? "";
    // Truncated ask dump or canned filler — not an LLM stepper.
    return /…$|\.\.\.$/.test(title) || /^complete requested work$/i.test(title);
  }
  if (taskList.items.length !== 2) return false;
  const second = taskList.items[1]?.title?.trim().toLowerCase() ?? "";
  return second === "verify and finish remaining work";
}

export function deriveTaskListAfterPlan(input: {
  plan?: PlanArtifact;
  maxTasks?: number;
}): DeriveTaskListAfterPlanResult {
  if (!input.plan) {
    return {
      status: "skipped",
      reasonCodes: ["tasklist_derive_skipped_no_plan"],
    };
  }
  const result = pipeline.deriveFromPlan(input.plan, input.maxTasks);
  if (result.status !== "applied" || !result.taskList) {
    return {
      status: "rejected",
      reasonCodes: [
        "tasklist_derive_rejected",
        ...result.reasonCodes.map(String),
      ],
    };
  }
  return {
    taskList: result.taskList,
    status: "applied",
    reasonCodes: [
      "tasklist_derive_applied",
      ...result.reasonCodes.map(String),
    ],
  };
}

export function beginDiscoveryTaskList(title?: string): {
  taskList: TaskList;
  reasonCodes: string[];
} {
  return {
    taskList: pipeline.createDiscoveryList(title),
    reasonCodes: ["tasklist_discovery_begun"],
  };
}

/**
 * Soft desk from plan step intents when strict file-scoped derive is empty.
 * Prefer this over inventing a 2-item objective seed.
 */
export function seedExecutionTaskListFromPlanArtifact(plan: PlanArtifact): {
  taskList?: TaskList;
  reasonCodes: string[];
} {
  const items: Array<{
    id: string;
    title: string;
    status: "active" | "pending";
    detail?: string;
    sourceRef?: string;
    write?: string[];
  }> = [];
  const seen = new Set<string>();

  for (const phase of plan.phases) {
    for (const step of phase.steps) {
      const intent = step.intent?.trim() || "";
      const summary = step.actionSummary?.trim() || "";
      const titleRaw = intent || summary;
      if (titleRaw.length < 4) continue;
      if (isProcessMetaTitle(titleRaw)) continue;
      const title = clipTitle(titleRaw);
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const write = (step.targetRefs ?? [])
        .map((path) => path.replace(/\\/g, "/").trim())
        .filter((path) => path.length > 0)
        .slice(0, DEFAULT_MAX_TASK_PATHS);
      items.push({
        id: step.id || `plan_step_${items.length + 1}`,
        title,
        status: items.length === 0 ? "active" : "pending",
        ...(summary && summary !== titleRaw
          ? { detail: clipDetail(summary) }
          : {}),
        sourceRef: step.id,
        ...(write.length > 0 ? { write } : {}),
      });
      if (items.length >= 8) break;
    }
    if (items.length >= 8) break;
  }

  if (items.length === 0) {
    return { reasonCodes: ["tasklist_seed_from_plan_empty"] };
  }

  return {
    taskList: taskListSchema.parse({
      schemaVersion: TASK_LIST_SCHEMA_VERSION,
      source: "plan",
      purpose: "execution",
      title: clipTitle(plan.objective || "Plan checklist"),
      items,
    }),
    reasonCodes: ["tasklist_seeded_from_plan_steps"],
  };
}

/**
 * Desk only when the text itself contains LLM steppers (numbered next-steps,
 * plan ### headers). Never invent a row from a raw user brief — Build can
 * stand alone on plan prose.
 */
export function seedExecutionTaskListFromObjective(objective: string): {
  taskList?: TaskList;
  reasonCodes: string[];
} {
  const titles = extractObjectiveSliceTitles(objective);
  if (titles.length === 0) {
    return { reasonCodes: ["tasklist_seed_skipped_no_llm_steps"] };
  }
  const items = titles.slice(0, 8).map((title, index) => ({
    id: `slice_${index + 1}`,
    title: title.slice(0, DEFAULT_MAX_TASK_TITLE_CHARS),
    status: (index === 0 ? "active" : "pending") as "active" | "pending",
  }));
  return {
    taskList: taskListSchema.parse({
      schemaVersion: TASK_LIST_SCHEMA_VERSION,
      source: "agent",
      purpose: "execution",
      title: "Campaign checklist",
      items,
    }),
    reasonCodes: ["tasklist_seeded_from_objective"],
  };
}

/** Real LLM steppers only — empty when the model did not list work items. */
export function extractObjectiveSliceTitles(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // 1) Explicit recommended / next-steps block with numbered bullets.
  const recommended =
    trimmed.match(
      /(?:#{1,3}\s*)?(?:recommended next(?:\s+steps?)?|what I would change next|next steps?|concrete (?:file )?targets)[\s\S]*?(?=\n#{1,3}\s+[^#]|\n---\s*$|$)/i,
    )?.[0] ?? "";
  const fromRecommended = collectBulletTitles(recommended);
  if (fromRecommended.length >= 1) return fromRecommended.slice(0, 8);

  // 2) Plan-section ### steppers ("### First slice: …", "### Tests to add").
  const fromPlanHeaders = collectPlanSubsectionTitles(trimmed);
  if (fromPlanHeaders.length >= 1) return fromPlanHeaders.slice(0, 8);

  // 3) Numbered bullets anywhere in the plan answer.
  const fromAllBullets = collectBulletTitles(trimmed);
  if (fromAllBullets.length >= 1) return fromAllBullets.slice(0, 8);

  return [];
}

function collectBulletTitles(section: string): string[] {
  if (!section.trim()) return [];
  const titles: string[] = [];
  for (const raw of section.split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const numbered = line.match(/^\d+[\.)]\s+(.+)$/)?.[1]?.trim();
    const boldBullet = line.match(/^[-*]\s+\*\*(.+?)\*\*/)?.[1]?.trim();
    // Only bold bullets — plain `- path` lists are file dumps, not steppers.
    const hit = numbered || boldBullet;
    if (!hit || hit.length < 4) continue;
    if (isSectionLabelTitle(hit)) continue;
    if (looksLikePathOnlyTitle(hit)) continue;
    titles.push(clipTitle(hit.replace(/\s+/g, " ")));
  }
  // Numbered markdown headers: ### 1. …
  for (const raw of section.split(/\n/)) {
    const headerWork = raw
      .trim()
      .match(/^#{1,3}\s+\d+[\.)]\s+(.+)$/)?.[1]
      ?.trim();
    if (!headerWork || headerWork.length < 4) continue;
    if (isSectionLabelTitle(headerWork)) continue;
    titles.push(clipTitle(headerWork.replace(/\s+/g, " ")));
  }
  return [...new Set(titles)];
}

/** ### children under ## …plan/redesign/implementation… sections. */
function collectPlanSubsectionTitles(text: string): string[] {
  const titles: string[] = [];
  const planBodies = [
    ...text.matchAll(
      /##\s+[^\n]*(?:plan|redesign|implementation|first slice|change set|work items?)[^\n]*\n([\s\S]*?)(?=\n##\s+(?!#)|$)/gi,
    ),
  ].map((match) => match[1] ?? "");
  const corpus = planBodies.length > 0 ? planBodies.join("\n") : "";
  if (!corpus.trim()) return [];
  for (const raw of corpus.split(/\n/)) {
    const header = raw.trim().match(/^###\s+(.+)$/)?.[1]?.trim();
    if (!header || header.length < 4) continue;
    if (isSectionLabelTitle(header)) continue;
    if (/^(?:research|findings|context|today|background|summary|why|notes?)\b/i.test(header)) {
      continue;
    }
    titles.push(clipTitle(header.replace(/\s+/g, " ")));
  }
  return [...new Set(titles)];
}

function looksLikePathOnlyTitle(text: string): boolean {
  const t = text.trim();
  // Structural path-likeness only — never hard-code a monorepo layout.
  return (
    /^`[^`]+`$/.test(t) ||
    /^(?:[\w@.-]+\/)+[\w@.-]+(?:\.\w+)?$/.test(t) ||
    /^(?:\.\.?\/)/.test(t)
  );
}

function isProcessMetaTitle(text: string): boolean {
  const trimmed = text.trim();
  // Canned discovery rows + generic recon verbs — never campaign slices.
  return (
    /^(?:discover|explore|investigate|research|find|read|identify)\b/i.test(
      trimmed,
    ) ||
    /^(?:find relevant entrypoint|read related state flow|identify verification checks)\b/i.test(
      trimmed,
    )
  );
}

function isSectionLabelTitle(text: string): boolean {
  return /^(?:summary|context|findings|background|recommended next(?:\s+steps?)?|what I would change next|next steps?|concrete (?:file )?targets)\b/i.test(
    text.trim(),
  );
}

function clipTitle(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= DEFAULT_MAX_TASK_TITLE_CHARS) return trimmed;
  return `${trimmed.slice(0, Math.max(0, DEFAULT_MAX_TASK_TITLE_CHARS - 1))}…`;
}

function clipDetail(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= DEFAULT_MAX_TASK_DETAIL_CHARS) return trimmed;
  return `${trimmed.slice(0, Math.max(0, DEFAULT_MAX_TASK_DETAIL_CHARS - 3))}...`;
}

function isDiscoveryList(taskList: TaskList | undefined): boolean {
  if (!taskList) return false;
  return taskList.purpose === "discovery" || taskList.source === "discovery";
}

export function replaceDiscoveryWithExecution(input: {
  current?: TaskList;
  plan?: PlanArtifact;
  maxTasks?: number;
}): DeriveTaskListAfterPlanResult {
  if (input.current && !isDiscoveryList(input.current)) {
    return {
      taskList: input.current,
      status: "skipped",
      reasonCodes: ["tasklist_keep_execution"],
    };
  }
  return deriveTaskListAfterPlan({
    plan: input.plan,
    maxTasks: input.maxTasks,
  });
}
