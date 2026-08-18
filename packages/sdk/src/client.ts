import {
  AgentEnginePipeline,
  InMemoryRepositoryStateStore,
  InMemoryRunCheckpointStore,
  RepositoryStatePipeline,
  composeReadOnlyAgentEngine,
} from '@mitii/v8';
import type {
  AgentMode,
  ComposeReadOnlyAgentEngineOptions,
  LlmPort,
  MemoryEmbeddingPort,
  MemoryStorePort,
  PublishRepositoryStateInput,
  PublishRepositoryStateResult,
  RepositoryContextPipeline,
  RepositoryStatePipeline as RepositoryStatePipelineType,
  SkillsCatalogPort,
  ToolRuntimePipeline,
  VerificationPipeline,
  WorkspaceIndexingPipelineResult,
} from '@mitii/v8';

import {
  mitiiResumeInputSchema,
  toAgentEngineStartInput,
} from './contracts';
import type { MitiiResumeInput, MitiiStartInput } from './contracts';
import { MitiiSdkError, mapToSdkError } from './errors';
import { MitiiRun } from './run';

export interface CreateMitiiClientOptions {
  /** LLM used by Request Understanding (structured classification). */
  understandingLlm: LlmPort;
  /** LLM used by the Engine model/tool loop. */
  runLlm: LlmPort;
  /** Absolute workspace root when tools may execute. */
  workspaceRoot?: string;
  /** Default workspace id attached to intake envelopes. */
  workspaceId?: string;
  /** Default interaction mode when start() omits mode. */
  defaultMode?: AgentMode;
  /** Default session id when start() omits sessionId. */
  defaultSessionId?: string;
  repositoryState?: RepositoryStatePipelineType;
  repositoryContext?: RepositoryContextPipeline;
  tools?: ToolRuntimePipeline;
  verification?: VerificationPipeline;
  /** Enables clarification/approval resume across process turns. */
  checkpointStore?: ComposeReadOnlyAgentEngineOptions['checkpointStore'];
  skillsCatalog?: SkillsCatalogPort;
  memoryStore?: MemoryStorePort;
  memoryEmbedding?: MemoryEmbeddingPort;
  toolDefinitions?: ComposeReadOnlyAgentEngineOptions['toolDefinitions'];
  /**
   * When true (default), create an in-memory checkpoint store if none is
   * provided so clarification/approval resume works in-process.
   */
  enableInMemoryCheckpoints?: boolean;
  /**
   * When true and no repositoryState is provided, create an in-memory
   * Repository State pipeline for optional publish helpers.
   */
  enableInMemoryRepositoryState?: boolean;
  /**
   * When true, Agent runs may auto-advance the live checklist after a
   * successful built-in mutating tool (at most once per model turn).
   *
   * Library/engine default is false (opt-in). Host apps (VS Code/CLI) may
   * enable this by default for product UX; see those compose sites.
   */
  taskListAutoAdvance?: boolean;
}

/**
 * Host-neutral client over V8 Agent Engine.
 * Secrets (API keys) stay on injected LlmPort adapters — never on this options bag.
 */
export class MitiiClient {
  private readonly engine: AgentEnginePipeline;
  private readonly defaults: {
    mode: AgentMode;
    sessionId: string;
    workspaceRoot?: string;
    workspaceId?: string;
  };
  private readonly repositoryState?: RepositoryStatePipelineType;

  constructor(options: CreateMitiiClientOptions) {
    if (!options.understandingLlm || !options.runLlm) {
      throw new MitiiSdkError(
        'invalid_input',
        'createMitiiClient requires understandingLlm and runLlm ports.',
      );
    }

    const checkpointStore =
      options.checkpointStore ??
      (options.enableInMemoryCheckpoints === false
        ? undefined
        : new InMemoryRunCheckpointStore());

    const repositoryState =
      options.repositoryState ??
      (options.enableInMemoryRepositoryState
        ? new RepositoryStatePipeline({
            store: new InMemoryRepositoryStateStore(),
          })
        : undefined);

    this.engine = composeReadOnlyAgentEngine({
      understandingLlm: options.understandingLlm,
      runLlm: options.runLlm,
      repositoryState,
      repositoryContext: options.repositoryContext,
      tools: options.tools,
      verification: options.verification,
      checkpointStore,
      skillsCatalog: options.skillsCatalog,
      memoryStore: options.memoryStore,
      memoryEmbedding: options.memoryEmbedding,
      toolDefinitions: options.toolDefinitions,
      taskListAutoAdvance: options.taskListAutoAdvance,
    });

    this.repositoryState = repositoryState;
    this.defaults = {
      mode: options.defaultMode ?? 'ask',
      sessionId: options.defaultSessionId ?? 'sdk_session',
      workspaceRoot: options.workspaceRoot,
      workspaceId: options.workspaceId,
    };
  }

  /**
   * Start a run. Returns an opaque handle with events + terminal result.
   */
  start(input: MitiiStartInput): MitiiRun {
    try {
      const engineInput = toAgentEngineStartInput(input, this.defaults);
      return new MitiiRun(this.engine.start(engineInput));
    } catch (error) {
      throw mapToSdkError(error);
    }
  }

  /**
   * Resume after clarification_required or approval_required suspension.
   */
  resume(input: MitiiResumeInput): MitiiRun {
    try {
      const parsed = mitiiResumeInputSchema.parse(input);
      return new MitiiRun(this.engine.resume(parsed));
    } catch (error) {
      throw mapToSdkError(error);
    }
  }

  /**
   * Optional publish helper — calls V8 Repository State facade only.
   * Requires repositoryState on the client (injected or enableInMemoryRepositoryState).
   */
  async publishRepositoryState(
    input: PublishRepositoryStateInput,
  ): Promise<PublishRepositoryStateResult> {
    if (!this.repositoryState) {
      throw new MitiiSdkError(
        'unsupported',
        'publishRepositoryState requires a repositoryState pipeline on the client.',
      );
    }
    try {
      return await this.repositoryState.publish(input);
    } catch (error) {
      throw mapToSdkError(error);
    }
  }

  /**
   * Publish a descriptor derived from a completed WorkspaceIndexingPipeline run.
   */
  async publishRepositoryStateFromIndexing(
    input: WorkspaceIndexingPipelineResult,
    options: {
      catalogRevisionByRoot?: Readonly<Record<string, string>>;
      graphRevisionByRoot?: Readonly<Record<string, string>>;
      mapRevisionByRoot?: Readonly<Record<string, string>>;
    } = {},
  ): Promise<PublishRepositoryStateResult> {
    if (!this.repositoryState) {
      throw new MitiiSdkError(
        'unsupported',
        'publishRepositoryStateFromIndexing requires a repositoryState pipeline on the client.',
      );
    }
    try {
      return await this.repositoryState.publishFromIndexing(input, options);
    } catch (error) {
      throw mapToSdkError(error);
    }
  }

  /**
   * Read the latest published descriptor for a workspace (host status UX).
   */
  async getLatestRepositoryState(workspaceId: string) {
    if (!this.repositoryState) {
      throw new MitiiSdkError(
        'unsupported',
        'getLatestRepositoryState requires a repositoryState pipeline on the client.',
      );
    }
    try {
      return await this.repositoryState.getLatest(workspaceId);
    } catch (error) {
      throw mapToSdkError(error);
    }
  }
}

export function createMitiiClient(options: CreateMitiiClientOptions): MitiiClient {
  return new MitiiClient(options);
}
