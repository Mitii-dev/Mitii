import {
  CHANGE_IMPACT_TOOL_IDS,
  CODE_INTELLIGENCE_TOOL_IDS,
  DIAGNOSTICS_TOOL_IDS,
  READ_ONLY_TOOL_IDS,
  type ToolGrant,
} from "../../../../modules/decision-policy";
import type {
  DiscoveryObservation,
  DiscoveryTarget,
} from "../../../../modules/planning";
import { DISCOVERY_OBSERVATION_LIMITS } from "../../../../modules/planning";
import type { TaskList } from "../../../../modules/task-list";
import { TaskListPipeline } from "../../../../modules/task-list";

import {
  asRecord,
  collectPaths,
  collectStructuredToolPaths,
  collectPathsFromUnknown,
  unique,
  pushCapped,
  pushCappedUniqueByPath,
  inferReason,
  collectSymbolNames,
  attachSymbolsToFileRead,
  normalizeDiscoveryPath,
  discoveryOverflowNotes,
} from "./discoverySupport";

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
  "directory_tree",
  "read_file",
  "read_many_files",
  "glob_files",
  "file_metadata",
  "search_files",
  ...DIAGNOSTICS_TOOL_IDS,
  "read_git_status",
  ...CODE_INTELLIGENCE_TOOL_IDS,
  ...CHANGE_IMPACT_TOOL_IDS,
  "read_package_scripts",
]);

const FILE_READ_TOOLS = new Set(["read_file", "read_many_files"]);
const SEARCH_TOOLS = new Set(["search_files", "glob_files"]);
const SYMBOL_TOOLS = new Set<string>([...CODE_INTELLIGENCE_TOOL_IDS]);

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

import type { DiscoveryObservationCollector } from "./discoveryTypes";

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
  const structuredPaths = collectStructuredToolPaths(
    toolName,
    args,
    params.resultOutput,
  );
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
  if (toolName === "list_directory" || toolName === "directory_tree") {
    for (const path of structuredPaths) {
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
  // read_git_status / metadata: count the tool call but do not promote broad
  // repository metadata into change-surface searchHits.
  if (
    toolName === "read_git_status" ||
    toolName === "file_metadata"
  ) {
    return;
  }
  if (SYMBOL_TOOLS.has(toolName)) {
    const symbols = collectSymbolNames(args, params.resultOutput);
    for (const path of paths) {
      attachSymbolsToFileRead(collector, path, reason, symbols);
      pushCappedUniqueByPath(
        collector.searchHits,
        { path, reason: `${reason} (symbol)` },
        DISCOVERY_OBSERVATION_LIMITS.maxSearchHits,
        () => {
          collector.omittedSearchHits += 1;
        },
      );
    }
    // workspace_symbol may return names without paths — keep as notes via hits.
    if (paths.length === 0 && symbols.length > 0) {
      for (const symbol of symbols.slice(0, 8)) {
        pushCappedUniqueByPath(
          collector.searchHits,
          { path: symbol, reason: `${toolName} symbol` },
          DISCOVERY_OBSERVATION_LIMITS.maxSearchHits,
          () => {
            collector.omittedSearchHits += 1;
          },
        );
      }
    }
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

/** True when at least one discovery file read has attached code-intel symbols. */
export function discoveryHasSymbolEvidence(
  collector: DiscoveryObservationCollector,
): boolean {
  return collector.filesRead.some(
    (file) => Array.isArray(file.symbols) && file.symbols.length > 0,
  );
}

