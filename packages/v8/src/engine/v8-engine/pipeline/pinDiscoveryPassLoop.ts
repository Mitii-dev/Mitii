/**
 * Discovery-pass model/tool loop — extracted from runDiscoveryPass.
 */
import type { ModelMessage, ModelToolDefinition } from "../../../modules/model-gateway";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { ToolGrant } from "../../../modules/decision-policy";

import { resolveReasoningProgressBudget } from "../actions";
import type { DiscoveryPassBudget } from "../modules/plan-discovery";
import {
  discoveryCanModelTurn,
  discoveryHasSymbolEvidence,
  isDiscoveryToolAllowed,
  type DiscoveryObservationCollector,
} from "../internal/discovery";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { AgentEngineRuntime } from "./runtime";
import { consumeModelTurn } from "./consumeModelTurn";
import {
  DISCOVERY_SEARCH_EVIDENCE_NUDGE,
  DISCOVERY_SYMBOL_EVIDENCE_NUDGE,
} from "./pinDiscoveryPassNudges";
import { executeDiscoveryPassToolBatch } from "./pinDiscoveryPassLoopTools";

export type DiscoveryPassStopReason =
  | "natural"
  | "turn_cap"
  | "budget_exhausted"
  | "aborted"
  | "model_error";

export async function runDiscoveryPassModelLoop(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  bus: EventBus;
  signal: AbortSignal;
  budget: RunBudgetTracker;
  warnings: string[];
  windowPolicy: WindowPolicy;
  workspaceRoot: string;
  pinnedState: RepositoryStateReference | undefined;
  grant: ToolGrant;
  tools: ModelToolDefinition[];
  messages: ModelMessage[];
  collector: DiscoveryObservationCollector;
  discoveryBudget: DiscoveryPassBudget;
  qualityFloor: boolean;
  preferSymbolEvidence: boolean;
  minSearches: number;
  canForceTools: boolean;
  qualityFloorNudge: string;
  preReadByPath: Map<string, string>;
  perFileChars: number;
  stopReason: DiscoveryPassStopReason;
}): Promise<DiscoveryPassStopReason> {
  const {
    runtime,
    runId,
    bus,
    signal,
    budget,
    warnings,
    windowPolicy,
    workspaceRoot,
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
  } = params;

  let stopReason = params.stopReason;
  let turn = 0;
  let qualityFloorNudged = false;
  let symbolEvidenceNudged = false;
  let searchEvidenceNudged = false;

  for (; turn < discoveryBudget.maxModelTurns; turn += 1) {
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
    const needsSearchEvidence =
      qualityFloor &&
      minSearches > 0 &&
      collector.searches < minSearches &&
      tools.length > 0;
    const needsForcedTools =
      canForceTools &&
      (needsFileEvidence || needsSymbolEvidence || needsSearchEvidence);
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
        turn + 1 < discoveryBudget.maxModelTurns
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
        turn + 1 < discoveryBudget.maxModelTurns
      ) {
        symbolEvidenceNudged = true;
        messages.push({
          role: "assistant",
          content: turnResult.content,
        });
        messages.push({
          role: "user",
          content: DISCOVERY_SYMBOL_EVIDENCE_NUDGE,
        });
        continue;
      }
      if (
        qualityFloor &&
        minSearches > 0 &&
        collector.searches < minSearches &&
        !searchEvidenceNudged &&
        turn + 1 < discoveryBudget.maxModelTurns
      ) {
        searchEvidenceNudged = true;
        messages.push({
          role: "assistant",
          content: turnResult.content,
        });
        messages.push({
          role: "user",
          content: DISCOVERY_SEARCH_EVIDENCE_NUDGE,
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
    const { executedFreshTool } = await executeDiscoveryPassToolBatch({
      runtime,
      runId,
      bus,
      signal,
      budget,
      warnings,
      windowPolicy,
      workspaceRoot,
      pinnedState,
      grant,
      messages,
      toolCalls,
      collector,
      preReadByPath,
      perFileChars,
    });
    // All tool calls were redundant re-reads — stop instead of another empty turn.
    if (!executedFreshTool && collector.fileReads > 0) {
      break;
    }
  }
  if (stopReason === "natural" && turn >= discoveryBudget.maxModelTurns) {
    stopReason = "turn_cap";
  }
  return stopReason;
}
