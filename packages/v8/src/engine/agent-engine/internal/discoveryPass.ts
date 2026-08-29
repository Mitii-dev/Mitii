import { READ_ONLY_TOOL_IDS } from "../../../modules/decision-policy";
import type { ToolGrant } from "../../../modules/decision-policy";
import type {
  DiscoveryFileRef,
  DiscoveryObservation,
  DiscoveryTarget,
  DiscoveryVerificationHint,
} from "../../../modules/planning";
import { DISCOVERY_OBSERVATION_LIMITS } from "../../../modules/planning";
import type { TaskList } from "../../../modules/task-list";
import { TaskListPipeline } from "../../../modules/task-list";

export const DISCOVERY_PASS_POLICY = {
  maxModelTurns: 2,
  maxFileReads: 8,
  // Shaped preflight alone uses up to 3 globs + 1 search. Keep headroom so
  // seed reads + model discovery turns are not starved after preflight.
  maxSearches: 10,
  maxToolCalls: 14,
} as const;

const DISCOVERY_TOOL_IDS = new Set<string>([
  "list_directory",
  "read_file",
  "read_many_files",
  "glob_files",
  "file_metadata",
  "search_files",
  "read_diagnostics",
  "read_git_status",
  "goto_definition",
  "find_references",
  "read_package_scripts",
]);

const FILE_READ_TOOLS = new Set(["read_file", "read_many_files"]);
const SEARCH_TOOLS = new Set(["search_files", "glob_files"]);

export function createDiscoveryGrant(base: ToolGrant): ToolGrant {
  const allowed = base.allowedTools.filter(
    (name) =>
      DISCOVERY_TOOL_IDS.has(name) &&
      (READ_ONLY_TOOL_IDS as readonly string[]).includes(name),
  );
  return {
    ...base,
    maximumWorkspaceEffect: "read",
    allowedTools: allowed,
    allowedEffects: ["workspace_read"],
    approvalMode: "never",
    limits: {
      ...base.limits,
      maxToolCalls: Math.min(
        base.limits.maxToolCalls,
        DISCOVERY_PASS_POLICY.maxToolCalls,
      ),
    },
  };
}

export function isDiscoveryToolAllowed(name: string): boolean {
  return DISCOVERY_TOOL_IDS.has(name);
}

export function createDiscoveryTaskList(): TaskList {
  return new TaskListPipeline().createDiscoveryList();
}

export function isDiscoveryTaskList(taskList: TaskList | undefined): boolean {
  if (!taskList) {
    return false;
  }
  return taskList.purpose === "discovery" || taskList.source === "discovery";
}

export interface DiscoveryObservationCollector {
  filesRead: DiscoveryFileRef[];
  searchHits: Array<{ path: string; reason: string }>;
  verificationHints: DiscoveryVerificationHint[];
  fileReads: number;
  searches: number;
  toolCalls: number;
  omittedFilesRead: number;
  omittedSearchHits: number;
  omittedVerificationHints: number;
}

export function createDiscoveryObservationCollector(): DiscoveryObservationCollector {
  return {
    filesRead: [],
    searchHits: [],
    verificationHints: [],
    fileReads: 0,
    searches: 0,
    toolCalls: 0,
    omittedFilesRead: 0,
    omittedSearchHits: 0,
    omittedVerificationHints: 0,
  };
}

export function recordDiscoveryToolUse(params: {
  collector: DiscoveryObservationCollector;
  toolName: string;
  argumentsValue: unknown;
  resultOutput?: unknown;
  status: string;
}): void {
  const { collector, toolName, status } = params;
  collector.toolCalls += 1;
  if (status !== "succeeded") {
    return;
  }
  const args = asRecord(params.argumentsValue);
  const argumentPaths = collectPaths(args);
  const outputPaths = collectPathsFromUnknown(params.resultOutput);
  const paths = unique([...argumentPaths, ...outputPaths]);
  const reason = inferReason(toolName, args);

  if (FILE_READ_TOOLS.has(toolName)) {
    collector.fileReads += paths.length || 1;
    for (const path of paths) {
      pushCappedUniqueByPath(
        collector.filesRead,
        { path, reason },
        DISCOVERY_OBSERVATION_LIMITS.maxFilesRead,
        () => {
          collector.omittedFilesRead += 1;
        },
      );
    }
    return;
  }
  if (SEARCH_TOOLS.has(toolName)) {
    collector.searches += 1;
    for (const path of paths) {
      pushCappedUniqueByPath(
        collector.searchHits,
        { path, reason },
        DISCOVERY_OBSERVATION_LIMITS.maxSearchHits,
        () => {
          collector.omittedSearchHits += 1;
        },
      );
    }
    return;
  }
  if (toolName === "read_diagnostics") {
    pushCapped(
      collector.verificationHints,
      {
        kind: "typecheck",
        reason: "Read current diagnostics during discovery.",
      },
      DISCOVERY_OBSERVATION_LIMITS.maxVerificationHints,
      () => {
        collector.omittedVerificationHints += 1;
      },
    );
    for (const path of paths) {
      pushCappedUniqueByPath(
        collector.searchHits,
        { path, reason: "Diagnostic path" },
        DISCOVERY_OBSERVATION_LIMITS.maxSearchHits,
        () => {
          collector.omittedSearchHits += 1;
        },
      );
    }
    return;
  }
  if (toolName === "read_package_scripts") {
    pushCapped(
      collector.verificationHints,
      {
        kind: "unknown",
        reason: "Inspected package scripts for verification commands.",
      },
      DISCOVERY_OBSERVATION_LIMITS.maxVerificationHints,
      () => {
        collector.omittedVerificationHints += 1;
      },
    );
    return;
  }
  // list_directory / read_git_status / navigation: count the tool call but do
  // not promote directory children into change-surface searchHits.
  if (
    toolName === "list_directory" ||
    toolName === "read_git_status" ||
    toolName === "file_metadata"
  ) {
    return;
  }
  for (const path of paths) {
    pushCappedUniqueByPath(
      collector.searchHits,
      { path, reason },
      DISCOVERY_OBSERVATION_LIMITS.maxSearchHits,
      () => {
        collector.omittedSearchHits += 1;
      },
    );
  }
}

export function discoveryBudgetRemaining(
  collector: DiscoveryObservationCollector,
): boolean {
  return (
    collector.toolCalls < DISCOVERY_PASS_POLICY.maxToolCalls &&
    collector.fileReads < DISCOVERY_PASS_POLICY.maxFileReads &&
    collector.searches < DISCOVERY_PASS_POLICY.maxSearches
  );
}

/** Seed file reads must not be blocked just because search budget is spent. */
export function discoveryCanReadMore(
  collector: DiscoveryObservationCollector,
): boolean {
  return (
    collector.toolCalls < DISCOVERY_PASS_POLICY.maxToolCalls &&
    collector.fileReads < DISCOVERY_PASS_POLICY.maxFileReads
  );
}

/**
 * Model discovery may continue while any useful budget remains (reads or
 * searches), so shaped preflight exhausting searches does not skip the model.
 */
export function discoveryCanModelTurn(
  collector: DiscoveryObservationCollector,
): boolean {
  if (collector.toolCalls >= DISCOVERY_PASS_POLICY.maxToolCalls) {
    return false;
  }
  return (
    collector.fileReads < DISCOVERY_PASS_POLICY.maxFileReads ||
    collector.searches < DISCOVERY_PASS_POLICY.maxSearches
  );
}

export function toDiscoveryObservation(params: {
  objective: string;
  collector: DiscoveryObservationCollector;
  explicitTargets: DiscoveryTarget[];
  constraints: string[];
}): DiscoveryObservation {
  const notes = discoveryOverflowNotes(params.collector);
  return {
    schemaVersion: 1,
    objective: params.objective,
    filesRead: params.collector.filesRead,
    searchHits: params.collector.searchHits,
    explicitTargets: params.explicitTargets.slice(
      0,
      DISCOVERY_OBSERVATION_LIMITS.maxExplicitTargets,
    ),
    constraints: params.constraints.slice(
      0,
      DISCOVERY_OBSERVATION_LIMITS.maxConstraints,
    ),
    verificationHints: params.collector.verificationHints,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

export function hasDiscoveryReadPath(
  collector: DiscoveryObservationCollector,
  path: string,
): boolean {
  const normalized = normalizeDiscoveryPath(path);
  if (!normalized) {
    return false;
  }
  return collector.filesRead.some(
    (file) => normalizeDiscoveryPath(file.path) === normalized,
  );
}

/** Cap for injecting deterministic seed-read bodies into the discovery prompt. */
const DISCOVERY_PRE_READ_MAX_CHARS_PER_FILE = 4_000;
const DISCOVERY_PRE_READ_MAX_TOTAL_CHARS = 16_000;

/**
 * Format seed-read file bodies so the discovery model sees content, not only
 * path names (avoids "Already pre-read" re-read loops).
 */
export function formatDiscoveryPreReadEvidence(
  entries: readonly { path: string; content: string }[],
  options?: { maxCharsPerFile?: number; maxTotalChars?: number },
): string {
  const maxPerFile =
    options?.maxCharsPerFile ?? DISCOVERY_PRE_READ_MAX_CHARS_PER_FILE;
  const maxTotal =
    options?.maxTotalChars ?? DISCOVERY_PRE_READ_MAX_TOTAL_CHARS;
  const blocks: string[] = [];
  let used = 0;
  for (const entry of entries) {
    const path = entry.path.trim();
    if (!path || used >= maxTotal) {
      break;
    }
    const remaining = maxTotal - used;
    const budget = Math.min(maxPerFile, remaining);
    let body = entry.content;
    let truncated = false;
    if (body.length > budget) {
      body = body.slice(0, Math.max(0, budget - 20));
      truncated = true;
    }
    const block = truncated
      ? `### ${path}\n${body}\n…(truncated)`
      : `### ${path}\n${body}`;
    blocks.push(block);
    used += block.length;
  }
  if (blocks.length === 0) {
    return "";
  }
  return [
    "<pre_read_evidence trust=\"workspace-read\">",
    ...blocks,
    "</pre_read_evidence>",
  ].join("\n");
}

export function extractDiscoveryReadText(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (!output || typeof output !== "object") {
    return "";
  }
  const record = output as Record<string, unknown>;
  for (const key of ["content", "text", "data"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  try {
    return JSON.stringify(output);
  } catch {
    return "";
  }
}

export function buildDiscoveryPrompt(params: {
  query: string;
  objective: string;
  preferredPaths?: readonly string[];
  shapedDiscovery?: {
    preferredPathsLabel?: string;
    discoverySystemHint?: string;
  };
}): { system: string; user: string } {
  const preferred = (params.preferredPaths ?? [])
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
    .slice(0, 8);
  const defaultPreferredLabel =
    "Preferred paths (read these first; do not start at README.md or package.json unless listed):";
  const preferredBlock =
    preferred.length > 0
      ? [
          params.shapedDiscovery?.preferredPathsLabel ?? defaultPreferredLabel,
          ...preferred.map((path) => `- ${path}`),
        ].join("\n")
      : undefined;
  return {
    system: [
      "You are doing a bounded read-only discovery pass.",
      "Find the concrete files, symbols, and verification checks for the request.",
      "Use only read/search tools. Do not mutate files, run writes, or draft a plan.",
      "When preferred paths are listed, read those first before exploring elsewhere.",
      "If <pre_read_evidence> is present, those file bodies are already available — do not re-read them.",
      params.shapedDiscovery?.discoverySystemHint,
      "Stop after you have identified the smallest change surfaces.",
    ]
      .filter((part): part is string => Boolean(part))
      .join(" "),
    user: [
      `Request: ${params.query}`,
      `Objective: ${params.objective}`,
      preferredBlock,
      "Read the most relevant entrypoints and nearby tests, then stop.",
    ]
      .filter((part): part is string => Boolean(part))
      .join("\n"),
  };
}

function collectPaths(args: Record<string, unknown>): string[] {
  const values: string[] = [];
  const single = asString(args.path) ?? asString(args.relativePath);
  if (single) values.push(single);
  const list = args.paths ?? args.files;
  if (Array.isArray(list)) {
    for (const item of list) {
      if (typeof item === "string") {
        values.push(item);
        continue;
      }
      const record = asRecord(item);
      const path = asString(record.path) ?? asString(record.relativePath);
      if (path) values.push(path);
    }
  }
  return unique(values);
}

function collectPathsFromUnknown(value: unknown): string[] {
  const values: string[] = [];
  collectPathLikeValues(value, values, 0);
  return unique(values);
}

function collectPathLikeValues(
  value: unknown,
  values: string[],
  depth: number,
  keyHint = "",
): void {
  if (depth > 6) {
    return;
  }
  if (typeof value === "string") {
    if (isPathKey(keyHint) && looksLikeRelativePath(value)) {
      values.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPathLikeValues(item, values, depth + 1, keyHint);
    }
    return;
  }
  const record = asRecord(value);
  for (const [key, child] of Object.entries(record)) {
    collectPathLikeValues(child, values, depth + 1, key);
  }
}

function isPathKey(key: string): boolean {
  return /^(?:path|relativePath|file|filePath|uri|target|ref)$/i.test(key);
}

function looksLikeRelativePath(value: string): boolean {
  const path = value.trim().replace(/\\/g, "/");
  return (
    path.length > 0 &&
    path.length <= 1_000 &&
    !path.startsWith("/") &&
    !path.startsWith("~") &&
    !path.includes("..") &&
    !/^[A-Za-z]:\//.test(path) &&
    (path.includes("/") || /\.\w{1,16}$/.test(path))
  );
}

function inferReason(
  toolName: string,
  args: Record<string, unknown>,
): string {
  const query = asString(args.query) ?? asString(args.pattern);
  if (query) {
    return `${toolName}: ${query}`.slice(0, 500);
  }
  const path = asString(args.path);
  if (path) {
    return `${toolName} ${path}`.slice(0, 500);
  }
  return `Observed via ${toolName}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizeDiscoveryPath(value: string): string {
  return value
    .trim()
    .replace(/^@+/, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function pushCapped<T>(
  values: T[],
  value: T,
  max: number,
  onOmitted: () => void,
): void {
  if (values.length >= max) {
    onOmitted();
    return;
  }
  values.push(value);
}

function pushCappedUniqueByPath<T extends { path: string }>(
  values: T[],
  value: T,
  max: number,
  onOmitted: () => void,
): void {
  if (values.some((item) => item.path === value.path)) {
    return;
  }
  pushCapped(values, value, max, onOmitted);
}

function discoveryOverflowNotes(
  collector: DiscoveryObservationCollector,
): string[] {
  const notes: string[] = [];
  if (collector.omittedFilesRead > 0) {
    notes.push(
      `Discovery omitted ${collector.omittedFilesRead} file read observation(s) after reaching the ${DISCOVERY_OBSERVATION_LIMITS.maxFilesRead} item evidence limit.`,
    );
  }
  if (collector.omittedSearchHits > 0) {
    notes.push(
      `Discovery omitted ${collector.omittedSearchHits} search hit(s) after reaching the ${DISCOVERY_OBSERVATION_LIMITS.maxSearchHits} item evidence limit.`,
    );
  }
  if (collector.omittedVerificationHints > 0) {
    notes.push(
      `Discovery omitted ${collector.omittedVerificationHints} verification hint(s) after reaching the ${DISCOVERY_OBSERVATION_LIMITS.maxVerificationHints} item evidence limit.`,
    );
  }
  return notes.slice(0, DISCOVERY_OBSERVATION_LIMITS.maxNotes);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
