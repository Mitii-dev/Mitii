import type { RequestUnderstandingResult } from "../../request-understanding";

import { DECISION_POLICY_THRESHOLDS } from "../policy";
import { DECISION_POLICY_PATTERNS } from "../patterns";
import { EXECUTION_ROUTE } from "../constants";

/**
 * Stable decline codes for the small-explicit-path fast path. Applied fast
 * paths surface as the `fast_path_explicit_paths` decision reason code; declines
 * are for tests / traces only and never widen a grant.
 */
export const FAST_PATH_DECLINE_REASONS = [
  "not_agent_execute",
  "no_explicit_file_paths",
  "too_many_explicit_paths",
  "officer_plan_signal",
  "not_small_complexity",
  "elevated_risk",
  "unclear_ask",
  "wide_scope",
  "shared_surface_intent",
  "broad_or_multi_outcome",
  "prompt_too_long",
  "change_impact_recommended",
] as const;

export type FastPathDeclineReason = (typeof FAST_PATH_DECLINE_REASONS)[number];

export type FastPathResolution =
  | { eligible: true; paths: string[] }
  | { eligible: false; reason: FastPathDeclineReason; paths: string[] };

const SHARED_SURFACE_FAST_PATH_BLOCKED_INTENTS = new Set([
  "schema",
  "refactor",
  "migrate",
  "scaffold",
  "security",
]);

const FILE_LIKE_PATH =
  /(?:^|[\s`'"(\[])((?:[\w@.+-]+\/)*[\w@+-][\w@.+-]*\.[A-Za-z][A-Za-z0-9]{0,15})(?=\.?(?:$|[\s`'")\],;:!?]))/g;

/** Prose tokens that look like `name.ext` but are never workspace paths. */
const PROSE_PATH_STOPLIST = new Set([
  "e.g",
  "i.e",
  "etc.",
  "node.js",
  "next.js",
  "vue.js",
  "nuxt.js",
  "express.js",
  "react.js",
  "d3.js",
]);

/**
 * Explicit workspace file paths named in the ask (e.g. `src/auth/login.ts`).
 * URLs and prose-shaped dotted tokens are ignored.
 */
export function extractExplicitFilePaths(message: string): string[] {
  const text = message.replace(/\nClarification:\s*[\s\S]*$/i, "");
  const withoutUrls = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ");
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of withoutUrls.matchAll(FILE_LIKE_PATH)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    const normalized = raw.replace(/^\.\//, "");
    const key = normalized.toLowerCase();
    if (PROSE_PATH_STOPLIST.has(key) || seen.has(key)) continue;
    seen.add(key);
    found.push(normalized);
  }
  return found;
}

function collectExplicitPaths(
  taskAnalysis: RequestUnderstandingResult["taskAnalysis"],
  message: string,
): string[] {
  const fromTargets = taskAnalysis.targets
    .filter(
      (target) =>
        target.explicit &&
        target.kind === "file" &&
        /\.[A-Za-z][A-Za-z0-9]{0,15}$/.test(target.value) &&
        !/\s/.test(target.value),
    )
    .map((target) => target.value.replace(/^\.\//, ""));
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const path of [...fromTargets, ...extractExplicitFilePaths(message)]) {
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(path);
  }
  return merged;
}

/**
 * Small, clear agent-execute asks that name 1–N concrete files skip the
 * internal plan / discovery pass and go straight to the mutate loop. The
 * execution seed still binds the named paths; verification is unchanged.
 */
export function resolveFastPath(params: {
  mode: "ask" | "plan" | "agent";
  route: string;
  understanding: RequestUnderstandingResult;
  message: string;
  changeImpactRecommended?: boolean;
}): FastPathResolution {
  const { mode, route, understanding, message } = params;
  const { taskAnalysis, intent } = understanding;
  const decline = (
    reason: FastPathDeclineReason,
    paths: string[] = [],
  ): FastPathResolution => ({ eligible: false, reason, paths });

  if (mode !== "agent" || route !== EXECUTION_ROUTE.EXECUTE) {
    return decline("not_agent_execute");
  }

  const paths = collectExplicitPaths(taskAnalysis, message);
  if (paths.length === 0) {
    return decline("no_explicit_file_paths");
  }
  if (paths.length > DECISION_POLICY_THRESHOLDS.fastPathMaxExplicitPaths) {
    return decline("too_many_explicit_paths", paths);
  }

  if (
    taskAnalysis.taskSize === "medium" ||
    taskAnalysis.taskSize === "large" ||
    taskAnalysis.planningHint === "medium" ||
    taskAnalysis.planningHint === "long" ||
    taskAnalysis.recommendsPlanning
  ) {
    return decline("officer_plan_signal", paths);
  }

  if (
    taskAnalysis.complexity !== "trivial" &&
    taskAnalysis.complexity !== "simple"
  ) {
    return decline("not_small_complexity", paths);
  }

  if (taskAnalysis.risk !== "low" && taskAnalysis.risk !== "medium") {
    return decline("elevated_risk", paths);
  }

  if (taskAnalysis.clarity === "unclear") {
    return decline("unclear_ask", paths);
  }

  if (
    taskAnalysis.scope === "package" ||
    taskAnalysis.scope === "repository" ||
    taskAnalysis.scope === "workspace"
  ) {
    return decline("wide_scope", paths);
  }
  const estimatedMax = taskAnalysis.estimatedFilesAffected?.maximum;
  if (
    typeof estimatedMax === "number" &&
    estimatedMax > DECISION_POLICY_THRESHOLDS.fastPathMaxExplicitPaths
  ) {
    return decline("wide_scope", paths);
  }

  if (
    SHARED_SURFACE_FAST_PATH_BLOCKED_INTENTS.has(
      intent.classification.primaryTaskIntent,
    )
  ) {
    return decline("shared_surface_intent", paths);
  }

  if (params.changeImpactRecommended) {
    return decline("change_impact_recommended", paths);
  }

  const primaryText = message.replace(/\nClarification:\s*[\s\S]*$/i, "").trim();
  if (primaryText.length > DECISION_POLICY_THRESHOLDS.fastPathMaxPromptChars) {
    return decline("prompt_too_long", paths);
  }
  if (DECISION_POLICY_PATTERNS.broadRepairRequest.test(primaryText)) {
    return decline("broad_or_multi_outcome", paths);
  }

  return { eligible: true, paths };
}
