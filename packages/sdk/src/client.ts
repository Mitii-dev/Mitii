import {
  InMemoryRepositoryStateStore,
  InMemoryRunCheckpointStore,
  RepositoryStatePipeline,
  composeAgentEngine,
  parseV8EngineImplementation,
} from '@mitii/v8';
import type {
  AgentMode,
  ComposeAgentEngineOptions,
  LlmPort,
  MemoryEmbeddingPort,
  MemoryStorePort,
  MitiiAgentEngine,
  PublishRepositoryStateInput,
  PublishRepositoryStateResult,
  RepositoryContextPipeline,
  RepositoryStatePipeline as RepositoryStatePipelineType,
  RuntimePipeline,
  RuntimeRunResult,
  SkillsCatalogPort,
  ToolRuntimePipeline,
  VerificationPipeline,
  WorkspaceIndexingPipelineResult,
  RepositoryGraphPort,
  ToolAdversaryPort,
  AdversaryFailMode,
  V8EngineImplementation,
} from '@mitii/v8';

import {
  mitiiResumeInputSchema,
  toAgentEngineStartInput,
} from './contracts';
import type {
  MitiiResumeInput,
  MitiiRestoreInput,
  MitiiStartInput,
} from './contracts';
import { MitiiSdkError, mapToSdkError } from './errors';
import { MitiiRun } from './run';

export type { MitiiRestoreInput } from './contracts';

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
  /**
   * Optional published RepoGraph port. When set, follow_evidence planning
   * annotates Change steps with hop-1 mustRead/affected paths.
   */
  repoGraphs?: RepositoryGraphPort;
  verification?: VerificationPipeline;
  /** Enables clarification/approval resume across process turns. */
  checkpointStore?: ComposeAgentEngineOptions['checkpointStore'];
  skillsCatalog?: SkillsCatalogPort;
  memoryStore?: MemoryStorePort;
  memoryEmbedding?: MemoryEmbeddingPort;
  toolDefinitions?: ComposeAgentEngineOptions['toolDefinitions'];
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
  /**
   * Orchestrator implementation. When omitted, defaults to `v8`.
   * Pass `legacy` only as a compatibility alias (always resolves to v8).
   * Hosts map `mitii.engine.implementation`.
   * Do not resume a run across a flip — checkpoints are best-effort compatible.
   */
  engineImplementation?: V8EngineImplementation;
  /** Restrict-only ToolAdversaryPort. Default unset = no-op. */
  adversary?: ToolAdversaryPort;
  adversaryFailMode?: AdversaryFailMode;
  /**
   * Expose `startRuntimeShell` + allow `startPath: 'runtime'|'auto'`.
   * Default **true** (dual-run always composed).
   */
  enableRuntimeShell?: boolean;
  /**
   * Which path `start()` / matching `resume()` uses:
   * - `engine` — **deprecated escape** raw event-bus (full mutate parity)
   * - `runtime` — shell pump via V8 `wrapEngineWithRuntimeShell`
   * - `auto` (default) — all modes → runtime shell
   */
  startPath?: 'engine' | 'runtime' | 'auto';
}

/**
 * Host-neutral client over V8 Agent Engine.
 * Secrets (API keys) stay on injected LlmPort adapters — never on this options bag.
 */
export class MitiiClient {
  /** Runtime-shell wrap (V8 P8 bridge) — default start/resume path. */
  private readonly shellEngine: MitiiAgentEngine;
  /** Raw event-bus — restore only (`start`/`resume` sealed on product surface). */
  private readonly eventBusEngine: MitiiAgentEngine;
  private readonly runtime: RuntimePipeline;
  private readonly engineImplementation: V8EngineImplementation;
  private readonly enableRuntimeShell: boolean;
  /** Retained for option compat; `'engine'` is ignored (hard-deleted). */
  private readonly startPath: 'engine' | 'runtime' | 'auto';
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

    const composed = composeAgentEngine({
      understandingLlm: options.understandingLlm,
      runLlm: options.runLlm,
      repositoryState,
      repositoryContext: options.repositoryContext,
      tools: options.tools,
      repoGraphs: options.repoGraphs,
      verification: options.verification,
      checkpointStore,
      skillsCatalog: options.skillsCatalog,
      memoryStore: options.memoryStore,
      memoryEmbedding: options.memoryEmbedding,
      toolDefinitions: options.toolDefinitions,
      taskListAutoAdvance: options.taskListAutoAdvance,
      adversary: options.adversary,
      adversaryFailMode: options.adversaryFailMode,
      workspaceRoot: options.workspaceRoot,
      implementation: parseV8EngineImplementation(options.engineImplementation),
      preferRuntimeShell: true,
    });
    this.shellEngine = composed.engine;
    this.eventBusEngine = composed.eventBusEngine;
    this.runtime = composed.runtime;
    this.engineImplementation = composed.implementation;
    this.enableRuntimeShell = options.enableRuntimeShell !== false;
    this.startPath = options.startPath ?? 'auto';

    this.repositoryState = repositoryState;
    this.defaults = {
      mode: options.defaultMode ?? 'ask',
      sessionId: options.defaultSessionId ?? 'sdk_session',
      workspaceRoot: options.workspaceRoot,
      workspaceId: options.workspaceId,
    };
  }

  /** Which orchestrator this client is running (`legacy` or `v8`). */
  getEngineImplementation(): V8EngineImplementation {
    return this.engineImplementation;
  }

  /**
   * Start a run. Path follows `startPath` (default `auto`:
   * all modes → V8 runtime-shell wrap; `engine` = deprecated event-bus escape).
   */
  start(input: MitiiStartInput): MitiiRun {
    try {
      const engineInput = toAgentEngineStartInput(input, this.defaults);
      const surface = this.shouldUseRuntimeStart()
        ? this.shellEngine
        : this.eventBusEngine;
      return new MitiiRun(surface.start(engineInput));
    } catch (error) {
      throw mapToSdkError(error);
    }
  }

  /**
   * Explicit runtime shell start (pump 1–11). Requires enableRuntimeShell.
   */
  async startRuntimeShell(input: MitiiStartInput): Promise<RuntimeRunResult> {
    if (!this.enableRuntimeShell) {
      throw new MitiiSdkError(
        'invalid_input',
        'startRuntimeShell requires createMitiiClient({ enableRuntimeShell: true }).',
      );
    }
    try {
      const engineInput = toAgentEngineStartInput(input, this.defaults);
      return await this.runtime.start(engineInput);
    } catch (error) {
      throw mapToSdkError(error);
    }
  }

  /** Dual-run RuntimePipeline (always composed). */
  getRuntime(): RuntimePipeline {
    return this.runtime;
  }

  /** Which start() path is active for a mode under current settings. */
  resolveStartPath(mode?: AgentMode): 'engine' | 'runtime' {
    return this.shouldUseRuntimeStart(mode) ? 'runtime' : 'engine';
  }

  private shouldUseRuntimeStart(_mode?: AgentMode): boolean {
    if (!this.enableRuntimeShell) return false;
    // `startPath: 'engine'` hard-deleted — always shell when enabled.
    void this.startPath;
    return true;
  }

  /**
   * Resume after clarification_required or approval_required suspension.
   * Shell wrap owns session carry; event-bus used only for `startPath: 'engine'`.
   */
  resume(input: MitiiResumeInput): MitiiRun {
    try {
      const parsed = mitiiResumeInputSchema.parse(input);
      const surface = this.shouldUseRuntimeStart()
        ? this.shellEngine
        : this.eventBusEngine;
      return new MitiiRun(surface.resume(parsed));
    } catch (error) {
      throw mapToSdkError(error);
    }
  }

  /**
   * Undo workspace files to a RestorePoint (and any newer points for the run).
   * Never rewrites user git. Never escalates grants / interaction mode.
   */
  async restore(input: MitiiRestoreInput) {
    try {
      return await this.eventBusEngine.restore(input);
    } catch (error) {
      throw mapToSdkError(error);
    }
  }

  /** List durable restore points for a run (oldest → newest). */
  async listRestorePoints(runId: string): Promise<import('@mitii/v8').RestorePointSummary[]> {
    try {
      return await this.eventBusEngine.listRestorePoints(runId);
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
