import { DecisionPolicyPipeline } from "../../../modules/decision-policy";
import type { LlmPort, ModelToolDefinition } from "../../../modules/model-gateway";
import { MemoryPipeline } from "../../../modules/memory";
import type { MemoryEmbeddingPort, MemoryStorePort } from "../../../modules/memory";
import { PlanningPipeline } from "../../../modules/planning";
import { PromptConstructionPipeline } from "../../../modules/prompt-construction";
import type { RepositoryContextPipeline } from "../../../modules/repository-context";
import type { RepositoryStatePipeline } from "../../../modules/repository-state";
import {
  RequestIntakePipeline,
  type RequestIntakePipelineDependencies,
} from "../../../modules/request-intake";
import { RequestUnderstandingPipeline } from "../../../modules/request-understanding";
import { SkillsPipeline } from "../../../modules/skills";
import type { SkillsCatalogPort } from "../../../modules/skills";
import type { ToolRuntimePipeline } from "../../tool-runtime";
import type { VerificationPipeline } from "../../../modules/verification";

import type {
  AgentEngineClockPort,
  AgentEngineIdGeneratorPort,
} from "../contracts";
import type { AgentEngineRunCheckpointStorePort } from "../internal/RunCheckpoint";
import { AgentEnginePipeline } from "../pipeline/AgentEnginePipeline";

export interface ComposeReadOnlyAgentEngineOptions {
  /** LLM used by Request Understanding (structured classification). */
  understandingLlm: LlmPort;
  /** Optional cheaper LLM for strategy/enrichment planning calls. */
  planningLlm?: LlmPort;
  /** LLM used by the Engine model/tool loop. */
  runLlm: LlmPort;
  repositoryState?: RepositoryStatePipeline;
  repositoryContext?: RepositoryContextPipeline;
  tools?: ToolRuntimePipeline;
  /** Enables verification-gated completion for mutation routes (Phase 8). */
  verification?: VerificationPipeline;
  /** Required to suspend/resume mutation approvals across process turns. */
  checkpointStore?: AgentEngineRunCheckpointStorePort;
  /** Optional Skills catalog — omitting leaves the core loop intact. */
  skillsCatalog?: SkillsCatalogPort;
  /** Optional Memory store — omitting leaves the core loop intact. */
  memoryStore?: MemoryStorePort;
  /** Optional embeddings for hybrid memory retrieve. */
  memoryEmbedding?: MemoryEmbeddingPort;
  /**
   * When true (default), wire the generic Planning facade.
   * Set false only for tests that intentionally skip structured plans.
   */
  enablePlanning?: boolean;
  toolDefinitions?: readonly ModelToolDefinition[];
  /**
   * Opt-in checklist auto-advance after successful built-in mutating tools.
   * Defaults to false for library-safe composition; hosts may enable by default.
   */
  taskListAutoAdvance?: boolean;
  intake?: Partial<RequestIntakePipelineDependencies>;
  clock?: AgentEngineClockPort;
  idGenerator?: AgentEngineIdGeneratorPort;
}

/**
 * Wire real V8 facades into AgentEnginePipeline.
 *
 * Application hosts inject provider LLMs and optional repository/tool/
 * verification/skills/memory/planning pipelines plus a checkpoint store.
 * This helper does not invent a second orchestration layer — it only
 * constructs the public facades Engine already depends on.
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
    skills: options.skillsCatalog
      ? new SkillsPipeline({ catalog: options.skillsCatalog })
      : undefined,
    memory: options.memoryStore
      ? new MemoryPipeline({
          store: options.memoryStore,
          embedding: options.memoryEmbedding,
        })
      : undefined,
    planning:
      options.enablePlanning === false
        ? undefined
        : new PlanningPipeline({
            llm: options.planningLlm ?? options.understandingLlm,
          }),
    repositoryState: options.repositoryState,
    repositoryContext: options.repositoryContext,
    tools: options.tools,
    verification: options.verification,
    checkpointStore: options.checkpointStore,
    toolDefinitions: options.toolDefinitions,
    taskListAutoAdvance: options.taskListAutoAdvance,
    clock: options.clock,
    idGenerator: options.idGenerator,
  });
}
