import type {
  DecisionPolicyInput,
  ExecutionDecision,
  ToolGrant,
} from "../../../decision-policy";
import { READ_ONLY_TOOL_IDS } from "../../../decision-policy";
import type {
  LlmPort,
  ModelCapabilities,
  ModelEvent,
  ModelRequest,
  ModelToolCall,
} from "../../../model-gateway";
import type {
  PromptConstructionInput,
  PromptConstructionResult,
} from "../../../prompt-construction";
import type {
  RepositoryContextPipelineInput,
  RepositoryContextPipelineResult,
} from "../../../repository-context";
import type {
  PinRepositoryStateInput,
  PinRepositoryStateResult,
  RepositoryStateDescriptor,
  UnpinRepositoryStateInput,
  UnpinRepositoryStateResult,
} from "../../../repository-state";
import type {
  CreateUserRequestInput,
  UserRequestEnvelope,
} from "../../../request-intake";
import type { RequestUnderstandingResult } from "../../../request-understanding";
import type {
  ToolInvocationInput,
  ToolResult,
} from "../../../tool-runtime";
import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../../tool-runtime";

import type { AgentEngineDependencies } from "../../contracts";

export function createCapabilities(
  overrides: Partial<ModelCapabilities> = {},
): ModelCapabilities {
  return {
    modelId: "test/engine",
    contextWindowTokens: 32_768,
    maximumOutputTokens: 4_096,
    supportsStreaming: true,
    supportsTools: true,
    supportsParallelToolCalls: true,
    supportsStructuredOutput: false,
    supportsVision: false,
    supportsReasoning: false,
    supportsPromptCaching: false,
    supportsEmbeddings: false,
    ...overrides,
  };
}

export function createReadOnlyGrant(
  overrides: Partial<ToolGrant> = {},
): ToolGrant {
  return {
    maximumWorkspaceEffect: "read",
    allowedTools: [...READ_ONLY_TOOL_IDS],
    allowedEffects: ["workspace_read", "process_execute"],
    pathScopes: ["."],
    approvalMode: "never",
    limits: {
      maxToolCalls: 20,
      maxWallTimeMs: 60_000,
      maxOutputBytes: 256_000,
    },
    ...overrides,
  };
}

export function createDecision(
  overrides: Partial<ExecutionDecision> = {},
): ExecutionDecision {
  return {
    schemaVersion: 1,
    route: "direct_answer",
    planningDepth: "none",
    runDisposition: "continue",
    repositoryContextRequired: false,
    toolGrant: {
      maximumWorkspaceEffect: "none",
      allowedTools: [],
      allowedEffects: [],
      pathScopes: ["."],
      approvalMode: "never",
      limits: {
        maxToolCalls: 0,
        maxWallTimeMs: 30_000,
        maxOutputBytes: 0,
      },
    },
    verification: {
      required: false,
      minimumEvidence: [],
      allowUnavailable: true,
    },
    reasonCodes: ["direct_knowledge_answer"],
    rationale: "Fixture decision.",
    warnings: [],
    ...overrides,
  };
}

export function createUnderstanding(
  overrides: Partial<RequestUnderstandingResult> = {},
): RequestUnderstandingResult {
  return {
    intent: {
      status: "accepted",
      classification: {
        interactionIntent: "question",
        primaryTaskIntent: "question",
        secondaryTaskIntents: [],
        confidence: 0.92,
        alternatives: [],
        needsClarification: false,
        reason: "Fixture.",
      },
      scores: [
        {
          intent: "question",
          score: 0.92,
          ruleScore: 0.8,
          llmScore: 0.92,
        },
      ],
      confidenceMargin: 0.4,
      recommendsClarification: false,
      diagnostics: {
        llmPrimaryIntent: "question",
        llmInteractionIntent: "question",
        taskAgreement: true,
        interactionAgreement: true,
        interactionConflict: false,
        agreementBonusApplied: 0,
        disagreementPenaltyApplied: 0,
        minimumConfidence: 0.6,
        minimumMargin: 0.15,
      },
    },
    taskAnalysis: {
      scope: "unknown",
      complexity: "simple",
      risk: "low",
      clarity: "clear",
      targets: [],
      constraints: [],
      requestedOutcomes: [],
      recommendsRepositoryDiscovery: false,
      recommendsPlanning: false,
      recommendsVerification: false,
      recommendsTaskClarification: false,
      estimatedFilesAffected: { minimum: 0, maximum: 0 },
      signals: [],
      confidence: 0.9,
    },
    ...overrides,
  };
}

export class ScriptedLlmPort implements LlmPort {
  public readonly id = "scripted-engine-llm";
  public readonly capabilities: ModelCapabilities;
  private turn = 0;

  constructor(
    private readonly turns: Array<{
      content?: string;
      toolCalls?: ModelToolCall[];
      fail?: { code: string; message: string };
      cancel?: boolean;
    }>,
    capabilities: ModelCapabilities = createCapabilities(),
  ) {
    this.capabilities = capabilities;
  }

  public async *complete(
    _request: ModelRequest,
    context?: { abortSignal?: AbortSignal },
  ): AsyncIterable<ModelEvent> {
    if (context?.abortSignal?.aborted) {
      yield {
        type: "cancelled",
        error: {
          code: "cancelled",
          message: "Aborted before start.",
          retryable: false,
        },
      };
      return;
    }

    const script = this.turns[this.turn] ?? this.turns[this.turns.length - 1];
    this.turn += 1;

    if (script.cancel) {
      yield {
        type: "cancelled",
        error: {
          code: "cancelled",
          message: "Cancelled by script.",
          retryable: false,
        },
      };
      return;
    }

    if (script.fail) {
      yield {
        type: "failed",
        error: {
          code: "unknown",
          message: script.fail.message,
          retryable: false,
        },
      };
      return;
    }

    if (script.content) {
      yield { type: "content_delta", content: script.content };
    }

    if (script.toolCalls && script.toolCalls.length > 0) {
      for (const [index, call] of script.toolCalls.entries()) {
        yield {
          type: "tool_call_delta",
          toolCalls: [
            {
              index,
              id: call.id,
              name: call.name,
              arguments: call.arguments,
            },
          ],
        };
      }
      yield {
        type: "completed",
        finishReason: "tool_calls",
      };
      return;
    }

    yield { type: "completed", finishReason: "stop" };
  }
}

export function createStubDependencies(options: {
  decision?: ExecutionDecision;
  understanding?: RequestUnderstandingResult;
  llm?: LlmPort;
  contextBlocks?: Array<{
    id: string;
    relativePath: string;
    content: string;
  }>;
  toolResults?: Record<string, Partial<ToolResult>>;
  pinFails?: boolean;
}): AgentEngineDependencies {
  const decision = options.decision ?? createDecision();
  const understanding = options.understanding ?? createUnderstanding();
  const llm =
    options.llm ??
    new ScriptedLlmPort([{ content: "Direct answer from model." }], createCapabilities({
      supportsTools: false,
    }));

  const pinned = new Set<string>();

  return {
    intake: {
      intake: (input: CreateUserRequestInput): UserRequestEnvelope => ({
        schemaVersion: 1,
        requestId: input.requestId ?? "req_test",
        sessionId: input.sessionId,
        mode: input.mode,
        origin: input.origin ?? "user",
        message: input.userMessage,
        referencedArtifacts: input.referencedArtifacts ?? [],
        workspace: input.workspace,
        correlation: input.correlation,
        createdAt: "2026-07-25T12:00:00.000Z",
      }),
    },
    understanding: {
      understand: async () => understanding,
    },
    decision: {
      decide: (_input: DecisionPolicyInput) => decision,
    },
    prompt: {
      construct: (input: PromptConstructionInput): PromptConstructionResult => ({
        schemaVersion: 1,
        status: "complete",
        request: {
          messages: [
            { role: "system", content: "system" },
            { role: "user", content: input.userMessage },
          ],
          model: input.model ?? "test",
          tools: input.tools,
          maximumOutputTokens: 1024,
        },
        budget: {
          contextWindowTokens: 32_768,
          outputReservedTokens: 1024,
          inputBudgetTokens: 30_000,
          sections: [
            {
              section: "system",
              allocatedTokens: 500,
              usedTokens: 10,
              omittedTokens: 0,
              truncatedTokens: 0,
            },
            {
              section: "output_reserve",
              allocatedTokens: 1024,
              usedTokens: 0,
              omittedTokens: 0,
              truncatedTokens: 0,
            },
          ],
          totalUsedTokens: 20,
          totalOmittedTokens: 0,
          totalTruncatedTokens: 0,
          withinLimits: true,
        },
        provenance: [
          {
            blockId: "system:core",
            section: "system",
            source: "decision",
            trust: "trusted_instruction",
          },
        ],
        omissions: [],
        warnings: [],
        reasonCodes: ["output_reserved_first"],
      }),
    },
    llm,
    repositoryState: {
      pin: async (
        input: PinRepositoryStateInput,
      ): Promise<PinRepositoryStateResult> => {
        if (options.pinFails) {
          return {
            status: "failed",
            code: "unknown_state_token",
            message: "Unknown state token.",
          };
        }
        pinned.add(`${input.state.stateToken}:${input.runId}`);
        return {
          status: "pinned",
          reference: input.state,
          runId: input.runId,
        };
      },
      unpin: async (
        input: UnpinRepositoryStateInput,
      ): Promise<UnpinRepositoryStateResult> => {
        pinned.delete(`${input.state.stateToken}:${input.runId}`);
        return {
          status: "unpinned",
          reference: input.state,
          runId: input.runId,
        };
      },
      getLatest: async (): Promise<RepositoryStateDescriptor | undefined> =>
        undefined,
    },
    repositoryContext: {
      execute: async (
        input: RepositoryContextPipelineInput,
      ): Promise<RepositoryContextPipelineResult> =>
        ({
          schemaVersion: 1,
          stateToken: input.state.stateToken,
          workspaceSnapshotId: "snap_1",
          query: input.query,
          mode: input.mode,
          status: "complete",
          retrieval: {},
          selection: {},
          assembly: {
            blocks: (options.contextBlocks ?? []).map((block) => ({
              id: block.id,
              relativePath: block.relativePath,
              content: block.content,
              tokenEstimate: 10,
              truncated: false,
              omittedCharacters: 0,
              lineRanges: [{ startLine: 1, endLine: 1 }],
            })),
            dropped: [],
          },
          warnings: [],
          statistics: {
            retrievedCandidates: 0,
            selectedItems: 0,
            assembledBlocks: options.contextBlocks?.length ?? 0,
            droppedBlocks: 0,
            usedTokens: 10,
          },
        }) as unknown as RepositoryContextPipelineResult,
    },
    tools: {
      execute: async (input: ToolInvocationInput): Promise<ToolResult> => {
        const override = options.toolResults?.[input.toolName] ?? {};
        return {
          schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
          callId: input.callId,
          toolName: input.toolName,
          status: "succeeded",
          truncated: false,
          redacted: false,
          durationMs: 1,
          bytesProduced: 12,
          warnings: [],
          output: { ok: true },
          audit: {
            callId: input.callId,
            toolName: input.toolName,
            startedAt: "2026-07-25T12:00:00.000Z",
            endedAt: "2026-07-25T12:00:00.001Z",
            status: "succeeded",
            inputPreview: "{}",
            outputPreview: '{"ok":true}',
            bytesProduced: 12,
            durationMs: 1,
            truncated: false,
            redacted: false,
          },
          ...override,
        };
      },
    },
    clock: {
      now: () => new Date("2026-07-25T12:00:00.000Z"),
    },
    idGenerator: {
      next: (prefix: string) => `${prefix}_1`,
    },
  };
}
