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

import type {
  AgentEngineClockPort,
  AgentEngineIdGeneratorPort,
} from "../contracts";
import { AgentEnginePipeline } from "../pipeline/AgentEnginePipeline";

export interface ComposeReadOnlyAgentEngineOptions {
  /** LLM used by Request Understanding (structured classification). */
  understandingLlm: LlmPort;
  /** LLM used by the Engine model/tool loop. */
  runLlm: LlmPort;
  repositoryState?: RepositoryStatePipeline;
  repositoryContext?: RepositoryContextPipeline;
  tools?: ToolRuntimePipeline;
  toolDefinitions?: readonly ModelToolDefinition[];
  intake?: Partial<RequestIntakePipelineDependencies>;
  clock?: AgentEngineClockPort;
  idGenerator?: AgentEngineIdGeneratorPort;
}

/**
 * Wire real Phase 7 facades into AgentEnginePipeline.
 *
 * Application hosts inject provider LLMs and optional repository/tool
 * pipelines. This helper does not invent a second orchestration layer —
 * it only constructs the public facades Engine already depends on.
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
    toolDefinitions: options.toolDefinitions,
    clock: options.clock,
    idGenerator: options.idGenerator,
  });
}
