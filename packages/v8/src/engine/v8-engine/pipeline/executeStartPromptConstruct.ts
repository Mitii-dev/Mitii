/**
 * Tools + prompt construction for post-enrichment start path.
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import {
  compileDecisionBrief,
  formatDecisionBriefForPrompt,
} from "../../../modules/decision-policy";
import {
  PROMPT_CONSTRUCTION_SCHEMA_VERSION,
  mergePromptInstructions,
  type PromptInstructions,
  type PromptRepositoryContext,
  type PromptSkillCatalogL1Entry,
} from "../../../modules/prompt-construction";
import {
  withMcpAttachOnGrant,
  formatMcpAttachInstruction,
} from "../../../modules/mcp-attach";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { WindowPolicy } from "../../../modules/window-budget";

import {
  annotateMutationToolDefinitions,
  formatExecutionSeedForPrompt,
} from "../actions";
import { filterToolDefinitions } from "../actions/filterToolDefinitions";
import type { AgentReasonCode, AgentEngineStartInput } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import { attachTaskListTool } from "../internal/taskListRuntime";
import { DEFAULT_TOOL_DEFINITIONS } from "../legacy/policy";
import { resolveSteeringFeatureFlags } from "../legacy/steeringFlags";
import type { AgentEngineRuntime } from "./runtime";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";
import { emitPromptReady } from "./emitPromptReady";

type ProjectRuleBlock = NonNullable<PromptInstructions["projectRules"]>[number];

export type StartPromptConstructResult =
  | {
      kind: "failed";
      reasonCodes: AgentReasonCode[];
      warnings?: string[];
      error: { code: string; message: string };
    }
  | {
      kind: "ready";
      decisionWithAttach: ExecutionDecision;
      promptResult: ReturnType<AgentEngineRuntime["deps"]["prompt"]["construct"]>;
      projectRules: ProjectRuleBlock[];
      instructions: PromptInstructions | undefined;
      selectedSkills: PromptInstructions["skills"];
    };

export async function constructStartPrompt(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  windowPolicy: WindowPolicy;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  shared: ExecuteStartSharedState;
  envelope: UserRequestEnvelope;
  understanding: RequestUnderstandingResult;
  decision: ExecutionDecision;
  repositoryContext: PromptRepositoryContext | undefined;
  selectedSkills: PromptInstructions["skills"];
  skillCatalogL1: readonly PromptSkillCatalogL1Entry[] | undefined;
  selectedMemory: PromptInstructions["memory"];
  planText: string | undefined;
}): Promise<StartPromptConstructResult> {
  const {
    runtime,
    runId,
    input,
    bus,
    windowPolicy,
    reasonCodes,
    warnings,
    shared,
    envelope,
    understanding,
    decision,
    repositoryContext,
    selectedSkills,
    skillCatalogL1,
    selectedMemory,
    planText,
  } = params;

  const attachIds = input.requiredMcpServerIds ?? [];
  const toolGrant = withMcpAttachOnGrant(decision.toolGrant, attachIds);
  const decisionWithAttach = { ...decision, toolGrant };
  const tools = annotateMutationToolDefinitions(
    attachTaskListTool({
      mode: envelope.mode,
      tools: filterToolDefinitions({
        grant: toolGrant,
        definitions:
          input.tools ??
          runtime.deps.toolDefinitions ??
          DEFAULT_TOOL_DEFINITIONS,
        supportsTools: runtime.deps.llm.capabilities.supportsTools,
        mode: envelope.mode,
        requiredMcpServerIds: attachIds,
      }),
    }),
    toolGrant.mutationBudget,
  );

  const projectRules = [...(input.instructions?.projectRules ?? [])];
  const mcpAttachRule = formatMcpAttachInstruction(attachIds);
  if (mcpAttachRule) {
    projectRules.push(mcpAttachRule);
  }
  const hostInstructions: PromptInstructions | undefined =
    projectRules.length > 0
      ? { ...input.instructions, projectRules }
      : input.instructions;

  const instructions = mergePromptInstructions({
    host: hostInstructions,
    skills: selectedSkills,
    memory: selectedMemory,
  });

  if (
    envelope.attachments &&
    envelope.attachments.length > 0 &&
    !runtime.deps.llm.capabilities.supportsVision
  ) {
    reasonCodes.push("vision_unsupported");
    return {
      kind: "failed",
      reasonCodes,
      error: {
        code: "vision_unsupported",
        message: `Model ${runtime.deps.llm.capabilities.modelId} does not support image input.`,
      },
    };
  }

  const steering = resolveSteeringFeatureFlags(input.steering);
  const decisionBriefText = steering.decisionBrief
    ? formatDecisionBriefForPrompt(
        compileDecisionBrief({
          decision: decisionWithAttach,
          understanding,
        }),
      )
    : undefined;
  const executionSeedText =
    decisionWithAttach.toolGrant.maximumWorkspaceEffect === "write"
      ? formatExecutionSeedForPrompt(shared.executionSeed)
      : "";

  const promptResult = runtime.deps.prompt.construct({
    schemaVersion: PROMPT_CONSTRUCTION_SCHEMA_VERSION,
    decision: decisionWithAttach,
    userMessage: envelope.message,
    attachments: envelope.attachments,
    conversation: input.conversation,
    repositoryContext,
    instructions,
    planText,
    ...(decisionBriefText ? { decisionBriefText } : {}),
    ...(executionSeedText ? { executionSeedText } : {}),
    injectSkillCatalogL1: steering.injectSkillCatalogL1,
    ...(steering.injectSkillCatalogL1 && skillCatalogL1
      ? { skillCatalogL1: [...skillCatalogL1] }
      : {}),
    tools,
    capabilities: runtime.deps.llm.capabilities,
    model: input.model,
    temperature: input.temperature,
    stream: input.stream,
    outputReserveTokens: windowPolicy.maximumOutputTokens,
    planBudgetTokens: planText ? windowPolicy.sections.planTokens : 0,
    fragmentLimits: {
      absoluteMaxTokens: windowPolicy.fragments.absoluteMaxTokens,
      reviewThresholdTokens: windowPolicy.fragments.reviewThresholdTokens,
      additionalContextValueTokens:
        windowPolicy.fragments.additionalContextValueTokens,
      skillCatalogL1MaxTokens: windowPolicy.fragments.skillCatalogL1MaxTokens,
      skillCatalogL1MaxEntries: windowPolicy.fragments.skillCatalogL1MaxEntries,
    },
  });

  if (promptResult.status === "blocked") {
    reasonCodes.push("prompt_blocked");
    return {
      kind: "failed",
      reasonCodes,
      warnings: promptResult.warnings,
      error: {
        code: "prompt_blocked",
        message: "Prompt construction blocked the request.",
      },
    };
  }

  reasonCodes.push("prompt_constructed");
  if (promptResult.warnings.length > 0) {
    warnings.push(...promptResult.warnings);
  }

  emitPromptReady(runtime, {
    runId,
    bus,
    promptResult,
    windowPolicy,
    logVerbosity: input.logVerbosity,
  });

  if (runtime.deps.memory?.recordAccess) {
    const included = promptResult.provenance
      .filter((row) => row.section === "memory")
      .map((row) => row.blockId);
    try {
      await runtime.deps.memory.recordAccess(included, runtime.isoNow());
    } catch {
      warnings.push("Memory inclusion feedback could not be recorded.");
    }
  }

  return {
    kind: "ready",
    decisionWithAttach,
    promptResult,
    projectRules,
    instructions,
    selectedSkills,
  };
}
