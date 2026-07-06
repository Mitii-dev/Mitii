import { join } from 'path';
import { ThunderSession, type ThunderMode } from '../session/ThunderSession';
import { IndexService } from '../indexing/IndexService';
import { IgnoreService } from '../indexing/IgnoreService';
import { WorkspaceScanner } from '../indexing/WorkspaceScanner';
import { IndexQueue } from '../indexing/IndexQueue';
import { FtsIndex } from '../indexing/FtsIndex';
import { HybridRetriever } from '../context/HybridRetriever';
import type { ContextItem, ContextQuery } from '../context/types';
import { createContextReranker } from '../context/ContextReranker';
import { ContextBudgeter } from '../context/ContextBudgeter';
import { CurrentEditorContextSource, OpenFilesContextSource } from '../context/sources/editorSources';
import { FtsContextSource, RepoMapContextSource, MemoryContextSource, WorkspaceOverviewContextSource } from '../context/sources/indexSources';
import { IndexedFileSearchContextSource } from '../context/sources/indexedFileSource';
import { MentionedFileContextSource } from '../context/sources/mentionedFileSource';
import { GitService } from '../context/GitService';
import { GitDiffContextSource } from '../context/DiagnosticsService';
import { RepoMapService } from '../context/RepoMapService';
import { VectorContextSource } from '../context/sources/VectorContextSource';
import { CallGraphContextSource } from '../context/sources/callGraphSource';
import { VectorIndexService } from '../indexing/VectorIndex';
import { createVectorIndex } from '../indexing/vectorIndexFactory';
import { createEmbeddingProvider } from '../indexing/embeddingFactory';
import { getOrCreateLanguageService, disposeLanguageService } from '../indexing/languageServiceFactory';
import type { WorkspaceLanguageService } from '../indexing/WorkspaceLanguageService';
import type { EmbeddingProvider } from '../indexing/EmbeddingProvider';
import { setVerifyCommandPatterns } from '../plans/PlanActEngine';
import { ChatOrchestrator } from '../orchestration/ChatOrchestrator';
import { ToolRuntime } from '../tools/ToolRuntime';
import {
  createReadFileTool, createReadFilesTool, createListFilesTool, createResolvePathTool, createSearchTool,
  createSearchBatchTool, createSearchScriptCatalogTool, createSpawnResearchAgentTool, createSpawnSubagentTool,
  createExecuteWorkspaceScriptTool, createUseSkillTool,
  createRepoMapTool, createRetrieveContextTool, createGitDiffTool,
  createDiagnosticsTool, createWriteFileTool, createApplyPatchTool, createRunCommandTool,
  createMemorySearchTool, createMemoryWriteTool, createSaveTaskStateTool,
  createFetchWebTool, createAskQuestionTool, createProjectCatalogTool, createAnalyzeChangeImpactTool,
  setSubagentTracker,
} from '../tools/builtinTools';
import { ProjectCatalogContextSource, discoverProjectCatalog, saveProjectCatalog } from '../modes/ask';
import { createMarkStepCompleteTool, createProposePlanMutationTool } from '../tools/planTools';
import type { AssistantStreamChunk, LlmProvider } from '../llm/types';
import { createProvider } from '../llm/createProvider';
import { scaffoldMitiiWorkspace } from '../mcp/scaffoldMitiiWorkspace';
import { AgentTaskState } from '../runtime/AgentTaskState';
import {
  resolveProjectVerifyCommands,
  formatVerifyPlanForAgent,
} from '../runtime/verifyCommandDiscovery';
import { ToolPolicyEngine } from '../safety/ToolPolicyEngine';
import { resolveEffectiveSafety } from '../safety/autonomyPresets';
import { ApprovalQueue } from '../safety/ApprovalQueue';
import { ToolExecutor } from '../safety/ToolExecutor';
import { MemoryService } from '../memory/MemoryService';
import { SessionService } from '../session/SessionService';
import { PlanPersistence } from '../plans/PlanPersistence';
import { PlanFileStore } from '../plans/PlanFileStore';
import { MemoryExtractor } from '../runtime/MemoryExtractor';
import { SubagentTracker } from '../runtime/SubagentTracker';
import { PassiveMemoryInjector } from '../memory/PassiveMemoryInjector';
import { MemoryHookService } from '../memory/MemoryHookService';
import { AutoMemoryContextSource, AutoMemoryFileWriter } from '../memory/AutoMemoryFileWriter';
import { PostEditValidator } from '../apply/PostEditValidator';
import { McpManager } from '../mcp/McpManager';
import { ProjectRulesContextSource, ProjectRulesService } from '../rules/ProjectRulesService';
import { SkillCatalogContextSource, SkillCatalogService } from '../skills/SkillCatalogService';
import { createLogger } from '../telemetry/Logger';
import { SessionLogService } from '../telemetry/SessionLogService';
import { MicroTaskExecutor } from '../microtasks';
import { HeadlessAgentRunner, type HeadlessPlan } from './AgentRunner';
import {
  buildHeadlessConfig,
  resolveApiKey,
  resolveMitiiPackageRoot,
  type HeadlessAgentOptions,
} from './HeadlessConfig';
import { HeadlessDiagnosticsService, HeadlessDiagnosticsContextSource } from './HeadlessDiagnosticsService';
import { headlessDiscoverFiles } from './headlessDiscoverFiles';
import { defaultMcpToggles } from '../mcp/mcpToggles';
import type { ThunderConfig } from '../config/schema';
import { chunkContent } from '../llm/streamChunks';
import { chunkReasoning } from '../llm/streamChunks';
import { eventFromSessionLog, type MitiiApprovalDecision, type MitiiEvent } from './events';

const log = createLogger('HeadlessAgentHost');

const AUTO_GRANT_TOOLS = [
  'write_file', 'apply_patch', 'run_command', 'ask_question', 'memory_write',
] as const;

export interface HeadlessRunMetrics {
  durationMs: number;
  toolCalls: number;
  errors: string[];
  sessionLogPath?: string;
  auditTools: string[];
}

export class HeadlessAgentHost {
  private readonly options: HeadlessAgentOptions;
  private readonly config: ThunderConfig;
  private readonly packageRoot: string;
  private readonly stubRunner: HeadlessAgentRunner;
  private initialized = false;

  private indexService?: IndexService;
  private ignoreService = new IgnoreService();
  private languageService?: WorkspaceLanguageService;
  private scanner?: WorkspaceScanner;
  private indexQueue?: IndexQueue;
  private gitService?: GitService;
  private skillCatalogService?: SkillCatalogService;
  private memoryService?: MemoryService;
  private diagnosticsService = new HeadlessDiagnosticsService();
  private postEditValidator?: PostEditValidator;
  private sessionService?: SessionService;
  private planPersistence?: PlanPersistence;
  private approvalQueue?: ApprovalQueue;
  private policyEngine?: ToolPolicyEngine;
  private toolRuntime = new ToolRuntime();
  private toolExecutor?: ToolExecutor;
  private chatOrchestrator?: ChatOrchestrator;
  private retriever?: HybridRetriever;
  private embeddingProvider?: EmbeddingProvider;
  private vectorIndexService?: VectorIndexService;
  private memoryExtractor?: MemoryExtractor;
  private autoMemoryWriter?: AutoMemoryFileWriter;
  private mcpManager = new McpManager();
  private sessionLog = new SessionLogService();
  private subagentTracker = new SubagentTracker();
  private agentTaskState = new AgentTaskState();
  private session?: ThunderSession;
  private provider?: LlmProvider;

  constructor(options: HeadlessAgentOptions) {
    this.options = options;
    this.packageRoot = options.packageRoot ?? resolveMitiiPackageRoot(join(__dirname, '..'));
    this.config = buildHeadlessConfig(options);
    this.stubRunner = new HeadlessAgentRunner({
      cwd: options.cwd,
      providerType: options.providerType ?? this.config.provider.type,
      baseUrl: options.baseUrl ?? this.config.provider.baseUrl,
      model: options.model ?? this.config.provider.model,
      apiKey: options.apiKey ?? resolveApiKey(options.providerType ?? this.config.provider.type),
      approval: options.approval ?? 'manual',
    });
    if (options.onEvent) {
      this.sessionLog.onEvent((event) => {
        options.onEvent?.(eventFromSessionLog(event, this.options.cwd, this.session?.mode));
      });
    }
  }

  get isRealRuntime(): boolean {
    return this.options.runtime !== 'stub';
  }

  getSessionLog(): SessionLogService {
    return this.sessionLog;
  }

  getToolAudit(): ReturnType<ToolRuntime['getAuditLog']> {
    return this.toolRuntime.getAuditLog();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!this.isRealRuntime) {
      this.initialized = true;
      return;
    }

    const workspace = this.options.cwd;
    this.indexService = new IndexService(workspace);
    await this.indexService.initialize();

    scaffoldMitiiWorkspace(workspace, { extensionRoot: this.packageRoot, forceBundledSkills: false });
    try {
      saveProjectCatalog(discoverProjectCatalog(workspace));
    } catch (error) {
      log.warn('Project catalog discovery failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const db = this.indexService.getDb();
    if (!db) throw new Error('Failed to open index database');

    this.ignoreService.load(workspace, {
      respectGitignore: this.config.indexing.respectGitignore,
      respectThunderignore: this.config.indexing.respectThunderignore,
    });
    this.languageService = getOrCreateLanguageService(workspace, this.ignoreService, this.config.indexing);

    this.scanner = new WorkspaceScanner(db, workspace);
    this.embeddingProvider = createEmbeddingProvider(this.config.indexing);
    this.vectorIndexService = new VectorIndexService(
      createVectorIndex(db, workspace, this.config.indexing),
      this.embeddingProvider
    );
    this.indexQueue = new IndexQueue(db, {
      maxConcurrency: this.config.indexing.maxConcurrency,
      maxFileSizeBytes: this.config.indexing.maxFileSizeBytes,
    });
    this.indexQueue.setVectorService(workspace, this.vectorIndexService);

    this.gitService = new GitService(workspace);
    await this.gitService.initialize();

    this.diagnosticsService.setWorkspaceRoot(workspace);
    this.postEditValidator = new PostEditValidator(this.diagnosticsService as never);

    this.skillCatalogService = new SkillCatalogService(workspace);
    this.skillCatalogService.refresh();

    this.memoryService = new MemoryService(db, workspace, {
      maxItems: this.config.memory.maxItems,
      hybridSearchEnabled: this.config.memory.hybridSearchEnabled,
    });
    this.autoMemoryWriter = new AutoMemoryFileWriter(workspace, {
      enabled: this.config.memory.autoMemoryEnabled,
      scope: this.config.memory.autoMemoryScope,
    });

    this.sessionService = new SessionService(db);
    this.planPersistence = new PlanPersistence(db);
    this.approvalQueue = new ApprovalQueue(db);

    const effectiveSafety = resolveEffectiveSafety(this.config.safety);
    setVerifyCommandPatterns(this.config.agent.verifyCommands);

    this.policyEngine = new ToolPolicyEngine(
      effectiveSafety,
      (path) => this.ignoreService.isIgnored(path),
      () => true
    );

    this.toolRuntime.setSessionLog(this.sessionLog);
    setSubagentTracker(this.subagentTracker);

    this.toolExecutor = new ToolExecutor(
      this.toolRuntime,
      this.policyEngine,
      this.approvalQueue,
      () => this.session?.id ?? '',
      () => this.session?.mode ?? 'plan',
      () => this.autoResolvePendingApprovals(),
      () => this.agentTaskState,
      this.sessionLog,
      () => this.toolExecutor?.setPlanPhaseLock('execute')
    );

    const retriever = this.buildRetriever(db, workspace);
    this.retriever = retriever;
    const budgeter = new ContextBudgeter();
    this.chatOrchestrator = new ChatOrchestrator(retriever, budgeter, db);
    this.configureOrchestrator(workspace);

    const repoMap = new RepoMapService(db, workspace);
    const fts = new FtsIndex(db);
    this.registerTools(workspace, db, repoMap, fts, retriever, budgeter);

    const mcpToggles = {
      ...defaultMcpToggles(),
      puppeteer: this.config.mcp.builtinServers.puppeteer ?? false,
      agentmemory: this.config.mcp.builtinServers.agentmemory ?? false,
    };
    await this.mcpManager.reload(this.config.mcp, workspace, this.toolRuntime, mcpToggles);

    this.memoryExtractor = new MemoryExtractor(
      this.memoryService,
      this.config.memory.summarizeAfterTask,
      this.autoMemoryWriter
    );

    if (this.config.indexing.autoIndexOnOpen) {
      await this.indexWorkspace(workspace);
    }

    this.provider = createProvider(this.config.provider, this.options.apiKey ?? resolveApiKey(this.config.provider.type));
    this.initialized = true;
  }

  async ask(prompt: string): Promise<string> {
    await this.initialize();
    if (!this.isRealRuntime) return this.stubRunner.ask(prompt);
    return this.runMode('ask', prompt);
  }

  /** Raw retrieval results for a query, bypassing the LLM entirely. Used by retrieval evals/diagnostics. */
  async retrieveContext(query: ContextQuery): Promise<ContextItem[]> {
    await this.initialize();
    if (!this.retriever) throw new Error('Retriever unavailable (stub runtime)');
    return this.retriever.retrieve(query);
  }

  async plan(prompt: string): Promise<HeadlessPlan | Record<string, unknown>> {
    await this.initialize();
    if (!this.isRealRuntime) return this.stubRunner.plan(prompt);
    const content = await this.runMode('plan', prompt);
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return { goal: prompt, content, steps: [] };
    }
  }

  async *agent(prompt: string, signal?: AbortSignal): AsyncIterable<MitiiEvent> {
    await this.initialize();
    if (!this.isRealRuntime) {
      for await (const event of this.stubRunner.agent(prompt)) {
        if (signal?.aborted) break;
        yield event as MitiiEvent;
      }
      return;
    }

    const started = Date.now();
    let content = '';
    const pendingLogEvents: MitiiEvent[] = [];
    const unsubscribe = this.sessionLog.onEvent((event) => {
      pendingLogEvents.push(eventFromSessionLog(event, this.options.cwd, this.session?.mode));
    });
    const drain = function* (): Iterable<MitiiEvent> {
      while (pendingLogEvents.length > 0) {
        const event = pendingLogEvents.shift();
        if (event) yield event;
      }
    };

    try {
      if (signal) {
        signal.addEventListener('abort', () => this.cancel(), { once: true });
      }
      for await (const chunk of this.streamMode('agent', prompt)) {
        if (signal?.aborted) break;
        yield* drain();
        const text = chunkContent(chunk);
        const reasoning = chunkReasoning(chunk);
        if (reasoning) {
          const event: MitiiEvent = { type: 'reasoning_delta', content: reasoning };
          this.options.onEvent?.(event);
          yield event;
        }
        if (text) {
          content += text;
          const event: MitiiEvent = { type: 'assistant_delta', content: text };
          this.options.onEvent?.(event);
          yield event;
        }
      }
      yield* drain();
    } finally {
      unsubscribe();
    }
    const metrics = this.buildMetrics(started, []);
    const done: MitiiEvent = { type: 'done', content, metrics };
    this.options.onEvent?.(done);
    yield done;
  }

  async runWithMetrics(mode: ThunderMode, prompt: string): Promise<{ output: string; metrics: HeadlessRunMetrics }> {
    const started = Date.now();
    const errors: string[] = [];
    let output = '';

    try {
      if (mode === 'ask') {
        output = await this.ask(prompt);
      } else if (mode === 'plan') {
        output = JSON.stringify(await this.plan(prompt));
      } else {
        const parts: string[] = [];
        for await (const event of this.agent(prompt)) {
          if (event.type === 'assistant_delta') parts.push(event.content);
        }
        output = parts.join('');
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    const audit = this.getToolAudit();
    return {
      output,
      metrics: {
        durationMs: Date.now() - started,
        toolCalls: audit.length,
        errors,
        sessionLogPath: this.sessionLog.getLogPath() || undefined,
        auditTools: audit.map((entry) => entry.toolName),
      },
    };
  }

  dispose(): void {
    this.cancel();
    this.indexService?.dispose();
    disposeLanguageService(this.options.cwd);
    this.languageService = undefined;
    this.initialized = false;
  }

  cancel(): void {
    this.chatOrchestrator?.stop();
  }

  resolveApproval(id: string, decision: MitiiApprovalDecision): boolean {
    if (!this.approvalQueue) return false;
    this.approvalQueue.resolve(id, decision);
    this.sessionLog.append('approval_decision', `${decision}: ${id}`, { id, decision });
    return true;
  }

  private configureOrchestrator(workspace: string): void {
    if (!this.chatOrchestrator || !this.toolExecutor) return;

    const passiveMemoryInjector = new PassiveMemoryInjector(this.memoryService!);
    const memoryHookService = new MemoryHookService(workspace);

    this.chatOrchestrator.configure({
      toolRuntime: this.toolRuntime,
      toolExecutor: this.toolExecutor,
      sessionService: this.sessionService,
      planPersistence: this.planPersistence,
      memoryExtractor: this.memoryExtractor,
      memoryConfig: this.config.memory,
      agentConfig: this.config.agent,
      passiveMemoryInjector,
      memoryHookService,
      postEditValidator: this.postEditValidator,
      sessionLog: this.sessionLog,
      workspace,
      memoryService: this.memoryService,
      taskState: this.agentTaskState,
      skillCatalog: this.skillCatalogService,
      allowNetwork: () => resolveEffectiveSafety(this.config.safety).allowNetwork,
      runVerifyHooks: async (commands, userMessage) => this.runVerifyHooks(workspace, commands, userMessage ?? ''),
      microTaskRoutingEnabled: this.config.context.microTaskRoutingEnabled,
      microTaskExecutorFactory: (provider) => new MicroTaskExecutor({
        workspace,
        git: this.gitService!,
        provider,
        sessionLog: this.sessionLog,
      }),
      onPostWrite: async () => undefined,
      onDiffPreview: async () => undefined,
    });
    this.chatOrchestrator.setToolExecutor(this.toolExecutor);
  }

  private registerTools(
    workspace: string,
    db: import('../indexing/ThunderDb').ThunderDb,
    repoMap: RepoMapService,
    fts: FtsIndex,
    retriever: HybridRetriever,
    budgeter: ContextBudgeter
  ): void {
    this.toolRuntime.register(createReadFileTool(workspace, this.ignoreService, db));
    this.toolRuntime.register(createReadFilesTool(workspace, this.ignoreService, db));
    this.toolRuntime.register(createListFilesTool(workspace, this.ignoreService));
    this.toolRuntime.register(createResolvePathTool(workspace, this.ignoreService, db));
    this.toolRuntime.register(createSearchTool(fts, workspace));
    this.toolRuntime.register(createSearchBatchTool(fts, workspace));
    this.toolRuntime.register(createSearchScriptCatalogTool(workspace, this.packageRoot));
    this.toolRuntime.register(createExecuteWorkspaceScriptTool(workspace, this.packageRoot, this.ignoreService));
    this.toolRuntime.register(createUseSkillTool(this.skillCatalogService!));
    this.toolRuntime.register(createSpawnSubagentTool());
    this.toolRuntime.register(createSpawnResearchAgentTool());
    this.toolRuntime.register(createRepoMapTool(repoMap));
    this.toolRuntime.register(createRetrieveContextTool(retriever, budgeter));
    this.toolRuntime.register(createGitDiffTool(this.gitService!));
    this.toolRuntime.register(createDiagnosticsTool(this.diagnosticsService as never));
    this.toolRuntime.register(createProjectCatalogTool(workspace));
    this.toolRuntime.register(createAnalyzeChangeImpactTool(workspace));
    this.toolRuntime.register(createWriteFileTool(workspace, this.ignoreService));
    this.toolRuntime.register(createApplyPatchTool(workspace, this.ignoreService));
    this.toolRuntime.register(createRunCommandTool(workspace, () => this.session?.mode ?? 'plan'));
    this.toolRuntime.register(createMemorySearchTool(this.memoryService!));
    this.toolRuntime.register(createMemoryWriteTool(this.memoryService!, () => this.session?.id ?? ''));
    this.toolRuntime.register(createSaveTaskStateTool(this.memoryService!, () => this.session?.id ?? '', () => this.agentTaskState));
    this.toolRuntime.register(createFetchWebTool(() => this.config.safety.allowNetwork));
    this.toolRuntime.register(createAskQuestionTool());

    const sessionIdForPlans = () => this.session?.id ?? '';
    const planToolsCtx = {
      getPlan: () => this.planPersistence?.getActive(sessionIdForPlans())?.plan ?? null,
      setPlan: (plan: import('../plans/PlanActEngine').ThunderPlan) => {
        const sid = sessionIdForPlans();
        if (sid) this.planPersistence?.updatePlan(sid, plan);
      },
      planPersistence: this.planPersistence,
      getSessionId: sessionIdForPlans,
      setPlanPhaseLock: (phase: import('../plans/PlanActEngine').PlanPhase | undefined) => {
        this.toolExecutor?.setPlanPhaseLock(phase);
      },
      get planFileStore() {
        const sid = sessionIdForPlans();
        return sid ? new PlanFileStore(workspace, sid) : undefined;
      },
    };
    this.toolRuntime.register(createMarkStepCompleteTool(planToolsCtx));
    this.toolRuntime.register(createProposePlanMutationTool(planToolsCtx));
  }

  private buildRetriever(db: import('../indexing/ThunderDb').ThunderDb, workspace: string): HybridRetriever {
    const sources = [];
    const projectRulesService = new ProjectRulesService(workspace);
    sources.push(new ProjectRulesContextSource(projectRulesService));
    if (this.skillCatalogService) {
      sources.push(new SkillCatalogContextSource(this.skillCatalogService));
    }
    sources.push(new ProjectCatalogContextSource(workspace));
    sources.push(
      new MentionedFileContextSource(workspace),
      new WorkspaceOverviewContextSource(workspace),
      new CurrentEditorContextSource(workspace, db),
      new OpenFilesContextSource(workspace, db),
      new FtsContextSource(db),
      new IndexedFileSearchContextSource(db, workspace),
      new RepoMapContextSource(db, workspace)
    );
    if (this.gitService) sources.push(new GitDiffContextSource(this.gitService));
    sources.push(new HeadlessDiagnosticsContextSource(this.diagnosticsService));
    if (this.memoryService) sources.push(new MemoryContextSource(this.memoryService));
    if (this.autoMemoryWriter) sources.push(new AutoMemoryContextSource(this.autoMemoryWriter));
    if (this.config.indexing.vectorsEnabled && this.vectorIndexService) {
      sources.push(new VectorContextSource(this.vectorIndexService, workspace));
    }
    if (this.languageService) {
      sources.push(new CallGraphContextSource(db, workspace, this.languageService));
    }

    const reranker = createContextReranker(
      this.embeddingProvider,
      this.config.indexing.vectorsEnabled && this.config.indexing.embeddingProvider === 'minilm'
    );
    return new HybridRetriever(sources, reranker, {
      enabled: this.config.context.rerankerEnabled,
      candidatePool: this.config.context.rerankerCandidatePool,
      topK: this.config.context.rerankerTopK,
    });
  }

  private async indexWorkspace(workspace: string): Promise<void> {
    if (!this.scanner || !this.indexQueue) return;
    const files = headlessDiscoverFiles(workspace, this.ignoreService, this.config.indexing);
    const diff = this.scanner.computeDiff(files);
    this.scanner.persistScan(diff);
    const jobs = [...diff.added, ...diff.changed].map((f) => ({
      fileId: this.scanner!.getFileId(f.relPath)!,
      relPath: f.relPath,
      absPath: f.absPath,
      language: f.language,
    })).filter((j) => j.fileId !== undefined);

    if (jobs.length === 0) return;
    this.indexQueue.enqueue(jobs);

    const deadline = Date.now() + 120_000;
    while (this.indexQueue.getStatus().running || this.indexQueue.getStatus().queued > 0) {
      if (Date.now() > deadline) break;
      await sleep(250);
    }
    this.sessionLog.append('index_complete', 'Headless indexing finished', {
      workspace,
      jobCount: jobs.length,
    });
  }

  private async runMode(mode: ThunderMode, prompt: string): Promise<string> {
    const parts: string[] = [];
    for await (const chunk of this.streamMode(mode, prompt)) {
      const text = chunkContent(chunk);
      if (text) parts.push(text);
    }
    return parts.join('');
  }

  private async *streamMode(mode: ThunderMode, prompt: string): AsyncIterable<AssistantStreamChunk> {
    if (!this.chatOrchestrator || !this.provider) {
      throw new Error('Headless agent host is not initialized');
    }

    this.session = new ThunderSession(this.options.cwd, mode);
    if (this.options.sessionId) {
      this.session = new ThunderSession(this.options.cwd, mode, { id: this.options.sessionId });
    }
    this.sessionLog.configure(this.options.cwd, this.session.id, true, this.config.telemetry.debugMetrics);
    this.sessionLog.writeSessionHeader({
      mode,
      workspace: this.options.cwd,
      provider: this.config.provider.type,
      model: this.config.provider.model,
      runtime: this.options.runtime ?? 'real',
    });
    this.toolRuntime.clearAuditLog();
    this.agentTaskState.reset();
    this.agentTaskState.setLimits({
      maxSequentialThinkingCalls: this.config.agent.maxSequentialThinkingCallsPerTurn,
    });

    if (this.options.approval === 'auto') {
      for (const tool of AUTO_GRANT_TOOLS) {
        this.approvalQueue?.grantForTask(this.session.id, tool);
      }
    }

    this.sessionService?.ensureSession(this.session, prompt.slice(0, 64));
    yield* this.chatOrchestrator.send(this.session, this.provider, prompt, []);
  }

  private buildMetrics(started: number, errors: string[]): HeadlessRunMetrics {
    const audit = this.getToolAudit();
    return {
      durationMs: Date.now() - started,
      toolCalls: audit.length,
      errors,
      sessionLogPath: this.sessionLog.getLogPath() || undefined,
      auditTools: audit.map((entry) => entry.toolName),
    };
  }

  private autoResolvePendingApprovals(): void {
    if (this.options.approval !== 'auto' || !this.approvalQueue || !this.session) return;
    for (const request of this.approvalQueue.getPending()) {
      this.approvalQueue.grantForTask(this.session.id, request.toolName);
      this.approvalQueue.resolve(request.id, 'approved');
      this.sessionLog.append('approval_decision', `auto-approved: ${request.toolName}`, {
        id: request.id,
        toolName: request.toolName,
        scope: 'task',
      });
    }
  }

  private async runVerifyHooks(workspace: string, commands: string[], userMessage: string): Promise<string> {
    const lines: string[] = [];
    const touchedFiles = this.getTouchedFilesFromAudit();
    const plan = resolveProjectVerifyCommands(workspace, commands, { touchedFiles, userMessage });
    lines.push(formatVerifyPlanForAgent(plan));

    for (const command of plan.commands) {
      const trimmed = command.trim();
      if (!trimmed) continue;
      try {
        const result = await this.toolRuntime.execute('run_command', { command: trimmed });
        const body = result.success
          ? (result.output || '(no output)')
          : (result.error ?? result.output ?? 'command failed');
        lines.push(`$ ${trimmed}\n${body.slice(0, 4000)}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        lines.push(`$ ${trimmed}\n${msg}`);
      }
    }

    return lines.join('\n\n');
  }

  private getTouchedFilesFromAudit(): string[] {
    const files = new Set<string>();
    for (const { toolName, input, result } of this.toolRuntime.getAuditLog()) {
      if (!result.success || !['write_file', 'apply_patch'].includes(toolName)) continue;
      const path = (input as Record<string, unknown>).path;
      if (typeof path === 'string') files.add(path);
    }
    return [...files];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
