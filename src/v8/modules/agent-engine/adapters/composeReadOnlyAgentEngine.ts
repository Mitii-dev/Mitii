import { DecisionPolicyPipeline } from "../../decision-policy";
import type { LlmPort, ModelToolDefinition } from "../../model-gateway";
import { PromptConstructionPipeline } from "../../prompt-construction";
import type { RepositoryContextPipeline } from "../../repository-context";
import type { RepositoryStatePipeline } from "../../repository-state";
import {
  RequestIntakePipeline,
  type RequestIntakePipelineDependencies,
} from "../../request-intake";
import { RequestUnderstandingPipeline } from "../../request-understanding";
import type { ToolRuntimePipeline } from "../../tool-runtime";
import type { VerificationPipeline } from "../../verification";

import type {
  AgentEngineClockPort,
  AgentEngineIdGeneratorPort,
} from "../contracts";
import type { AgentEngineRunCheckpointStorePort } from "../internal/RunCheckpoint";
import { AgentEnginePipeline } from "../pipeline/AgentEnginePipeline";

export interface ComposeReadOnlyAgentEngineOptions {
  /** LLM used by Request Understanding (structured classification). */
  understandingLlm: LlmPort;
  /** LLM used by the Engine model/tool loop. */
  runLlm: LlmPort;
  repositoryState?: RepositoryStatePipeline;
  repositoryContext?: RepositoryContextPipeline;
  tools?: ToolRuntimePipeline;
  /** Enables verification-gated completion for mutation routes (Phase 8). */
  verification?: VerificationPipeline;
  /** Required to suspend/resume mutation approvals across process turns. */
  checkpointStore?: AgentEngineRunCheckpointStorePort;
  toolDefinitions?: readonly ModelToolDefinition[];
  intake?: Partial<RequestIntakePipelineDependencies>;
  clock?: AgentEngineClockPort;
  idGenerator?: AgentEngineIdGeneratorPort;
}

/**
 * Wire real V8 facades into AgentEnginePipeline.
 *
 * Application hosts inject provider LLMs and optional repository/tool/
 * verification pipelines plus a checkpoint store. This helper does not
 * invent a second orchestration layer — it only constructs the public
 * facades Engine already depends on. The name is kept for compatibility;
 * it composes the full Phase 8 engine (read-only and mutating routes)
 * once `tools`, `verification`, and `checkpointStore` are supplied.
 */
export function composeReadOnlyAgentEngine(
  options: ComposeReadOnlyAgentEngineOptions,
): AgentEnginePipeline {
  const intake = new RequestIntakePipeline({
    clock: options.intake?.clock ?? {
      now: () => Date.now(),
    },
    idGenerator: options.intake?.idGenerator ?? {
      generate: (namespace: string) =>
        `${namespace}_${Math.random().toString(36).slice(2, 10)}`,
    },
  });

  return new AgentEnginePipeline({
    intake,
    understanding: new RequestUnderstandingPipeline(options.understandingLlm),
    decision: new DecisionPolicyPipeline(),
    prompt: new PromptConstructionPipeline(),
    llm: options.runLlm,
    repositoryState: options.repositoryState,
    repositoryContext: options.repositoryContext,
    tools: options.tools,
    verification: options.verification,
    checkpointStore: options.checkpointStore,
    toolDefinitions: options.toolDefinitions,
    clock: options.clock,
    idGenerator: options.idGenerator,
  });
}
