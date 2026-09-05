import type {
  ModelMessage,
  ModelToolCall,
} from "../../../modules/model-gateway";
import type {
  PlanArtifact,
} from "../../../modules/planning";
import type {
  ProjectDescriptor,
  RepositoryStateReference,
} from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import type {
  RequestUnderstandingResult,
} from "../../../modules/request-understanding";
import type { ToolResult } from "../../tool-runtime";

import {
  summarizeToolCall,
  extractCompilerErrorPaths,
  extractOutOfScopePaths,
  isSuccessfulVerificationToolResult,
} from "../actions";
import type {
  EstablishedFact,
} from "../actions";
import type {
  AgentReasonCode,
  RunEvidence,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import { ReadLedger } from "../internal/ReadLedger";
import { ToolCallCache } from "../internal/ToolCallCache";
import {
  isUpdateTodosTool,
  type TaskListRef,
} from "../internal/taskListRuntime";
import type { LoopFileReadTracker } from "../actions";
import type { AgentEngineThresholds } from "../actions/resolveAgentEngineThresholds";

import type { AgentEngineRuntime } from "./runtime";
import {
  DEFAULT_MUTATING_TOOL_NAMES,
  executeOneTool,
  refreshAuthorityAfterTools,
  safeJsonParse,
} from "./executeTool";
import type { ModelLoopSession } from "./modelLoopSession";
import type { ModelLoopStepResult } from "./modelLoopStep";

export type ToolPhaseBatchStats = {
  attemptedMutatingTool: boolean;
  succeededMutatingTool: boolean;
  successfulToolCount: number;
  rejectedToolCount: number;
  rejectedMutation:
    | {
        toolName: string;
        status: ToolResult["status"];
        reasonCode?: ToolResult["reasonCode"];
        warnings: readonly string[];
        summary?: string;
      }
    | undefined;
  rejectedTool:
    | {
        toolName: string;
        status: ToolResult["status"];
        reasonCode?: ToolResult["reasonCode"];
        warnings: readonly string[];
        summary?: string;
      }
    | undefined;
};

export async function runModelLoopToolPhase(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  bus: EventBus;
  signal: AbortSignal;
  session: ModelLoopSession;
  toolCalls: readonly ModelToolCall[];
  turnContent: string;
  dirtyPaths: readonly string[] | undefined;
  pinnedState: RepositoryStateReference | undefined;
  workspaceRoot: string | undefined;
  messages: ModelMessage[];
  toolCache: ToolCallCache;
  readLedger: ReadLedger;
  budget: RunBudgetTracker;
  warnings: string[];
  reasonCodes: AgentReasonCode[];
  changedFiles: string[];
  mutationCheckpointIds: string[];
  taskListRef: TaskListRef;
  evidence: RunEvidence | undefined;
  establishedFacts: EstablishedFact[];
  windowPolicy: WindowPolicy;
  loopFileReads: LoopFileReadTracker;
  mustReadNudgeBudget: { remaining: number };
  plan: PlanArtifact | undefined;
  understanding: RequestUnderstandingResult | undefined;
  skillsQuery: string | undefined;
  mode: "ask" | "plan" | "agent" | undefined;
  projects: readonly ProjectDescriptor[] | undefined;
  requiredSkillIds: string[] | undefined;
  answer: string;
  changeImpactGate: { required: boolean; satisfied: boolean };
  thresholds: AgentEngineThresholds;
}): Promise<ModelLoopStepResult | { kind: "batch_done"; stats: ToolPhaseBatchStats }> {
  const {
    runtime,
    runId,
    bus,
    signal,
    session,
    toolCalls,
    turnContent,
    dirtyPaths,
    pinnedState,
    workspaceRoot,
    messages,
    toolCache,
    readLedger,
    budget,
    warnings,
    reasonCodes,
    changedFiles,
    mutationCheckpointIds,
    taskListRef,
    evidence,
    establishedFacts,
    windowPolicy,
    loopFileReads,
    mustReadNudgeBudget,
    plan,
    understanding,
    skillsQuery,
    mode,
    projects,
    requiredSkillIds,
    answer,
    changeImpactGate,
    thresholds,
  } = params;
  let decision = session.decision;
  let grant = decision.toolGrant;
  let selectedSkillIds = session.selectedSkillIds;

  // Tool phase
  const needsWorkspaceTools = toolCalls.some(
    (call) => !isUpdateTodosTool(call.name),
  );
  if (needsWorkspaceTools && grant.allowedTools.length === 0) {
    const message =
      "Model requested workspace tools on a route where no tools were granted.";
    warnings.push(message);
    runtime.emit(bus, {
      type: "warning",
      runId,
      message,
      code: "tool_calls_without_grant",
      data: {
        route: decision.route,
        requestedTools: toolCalls.map((call) => call.name).join(", "),
      },
      at: runtime.isoNow(),
    });
    session.decision = decision;
    session.selectedSkillIds = selectedSkillIds;
    return {
      kind: "return",
      outcome: {
        kind: "failed",
        answer: answer || undefined,
        extraReasons: ["misconfigured"],
        error: {
          code: "tool_calls_without_grant",
          message,
        },
      },
    };
  }
  const requestedMutatingTool = toolCalls.some((call) =>
    DEFAULT_MUTATING_TOOL_NAMES.has(call.name),
  );
  const BROAD_DISCOVERY_TOOLS = new Set([
    "list_directory",
    "glob_files",
    "search_files",
    "run_readonly_command",
    "read_git_status",
  ]);
  const EVIDENCE_READ_TOOLS = new Set(["read_file", "read_many_files"]);
  if (
    needsWorkspaceTools &&
    session.awaitingReadOnlyMutationRetry &&
    !requestedMutatingTool
  ) {
    const workspaceCalls = toolCalls.filter(
      (call) => !isUpdateTodosTool(call.name),
    );
    const hasBroadDiscovery = workspaceCalls.some((call) =>
      BROAD_DISCOVERY_TOOLS.has(call.name),
    );
    const onlyEvidenceReads =
      workspaceCalls.length > 0 &&
      workspaceCalls.every((call) => EVIDENCE_READ_TOOLS.has(call.name));
    const allowEvidenceRead =
      onlyEvidenceReads &&
      !hasBroadDiscovery &&
      session.postNudgeEvidenceReadTurns <
        thresholds.maxPostNudgeEvidenceReadTurns;
    if (!allowEvidenceRead) {
      const message =
        "The model tried to read/search again after the required mutation nudge.";
      warnings.push(message);
      reasonCodes.push("unfulfilled_execute_exhausted");
      runtime.emit(bus, {
        type: "warning",
        runId,
        message,
        code: "read_only_after_mutation_nudge",
        data: {
          route: decision.route,
          requestedTools: toolCalls.map((call) => call.name).join(", "),
        },
        at: runtime.isoNow(),
      });
      session.decision = decision;
      session.selectedSkillIds = selectedSkillIds;
      return {
        kind: "return",
        outcome: {
          kind: "failed",
          answer: answer || undefined,
          extraReasons: [],
          error: {
            code: "no_mutation_performed",
            message:
              "The model attempted more read-only discovery after being told to apply the required workspace edit.",
          },
        },
      };
    }
    // Allow a few targeted evidence-read batches after the nudge; then fail.
    session.postNudgeEvidenceReadTurns += 1;
  }
  if (needsWorkspaceTools && !runtime.deps.tools) {
    session.decision = decision;
    session.selectedSkillIds = selectedSkillIds;
    return {
      kind: "return",
      outcome: {
        kind: "failed",
        answer: answer || undefined,
        extraReasons: ["misconfigured"],
        error: {
          code: "misconfigured",
          message: "Model requested tools but Tool Runtime is not configured.",
        },
      },
    };
  }
  if (needsWorkspaceTools && !workspaceRoot) {
    session.decision = decision;
    session.selectedSkillIds = selectedSkillIds;
    return {
      kind: "return",
      outcome: {
        kind: "failed",
        answer: answer || undefined,
        extraReasons: ["misconfigured"],
        error: {
          code: "misconfigured",
          message: "Model requested tools but workspaceRoot was not provided.",
        },
      },
    };
  }

  messages.push({
    role: "assistant",
    content: turnContent,
    toolCalls,
  });

  runtime.emitStage(bus, runId, "tool_running", "started");

  // Cap mutation auto-advance to one checklist step per model turn.
  const taskListAutoAdvanceBudget = {
    remaining: runtime.deps.taskListAutoAdvance === true ? 1 : 0,
  };
  let attemptedMutatingTool = false;
  let succeededMutatingTool = false;
  let rejectedMutation:
    | {
        toolName: string;
        status: ToolResult["status"];
        reasonCode?: ToolResult["reasonCode"];
        warnings: readonly string[];
        summary?: string;
      }
    | undefined;
  let successfulToolCount = 0;
  let rejectedToolCount = 0;
  let extraAuthorityPaths: string[] = [];
  let rejectedTool:
    | {
        toolName: string;
        status: ToolResult["status"];
        reasonCode?: ToolResult["reasonCode"];
        warnings: readonly string[];
        summary?: string;
      }
    | undefined;

  for (const toolCall of toolCalls) {
    if (signal.aborted) {
      return { kind: "return", outcome: { kind: "cancelled" } };
    }
    if (!budget.canStartToolCall()) {
      session.decision = decision;
      session.selectedSkillIds = selectedSkillIds;
      return { kind: "return", outcome: {
        kind: "budget_exhausted",
        answer: answer || undefined,
        message: "Tool call budget exhausted.",
        changedFiles,
        mutationCheckpointIds,
      } };
    }

    const outcome = await executeOneTool(runtime, {
      runId,
      toolCall,
      grant,
      pinnedState,
      workspaceRoot: workspaceRoot ?? ".",
      bus,
      signal,
      toolCache,
      readLedger,
      budget,
      warnings,
      reasonCodes,
      dirtyPaths,
      changedFiles,
      mutationCheckpointIds,
      approvalToken: undefined,
      taskListRef,
      taskListAutoAdvance: runtime.deps.taskListAutoAdvance === true,
      taskListAutoAdvanceBudget,
      mutatingToolNames: DEFAULT_MUTATING_TOOL_NAMES,
      changeImpactGate,
    evidence,
    establishedFacts,
    windowPolicy: windowPolicy,
    loopFileReads,
    mustReadNudgeBudget,
    plan: plan,
  });

    if (outcome.kind === "approval_required") {
      const approvalId = runtime.deps.idGenerator.next("appr");
      session.decision = decision;
      session.selectedSkillIds = selectedSkillIds;
      return { kind: "return", outcome: {
        kind: "approval_required",
        messages,
        toolCache,
        pendingApproval: {
          approvalId,
          fingerprint: outcome.fingerprint,
          toolName: outcome.toolName,
          callId: outcome.callId,
          arguments: outcome.arguments,
          paths: outcome.paths,
        },
        changedFiles,
        mutationCheckpointIds,
        answer: answer || undefined,
        decision,
      } };
    }

    messages.push(outcome.message);
    const result = toolCache.get(toolCall.id);
    const mutatingTool = DEFAULT_MUTATING_TOOL_NAMES.has(toolCall.name);
    if (mutatingTool) {
      attemptedMutatingTool = true;
    }
    if (result?.status === "succeeded") {
      successfulToolCount += 1;
      if (mutatingTool) {
        succeededMutatingTool = true;
      }
    } else if (result) {
      rejectedToolCount += 1;
      rejectedTool = {
        toolName: toolCall.name,
        status: result.status,
        reasonCode: result.reasonCode,
        warnings: result.warnings,
        summary: summarizeToolCall(
          toolCall.name,
          toolCall.arguments.trim().length === 0
            ? {}
            : safeJsonParse(toolCall.arguments),
        ),
      };
    }
    if (result?.reasonCode === "path_out_of_scope") {
      extraAuthorityPaths.push(...extractOutOfScopePaths(result.warnings));
    }
    if (
      result &&
      (toolCall.name === "run_readonly_command" ||
        toolCall.name === "run_command")
    ) {
      extraAuthorityPaths.push(
        ...extractCompilerErrorPaths(
          result.output,
          result.audit.outputPreview,
        ),
      );
    }
    if (
      mutatingTool &&
      result &&
      result.status !== "succeeded" &&
      result.reasonCode !== "approval_required" &&
      result.reasonCode !== "must_read_incomplete"
    ) {
      rejectedMutation = {
        toolName: toolCall.name,
        status: result.status,
        reasonCode: result.reasonCode,
        warnings: result.warnings,
        summary: summarizeToolCall(
          toolCall.name,
          toolCall.arguments.trim().length === 0
            ? {}
            : safeJsonParse(toolCall.arguments),
        ),
      };
    }
    if (
      changedFiles.length > 0 &&
      result &&
      isSuccessfulVerificationToolResult(toolCall.name, result)
    ) {
      session.successfulVerificationAfterMutation = true;
    }
  }

  const grantExpansionOutcome = await refreshAuthorityAfterTools(runtime, {
    runId,
    bus,
    reasonCodes,
    warnings,
    messages,
    decisionRef: {
      get: () => decision,
      set: (next) => {
        decision = next;
        grant = next.toolGrant;
      },
    },
    selectedSkillIdsRef: {
      get: () => selectedSkillIds,
      set: (next) => {
        selectedSkillIds = next;
      },
    },
    changedFiles,
    dirtyPaths,
    extraPaths: extraAuthorityPaths,
    understanding: understanding,
    skillsQuery: skillsQuery,
    mode: mode,
    projects: projects,
    route: decision.route,
    windowPolicy: windowPolicy,
    requiredSkillIds: requiredSkillIds,
  });
  if (grantExpansionOutcome.kind === "expansion_required") {
    session.decision = decision;
      session.selectedSkillIds = selectedSkillIds;
      return { kind: "return", outcome: {
      kind: "grant_expansion_required",
      messages,
      toolCache,
      extraPaths: grantExpansionOutcome.extraPaths,
      changedFiles,
      mutationCheckpointIds,
      answer: answer || undefined,
      decision,
    } };
  }


  session.decision = decision;
  session.selectedSkillIds = selectedSkillIds;
  return {
    kind: "batch_done",
    stats: {
      attemptedMutatingTool,
      succeededMutatingTool,
      successfulToolCount,
      rejectedToolCount,
      rejectedMutation,
      rejectedTool,
    },
  };
}
