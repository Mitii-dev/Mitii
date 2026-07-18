import * as vscode from 'vscode';
import { AGENT_NAME, brandMessage } from '../../shared/brand';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import {
  ThunderSession,
  type ThunderMode,
  type ThunderSessionProviderOverride,
} from '../session/ThunderSession';
import { ConfigService } from '../config/ConfigService';
import { normalizeAgentDepth } from '../config/agentDepth';
import { LlmProviderRegistry } from '../llm/LlmProviderRegistry';
import { IndexService } from '../indexing/IndexService';
import { IgnoreService } from '../indexing/IgnoreService';
import { FileDiscoveryService } from '../indexing/FileDiscoveryService';
import { WorkspaceScanner } from '../indexing/WorkspaceScanner';
import { IndexQueue } from '../indexing/IndexQueue';
import {
  AUTO_INDEX_BACKGROUND_DELAY_MS,
  AUTO_INDEX_INITIAL_FILE_LIMIT,
  priorityDiscoveryRoots,
  sortIndexCandidates,
} from '../indexing/indexingPolicy';
import { initTreeSitter, preloadCommonLanguages } from '../indexing/TreeSitterService';
import { setTreeSitterEnabled } from '../indexing/SymbolExtractor';
import { FtsIndex } from '../indexing/FtsIndex';
import { detectLanguage, isBinaryByExtension } from '../indexing/fileUtils';
import { HybridRetriever } from '../context/HybridRetriever';
import { createContextReranker } from '../context/ContextReranker';
import { ContextBudgeter } from '../context/ContextBudgeter';
import { CurrentEditorContextSource, OpenFilesContextSource } from '../context/sources/editorSources';
import { FtsContextSource, RepoMapContextSource, MemoryContextSource, WorkspaceOverviewContextSource } from '../context/sources/indexSources';
import { IndexedFileSearchContextSource } from '../context/sources/indexedFileSource';
import { MentionedFileContextSource } from '../context/sources/mentionedFileSource';
import { GitService } from '../context/GitService';
import { DiagnosticsService, GitDiffContextSource, DiagnosticsContextSource } from '../context/DiagnosticsService';
import { RepoMapService } from '../context/RepoMapService';
import { setVerifyCommandPatterns } from '../plans/PlanActEngine';
import { debounce } from '../util/debounce';
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
  createProposeFileScopeTool,
  setSubagentTracker,
} from '../tools/builtinTools';
import {
  createAnalyzeLogDirectoryTool,
  createAnalyzeJsonlTool,
  createQueryLogEventsTool,
  createListLogsTool,
} from '../tools/logAuditTools';
import {
  createChangelogTools,
  createGitBlameTool,
  createGitBranchCreateTool,
  createGitBranchDeleteTool,
  createGitBranchSwitchTool,
  createGitCommitTool,
  createGitCompareBranchesTool,
  createGitHubTools,
  createGitLogTool,
  createGitMergeTool,
  createGitRebaseTool,
  createGitStageFilesTool,
  createGitStatusTool,
  createGitTagTools,
  createGitUnstageFilesTool,
  createReleasePlanControllerTool,
  createStructuredGitDiffTool,
  createWorkflowTools,
  createGitShowTool,
} from '../tools/gitTools';
import { ProjectCatalogContextSource, discoverProjectCatalog, saveProjectCatalog } from '../modes/ask';
import { createMarkStepCompleteTool, createProposePlanMutationTool } from '../tools/planTools';
import type { AssistantStreamChunk, LlmProvider } from '../llm/types';
import { UsageTrackingProvider, type ModelCallUsage } from '../llm/UsageTrackingProvider';
import { scaffoldMitiiWorkspace } from '../mcp/scaffoldMitiiWorkspace';
import { AgentTaskState } from '../runtime/AgentTaskState';
import { resolveProjectVerifyCommands, formatVerifyPlanForAgent, suggestInstallCommandsForVerifyFailure, isModuleResolutionVerifyFailure } from '../runtime/verifyCommandDiscovery';
import { formatDocumentationVerification, verifyDocumentationFiles } from '../runtime/docsVerification';
import { isApprovalContinuationMessage } from '../runtime/taskMessage';
import { resolveControlIntent } from '../runtime/controlIntent';
import { ToolPolicyEngine } from '../safety/ToolPolicyEngine';
import { resolveEffectiveSafety } from '../safety/autonomyPresets';
import { ApprovalQueue } from '../safety/ApprovalQueue';
import { ToolExecutor } from '../safety/ToolExecutor';
import { CheckpointService } from '../apply/CheckpointService';
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
import { VectorContextSource } from '../context/sources/VectorContextSource';
import { CallGraphContextSource } from '../context/sources/callGraphSource';
import { VectorIndexService } from '../indexing/VectorIndex';
import { createEmbeddingProvider, describeEmbeddingProvider } from '../indexing/embeddingFactory';
import { getOrCreateLanguageService, disposeLanguageService } from '../indexing/languageServiceFactory';
import { isTsLikeFile, type WorkspaceLanguageService } from '../indexing/WorkspaceLanguageService';
import { createVectorIndex, describeVectorBackend } from '../indexing/vectorIndexFactory';
import { isLanceDbAvailable, isMinilmAvailable } from '../indexing/vectorAvailability';
import type { EmbeddingProvider } from '../indexing/EmbeddingProvider';
import { McpManager } from '../mcp/McpManager';
import { ProjectRulesContextSource, ProjectRulesService } from '../rules/ProjectRulesService';
import {
  ProviderProfilesService,
  type ProviderProfileView as StoredProviderProfileView,
  providerSecretRef,
} from '../providers/ProviderProfilesService';
import { SkillCatalogContextSource, SkillCatalogService } from '../skills/SkillCatalogService';
import { InlineDiffManager } from '../../vscode/inlineDiffManager';
import { testProviderConnection } from '../llm/testConnection';
import { createLogger } from '../telemetry/Logger';
import { SessionLogService } from '../telemetry/SessionLogService';
import { debugTrace } from '../telemetry/AsyncDebugTrace';
import { normalizeError } from '../telemetry/errors';
import type { IndexingStatus } from '../indexing/IndexQueue';
import type {
  WebviewState,
  ContextToggles,
  McpToggles,
  ApprovalRequestView,
  PlanView,
  PinnedContextView,
  ContextPathSuggestion,
  TokenUsageView,
  TokenUsageBreakdownItem,
  McpCustomServerView,
  ModelOptionView,
  SessionProviderOverrideView,
} from '../../vscode/webview/messages';
import {
  initialWebviewState,
  defaultContextToggles,
  defaultMcpToggles,
} from '../../vscode/webview/messages';
import { listCustomMcpServers } from '../mcp/mcpWorkspaceConfig';
import { resolveDbPath } from '../indexing/paths';
import { searchWorkspacePaths, resolvePickedPaths } from '../context/contextPathSearch';
import { createWorkspacePattern, isWorkspaceInVscodeFolders, normalizeWorkspaceRoot, toWorkspaceRelPath, resolveWorkspaceRelPath } from '../util/paths';
import type { CommitMessageResult } from '../scm';
import { MicroTaskExecutor } from '../microtasks';
import { AuditPackBuilder } from '../audit';
import { GitHistoryCollector, generateChangelogEntry, generateReleaseNotes, insertChangelogEntry } from '../release';
import { collectReviewDiff } from '../scm/ReviewDiffCollector';
import {
  normalizeAgentSettings,
  normalizeProviderSettings,
  normalizeThunderSettings,
  validateProviderSettings,
  resolveAutoContextWindow,
} from '../config/ui/mappers';
import type {
  AgentSettingsPayload,
  McpSettingsPayload,
  ProviderSettingsPayload,
  SafetySettingsPayload,
  ThunderSettingsPayload,
} from '../config/ui/payloads';
import { PROVIDER_PRESETS, isCloudProvider } from '../llm/providerPresets';
import { resolveTierPolicy } from '../llm/agenticTier';
import type { AgenticTier, TierPolicy } from '../agentic/tierPolicy';
import type { ProviderType } from '../config/schema';

const log = createLogger('ThunderController');
const ONBOARDING_STATE_KEY = 'thunder.onboarding.completed.v1';

export type UiUpdateCallback = (partial: Partial<WebviewState>) => void;

export class ThunderController {
  private session: ThunderSession | undefined;
  private configService: ConfigService;
  private providerRegistry: LlmProviderRegistry;
  private indexService: IndexService | undefined;
  private ignoreService = new IgnoreService();
  private indexQueue: IndexQueue | undefined;
  private scanner: WorkspaceScanner | undefined;
  private chatOrchestrator: ChatOrchestrator | undefined;
  private toolRuntime = new ToolRuntime();
  private toolExecutor: ToolExecutor | undefined;
  private policyEngine: ToolPolicyEngine | undefined;
  private approvalQueue: ApprovalQueue | undefined;
  private gitService: GitService | undefined;
  private diagnosticsService = new DiagnosticsService();
  private memoryService: MemoryService | undefined;
  private autoMemoryWriter: AutoMemoryFileWriter | undefined;
  private checkpointService: CheckpointService | undefined;
  private sessionService: SessionService | undefined;
  private planPersistence: PlanPersistence | undefined;
  private memoryExtractor: MemoryExtractor | undefined;
  private subagentTracker = new SubagentTracker();
  private passiveMemoryInjector: PassiveMemoryInjector | undefined;
  private memoryHookService: MemoryHookService | undefined;
  private postEditValidator: PostEditValidator | undefined;
  private vectorIndexService: VectorIndexService | undefined;
  private embeddingProvider: EmbeddingProvider | undefined;
  private languageService: WorkspaceLanguageService | undefined;
  private languageServiceSyncDisposable: vscode.Disposable | undefined;
  private languageServiceUpdateDebouncers = new Map<string, () => void>();
  private mcpManager = new McpManager();
  private projectRulesService: ProjectRulesService | undefined;
  private providerProfilesService: ProviderProfilesService | undefined;
  private skillCatalogService: SkillCatalogService | undefined;
  private inlineDiffManager: InlineDiffManager | undefined;
  private researchAgentProvider: LlmProvider | undefined;
  private sessionLog = new SessionLogService();
  private lastAutoAuditExportSignature = '';
  private lastSubagentSnapshot = new Map<string, string>();
  private indexingStatus: IndexingStatus = { indexed: 0, queued: 0, running: false, failed: 0, total: 0, activeWorkers: 0, processed: 0, runTotal: 0, phase: 'idle' };
  private contextToggles: ContextToggles = defaultContextToggles();
  private mcpToggles: McpToggles = defaultMcpToggles();
  private pendingWatchJobs = new Map<string, import('../indexing/IndexQueue').IndexJob>();
  private watchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  private backgroundIndexTimer: ReturnType<typeof setTimeout> | undefined;
  private debouncedRebuildRetriever: (() => void) | undefined;
  private currentPlan: PlanView | null = null;
  private currentReviewDiff: WebviewState['reviewDiff'] = null;
  private agentActivity: import('../../vscode/webview/messages').AgentActivityEntry[] = [];
  private agentLiveStatus: import('../../vscode/webview/messages').AgentLiveStatusView | null = null;
  private tokenUsage: Omit<TokenUsageView, 'contextWindow'> = {
    sessionTotal: 0,
    inputTokensTotal: 0,
    outputTokensTotal: 0,
    currentTurnTotal: 0,
    currentTurnInputTokens: 0,
    currentTurnOutputTokens: 0,
    aiCallCount: 0,
    currentTurnAiCallCount: 0,
    lastCallInputTokens: 0,
    lastCallOutputTokens: 0,
    lastCallTotalTokens: 0,
    lastPromptTokens: 0,
    lastContextTokens: 0,
    lastResponseTokens: 0,
    turnCount: 0,
    estimated: true,
    breakdown: [] as import('../../vscode/webview/messages').TokenUsageBreakdownItem[],
  };
  private uiUpdate: UiUpdateCallback | undefined;
  private preservedUiGetter: (() => Partial<WebviewState>) | undefined;
  private autoFixCallback: ((message: string) => Promise<void>) | undefined;
  private autoFixDepth = 0;
  private disposed = false;
  private workspaceNotice: { kind: 'ok' | 'error' | 'warn'; message: string } | null = null;
  private configDisposable: vscode.Disposable | undefined;
  private pendingApprovalOutputs: string[] = [];
  private resumeApprovalResults: import('../runtime/AgentLoop').ApprovedToolResult[] = [];
  private agentTaskState = new AgentTaskState();
  private pinnedContext: PinnedContextView[] = [];
  private indexStatusNotifyTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingIndexStatus: IndexingStatus | undefined;
  private tokenUsageNotifyTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingTokenUsage: TokenUsageView | undefined;
  private settingsSaving = false;
  private testingConnection = false;
  private recentProviderOverrides: ThunderSessionProviderOverride[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.configService = new ConfigService(context);
    this.providerRegistry = new LlmProviderRegistry();
    this.inlineDiffManager = new InlineDiffManager(
      async (approvalId) => { await this.resolveApproval(approvalId, 'approved'); },
      async (approvalId) => { await this.resolveApproval(approvalId, 'denied'); }
    );
    context.subscriptions.push(this.inlineDiffManager);
    this.toolRuntime.setSessionLog(this.sessionLog);
    this.debouncedRebuildRetriever = debounce(() => this.rebuildRetriever(), 400);
  }

  async notifyTrustChanged(): Promise<void> {
    this.notifyUi({ workspaceTrusted: this.isWorkspaceTrusted() });
  }

  private isWorkspaceTrusted(): boolean {
    const config = this.configService.getConfig();
    if (config.safety.allowUntrustedWorkspace) return true;
    return vscode.workspace.isTrusted;
  }

  setUiUpdateCallback(cb: UiUpdateCallback): void {
    this.uiUpdate = cb;
  }

  setPreservedUiGetter(getter: () => Partial<WebviewState>): void {
    this.preservedUiGetter = getter;
  }

  private getPreservedUiBase(): Partial<WebviewState> {
    const preserved = this.preservedUiGetter?.() ?? {};
    return {
      tab: preserved.tab,
      mode: preserved.mode,
      messages: preserved.messages,
      currentSessionId: preserved.currentSessionId,
      chatHistory: preserved.chatHistory,
      loading: preserved.loading,
    };
  }

  setAutoFixCallback(cb: (message: string) => Promise<void>): void {
    this.autoFixCallback = cb;
  }

  private notifyUi(partial: Partial<WebviewState>): void {
    if (this.sessionLog.isEnabled() && this.configService.getConfig().telemetry.debugMetrics) {
      const keys = Object.keys(partial);
      const skipTrace =
        (keys.length === 1 && keys[0] === 'indexing') ||
        (keys.length === 1 && keys[0] === 'tokenUsage');
      if (!skipTrace) {
        this.sessionLog.appendUiTrace('UI partial update', {
          keys,
          loading: partial.loading,
          activityCount: partial.agentActivity?.length,
          planSteps: partial.plan?.steps.length,
          indexingRunning: partial.indexing?.running,
        });
      }
    }

    if (partial.indexing && Object.keys(partial).length === 1) {
      this.scheduleIndexingUiUpdate(partial.indexing);
      return;
    }
    if (partial.tokenUsage && Object.keys(partial).length === 1) {
      this.scheduleTokenUsageUiUpdate(partial.tokenUsage);
      return;
    }

    this.uiUpdate?.(partial);
  }

  private scheduleIndexingUiUpdate(status: IndexingStatus | WebviewState['indexing']): void {
    const normalized: IndexingStatus = {
      ...status,
      activeWorkers: status.activeWorkers ?? 0,
      processed: status.processed ?? 0,
      runTotal: status.runTotal ?? 0,
      phase: status.phase ?? (status.running ? 'indexing' : 'idle'),
      partial: status.partial ?? false,
      degraded: status.degraded ?? false,
    };
    this.indexingStatus = normalized;
    this.pendingIndexStatus = normalized;
    if (this.indexStatusNotifyTimer) return;
    this.indexStatusNotifyTimer = setTimeout(() => {
      this.indexStatusNotifyTimer = undefined;
      const next = this.pendingIndexStatus;
      this.pendingIndexStatus = undefined;
      if (next) this.uiUpdate?.({ indexing: next });
    }, 250);
  }

  private scheduleTokenUsageUiUpdate(usage: TokenUsageView): void {
    this.pendingTokenUsage = usage;
    if (this.tokenUsageNotifyTimer) return;
    this.tokenUsageNotifyTimer = setTimeout(() => {
      this.tokenUsageNotifyTimer = undefined;
      const next = this.pendingTokenUsage;
      this.pendingTokenUsage = undefined;
      if (next) this.uiUpdate?.({ tokenUsage: next });
    }, 200);
  }

  private configureSessionLogging(session: ThunderSession, workspace: string): void {
    const config = this.configService.getConfig();
    const telemetry = config.telemetry;
    this.sessionLog.configure(workspace, session.id, telemetry.sessionLogging, telemetry.debugMetrics);
    debugTrace.configure(workspace, session.id, {
      ...config.debugTrace,
      enabled: telemetry.sessionLogging && config.debugTrace.enabled,
    });
    this.toolRuntime.setWorkspace(workspace);
    this.sessionLog.configureWebhook({
      url: telemetry.webhookUrl,
      secret: telemetry.webhookSecret || process.env.MITII_TELEMETRY_WEBHOOK_SECRET,
      timeoutMs: telemetry.webhookTimeoutMs,
    });
    this.sessionLog.writeSessionHeader({
      mode: session.mode,
      model: this.configService.getConfig().provider.model,
      provider: this.configService.getConfig().provider.type,
      debugMetrics: telemetry.debugMetrics,
    });
  }

  private async refreshResearchAgentProvider(): Promise<void> {
    const config = this.configService.getConfig();
    const model = config.agent.researchAgentModel?.trim();
    if (!model || config.provider.type === 'echo') {
      this.researchAgentProvider = undefined;
      return;
    }

    const apiKey = await this.configService.getApiKey();
    this.researchAgentProvider = this.providerRegistry.resolveFromOptions({
      type: config.provider.type,
      baseUrl: config.agent.researchAgentBaseUrl?.trim() || config.provider.baseUrl,
      model,
      contextWindow: config.provider.contextWindow,
      supportsStreaming: config.provider.supportsStreaming,
      supportsTools: config.provider.supportsTools,
      supportsEmbeddings: config.provider.supportsEmbeddings,
    }, apiKey);
  }

  async initialize(): Promise<void> {
    await this.configService.initialize();
    this.mcpToggles = this.loadMcpTogglesFromConfig();
    this.contextToggles = {
      ...defaultContextToggles(),
      vectors: this.configService.getConfig().indexing.vectorsEnabled,
    };

    const workspace = this.resolveWorkspacePath();
    const vscodeFolder = this.getPrimaryVscodeFolder();
    const source: 'vscode' | 'override' | 'none' = vscodeFolder
      ? 'vscode'
      : this.configService.getWorkspaceOverride()
        ? 'override'
        : 'none';
    this.session = new ThunderSession(workspace);
    if (workspace) {
      this.configureSessionLogging(this.session, workspace);
    }
    this.logWorkspaceResolution(workspace, source);

    if (workspace) {
      try {
        await this.initializeWorkspaceServices(workspace);
      } catch (error) {
        log.error('Workspace services init failed, using minimal context', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.initMinimalChat(workspace);
      }
    }

    if (workspace && !this.chatOrchestrator) {
      this.initMinimalChat(workspace);
    }

    const config = this.configService.getConfig();
    const apiKey = await this.configService.getApiKey();
    await this.providerRegistry.resolveFromConfig(config.provider, apiKey);
    await this.refreshResearchAgentProvider();
    this.chatOrchestrator?.configure({ researchAgentProvider: this.researchAgentProvider });

    this.configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('mitii.workspace') || e.affectsConfiguration('mitii') || e.affectsConfiguration('thunder.workspace') || e.affectsConfiguration('thunder')) {
        void this.reloadWorkspace();
      }
    });
    this.context.subscriptions.push(this.configDisposable);

    log.info('ThunderController initialized', { workspace });
    if (workspace) {
      void this.maybeAutoIndex();
    }
  }

  private getPrimaryVscodeFolder(): string {
    return normalizeWorkspaceRoot(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '') ?? '';
  }

  private logWorkspaceResolution(workspace: string, source: 'vscode' | 'override' | 'none'): void {
    log.info('Workspace resolved', {
      workspace,
      source,
      vscodeFolders: this.getVscodeWorkspaceFolders(),
      override: this.configService.getWorkspaceOverride() || undefined,
    });
    this.sessionLog.append('workspace_resolved', `Workspace: ${workspace || '(none)'}`, {
      workspace,
      source,
      vscodeFolders: this.getVscodeWorkspaceFolders(),
      override: this.configService.getWorkspaceOverride() || undefined,
    });
  }

  private async maybeAutoIndex(): Promise<void> {
    const config = this.configService.getConfig();
    if (!config.indexing.enabled || !config.indexing.autoIndexOnOpen) return;
    try {
      await this.indexWorkspace({ force: false, auto: true });
    } catch (error) {
      log.warn('Auto-index on open failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private initMinimalChat(workspace: string): void {
    this.diagnosticsService.setWorkspaceRoot(workspace);
    scaffoldMitiiWorkspace(workspace, { extensionRoot: this.context.extensionPath });
    this.projectRulesService = new ProjectRulesService(workspace);
    this.providerProfilesService = new ProviderProfilesService(workspace);
    this.skillCatalogService = new SkillCatalogService(workspace);
    this.skillCatalogService.refresh();
    const retriever = new HybridRetriever(
      [
        new ProjectRulesContextSource(this.projectRulesService, () => this.currentTierPolicy()),
        new SkillCatalogContextSource(this.skillCatalogService),
        new ProjectCatalogContextSource(workspace),
        new MentionedFileContextSource(workspace),
        new WorkspaceOverviewContextSource(workspace),
        new CurrentEditorContextSource(workspace),
        new OpenFilesContextSource(workspace),
      ],
      createContextReranker(),
      this.rerankerConfigFromSettings(),
      (timing) => this.logRetrievalTiming(timing)
    );
    this.chatOrchestrator = this.createChatOrchestrator(retriever, new ContextBudgeter(), undefined, workspace);
    log.info('Minimal chat orchestrator initialized');
  }

  private async initializeWorkspaceServices(workspace: string): Promise<void> {
    const config = this.configService.getConfig();

    this.indexService = new IndexService(workspace);
    await this.indexService.initialize();
    scaffoldMitiiWorkspace(workspace, { extensionRoot: this.context.extensionPath });
    try {
      saveProjectCatalog(discoverProjectCatalog(workspace));
    } catch (error) {
      log.warn('Project catalog discovery failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const db = this.indexService.getDb();
    if (!db) return;

    this.ignoreService.load(workspace, {
      respectGitignore: config.indexing.respectGitignore,
      respectThunderignore: config.indexing.respectThunderignore,
    });
    this.languageService = getOrCreateLanguageService(workspace, this.ignoreService, config.indexing);

    this.scanner = new WorkspaceScanner(db, workspace);
    setTreeSitterEnabled(config.indexing.treeSitterEnabled);
    this.embeddingProvider = createEmbeddingProvider(config.indexing);
    this.vectorIndexService = new VectorIndexService(
      createVectorIndex(db, workspace, config.indexing),
      this.embeddingProvider
    );
    this.indexQueue = new IndexQueue(db, {
      maxConcurrency: config.indexing.maxConcurrency,
      maxFileSizeBytes: config.indexing.maxFileSizeBytes,
      deferVectorWrites: true,
    });
    this.indexQueue.setVectorService(workspace, this.vectorIndexService);
    this.indexQueue.onIndexingComplete(() => {
      RepoMapService.invalidateWorkspace(workspace);
    });
    if (config.indexing.treeSitterEnabled) {
      void initTreeSitter().then((ready) => {
        if (ready) void preloadCommonLanguages();
      });
    }
    this.indexQueue.onStatusChange((status) => {
      this.scheduleIndexingUiUpdate(status);
    });
    this.indexingStatus = this.indexQueue.getStatus();

    this.gitService = new GitService(workspace);
    await this.gitService.initialize();

    this.diagnosticsService.setWorkspaceRoot(workspace);
    this.projectRulesService = new ProjectRulesService(workspace);
    this.providerProfilesService = new ProviderProfilesService(workspace);
    this.skillCatalogService = new SkillCatalogService(workspace);
    this.skillCatalogService.refresh();
    this.memoryService = new MemoryService(db, workspace, {
      maxItems: config.memory.maxItems,
      hybridSearchEnabled: config.memory.hybridSearchEnabled,
    });
    this.autoMemoryWriter = new AutoMemoryFileWriter(workspace, {
      enabled: config.memory.autoMemoryEnabled,
      scope: config.memory.autoMemoryScope,
    });
    if (config.indexing.vectorsEnabled) {
      this.memoryService.setEmbedder(this.embeddingProvider);
    }
    this.passiveMemoryInjector = new PassiveMemoryInjector(this.memoryService);
    this.memoryHookService = new MemoryHookService(workspace);
    this.postEditValidator = new PostEditValidator(this.diagnosticsService);
    this.subagentTracker.setUpdateCallback((runs) => {
      for (const run of runs) {
        const prev = this.lastSubagentSnapshot.get(run.id);
        const statusKey = `${run.status}:${run.summary ?? ''}:${run.error ?? ''}`;
        if (prev === statusKey) continue;
        this.lastSubagentSnapshot.set(run.id, statusKey);
        if (run.status === 'running' && !prev) {
          this.sessionLog.append('subagent_start', run.task.slice(0, 120), {
            id: run.id,
            focus: run.focus,
          });
        } else if (run.status === 'done') {
          this.sessionLog.append('subagent_end', run.task.slice(0, 120), {
            id: run.id,
            success: true,
            summary: run.summary,
            durationMs: run.finishedAt && run.startedAt ? run.finishedAt - run.startedAt : undefined,
          });
        } else if (run.status === 'error') {
          this.sessionLog.append('subagent_end', run.task.slice(0, 120), {
            id: run.id,
            success: false,
            error: run.error,
          });
        }
      }
      this.notifyUi({
        subagents: runs.map((r) => ({
          id: r.id,
          type: r.type,
          task: r.task,
          focus: r.focus,
          scope: r.scope,
          progress: r.progress,
          status: r.status,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          summary: r.summary,
          error: r.error,
        })),
      });
    });
    this.checkpointService = new CheckpointService(db, workspace, this.gitService);
    this.checkpointService.setStrategy(config.agent.checkpointStrategy);
    this.sessionService = new SessionService(db);
    this.planPersistence = new PlanPersistence(db);
    this.approvalQueue = new ApprovalQueue(db);

    const effectiveSafety = resolveEffectiveSafety(config.safety);

    setVerifyCommandPatterns(config.agent.verifyCommands);

    this.policyEngine = new ToolPolicyEngine(
      effectiveSafety,
      (path, options) => this.ignoreService.isIgnored(path, options),
      () => this.isWorkspaceTrusted(),
      (path) => resolveWorkspaceRelPath(workspace, path)
    );

    this.toolExecutor = new ToolExecutor(
      this.toolRuntime,
      this.policyEngine,
      this.approvalQueue,
      () => this.session?.id ?? '',
      () => this.session?.mode ?? 'plan',
      () => {
        const pending = this.approvalQueue?.getPending() ?? [];
        this.agentLiveStatus = {
          label: 'Waiting for approval',
          detail: `${pending.length} action${pending.length === 1 ? '' : 's'} need your review`,
        };
        this.pushActivity(
          'approval',
          'Waiting for your approval',
          pending.map((p) => p.inputPreview).join('\n') || undefined
        );
        this.notifyUi({
          approvals: pending.map(toApprovalView),
          agentLiveStatus: this.agentLiveStatus,
          agentActivity: this.agentActivity,
        });
      },
      () => this.agentTaskState,
      this.sessionLog,
      () => this.toolExecutor?.setPlanPhaseLock('execute')
    );

    const retriever = this.buildRetriever(db, workspace);
    const budgeter = new ContextBudgeter();
    this.chatOrchestrator = this.createChatOrchestrator(retriever, budgeter, db, workspace);

    const repoMap = new RepoMapService(db, workspace);
    const fts = new FtsIndex(db);

    this.toolRuntime.register(createReadFileTool(workspace, this.ignoreService, db));
    this.toolRuntime.register(createReadFilesTool(workspace, this.ignoreService, db));
    this.toolRuntime.register(createListFilesTool(workspace, this.ignoreService));
    this.toolRuntime.register(createResolvePathTool(workspace, this.ignoreService, db));
    this.toolRuntime.register(createSearchTool(fts, workspace));
    this.toolRuntime.register(createSearchBatchTool(fts, workspace));
    this.toolRuntime.register(createSearchScriptCatalogTool(workspace, this.context.extensionPath));
    this.toolRuntime.register(createExecuteWorkspaceScriptTool(workspace, this.context.extensionPath, this.ignoreService));
    this.toolRuntime.register(createUseSkillTool(this.skillCatalogService, () => this.getSkillRuntimeContext()));
    this.toolRuntime.register(createSpawnSubagentTool());
    this.toolRuntime.register(createSpawnResearchAgentTool());
    this.toolRuntime.register(createRepoMapTool(repoMap));
    this.toolRuntime.register(createRetrieveContextTool(retriever, budgeter));
    this.toolRuntime.register(createGitDiffTool(this.gitService));
    this.toolRuntime.register(createGitStatusTool(workspace));
    this.toolRuntime.register(createStructuredGitDiffTool(workspace));
    this.toolRuntime.register(createGitLogTool(workspace));
    this.toolRuntime.register(createGitShowTool(workspace));
    this.toolRuntime.register(createGitBlameTool(workspace));
    this.toolRuntime.register(createGitCompareBranchesTool(workspace));
    this.toolRuntime.register(createGitStageFilesTool(workspace));
    this.toolRuntime.register(createGitUnstageFilesTool(workspace));
    this.toolRuntime.register(createGitCommitTool(workspace));
    this.toolRuntime.register(createGitBranchCreateTool(workspace));
    this.toolRuntime.register(createGitBranchSwitchTool(workspace));
    this.toolRuntime.register(createGitBranchDeleteTool(workspace));
    this.toolRuntime.register(createGitMergeTool(workspace));
    this.toolRuntime.register(createGitRebaseTool(workspace));
    for (const tool of createGitTagTools(workspace)) this.toolRuntime.register(tool);
    for (const tool of createChangelogTools(workspace)) this.toolRuntime.register(tool);
    for (const tool of createWorkflowTools(workspace)) this.toolRuntime.register(tool);
    for (const tool of createGitHubTools(workspace)) this.toolRuntime.register(tool);
    this.toolRuntime.register(createReleasePlanControllerTool());
    this.toolRuntime.register(createDiagnosticsTool(this.diagnosticsService));
    this.toolRuntime.register(createProjectCatalogTool(workspace));
    this.toolRuntime.register(createAnalyzeChangeImpactTool(workspace));
    this.toolRuntime.register(createProposeFileScopeTool(workspace, this.ignoreService, db, () => this.agentTaskState));
    this.toolRuntime.register(createAnalyzeLogDirectoryTool(workspace, this.ignoreService, () => this.sessionLog.getLogPath()));
    this.toolRuntime.register(createAnalyzeJsonlTool(workspace, this.ignoreService));
    this.toolRuntime.register(createQueryLogEventsTool(workspace, this.ignoreService));
    this.toolRuntime.register(createListLogsTool(workspace));
    this.toolRuntime.register(createWriteFileTool(workspace, this.ignoreService));
    this.toolRuntime.register(createApplyPatchTool(workspace, this.ignoreService));
    this.toolRuntime.register(createRunCommandTool(workspace, () => this.session?.mode ?? 'plan'));
    this.toolRuntime.register(createMemorySearchTool(this.memoryService));
    this.toolRuntime.register(createMemoryWriteTool(this.memoryService, () => this.session?.id ?? ''));
    this.toolRuntime.register(createSaveTaskStateTool(this.memoryService, () => this.session?.id ?? '', () => this.agentTaskState));
    this.toolRuntime.register(createFetchWebTool(() => resolveEffectiveSafety(this.configService.getConfig().safety).allowNetwork));
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
    await this.mcpManager.reload(config.mcp, workspace, this.toolRuntime, this.mcpToggles);

    this.memoryExtractor = new MemoryExtractor(
      this.memoryService,
      config.memory.summarizeAfterTask,
      this.autoMemoryWriter
    );

    this.setupFileWatcher(workspace);
    this.setupLanguageServiceSync(workspace);
  }

  /** Keeps the persistent language service's in-memory AST synchronized with unsaved editor
   * buffers. Debounced per-file — a single shared debounce would drop updates when the user
   * edits two files close together in time. */
  private setupLanguageServiceSync(workspace: string): void {
    this.languageServiceSyncDisposable?.dispose();
    this.languageServiceUpdateDebouncers.clear();

    const config = this.configService.getConfig();
    const pendingContent = new Map<string, string>();
    this.languageServiceSyncDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
      if (!isTsLikeFile(e.document.fileName)) return;
      const relPath = toWorkspaceRelPath(e.document.uri, workspace);
      if (!relPath || this.ignoreService.isIgnored(relPath)) return;

      // Always capture the latest text synchronously; only the *flush* is debounced, so a
      // debounced closure created on an earlier keystroke never applies stale content.
      pendingContent.set(relPath, e.document.getText());

      let scheduled = this.languageServiceUpdateDebouncers.get(relPath);
      if (!scheduled) {
        scheduled = debounce(() => {
          const content = pendingContent.get(relPath);
          if (content !== undefined) this.languageService?.updateFile(relPath, content);
        }, config.indexing.watchDebounceMs);
        this.languageServiceUpdateDebouncers.set(relPath, scheduled);
      }
      scheduled();
    });
    this.context.subscriptions.push(this.languageServiceSyncDisposable);
  }

  private createChatOrchestrator(
    retriever: HybridRetriever,
    budgeter: ContextBudgeter,
    db?: import('../indexing/ThunderDb').ThunderDb,
    workspace?: string
  ): ChatOrchestrator {
    const orchestrator = new ChatOrchestrator(retriever, budgeter, db);
    const ws = workspace ?? this.resolveWorkspacePath();
    const config = this.configService.getConfig();
    orchestrator.configure({
      toolRuntime: this.toolRuntime,
      toolExecutor: this.toolExecutor,
      sessionService: this.sessionService,
      planPersistence: this.planPersistence,
      memoryExtractor: this.memoryExtractor,
      memoryConfig: config.memory,
      agentConfig: config.agent,
      researchAgentProvider: this.researchAgentProvider,
      passiveMemoryInjector: this.passiveMemoryInjector,
      memoryHookService: this.memoryHookService,
      postEditValidator: this.postEditValidator,
      sessionLog: this.sessionLog,
      onPostWrite: async (relPath) => {
        await this.validateAfterWrite(relPath);
      },
      runVerifyHooks: async (commands, userMessage) => this.runVerifyHooks(commands, userMessage ?? ''),
      workspace: ws,
      memoryService: this.memoryService,
      taskState: this.agentTaskState,
      skillCatalog: this.skillCatalogService,
      allowNetwork: () => resolveEffectiveSafety(this.configService.getConfig().safety).allowNetwork,
      githubTokenProvider: async () => this.configService.getApiKey(
        this.configService.getConfig().github.tokenRef
      ),
      githubIssueFetchEnabled: config.github.issueFetchEnabled,
      githubIssueCommentLimit: config.github.issueCommentLimit,
      microTaskRoutingEnabled: config.context.microTaskRoutingEnabled,
      microTaskExecutorFactory: (provider) => {
        if (!ws || !this.gitService) {
          throw new Error('Micro-task routing requires an initialized workspace and Git repository.');
        }
        return new MicroTaskExecutor({
          workspace: ws,
          git: this.gitService,
          provider,
          sessionLog: this.sessionLog,
        });
      },
    });
    orchestrator.setToolExecutor(this.toolExecutor);
    orchestrator.setContextPackCallback((pack, views, budget) => {
      this.notifyUi({
        contextPreview: views,
        contextTokenEstimate: pack.totalTokens,
        contextBudget: budget,
        showContextPreview: true,
      });
    });
    orchestrator.setActivityCallback((entry) => {
      this.agentActivity = [...this.agentActivity.slice(-20), entry];
      if (entry.kind === 'skipped') {
        this.sessionLog.append('info', entry.message, { detail: entry.detail });
      } else if (entry.kind === 'error' && entry.detail !== 'Awaiting approval') {
        this.sessionLog.append('error', entry.message, { detail: entry.detail });
      }
      const partial: Partial<WebviewState> = { agentActivity: this.agentActivity };
      const pending = this.approvalQueue?.getPending() ?? [];
      if (pending.length > 0) {
        partial.approvals = pending.map(toApprovalView);
      }
      this.notifyUi(partial);
    });
    orchestrator.setLiveStatusCallback((status) => {
      this.agentLiveStatus = status;
      this.notifyUi({ agentLiveStatus: status });
    });
    orchestrator.setTokenUsageCallback((promptTokens, contextTokens, responseText, breakdown, options) => {
      const responseTokens = Math.ceil(responseText.length / 4);
      const effectivePromptTokens = Math.max(promptTokens, this.tokenUsage.lastCallInputTokens);
      const effectiveBreakdown = normalizePromptBreakdown(breakdown, effectivePromptTokens);
      this.tokenUsage.lastPromptTokens = effectivePromptTokens;
      this.tokenUsage.lastContextTokens = contextTokens;
      this.tokenUsage.lastResponseTokens = responseTokens;
      if (options?.final !== false) {
        this.tokenUsage.turnCount += 1;
      }
      this.tokenUsage.breakdown = effectiveBreakdown;
      const config = this.configService.getConfig();
      if (options?.final !== false) {
        this.sessionLog.append('token_usage', 'Session token rollup', {
          turnPromptTokens: effectivePromptTokens,
          estimatedPromptTokens: promptTokens,
          turnContextTokens: contextTokens,
          turnResponseTokens: responseTokens,
          turnAiCallCount: this.tokenUsage.currentTurnAiCallCount,
          turnInputTokens: this.tokenUsage.currentTurnInputTokens,
          turnOutputTokens: this.tokenUsage.currentTurnOutputTokens,
          turnTotalTokens: this.tokenUsage.currentTurnTotal,
          sessionInputTokens: this.tokenUsage.inputTokensTotal,
          sessionOutputTokens: this.tokenUsage.outputTokensTotal,
          sessionTotal: this.tokenUsage.sessionTotal,
          turnCount: this.tokenUsage.turnCount,
          estimated: this.tokenUsage.estimated,
        });
      }

      this.notifyUi({
        tokenUsage: {
          ...this.tokenUsage,
          contextWindow: config.provider.contextWindow,
        },
      });
    });
    orchestrator.setPlanCallback((plan) => {
      this.currentPlan = plan;
      this.notifyUi({ plan });
    });
    return orchestrator;
  }

  private rebuildRetriever(): void {
    const workspace = this.resolveWorkspacePath();
    const db = this.indexService?.getDb();
    if (!workspace || !db?.isOpen()) return;
    const retriever = this.buildRetriever(db, workspace);
    this.chatOrchestrator = this.createChatOrchestrator(retriever, new ContextBudgeter(), db, workspace);
  }

  private rerankerConfigFromSettings(): import('../context/HybridRetriever').RerankerConfig {
    const context = this.configService.getConfig().context;
    return {
      enabled: context.rerankerEnabled,
      candidatePool: context.rerankerCandidatePool,
      topK: context.rerankerTopK,
    };
  }

  private currentTierPolicy(): TierPolicy | undefined {
    const config = this.configService.getConfig();
    const override = config.agent.agenticTierOverride;
    const tier: AgenticTier | undefined = override !== 'auto'
      ? override
      : this.providerRegistry.getActive()?.capabilities.agenticTier;
    return tier ? resolveTierPolicy(tier) : undefined;
  }

  private buildRetriever(db: import('../indexing/ThunderDb').ThunderDb, workspace: string): HybridRetriever {
    const sources = [];
    if (this.projectRulesService) {
      sources.push(new ProjectRulesContextSource(this.projectRulesService, () => this.currentTierPolicy()));
    }
    if (this.skillCatalogService) {
      sources.push(new SkillCatalogContextSource(this.skillCatalogService));
    }
    sources.push(new ProjectCatalogContextSource(workspace));
    sources.push(
      new MentionedFileContextSource(workspace),
      new WorkspaceOverviewContextSource(workspace),
      new CurrentEditorContextSource(workspace, db),
      new OpenFilesContextSource(workspace, db)
    );
    if (this.contextToggles.fts) {
      sources.push(new FtsContextSource(db));
      sources.push(new IndexedFileSearchContextSource(db, workspace));
    }
    if (this.contextToggles.repoMap) sources.push(new RepoMapContextSource(db, workspace));
    if (this.contextToggles.gitDiff && this.gitService) sources.push(new GitDiffContextSource(this.gitService));
    if (this.contextToggles.diagnostics) sources.push(new DiagnosticsContextSource(this.diagnosticsService));
    if (this.contextToggles.memory) sources.push(new MemoryContextSource(this.memoryService));
    if (this.contextToggles.memory && this.autoMemoryWriter) sources.push(new AutoMemoryContextSource(this.autoMemoryWriter));
    if (this.contextToggles.vectors && this.vectorIndexService) {
      sources.push(new VectorContextSource(this.vectorIndexService, workspace));
    }
    if (this.contextToggles.callGraph && this.languageService) {
      sources.push(new CallGraphContextSource(db, workspace, this.languageService));
    }

    const config = this.configService.getConfig();
    const reranker = createContextReranker(
      this.embeddingProvider,
      config.indexing.vectorsEnabled && config.indexing.embeddingProvider === 'minilm'
    );

    return new HybridRetriever(
      sources,
      reranker,
      this.rerankerConfigFromSettings(),
      (timing) => this.logRetrievalTiming(timing)
    );
  }

  private logRetrievalTiming(timing: import('../context/HybridRetriever').ContextRetrievalTiming | import('../context/HybridRetriever').RerankTiming): void {
    if (!this.sessionLog.isDebugMetricsEnabled()) return;
    if ('candidateCount' in timing) {
      this.sessionLog.appendTiming('context_reranker', timing.durationMs, { ...timing });
      return;
    }
    this.sessionLog.appendTiming(`context_source:${timing.source}`, timing.durationMs, { ...timing });
  }

  private setupFileWatcher(workspace: string): void {
    if (!isWorkspaceInVscodeFolders(workspace)) {
      log.info('Skipping VS Code file watcher — workspace override is outside open folders');
      return;
    }
    const config = this.configService.getConfig();

    try {
      const watcher = vscode.workspace.createFileSystemWatcher(
        createWorkspacePattern(workspace, '**/*')
      );

      const enqueue = (uri: vscode.Uri) => {
        if (!this.isWorkspaceTrusted()) return;
        const relPath = toWorkspaceRelPath(uri, workspace);
        if (!relPath || this.ignoreService.isIgnored(relPath)) return;
        if (isTsLikeFile(relPath)) this.languageService?.syncFileFromDisk(relPath);
        if (!this.indexQueue || !this.scanner) return;
        let fileId = this.scanner.getFileId(relPath);
        if (!fileId) {
          try {
            const stat = statSync(uri.fsPath);
            if (!stat.isFile() || stat.size > config.indexing.hardSkipSizeBytes || isBinaryByExtension(relPath)) return;
            const discovered = [{
              absPath: uri.fsPath,
              relPath,
              size: stat.size,
              mtime: stat.mtimeMs,
              language: detectLanguage(relPath),
            }];
            const diff = this.scanner.computeDiff(discovered, { includeDeleted: false });
            this.scanner.persistScan(diff);
            fileId = this.scanner.getFileId(relPath);
          } catch {
            return;
          }
        }
        if (fileId) {
          this.pendingWatchJobs.set(relPath, {
            fileId,
            relPath,
            absPath: uri.fsPath,
            language: detectLanguage(relPath),
          });
          if (this.watchDebounceTimer) clearTimeout(this.watchDebounceTimer);
          this.watchDebounceTimer = setTimeout(() => {
            const jobs = [...this.pendingWatchJobs.values()];
            this.pendingWatchJobs.clear();
            this.indexQueue?.enqueue(jobs, {
              partial: true,
              detail: `Incrementally indexing ${jobs.length} changed file${jobs.length === 1 ? '' : 's'} from the file watcher.`,
            });
          }, 5000);
        }
      };

      watcher.onDidChange(enqueue);
      watcher.onDidCreate(enqueue);
      watcher.onDidDelete((uri) => {
        if (!this.isWorkspaceTrusted()) return;
        const relPath = toWorkspaceRelPath(uri, workspace);
        if (relPath && isTsLikeFile(relPath) && !this.ignoreService.isIgnored(relPath)) {
          this.languageService?.syncFileFromDisk(relPath);
        }
        if (relPath && !this.ignoreService.isIgnored(relPath)) {
          const db = this.indexService?.getDb();
          if (db?.isOpen()) {
            new FtsIndex(db).deleteByFile(relPath);
            db.raw.prepare('DELETE FROM files WHERE workspace = ? AND rel_path = ?').run(workspace, relPath);
            RepoMapService.invalidateWorkspace(workspace);
            this.debouncedRebuildRetriever?.();
            this.indexingStatus = this.indexQueue?.getStatus() ?? this.indexingStatus;
            this.notifyUi({ indexing: this.indexingStatus });
          }
        }
      });
      this.context.subscriptions.push(watcher);

      const refreshSkills = () => {
        this.skillCatalogService?.refresh();
        this.pushActivity('info', 'Workspace skills catalog refreshed');
      };
      for (const skillPattern of ['.mitii/skills/**/SKILL.md']) {
        const skillWatcher = vscode.workspace.createFileSystemWatcher(
          createWorkspacePattern(workspace, skillPattern)
        );
        skillWatcher.onDidChange(refreshSkills);
        skillWatcher.onDidCreate(refreshSkills);
        skillWatcher.onDidDelete(refreshSkills);
        this.context.subscriptions.push(skillWatcher);
      }
    } catch (error) {
      log.warn('File watcher setup failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async buildUiState(base: Partial<WebviewState> = {}): Promise<WebviewState> {
    const config = this.configService.getConfig();
    const apiKey = await this.configService.getApiKey();
    const githubToken = await this.configService.getApiKey(config.github.tokenRef);
    const workspacePath = this.resolveWorkspacePath();
    const override = this.configService.getWorkspaceOverride();
    const vscodeFolders = this.getVscodeWorkspaceFolders();
    const indexDbPath = workspacePath ? resolveDbPath(workspacePath) : '';
    const appVersion = String(this.context.extension.packageJSON.version ?? '');
    const onboardingCompleted = this.context.globalState.get<boolean>(ONBOARDING_STATE_KEY, false);
    const providerConfigured = config.provider.type !== 'echo' || Boolean(apiKey);

    const approvals: ApprovalRequestView[] = (this.approvalQueue?.getPending() ?? []).map(toApprovalView);
    const effectiveProvider = this.resolveEffectiveProviderSelection(this.session?.mode ?? 'plan');

    return {
      ...initialWebviewState(),
      tab: base.tab ?? 'chat',
      messages: base.messages ?? [],
      currentSessionId: base.currentSessionId ?? this.session?.id ?? '',
      chatHistory: base.chatHistory ?? [],
      loading: base.loading ?? false,
      error: base.error ?? null,
      showContextPreview: base.showContextPreview ?? false,
      pinnedContext: base.pinnedContext ?? this.pinnedContext,
      contextPreview: base.contextPreview ?? [],
      contextTokenEstimate: base.contextTokenEstimate ?? 0,
      contextBudget: base.contextBudget ?? null,
      agentActivity: this.agentActivity,
      agentLiveStatus: base.agentLiveStatus ?? this.agentLiveStatus,
      subagents: base.subagents ?? this.subagentTracker.getRuns().map((r) => ({
        id: r.id,
        type: r.type,
        task: r.task,
        focus: r.focus,
        scope: r.scope,
        progress: r.progress,
        status: r.status,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        summary: r.summary,
        error: r.error,
      })),
      vectorIndex: buildVectorIndexStatusView(config.indexing, workspacePath, this.vectorIndexService),
      tokenUsage: base.tokenUsage ?? {
        ...this.tokenUsage,
        contextWindow: effectiveProvider.contextWindow ?? config.provider.contextWindow,
      },
      mode: base.mode ?? this.session?.mode ?? 'plan',
      indexing: this.indexingStatus,
      approvals,
      plan: this.currentPlan,
      reviewDiff: base.reviewDiff ?? this.currentReviewDiff,
      onboarding: {
        completed: onboardingCompleted,
        providerConfigured,
        workspaceIndexed: this.indexingStatus.indexed > 0,
        shouldShow: !onboardingCompleted && (!providerConfigured || this.indexingStatus.indexed === 0),
      },
      memories: (this.memoryService?.recent(20) ?? []).map((m) => ({
        id: m.id,
        type: m.type,
        text: m.text,
        createdAt: m.createdAt,
      })),
      checkpoints: (this.checkpointService?.list(this.session?.id) ?? []).map((c) => ({
        id: c.id,
        kind: c.kind,
        files: c.files,
        createdAt: c.createdAt,
        strategy: c.strategy,
      })),
      settings: {
        appVersion,
        providerType: config.provider.type,
        baseUrl: config.provider.baseUrl,
        model: config.provider.model,
        apiVersion: config.provider.apiVersion,
        region: config.provider.region,
        contextWindow: config.provider.contextWindow,
        indexingEnabled: config.indexing.enabled,
        approvalMode: config.safety.approvalMode,
        requireApprovalWrites: config.safety.requireApprovalForWrites,
        requireApprovalShell: config.safety.requireApprovalForShell,
        memoryEnabled: config.memory.enabled,
        summarizeAfterTask: config.memory.summarizeAfterTask,
        autoMemoryEnabled: config.memory.autoMemoryEnabled,
        autoMemoryScope: config.memory.autoMemoryScope,
        subagentsEnabled: config.agent.subagentsEnabled,
        agentMaxSteps: config.agent.maxSteps,
        askDepth: normalizeAgentDepth(config.agent.askDepth),
        planDepth: normalizeAgentDepth(config.agent.planDepth),
        actDepth: normalizeAgentDepth(config.agent.actDepth),
        askMaxSteps: config.agent.askMaxSteps,
        askAutoContinue: config.agent.askAutoContinue,
        askMaxAutoContinues: config.agent.askMaxAutoContinues,
        agentAutoContinue: config.agent.autoContinue,
        agentMaxAutoContinues: config.agent.maxAutoContinues,
        researchAgentMaxSteps: config.agent.researchAgentMaxSteps,
        showDiffPreview: config.agent.showDiffPreview,
        hasApiKey: Boolean(apiKey),
        hasGithubToken: Boolean(githubToken),
        mcpEnabled: config.mcp.enabled,
        mcpServers: this.mcpManager.getStatuses().length,
        mcpTools: this.mcpManager.getConnectedToolCount(),
        mcpServerStatuses: this.mcpManager.getStatuses().map((s) => ({
          name: s.name,
          connected: s.connected,
          toolCount: s.toolCount,
          builtin: s.builtin,
          error: s.error,
        })),
        customMcpServers: listCustomMcpServers(config.mcp.servers, workspacePath ?? '').map((server) => ({
          name: server.name,
          type: server.type,
          command: server.command,
          args: server.args,
          env: server.env,
          cwd: server.cwd,
          url: server.url,
          headers: server.headers,
          disabled: server.disabled,
          source: server.source,
        })),
        projectRules: this.projectRulesService?.count() ?? 0,
        sessionLogging: config.telemetry.sessionLogging,
        debugMetrics: config.telemetry.debugMetrics,
        traceEnabled: config.debugTrace.enabled,
        traceIncludePayloads: config.debugTrace.includePayloads,
        traceLlm: config.debugTrace.llm,
        traceMcp: config.debugTrace.mcp,
        traceWebview: config.debugTrace.webview,
        traceDaemon: config.debugTrace.daemon,
        traceWebhook: config.debugTrace.webhook,
        traceMaxPayloadChars: config.debugTrace.maxPayloadChars,
        localDebugAvailable: this.context.extensionMode === vscode.ExtensionMode.Development,
        vectorsEnabled: config.indexing.vectorsEnabled,
        embeddingProvider: config.indexing.embeddingProvider,
        vectorBackend: config.indexing.vectorBackend,
        hybridMemorySearch: config.memory.hybridSearchEnabled,
        minilmAvailable: isMinilmAvailable(),
        lancedbAvailable: isLanceDbAvailable(),
        autonomyPreset: config.safety.autonomyPreset,
        askModel: config.agent.askModel,
        askBaseUrl: config.agent.askBaseUrl,
        planModel: config.agent.planModel,
        planBaseUrl: config.agent.planBaseUrl,
        actModel: config.agent.actModel,
        actBaseUrl: config.agent.actBaseUrl,
        checkpointStrategy: config.agent.checkpointStrategy,
        showReasoning: config.ui.showReasoning,
        reasoningPreviewMaxChars: config.ui.reasoningPreviewMaxChars,
        providerProfiles: this.providerProfilesService?.list() ?? [],
        activeProviderProfileId: this.providerProfilesService?.getActiveId() ?? null,
      },
      contextToggles: this.contextToggles,
      mcpToggles: this.mcpToggles,
      providerLabel: `${effectiveProvider.providerType} / ${effectiveProvider.model}`,
      modelOptions: this.buildModelOptions(effectiveProvider),
      sessionProviderOverride: this.session?.providerOverride ?? null,
      workspaceOpen: Boolean(workspacePath),
      workspacePath,
      vscodeWorkspaceFolders: vscodeFolders,
      workspaceOverride: override,
      usingWorkspaceOverride: this.isUsingWorkspaceOverride(),
      indexDbPath,
      workspaceNotice: this.workspaceNotice,
      workspaceTrusted: this.isWorkspaceTrusted(),
      settingsSaving: this.settingsSaving,
      testingConnection: this.testingConnection,
    };
  }

  async refreshReviewDiff(): Promise<void> {
    if (!this.gitService?.isGitRepo) {
      this.currentReviewDiff = null;
      this.notifyUi({ reviewDiff: null });
      return;
    }
    this.currentReviewDiff = await collectReviewDiff(this.gitService);
    this.notifyUi({ reviewDiff: this.currentReviewDiff });
  }

  async completeOnboarding(): Promise<void> {
    await this.context.globalState.update(ONBOARDING_STATE_KEY, true);
    this.notifyUi({ onboarding: (await this.buildUiState()).onboarding });
  }

  private pushActivity(
    kind: import('../../vscode/webview/messages').AgentActivityEntry['kind'],
    message: string,
    detail?: string
  ): void {
    const entry = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      message,
      detail,
      timestamp: Date.now(),
    };
    this.agentActivity = [...this.agentActivity.slice(-40), entry];
    this.notifyUi({ agentActivity: this.agentActivity });
  }

  private async runVerifyHooks(commands: string[], userMessage = ''): Promise<string> {
    const workspace = this.resolveWorkspacePath();
    if (!workspace || !this.isWorkspaceTrusted()) return '';

    const lines: string[] = [];
    const touchedFiles = this.getTouchedFilesFromAudit();
    const docsVerification = verifyDocumentationFiles(workspace, touchedFiles);
    const docsVerificationOutput = formatDocumentationVerification(docsVerification);
    if (docsVerificationOutput) {
      lines.push(docsVerificationOutput);
      this.pushActivity(
        docsVerification.issues.length > 0 ? 'error' : 'info',
        'Markdown verification',
        docsVerificationOutput.slice(0, 500)
      );
    }
    const plan = resolveProjectVerifyCommands(workspace, commands, { touchedFiles, userMessage });
    const discoveryBlock = formatVerifyPlanForAgent(plan);
    lines.push(discoveryBlock);

    for (const skipped of plan.skipped) {
      this.pushActivity('info', 'Verify skipped', skipped);
    }

    if (plan.commands.length === 0) {
      return lines.join('\n\n');
    }

    const installAttempted = new Set<string>();

    for (const command of plan.commands) {
      const trimmed = command.trim();
      if (!trimmed) continue;
      const body = await this.runVerifyCommandWithRetry(workspace, trimmed, plan, installAttempted);
      lines.push(body);
    }

    return lines.join('\n\n');
  }

  private async runVerifyCommandWithRetry(
    workspace: string,
    command: string,
    plan: ReturnType<typeof resolveProjectVerifyCommands>,
    installAttempted: Set<string>
  ): Promise<string> {
    const installLog: string[] = [];

    const runOnce = async (): Promise<{ success: boolean; body: string }> => {
      try {
        const result = await this.toolRuntime.execute('run_command', { command });
        const body = result.success
          ? (result.output || '(no output)')
          : (result.error ?? result.output ?? 'command failed');
        return { success: result.success, body };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, body: msg };
      }
    };

    let { success, body } = await runOnce();
    this.pushActivity(success ? 'info' : 'error', `Verify: ${command}`, body.slice(0, 200));

    if (!success && isModuleResolutionVerifyFailure(body)) {
      const installs = [
        ...plan.installCommands,
        ...suggestInstallCommandsForVerifyFailure(workspace, body),
      ];
      for (const installCmd of installs) {
        if (installAttempted.has(installCmd)) continue;
        installAttempted.add(installCmd);
        this.pushActivity('info', 'Verify: installing dependencies', installCmd);
        try {
          const installResult = await this.toolRuntime.execute('run_command', { command: installCmd });
          const installBody = installResult.success
            ? (installResult.output || 'install completed')
            : (installResult.error ?? 'install failed');
          installLog.push(`$ ${installCmd}\n${installBody.slice(0, 2000)}`);
          if (installResult.success) {
            ({ success, body } = await runOnce());
            this.pushActivity(success ? 'info' : 'error', `Verify retry: ${command}`, body.slice(0, 200));
            break;
          }
        } catch {
          // try next install strategy
        }
      }
    }

    const parts = [...installLog, `$ ${command}\n${body.slice(0, 4000)}`];
    return parts.join('\n\n');
  }

  private getTouchedFilesFromAudit(): string[] {
    const audit = this.toolRuntime.getAuditLog();
    const files = new Set<string>();
    for (const { toolName, input, result } of audit) {
      if (!result.success || !['write_file', 'apply_patch'].includes(toolName)) continue;
      const path = (input as Record<string, unknown>).path;
      if (typeof path === 'string') files.add(path);
    }
    return [...files];
  }

  private async validateAfterWrite(relPath: string): Promise<void> {
    const errors = await this.diagnosticsService.waitForFileErrors(relPath);
    if (errors.length === 0) {
      this.pushActivity('info', `Validated ${relPath}`, 'No TypeScript/linter errors detected');
      return;
    }

    const detail = errors.map((e) => `Line ${e.line}: ${e.message}`).join('\n');
    this.pushActivity('error', `${errors.length} error(s) in ${relPath} after apply`, detail);

    if (this.session?.mode !== 'agent' || !this.autoFixCallback || this.autoFixDepth >= 2) {
      return;
    }
    if (this.shouldDeferAutoFixUntilApprovalResume()) {
      this.pushActivity('info', 'Auto-fix deferred until approved task resumes', relPath);
      return;
    }

    this.autoFixDepth += 1;
    try {
      const fixMessage = [
        `The file \`${relPath}\` was written but VS Code reports these errors:`,
        detail,
        '',
        `Fix all errors and output the corrected FULL file using:`,
        '```tsx|CODE_EDIT_BLOCK|' + relPath,
        '// complete corrected file',
        '```',
      ].join('\n');
      this.pushActivity('info', 'Auto-fixing validation errors…', relPath);
      await this.autoFixCallback(fixMessage);
    } finally {
      this.autoFixDepth -= 1;
    }
  }

  private shouldDeferAutoFixUntilApprovalResume(): boolean {
    const pendingApprovals = this.approvalQueue?.getPending().length ?? 0;
    return pendingApprovals > 0 || this.resumeApprovalResults.length > 0 || Boolean(this.chatOrchestrator?.hasSuspendState());
  }

  getSession(): ThunderSession | undefined { return this.session; }

  /** Reset per-turn task routing state when the user switches chat modes mid-thread. */
  handleModeChange(mode: ThunderMode): void {
    this.session?.setMode(mode);
    this.agentTaskState.reset();
    this.agentTaskState.setLimits({
      maxSequentialThinkingCalls: this.configService.getConfig().agent.maxSequentialThinkingCallsPerTurn,
      maxFilesRead: 12,
    });
    this.chatOrchestrator?.clearRoutingState();

    if (mode === 'ask' && this.session?.id) {
      this.planPersistence?.complete(this.session.id);
      this.currentPlan = null;
    }
  }
  restoreChatSession(sessionId: string, options: { mode?: ThunderMode } = {}): PlanView | null {
    const restoredId = sessionId.trim();
    if (!restoredId) return this.currentPlan;

    const workspace = this.resolveWorkspacePath();
    const mode = options.mode ?? this.session?.mode ?? 'plan';
    const shouldReplace =
      !this.session ||
      this.session.id !== restoredId ||
      this.session.workspace !== workspace;

    const activeSession = shouldReplace
      ? new ThunderSession(workspace, mode, { id: restoredId })
      : this.session;
    if (!activeSession) return this.currentPlan;
    this.session = activeSession;
    activeSession.setMode(mode);

    this.sessionService?.ensureSession(activeSession);
    if (workspace) {
      this.configureSessionLogging(activeSession, workspace);
    }

    this.currentPlan = toPlanView(this.planPersistence?.getActive(restoredId)?.plan);
    this.agentLiveStatus = null;
    this.agentActivity = [];
    this.lastSubagentSnapshot.clear();
    this.notifyUi({
      currentSessionId: restoredId,
      mode: activeSession.mode,
      plan: this.currentPlan,
      agentActivity: [],
      agentLiveStatus: null,
      subagents: [],
    });
    return this.currentPlan;
  }
  getConfigService(): ConfigService { return this.configService; }
  getProviderRegistry(): LlmProviderRegistry { return this.providerRegistry; }
  getIndexingStatus(): IndexingStatus { return this.indexingStatus; }
  getApprovalQueue(): ApprovalQueue | undefined { return this.approvalQueue; }
  getToolExecutor(): ToolExecutor | undefined { return this.toolExecutor; }
  getMemoryService(): MemoryService | undefined { return this.memoryService; }
  getCheckpointService(): CheckpointService | undefined { return this.checkpointService; }

  async generateCommitMessage(): Promise<CommitMessageResult> {
    const config = this.configService.getConfig();
    if (!config.scm.commitMessageEnabled) {
      throw normalizeError(new Error('Commit message generation is disabled in settings.'));
    }
    if (!this.gitService?.isGitRepo) {
      throw normalizeError(new Error('No Git repository found for this workspace.'));
    }
    const provider = this.trackProvider(await this.resolveProviderForMode('ask'));
    const result = await new MicroTaskExecutor({
      workspace: this.resolveWorkspacePath() ?? '',
      git: this.gitService,
      provider,
      sessionLog: this.sessionLog,
    }).execute('commit_message', 'generate commit message');
    const [subject, ...rest] = result.content.split(/\r?\n/);
    const body = rest.join('\n').trim() || undefined;
    return {
      subject: subject || 'chore: update workspace',
      body,
      fullMessage: body ? `${subject}\n\n${body}` : subject || 'chore: update workspace',
    };
  }

  private resolveEffectiveProviderSelection(mode: string): ThunderSessionProviderOverride & { source: 'session' | 'mode' | 'global' } {
    const config = this.configService.getConfig();
    const sessionOverride = this.session?.providerOverride;
    if (sessionOverride?.model.trim()) {
      return {
        ...sessionOverride,
        source: 'session',
        contextWindow: sessionOverride.contextWindow ?? config.provider.contextWindow,
        apiVersion: sessionOverride.apiVersion ?? config.provider.apiVersion,
        region: sessionOverride.region ?? config.provider.region,
      };
    }

    if (mode === 'ask') {
      const askModel = config.agent.askModel?.trim();
      if (askModel) {
        return {
          providerType: config.agent.askProviderType ?? config.provider.type,
          baseUrl: config.agent.askBaseUrl?.trim() || config.provider.baseUrl,
          model: askModel,
          profile: 'Ask override',
          apiVersion: config.provider.apiVersion,
          region: config.provider.region,
          contextWindow: config.provider.contextWindow,
          source: 'mode',
        };
      }
    }

    if (mode === 'plan') {
      const planModel = config.agent.planModel?.trim();
      if (planModel) {
        return {
          providerType: config.agent.planProviderType ?? config.provider.type,
          baseUrl: config.agent.planBaseUrl?.trim() || config.provider.baseUrl,
          model: planModel,
          profile: 'Plan override',
          apiVersion: config.provider.apiVersion,
          region: config.provider.region,
          contextWindow: config.provider.contextWindow,
          source: 'mode',
        };
      }
    }

    if (mode === 'agent') {
      const actModel = config.agent.actModel?.trim();
      if (actModel) {
        return {
          providerType: config.agent.actProviderType ?? config.provider.type,
          baseUrl: config.agent.actBaseUrl?.trim() || config.provider.baseUrl,
          model: actModel,
          profile: 'Agent override',
          apiVersion: config.provider.apiVersion,
          region: config.provider.region,
          contextWindow: config.provider.contextWindow,
          source: 'mode',
        };
      }
    }

    return {
      providerType: config.provider.type,
      baseUrl: config.provider.baseUrl,
      model: config.provider.model,
      profile: 'Global default',
      apiVersion: config.provider.apiVersion,
      region: config.provider.region,
      contextWindow: config.provider.contextWindow,
      source: 'global',
    };
  }

  private getSkillRuntimeContext(): import('../skills/skillRuntimeContext').SkillRuntimeContext {
    const config = this.configService.getConfig();
    const mode = this.session?.mode ?? 'agent';
    const askDepth = normalizeAgentDepth(config.agent.askDepth);
    const planDepth = normalizeAgentDepth(config.agent.planDepth);
    const actDepth = normalizeAgentDepth(config.agent.actDepth);
    const depth = mode === 'ask' ? askDepth : mode === 'plan' ? planDepth : actDepth;
    const provider = this.resolveEffectiveProviderSelection(mode);
    return {
      mode,
      depth,
      askDepth,
      planDepth,
      actDepth,
      model: provider.model,
      modelSource: provider.source,
    };
  }

  private buildModelOptions(effectiveProvider: ThunderSessionProviderOverride & { source: 'session' | 'mode' | 'global' }): ModelOptionView[] {
    const config = this.configService.getConfig();
    const options: ModelOptionView[] = [];
    const push = (option: ModelOptionView) => {
      options.push(option);
    };

    push(this.toModelOption(
      {
        providerType: effectiveProvider.providerType,
        baseUrl: effectiveProvider.baseUrl,
        model: effectiveProvider.model,
        profile: effectiveProvider.profile,
        profileId: effectiveProvider.profileId,
        apiVersion: effectiveProvider.apiVersion,
        region: effectiveProvider.region,
        contextWindow: effectiveProvider.contextWindow,
      },
      'recent',
      effectiveProvider.source === 'session' ? 'This chat' : effectiveProvider.source === 'mode' ? 'Mode override' : 'Global default',
      `current:${effectiveProvider.source}:${this.providerOverrideKey(effectiveProvider)}`
    ));

    for (const [index, recent] of this.recentProviderOverrides.entries()) {
      push(this.toModelOption(recent, 'recent', recent.profile ?? 'Recent model', `recent:${index}:${this.providerOverrideKey(recent)}`));
    }

    const globalDefault: ThunderSessionProviderOverride = {
      providerType: config.provider.type,
      baseUrl: config.provider.baseUrl,
      model: config.provider.model,
      profile: 'Global default',
      apiVersion: config.provider.apiVersion,
      region: config.provider.region,
      contextWindow: config.provider.contextWindow,
    };
    push(this.toModelOption(globalDefault, 'recent', 'Global default', `global:${this.providerOverrideKey(globalDefault)}`));

    for (const preset of PROVIDER_PRESETS) {
      const category = isCloudProvider(preset.type, {
        baseUrl: preset.baseUrl,
        model: preset.model,
        contextWindow: preset.contextWindow,
      }) ? 'cloud' : 'local';
      push(this.toModelOption({
        providerType: preset.type,
        baseUrl: preset.baseUrl,
        model: preset.model,
        profile: preset.label,
        contextWindow: preset.contextWindow,
        apiVersion: config.provider.apiVersion,
        region: config.provider.region,
      }, category, preset.label, `preset:${preset.type}`));
    }

    push(this.toModelOption({
      providerType: 'echo',
      baseUrl: '',
      model: 'echo',
      profile: 'Echo',
      contextWindow: 8192,
      apiVersion: config.provider.apiVersion,
      region: config.provider.region,
    }, 'local', 'Echo provider', 'preset:echo'));

    for (const profile of this.providerProfilesService?.list() ?? []) {
      push(this.profileToModelOption(profile));
    }

    return options;
  }

  private profileToModelOption(profile: StoredProviderProfileView): ModelOptionView {
    return this.toModelOption({
      providerType: profile.providerType,
      baseUrl: profile.baseUrl,
      model: profile.model,
      profile: profile.name,
      profileId: profile.id,
      apiVersion: profile.apiVersion,
      region: profile.region,
      contextWindow: profile.contextWindow,
    }, 'custom', profile.name, `profile:${profile.id}`);
  }

  private toModelOption(
    override: ThunderSessionProviderOverride,
    category: ModelOptionView['category'],
    profile: string,
    id: string
  ): ModelOptionView {
    const model = override.model.trim() || 'model';
    const provider = override.providerType;
    return {
      id,
      category,
      providerType: provider,
      baseUrl: override.baseUrl,
      model,
      profile,
      profileId: override.profileId,
      apiVersion: override.apiVersion,
      region: override.region,
      contextWindow: override.contextWindow,
      label: model,
      description: `${profile} · ${provider}${override.baseUrl ? ` · ${override.baseUrl}` : ''}`,
    };
  }

  private providerOverrideKey(override: Pick<ThunderSessionProviderOverride, 'providerType' | 'baseUrl' | 'model' | 'profileId'>): string {
    return [
      override.providerType,
      override.baseUrl,
      override.model,
      override.profileId ?? '',
    ].join('\u0000');
  }

  private rememberProviderOverride(override: ThunderSessionProviderOverride): void {
    const key = this.providerOverrideKey(override);
    this.recentProviderOverrides = [
      override,
      ...this.recentProviderOverrides.filter((item) => this.providerOverrideKey(item) !== key),
    ].slice(0, 6);
  }

  private async resolveProviderForMode(mode: string): Promise<LlmProvider> {
    const config = this.configService.getConfig();
    const selection = this.resolveEffectiveProviderSelection(mode);
    const apiKey = selection.profileId
      ? ((await this.configService.getApiKey(providerSecretRef(selection.profileId))) ?? (await this.configService.getApiKey()))
      : await this.configService.getApiKey();

    if (selection.source === 'session' || selection.source === 'mode') {
      enforceEnterpriseProviderPolicy(
        config.enterprise.localProvidersOnly,
        selection.providerType,
        selection.baseUrl
      );
      return this.providerRegistry.resolveFromOptions({
        type: selection.providerType,
        baseUrl: selection.baseUrl,
        model: selection.model,
        apiVersion: selection.apiVersion ?? config.provider.apiVersion,
        region: selection.region ?? config.provider.region,
        contextWindow: selection.contextWindow ?? config.provider.contextWindow,
        supportsStreaming: config.provider.supportsStreaming,
        supportsTools: config.provider.supportsTools,
        supportsEmbeddings: config.provider.supportsEmbeddings,
      }, apiKey);
    }

    const active = this.providerRegistry.getActive();
    if (!active) {
      throw normalizeError(new Error('No LLM provider configured'));
    }
    enforceEnterpriseProviderPolicy(config.enterprise.localProvidersOnly, config.provider.type, config.provider.baseUrl);
    return active;
  }

  private async showInlineDiffForPendingApprovals(approvalId?: string): Promise<void> {
    if (!this.inlineDiffManager) return;
    const workspace = this.resolveWorkspacePath();
    if (!workspace) return;

    const pending = this.approvalQueue?.getPending() ?? [];
    const writeApproval = pending.find((req) =>
      ['write_file', 'apply_patch'].includes(req.toolName) &&
      (!approvalId || req.id === approvalId)
    );
    if (!writeApproval) {
      this.inlineDiffManager.setPending(undefined);
      return;
    }

    const fullInput = this.approvalQueue?.getFullInput(writeApproval.id);
    const path = typeof fullInput?.path === 'string'
      ? fullInput.path
      : writeApproval.files[0];
    if (!path) return;

    if (writeApproval.toolName === 'write_file' && typeof fullInput?.content === 'string') {
      await this.inlineDiffManager.showForApproval(
        workspace,
        writeApproval.id,
        path,
        'write_file',
        fullInput.content
      );
      return;
    }

    if (
      writeApproval.toolName === 'apply_patch' &&
      typeof fullInput?.oldText === 'string' &&
      typeof fullInput?.newText === 'string'
    ) {
      await this.inlineDiffManager.showForApproval(
        workspace,
        writeApproval.id,
        path,
        'apply_patch',
        fullInput.newText,
        fullInput.oldText
      );
    }
  }

  startNewChat(): string {
    const workspace = this.resolveWorkspacePath();
    const mode = this.session?.mode ?? 'plan';
    this.session = new ThunderSession(workspace, mode);
    this.sessionService?.ensureSession(this.session);
    if (workspace) {
      this.configureSessionLogging(this.session, workspace);
    }
    this.lastSubagentSnapshot.clear();
    this.currentPlan = null;
    this.agentActivity = [];
    this.agentLiveStatus = null;
    this.pinnedContext = [];
    this.syncActiveEditorPin();
    this.tokenUsage = {
      sessionTotal: 0,
      inputTokensTotal: 0,
      outputTokensTotal: 0,
      currentTurnTotal: 0,
      currentTurnInputTokens: 0,
      currentTurnOutputTokens: 0,
      aiCallCount: 0,
      currentTurnAiCallCount: 0,
      lastCallInputTokens: 0,
      lastCallOutputTokens: 0,
      lastCallTotalTokens: 0,
      lastPromptTokens: 0,
      lastContextTokens: 0,
      lastResponseTokens: 0,
      turnCount: 0,
      estimated: true,
      breakdown: [],
    };
    this.notifyUi({
      currentSessionId: this.session.id,
      plan: null,
      agentActivity: [],
      agentLiveStatus: null,
      subagents: [],
      pinnedContext: this.pinnedContext,
      contextPreview: [],
      contextTokenEstimate: 0,
      contextBudget: null,
      tokenUsage: {
        ...this.tokenUsage,
        contextWindow: this.configService.getConfig().provider.contextWindow,
      },
    });
    return this.session.id;
  }

  getWorkspacePath(): string {
    return this.resolveWorkspacePath();
  }

  resolveWorkspacePath(): string {
    const vscodeFolder = this.getPrimaryVscodeFolder();
    if (vscodeFolder) {
      return vscodeFolder;
    }

    const override = this.configService.getWorkspaceOverride();
    if (override) {
      const resolved = normalizeWorkspaceRoot(override);
      if (!resolved) {
        log.warn('Invalid workspace override', { path: override });
        return '';
      }
      if (!existsSync(resolved)) {
        log.warn('Configured workspace override does not exist', { path: resolved });
      }
      return resolved;
    }
    return '';
  }

  /** Whether Thunder is using a manual path override (no VS Code folder open). */
  isUsingWorkspaceOverride(): boolean {
    return !this.getPrimaryVscodeFolder() && Boolean(this.configService.getWorkspaceOverride());
  }

  private setWorkspaceNotice(kind: 'ok' | 'error' | 'warn', message: string): void {
    this.workspaceNotice = { kind, message };
    this.notifyUi({ workspaceNotice: this.workspaceNotice });
  }

  private resetCurrentTurnUsage(): void {
    this.tokenUsage.currentTurnTotal = 0;
    this.tokenUsage.currentTurnInputTokens = 0;
    this.tokenUsage.currentTurnOutputTokens = 0;
    this.tokenUsage.currentTurnAiCallCount = 0;
    this.tokenUsage.lastCallInputTokens = 0;
    this.tokenUsage.lastCallOutputTokens = 0;
    this.tokenUsage.lastCallTotalTokens = 0;
    this.tokenUsage.lastPromptTokens = 0;
    this.tokenUsage.lastContextTokens = 0;
    this.tokenUsage.lastResponseTokens = 0;
  }

  private trackProvider(provider: LlmProvider): LlmProvider {
    return new UsageTrackingProvider(provider, (usage) => this.recordModelCallUsage(usage));
  }

  private recordModelCallUsage(usage: ModelCallUsage): void {
    this.tokenUsage.inputTokensTotal += usage.inputTokens;
    this.tokenUsage.outputTokensTotal += usage.outputTokens;
    this.tokenUsage.sessionTotal += usage.totalTokens;
    this.tokenUsage.currentTurnInputTokens += usage.inputTokens;
    this.tokenUsage.currentTurnOutputTokens += usage.outputTokens;
    this.tokenUsage.currentTurnTotal += usage.totalTokens;
    this.tokenUsage.aiCallCount += 1;
    this.tokenUsage.currentTurnAiCallCount += 1;
    this.tokenUsage.lastCallInputTokens = usage.inputTokens;
    this.tokenUsage.lastCallOutputTokens = usage.outputTokens;
    this.tokenUsage.lastCallTotalTokens = usage.totalTokens;
    this.tokenUsage.lastPromptTokens = Math.max(this.tokenUsage.lastPromptTokens, usage.inputTokens);
    this.tokenUsage.breakdown = normalizePromptBreakdown(this.tokenUsage.breakdown, this.tokenUsage.lastPromptTokens);
    this.tokenUsage.estimated = usage.estimated;

    this.sessionLog.append('token_usage', 'AI call token usage', {
      // Per-call metrics (do not confuse with cumulative totals below).
      call_input_tokens: usage.inputTokens,
      call_output_tokens: usage.outputTokens,
      call_total_tokens: usage.totalTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      // Cumulative across the turn / session.
      turn_cumulative_tokens: this.tokenUsage.currentTurnTotal,
      currentTurnTotal: this.tokenUsage.currentTurnTotal,
      currentTurnInputTokens: this.tokenUsage.currentTurnInputTokens,
      currentTurnOutputTokens: this.tokenUsage.currentTurnOutputTokens,
      sessionTotal: this.tokenUsage.sessionTotal,
      aiCallCount: this.tokenUsage.aiCallCount,
      estimated: usage.estimated,
      provider: usage.providerId,
    });

    this.scheduleTokenUsageUiUpdate({
      ...this.tokenUsage,
      contextWindow: this.configService.getConfig().provider.contextWindow,
    });
  }

  getVscodeWorkspaceFolders(): string[] {
    return vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
  }

  async pickWorkspaceFolder(): Promise<void> {
    const current = this.resolveWorkspacePath();
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: `Use as ${AGENT_NAME} workspace`,
      defaultUri: current ? vscode.Uri.file(current) : undefined,
    });
    if (!picked?.[0]) return;

    await this.setWorkspaceOverride(picked[0].fsPath);
  }

  async setWorkspaceOverride(path: string): Promise<void> {
    const trimmed = path.trim();
    if (!trimmed) {
      await this.clearWorkspaceOverride();
      return;
    }

    const resolved = normalizeWorkspaceRoot(trimmed);
    if (!resolved) {
      this.setWorkspaceNotice('error', 'Invalid path. Use an absolute path like /Users/you/project');
      void vscode.window.showErrorMessage(brandMessage('Invalid workspace path.'));
      return;
    }
    if (!existsSync(resolved)) {
      this.setWorkspaceNotice('error', `Path does not exist: ${resolved}`);
      void vscode.window.showErrorMessage(`${AGENT_NAME}: Path does not exist: ${resolved}`);
      return;
    }
    if (!statSync(resolved).isDirectory()) {
      this.setWorkspaceNotice('error', `Path is not a folder: ${resolved}`);
      void vscode.window.showErrorMessage(`${AGENT_NAME}: Path is not a folder: ${resolved}`);
      return;
    }

    await this.configService.setWorkspaceOverride(resolved);
    await this.reloadWorkspace();
    this.setWorkspaceNotice('ok', `Workspace saved: ${resolved}`);
    void vscode.window.showInformationMessage(`${AGENT_NAME}: Using workspace ${resolved}`);
  }

  async clearWorkspaceOverride(): Promise<void> {
    await this.configService.clearWorkspaceOverride();
    await this.reloadWorkspace();
    const fallback = this.resolveWorkspacePath();
    if (fallback) {
      this.setWorkspaceNotice('ok', `Using VS Code folder: ${fallback}`);
    } else {
      this.setWorkspaceNotice('warn', 'Override cleared. Open a folder or set a path below.');
    }
    void vscode.window.showInformationMessage(brandMessage('Using VS Code open folder for workspace.'));
  }

  async sendMessage(
    content: string,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string; attachments?: import('../../vscode/webview/messages').ChatImageAttachment[] }> = [],
    options?: {
      preserveActivity?: boolean;
      pinnedContext?: PinnedContextView[];
      attachments?: import('../../vscode/webview/messages').ChatImageAttachment[];
    }
  ): Promise<AsyncIterable<AssistantStreamChunk>> {
    if (!this.session) throw normalizeError(new Error('Session not initialized'));
    const provider = await this.resolveProviderForMode(this.session.mode);
    if (!provider) throw normalizeError(new Error('No LLM provider configured'));
    this.resetCurrentTurnUsage();
    const meteredProvider = this.trackProvider(provider);

    const approvalContinuation = isApprovalContinuationMessage(content.trim());
    const previousAssistantMessage = [...recentMessages].reverse().find((message) => message.role === 'assistant');
    const control = resolveControlIntent(content, {
      hasActiveTask: recentMessages.length > 0,
      hasPendingApproval: approvalContinuation || (this.approvalQueue?.getPending().length ?? 0) > 0,
      previousTurnAskedQuestion: Boolean(previousAssistantMessage?.content.trim().endsWith('?')),
    });
    const isContinuation =
      approvalContinuation ||
      control.intent === 'continue_task' ||
      control.intent === 'approve_pending' ||
      control.intent === 'reject_pending' ||
      control.intent === 'clarify_previous' ||
      control.intent === 'acknowledgement';
    this.sessionService?.ensureSession(this.session, content.slice(0, 64));
    const workspace = this.resolveWorkspacePath();
    if (workspace) {
      this.configureSessionLogging(this.session, workspace);
    }
    this.toolRuntime.clearAuditLog();
    this.subagentTracker.clear();
    setSubagentTracker(this.subagentTracker);

    if (!isContinuation && !options?.preserveActivity) {
      this.approvalQueue?.clearTaskGrants(this.session?.id);
      this.agentActivity = [];
      this.agentLiveStatus = null;
      this.pendingApprovalOutputs = [];
      this.agentTaskState.reset();
      this.agentTaskState.setLimits({
        maxSequentialThinkingCalls: this.configService.getConfig().agent.maxSequentialThinkingCallsPerTurn,
        maxFilesRead: 12,
      });
      this.notifyUi({ agentActivity: [], agentLiveStatus: null, subagents: [] });
    }

    this.ensureChatOrchestrator();
    if (!this.chatOrchestrator) {
      throw normalizeError(new Error(
        brandMessage('No workspace configured. Open a folder (File → Open Folder) or set a path in Settings → Workspace.')
      ));
    }
    this.chatOrchestrator.configure({
      researchAgentProvider: this.researchAgentProvider
        ? this.trackProvider(this.researchAgentProvider)
        : undefined,
    });
    return this.chatOrchestrator.send(this.session, meteredProvider, content, recentMessages, {
      pinnedContext: options?.pinnedContext ?? this.pinnedContext,
      attachments: options?.attachments,
    });
  }

  getPinnedContext(): PinnedContextView[] {
    return [...this.pinnedContext];
  }

  addPinnedContext(path: string, kind: 'file' | 'folder', auto = false): void {
    const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    if (!normalized) return;
    if (this.pinnedContext.some((p) => p.path === normalized && p.kind === kind)) return;
    this.pinnedContext = [
      ...this.pinnedContext.filter((p) => !(p.path === normalized && p.kind === kind)),
      { path: normalized, kind, auto },
    ];
    this.notifyUi({ pinnedContext: this.pinnedContext });
  }

  removePinnedContext(path: string): void {
    const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    this.pinnedContext = this.pinnedContext.filter((p) => p.path !== normalized);
    this.notifyUi({ pinnedContext: this.pinnedContext });
  }

  clearPinnedContext(): void {
    this.pinnedContext = [];
    this.notifyUi({ pinnedContext: this.pinnedContext });
  }

  searchContextPaths(query: string, limit = 20): ContextPathSuggestion[] {
    const workspace = this.resolveWorkspacePath();
    if (!workspace) return [];
    return searchWorkspacePaths(workspace, query, this.indexService?.getDb(), limit);
  }

  async pickContextPaths(): Promise<ContextPathSuggestion[]> {
    const workspace = this.resolveWorkspacePath();
    if (!workspace) return [];

    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: true,
      canSelectMany: true,
      defaultUri: vscode.Uri.file(workspace),
      openLabel: 'Add to context',
    });
    if (!picked?.length) return [];
    return resolvePickedPaths(workspace, picked);
  }

  syncActiveEditorPin(): void {
    const workspace = this.resolveWorkspacePath();
    if (!workspace) return;
    const editor = vscode.window.activeTextEditor;
    const rel = editor ? toWorkspaceRelPath(editor.document.uri, workspace) : undefined;
    const manual = this.pinnedContext.filter((p) => !p.auto);
    if (!rel) {
      this.pinnedContext = manual;
      this.notifyUi({ pinnedContext: this.pinnedContext });
      return;
    }
    if (manual.some((p) => p.path === rel)) {
      this.pinnedContext = manual;
    } else {
      this.pinnedContext = [...manual, { path: rel, kind: 'file', auto: true }];
    }
    this.notifyUi({ pinnedContext: this.pinnedContext });
  }

  private ensureChatOrchestrator(): void {
    if (this.chatOrchestrator) return;
    const workspace = this.resolveWorkspacePath();
    if (workspace) {
      this.initMinimalChat(workspace);
    }
  }

  async reloadWorkspace(options: { autoIndex?: boolean } = { autoIndex: true }): Promise<void> {
    const preservedBase = this.getPreservedUiBase();
    const vscodeFolder = this.getPrimaryVscodeFolder();
    const override = this.configService.getWorkspaceOverride();
    if (vscodeFolder && override) {
      const normalizedOverride = normalizeWorkspaceRoot(override);
      if (normalizedOverride && normalizedOverride !== vscodeFolder) {
        log.info('Clearing stale workspace override; VS Code folder takes precedence', {
          vscodeFolder,
          override: normalizedOverride,
        });
        await this.configService.clearWorkspaceOverride();
      }
    }

    const workspace = this.resolveWorkspacePath();
    const source: 'vscode' | 'override' | 'none' = vscodeFolder
      ? 'vscode'
      : override
        ? 'override'
        : 'none';
    this.logWorkspaceResolution(workspace, source);

    const previousWorkspace = this.session?.workspace;
    const preservedSessionId = typeof preservedBase.currentSessionId === 'string'
      ? preservedBase.currentSessionId.trim()
      : '';
    const canRestoreSessionId = Boolean(
      preservedSessionId &&
      (!previousWorkspace || previousWorkspace === workspace)
    );
    this.session = new ThunderSession(
      workspace,
      preservedBase.mode ?? this.session?.mode ?? 'plan',
      canRestoreSessionId ? { id: preservedSessionId } : undefined
    );
    const restoredUiBase = canRestoreSessionId
      ? preservedBase
      : { ...preservedBase, currentSessionId: this.session.id, messages: [] };
    if (workspace) {
      this.configureSessionLogging(this.session, workspace);
    }
    this.chatOrchestrator = undefined;
    if (this.backgroundIndexTimer) {
      clearTimeout(this.backgroundIndexTimer);
      this.backgroundIndexTimer = undefined;
    }
    this.indexService?.dispose();
    this.indexService = undefined;
    if (previousWorkspace) disposeLanguageService(previousWorkspace);
    this.languageService = undefined;
    this.scanner = undefined;
    this.indexQueue = undefined;
    this.projectRulesService = undefined;
    this.providerProfilesService = undefined;
    this.indexingStatus = { indexed: 0, queued: 0, running: false, failed: 0, total: 0, activeWorkers: 0, processed: 0, runTotal: 0 };
    await this.mcpManager.closeAll();
    this.toolRuntime.unregisterByPrefix('mcp__');

    if (workspace) {
      try {
        await this.initializeWorkspaceServices(workspace);
      } catch (error) {
        log.error('Workspace reload failed, using minimal context', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.initMinimalChat(workspace);
      }
      if (!this.chatOrchestrator) {
        this.initMinimalChat(workspace);
      }
    }
    this.sessionService?.ensureSession(this.session);
    this.currentPlan = toPlanView(this.planPersistence?.getActive(this.session.id)?.plan);

    this.notifyUi(await this.buildUiState(restoredUiBase));
    log.info('Workspace reloaded', { workspace });
    if (workspace && options.autoIndex !== false) {
      void this.maybeAutoIndex();
    }
  }

  finishAgentTurn(options?: { hadError?: boolean }): void {
    this.agentLiveStatus = null;
    const pending = this.approvalQueue?.getPending() ?? [];
    if (pending.length > 0) {
      this.notifyUi({ agentLiveStatus: null });
      return;
    }

    const audit = this.toolRuntime.getAuditLog();
    const summary = this.buildTurnSummary(audit);
    const fatalToolFailures = findFatalToolFailures(audit);
    const hadActivityErrors = this.agentActivity.some(
      (entry) => entry.kind === 'error' && !isRecoveredToolActivity(entry.message, audit, fatalToolFailures)
    );
    const hadError = options?.hadError || hadActivityErrors || fatalToolFailures.length > 0;

    const entry: import('../../vscode/webview/messages').AgentActivityEntry = {
      id: `act-complete-${Date.now()}`,
      kind: hadError ? 'error' : 'success',
      message: hadError ? 'Completed with issues' : 'All done',
      detail: summary,
      timestamp: Date.now(),
    };
    this.agentActivity = [...this.agentActivity.filter((e) => e.kind !== 'success'), entry];
    this.sessionLog.append('turn_complete', entry.message, {
      summary,
      toolCalls: audit.length,
      hadError,
      tools: audit.map((a) => a.toolName),
    });
    this.sessionLog.endTurn(hadError ? 'failed' : 'completed', {
      hadError,
      toolCalls: audit.length,
    });
    void this.maybeAutoExportAuditPack(hadError);
    this.notifyUi({ agentActivity: this.agentActivity, agentLiveStatus: null });
  }

  private async maybeAutoExportAuditPack(hadError: boolean): Promise<void> {
    const config = this.configService.getConfig();
    if (!config.enterprise.autoExportAuditPackOnSessionEnd) return;

    const workspace = this.resolveWorkspacePath();
    if (!workspace) return;
    const sessionId = this.session?.id ?? 'no-session';
    const logPath = this.sessionLog.getLogPath();
    const signature = `${sessionId}:${logPath}:${this.sessionLog.exportForAnalysis().length}:${this.toolRuntime.getAuditLog().length}`;
    if (signature === this.lastAutoAuditExportSignature) return;
    this.lastAutoAuditExportSignature = signature;

    try {
      const target = join(
        workspace,
        '.mitii',
        'audit',
        `mitii-audit-${sessionId}-${formatTimestampForFile(Date.now())}.zip`
      );
      mkdirSync(dirname(target), { recursive: true });
      const pack = this.buildAuditPack(workspace, sessionId, config.enterprise.stripFileContentsFromAuditPacks);
      writeFileSync(target, pack.buffer);
      this.sessionLog.append('audit_export', 'Audit pack auto-exported', {
        path: target,
        entries: pack.entries,
        redactionReport: pack.redactionReport,
        hadError,
        automatic: true,
      });
      this.pushActivity('info', 'Audit pack saved', target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sessionLog.append('error', 'Automatic audit pack export failed', { error: message });
      this.pushActivity('error', 'Automatic audit pack export failed', message);
    }
  }

  private buildTurnSummary(audit: import('../tools/types').ToolCallAudit[]): string {
    const lines: string[] = [];
    const writes = new Set<string>();
    const reads = new Set<string>();
    const commands: string[] = [];
    const mcpCalls = new Map<string, number>();

    for (const { toolName, input, result } of audit) {
      if (toolName.startsWith('mcp__')) {
        const server = toolName.split('__')[1] ?? 'mcp';
        mcpCalls.set(server, (mcpCalls.get(server) ?? 0) + 1);
        continue;
      }
      const record = input as Record<string, unknown>;
      if (toolName === 'write_file' || toolName === 'apply_patch') {
        if (typeof record.path === 'string' && result.success) writes.add(record.path);
      } else if (toolName === 'read_file' || toolName === 'read_files') {
        if (typeof record.path === 'string') reads.add(record.path);
        if (Array.isArray(record.paths)) {
          for (const p of record.paths) {
            if (typeof p === 'string') reads.add(p);
          }
        }
      } else if (toolName === 'run_command' && typeof record.command === 'string') {
        commands.push(record.command.slice(0, 100));
      }
    }

    if (writes.size > 0) {
      lines.push(`Modified ${writes.size} file(s): ${[...writes].slice(0, 8).join(', ')}${writes.size > 8 ? '…' : ''}`);
    }
    if (reads.size > 0) {
      lines.push(`Read ${reads.size} file(s)`);
    }
    if (commands.length > 0) {
      lines.push(`Ran ${commands.length} command(s)`);
    }
    if (mcpCalls.size > 0) {
      const mcpSummary = [...mcpCalls.entries()]
        .map(([server, count]) => `${server} (${count})`)
        .join(', ');
      lines.push(`MCP: ${mcpSummary}`);
    }
    if (audit.length > 0) {
      lines.push(`${audit.length} tool call(s) this turn`);
    }
    return lines.length > 0 ? lines.join('\n') : 'Response complete — no tool actions';
  }

  getSessionLogService(): SessionLogService {
    return this.sessionLog;
  }

  async exportSessionLog(): Promise<void> {
    const logPath = this.sessionLog.getLogPath();
    if (!logPath) {
      void vscode.window.showWarningMessage(brandMessage('No workspace configured for session logging.'));
      return;
    }

    const summary = this.sessionLog.exportSummary();
    await vscode.env.clipboard.writeText(summary);

    const choice = await vscode.window.showInformationMessage(
      `Session log summary copied to clipboard.\nLog file: ${logPath}`,
      'Open log file',
      'Reveal in Finder'
    );

    if (choice === 'Open log file') {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(logPath));
      await vscode.window.showTextDocument(doc, { preview: false });
    } else if (choice === 'Reveal in Finder') {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(logPath));
    }
  }

  async exportAuditPack(): Promise<void> {
    const workspace = this.resolveWorkspacePath();
    if (!workspace) {
      void vscode.window.showWarningMessage(brandMessage('Open a workspace before exporting an audit pack.'));
      return;
    }

    const sessionId = this.session?.id ?? 'no-session';
    const defaultUri = vscode.Uri.file(join(
      workspace,
      `.mitii/audit/mitii-audit-${sessionId}-${formatTimestampForFile(Date.now())}.zip`
    ));
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { 'Zip archive': ['zip'] },
      title: 'Export Mitii audit pack',
    });
    if (!target) return;

    const config = this.configService.getConfig();
    const pack = this.buildAuditPack(workspace, sessionId, config.enterprise.stripFileContentsFromAuditPacks);

    mkdirSync(dirname(target.fsPath), { recursive: true });
    await vscode.workspace.fs.writeFile(target, pack.buffer);
    this.sessionLog.append('audit_export', 'Audit pack exported', {
      path: target.fsPath,
      entries: pack.entries,
      redactionReport: pack.redactionReport,
    });

    const revealLabel = platformRevealLabel();
    const choice = await vscode.window.showInformationMessage(
      brandMessage(`Audit pack exported: ${target.fsPath}`),
      revealLabel
    );
    if (choice === revealLabel) {
      await vscode.commands.executeCommand('revealFileInOS', target);
    }
  }

  private buildAuditPack(workspace: string, sessionId: string, stripFileContents: boolean): ReturnType<AuditPackBuilder['build']> {
    const config = this.configService.getConfig();
    return new AuditPackBuilder().build({
      sessionId,
      workspace,
      extensionVersion: this.context.extension.packageJSON.version ?? '',
      model: `${config.provider.type}/${config.provider.model}`,
      logPath: this.sessionLog.getLogPath(),
      summaryMarkdown: this.sessionLog.exportSummary(),
      toolAudit: this.toolRuntime.getAuditLog(),
      approvals: this.approvalQueue?.getPending() ?? [],
      stripFileContents,
      signingKey: process.env.MITII_AUDIT_SIGNING_KEY,
    });
  }

  async generateChangelog(): Promise<void> {
    const workspace = this.resolveWorkspacePath();
    if (!workspace) {
      void vscode.window.showWarningMessage(brandMessage('Open a workspace before generating a changelog.'));
      return;
    }
    const collector = new GitHistoryCollector(workspace);
    const latestTag = await collector.getLatestTag();
    const commits = await collector.getCommitsSinceTag(latestTag ?? undefined);
    const entry = generateChangelogEntry({
      commits,
      version: readPackageVersion(workspace),
      date: new Date(),
    });
    const doc = await vscode.workspace.openTextDocument({ content: entry, language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  async prepareRelease(): Promise<void> {
    const workspace = this.resolveWorkspacePath();
    if (!workspace) {
      void vscode.window.showWarningMessage(brandMessage('Open a workspace before preparing a release.'));
      return;
    }
    const collector = new GitHistoryCollector(workspace);
    const latestTag = await collector.getLatestTag();
    const commits = await collector.getCommitsSinceTag(latestTag ?? undefined);
    const version = readPackageVersion(workspace);
    const date = new Date();
    const entry = generateChangelogEntry({ commits, version, date });
    const notes = generateReleaseNotes({ commits, version, date });
    const changelogPath = join(workspace, 'CHANGELOG.md');
    const existing = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '# Changelog\n\n## [Unreleased]\n';
    writeFileSync(changelogPath, insertChangelogEntry(existing, entry), 'utf8');
    const notesPath = join(workspace, '.mitii', 'release-notes.md');
    mkdirSync(dirname(notesPath), { recursive: true });
    writeFileSync(notesPath, notes, 'utf8');
    void vscode.window.showInformationMessage(
      brandMessage(`Prepared release ${version}. Updated CHANGELOG.md and .mitii/release-notes.md.`)
    );
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(notesPath));
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  async openSessionLog(): Promise<void> {
    const logPath = this.sessionLog.getLogPath();
    if (!logPath) {
      void vscode.window.showWarningMessage(brandMessage('No session log yet. Send a message first.'));
      return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(logPath));
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  getPendingApprovalContext(): string {
    const parts: string[] = [];
    const taskBlock = this.agentTaskState.buildPromptBlock();
    if (taskBlock) {
      parts.push('## Task progress (from state machine)', '', taskBlock);
    }
    if (this.pendingApprovalOutputs.length > 0) {
      parts.push(
        '## Approved command output',
        '',
        ...this.pendingApprovalOutputs,
        '',
        this.agentTaskState.buildApprovalResumeInstruction(),
      );
    }
    return parts.join('\n');
  }

  consumePendingApprovalContext(): string {
    const ctx = this.getPendingApprovalContext();
    this.pendingApprovalOutputs = [];
    return ctx;
  }

  getAgentTaskState(): AgentTaskState {
    return this.agentTaskState;
  }

  hasSuspendedAgentLoop(): boolean {
    this.ensureChatOrchestrator();
    return this.chatOrchestrator?.hasSuspendState() ?? false;
  }

  resumeAfterApproval(): AsyncIterable<AssistantStreamChunk> {
    this.ensureChatOrchestrator();
    if (!this.chatOrchestrator) {
      return (async function* empty() {})();
    }
    const approved = [...this.resumeApprovalResults];
    this.resumeApprovalResults = [];
    return this.chatOrchestrator.resumeAfterApproval(approved);
  }

  stopGeneration(): void {
    this.chatOrchestrator?.stop();
  }

  clearTaskApprovalGrants(): void {
    this.approvalQueue?.clearTaskGrants(this.session?.id);
  }

  async resolveApproval(
    id: string,
    decision: 'approved' | 'denied',
    selectedOption?: string,
    scope: 'single' | 'task' = 'single'
  ): Promise<void> {
    const fullInput = this.approvalQueue?.getFullInput(id);
    const request = this.approvalQueue?.resolve(id, decision);
    if (!request) return;

    this.sessionLog.append('approval_decision', `${decision}: ${request.toolName}`, {
      id,
      toolName: request.toolName,
      files: request.files,
      risk: request.risk,
      selectedOption,
      scope,
    });

    this.notifyUi({ approvals: (this.approvalQueue?.getPending() ?? []).map(toApprovalView) });
    this.inlineDiffManager?.setPending(undefined);

    if (request.toolName === 'ask_question') {
      const options = request.options ?? (Array.isArray(fullInput?.options) ? fullInput.options as string[] : []);
      const answer = decision === 'approved'
        ? (selectedOption ?? options[0] ?? 'User confirmed')
        : 'User declined to answer the clarifying question.';
      this.pushActivity('info', decision === 'approved' ? 'Question answered' : 'Question skipped', answer);
      if (request.toolCallId) {
        this.resumeApprovalResults.push({
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `User selected: ${answer}`,
          success: decision === 'approved',
          input: fullInput,
        });
      }
      return;
    }

    if (decision === 'denied') {
      this.pushActivity('info', `Denied ${request.toolName}`, request.files.join(', ') || undefined);
      if (request.toolCallId) {
        this.resumeApprovalResults.push({
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: 'User denied this tool call.',
          success: false,
          input: fullInput,
        });
      }
      return;
    }

    if (!this.toolExecutor || !fullInput) {
      log.warn('Approval missing full input', { id, tool: request.toolName });
      void vscode.window.showErrorMessage(
        brandMessage('Could not apply change — approval data was missing. Please ask again in Agent mode.')
      );
      this.pushActivity('error', 'Approval failed — payload missing', request.files.join(', '));
      return;
    }

    if (scope === 'task') {
      this.approvalQueue?.grantForTask(request.sessionId, request.toolName, request.approvalKind);
      this.pushActivity('info', `Approved ${request.toolName} for this task`, request.files.join(', ') || undefined);
    }

    const path = typeof fullInput.path === 'string' ? fullInput.path : request.files[0];
    const workspace = this.resolveWorkspacePath();

    if (path && workspace && ['write_file', 'apply_patch'].includes(request.toolName)) {
      if (this.checkpointService && this.session) {
        await this.checkpointService.create(this.session.id, [path], 'pre-write');
        this.refreshCheckpointPanel();
      }
    }

    if (request.toolName === 'run_command' && workspace && typeof fullInput.command === 'string') {
      if (this.checkpointService && this.session) {
        await this.checkpointService.create(this.session.id, [], 'pre-write');
        this.refreshCheckpointPanel();
      }
    }

    const result = await this.toolExecutor.executeApproved(id);

    if (result.success) {
      const isExternalRead = ['read_file', 'read_files'].includes(request.toolName);
      const successMessage = request.toolName === 'run_command'
        ? 'Ran approved command'
        : isExternalRead
          ? `Read ${path ?? 'external file'}`
          : `Applied ${path ?? request.toolName}`;
      this.pushActivity(request.toolName === 'run_command' ? 'tool' : 'apply', successMessage, result.output);
      if (request.toolName === 'run_command' && typeof fullInput.command === 'string') {
        this.pendingApprovalOutputs.push(
          `### Command\n\`${fullInput.command}\`\n\n### Output\n${result.output.slice(0, 6000)}`
        );
      } else if (isExternalRead) {
        this.pendingApprovalOutputs.push(`Read ${request.toolName} for \`${path ?? request.files.join(', ')}\``);
      } else if (path) {
        this.pendingApprovalOutputs.push(`Applied ${request.toolName} to \`${path}\``);
      }
      if (request.toolCallId) {
        this.resumeApprovalResults.push({
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: result.output,
          success: true,
          input: fullInput,
        });
      }
      void vscode.window.showInformationMessage(
        request.toolName === 'run_command'
          ? brandMessage('Command completed.')
          : isExternalRead
            ? `${AGENT_NAME}: Read ${path ?? 'external file'}`
            : `${AGENT_NAME}: Updated ${path ?? 'file'}`
      );
      if (path && !isExternalRead) {
        const workspace = this.resolveWorkspacePath();
        if (workspace) {
          void vscode.window.showTextDocument(vscode.Uri.file(join(workspace, path)));
        }
        await this.validateAfterWrite(path);
      }
    } else {
      this.pushActivity('error', `Failed to apply ${path ?? request.toolName}`, result.error);
      void vscode.window.showErrorMessage(`${AGENT_NAME}: ${result.error ?? 'Write failed'}`);
      if (request.toolCallId) {
        this.resumeApprovalResults.push({
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: result.error ?? 'Tool failed',
          success: false,
          input: fullInput,
        });
      }
    }
  }

  async approveAllPending(): Promise<void> {
    const pending = this.approvalQueue?.getPending() ?? [];
    for (const req of [...pending]) {
      await this.resolveApproval(req.id, 'approved', undefined, 'task');
    }
  }

  async selectSessionModel(selection: SessionProviderOverrideView | null): Promise<void> {
    if (!this.session) return;
    if (!selection) {
      this.session.setProviderOverride(null);
      const state = await this.buildUiState(this.getPreservedUiBase());
      this.notifyUi({
        providerLabel: state.providerLabel,
        modelOptions: state.modelOptions,
        sessionProviderOverride: null,
        tokenUsage: state.tokenUsage,
      });
      return;
    }

    const config = this.configService.getConfig();
    const override: ThunderSessionProviderOverride = {
      providerType: selection.providerType as ProviderType,
      model: selection.model.trim(),
      baseUrl: selection.baseUrl.trim(),
      profile: selection.profile?.trim() || null,
      profileId: selection.profileId,
      apiVersion: selection.apiVersion?.trim() || config.provider.apiVersion,
      region: selection.region?.trim() || config.provider.region,
      contextWindow: selection.contextWindow ?? config.provider.contextWindow,
    };

    const validation = validateProviderSettings({
      providerType: override.providerType,
      baseUrl: override.baseUrl,
      model: override.model,
      apiVersion: override.apiVersion,
      region: override.region,
      contextWindow: override.contextWindow ?? config.provider.contextWindow,
    });
    if (!validation.ok) {
      void vscode.window.showErrorMessage(`${AGENT_NAME}: ${validation.errors.join(' ')}`);
      return;
    }

    try {
      enforceEnterpriseProviderPolicy(config.enterprise.localProvidersOnly, override.providerType, override.baseUrl);
    } catch (error) {
      const safe = normalizeError(error);
      void vscode.window.showErrorMessage(`${AGENT_NAME}: ${safe.message}`);
      return;
    }

    this.session.setProviderOverride(override);
    this.rememberProviderOverride(override);
    const state = await this.buildUiState(this.getPreservedUiBase());
    this.notifyUi({
      providerLabel: state.providerLabel,
      modelOptions: state.modelOptions,
      sessionProviderOverride: state.sessionProviderOverride,
      tokenUsage: state.tokenUsage,
    });
  }

  async saveSessionModelAsDefault(): Promise<void> {
    const override = this.session?.providerOverride;
    if (!override) return;

    const config = this.configService.getConfig();
    await this.saveProviderSettings({
      providerType: override.providerType,
      baseUrl: override.baseUrl,
      model: override.model,
      apiVersion: override.apiVersion ?? config.provider.apiVersion,
      region: override.region ?? config.provider.region,
      contextWindow: override.contextWindow ?? config.provider.contextWindow,
    }, 'save-as-default');
    this.session?.setProviderOverride(null);
    const state = await this.buildUiState(this.getPreservedUiBase());
    this.notifyUi({
      providerLabel: state.providerLabel,
      modelOptions: state.modelOptions,
      sessionProviderOverride: null,
      tokenUsage: state.tokenUsage,
      settings: state.settings,
    });
  }

  async testProviderConnection(settings?: ProviderSettingsPayload): Promise<void> {
    this.testingConnection = true;
    this.notifyUi({ testingConnection: true });
    try {
    const config = this.configService.getConfig();
    const apiKey = await this.configService.getApiKey();
    const providerType = settings?.providerType ?? config.provider.type;
    const baseUrl = settings?.baseUrl.trim() || config.provider.baseUrl;
    const model = settings?.model.trim() || config.provider.model;
    const apiVersion = settings?.apiVersion?.trim() || config.provider.apiVersion;
    const region = settings?.region?.trim() || config.provider.region;
    const requestedContextWindow = settings?.contextWindow
      ? Math.max(1024, Math.min(settings.contextWindow, 1_000_000))
      : config.provider.contextWindow;
    const contextWindow = resolveAutoContextWindow(
      providerType,
      model,
      requestedContextWindow,
      config.provider.contextWindow
    );
    const validation = validateProviderSettings({
      providerType,
      baseUrl,
      model,
      apiVersion,
      region,
      contextWindow,
    } as ProviderSettingsPayload);
    if (!validation.ok) {
      this.notifyUi({
        settings: {
          ...(await this.buildUiState()).settings,
          providerType,
          baseUrl,
          model,
          apiVersion,
          region,
          contextWindow,
          connectionOk: false,
          connectionStatus: validation.errors.join(' '),
        },
        testingConnection: false,
      });
      return;
    }

    if (providerType === 'echo') {
      this.notifyUi({
        settings: {
          ...(await this.buildUiState()).settings,
          providerType,
          baseUrl,
          model,
          apiVersion,
          region,
          contextWindow,
          connectionOk: true,
          connectionStatus: 'Echo mode — no LLM needed. Responses are mirrored for UI testing.',
        },
        testingConnection: false,
      });
      return;
    }

    const result = await testProviderConnection(
      providerType as import('../config/schema').ProviderType,
      baseUrl,
      model,
      apiKey,
      apiVersion,
      region
    );

    this.notifyUi({
      settings: {
        ...(await this.buildUiState()).settings,
        providerType,
        baseUrl,
        model,
        apiVersion,
        region,
        contextWindow,
        connectionOk: result.ok,
        connectionStatus: result.message,
      },
      testingConnection: false,
    });

    if (!result.ok) {
      void vscode.window.showErrorMessage(`${AGENT_NAME}: ${result.message}`);
    }
    } finally {
      this.testingConnection = false;
      this.notifyUi({ testingConnection: false });
    }
  }

  async saveApiKey(key: string): Promise<void> {
    await this.configService.setApiKey(key);
    const config = this.configService.getConfig();
    const apiKey = await this.configService.getApiKey();
    await this.providerRegistry.resolveFromConfig(config.provider, apiKey);
    await this.refreshResearchAgentProvider();
    this.chatOrchestrator?.configure({ researchAgentProvider: this.researchAgentProvider });
    this.notifyUi({ settings: (await this.buildUiState()).settings });
  }

  async saveGitHubToken(token: string): Promise<void> {
    await this.configService.setApiKey(token, this.configService.getConfig().github.tokenRef);
    this.notifyUi({ settings: (await this.buildUiState()).settings });
  }

  async saveProviderSettings(
    settings: ProviderSettingsPayload,
    reason: import('../config/vscode/write').ProviderSettingsWriteReason = 'settings'
  ): Promise<void> {
    const validation = validateProviderSettings(settings);
    if (!validation.ok) {
      void vscode.window.showErrorMessage(`${AGENT_NAME}: ${validation.errors.join(' ')}`);
      this.notifyUi({
        settings: {
          ...(await this.buildUiState()).settings,
          connectionOk: false,
          connectionStatus: validation.errors.join(' '),
        },
      });
      return;
    }
    await this.configService.updateProviderSettings(
      normalizeProviderSettings(settings, this.configService.getConfig().provider.contextWindow),
      reason
    );
    const config = this.configService.getConfig();
    const apiKey = await this.configService.getApiKey();
    await this.providerRegistry.resolveFromConfig(config.provider, apiKey);
    await this.refreshResearchAgentProvider();
    this.chatOrchestrator?.configure({ researchAgentProvider: this.researchAgentProvider });
    this.debouncedRebuildRetriever?.();
    this.notifyUi({ settings: (await this.buildUiState()).settings });
    void vscode.window.showInformationMessage(brandMessage('Provider settings saved.'));
  }

  async saveAgentSettings(settings: AgentSettingsPayload): Promise<void> {
    const previousDepth = this.configService.getConfig().agent.actDepth;
    await this.configService.updateAgentSettings(normalizeAgentSettings(settings));

    const config = this.configService.getConfig();
    if (settings.actDepth === 'quick' || (previousDepth !== 'quick' && config.agent.actDepth === 'quick')) {
      this.agentTaskState.reset();
      this.chatOrchestrator?.clearRoutingState();
    }
    await this.refreshResearchAgentProvider();
    this.chatOrchestrator?.configure({
      agentConfig: config.agent,
      researchAgentProvider: this.researchAgentProvider,
    });
    this.notifyUi({ settings: (await this.buildUiState()).settings });
    void vscode.window.showInformationMessage(brandMessage('Agent settings saved.'));
  }

  async saveSafetySettings(settings: SafetySettingsPayload): Promise<void> {
    await this.configService.updateSafetySettings(settings);
    const config = this.configService.getConfig();
    const effectiveSafety = resolveEffectiveSafety({ ...config.safety, ...settings });
    this.policyEngine?.updateSafetyConfig(effectiveSafety);
    this.notifyUi({ settings: (await this.buildUiState()).settings });
    void vscode.window.showInformationMessage(brandMessage('Approval mode saved.'));
  }

  async saveMcpSettings(settings: McpSettingsPayload): Promise<void> {
    await this.configService.updateMcpSettings(settings);
    await this.reloadMcpServers();
    this.notifyUi({ settings: (await this.buildUiState()).settings });
    void vscode.window.showInformationMessage(
      settings.enabled ? brandMessage('MCP enabled.') : brandMessage('MCP disabled.')
    );
  }

  async saveAllSettings(settings: ThunderSettingsPayload): Promise<void> {
    this.settingsSaving = true;
    this.notifyUi({ settingsSaving: true });
    try {
    const beforeConfig = this.configService.getConfig();
    const normalized = normalizeThunderSettings(settings, beforeConfig.provider.contextWindow, this.mcpToggles);
    const normalizedMemory = normalized.memory ?? {
      summarizeAfterTask: true,
      autoMemoryEnabled: true,
      autoMemoryScope: 'user' as const,
    };

    const vectorConfigChanged =
      beforeConfig.indexing.vectorsEnabled !== normalized.indexing.vectorsEnabled ||
      beforeConfig.indexing.embeddingProvider !== normalized.indexing.embeddingProvider ||
      beforeConfig.indexing.vectorBackend !== normalized.indexing.vectorBackend ||
      beforeConfig.memory.hybridSearchEnabled !== normalized.indexing.hybridMemorySearch ||
      beforeConfig.memory.autoMemoryEnabled !== normalizedMemory.autoMemoryEnabled ||
      beforeConfig.memory.autoMemoryScope !== normalizedMemory.autoMemoryScope;

    await this.configService.updateAllSettings(normalized);

    if (!normalized.indexing.vectorsEnabled) {
      this.contextToggles = { ...this.contextToggles, vectors: false };
    } else if (!beforeConfig.indexing.vectorsEnabled && normalized.indexing.vectorsEnabled) {
      this.contextToggles = { ...this.contextToggles, vectors: true };
    }

    const config = this.configService.getConfig();
    if (this.session) {
      this.configureSessionLogging(this.session, this.resolveWorkspacePath() ?? '');
    }
    const apiKey = await this.configService.getApiKey();
    await this.providerRegistry.resolveFromConfig(config.provider, apiKey);
    await this.refreshResearchAgentProvider();
    this.chatOrchestrator?.configure({
      agentConfig: config.agent,
      researchAgentProvider: this.researchAgentProvider,
    });

    const effectiveSafety = resolveEffectiveSafety(config.safety);
    this.policyEngine?.updateSafetyConfig(effectiveSafety);
    this.checkpointService?.setStrategy(config.agent.checkpointStrategy);

    setVerifyCommandPatterns(config.agent.verifyCommands);

    await this.reloadMcpServers();
    this.debouncedRebuildRetriever?.();

    if (vectorConfigChanged) {
      await this.reloadWorkspace({ autoIndex: false });
      if (normalized.indexing.vectorsEnabled) {
        await this.indexWorkspace({ force: true });
      }
      void vscode.window.showInformationMessage(
        brandMessage(
          normalized.indexing.vectorsEnabled
            ? 'Vector settings saved. Re-indexing workspace to build embeddings.'
            : 'Vector search disabled. Settings saved.'
        )
      );
    } else {
      this.notifyUi({
        settings: (await this.buildUiState()).settings,
        contextToggles: this.contextToggles,
      });
      void vscode.window.showInformationMessage(brandMessage('Settings saved.'));
    }
    } finally {
      this.settingsSaving = false;
      this.notifyUi({
        ...(await this.buildUiState(this.getPreservedUiBase())),
        settingsSaving: false,
      });
    }
  }

  async saveProviderProfile(options: {
    id?: string;
    name?: string;
    settings: ProviderSettingsPayload;
    apiKey?: string;
  }): Promise<void> {
    const workspace = this.resolveWorkspacePath();
    if (!workspace) {
      throw new Error('Open a workspace to save provider profiles under .mitii/providers.');
    }
    const validation = validateProviderSettings(options.settings);
    if (!validation.ok) {
      throw new Error(validation.errors.join(' '));
    }

    if (!this.providerProfilesService) {
      this.providerProfilesService = new ProviderProfilesService(workspace);
    }

    const profile = this.providerProfilesService.upsert(options.settings, {
      id: options.id,
      name: options.name,
      apiKey: options.apiKey,
    });

    if (options.apiKey?.trim()) {
      await this.configService.setApiKey(options.apiKey.trim(), providerSecretRef(profile.id));
    }

    await this.applyProviderProfile(profile.id);
  }

  async selectProviderProfile(id: string): Promise<void> {
    await this.applyProviderProfile(id);
  }

  async deleteProviderProfile(id: string): Promise<void> {
    const workspace = this.resolveWorkspacePath();
    if (!workspace || !this.providerProfilesService) return;
    this.providerProfilesService.delete(id);
    await this.configService.deleteApiKey(providerSecretRef(id));
    this.notifyUi({ settings: (await this.buildUiState(this.getPreservedUiBase())).settings });
  }

  private async applyProviderProfile(id: string): Promise<void> {
    const workspace = this.resolveWorkspacePath();
    if (!workspace) return;

    if (!this.providerProfilesService) {
      this.providerProfilesService = new ProviderProfilesService(workspace);
    }

    const profile = this.providerProfilesService.setActive(id);
    if (!profile) return;

    await this.configService.updateProviderSettings({
      providerType: profile.providerType,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiVersion: profile.apiVersion,
      region: profile.region,
      contextWindow: profile.contextWindow,
    });

    const config = this.configService.getConfig();
    const apiKey = profile.hasApiKey
      ? await this.configService.getApiKey(providerSecretRef(profile.id))
      : await this.configService.getApiKey();
    await this.providerRegistry.resolveFromConfig(config.provider, apiKey);
    await this.refreshResearchAgentProvider();
    this.chatOrchestrator?.configure({ researchAgentProvider: this.researchAgentProvider });
    this.debouncedRebuildRetriever?.();
    this.notifyUi({ settings: (await this.buildUiState(this.getPreservedUiBase())).settings });
  }

  private async reloadMcpServers(): Promise<void> {
    if (!this.toolRuntime) return;
    const config = this.configService.getConfig();
    const workspace = this.resolveWorkspacePath() ?? '';
    await this.mcpManager.reload(config.mcp, workspace, this.toolRuntime, this.mcpToggles);
  }

  private loadMcpTogglesFromConfig(): McpToggles {
    const builtin = this.configService.getConfig().mcp.builtinServers;
    return {
      filesystem: builtin.filesystem,
      memory: builtin.memory,
      sequentialThinking: builtin.sequentialThinking,
      puppeteer: builtin.puppeteer ?? false,
      agentmemory: builtin.agentmemory ?? false,
    };
  }

  setMcpToggle(server: keyof McpToggles, enabled: boolean): void {
    this.mcpToggles = { ...this.mcpToggles, [server]: enabled };
    this.notifyUi({ mcpToggles: this.mcpToggles });
    void this.reloadMcpServers().then(() => {
      void this.buildUiState().then((state) => {
        this.notifyUi({ settings: state.settings });
      });
    });
  }

  async saveCustomMcpServers(servers: McpCustomServerView[]): Promise<void> {
    const workspace = this.resolveWorkspacePath() ?? '';
    await this.configService.updateCustomMcpServers(servers, workspace);
    await this.reloadMcpServers();
    this.notifyUi({ settings: (await this.buildUiState()).settings });
    void vscode.window.showInformationMessage(brandMessage('MCP servers saved.'));
  }

  setContextToggle(source: keyof ContextToggles, enabled: boolean): void {
    if (source === 'vectors' && enabled && !this.configService.getConfig().indexing.vectorsEnabled) {
      return;
    }
    this.contextToggles = { ...this.contextToggles, [source]: enabled };
    this.notifyUi({ contextToggles: this.contextToggles });
    this.debouncedRebuildRetriever?.();
  }

  async restoreCheckpoint(id: string): Promise<boolean> {
    const ok = await (this.checkpointService?.restore(id) ?? Promise.resolve(false));
    if (ok) {
      void vscode.window.showInformationMessage(brandMessage('Checkpoint restored.'));
      this.notifyUi({
        checkpoints: (this.checkpointService?.list(this.session?.id) ?? []).map((c) => ({
          id: c.id, kind: c.kind, files: c.files, createdAt: c.createdAt,
        })),
      });
    }
    return ok;
  }

  deleteMemory(id: number): boolean {
    const ok = this.memoryService?.delete(id) ?? false;
    if (ok) this.refreshMemoryPanel();
    return ok;
  }

  clearMemory(): number {
    const count = this.memoryService?.clear() ?? 0;
    this.refreshMemoryPanel();
    return count;
  }

  refreshMemoryPanel(): void {
    this.notifyUi({
      memories: (this.memoryService?.recent(20) ?? []).map((m) => ({
        id: m.id, type: m.type, text: m.text, createdAt: m.createdAt,
      })),
    });
  }

  refreshCheckpointPanel(): void {
    this.notifyUi({
      checkpoints: (this.checkpointService?.list(this.session?.id) ?? []).map((c) => ({
        id: c.id, kind: c.kind, files: c.files, createdAt: c.createdAt, strategy: c.strategy,
      })),
    });
  }

  async showInlineDiffForApproval(approvalId: string): Promise<void> {
    const pending = this.approvalQueue?.getPending() ?? [];
    if (!pending.some((req) => req.id === approvalId)) return;
    await this.showInlineDiffForPendingApprovals(approvalId);
  }

  async indexWorkspace(options: { force?: boolean; auto?: boolean; background?: boolean } = { force: true }): Promise<void> {
    const workspace = this.resolveWorkspacePath();
    if (!workspace) {
      this.setWorkspaceNotice('warn', 'Set a workspace path first (Browse or paste an absolute path).');
      void vscode.window.showWarningMessage(brandMessage('Set a workspace path in Settings before indexing.'));
      return;
    }

    if (!this.indexService) {
      try {
        await this.initializeWorkspaceServices(workspace);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.setWorkspaceNotice('error', `Index init failed: ${msg}`);
        void vscode.window.showErrorMessage(`${AGENT_NAME}: Could not initialize index — ${msg}`);
        return;
      }
    }

    const config = this.configService.getConfig();
    if (!config.indexing.enabled) {
      void vscode.window.showInformationMessage(brandMessage('Indexing is disabled in settings.'));
      return;
    }
    if (!this.isWorkspaceTrusted()) {
      this.setWorkspaceNotice('warn', 'Indexing is disabled in untrusted workspace mode.');
      void vscode.window.showWarningMessage(brandMessage('Trust this workspace to enable indexing.'));
      return;
    }

    if (!this.scanner || !this.indexQueue) {
      void vscode.window.showErrorMessage(brandMessage('Index services not initialized.'));
      return;
    }

    const previousStatus = this.indexQueue.getStatus();
    const firstAutoRun = Boolean(options.auto && !options.background && previousStatus.indexed === 0);
    const priorityRoots = firstAutoRun ? priorityDiscoveryRoots(workspace) : [];
    const isPartialDiscovery = firstAutoRun;
    const discovery = new FileDiscoveryService(workspace, this.ignoreService, config.indexing);
    this.indexQueue.setRunMetadata({
      phase: 'scanning',
      partial: isPartialDiscovery,
      degraded: isPartialDiscovery || this.indexingStatus.degraded,
      detail: isPartialDiscovery
        ? 'Scanning priority files first. Existing indexed context stays usable while the full repository is discovered in the background.'
        : options.background
          ? 'Scanning the remaining repository for incremental indexing.'
          : 'Scanning workspace for changed files.',
    });
    const files = sortIndexCandidates(
      await discovery.discoverAsync({
        roots: isPartialDiscovery && priorityRoots.length > 0 ? priorityRoots : undefined,
        limit: isPartialDiscovery ? AUTO_INDEX_INITIAL_FILE_LIMIT : undefined,
      }),
      config.indexing.priorityPaths
    );
    if (this.indexQueue.getStatus().phase === 'cancelled') {
      this.indexingStatus = this.indexQueue.getStatus();
      this.notifyUi({ indexing: this.indexingStatus, workspaceNotice: this.workspaceNotice });
      return;
    }

    const diff = this.scanner.computeDiff(files, { includeDeleted: !isPartialDiscovery });
    this.scanner.persistScan(diff);

    const filesToIndex = sortIndexCandidates(
      options.force ? files : [...diff.added, ...diff.changed],
      config.indexing.priorityPaths
    );
    const jobs = filesToIndex.map((f) => ({
      fileId: this.scanner!.getFileId(f.relPath)!,
      relPath: f.relPath,
      absPath: f.absPath,
      language: f.language,
    })).filter((j) => j.fileId !== undefined);

    if (jobs.length === 0) {
      this.indexingStatus = this.indexQueue.getStatus();
      this.indexQueue.setRunMetadata({
        phase: 'complete',
        partial: false,
        degraded: false,
        detail: 'Index is up to date.',
      });
      this.indexingStatus = this.indexQueue.getStatus();
      this.setWorkspaceNotice('ok', 'Index is up to date');
      this.sessionLog.append('index_complete', 'Index up to date', { workspace, jobCount: 0 });
      this.notifyUi({ indexing: this.indexingStatus, workspaceNotice: this.workspaceNotice });
      if (firstAutoRun) this.scheduleBackgroundIndex(workspace);
      return;
    }

    this.indexQueue.enqueue(jobs, {
      partial: isPartialDiscovery,
      degraded: isPartialDiscovery,
      detail: isPartialDiscovery
        ? `Indexing ${jobs.length} priority file${jobs.length === 1 ? '' : 's'} first. Ask and Plan remain usable with partial context.`
        : options.background
          ? `Background indexing ${jobs.length} changed file${jobs.length === 1 ? '' : 's'} for full repository coverage.`
          : `Indexing ${jobs.length} changed file${jobs.length === 1 ? '' : 's'}.`,
    });
    this.indexingStatus = this.indexQueue.getStatus();
    const label = options.background
      ? 'Background indexing'
      : firstAutoRun
        ? 'Indexing priority files'
        : options.force
          ? 'Reindexing'
          : 'Indexing';
    this.setWorkspaceNotice('ok', `${label} ${jobs.length} files…`);
    this.sessionLog.append('index_start', `${label} ${jobs.length} files`, {
      workspace,
      added: diff.added.length,
      changed: diff.changed.length,
      removed: diff.deleted.length,
      forced: options.force,
      partial: isPartialDiscovery,
    });
    this.notifyUi({ indexing: this.indexingStatus, workspaceNotice: this.workspaceNotice });
    log.info('indexWorkspace', { total: jobs.length, partial: isPartialDiscovery, background: options.background });

    if (firstAutoRun) this.scheduleBackgroundIndex(workspace);
    void this.waitForIndexingComplete(workspace, jobs.length);
  }

  cancelIndexing(): void {
    if (!this.indexQueue) return;
    this.indexQueue.cancel();
    this.indexingStatus = this.indexQueue.getStatus();
    this.setWorkspaceNotice('warn', 'Indexing canceled. Existing indexed context is still usable.');
    this.sessionLog.append('info', 'Indexing canceled by user', {
      workspace: this.resolveWorkspacePath(),
      indexed: this.indexingStatus.indexed,
      queued: this.indexingStatus.queued,
      processed: this.indexingStatus.processed,
      runTotal: this.indexingStatus.runTotal,
    });
    this.notifyUi({ indexing: this.indexingStatus, workspaceNotice: this.workspaceNotice });
  }

  private scheduleBackgroundIndex(workspace: string): void {
    if (this.backgroundIndexTimer || this.disposed) return;
    this.backgroundIndexTimer = setTimeout(() => {
      this.backgroundIndexTimer = undefined;
      if (this.disposed || this.resolveWorkspacePath() !== workspace) return;
      void this.indexWorkspace({ force: false, background: true });
    }, AUTO_INDEX_BACKGROUND_DELAY_MS);
  }

  private async waitForIndexingComplete(workspace: string, jobCount: number): Promise<void> {
    if (!this.indexQueue || jobCount === 0) {
      this.sessionLog.append('index_complete', 'Index up to date', { workspace, jobCount: 0 });
      return;
    }

    const start = Date.now();
    while (this.indexQueue.getStatus().running || this.indexQueue.getStatus().queued > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (Date.now() - start > 600_000) break;
    }
    await this.indexQueue.waitForVectorIndexing();

    const status = this.indexQueue.getStatus();
    this.sessionLog.append('index_complete', 'Indexing finished', {
      workspace,
      jobCount,
      indexed: status.indexed,
      failed: status.failed,
      durationMs: Date.now() - start,
    });
    if (status.phase === 'cancelled') return;
    this.setWorkspaceNotice(
      status.failed > 0 ? 'warn' : 'ok',
      status.failed > 0
        ? `Indexed ${status.indexed} files; ${status.failed} failed`
        : status.partial
          ? `Indexed ${status.indexed} priority files; background indexing continues`
          : `Indexed ${status.indexed} files`
    );
    this.notifyUi({ indexing: status, workspaceNotice: this.workspaceNotice });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Abort active provider/tool loops before recording the terminal lifecycle
    // event; otherwise in-flight work can append events after session_end.
    this.chatOrchestrator?.stop();
    this.sessionLog.endSession({ reason: 'controller_disposed' });
    void debugTrace.flush();
    this.configService.dispose();
    void this.mcpManager.closeAll();
    if (this.backgroundIndexTimer) clearTimeout(this.backgroundIndexTimer);
    if (this.watchDebounceTimer) clearTimeout(this.watchDebounceTimer);
    if (this.indexStatusNotifyTimer) clearTimeout(this.indexStatusNotifyTimer);
    if (this.tokenUsageNotifyTimer) clearTimeout(this.tokenUsageNotifyTimer);
    this.indexService?.dispose();
    this.indexQueue?.cancel();
    this.languageServiceSyncDisposable?.dispose();
    if (this.session?.workspace) disposeLanguageService(this.session.workspace);
    this.languageService = undefined;
    this.session = undefined;
    log.info('ThunderController disposed');
  }
}

export function toApprovalView(r: import('../safety/ApprovalQueue').ApprovalRequest): ApprovalRequestView {
  return {
    id: r.id,
    toolName: r.toolName,
    inputPreview: r.inputPreview,
    files: r.files,
    risk: r.risk,
    reason: r.reason,
    contentLength: r.contentLength,
    kind: r.kind,
    question: r.question,
    options: r.options,
  };
}

function buildVectorIndexStatusView(
  indexingConfig: import('../config/schema').IndexingConfig,
  workspace: string,
  vectorIndexService: VectorIndexService | undefined
): import('../../vscode/webview/messages').VectorIndexStatusView {
  const health = vectorIndexService?.getHealth();
  const degradedParts: string[] = [];
  if (health?.embedder.status === 'degraded') {
    degradedParts.push(`embeddings: ${health.embedder.detail ?? 'unavailable'}`);
  }
  if (health?.backend.status === 'degraded') {
    degradedParts.push(`vector backend: ${health.backend.detail ?? 'unavailable'}`);
  }

  return {
    enabled: indexingConfig.vectorsEnabled,
    embeddedChunks: vectorIndexService?.count(workspace) ?? 0,
    provider: describeEmbeddingProvider(indexingConfig),
    backend: describeVectorBackend(indexingConfig),
    degraded: degradedParts.length > 0,
    degradedDetail: degradedParts.length > 0 ? degradedParts.join('; ') : undefined,
  };
}

function toPlanView(plan: import('../plans/PlanActEngine').ThunderPlan | null | undefined): PlanView | null {
  if (!plan) return null;
  const stepStatus = new Map(plan.steps.map((step) => [step.id, step.status]));
  return {
    ...plan,
    steps: plan.steps.map((step) => ({ ...step })),
    phases: plan.phases?.map((phase) => ({
      id: phase.id,
      title: phase.title,
      phase: phase.phase,
      steps: phase.steps.map((step) => ({
        ...step,
        status: stepStatus.get(step.id) ?? 'pending',
      })),
    })),
  };
}

function normalizePromptBreakdown(
  breakdown: TokenUsageBreakdownItem[],
  promptTokens: number
): TokenUsageBreakdownItem[] {
  if (promptTokens <= 0) return breakdown;

  const overheadLabel = 'Agent transcript + request overhead';
  const base = breakdown.filter((item) => item.label !== overheadLabel);
  const visibleTotal = base.reduce((sum, item) => sum + item.tokens, 0);
  const residual = promptTokens - visibleTotal;
  if (residual <= 0) return base;

  return [
    ...base,
    {
      label: overheadLabel,
      tokens: residual,
      color: '#38bdf8',
    },
  ];
}

function findFatalToolFailures(
  audit: import('../tools/types').ToolCallAudit[]
): import('../tools/types').ToolCallAudit[] {
  return audit.filter((entry, index) => isFatalToolFailure(entry, index, audit));
}

function isFatalToolFailure(
  entry: import('../tools/types').ToolCallAudit,
  index: number,
  audit: import('../tools/types').ToolCallAudit[]
): boolean {
  if (entry.result.success || entry.result.skipped) return false;

  const later = audit.slice(index + 1);
  if (isExplorationTool(entry.toolName)) {
    return !later.some((candidate) => candidate.result.success && isExplorationTool(candidate.toolName));
  }

  const key = recoveryKey(entry);
  return !later.some((candidate) =>
    candidate.result.success &&
    candidate.toolName === entry.toolName &&
    recoveryKey(candidate) === key
  );
}

function isRecoveredToolActivity(
  message: string,
  audit: import('../tools/types').ToolCallAudit[],
  fatalToolFailures: import('../tools/types').ToolCallAudit[]
): boolean {
  if (!/\bfailed\b/i.test(message)) return false;
  if (fatalToolFailures.length > 0) return false;
  return audit.some((entry) => !entry.result.success || entry.result.skipped);
}

function isExplorationTool(toolName: string): boolean {
  return ['read_file', 'read_files', 'list_files', 'search', 'search_batch', 'resolve_path', 'repo_map'].includes(toolName);
}

function recoveryKey(entry: import('../tools/types').ToolCallAudit): string {
  const input = entry.input as Record<string, unknown>;
  if (typeof input.path === 'string') return `path:${input.path}`;
  if (typeof input.command === 'string') return `command:${input.command}`;
  if (typeof input.stepId === 'string') return `step:${input.stepId}`;
  if (typeof input.script === 'string') return `script:${input.script}`;
  return entry.toolName;
}

function readPackageVersion(workspace: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function formatTimestampForFile(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function platformRevealLabel(): string {
  if (process.platform === 'darwin') return 'Reveal in Finder';
  if (process.platform === 'win32') return 'Reveal in Explorer';
  return 'Reveal in File Manager';
}

function enforceEnterpriseProviderPolicy(localOnly: boolean, providerType: string, baseUrl: string): void {
  if (!localOnly) return;
  const url = baseUrl.trim().toLowerCase();
  const localUrl = /^(http:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\/|$)/.test(url) ||
    url.startsWith('http://[::1]');
  if (providerType === 'echo') return;
  if (providerType === 'openai-compatible' && localUrl) return;
  throw normalizeError(new Error(
    'Enterprise local-providers-only policy is enabled. Choose Echo or a localhost OpenAI-compatible provider.'
  ));
}
