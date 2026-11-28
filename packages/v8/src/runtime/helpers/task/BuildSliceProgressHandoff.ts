/**
 * Build host-facing progress + nextAction from plan/taskList store slices.
 */

import type { TaskList } from "../../../modules/task-list";
import type {
  RuntimeNextAction,
  RuntimeProgressSketch,
} from "../../contracts/output/RuntimeRunResult";

export interface SliceProgressHandoff {
  progress?: RuntimeProgressSketch;
  nextAction?: RuntimeNextAction;
  completedPlanStepIds?: string[];
  leftoverAnswer?: string;
}

const GENERIC_SLICE_TITLES = new Set([
  "research and lock the first slice",
  "implement the first safe slice",
  "complete remaining requested work",
  "complete requested work",
  "verify and finish remaining work",
]);

function planStepIds(plan: Record<string, unknown> | undefined): string[] {
  if (!plan) return [];
  const phases = plan.phases;
  if (!Array.isArray(phases)) return [];
  const ids: string[] = [];
  for (const phaseRaw of phases) {
    if (!phaseRaw || typeof phaseRaw !== "object") continue;
    const steps = (phaseRaw as { steps?: unknown }).steps;
    if (!Array.isArray(steps)) continue;
    for (const stepRaw of steps) {
      if (!stepRaw || typeof stepRaw !== "object") continue;
      const id = (stepRaw as { id?: unknown }).id;
      if (typeof id === "string" && id.trim()) ids.push(id.trim());
    }
  }
  return [...new Set(ids)];
}

function openItems(taskList: TaskList | undefined): TaskList["items"] {
  if (!taskList?.items?.length) return [];
  return taskList.items.filter(
    (item) => item.status === "pending" || item.status === "active",
  );
}

function doneItems(taskList: TaskList | undefined): TaskList["items"] {
  if (!taskList?.items?.length) return [];
  return taskList.items.filter((item) => item.status === "done");
}

function isGenericTitle(title: string): boolean {
  return GENERIC_SLICE_TITLES.has(title.trim().toLowerCase());
}

function basenamePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function summarizeChangedWork(changedFiles: readonly string[]): string {
  const files = changedFiles
    .map((path) => path.replace(/\\/g, "/").trim())
    .filter((path) => path.length > 0)
    .slice(0, 8);
  if (files.length === 0) return "this slice";
  const packages = [
    ...new Set(
      files
        .map((path) => /^(packages\/[^/]+|apps\/[^/]+)/.exec(path)?.[1])
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const names = files.map(basenamePath).slice(0, 4);
  if (packages.length === 1) {
    return `${packages[0]} (${names.join(", ")})`;
  }
  return names.join(", ");
}

function describeDoneWork(input: {
  titles: string[];
  changedFiles?: readonly string[];
}): string {
  const concrete = input.titles.filter((title) => !isGenericTitle(title));
  if (concrete.length > 0) {
    return concrete.join("; ");
  }
  return summarizeChangedWork(input.changedFiles ?? []);
}

function describeNextWork(
  titles: string[],
  changedFiles?: readonly string[],
): string {
  const concrete = titles.filter((title) => !isGenericTitle(title));
  if (concrete.length === 1) return concrete[0]!;
  if (concrete.length > 1) {
    return `${concrete[0]} (then ${concrete.slice(1).join("; ")})`;
  }
  const fromFiles = summarizeChangedWork(changedFiles ?? []);
  if (fromFiles !== "this slice") {
    return `remaining work around ${fromFiles}`;
  }
  if (titles.length === 0) return "the remaining campaign work";
  if (titles.length === 1) return titles[0]!;
  return `${titles[0]} (then ${titles.slice(1).join("; ")})`;
}

/** Short leftover note for open checklist rows after a partial slice. */
export function formatOpenChecklistLeftoverAnswer(
  taskList: TaskList | undefined,
  options?: {
    advancedThisTurnIds?: readonly string[];
    changedFiles?: readonly string[];
    verifyNote?: string;
  },
): string {
  const advancedIds = new Set(
    (options?.advancedThisTurnIds ?? []).filter((id) => id.trim().length > 0),
  );
  const doneThisTurn = (taskList?.items ?? [])
    .filter(
      (item) =>
        item.status === "done" &&
        (advancedIds.size === 0
          ? false
          : advancedIds.has(item.id) ||
            (item.sourceRef ? advancedIds.has(item.sourceRef) : false)),
    )
    .map((item) => item.title?.trim() || item.id)
    .filter((title) => title.length > 0)
    .slice(0, 3);
  const doneTitles =
    doneThisTurn.length > 0
      ? doneThisTurn
      : doneItems(taskList)
          .map((item) => item.title?.trim() || item.id)
          .filter((title) => title.length > 0)
          .slice(-1);
  const open = openItems(taskList)
    .map((item) => item.title?.trim() || item.id)
    .filter((title) => title.length > 0)
    .slice(0, 6);
  if (open.length === 0) return "";

  const doneWork = describeDoneWork({
    titles: doneTitles,
    changedFiles: options?.changedFiles,
  });
  const nextWork = describeNextWork(open, options?.changedFiles);
  const verify =
    options?.verifyNote?.trim() ||
    "Not confirmed this turn — run a selective test before claiming green";
  const verifyFailed = /^failed\b/i.test(verify);
  const changed = (options?.changedFiles ?? [])
    .map((path) => path.replace(/\\/g, "/").trim())
    .filter((path) => path.length > 0)
    .slice(0, 6);

  const lines = [
    verifyFailed
      ? `Implementation of **${doneWork}** landed this turn, but verification failed.`
      : `Implementation of **${doneWork}** is done.`,
    verifyFailed
      ? `Next we still have **${nextWork}**.`
      : `Next we still have **${nextWork}** to implement.`,
    "",
    `Verified: ${verify}`,
    ...(changed.length > 0 ? [`Changed: ${changed.join(", ")}`] : []),
    "",
    "Want me to start the next slice? Say **continue**.",
  ];
  return lines.join("\n");
}

function isDiscoveryDesk(taskList: TaskList | undefined): boolean {
  if (!taskList) return false;
  return taskList.purpose === "discovery" || taskList.source === "discovery";
}

function isVerifyRepairDesk(taskList: TaskList | undefined): boolean {
  if (!taskList?.items?.length) return false;
  if (taskList.title === "Verification repair") return true;
  const ids = new Set(taskList.items.map((item) => item.id));
  return ids.has("repair_fix") && ids.has("repair_reverify");
}

export function buildSliceProgressHandoff(input: {
  plan?: Record<string, unknown>;
  taskList?: TaskList;
  completedPlanStepIds?: readonly string[];
  nextPlanPhaseOffer?: string;
  /** When true and checklist still open, append leftover prose. */
  appendLeftover?: boolean;
  /** Item ids advanced during this run (honest "Done this turn"). */
  advancedThisTurnIds?: readonly string[];
  changedFiles?: readonly string[];
  verifyNote?: string;
}): SliceProgressHandoff {
  // Discovery is recon-only — never emit Continue from its canned rows.
  const deskForContinue = isDiscoveryDesk(input.taskList)
    ? undefined
    : input.taskList;
  const stepIds = planStepIds(input.plan);
  const fromDeskDone = doneItems(deskForContinue)
    .map((item) => item.sourceRef?.trim() || item.id)
    .filter(Boolean);
  const completedIds = [
    ...new Set([
      ...(input.completedPlanStepIds ?? []).filter((id) => id.trim().length > 0),
      ...fromDeskDone,
    ]),
  ];
  const open = openItems(deskForContinue);
  const openTitles = open
    .map((item) => item.title?.trim() || item.id)
    .filter((title) => title.length > 0)
    .slice(0, 6);
  const doneCount = doneItems(deskForContinue).length;
  const pendingCount = open.length;
  const next = open[0];
  const planTotalCount =
    stepIds.length > 0 ? stepIds.length : doneCount + pendingCount;
  const planCompletedCount =
    stepIds.length > 0
      ? completedIds.filter((id) => stepIds.includes(id)).length
      : doneCount;

  const hasProgress =
    Boolean(deskForContinue?.items.length) ||
    planTotalCount > 0 ||
    completedIds.length > 0;

  const progress: RuntimeProgressSketch | undefined = hasProgress
    ? {
        planCompletedCount,
        planTotalCount,
        doneCount,
        pendingCount,
        ...(next
          ? {
              nextTitle: (next.title?.trim() || next.id).slice(0, 200),
              ...(next.detail?.trim()
                ? { nextDetail: next.detail.trim().slice(0, 500) }
                : {}),
            }
          : {}),
        openTitles,
      }
    : undefined;

  let nextAction: RuntimeNextAction | undefined;
  const campaignOffer = input.nextPlanPhaseOffer?.trim();
  const repairing = isVerifyRepairDesk(deskForContinue);
  if (repairing && pendingCount > 0 && next) {
    // Repair desk owns Continue while open — do not surface campaign-scope CTA.
    const title = (next.title?.trim() || next.id).slice(0, 160);
    nextAction = {
      kind: "continue_checklist",
      prompt: `Continue with verification repair: ${title}`,
    };
  } else if (campaignOffer) {
    nextAction = {
      kind: "next_campaign_scope",
      prompt: "Say which remaining scope to tackle next.",
    };
  } else if (pendingCount > 0 && next) {
    const title = (next.title?.trim() || next.id).slice(0, 160);
    const index = Math.max(1, doneCount + 1);
    const total = Math.max(planTotalCount, doneCount + pendingCount);
    const prompt =
      total > 1
        ? `Continue with plan item ${index}/${total}: ${title}`
        : `Continue with the next plan item: ${title}`;
    nextAction = {
      kind: "continue_checklist",
      prompt,
    };
  }

  const leftoverAnswer =
    input.appendLeftover && pendingCount > 0
      ? formatOpenChecklistLeftoverAnswer(deskForContinue, {
          advancedThisTurnIds: input.advancedThisTurnIds,
          ...(input.changedFiles?.length
            ? { changedFiles: input.changedFiles }
            : {}),
          ...(input.verifyNote ? { verifyNote: input.verifyNote } : {}),
        })
      : undefined;

  return {
    ...(progress ? { progress } : {}),
    ...(nextAction ? { nextAction } : {}),
    ...(completedIds.length > 0 ? { completedPlanStepIds: completedIds } : {}),
    ...(leftoverAnswer ? { leftoverAnswer } : {}),
  };
}
