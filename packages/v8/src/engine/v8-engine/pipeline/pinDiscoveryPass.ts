import type { ExecutionDecision } from "../../../modules/decision-policy";
import { CODE_INTELLIGENCE_TOOL_IDS } from "../../../modules/decision-policy";
import type { ModelMessage } from "../../../modules/model-gateway";
import { compileDiscoveryBrief } from "../../../modules/planning";
import type {
  DiscoveryBrief,
  DiscoveryTarget,
  PlanningInput,
} from "../../../modules/planning";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";

import {
  filterToolDefinitions,
  inferDiscoveryTargetKind,
} from "../actions";
import {
  isPlanDiscoveryEvidenceSufficient,
  resolvePlanDiscoveryMinSearches,
  shouldPreferDiscoverySymbolEvidence,
  shouldRequireDiscoverySymbolEvidence,
  resolveDiscoveryPassBudget,
} from "../modules/plan-discovery";
import type { DiscoveryPassBudget } from "../modules/plan-discovery";
import type { AgentReasonCode } from "../contracts";
import {
  buildDiscoveryPrompt,
  createDiscoveryGrant,
  createDiscoveryObservationCollector,
  createDiscoveryTaskList,
  formatDiscoveryPreReadEvidence,
  isDiscoveryToolAllowed,
  toDiscoveryObservation,
} from "../internal/discovery";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import { DEFAULT_TOOL_DEFINITIONS } from "../legacy/policy";
import type { AgentEngineRuntime } from "./runtime";
import { runDiscoverySeedAndShapedPreflight } from "./pinDiscoveryPreflight";
import {
  buildDiscoveryFailureWarning,
  buildDiscoveryQualityFloorNudge,
} from "./pinDiscoveryPassNudges";
import {
  runDiscoveryPassModelLoop,
  type DiscoveryPassStopReason,
} from "./pinDiscoveryPassLoop";

export async function runDiscoveryPass(
  runtime: AgentEngineRuntime,
  params: {
    runId: string;
    query: string;
    objective: string;
    evidence: PlanningInput["evidence"];
    decision: ExecutionDecision;
    pinnedState: RepositoryStateReference | undefined;
    workspaceRoot: string | undefined;
    bus: EventBus;
    signal: AbortSignal;
    budget: RunBudgetTracker;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
    taskListRef: TaskListRef;
    windowPolicy: WindowPolicy;
    preferredPaths?: readonly string[];
    /** Index + user-named paths used to validate `preferredPaths` before reads. */
    seedPathHygiene?: {
      knownPaths?: readonly string[];
      trustedPaths?: readonly string[];
    };
    /** Plan mode (non-quick): require file-backed discovery before treating pass as success. */
    qualityFloor?: boolean;
    /** Plan / Agent-visible: multi-file multi-surface thoroughness bar. */
    thoroughEvidence?: boolean;
    /**
     * Medium/large: prefer trusted seed/explicit paths first; only run shaped
     * search when seeds are insufficient.
     */
    seedFirstDiscovery?: boolean;
    /**
     * Plan thorough: do not skip shaped/search solely because preferred paths
     * already name a file — force real exploration.
     */
    forceExploration?: boolean;
    /** Soft symbol nudge even when thoroughEvidence is off (medium band). */
    preferSymbols?: boolean;
    /** Officer taskSize for discovery envelope. */
    taskSize?: "small" | "medium" | "large" | string;
    /**
     * After A/B/C scope lock: shrink the discovery envelope (default factor
     * applied by caller via scaleDiscoveryPassBudget).
     */
    discoveryBudgetOverride?: DiscoveryPassBudget;
    /** Injected when preferred paths were narrowed to a chosen plan scope. */
    discoveryScopeHint?: string;
  },
): Promise<{
  brief: DiscoveryBrief;
  failed: boolean;
  collector: ReturnType<typeof createDiscoveryObservationCollector>;
}> {
  const {
    runId,
    query,
    objective,
    evidence,
    decision,
    pinnedState,
    workspaceRoot,
    bus,
    signal,
    budget,
    reasonCodes,
    warnings,
    taskListRef,
    windowPolicy,
    preferredPaths = [],
    qualityFloor = false,
    thoroughEvidence = false,
    seedFirstDiscovery = false,
    forceExploration = false,
    preferSymbols = false,
    taskSize,
    discoveryBudgetOverride,
    discoveryScopeHint,
  } = params;

  runtime.emitStage(bus, runId, "discovery", "started");
  runtime.emit(bus, {
    type: "discovery_started",
    runId,
    objective: objective.slice(0, 500),
    at: runtime.isoNow(),
  });
  reasonCodes.push("discovery_started");

  const discoveryBudget =
    discoveryBudgetOverride ??
    resolveDiscoveryPassBudget(taskSize, windowPolicy.contextWindowTokens);
  const discoveryList = createDiscoveryTaskList();
  taskListRef.current = discoveryList;
  runtime.emitTaskListUpdated(bus, runId, discoveryList);

  const collector = createDiscoveryObservationCollector(discoveryBudget);
  const explicitTargets: DiscoveryTarget[] = (evidence.targets ?? []).map(
    (target) => ({
      kind: inferDiscoveryTargetKind(target.kind),
      value: target.value,
      reason: target.explicit ? "Explicit request target" : "Inferred target",
      explicit: target.explicit,
    }),
  );

  const canLoop =
    Boolean(runtime.deps.tools) &&
    Boolean(workspaceRoot) &&
    runtime.deps.llm.capabilities.supportsTools &&
    !signal.aborted;

  let stopReason: DiscoveryPassStopReason = "natural";
  const preferSymbolEvidence = shouldPreferDiscoverySymbolEvidence({
    thorough: thoroughEvidence,
    preferSymbols,
    allowedTools: decision.toolGrant.allowedTools,
    reasonCodes: decision.reasonCodes,
    codeIntelligenceToolIds: CODE_INTELLIGENCE_TOOL_IDS,
  });
  const canForceTools =
    runtime.deps.llm.capabilities.supportsForcedToolChoice !== false;
  const requireSymbolEvidence = shouldRequireDiscoverySymbolEvidence({
    thorough: thoroughEvidence,
    allowedTools: decision.toolGrant.allowedTools,
    reasonCodes: decision.reasonCodes,
    codeIntelligenceToolIds: CODE_INTELLIGENCE_TOOL_IDS,
    supportsForcedToolChoice: canForceTools,
  });
  const minSearches = resolvePlanDiscoveryMinSearches({
    thorough: thoroughEvidence,
    taskSize,
  });
  if (preferSymbolEvidence && !requireSymbolEvidence) {
    warnings.push(
      "Code-intelligence tools are granted but this model cannot force tool_choice=required; discovery will nudge for symbols without failing the quality floor.",
    );
  }

  if (canLoop) {
    const grant = createDiscoveryGrant(decision.toolGrant, discoveryBudget);
    const tools = filterToolDefinitions({
      grant,
      definitions: runtime.deps.toolDefinitions ?? DEFAULT_TOOL_DEFINITIONS,
      supportsTools: true,
    }).filter((tool) => isDiscoveryToolAllowed(tool.name));

    const {
      uniqueSeeds,
      shapedProfile,
      shapedSeeds,
      seeds,
      rankedPreferred,
      preReadByPath,
      perFileChars,
    } = await runDiscoverySeedAndShapedPreflight({
      runtime,
      runId,
      bus,
      budget,
      collector,
      grant,
      workspaceRoot: workspaceRoot!,
      pinnedState,
      windowPolicy,
      query,
      preferredPaths,
      seedPathHygiene: params.seedPathHygiene,
      qualityFloor,
      seedFirstDiscovery,
      forceExploration,
      discoveryBudget,
      signal,
      reasonCodes,
    });

    const promptSeeds =
      uniqueSeeds.length > 0
        ? uniqueSeeds
        : [...shapedSeeds, ...rankedPreferred].slice(0, 6);
    const shapedHint = shapedProfile?.discoverySystemHint;
    const scopeHint = discoveryScopeHint?.trim();
    const mergedSystemHint =
      shapedHint && scopeHint
        ? `${shapedHint} ${scopeHint}`
        : shapedHint ?? scopeHint;
    const prompt = buildDiscoveryPrompt({
      query,
      objective,
      preferredPaths: promptSeeds,
      shapedDiscovery: {
        preferredPathsLabel: shapedProfile?.preferredPathsLabel,
        ...(mergedSystemHint
          ? { discoverySystemHint: mergedSystemHint }
          : {}),
      },
    });
    const qualityFloorNudge = buildDiscoveryQualityFloorNudge({
      thoroughEvidence,
      preferSymbolEvidence,
    });
    const preReadEvidence = formatDiscoveryPreReadEvidence(
      [...preReadByPath.entries()].map(([path, content]) => ({ path, content })),
      {
        maxCharsPerFile: perFileChars,
        maxTotalChars: Math.min(
          16_000,
          windowPolicy.compaction.toolResultContentChars * 4,
        ),
      },
    );
    const preReadPaths = [...preReadByPath.keys()];
    const userParts = [prompt.user];
    if (preReadEvidence.length > 0) {
      userParts.push(
        preReadEvidence,
        `Contents above were already read for: ${preReadPaths.join(", ")}. Do not call read_file again for those paths unless nextStartLine/uncovered lines are needed. Prefer read_file({ path, startLine: nextStartLine }) for remainder. Continue only if more surfaces are needed.`,
      );
      if (preferSymbolEvidence) {
        userParts.push(
          "Entrypoints above are already read — call document_symbol or goto_definition on them next to name key types/functions.",
        );
      }
    } else if (seeds.length > 0) {
      userParts.push(
        `Already pre-read: ${seeds.join(", ")}. Continue only if more surfaces are needed.`,
      );
    }
    if (qualityFloor && collector.fileReads === 0) {
      userParts.push(qualityFloorNudge);
    }
    const messages: ModelMessage[] = [
      { role: "system", content: prompt.system },
      { role: "user", content: userParts.join("\n\n") },
    ];

    stopReason = await runDiscoveryPassModelLoop({
      runtime,
      runId,
      bus,
      signal,
      budget,
      warnings,
      windowPolicy,
      workspaceRoot: workspaceRoot!,
      pinnedState,
      grant,
      tools,
      messages,
      collector,
      discoveryBudget,
      qualityFloor,
      preferSymbolEvidence,
      minSearches,
      canForceTools,
      qualityFloorNudge,
      preReadByPath,
      perFileChars,
      stopReason,
    });
  } else {
    reasonCodes.push("discovery_skipped");
  }

  const brief = compileDiscoveryBrief(
    toDiscoveryObservation({
      objective,
      collector,
      explicitTargets,
      constraints: evidence.constraints ?? [],
    }),
  );
  const failed = qualityFloor
    ? !isPlanDiscoveryEvidenceSufficient(brief, {
        thorough: thoroughEvidence,
        requireSymbolEvidence,
        minSearches,
        searchCount: collector.searches,
      })
    : brief.confidence === "low" && brief.proposedChangeSurfaces.length === 0;
  reasonCodes.push(failed ? "discovery_failed" : "discovery_completed");
  runtime.emit(bus, {
    type: "discovery_completed",
    runId,
    confidence: brief.confidence,
    fileCount: brief.filesRead.length,
    surfaceCount: brief.proposedChangeSurfaces.length,
    openQuestionCount: brief.openQuestions.length,
    brief,
    stopReason,
    qualityFloorMet: !failed,
    at: runtime.isoNow(),
  });
  runtime.emitStage(bus, runId, "discovery", "completed", [
    failed ? "discovery_failed" : "discovery_completed",
  ]);
  if (failed) {
    warnings.push(
      buildDiscoveryFailureWarning({ qualityFloor, thoroughEvidence }),
    );
  }
  return { brief, failed, collector };
}
