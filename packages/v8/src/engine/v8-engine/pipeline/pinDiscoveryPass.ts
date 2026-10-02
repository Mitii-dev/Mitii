import type {
  ExecutionDecision,
} from "../../../modules/decision-policy";
import type { ModelMessage } from "../../../modules/model-gateway";
import { compileDiscoveryBrief } from "../../../modules/planning";
import type {
  DiscoveryBrief,
  DiscoveryTarget,
  PlanningInput,
} from "../../../modules/planning";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../tool-runtime";

import {
  filterToolDefinitions,
  serializeToolResultForModel,
  inferDiscoveryTargetKind,
  resolveReasoningProgressBudget,
  summarizeToolCall,
  extractFileReadPaths,
} from "../actions";
import {
  collectShapedDiscoveryHits,
  hasExplicitFilePathTargets,
  rankPathsForShapedDiscovery,
  resolveShapedDiscoveryProfile,
  selectShapedDiscoverySeeds,
} from "../actions/shapedDiscovery";
import {
  isPlanDiscoveryEvidenceSufficient,
  shouldPreferDiscoverySymbolEvidence,
  shouldRequireDiscoverySymbolEvidence,
} from "../modules/plan-discovery";
import type {
  AgentReasonCode,
} from "../contracts";
import {
  DISCOVERY_PASS_POLICY,
  buildDiscoveryPrompt,
  createDiscoveryGrant,
  createDiscoveryObservationCollector,
  createDiscoveryTaskList,
  discoveryBudgetRemaining,
  discoveryCanModelTurn,
  discoveryCanReadMore,
  discoveryHasSymbolEvidence,
  formatDiscoveryPreReadEvidence,
  extractDiscoveryReadText,
  hasDiscoveryReadPath,
  isDiscoveryToolAllowed,
  recordDiscoveryToolUse,
  toDiscoveryObservation,
} from "../internal/discovery";
import { CODE_INTELLIGENCE_TOOL_IDS } from "../../../modules/decision-policy";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import { DEFAULT_TOOL_DEFINITIONS } from "../legacy/policy";
import type { AgentEngineRuntime } from "./runtime";
import { consumeModelTurn } from "./consumeModelTurn";
import { executeDiscoveryToolCall } from "./pinDiscoveryTools";

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
  /** Plan mode (non-quick): require file-backed discovery before treating pass as success. */
  qualityFloor?: boolean;
  /** Plan / Agent-visible: multi-file multi-surface thoroughness bar. */
  thoroughEvidence?: boolean;
  /**
   * Medium/large: prefer trusted seed/explicit paths first; only run shaped
   * search when seeds are insufficient.
   */
  seedFirstDiscovery?: boolean;
  /** Soft symbol nudge even when thoroughEvidence is off (medium band). */
  preferSymbols?: boolean;
}): Promise<{
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
    preferSymbols = false,
  } = params;

  runtime.emitStage(bus, runId, "discovery", "started");
  runtime.emit(bus, {
    type: "discovery_started",
    runId,
    objective: objective.slice(0, 500),
    at: runtime.isoNow(),
  });
  reasonCodes.push("discovery_started");

  const discoveryList = createDiscoveryTaskList();
  taskListRef.current = discoveryList;
  runtime.emitTaskListUpdated(bus, runId, discoveryList);

  const collector = createDiscoveryObservationCollector();
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

  let stopReason: "natural" | "turn_cap" | "budget_exhausted" | "aborted" | "model_error" =
    "natural";
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
  if (preferSymbolEvidence && !requireSymbolEvidence) {
    warnings.push(
      "Code-intelligence tools are granted but this model cannot force tool_choice=required; discovery will nudge for symbols without failing the quality floor.",
    );
  }
  if (canLoop) {
    const grant = createDiscoveryGrant(decision.toolGrant);
    const tools = filterToolDefinitions({
      grant,
      definitions:
        runtime.deps.toolDefinitions ?? DEFAULT_TOOL_DEFINITIONS,
      supportsTools: true,
    }).filter((tool) => isDiscoveryToolAllowed(tool.name));

    // Deterministic shaped-discovery preflight + preferred-path pre-read.
    const shapedProfile = resolveShapedDiscoveryProfile(query);
    const rankedPreferred = shapedProfile
      ? rankPathsForShapedDiscovery(shapedProfile, preferredPaths)
      : preferredPaths;
    // When the prompt already names concrete files, skip broad shaped globs
    // (**/routes/**/*.ts etc.) and seed-read those paths instead.
    // Medium seed-first: same — prefer trusted/explicit seeds before shaped search.
    const hasSeedFilePaths = hasExplicitFilePathTargets([
      ...rankedPreferred,
      ...preferredPaths,
    ]);
    let skipShapedSearch = hasSeedFilePaths;
    if (skipShapedSearch) {
      reasonCodes.push("discovery_explicit_paths_skip_shaped_search");
    }
    if (seedFirstDiscovery && hasSeedFilePaths) {
      reasonCodes.push("discovery_seed_first");
    }
    let globHits: string[] =
      shapedProfile && !skipShapedSearch
        ? await collectShapedDiscoveryHits({
            profile: shapedProfile,
            shouldContinue: () =>
              discoveryBudgetRemaining(collector) &&
              collector.searches < DISCOVERY_PASS_POLICY.maxSearches &&
              !signal.aborted,
            executeTool: async (toolName, argumentsValue) => {
              const result = await executeDiscoveryToolCall(runtime, {
                runId,
                bus,
                budget,
                collector,
                grant,
                workspaceRoot: workspaceRoot!,
                pinnedState,
                windowPolicy,
                toolName,
                argumentsValue,
              });
              return result?.output;
            },
          })
        : [];
    let shapedSeeds = shapedProfile
      ? selectShapedDiscoverySeeds(shapedProfile, globHits, rankedPreferred)
      : [];
    // Quality floor: if scoring filtered every hit, still try top ranked paths.
    let qualityFallbackSeeds =
      qualityFloor && shapedSeeds.length === 0 && shapedProfile && !skipShapedSearch
        ? rankPathsForShapedDiscovery(shapedProfile, globHits).slice(0, 4)
        : [];
    // Seed-first: preferred / trusted paths before shaped hits.
    const seeds = (
      seedFirstDiscovery
        ? [
            ...rankedPreferred,
            ...preferredPaths,
            ...shapedSeeds,
            ...qualityFallbackSeeds,
          ]
        : [
            ...shapedSeeds,
            ...qualityFallbackSeeds.filter((path) => !shapedSeeds.includes(path)),
            ...rankedPreferred.filter(
              (path) =>
                !shapedSeeds.includes(path) &&
                !qualityFallbackSeeds.includes(path),
            ),
          ]
    )
      .map((path) => path.trim())
      .filter((path) => path.length > 0 && path.includes("."));
    const uniqueSeeds: string[] = [];
    const seenSeed = new Set<string>();
    for (const path of seeds) {
      const key = path.replace(/\\/g, "/").toLowerCase();
      if (seenSeed.has(key)) continue;
      seenSeed.add(key);
      uniqueSeeds.push(path);
      if (uniqueSeeds.length >= Math.min(6, DISCOVERY_PASS_POLICY.maxFileReads)) {
        break;
      }
    }
    const preReadByPath = new Map<string, string>();
    const perFileChars = Math.min(
      4_000,
      windowPolicy.compaction.toolResultContentChars,
    );
    for (const seedPath of uniqueSeeds) {
      // Do not gate seed reads on search budget — shaped preflight often
      // spends the search allotment before any file is opened.
      if (!discoveryCanReadMore(collector) || signal.aborted) {
        break;
      }
      if (hasDiscoveryReadPath(collector, seedPath)) {
        continue;
      }
      const seedResult = await executeDiscoveryToolCall(runtime, {
        runId,
        bus,
        budget,
        collector,
        grant,
        workspaceRoot: workspaceRoot!,
        pinnedState,
        windowPolicy,
        toolName: "read_file",
        argumentsValue: { path: seedPath },
      });
      if (seedResult?.status === "succeeded") {
        const text = extractDiscoveryReadText(seedResult.output);
        if (text.length > 0) {
          preReadByPath.set(
            seedPath.replace(/\\/g, "/").replace(/^\.\//, ""),
            text.slice(0, perFileChars),
          );
        }
      }
    }

    // Medium seed-first with empty preferred paths: run shaped search now.
    // Or when preferred seeds failed to open any file — fall back to shaped.
    if (
      seedFirstDiscovery &&
      skipShapedSearch &&
      shapedProfile &&
      preReadByPath.size === 0 &&
      discoveryBudgetRemaining(collector) &&
      !signal.aborted
    ) {
      skipShapedSearch = false;
      reasonCodes.push("discovery_seed_insufficient_shaped_fallback");
      globHits = await collectShapedDiscoveryHits({
        profile: shapedProfile,
        shouldContinue: () =>
          discoveryBudgetRemaining(collector) &&
          collector.searches < DISCOVERY_PASS_POLICY.maxSearches &&
          !signal.aborted,
        executeTool: async (toolName, argumentsValue) => {
          const result = await executeDiscoveryToolCall(runtime, {
            runId,
            bus,
            budget,
            collector,
            grant,
            workspaceRoot: workspaceRoot!,
            pinnedState,
            windowPolicy,
            toolName,
            argumentsValue,
          });
          return result?.output;
        },
      });
      shapedSeeds = selectShapedDiscoverySeeds(
        shapedProfile,
        globHits,
        rankedPreferred,
      );
      qualityFallbackSeeds =
        qualityFloor && shapedSeeds.length === 0
          ? rankPathsForShapedDiscovery(shapedProfile, globHits).slice(0, 4)
          : [];
      for (const seedPath of [...shapedSeeds, ...qualityFallbackSeeds]) {
        if (!discoveryCanReadMore(collector) || signal.aborted) break;
        if (hasDiscoveryReadPath(collector, seedPath)) continue;
        const seedResult = await executeDiscoveryToolCall(runtime, {
          runId,
          bus,
          budget,
          collector,
          grant,
          workspaceRoot: workspaceRoot!,
          pinnedState,
          windowPolicy,
          toolName: "read_file",
          argumentsValue: { path: seedPath },
        });
        if (seedResult?.status === "succeeded") {
          const text = extractDiscoveryReadText(seedResult.output);
          if (text.length > 0) {
            preReadByPath.set(
              seedPath.replace(/\\/g, "/").replace(/^\.\//, ""),
              text.slice(0, perFileChars),
            );
          }
        }
      }
    }

    const promptSeeds =
      uniqueSeeds.length > 0
        ? uniqueSeeds
        : [...shapedSeeds, ...rankedPreferred].slice(0, 6);
    const prompt = buildDiscoveryPrompt({
      query,
      objective,
      preferredPaths: promptSeeds,
      shapedDiscovery: shapedProfile,
    });
    const qualityFloorNudge = thoroughEvidence
      ? preferSymbolEvidence
        ? "Plan quality floor (thorough): before finishing, read at least two concrete source/config files, call document_symbol or goto_definition on entrypoints to attach key symbols, and identify change surfaces."
        : "Plan quality floor (thorough): before finishing, read at least two concrete source/config files and identify key functions/symbols (document_symbol / goto_definition on entrypoints) plus change surfaces."
      : "Plan quality floor: before finishing, read at least one concrete source/config file that discovery identified.";
    const symbolEvidenceNudge =
      "Symbol evidence still missing: call document_symbol or goto_definition on an entrypoint already read (or a preferred path) before finishing discovery.";
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

    let turn = 0;
    let qualityFloorNudged = false;
    let symbolEvidenceNudged = false;
    for (; turn < DISCOVERY_PASS_POLICY.maxModelTurns; turn += 1) {
      if (signal.aborted) {
        stopReason = "aborted";
        break;
      }
      if (!discoveryCanModelTurn(collector) || !budget.canStartModelCall()) {
        stopReason = "budget_exhausted";
        break;
      }
      const needsFileEvidence =
        qualityFloor && collector.fileReads === 0 && tools.length > 0;
      const needsSymbolEvidence =
        qualityFloor &&
        preferSymbolEvidence &&
        collector.fileReads > 0 &&
        !discoveryHasSymbolEvidence(collector) &&
        tools.length > 0;
      const needsForcedTools =
        canForceTools && (needsFileEvidence || needsSymbolEvidence);
      budget.recordModelCall();
      const discoveryReasoningBudget = resolveReasoningProgressBudget({
        supportsReasoning: runtime.deps.llm.capabilities.supportsReasoning,
      });
      const turnResult = await consumeModelTurn(runtime, {
        llm: runtime.deps.llm,
        request: {
          messages: [...messages],
          tools,
          temperature: 0,
          maximumOutputTokens: 800,
          stream: false,
          toolChoice: needsForcedTools
            ? "required"
            : tools.length > 0
              ? "auto"
              : "none",
        },
        runId,
        signal,
        bus,
        maxReasoningCharsWithoutProgress: discoveryReasoningBudget.baseChars,
        tightReasoningCharsWhenChannelActive:
          discoveryReasoningBudget.tightChars,
      });
      if (turnResult.kind !== "completed") {
        stopReason = turnResult.kind === "cancelled" ? "aborted" : "model_error";
        break;
      }
      const toolCalls = turnResult.toolCalls.filter((call) =>
        isDiscoveryToolAllowed(call.name),
      );
      if (toolCalls.length === 0) {
        if (
          qualityFloor &&
          collector.fileReads === 0 &&
          !qualityFloorNudged &&
          turn + 1 < DISCOVERY_PASS_POLICY.maxModelTurns
        ) {
          qualityFloorNudged = true;
          messages.push({
            role: "assistant",
            content: turnResult.content,
          });
          messages.push({
            role: "user",
            content: qualityFloorNudge,
          });
          continue;
        }
        if (
          qualityFloor &&
          preferSymbolEvidence &&
          collector.fileReads > 0 &&
          !discoveryHasSymbolEvidence(collector) &&
          !symbolEvidenceNudged &&
          turn + 1 < DISCOVERY_PASS_POLICY.maxModelTurns
        ) {
          symbolEvidenceNudged = true;
          messages.push({
            role: "assistant",
            content: turnResult.content,
          });
          messages.push({
            role: "user",
            content: symbolEvidenceNudge,
          });
          continue;
        }
        // Model chose to stop calling tools — a natural finish.
        break;
      }
      messages.push({
        role: "assistant",
        content: turnResult.content,
        toolCalls,
      });
      let executedFreshTool = false;
      for (const toolCall of toolCalls) {
        if (!discoveryBudgetRemaining(collector) || signal.aborted) {
          break;
        }
        let argumentsValue: unknown = {};
        try {
          argumentsValue =
            toolCall.arguments.trim().length === 0
              ? {}
              : JSON.parse(toolCall.arguments);
        } catch {
          argumentsValue = {};
          warnings.push(
            `Invalid JSON arguments for tool ${toolCall.name}.`,
          );
        }
        const summary = summarizeToolCall(toolCall.name, argumentsValue);
        const readPath =
          typeof (argumentsValue as { path?: unknown }).path === "string"
            ? (argumentsValue as { path: string }).path
            : undefined;
        const normalizedReadPath = readPath
          ? readPath.replace(/\\/g, "/").replace(/^\.\//, "")
          : undefined;
        if (
          normalizedReadPath &&
          (toolCall.name === "read_file" || toolCall.name === "read_many_files") &&
          hasDiscoveryReadPath(collector, normalizedReadPath)
        ) {
          const cached = preReadByPath.get(normalizedReadPath);
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: cached
              ? `Already read during discovery (cached content for ${normalizedReadPath}):\n${cached}`
              : `Already read during discovery: ${normalizedReadPath}. Content was provided in <pre_read_evidence>; do not re-read it.`,
          });
          continue;
        }
        executedFreshTool = true;
        runtime.emit(bus, {
          type: "tool_started",
          runId,
          callId: toolCall.id,
          toolName: toolCall.name,
          ...(summary ? { summary } : {}),
          at: runtime.isoNow(),
        });
        budget.recordToolCall();
        const result = runtime.deps.tools
          ? await runtime.deps.tools.execute(
              {
                schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
                callId: toolCall.id,
                toolName: toolCall.name,
                arguments: argumentsValue,
                grant,
                workspaceRoot: workspaceRoot!,
                pinnedState,
              },
              {
                maxContentChars: windowPolicy.compaction.toolResultContentChars,
              },
            )
          : undefined;
        const status = result?.status ?? "failed";
        recordDiscoveryToolUse({
          collector,
          toolName: toolCall.name,
          argumentsValue,
          resultOutput: result?.output,
          status,
        });
        const readPaths = extractFileReadPaths(toolCall.name, argumentsValue);
        if (readPaths && status === "succeeded") {
          budget.recordFileRead(readPaths);
          const text = extractDiscoveryReadText(result?.output);
          const rawPath =
            typeof (argumentsValue as { path?: unknown }).path === "string"
              ? (argumentsValue as { path: string }).path
              : readPaths[0]?.replace(/:\d+(?:-\d+)?$/, "");
          if (text.length > 0 && rawPath) {
            preReadByPath.set(
              rawPath.replace(/\\/g, "/").replace(/^\.\//, ""),
              text.slice(0, perFileChars),
            );
          }
        }
        runtime.emit(bus, {
          type: "tool_completed",
          runId,
          callId: toolCall.id,
          toolName: toolCall.name,
          status,
          ...(summary ? { summary } : {}),
          at: runtime.isoNow(),
        });
        runtime.emit(bus, {
          type: "discovery_progress",
          runId,
          filesRead: collector.fileReads,
          searches: collector.searches,
          ...(summary ? { summary } : {}),
          at: runtime.isoNow(),
        });
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: result
            ? serializeToolResultForModel(result, {
                maxContentChars: windowPolicy.compaction.toolResultContentChars,
              })
            : "Tool runtime unavailable.",
        });
      }
      // All tool calls were redundant re-reads — stop instead of another empty turn.
      if (!executedFreshTool && collector.fileReads > 0) {
        break;
      }
    }
    if (stopReason === "natural" && turn >= DISCOVERY_PASS_POLICY.maxModelTurns) {
      stopReason = "turn_cap";
    }
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
      qualityFloor
        ? thoroughEvidence
          ? "Thorough plan discovery did not gather multi-file change surfaces and symbols. Ask clarifying questions instead of inventing a hollow plan."
          : "Plan discovery did not gather file-backed change surfaces. Ask clarifying questions instead of inventing a hollow plan."
        : "Discovery did not identify a concrete change surface. The plan lists open questions instead of invented file tasks.",
    );
  }
  return { brief, failed, collector };
}

