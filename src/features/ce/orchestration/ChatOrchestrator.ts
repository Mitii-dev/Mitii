import { randomUUID } from 'crypto';
import type { EditorContextPort, DiffPreviewPort } from '../../../interfaces/runtime';
import type { ThunderDb } from '../../../features/ce/indexing/ThunderDb';
import type { AssistantStreamChunk, LlmProvider, ChatMessage } from '../../../kernel/llm/types';
import { chunkContent, isProgressChunk, toAssistantStreamChunk } from '../../../kernel/llm/streamChunks';
import type { ThunderSession } from '../../../features/ce/session/ThunderSession';
import type { ContextItem, ContextPack } from '../../../features/ce/context/types';
import type {
  ContextItemView,
  PlanView,
  AgentActivityEntry,
  ContextBudgetView,
  AgentLiveStatusView,
  TokenUsageBreakdownItem,
} from '../../../vscode/webview/messages';
import { HybridRetriever } from '../../../features/ce/context/HybridRetriever';
import { ContextBudgeter } from '../../../features/ce/context/ContextBudgeter';
import { UserExplicitContextBuilder, type PinnedContextEntry } from '../../../features/ce/context/UserExplicitContextBuilder';
import {
  buildPrompt,
  collectSystemPromptSections,
  describePromptSections,
} from '../../../features/ce/plans/promptBuilder';
import { classifyCommandEffect, inferTouchedFilesFromCommand, parsePlanFromText, isWriteAllowed } from '../../../features/ce/plans/PlanActEngine';
import { createLogger } from '../../../kernel/telemetry/Logger';
import type { SessionLogService } from '../../../kernel/telemetry/SessionLogService';
import { SessionTiming } from '../../../kernel/telemetry/SessionTiming';
import { extractFileMentions } from '../../../features/ce/context/fuzzyFileMatch';
import { expandContextQuery } from '../../../features/ce/context/contextQueryExpansion';
import { isInternalAgentPath } from '../../../features/ce/context/contextRelevance';
import { AutoApplyService } from '../../../features/ce/apply/AutoApplyService';
import type { ToolExecutor } from '../../../features/ce/safety/ToolExecutor';
import type { ToolRuntime } from '../../../kernel/tools/ToolRuntime';
import type { ToolDefinition } from '../../../kernel/llm/toolTypes';
import { toolsToDefinitions } from '../../../kernel/tools/toolSchema';
import { AgentLoop, type ApprovedToolResult, type AgentLoopSuspendState } from '../../../features/ce/runtime/AgentLoop';
import { describeSkipLabel, isSkippedToolOutput } from '../../../features/ce/runtime/toolSkip';
import { PlanExecutor } from '../../../features/ce/runtime/PlanExecutor';
import { shouldSkipStructuredPlanner } from '../../../features/ce/plans/planningDepth';
import { analyzeTask, type TaskAnalysis } from '../../../features/ce/runtime/TaskAnalyzer';
import {
  resolveTurnPipeline,
  filterToolsByCapabilities,
  buildRoutePolicyText,
  type PipelineResolution,
} from '../../../features/ce/pipeline';
import {
  ACT_INTENT_DESCRIPTIONS,
  ASK_INTENT_DESCRIPTIONS,
  PLAN_INTENT_DESCRIPTIONS,
  buildIntentClarification,
  classifyIntent,
  gateIntentClassification,
  safeDefaultIntent,
  type IntentClassification,
} from '../../../features/ce/runtime/intentClassifier';
import { extractOriginalTaskMessage, isApprovalContinuationMessage, resolveConversationTaskMessage } from '../../../features/ce/runtime/taskMessage';
import { compactMessagesWithLlm } from '../../../features/ce/runtime/ContextCompaction';
import { getMaxInputTokens } from '../../../features/ce/runtime/PromptBudget';
import { isAuditCleanupTask, AUDIT_AGENT_MAX_STEPS } from '../../../features/ce/runtime/taskKind';
import {
  isLogAuditTask,
  extractLogAuditTargetPath,
  buildLogAuditBootstrapBlock,
  LOG_AUDIT_AGENT_MAX_STEPS,
  LOG_AUDIT_SKIP_RETRIEVAL_SOURCES,
} from '../../../features/ce/runtime/logAudit';
import {
  filterAskModeTools,
  needsAskGrounding,
  shouldEnableAskSubagents,
} from '../../../features/ce/runtime/askMode';
import { AskOrchestrator } from '../../../features/ce/modes/ask/AskOrchestrator';
import { PlanOrchestrator } from '../../../features/ce/modes/plan/PlanOrchestrator';
import { filterPlanModeTools, needsPlanGrounding } from '../../../features/ce/modes/plan/planMode';
import { loadPlanningSkillPlaybooks, resolvePlanningSkillNames } from '../../../features/ce/modes/plan/planSkillRouting';
import { routePlanIntent } from '../../../features/ce/modes/plan/PlanIntentRouter';
import {
  ActOrchestrator,
  filterLogAuditModeTools,
  hasDirectRouteOverride,
  shouldResumeSavedPlan,
  shouldUsePlannerForAct,
} from '../../../features/ce/modes/agent';
import {
  extractMdxErrorFile,
  isMdxRepairTask,
  suggestDocsVerifyCommands,
} from '../../../features/ce/runtime/mdxRepairRouting';
import { setSubagentRuntime } from '../../../features/ce/tools/builtinTools';
import { resolveControlIntent } from '../../../features/ce/runtime/controlIntent';
import type { SessionService } from '../../../features/ce/session/SessionService';
import type { PlanPersistence } from '../../../features/ce/plans/PlanPersistence';
import type { MemoryExtractor } from '../../../features/ce/runtime/MemoryExtractor';
import type { AgentConfig, MemoryConfig } from '../../../kernel/config/schema';
import type { PassiveMemoryInjector } from '../../../features/ce/memory/PassiveMemoryInjector';
import type { MemoryHookService } from '../../../features/ce/memory/MemoryHookService';
import type { MemoryService } from '../../../features/ce/memory/MemoryService';
import type { AgentTaskState } from '../../../features/ce/runtime/AgentTaskState';
import type { PostEditValidator } from '../../../features/ce/apply/PostEditValidator';
import type { SkillCatalogService } from '../../../features/ce/skills/SkillCatalogService';
import type { SkillResolver } from '../../../features/ce/skills/SkillEngine';
import type { SkillInjectionBuilder } from '../../../features/ce/skills/SkillInjectionBuilder';
import type { SkillTelemetry } from '../../../features/ce/skills/SkillTelemetry';
import type { RepositoryProfileProvider } from '../../../features/ce/skills/RepositoryProfileProvider';
import { normalizeAgentDepth } from '../../../kernel/config/agentDepth';
import type { SkillRuntimeContext } from '../../../features/ce/skills/skillRuntimeContext';
import { thunderPlanToView } from '../../../features/ce/modes/plan/planViewMapper';
import { estimateChatRequestTokens } from '../../../features/ce/runtime/UsageTrackingProvider';
import { resolveTierPolicy } from '../../../kernel/llm/agenticTier';
import type { AgenticTier, TierPolicy } from '../../../kernel/policy/tierPolicy';
import { describeTier, scaleTierSteps } from '../../../kernel/policy/tierPolicy';
import { resolveMaxContextItems } from '../../../features/ce/context/resolveMaxContextItems';
import { enrichTask } from '../../../features/ce/task-board';
import type { GitHubIssueFetcher } from '../../../features/ce/github';
import { detectMicroTask, type MicroTaskExecutor } from '../../../features/ce/microtasks';
import type { AskIntent } from '../../../features/ce/modes/ask/askTypes';
import type { PlanIntent } from '../../../features/ce/modes/plan/planTypes';
import type { ActIntent } from '../../../features/ce/modes/agent/actTypes';

const log = createLogger('ChatOrchestrator');

export const EMPTY_ASSISTANT_RESPONSE_MESSAGE =
  'I did not receive any response from the model for this turn. Please try again, or switch models if it keeps happening.';

export function normalizeAssistantResponse(fullResponse: string): { content: string; wasEmpty: boolean } {
  if (fullResponse.trim()) return { content: fullResponse, wasEmpty: false };
  return { content: EMPTY_ASSISTANT_RESPONSE_MESSAGE, wasEmpty: true };
}

export type ContextPackCallback = (pack: ContextPack, views: ContextItemView[], budget: ContextBudgetView) => void;
export type PlanCallback = (plan: PlanView | null) => void;
export type ActivityCallback = (entry: AgentActivityEntry) => void;
export type LiveStatusCallback = (status: AgentLiveStatusView | null) => void;
export type TokenUsageCallback = (
  promptTokens: number,
  contextTokens: number,
  responseText: string,
  breakdown: TokenUsageBreakdownItem[],
  options?: { final?: boolean }
) => void;

type ModeIntentRouting =
  | { mode: 'ask'; classification: IntentClassification<AskIntent>; needsClarification: boolean; useClassification?: boolean }
  | { mode: 'plan'; classification: IntentClassification<PlanIntent>; needsClarification: boolean; useClassification?: boolean }
  | { mode: 'agent'; classification: IntentClassification<ActIntent>; needsClarification: boolean; useClassification?: boolean };

interface FinishTurnOptions {
  allowResponseAutoApply?: boolean;
  auditStartIndex?: number;
  activeTools?: ToolDefinition[];
  explicitContextBlock?: string;
}

interface RoutingClarificationState {
  originalMessage: string;
  mode: ThunderSession['mode'];
  candidateIntents: string[];
}

export interface ChatOrchestratorDeps {
  toolRuntime?: ToolRuntime;
  toolExecutor?: ToolExecutor;
  sessionService?: SessionService;
  planPersistence?: PlanPersistence;
  memoryExtractor?: MemoryExtractor;
  memoryConfig?: MemoryConfig;
  agentConfig?: AgentConfig;
  passiveMemoryInjector?: PassiveMemoryInjector;
  memoryHookService?: MemoryHookService;
  postEditValidator?: PostEditValidator;
  onPostWrite?: (relPath: string) => Promise<void>;
  workspace?: string;
  editorContext?: EditorContextPort;
  diffPreview?: DiffPreviewPort;
  sessionLog?: SessionLogService;
  memoryService?: MemoryService;
  taskState?: AgentTaskState;
  researchAgentProvider?: LlmProvider;
  runVerifyHooks?: (commands: string[], userMessage?: string, touchedFiles?: string[]) => Promise<string>;
  skillCatalog?: SkillCatalogService;
  skillResolver?: SkillResolver;
  skillInjectionBuilder?: SkillInjectionBuilder;
  skillTelemetry?: SkillTelemetry;
  repositoryProfileProvider?: RepositoryProfileProvider;
  allowNetwork?: () => boolean;
  githubIssueFetcher?: GitHubIssueFetcher;
  githubTokenProvider?: () => Promise<string | undefined>;
  githubIssueFetchEnabled?: boolean;
  githubIssueCommentLimit?: number;
  microTaskExecutorFactory?: (provider: LlmProvider) => MicroTaskExecutor;
  microTaskRoutingEnabled?: boolean;
  intentClassifierProvider?: LlmProvider;
}

export class ChatOrchestrator {
  private abortController: AbortController | undefined;
  private onContextPack: ContextPackCallback | undefined;
  private onPlan: PlanCallback | undefined;
  private onActivity: ActivityCallback | undefined;
  private onLiveStatus: LiveStatusCallback | undefined;
  private onTokenUsage: TokenUsageCallback | undefined;
  private autoApply = new AutoApplyService();
  private deps: ChatOrchestratorDeps = {};
  private agentLoop: AgentLoop | undefined;
  private planExecutor: PlanExecutor | undefined;
  private useSkillInvocationsThisTurn = 0;
  private skillInjectionTelemetry: {
    tier?: AgenticTier;
    style: TierPolicy['skillInjection'];
    suggested: string[];
    selected: string[];
    loaded: string[];
    rejected: Array<{ name: string; reason: string }>;
    injectedChars: number;
  } | undefined;
  private suspendContext: {
    session: ThunderSession;
    provider: LlmProvider;
    userMessage: string;
    auditMode: boolean;
    agentMaxSteps?: number;
    autoContinue?: boolean;
    maxAutoContinues?: number;
    planningResume?: {
      displayPack: ContextPack;
      planningRequest: string;
      taskAnalysis: TaskAnalysis;
      initialPlanningDiscovery: string;
      skillPlaybookContext: string;
      appliedSkills: string[];
    };
    planResume?: {
      plan: import('../../../features/ce/plans/PlanActEngine').ThunderPlan;
      displayPack: ContextPack;
      tools: ToolDefinition[];
      requirementAnalysis?: string;
      appliedSkills?: string[];
      skillPlaybookContext?: string;
    };
  } | undefined;
  private routingClarifications = new Map<string, RoutingClarificationState>();
  private retrievalCache: { key: string; items: ContextItem[]; at: number } | null = null;

  constructor(
    private readonly retriever: HybridRetriever,
    private readonly budgeter: ContextBudgeter,
    private readonly db?: ThunderDb
  ) {}

  configure(deps: ChatOrchestratorDeps): void {
    this.deps = { ...this.deps, ...deps };
    if (deps.toolExecutor) {
      this.autoApply = new AutoApplyService(deps.toolExecutor);
      this.agentLoop = new AgentLoop(deps.toolExecutor, 15);
    }
    if (deps.planPersistence && this.agentLoop) {
      this.planExecutor = new PlanExecutor(
        this.agentLoop,
        deps.planPersistence,
        deps.postEditValidator,
        deps.toolExecutor
      );
    }
  }

  setContextPackCallback(cb: ContextPackCallback): void {
    this.onContextPack = cb;
  }

  setPlanCallback(cb: PlanCallback): void {
    this.onPlan = cb;
  }

  setActivityCallback(cb: ActivityCallback): void {
    this.onActivity = cb;
  }

  setLiveStatusCallback(cb: LiveStatusCallback): void {
    this.onLiveStatus = cb;
  }

  setTokenUsageCallback(cb: TokenUsageCallback): void {
    this.onTokenUsage = cb;
  }

  setToolExecutor(executor: ToolExecutor | undefined): void {
    this.configure({ toolExecutor: executor });
  }

  private emitActivity(kind: AgentActivityEntry['kind'], message: string, detail?: string): void {
    this.onActivity?.({
      id: randomUUID(),
      kind,
      message,
      detail,
      timestamp: Date.now(),
    });
  }

  private emitEmptyResponse(providerId: string): void {
    this.emitActivity('error', 'Model returned an empty response', providerId);
    this.deps.sessionLog?.append('error', 'Model returned an empty response', {
      provider: providerId,
      fallbackMessage: EMPTY_ASSISTANT_RESPONSE_MESSAGE,
    });
  }

  private setLiveStatus(
    label: string | null,
    detail?: string,
    stepCurrent?: number,
    stepTotal?: number
  ): void {
    if (!label) {
      this.onLiveStatus?.(null);
      return;
    }
    this.onLiveStatus?.({ label, detail, stepCurrent, stepTotal });
  }

  private async resolveIntentRouting(
    mode: ThunderSession['mode'],
    userMessage: string,
    provider: LlmProvider
  ): Promise<ModeIntentRouting> {
    const classifierProvider = this.deps.intentClassifierProvider ?? this.deps.researchAgentProvider ?? provider;
    try {
      if (mode === 'ask') {
        const intents = Object.keys(ASK_INTENT_DESCRIPTIONS) as AskIntent[];
        const raw = await classifyIntent(classifierProvider, mode, userMessage, intents, ASK_INTENT_DESCRIPTIONS);
        const classification = gateIntentClassification(raw, mode, safeDefaultIntent(mode, intents));
        this.logIntentRouting(mode, classification, raw.intent !== classification.intent);
        return { mode, classification, needsClarification: Boolean(classification.needsClarification) };
      }
      if (mode === 'plan') {
        const intents = Object.keys(PLAN_INTENT_DESCRIPTIONS) as PlanIntent[];
        const raw = await classifyIntent(classifierProvider, mode, userMessage, intents, PLAN_INTENT_DESCRIPTIONS);
        const classification = gateIntentClassification(raw, mode, safeDefaultIntent(mode, intents));
        this.logIntentRouting(mode, classification, raw.intent !== classification.intent);
        return { mode, classification, needsClarification: Boolean(classification.needsClarification) };
      }
      const intents = Object.keys(ACT_INTENT_DESCRIPTIONS) as ActIntent[];
      const raw = await classifyIntent(classifierProvider, 'agent', userMessage, intents, ACT_INTENT_DESCRIPTIONS);
      const classification = gateIntentClassification(raw, 'agent', safeDefaultIntent('agent', intents));
      this.logIntentRouting('agent', classification, raw.intent !== classification.intent);
      return { mode: 'agent', classification, needsClarification: Boolean(classification.needsClarification) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn('Intent classifier failed; using synchronous fallback', { mode, error: message });
      this.emitActivity('info', 'Intent classifier fallback', message);
      return this.fallbackIntentRouting(mode);
    }
  }

  private fallbackIntentRouting(mode: ThunderSession['mode']): ModeIntentRouting {
    if (mode === 'ask') {
      return {
        mode,
        classification: {
          intent: 'explain_code',
          confidence: 0,
          alternatives: [],
          needsClarification: false,
          source: 'fallback',
          gated: true,
          gateReason: 'classifier_unavailable',
        },
        needsClarification: false,
        useClassification: false,
      };
    }
    if (mode === 'plan') {
      return {
        mode,
        classification: {
          intent: 'question',
          confidence: 0,
          alternatives: [],
          needsClarification: false,
          source: 'fallback',
          gated: true,
          gateReason: 'classifier_unavailable',
        },
        needsClarification: false,
        useClassification: false,
      };
    }
    return {
      mode: 'agent',
      classification: {
        intent: 'question',
        confidence: 0,
        alternatives: [],
        needsClarification: false,
        source: 'fallback',
        gated: true,
        gateReason: 'classifier_unavailable',
      },
      needsClarification: false,
      useClassification: false,
    };
  }

  private buildRoutingClarification(
    mode: ThunderSession['mode'],
    routing: ModeIntentRouting
  ): { question: string; options: string[] } {
    if (routing.mode === 'ask') {
      return buildIntentClarification(mode, routing.classification, ASK_INTENT_DESCRIPTIONS);
    }
    if (routing.mode === 'plan') {
      return buildIntentClarification(mode, routing.classification, PLAN_INTENT_DESCRIPTIONS);
    }
    return buildIntentClarification('agent', routing.classification, ACT_INTENT_DESCRIPTIONS);
  }

  private logIntentRouting<T extends string>(
    mode: ThunderSession['mode'],
    classification: IntentClassification<T>,
    gated: boolean
  ): void {
    this.deps.sessionLog?.appendDebug('info', 'Intent classifier result', {
      mode,
      intent: classification.intent,
      confidence: classification.confidence,
      alternatives: classification.alternatives,
      needsClarification: classification.needsClarification,
      source: classification.source,
      matchedRule: classification.matchedRule,
      confidenceMargin: classification.confidenceMargin,
      originalIntent: classification.originalIntent,
      originalConfidence: classification.originalConfidence,
      gated: classification.gated ?? gated,
      gateReason: classification.gateReason,
    });
  }

  async *send(
    session: ThunderSession,
    provider: LlmProvider,
    userMessage: string,
    recentMessages: ChatMessage[] = [],
    options?: { pinnedContext?: PinnedContextEntry[]; attachments?: ChatMessage['attachments'] }
  ): AsyncIterable<AssistantStreamChunk> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const sessionLog = this.deps.sessionLog;
    const sessionTiming = new SessionTiming();
    sessionTiming.start('turn_total');
    const auditStartIndex = this.deps.toolRuntime?.getAuditLog().length ?? 0;
    let preserveLiveStatus = false;
    let fullResponse = '';
    let completedContextTokens = 0;

    try {
    this.setLiveStatus('Starting', `Mode: ${session.mode}`);
    this.emitActivity('info', `Mode: ${session.mode} · Provider: ${provider.id}`);

    this.deps.sessionService?.ensureSession(session, userMessage.slice(0, 64));
    this.deps.sessionLog?.beginTurn({
      mode: session.mode,
      provider: provider.id,
    });
    this.deps.sessionLog?.append('user_message', userMessage.slice(0, 200), {
      mode: session.mode,
      provider: provider.id,
      messageLength: userMessage.length,
      auditMode: isAuditCleanupTask(userMessage),
    });

    const previousAssistantMessage = [...recentMessages].reverse().find((message) => message.role === 'assistant');
    const control = resolveControlIntent(userMessage, {
      hasActiveTask: recentMessages.length > 0,
      hasPendingApproval: isApprovalContinuationMessage(userMessage),
      previousTurnAskedQuestion: Boolean(previousAssistantMessage?.content.trim().endsWith('?')),
    });
    this.deps.sessionLog?.appendDebug('info', 'Control intent resolved', {
      intent: control.intent,
      matchedRule: control.matchedRule,
      requiresConversationContext: control.requiresConversationContext,
    });

    const microTaskId =
      this.deps.microTaskRoutingEnabled === false ||
      isApprovalContinuationMessage(userMessage) ||
      control.intent !== 'new_task'
      ? null
      : detectMicroTask(userMessage);
    if (microTaskId && this.deps.microTaskExecutorFactory) {
      this.setLiveStatus('Running micro-task', microTaskId.replace(/_/g, ' '));
      this.emitActivity('info', `Micro-task route: ${microTaskId}`, 'Using minimal Git/release context and no tools.');
      sessionTiming.start('microtask');
      const result = await this.deps.microTaskExecutorFactory(provider).execute(microTaskId, userMessage);
      sessionTiming.end('microtask', sessionLog, result.metadata);
      const normalizedResult = normalizeAssistantResponse(result.content);
      const content = normalizedResult.content;
      fullResponse = content;
      if (normalizedResult.wasEmpty) {
        this.emitEmptyResponse(provider.id);
      }
      this.saveTurn(session.id, 'user', userMessage);
      const emptyPack = emptyContextPack();
      const microTaskMessages: ChatMessage[] = [
        { role: 'system', content: `Mitii micro-task: ${microTaskId}` },
        { role: 'user', content: userMessage },
      ];
      const microTaskPromptTokens = estimateChatRequestTokens({
        messages: microTaskMessages,
      });
      await this.finishTurn(
        session,
        provider,
        userMessage,
        content,
        emptyPack,
        [],
        microTaskPromptTokens,
        microTaskMessages,
        {
          allowResponseAutoApply: false,
          auditStartIndex,
          activeTools: [],
        }
      );
      yield content;
      this.setLiveStatus(null);
      return;
    }

    const ws = this.deps.workspace ?? '';
    const rawCurrentFile = ws ? await this.deps.editorContext?.getActiveFile() : undefined;
    const currentFile = rawCurrentFile && !isInternalAgentPath(rawCurrentFile)
      ? rawCurrentFile
      : undefined;

    const rawOpenFiles = ws ? await this.deps.editorContext?.getOpenFiles() ?? [] : [];
    const openFiles = rawOpenFiles.filter((rel) => !isInternalAgentPath(rel));

    const agentConfig = this.deps.agentConfig;
    const askDepth = normalizeAgentDepth(agentConfig?.askDepth);
    const planDepth = normalizeAgentDepth(agentConfig?.planDepth);
    const actDepth = normalizeAgentDepth(agentConfig?.actDepth);
    const activeDepth = session.mode === 'ask' ? askDepth : session.mode === 'plan' ? planDepth : actDepth;
    const skillRuntimeContext: SkillRuntimeContext = {
      mode: session.mode,
      depth: activeDepth,
      askDepth,
      planDepth,
      actDepth,
      model: provider.id,
      modelSource: session.providerOverride?.model ? 'session' : 'turn',
    };
    const originalTaskMessage = extractOriginalTaskMessage(userMessage) ?? userMessage;
    const conversationTaskMessage = resolveConversationTaskMessage(originalTaskMessage, recentMessages);
    const taskEnrichment = await enrichTask(conversationTaskMessage, {
      github: {
        enabled: this.deps.githubIssueFetchEnabled ?? true,
        allowNetwork: Boolean(this.deps.allowNetwork?.()),
        tokenProvider: this.deps.githubTokenProvider,
        fetcher: this.deps.githubIssueFetcher,
        maxComments: this.deps.githubIssueCommentLimit,
      },
    });
    if (taskEnrichment.signals.githubIssue) {
      const signalInfo = taskEnrichment.signals.githubIssue;
      this.emitActivity(
        signalInfo.fetched ? 'context' : 'info',
        signalInfo.fetched
          ? `Fetched GitHub issue ${signalInfo.ref.owner}/${signalInfo.ref.repo}#${signalInfo.ref.number}`
          : `Detected GitHub issue ${signalInfo.ref.owner}/${signalInfo.ref.repo}#${signalInfo.ref.number}`,
        signalInfo.error
      );
    }

    const classifierText = conversationTaskMessage;
    const taskForClassification = taskEnrichment.classificationText;
    const isAskMode = session.mode === 'ask';
    const isPlanMode = session.mode === 'plan';
    const isAgentMode = session.mode === 'agent';
    const auditMode = isAuditCleanupTask(taskForClassification);
    const logAuditMode = isLogAuditTask(taskForClassification);
    const logAuditTarget = logAuditMode ? extractLogAuditTargetPath(taskForClassification) : undefined;
    const mdxRepairMode = isMdxRepairTask(taskForClassification);
    const mdxErrorFile = mdxRepairMode ? extractMdxErrorFile(taskForClassification) : undefined;
    const orchestrationEnabled = agentConfig?.orchestrationEnabled ?? true;
    const resolvedTier = resolveTurnAgenticTier(provider, agentConfig);
    const tierPolicy = resolveTierPolicy(resolvedTier);
    this.useSkillInvocationsThisTurn = 0;
    this.skillInjectionTelemetry = undefined;
    this.emitActivity('info', 'Active agent tier', describeTier(resolvedTier, tierPolicy));
    this.deps.sessionLog?.append('info', 'Active agent tier', {
      tier: resolvedTier,
      policy: tierPolicy,
      provider: provider.id,
      contextWindow: provider.capabilities.contextWindow,
      supportsReasoning: provider.capabilities.supportsReasoning,
    });
    const activePlanAtStart = isAgentMode
      ? this.deps.planPersistence?.getActive(session.id)
      : undefined;
    let intentRouting = await this.resolveIntentRouting(session.mode, classifierText, provider);
    if (intentRouting.needsClarification && (!this.deps.toolExecutor || isApprovalContinuationMessage(userMessage))) {
      this.deps.sessionLog?.append('info', 'Intent clarification skipped; using deterministic analyzer fallback', {
        mode: session.mode,
        hasToolExecutor: Boolean(this.deps.toolExecutor),
        isApprovalContinuation: isApprovalContinuationMessage(userMessage),
        classifierIntent: intentRouting.classification.intent,
      });
      intentRouting = {
        ...intentRouting,
        needsClarification: false,
        useClassification: false,
        classification: {
          ...intentRouting.classification,
          needsClarification: false,
        },
      } as ModeIntentRouting;
    }
    if (intentRouting.needsClarification && this.deps.toolExecutor && !isApprovalContinuationMessage(userMessage)) {
      const clarification = this.buildRoutingClarification(session.mode, intentRouting);
      const questionResult = await this.deps.toolExecutor.execute('ask_question', clarification);
      if (questionResult.pendingApproval) {
        this.routingClarifications.set(session.id, {
          originalMessage: classifierText,
          mode: session.mode,
          candidateIntents: [
            intentRouting.classification.intent,
            ...intentRouting.classification.alternatives.map((item) => item.intent),
          ],
        });
        this.saveTurn(session.id, 'user', userMessage);
        this.setLiveStatus('Waiting for clarification', clarification.question);
        preserveLiveStatus = true;
        return;
      }
    }
    const taskAnalysis = analyzeTask(taskForClassification, session.mode, {
      askIntent: intentRouting.mode === 'ask' && intentRouting.useClassification !== false ? intentRouting.classification.intent : undefined,
      planIntent: intentRouting.mode === 'plan' && intentRouting.useClassification !== false ? intentRouting.classification.intent : undefined,
      actIntent: intentRouting.mode === 'agent' && intentRouting.useClassification !== false ? intentRouting.classification.intent : undefined,
    });
    const resumeSavedPlan = shouldExecuteSavedPlan(
      session.mode,
      taskForClassification,
      Boolean(activePlanAtStart?.plan),
      actDepth
    );
    const pipeline: PipelineResolution = resolveTurnPipeline(taskForClassification, taskAnalysis, {
      mode: session.mode,
      userDepth: isAskMode ? askDepth : isPlanMode ? planDepth : actDepth,
      toolExposure: tierPolicy.toolExposure,
      mdxRepairMode,
      resumeSavedPlan,
      planning: isPlanMode || taskAnalysis.shouldPlan,
      planExecution: false,
      orchestrationEnabled,
      forceDirect: isAgentMode && hasDirectRouteOverride(taskForClassification),
    });
    let engineResolution: ReturnType<SkillResolver['resolve']> | undefined;
    if (this.deps.skillResolver && this.deps.repositoryProfileProvider && session.mode !== 'review') {
      const availableTools = new Set(this.deps.toolRuntime?.list().map((tool) => tool.name) ?? []);
      const taskSubtype = pipeline.route.auditSubtype ?? pipeline.route.docsSubtype;
      engineResolution = this.deps.skillResolver.resolve({
        request: taskForClassification,
        mode: session.mode,
        intent: pipeline.route.intent,
        taskKind: taskAnalysis.kind,
        taskSubtype,
        operationType: pipeline.route.operationClass,
        complexity: taskAnalysis.complexity,
        artifacts: pipeline.artifact.artifacts.map((artifact) => artifact.path).filter((path): path is string => Boolean(path)),
        repository: this.deps.repositoryProfileProvider.getProfile(),
        availableTools,
        availableCapabilities: new Set([
          ...availableTools,
          'repository-read',
          ...(session.mode === 'agent' ? ['workspace-write'] : []),
          ...(this.deps.allowNetwork?.() ? ['network'] : []),
        ]),
        edition: 'ce',
        manualSkillIds: extractManualSkillIds(taskForClassification),
      });
      pipeline.skills = {
        activeSkill: engineResolution.primarySkillId,
        supportingSkill: engineResolution.supportingSkillId,
        deferredSkills: engineResolution.candidateSkills
          .map((candidate) => candidate.id)
          .filter((id) => !engineResolution!.selectedSkillIds.includes(id)),
        suggestedSkills: engineResolution.candidateSkills.map((candidate) => candidate.id),
        injectSkills: engineResolution.selectedSkillIds,
        engineReport: {
          engineVersion: engineResolution.engineVersion,
          candidates: engineResolution.candidateSkills.map((candidate) => ({
            id: candidate.id,
            score: candidate.score,
            status: candidate.status,
            reasons: candidate.factors.map((factor) => factor.reason),
          })),
          rejected: engineResolution.rejectedSkills.map((candidate) => ({
            id: candidate.id,
            status: candidate.status,
            reasons: candidate.rejectionReasons,
          })),
        },
      };
      this.deps.skillTelemetry?.recordResolution({
        request: taskForClassification,
        mode: session.mode,
        intent: pipeline.route.intent,
        taskKind: taskAnalysis.kind,
        taskSubtype,
        operationType: pipeline.route.operationClass,
        complexity: taskAnalysis.complexity,
        artifacts: pipeline.artifact.artifacts.map((artifact) => artifact.path).filter((path): path is string => Boolean(path)),
        repository: this.deps.repositoryProfileProvider.getProfile(),
        availableTools,
        availableCapabilities: new Set(availableTools),
        edition: 'ce',
      }, engineResolution, 'plan-v1');
    }
    this.deps.sessionLog?.append('info', 'Pipeline resolution', {
      intent: pipeline.route.intent,
      auditSubtype: pipeline.route.auditSubtype,
      docsSubtype: pipeline.route.docsSubtype,
      operationClass: pipeline.route.operationClass,
      artifacts: pipeline.artifact.artifacts,
      executionPath: pipeline.route.executionPath,
      depthAxis: pipeline.depthAxis,
      activeSkill: pipeline.skills.activeSkill,
      injectSkills: pipeline.skills.injectSkills,
      excludedToolCount: pipeline.capabilities.excludedTools.size,
      mcpPolicy: pipeline.capabilities.mcpPolicy,
      shouldUsePlanner: pipeline.shouldUsePlanner,
    });
    const askPlan = isAskMode
      ? AskOrchestrator.prepare(taskForClassification, {
          workspaceRoot: this.deps.workspace,
          configuredMaxSteps: agentConfig?.askMaxSteps,
          askDepth: agentConfig?.askDepth,
          askAutoContinue: agentConfig?.askAutoContinue,
          askMaxAutoContinues: agentConfig?.askMaxAutoContinues,
          intent: intentRouting.mode === 'ask' && intentRouting.useClassification !== false ? intentRouting.classification.intent : undefined,
        })
      : undefined;
    if (isPlanMode) {
      log.debug('Entering plan mode', { sessionId: session.id, taskKind: taskAnalysis.kind, complexity: taskAnalysis.complexity });
    }
    const planPlan = isPlanMode
      ? PlanOrchestrator.prepare(taskForClassification, {
          workspaceRoot: this.deps.workspace,
          skillCatalog: this.deps.skillCatalog,
          tierPolicy,
          configuredMaxSteps: agentConfig?.maxSteps,
          planDepth: agentConfig?.planDepth,
          planAutoContinue: agentConfig?.autoContinue,
          planMaxAutoContinues: agentConfig?.maxAutoContinues,
          taskAnalysis,
          intent: intentRouting.mode === 'plan' && intentRouting.useClassification !== false ? intentRouting.classification.intent : undefined,
          runtimeContext: skillRuntimeContext,
          skillResolution: pipeline.skills,
        })
      : undefined;
    const actPlan = isAgentMode
      ? ActOrchestrator.prepare(taskForClassification, {
          workspaceRoot: this.deps.workspace,
          skillCatalog: this.deps.skillCatalog,
          tierPolicy,
          configuredMaxSteps: agentConfig?.maxSteps,
          actDepth: agentConfig?.actDepth,
          actAutoContinue: agentConfig?.autoContinue,
          actMaxAutoContinues: agentConfig?.maxAutoContinues,
          taskAnalysis,
          orchestrationEnabled,
          auditMode,
          logAuditMode,
          mdxRepairMode,
          githubIssueMode: taskEnrichment.signals.githubIssue?.fetched === true,
          hasActivePlan: Boolean(activePlanAtStart?.plan),
          savedPlanId: activePlanAtStart?.id,
          verifyCommands: agentConfig?.verifyCommands,
          intent: intentRouting.mode === 'agent' && intentRouting.useClassification !== false ? intentRouting.classification.intent : undefined,
          runtimeContext: skillRuntimeContext,
          skillResolution: pipeline.skills,
        })
      : undefined;
    const skillInjection = engineResolution && this.deps.skillInjectionBuilder && session.mode !== 'review'
      ? this.deps.skillInjectionBuilder.build({
          skillIds: engineResolution.selectedSkillIds,
          mode: session.mode,
          style: tierPolicy.skillInjection === 'quick-ref'
            ? 'quick-ref'
            : tierPolicy.skillInjection === 'full'
              ? 'full'
              : tierPolicy.skillInjection,
          maxChars: tierPolicy.maxSkillChars,
          runtimeContext: skillRuntimeContext,
        })
      : undefined;
    if (skillInjection?.context && planPlan) {
      planPlan.skillPlaybookContext = skillInjection.context;
      planPlan.appliedSkills = skillInjection.loaded.map((skill) => skill.id);
    }
    if (skillInjection?.context && actPlan) {
      actPlan.skillPlaybookContext = skillInjection.context;
      actPlan.appliedSkills = skillInjection.loaded.map((skill) => skill.id);
    }
    if (skillInjection) {
      this.deps.skillTelemetry?.recordInjection(session.mode, skillInjection);
      this.recordSkillInjectionTelemetry(
        resolvedTier,
        tierPolicy,
        engineResolution?.candidateSkills.map((candidate) => candidate.id) ?? [],
        engineResolution?.selectedSkillIds ?? [],
        skillInjection.loaded.map((skill) => skill.id),
        skillInjection.totalChars
      );
    }
    const askSkillContext = isAskMode ? skillInjection?.context : undefined;
    const scopedRoot =
      askPlan?.scope.status === 'matched'
        ? askPlan.scope.scopeRoot
        : planPlan?.scope.status === 'matched'
          ? planPlan.scope.scopeRoot
          : actPlan?.scope.status === 'matched'
            ? actPlan.scope.scopeRoot
            : undefined;

    this.setLiveStatus('Gathering context');
    this.emitActivity('context', 'Retrieving workspace context…', extractFileMentions(userMessage).join(', ') || undefined);

    const maxInputTokens = getMaxInputTokens(provider.capabilities.contextWindow);
    const explicitContextTokenBudget = Math.min(32_000, Math.floor(maxInputTokens * 0.08));
    const pinnedContext = options?.pinnedContext ?? [];
    const userMentions = extractFileMentions(userMessage);
    // Explicit user paths outrank pinned context (stale pins must not override the named target).
    const logAuditFileTarget =
      logAuditTarget && /\.(?:jsonl|json|log)$/i.test(logAuditTarget) ? logAuditTarget : undefined;
    const effectivePinnedContext =
      logAuditMode && logAuditFileTarget
        ? pinnedContext.filter((p) => {
            const pin = p.path.replace(/\\/g, '/');
            const target = logAuditFileTarget.replace(/\\/g, '/');
            return pin === target || pin.endsWith(`/${target}`) || target.endsWith(`/${pin}`);
          })
        : userMentions.length > 0
          ? pinnedContext.filter((p) =>
              userMentions.some((m) => {
                const pin = p.path.replace(/\\/g, '/');
                const mention = m.replace(/\\/g, '/');
                return pin === mention || pin.endsWith(`/${mention}`) || mention.endsWith(`/${pin}`);
              })
            )
          : pinnedContext;
    const explicitBuilder = new UserExplicitContextBuilder(this.db, ws, explicitContextTokenBudget);
    const explicitResult = explicitBuilder.build(effectivePinnedContext, {
      demote: userMentions.length > 0 || Boolean(logAuditFileTarget),
      primaryPaths: logAuditFileTarget ? [logAuditFileTarget] : userMentions,
    });
    if (explicitResult.items.length > 0) {
      this.emitActivity(
        'context',
        `User-pinned context: ${explicitResult.items.length} item(s) · ${explicitResult.totalTokens} tokens`,
        pinnedContext.map((p) => p.path).join(', ')
      );
    }
    // Explicit path blocks are appended after retrieval, so reserve those tokens before budgeting retrieved context.
    const userPathBlock = logAuditMode
      ? [
          '## User-explicit target (highest priority — overrides pinned context)',
          logAuditTarget ? `\`${logAuditTarget}\`` : 'Session logs under `.mitii/logs/`',
          buildLogAuditBootstrapBlock(logAuditTarget),
        ].join('\n')
      : userMentions.length > 0
        ? [
            '## User-explicit paths (highest priority — overrides pinned context)',
            ...userMentions.map((p) => `- \`${p}\``),
          ].join('\n')
        : '';
    const userPathTokens = Math.ceil(userPathBlock.length / 4);
    const contextBudget = calculateRetrievalContextBudget(
      maxInputTokens,
      explicitResult.totalTokens,
      userPathTokens
    );

    const retrievalText = expandContextQuery(taskEnrichment.retrievalText);
    let items;
    const retrievalKey = JSON.stringify({
      text: retrievalText,
      currentFile,
      openFiles,
      scopeRoot: scopedRoot,
      pinned: pinnedContext.map((p) => p.path),
      tier: resolvedTier,
    });
    const cacheFresh =
      this.retrievalCache &&
      this.retrievalCache.key === retrievalKey &&
      Date.now() - this.retrievalCache.at < 60_000;

    sessionTiming.start('context_retrieval');
    try {
      if (cacheFresh && this.retrievalCache) {
        items = this.retrievalCache.items;
        sessionTiming.end('context_retrieval', sessionLog, { success: true, itemCount: items.length, cached: true });
      } else {
        items = await this.retriever.retrieve({
          text: retrievalText,
          currentFile,
          openFiles,
          scopeRoot: scopedRoot,
          pinnedContext: effectivePinnedContext.map((p) => ({ path: p.path, kind: p.kind })),
          tierPolicy,
          maxItems: resolveMaxContextItems({
            contextWindow: provider.capabilities.contextWindow,
            actDepth: agentConfig?.actDepth,
            expandedQuery: retrievalText !== userMessage,
            tierPolicy,
          }),
          skipSources: logAuditMode ? [...LOG_AUDIT_SKIP_RETRIEVAL_SOURCES] : undefined,
        });
        this.retrievalCache = { key: retrievalKey, items, at: Date.now() };
        sessionTiming.end('context_retrieval', sessionLog, {
          success: true,
          itemCount: items.length,
        });
      }
    } catch (error) {
      sessionTiming.end('context_retrieval', sessionLog, { success: false });
      const msg = error instanceof Error ? error.message : String(error);
      log.error('Context retrieval failed', { error: msg });
      this.emitActivity('error', 'Context retrieval failed', msg);
      throw error;
    }

    const retrievedPaths = uniqueContextNames(items);
    this.emitActivity(
      'read',
      `Prepared ${items.length} context snippets from ${retrievedPaths.length} sources`,
      retrievedPaths.slice(0, 8).join('\n')
    );

    const hookInjection = logAuditMode
      ? undefined
      : this.deps.memoryHookService
        ? await this.deps.memoryHookService.onUserPromptSubmit(session.id, userMessage)
        : undefined;
    const passiveMemories = logAuditMode
      ? []
      : await (this.deps.passiveMemoryInjector?.inject(userMessage, session.id) ?? Promise.resolve([]));
    if (passiveMemories.length > 0) {
      items = [...items, ...passiveMemories];
      this.emitActivity('info', `Injected ${passiveMemories.length} passive memories`);
    }
    if (hookInjection) {
      items = [
        ...items,
        {
          id: 'hook-user-prompt',
          source: 'memory',
          content: hookInjection,
          score: 5,
          reason: 'UserPromptSubmit hook',
          tokenEstimate: Math.ceil(hookInjection.length / 4),
        },
      ];
      this.emitActivity('info', 'UserPromptSubmit hook injected context');
    }

    const pack = this.budgeter.budget(items, contextBudget.retrievalContextBudget);
    // Precedence: user-explicit path / mentions first, then pinned, then retrieved.
    const displayPack: ContextPack = {
      ...pack,
      items: [...explicitResult.items, ...pack.items],
      totalTokens: pack.totalTokens + explicitResult.totalTokens + userPathTokens,
      budgetLimit: contextBudget.requestedContextBudget,
      formatted: [userPathBlock, explicitResult.formatted, pack.formatted]
        .filter(Boolean)
        .join('\n\n---\n\n'),
    };
    completedContextTokens = displayPack.totalTokens;
    const views = contextItemsToViews(displayPack.items);
    const budgetView = contextPackToBudgetView(displayPack);

    this.setLiveStatus('Context ready', `${displayPack.items.length} snippets · ${displayPack.totalTokens} tokens`);

    this.onContextPack?.(displayPack, views, budgetView);

    this.emitActivity(
      'budget',
      `Prompt context: ${displayPack.totalTokens}/${pack.budgetLimit} tokens · ${displayPack.items.length} snippets`,
      pack.dropped.length > 0 ? `${pack.dropped.length} dropped` : undefined
    );
    this.deps.sessionLog?.append('info', `Context ${displayPack.totalTokens}/${pack.budgetLimit} tokens`, {
      snippetCount: displayPack.items.length,
      droppedCount: pack.dropped.length,
    });
    this.deps.sessionLog?.appendDebug('context_pack', `Context ${displayPack.totalTokens}/${pack.budgetLimit} tokens`, {
      snippetCount: displayPack.items.length,
      droppedCount: pack.dropped.length,
      sources: displayPack.items.map((i) => i.source).slice(0, 20),
      currentFile,
      openFiles: openFiles.slice(0, 10),
      pinnedContext: pinnedContext.map((p) => p.path),
    });

    const transcriptBudget = Math.floor(maxInputTokens * 0.12);
    sessionTiming.start('context_compaction');
    const compacted = await compactMessagesWithLlm(recentMessages, transcriptBudget, provider);
    sessionTiming.end('context_compaction', sessionLog, {
      before: recentMessages.length,
      after: compacted.length,
    });
    if (compacted.length < recentMessages.length) {
      this.emitActivity('info', `Compacted ${recentMessages.length - compacted.length} older messages`);
    }

    const toolsEnabled = provider.capabilities.supportsTools
      && Boolean(this.deps.toolRuntime && this.deps.toolExecutor && this.agentLoop);
    const isResume = isApprovalContinuationMessage(userMessage);
    this.deps.taskState?.setTaskContext(taskAnalysis.kind, taskAnalysis.summary, taskForClassification);
    if (!isResume) {
      this.suspendContext = undefined;
      this.agentLoop?.clearSuspendState();
    }
    const plannerEnabled = pipeline.shouldUsePlanner;
    const subagentsEnabled =
      (agentConfig?.subagentsEnabled ?? true) &&
      !auditMode &&
      !logAuditMode &&
      (isAskMode
        ? (askPlan?.route.shouldUseSubagents ?? shouldEnableAskSubagents(userMessage))
        : isPlanMode
          ? (planPlan?.route.shouldUseSubagents ?? taskAnalysis.shouldUseSubagents)
          : (actPlan?.route.shouldUseSubagents ?? taskAnalysis.shouldUseSubagents));
    let tools = toolsEnabled
      ? toolsToDefinitions(this.deps.toolRuntime!.list()).filter((tool) =>
          subagentsEnabled || !['spawn_research_agent', 'spawn_subagent'].includes(tool.function.name)
        )
      : [];
    if (logAuditMode) {
      // Log audit wins over Ask/Plan allowlists so only deterministic log analyzers are available.
      tools = filterLogAuditModeTools(tools);
    } else if (isAskMode) {
      tools = filterAskModeTools(tools);
    } else if (isPlanMode) {
      tools = filterPlanModeTools(tools);
    }
    tools = filterToolsForTier(tools, tierPolicy);

    const requiresAgentWrite = shouldRequireAgentWrite(session.mode, pipeline.route.operationClass);
    tools = filterToolsByCapabilities(tools, pipeline.capabilities);

    if (toolsEnabled && this.deps.toolExecutor) {
      setSubagentRuntime({
        toolExecutor: this.deps.toolExecutor,
        getProvider: () => this.deps.researchAgentProvider ?? provider,
        getTools: () => tools,
        maxSteps: agentConfig?.researchAgentMaxSteps,
        timeoutMs: agentConfig?.researchAgentTimeoutMs,
        enabledTypes: agentConfig?.subagentTypesEnabled,
        maxConcurrent: agentConfig?.maxConcurrentSubagents,
        workspace: this.deps.workspace,
        tierPolicy,
        skillCatalog: this.deps.skillCatalog,
      });
    } else {
      setSubagentRuntime(undefined);
    }

    if (logAuditMode) {
      this.emitActivity('info', 'Log audit mode — deterministic log analyzer', logAuditTarget);
    } else if (auditMode) {
      this.emitActivity('info', 'Audit mode — using tools to scan project');
    } else if (mdxRepairMode) {
      this.emitActivity('info', 'MDX repair mode — fix exact build failure', mdxErrorFile ?? taskAnalysis.summary);
    } else if (isResume) {
      this.emitActivity('info', 'Resuming after approval — continuing execution');
    } else if (isAskMode) {
      this.emitActivity('info', 'Ask mode — read-only exploration', taskAnalysis.summary);
    } else if (actPlan?.executionPath === 'resume_saved_plan') {
      this.emitActivity('info', 'Act handoff — executing the saved plan', actPlan.route.summary);
    } else if (plannerEnabled) {
      this.emitActivity('info', `Orchestration: ${taskAnalysis.kind} (${taskAnalysis.complexity})`, taskAnalysis.summary);
    } else if (orchestrationEnabled && taskAnalysis.shouldPlan && session.mode === 'agent') {
      this.emitActivity('info', 'Fast Agent mode — sending directly to the tool-using agent', taskAnalysis.summary);
    }
    this.deps.sessionLog?.append('info', 'Task analysis', {
      kind: taskAnalysis.kind,
      complexity: taskAnalysis.complexity,
      shouldPlan: taskAnalysis.shouldPlan,
      plannerEnabled,
      shouldUseSubagents: subagentsEnabled,
      askIntent: askPlan?.route.intent,
      askProfile: askPlan?.route.profile,
      askScope: askPlan?.scope.status,
      planIntent: planPlan?.route.intent,
      planScope: planPlan?.scope.status,
      planQualityProfile: planPlan?.route.qualityProfile,
      actIntent: actPlan?.route.intent,
      actExecutionPath: actPlan?.executionPath,
      actScope: actPlan?.scope.status,
      actSkills: actPlan?.appliedSkills,
      auditMode,
      logAuditMode,
      mdxRepairMode,
      toolsEnabled,
      requiresAgentWrite,
    });

    this.saveTurn(session.id, 'user', userMessage);

    let livePromptTokens = 0;
    let livePromptMessages: ChatMessage[] | undefined;
    let liveExplicitContextBlock = explicitResult.formatted || undefined;
    let liveActiveTools: ToolDefinition[] | undefined;
    const emitLiveTokenUsage = () => {
      const messagesForBreakdown = livePromptMessages;
      if (!messagesForBreakdown || livePromptTokens <= 0) return;
      this.onTokenUsage?.(
        livePromptTokens,
        displayPack.totalTokens,
        fullResponse,
        this.buildTokenBreakdown(messagesForBreakdown, displayPack, compacted, liveActiveTools),
        { final: false }
      );
    };
    const sharedLoopCallbacks = this.buildLoopCallbacks(emitLiveTokenUsage);
    // PipelineResolution is the canonical planner authority. Recomputing from the
    // pre-reconciliation TaskAnalysis can turn an orchestrated restoration back into
    // "none" and silently skip planning.
    const planningDepth = pipeline.internalDepth;
    const sharedPlanOptions = {
      stepMaxRetries: agentConfig?.stepMaxRetries,
      finalValidationEnabled: agentConfig?.finalValidationEnabled,
      agentMaxSteps: actPlan?.maxSteps ?? agentConfig?.maxSteps,
      restrictRunCommandToReadOnly: auditMode,
      workspace: this.deps.workspace,
      sessionLog,
      taskAnalysis,
      planningDepth,
      seedFileScope: (paths: string[]) => {
        this.deps.taskState?.mergeFileScope(paths);
      },
      getTaskState: () => this.deps.taskState,
    };
    const planningContextBlock = mergePromptContexts(
      isAgentMode && actPlan ? actPlan.promptContext : undefined,
      planPlan?.promptContext,
      ...taskEnrichment.contextBlocks
    );
    const planningRequest = planningContextBlock
      ? `${planningContextBlock}\n\n## User request\n${userMessage}`
      : userMessage;

    {
      const activePlan = activePlanAtStart ?? this.deps.planPersistence?.getActive(session.id);
      if (
        !isApprovalContinuationMessage(userMessage) &&
        actPlan?.executionPath === 'resume_saved_plan' &&
        this.planExecutor &&
        activePlan
      ) {
        const plan = activePlan.plan;
        this.onPlan?.(thunderPlanToView(plan, { status: 'running' }));
        this.setLiveStatus('Executing saved plan', plan.goal, 1, plan.steps.length);
        this.emitActivity('info', `Resuming saved plan (${plan.steps.length} steps)…`);
        sessionTiming.start('plan_execution');

        for await (const chunk of this.planExecutor.executePlan(
          session,
          provider,
          plan,
          displayPack,
          tools,
          (updated) => this.onPlan?.(thunderPlanToView(updated, { status: 'running' })),
          signal,
          sharedLoopCallbacks,
          {
            ...sharedPlanOptions,
            skillPlaybookContext: actPlan?.skillPlaybookContext,
          }
        )) {
          void chunk;
          if (signal.aborted) break;
          if (isProgressChunk(chunk)) {
            yield chunk;
            continue;
          }
          fullResponse += chunkContent(chunk);
          yield chunk;
        }
        sessionTiming.end('plan_execution', sessionLog, { resumed: true, stepCount: plan.steps.length });

        await this.finishTurn(session, provider, userMessage, fullResponse, displayPack, compacted, 0, undefined, {
          allowResponseAutoApply: false,
          auditStartIndex,
          activeTools: tools,
        });
        this.setLiveStatus(null);
        return;
      }

      if (
        shouldRunStructuredPlanner(
          plannerEnabled,
          Boolean(this.planExecutor),
          planningDepth,
          session.mode
        ) &&
        this.planExecutor
      ) {
        this.deps.sessionLog?.append('info', 'Planning depth resolved', {
          planningDepth,
          mode: session.mode,
        });
        const planningRoute = planPlan?.route ?? routePlanIntent(planningRequest, taskAnalysis);
        const suggestedPlanningSkills = planPlan?.suggestedSkills ??
          resolvePlanningSkillNames(planningRoute.intent, taskAnalysis, {
            sourceMode: session.mode === 'agent' ? 'agent' : 'plan',
          });
        const skillContext = (() => {
          const baseSkillContext = session.mode === 'agent'
            ? actPlan?.skillPlaybookContext
            : planPlan?.skillPlaybookContext;
          const baseAppliedSkills = session.mode === 'agent'
            ? (actPlan?.appliedSkills ?? [])
            : (planPlan?.appliedSkills ?? []);
          const remainingSkills = suggestedPlanningSkills.filter((skill) => !baseAppliedSkills.includes(skill));
          const loaded = remainingSkills.length > 0
            ? loadPlanningSkillPlaybooks(
                this.deps.skillCatalog,
                remainingSkills,
                {
                  style: session.mode === 'agent' && baseAppliedSkills.length > 0
                    ? 'quick-ref'
                    : tierPolicy.skillInjection,
                  maxChars: tierPolicy.maxSkillChars,
                  runtimeContext: skillRuntimeContext,
                }
              )
            : { context: '', loaded: [] };
          return {
            skillPlaybookContext: mergePromptContexts(baseSkillContext, loaded.context) ?? '',
            appliedSkills: [...new Set([...baseAppliedSkills, ...loaded.loaded])],
          };
        })();

        const planningSkillOptions = {
          skillPlaybookContext: skillContext.skillPlaybookContext,
        };
        this.recordSkillInjectionTelemetry(
          resolvedTier,
          tierPolicy,
          suggestedPlanningSkills,
          [...new Set([...pipeline.skills.injectSkills, ...skillContext.appliedSkills])],
          skillContext.appliedSkills,
          skillContext.skillPlaybookContext.length
        );

        let requirementAnalysisText = '';
        let planningDiscovery = '';

        this.onPlan?.({
          goal: cleanPlanGoalForDisplay(taskForClassification, taskForClassification),
          assumptions: [],
          steps: [],
          status: 'planning',
          appliedSkills: skillContext.appliedSkills,
        });

        if (toolsEnabled) {
          this.setLiveStatus('Planning discovery');
          this.emitActivity('info', 'Running read-only planning discovery…');
          if (skillContext.appliedSkills.length > 0) {
            this.emitActivity(
              'info',
              `Loaded planning skills: ${skillContext.appliedSkills.join(', ')}`
            );
          }
          sessionTiming.start('planning_discovery');
          try {
            planningDiscovery = await this.planExecutor.runPlanningDiscovery(
              provider,
              session.mode,
              displayPack,
              planningRequest,
              taskAnalysis,
              tools,
              signal,
              sharedLoopCallbacks,
              {
                agentMaxSteps: planPlan?.discoveryMaxSteps ??
                  actPlan?.maxSteps ??
                  (auditMode ? Math.min(agentConfig?.maxSteps ?? 10, 12) : Math.min(agentConfig?.maxSteps ?? 6, 8)),
                restrictRunCommandToReadOnly: true,
                planAutoContinue: planPlan?.autoContinue ?? actPlan?.autoContinue ?? agentConfig?.autoContinue,
                planMaxAutoContinues: planPlan?.maxAutoContinues ??
                  actPlan?.maxAutoContinues ??
                  agentConfig?.maxAutoContinues,
                ...planningSkillOptions,
              }
            );
            if (planningDiscovery) {
              this.emitActivity('info', 'Planning discovery complete', planningDiscovery.slice(0, 500));
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.emitActivity('error', 'Planning discovery failed; continuing with retrieved context', msg);
          } finally {
            sessionTiming.end('planning_discovery', sessionLog, {
              hasOutput: Boolean(planningDiscovery),
            });
          }
        } else {
          this.emitActivity(
            'error',
            'Planning discovery skipped — current model/provider does not support tools',
            'Use a tool-capable model: qwen3-coder via OpenAI-compatible (Ollama), or deepseek-chat via DeepSeek API. Do not pair DeepSeek provider with local Ollama model names.'
          );
        }

        if (session.mode === 'plan' && this.agentLoop?.hadPendingApproval()) {
          log.debug('Plan paused for clarification', { sessionId: session.id });
          this.suspendContext = {
            session,
            provider,
            userMessage: taskForClassification,
            auditMode,
            agentMaxSteps: agentConfig?.maxSteps,
            autoContinue: agentConfig?.autoContinue,
            maxAutoContinues: agentConfig?.maxAutoContinues,
            planningResume: {
              displayPack,
              planningRequest,
              taskAnalysis,
              initialPlanningDiscovery: planningDiscovery,
              skillPlaybookContext: skillContext.skillPlaybookContext,
              appliedSkills: skillContext.appliedSkills,
            },
          };
          const questionNote =
            '\n\n**Planning paused for a clarification.** Choose an option in the question panel below, and I will resume discovery and compile the plan from that answer.\n';
          fullResponse += questionNote;
          yield questionNote;
          this.setLiveStatus('Waiting for planning answer', 'Choose an option below');
          this.emitActivity('approval', 'Planning paused for a clarifying question');
          await this.finishTurn(session, provider, userMessage, fullResponse, displayPack, compacted, 0, undefined, {
            allowResponseAutoApply: false,
            auditStartIndex,
            activeTools: tools,
          });
          preserveLiveStatus = true;
          return;
        }

        this.setLiveStatus('Analyzing requirements');
        this.emitActivity('info', 'Analyzing requirements…');
        sessionTiming.start('requirement_analysis');

        for await (const chunk of this.planExecutor.analyzeRequirementsStream(
          provider,
          displayPack,
          planningRequest,
          taskAnalysis,
          skillContext.skillPlaybookContext,
          (text) => {
            requirementAnalysisText = text;
            if (session.mode === 'plan') {
              this.onPlan?.({
                goal: cleanPlanGoalForDisplay(taskForClassification, taskForClassification),
                assumptions: [],
                steps: [],
                status: 'planning',
                requirementAnalysis: text,
                appliedSkills: skillContext.appliedSkills,
              });
            }
          }
        )) {
          void chunk;
          if (signal.aborted) break;
          // Requirement analysis is planner-internal context. Persisting/streaming it
          // as the answer pollutes Agent-mode output with stale goals and draft prose.
        }
        sessionTiming.end('requirement_analysis', sessionLog);

        this.setLiveStatus('Creating plan');
        this.emitActivity('info', 'Planning multi-step task…');
        sessionTiming.start('plan_generation');

        const requirementAnalysis =
          requirementAnalysisText.trim() || extractRequirementAnalysis(fullResponse);

        let planQualityIssues: string[] = [];
        const plan = await this.planExecutor.generatePlan(
          provider,
          session.mode,
          displayPack,
          planningRequest,
          requirementAnalysis,
          planningDiscovery,
          taskAnalysis,
          session.id,
          {
            workspace: this.deps.workspace,
            useIsolatedPlanning: true,
            planningDepth,
            ...planningSkillOptions,
            onPlanQualityIssues: (issues) => {
              planQualityIssues = issues;
            },
          }
        );
        sessionTiming.end('plan_generation', sessionLog, {
          success: Boolean(plan),
          stepCount: plan?.steps.length ?? 0,
        });
        if (plan && plan.steps.length >= 1) {
          plan.goal = cleanPlanGoalForDisplay(plan.goal, taskForClassification);
          const planView = thunderPlanToView(plan, {
            status: session.mode === 'plan' ? 'ready' : 'running',
            requirementAnalysis: requirementAnalysis || undefined,
            appliedSkills: skillContext.appliedSkills,
          });
          this.onPlan?.(planView);
          this.deps.planPersistence?.save(session.id, plan);
          this.deps.sessionLog?.append('plan_created', plan.goal, {
            stepCount: plan.steps.length,
            steps: plan.steps.map((s) => ({ id: s.id, title: s.title, risk: s.risk, phase: s.phase })),
            appliedSkills: skillContext.appliedSkills,
          });
          log.info('Plan ready', {
            sessionId: session.id,
            mode: session.mode,
            goal: plan.goal,
            steps: plan.steps.length,
            qualityIssues: planQualityIssues,
          });

          if (session.mode === 'agent') {
            this.setLiveStatus('Executing plan', plan.goal, 1, plan.steps.length);
            this.emitActivity('info', `Executing ${plan.steps.length} steps…`);
            const planHeader = formatPlanHeader(plan);
            fullResponse += planHeader;
            yield planHeader;
            sessionTiming.start('plan_execution');

            for await (const chunk of this.planExecutor.executePlan(
              session,
              provider,
              plan,
              displayPack,
              tools,
              (updated) => {
                this.onPlan?.(
                  thunderPlanToView(updated, {
                    status: 'running',
                    requirementAnalysis: requirementAnalysis || undefined,
                    appliedSkills: skillContext.appliedSkills,
                  })
                );
                const running = updated.steps.findIndex((s) => s.status === 'running');
                const idx = running >= 0 ? running : updated.steps.filter((s) => s.status === 'done').length;
                const step = updated.steps[idx];
                if (step) {
                  this.setLiveStatus('Running step', step.title, idx + 1, updated.steps.length);
                }
              },
              signal,
              sharedLoopCallbacks,
              {
                ...sharedPlanOptions,
                ...planningSkillOptions,
              }
            )) {
              if (signal.aborted) break;
              if (isProgressChunk(chunk)) {
                yield chunk;
                continue;
              }
              fullResponse += chunkContent(chunk);
              yield chunk;
            }
            sessionTiming.end('plan_execution', sessionLog, {
              stepCount: plan.steps.length,
            });

            const pausedForApproval =
              this.agentLoop?.hadPendingApproval() ||
              plan.steps.some((s) => s.status === 'blocked');
            if (pausedForApproval) {
              this.suspendContext = {
                session,
                provider,
                userMessage: taskForClassification,
                auditMode,
                agentMaxSteps: agentConfig?.maxSteps,
                autoContinue: agentConfig?.autoContinue,
                maxAutoContinues: agentConfig?.maxAutoContinues,
                planResume: {
                  plan,
                  displayPack,
                  tools,
                  requirementAnalysis: requirementAnalysis || undefined,
                  appliedSkills: skillContext.appliedSkills,
                  skillPlaybookContext: skillContext.skillPlaybookContext,
                },
              };
              const pauseBlock = this.savePauseState(session, taskForClassification, taskAnalysis.kind);
              const approvalNote =
                `\n\n${pauseBlock}\n\n⏸ **Waiting for your approval** — review the proposed changes above, then approve or deny in the panel below.\n`;
              fullResponse += approvalNote;
              yield approvalNote;
              this.setLiveStatus('Waiting for approval', 'Review and approve below');
              this.emitActivity('approval', 'Paused — waiting for your approval', this.deps.taskState?.getPauseSummary());
              await this.finishTurn(session, provider, userMessage, fullResponse, displayPack, compacted, 0, undefined, {
                allowResponseAutoApply: false,
                auditStartIndex,
                activeTools: tools,
              });
              preserveLiveStatus = true;
              return;
            }
          } else {
            const planText = formatPlanModeChatSummary(planView);
            fullResponse = planText;
            yield planText;
            this.emitActivity('info', 'Plan ready — switch to Agent mode to execute steps');
          }

          await this.finishTurn(session, provider, userMessage, fullResponse, displayPack, compacted, 0, undefined, {
            allowResponseAutoApply: false,
            auditStartIndex,
            activeTools: tools,
          });
          this.setLiveStatus(null);
          return;
        }

        if (session.mode === 'plan') {
          log.warn('Plan mode failed to produce a plan', { sessionId: session.id, issues: planQualityIssues });
          const failureText =
            '\n\n⚠️ I could not produce a plan that passed the planning quality gate. Please retry with a little more scope detail.\n';
          fullResponse += failureText;
          yield failureText;
          this.emitActivity('error', 'Planning failed quality gate', planQualityIssues.join('; '));
          await this.finishTurn(session, provider, userMessage, fullResponse, displayPack, compacted, 0, undefined, {
            allowResponseAutoApply: false,
            auditStartIndex,
            activeTools: tools,
          });
          this.setLiveStatus(null);
          return;
        }

        const fallbackText =
          '\n\n⚠️ Structured planning did not pass the quality gate. Continuing with direct Agent execution instead.\n';
        fullResponse += fallbackText;
        yield fallbackText;
        this.emitActivity('info', 'Planning failed — falling back to direct execution', planQualityIssues.join('; '));
        this.deps.sessionLog?.append('error', 'Planning failed quality gate', {
          issues: planQualityIssues,
          fallback: 'direct_agent',
        });
      }

      const isResume = isApprovalContinuationMessage(userMessage);
      const taskStateBlock = this.deps.taskState?.buildPromptBlock();
      if (!this.skillInjectionTelemetry && (planPlan || actPlan)) {
        const directSkillContext = planPlan ?? actPlan;
        this.recordSkillInjectionTelemetry(
          resolvedTier,
          tierPolicy,
          directSkillContext?.suggestedSkills ?? [],
          pipeline.skills.injectSkills,
          directSkillContext?.appliedSkills ?? [],
          directSkillContext?.skillPlaybookContext.length ?? 0
        );
      }
      const cleanupAuditMode =
        auditMode &&
        (!pipeline.route.auditSubtype ||
          pipeline.route.auditSubtype === 'unused_deps' ||
          pipeline.route.auditSubtype === 'dead_code' ||
          pipeline.route.auditSubtype === 'vulnerability' ||
          pipeline.route.auditSubtype === 'generic');
      const docsSiteMode =
        (planPlan?.route.intent === 'docs' || actPlan?.route.intent === 'docs') &&
        pipeline.route.docsSubtype !== 'readme';
      const messages = attachImagesToLastUser(buildPrompt(
        session.mode,
        displayPack,
        userMessage,
        compacted,
        toolsEnabled,
        cleanupAuditMode,
        mdxRepairMode,
        mdxErrorFile,
        taskStateBlock,
        isResume,
        undefined,
        mergePromptContexts(
          askPlan?.promptContext,
          planPlan?.promptContext,
          actPlan?.promptContext,
          buildRoutePolicyText(pipeline.route),
          ...taskEnrichment.contextBlocks
        ),
        mergePromptContexts(
          askSkillContext,
          planPlan?.skillPlaybookContext,
          actPlan?.skillPlaybookContext
        ),
        {
          docsMode: docsSiteMode,
          mdxRepairMode,
          askProfile: askPlan?.route.profile,
          allowedToolNames: tools.map((tool) => tool.function.name),
        }
      ), options?.attachments);
      const promptSections = describePromptSections(
        collectSystemPromptSections(session.mode, toolsEnabled, {
          auditMode: cleanupAuditMode,
          docsMode: docsSiteMode,
          mdxRepairMode,
          isContinuation: isResume,
          askProfile: askPlan?.route.profile,
          allowedToolNames: tools.map((tool) => tool.function.name),
        })
      );
      this.deps.sessionLog?.append('info', 'Prompt sections', {
        sections: promptSections,
        planningDepth,
        skillChars:
          (askSkillContext?.length ?? 0) +
          (planPlan?.skillPlaybookContext.length ?? 0) +
          (actPlan?.skillPlaybookContext.length ?? 0),
      });
      const promptTokens = estimateChatRequestTokens({
        messages,
        tools: tools.length > 0 ? tools : undefined,
      });
      livePromptTokens = promptTokens;
      livePromptMessages = messages;
      liveExplicitContextBlock = explicitResult.formatted || undefined;
      liveActiveTools = tools;
      emitLiveTokenUsage();

      if (toolsEnabled && this.agentLoop) {
        const directAgentTools = tools;
        this.setLiveStatus(isAskMode ? 'Answering' : 'Agent running');
        this.emitActivity(
          'info',
          isAskMode
            ? 'Exploring codebase (read-only)…'
            : logAuditMode
              ? 'Analyzing log deterministically…'
              : auditMode
                ? 'Scanning project with tools…'
                : 'Agent loop started'
        );
        sessionTiming.start('direct_agent');

        for await (const chunk of this.agentLoop.run(
          provider,
          messages,
          directAgentTools,
          signal,
          sharedLoopCallbacks,
          {
            auditMode,
            logAuditMode,
            askMode: isAskMode,
            planMode: isPlanMode,
            requiresAskGrounding: isAskMode && needsAskGrounding(userMessage),
            requiresPlanGrounding: isPlanMode && needsPlanGrounding(taskForClassification),
            maxSteps: resolveLoopMaxSteps({
              isAskMode,
              isPlanMode,
              auditMode,
              logAuditMode,
              askSteps: askPlan?.maxSteps ?? agentConfig?.askMaxSteps,
              planSteps: planPlan?.discoveryMaxSteps ?? (
                agentConfig?.maxSteps ? scaleTierSteps(agentConfig.maxSteps, tierPolicy, 50) : undefined
              ),
              actSteps: actPlan?.maxSteps ?? (
                agentConfig?.maxSteps ? scaleTierSteps(agentConfig.maxSteps, tierPolicy, 100) : undefined
              ),
              tierPolicy,
            }),
            autoContinue: isAskMode
              ? (askPlan?.autoContinue ?? true)
              : isPlanMode
                ? (planPlan?.autoContinue ?? agentConfig?.autoContinue ?? true)
                : logAuditMode
                  ? false
                  : (actPlan?.autoContinue ?? agentConfig?.autoContinue ?? true),
            maxAutoContinues: isAskMode
              ? (askPlan?.maxAutoContinues ?? 1)
              : isPlanMode
                ? (planPlan?.maxAutoContinues ?? agentConfig?.maxAutoContinues)
                : logAuditMode
                  ? 0
                  : (actPlan?.maxAutoContinues ?? agentConfig?.maxAutoContinues),
            requiresWrite: requiresAgentWrite,
            requiredOperation: toRequiredLoopOperation(pipeline.route.operationClass),
            reasoningEffort: tierPolicy.reasoningEffort,
            getTaskState: () => this.deps.taskState,
          }
        )) {
          if (signal.aborted) break;
          if (isProgressChunk(chunk)) {
            const progress = chunkContent(chunk).trim();
            if (progress) {
              this.emitActivity('info', progress.slice(0, 160));
            }
            // Stream to UI for live status, but do not persist into the final answer.
            yield chunk;
            continue;
          }
          fullResponse += chunkContent(chunk);
          emitLiveTokenUsage();
          yield chunk;
        }
        sessionTiming.end('direct_agent', sessionLog, {
          auditMode,
          pendingApproval: this.agentLoop.hadPendingApproval(),
        });

        if (this.agentLoop.hadPendingApproval()) {
          this.suspendContext = {
            session,
            provider,
            userMessage: taskForClassification,
            auditMode,
            agentMaxSteps: agentConfig?.maxSteps,
            autoContinue: agentConfig?.autoContinue,
            maxAutoContinues: agentConfig?.maxAutoContinues,
          };
          const pauseBlock = this.savePauseState(session, taskForClassification, taskAnalysis.kind);
          const approvalNote =
            `\n\n${pauseBlock}\n\n⏸ **Waiting for your approval** — review the proposed changes above, then approve or deny in the panel below.\n`;
          fullResponse += approvalNote;
          yield approvalNote;
          this.setLiveStatus('Waiting for approval', 'Review and approve below');
          this.emitActivity('approval', 'Paused — waiting for your approval', this.deps.taskState?.getPauseSummary());
          preserveLiveStatus = true;
        } else if (!this.agentLoop.hadPendingApproval() && !signal.aborted) {
          const directTouchedFiles = getTouchedFilesFromAudit(this.deps.toolRuntime, auditStartIndex);
          const directWorkspaceMutation = hasWorkspaceMutationFromAudit(
            this.deps.toolRuntime,
            auditStartIndex
          );
          if (requiresAgentWrite && !directWorkspaceMutation) {
            const noWriteBlock =
              '\n\nStopped because the model did not change any files for this Agent-mode edit task. No files were changed.\n';
            fullResponse += noWriteBlock;
            yield noWriteBlock;
            this.emitActivity('error', 'Agent stopped without edits', taskAnalysis.summary);
          }
          if (
            session.mode === 'agent' &&
            agentConfig?.verifyOnActComplete &&
            directTouchedFiles.length > 0
          ) {
            this.setLiveStatus('Running verify hooks');
            this.emitActivity('info', 'Discovering and running project verification…');
            const verifyCommands = mdxRepairMode
              ? suggestDocsVerifyCommands()
              : (agentConfig.verifyCommands ?? []);
            const verifyOutput = await this.deps.runVerifyHooks?.(
              verifyCommands,
              taskForClassification,
              directTouchedFiles
            );
            if (verifyOutput?.trim()) {
              const block = `\n\n### Verify\n\n${verifyOutput}\n`;
              fullResponse += block;
              yield block;
            }
          }
          if (
            orchestrationEnabled &&
            taskAnalysis.shouldVerify &&
            session.mode === 'agent' &&
            this.planExecutor &&
            directTouchedFiles.length > 0 &&
            shouldRunDirectFinalValidation(taskAnalysis.kind, directTouchedFiles)
          ) {
            this.setLiveStatus('Final validation');
            this.emitActivity('info', 'Running post-task validation…');
            yield '\n\n### Post-task validation\n\n';

            const validationPlan = {
              goal: userMessage.slice(0, 200),
              assumptions: [] as string[],
              steps: [] as import('../../../features/ce/plans/PlanActEngine').ThunderPlan['steps'],
              requiredApprovals: [] as string[],
            };

            for await (const chunk of this.planExecutor.runFinalValidation(
              session,
              provider,
              validationPlan,
              displayPack,
              directAgentTools,
              signal,
              sharedLoopCallbacks,
              {
                agentMaxSteps: Math.min(agentConfig?.maxSteps ?? 10, 10),
                restrictRunCommandToReadOnly: auditMode,
                touchedFiles: directTouchedFiles,
              }
            )) {
              if (signal.aborted) break;
              if (isProgressChunk(chunk)) {
                yield chunk;
                continue;
              }
              fullResponse += chunkContent(chunk);
              emitLiveTokenUsage();
              yield chunk;
            }
          }
        }
      } else {
        this.setLiveStatus('Generating response');
        this.emitActivity('info', 'Streaming response…');
        for await (const delta of provider.complete({
          messages,
          stream: true,
          reasoningEffort: tierPolicy.reasoningEffort,
        })) {
          if (signal.aborted) break;
          if (delta.content) {
            fullResponse += delta.content;
            emitLiveTokenUsage();
          }
          const chunk = toAssistantStreamChunk(delta.content, delta.reasoning);
          if (chunk) yield chunk;
          if (delta.error) throw new Error(delta.error);
        }
      }

      const normalizedResponse = normalizeAssistantResponse(fullResponse);
      if (normalizedResponse.wasEmpty) {
        fullResponse = normalizedResponse.content;
        this.emitEmptyResponse(provider.id);
        yield fullResponse;
      }

      await this.finishTurn(
        session,
        provider,
        userMessage,
        fullResponse,
        displayPack,
        compacted,
        promptTokens,
        messages,
        {
          allowResponseAutoApply: !toolsEnabled && isWriteAllowed(session.mode),
          auditStartIndex,
          activeTools: tools,
          explicitContextBlock: liveExplicitContextBlock,
        }
      );
    }
    } finally {
      this.useSkillInvocationsThisTurn = 0;
      this.skillInjectionTelemetry = undefined;
      sessionTiming.end('turn_total', sessionLog, {
        mode: session.mode,
        responseLength: fullResponse.length,
      });
      log.info('Chat completed', { sessionId: session.id, tokens: completedContextTokens });
      if (!preserveLiveStatus) {
        this.setLiveStatus(null);
      }
    }
  }

  private async finishTurn(
    session: ThunderSession,
    provider: LlmProvider,
    userMessage: string,
    fullResponse: string,
    pack: ContextPack,
    compacted: ChatMessage[],
    promptTokens = 0,
    promptMessages?: ChatMessage[],
    options?: FinishTurnOptions
  ): Promise<void> {
    const usageMessages =
      promptMessages ??
      buildPrompt(session.mode, pack, userMessage, compacted, false, false, false, undefined, undefined, false, options?.explicitContextBlock);
    const tokens = promptTokens || estimateChatRequestTokens({ messages: usageMessages });
    this.emitTurnTokenUsage(tokens, pack, fullResponse, usageMessages, compacted, options?.activeTools);

    const normalizedResponse = normalizeAssistantResponse(fullResponse);
    fullResponse = normalizedResponse.content;
    if (normalizedResponse.wasEmpty) {
      this.emitEmptyResponse(provider.id);
    }

    this.saveTurn(session.id, 'assistant', fullResponse);
    this.deps.sessionLog?.append('assistant_message', fullResponse, {
      responseLength: fullResponse.length,
      preview: fullResponse.slice(0, 200),
    });

    const parsed = session.mode === 'plan' ? parsePlanFromText(fullResponse) : null;
    if (parsed) {
      this.onPlan?.(thunderPlanToView(parsed, { status: 'ready' }));
      this.deps.planPersistence?.save(session.id, parsed);
      this.deps.sessionLog?.append('plan_created', parsed.goal, {
        stepCount: parsed.steps.length,
        steps: parsed.steps.map((s) => ({ id: s.id, title: s.title, risk: s.risk })),
      });
    }

    if (options?.allowResponseAutoApply === true && isWriteAllowed(session.mode)) {
      const applyResults = await this.autoApply.applyFromResponse(fullResponse, userMessage);
      for (const result of applyResults) {
        this.emitActivity(
          result.pendingApproval ? 'approval' : result.success ? 'apply' : 'error',
          result.message,
          result.path
        );
      }
    }

    if (this.deps.memoryExtractor && this.deps.memoryConfig?.enabled) {
      const audit = (this.deps.toolRuntime?.getAuditLog() ?? []).slice(options?.auditStartIndex ?? 0);
      this.deps.memoryExtractor.extractAfterTask(
        session.id,
        userMessage,
        fullResponse,
        audit,
        this.deps.memoryConfig.summarizeAfterTask ? provider : undefined
      );
    }

    this.deps.skillTelemetry?.recordOutcome(
      this.skillInjectionTelemetry?.loaded ?? [],
      !normalizedResponse.wasEmpty && !/\b(?:failed|error)\b/i.test(fullResponse.slice(0, 240))
    );
    this.flushSkillInjectionTelemetry(provider);
  }

  private recordSkillInjectionTelemetry(
    tier: AgenticTier,
    tierPolicy: TierPolicy,
    suggested: string[],
    selected: string[],
    loaded: string[],
    injectedChars: number
  ): void {
    const loadedSet = new Set(loaded);
    this.skillInjectionTelemetry = {
      tier,
      style: tierPolicy.skillInjection,
      suggested,
      selected,
      loaded,
      rejected: selected
        .filter((name) => !loadedSet.has(name))
        .map((name) => ({
          name,
          reason: tierPolicy.skillInjection === 'none' || tierPolicy.skillInjection === 'catalog'
            ? `injection style ${tierPolicy.skillInjection}`
            : 'skill missing or over injection budget',
        })),
      injectedChars,
    };
  }

  private flushSkillInjectionTelemetry(provider: LlmProvider): void {
    if (!this.skillInjectionTelemetry) return;
    this.deps.sessionLog?.append('info', 'Skill injection summary', {
      tier: this.skillInjectionTelemetry.tier ?? provider.capabilities.agenticTier,
      style: this.skillInjectionTelemetry.style,
      suggested: this.skillInjectionTelemetry.suggested,
      selected: this.skillInjectionTelemetry.selected,
      loaded: this.skillInjectionTelemetry.loaded,
      rejected: this.skillInjectionTelemetry.rejected,
      injectedChars: this.skillInjectionTelemetry.injectedChars,
      useSkillCount: this.useSkillInvocationsThisTurn,
    });
    this.skillInjectionTelemetry = undefined;
  }

  private emitTurnTokenUsage(
    tokens: number,
    pack: ContextPack,
    fullResponse: string,
    usageMessages: ChatMessage[],
    compacted: ChatMessage[],
    activeTools?: ToolDefinition[]
  ): void {
    this.onTokenUsage?.(
      tokens,
      pack.totalTokens,
      fullResponse,
      this.buildTokenBreakdown(usageMessages, pack, compacted, activeTools),
      { final: true }
    );
    this.deps.sessionLog?.appendDebug('token_usage', 'Prompt assembly token estimate', {
      promptAssemblyTokens: tokens,
      retrievedContextTokens: pack.totalTokens,
      responseEstimateTokens: Math.ceil(fullResponse.length / 4),
    });
  }

  private buildTokenBreakdown(
    messages: ChatMessage[],
    pack: ContextPack,
    compacted: ChatMessage[],
    activeTools?: ToolDefinition[]
  ): TokenUsageBreakdownItem[] {
    const systemPrompt = messages.find((m) => m.role === 'system')?.content ?? '';
    const allTools = activeTools ?? toolsToDefinitions(this.deps.toolRuntime?.list() ?? []);
    const builtinDefs = JSON.stringify(allTools.filter((t) => !t.function.name.startsWith('mcp__')));
    const mcpByServer = new Map<string, ToolDefinition[]>();
    for (const tool of allTools) {
      const toolName = tool.function.name;
      if (!toolName.startsWith('mcp__')) continue;
      const server = toolName.split('__')[1] ?? 'mcp';
      const list = mcpByServer.get(server) ?? [];
      list.push(tool);
      mcpByServer.set(server, list);
    }
    const sourceTokens = (sources: string[]) =>
      pack.items
        .filter((item) => sources.includes(item.source))
        .reduce((sum, item) => sum + item.tokenEstimate, 0);
    const fileContext = pack.items
      .filter((item) => !['project-rules', 'skills', 'memory', 'user-explicit'].includes(item.source))
      .reduce((sum, item) => sum + item.tokenEstimate, 0);
    const explicitContext = pack.items
      .filter((item) => item.source === 'user-explicit')
      .reduce((sum, item) => sum + item.tokenEstimate, 0);
    const conversation = estimatePromptTokens(compacted);

    const items: TokenUsageBreakdownItem[] = [
      { label: 'System prompt', tokens: Math.ceil(systemPrompt.length / 4), color: '#8b949e' },
      { label: 'Builtin tools', tokens: Math.ceil(builtinDefs.length / 4), color: '#a78bfa' },
      { label: 'Rules', tokens: sourceTokens(['project-rules']), color: '#4ade80' },
      { label: 'Skills', tokens: sourceTokens(['skills']), color: '#fbbf24' },
      { label: 'Memory', tokens: sourceTokens(['memory']), color: '#60a5fa' },
      { label: 'Pinned context', tokens: explicitContext, color: '#f472b6' },
      { label: 'Workspace context', tokens: fileContext, color: '#94a3b8' },
      { label: 'Conversation', tokens: conversation, color: '#64748b' },
    ];

    for (const [server, tools] of mcpByServer) {
      const defs = JSON.stringify(tools);
      items.push({
        label: `MCP: ${server}`,
        tokens: Math.ceil(defs.length / 4),
        color: '#c084fc',
      });
    }

    return items.filter((item) => item.tokens > 0);
  }

  private savePauseState(
    session: ThunderSession,
    originalTask: string,
    taskKind?: string
  ): string {
    const summary = this.deps.taskState?.buildPauseSummary(originalTask, taskKind) ?? '';
    if (summary) {
      this.deps.taskState?.setPauseSummary(summary);
      this.deps.memoryService?.write(session.id, 'decision', summary, undefined, ['task_state', 'approval_pause']);
      this.emitActivity('info', 'Task state saved before approval pause', summary.slice(0, 300));
    }
    return summary ? `### Task state saved\n\n${summary}` : '';
  }

  private buildLoopCallbacks(onProgress?: () => void): import('../../../features/ce/runtime/AgentLoop').AgentLoopCallbacks {
    const lastToolInputs = new Map<string, Record<string, unknown>>();
    const sessionLog = this.deps.sessionLog;
    return {
      onToolStart: (name, input) => {
        if (name === 'use_skill') this.useSkillInvocationsThisTurn += 1;
        lastToolInputs.set(name, input);
        const activity = describeToolActivity(name, input, 'start');
        this.setLiveStatus(activity.liveLabel, activity.detail);
        this.emitActivity(activity.kind, activity.message, activity.detail);
      },
      onToolEnd: (name, success, output) => {
        if (output === 'Awaiting approval') {
          this.setLiveStatus('Waiting for approval', name);
          this.emitActivity(
            'approval',
            `Waiting for approval: ${describeToolActivity(name, {}, 'start').message}`
          );
          return;
        }
        if (!success && isSkippedToolOutput(output)) {
          this.setLiveStatus(describeSkipLabel(output), toolDisplayName(name));
          this.emitActivity('skipped', `${toolDisplayName(name)} skipped`, output?.slice(0, 240));
          return;
        }
        if (success && isSkippedToolOutput(output)) {
          this.setLiveStatus(describeSkipLabel(output), toolDisplayName(name));
          this.emitActivity('skipped', `${toolDisplayName(name)} skipped`, output?.slice(0, 240));
          return;
        }
        if (success) {
          const input = lastToolInputs.get(name);
          if (input) void this.previewDiffIfWrite(name, input);
        }
        const activity = describeToolActivity(name, {}, success ? 'success' : 'error');
        this.emitActivity(success ? activity.kind : 'error', activity.message, output?.slice(0, 240));
      },
      onStep: (step, max) => {
        this.setLiveStatus('Agent step', `${step}/${max}`, step, max);
        onProgress?.();
      },
      onLlmStepComplete: (step, durationMs, toolCallCount) => {
        sessionLog?.appendTiming('llm_step', durationMs, { step, toolCallCount });
        sessionLog?.appendDebug('info', 'LLM step complete', { step, durationMs, toolCallCount });
      },
      onResponseCandidate: (candidate) => {
        sessionLog?.appendDebug('llm_response_candidate', 'LLM response candidate', candidate);
        if (candidate.rejectionReason?.endsWith('_missing_after_retry')) {
          this.emitActivity('error', 'Required task side effect was not completed', candidate.rejectionReason);
        }
      },
      onAutoContinue: (round) => {
        this.emitActivity('info', `Auto-continuing agent loop (round ${round})`);
        this.setLiveStatus('Auto-continuing', `Round ${round}`);
      },
      onPostWriteValidation: async (relPath) => {
        if (!this.deps.postEditValidator) return undefined;
        const result = await this.deps.postEditValidator.validate(relPath);
        const formatted = this.deps.postEditValidator.formatForAgent(result);
        if (result.errors.length > 0) {
          this.emitActivity('error', `Lint errors in ${relPath}`, formatted);
          await this.deps.onPostWrite?.(relPath);
        } else {
          this.emitActivity('info', `Validated ${relPath}`, 'No errors');
        }
        return { message: formatted, hasErrors: result.errors.length > 0 };
      },
    };
  }

  private async previewDiffIfWrite(name: string, input: Record<string, unknown>): Promise<void> {
    const diffPreview = this.deps.diffPreview;
    if (!diffPreview) return;
    if (!this.deps.workspace) return;
    if (!(this.deps.agentConfig?.showDiffPreview ?? false)) return;

    if (name === 'write_file' && typeof input.path === 'string' && typeof input.content === 'string') {
      try {
        await diffPreview.previewWrite(input.path, input.content);
      } catch {
        // Non-fatal
      }
    }
    if (name === 'apply_patch' && typeof input.path === 'string' && typeof input.oldText === 'string' && typeof input.newText === 'string') {
      try {
        await diffPreview.previewPatch(input.path, input.oldText, input.newText);
      } catch {
        // Non-fatal
      }
    }
  }

  hasSuspendState(): boolean {
    return Boolean(
      this.suspendContext &&
        (this.agentLoop?.getSuspendState() || this.suspendContext.planResume || this.suspendContext.planningResume)
    );
  }

  getRoutingClarificationState(sessionId: string): RoutingClarificationState | undefined {
    const state = this.routingClarifications.get(sessionId);
    return state
      ? {
          ...state,
          candidateIntents: [...state.candidateIntents],
        }
      : undefined;
  }

  clearRoutingState(): void {
    this.suspendContext = undefined;
    this.routingClarifications.clear();
    this.agentLoop?.clearSuspendState();
  }

  async *resumeAfterApproval(approved: ApprovedToolResult[]): AsyncIterable<AssistantStreamChunk> {
    if (!this.suspendContext || approved.length === 0) return;

    const { session, provider, userMessage } = this.suspendContext;
    const taskStateBlock = this.deps.taskState?.buildPromptBlock();
    const planningResume = this.suspendContext.planningResume;
    const planResume = this.suspendContext.planResume;
    const anyDenied = approved.some((result) => !result.success);
    const anyApproved = approved.some((result) => result.success);

    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    this.setLiveStatus(
      anyDenied && !anyApproved ? 'Resuming after denial' : 'Resuming agent',
      anyDenied && !anyApproved ? 'Continuing without denied tool' : 'Continuing after approval'
    );
    this.emitActivity(
      'info',
      anyDenied && !anyApproved
        ? 'Resuming after denial'
        : 'Resuming agent loop after approval'
    );

    let fullResponse = '';
    const sharedLoopCallbacks = this.buildLoopCallbacks();
    const baseState = this.agentLoop?.getSuspendState();

    try {
      // Structured plans: reopen the blocked step and continue the DAG.
      // Approved tools were already applied in resolveApproval; denied tools must not be retried.
      if (planResume && this.planExecutor && session.mode === 'agent' && !planningResume) {
        const plan = planResume.plan;
        for (let i = 0; i < plan.steps.length; i++) {
          if (plan.steps[i].status === 'blocked') {
            plan.steps[i] = { ...plan.steps[i], status: 'pending' };
          }
        }
        this.deps.planPersistence?.updatePlan(session.id, plan, 'running');
        this.onPlan?.(
          thunderPlanToView(plan, {
            status: 'running',
            requirementAnalysis: planResume.requirementAnalysis,
            appliedSkills: planResume.appliedSkills,
          })
        );

        const decisionNote = anyDenied && !anyApproved
          ? '\n\nDenied tool(s) will not be retried. Continuing remaining plan steps…\n\n'
          : '\n\nApproval recorded. Continuing remaining plan steps…\n\n';
        fullResponse += decisionNote;
        yield decisionNote;

        this.setLiveStatus('Continuing plan', plan.goal);
        this.emitActivity('info', 'Continuing remaining plan steps after approval decision');

        for await (const chunk of this.planExecutor.executePlan(
          session,
          provider,
          plan,
          planResume.displayPack,
          planResume.tools,
          (updated) => {
            this.onPlan?.(
              thunderPlanToView(updated, {
                status: 'running',
                requirementAnalysis: planResume.requirementAnalysis,
                appliedSkills: planResume.appliedSkills,
              })
            );
          },
          signal,
          sharedLoopCallbacks,
          {
            workspace: this.deps.workspace,
            sessionLog: this.deps.sessionLog,
            skillPlaybookContext: planResume.skillPlaybookContext,
            agentMaxSteps: this.suspendContext.agentMaxSteps,
            restrictRunCommandToReadOnly: this.suspendContext.auditMode,
            seedFileScope: (paths: string[]) => {
              this.deps.taskState?.mergeFileScope(paths);
            },
            getTaskState: () => this.deps.taskState,
          }
        )) {
          if (signal.aborted) break;
          if (isProgressChunk(chunk)) {
            yield chunk;
            continue;
          }
          fullResponse += chunkContent(chunk);
          yield chunk;
        }

        if (this.agentLoop?.hadPendingApproval() || plan.steps.some((s) => s.status === 'blocked')) {
          this.suspendContext = {
            ...this.suspendContext,
            planResume: {
              ...planResume,
              plan,
            },
          };
          const pauseBlock = this.savePauseState(session, userMessage);
          const approvalNote =
            `\n\n${pauseBlock}\n\n⏸ **Waiting for your approval** — review the proposed changes above, then approve or deny in the panel below.\n`;
          fullResponse += approvalNote;
          yield approvalNote;
          this.setLiveStatus('Waiting for approval', 'Review and approve below');
          this.emitActivity('approval', 'Paused — waiting for your approval', this.deps.taskState?.getPauseSummary());
        } else {
          this.suspendContext = undefined;
          this.agentLoop?.clearSuspendState();
        }
      } else if (this.agentLoop && baseState) {
        const wakeUpContent = planningResume
          ? [
              'User answered the pending planning clarification. Resume read-only planning discovery from the approved tool result.',
              baseState.checkpoint ? `\n## Approval checkpoint\n${baseState.checkpoint}` : '',
              '\nContinue with only the extra read-only discovery needed, then output DISCOVERY_SUMMARY.',
              'Do not execute edits. Do not compile the structured plan yourself; the orchestrator will compile it after discovery.',
            ].filter(Boolean).join('\n')
          : anyDenied && !anyApproved
            ? [
                'User denied the pending tool(s). Do not retry the denied tool. Continue the existing task another way.',
                taskStateBlock ? `\n## Task progress\n${taskStateBlock}` : '',
                baseState.checkpoint ? `\n## Approval checkpoint\n${baseState.checkpoint}` : '',
                '\nContinue from the pending Execute/Verify step. Do not restart planning or diagnostics.',
                'Skip incidental git_commit / GitHub publish tools unless the user explicitly asked for a commit or PR.',
              ].filter(Boolean).join('\n')
            : [
                'User approved the pending tool(s). Resume the existing task state machine from the approved tool result(s).',
                taskStateBlock ? `\n## Task progress\n${taskStateBlock}` : '',
                baseState.checkpoint ? `\n## Approval checkpoint\n${baseState.checkpoint}` : '',
                '\nContinue from the pending Execute/Verify step. Do not restart planning or diagnostics.',
                'Do not re-run audit-dependencies, audit-dead-code, depcheck, knip, eslint discovery, list_files, or memory_search unless the approved result proves the prior output is stale.',
                'If final verification reports unrelated TypeScript errors outside touched files, log them as remaining issues instead of derailing the cleanup task.',
              ].filter(Boolean).join('\n');

        const state: AgentLoopSuspendState = {
          ...baseState,
          messages: [
            ...baseState.messages,
            {
              role: 'user',
              content: wakeUpContent,
            },
          ],
        };

        for await (const chunk of this.agentLoop.resume(
          provider,
          state,
          approved,
          signal,
          sharedLoopCallbacks
        )) {
          if (signal.aborted) break;
          if (isProgressChunk(chunk)) {
            yield chunk;
            continue;
          }
          fullResponse += chunkContent(chunk);
          yield chunk;
        }

        if (this.agentLoop.hadPendingApproval()) {
          const pauseBlock = planningResume ? '' : this.savePauseState(session, userMessage);
          const approvalNote = planningResume
            ? '\n\n**Planning paused for another clarification.** Choose an option below and I will continue the plan.\n'
            : `\n\n${pauseBlock}\n\n⏸ **Waiting for your approval** — review the proposed changes above, then approve or deny in the panel below.\n`;
          fullResponse += approvalNote;
          yield approvalNote;
          this.setLiveStatus(
            planningResume ? 'Waiting for planning answer' : 'Waiting for approval',
            planningResume ? 'Choose an option below' : 'Review and approve below'
          );
          this.emitActivity(
            'approval',
            planningResume ? 'Planning paused for a clarifying question' : 'Paused — waiting for your approval',
            planningResume ? undefined : this.deps.taskState?.getPauseSummary()
          );
        } else if (planningResume) {
          const planText = await this.compilePlanAfterPlanningDiscovery(
            session,
            provider,
            planningResume.displayPack,
            planningResume.planningRequest,
            planningResume.taskAnalysis,
            [planningResume.initialPlanningDiscovery, fullResponse].filter((part) => part.trim()).join('\n\n'),
            planningResume.skillPlaybookContext,
            planningResume.appliedSkills,
            signal
          );
          fullResponse += planText;
          yield planText;
          this.suspendContext = undefined;
          this.agentLoop.clearSuspendState();
        } else {
          this.suspendContext = undefined;
          this.agentLoop.clearSuspendState();
        }
      } else {
        this.suspendContext = undefined;
        this.agentLoop?.clearSuspendState();
      }

      if (fullResponse) {
        this.saveTurn(session.id, 'assistant', fullResponse);
        this.deps.sessionLog?.append('assistant_message', fullResponse, {
          responseLength: fullResponse.length,
          preview: fullResponse.slice(0, 200),
        });
      }
    } finally {
      this.onLiveStatus?.(null);
    }
  }

  private async compilePlanAfterPlanningDiscovery(
    session: ThunderSession,
    provider: LlmProvider,
    displayPack: ContextPack,
    planningRequest: string,
    taskAnalysis: TaskAnalysis,
    planningDiscovery: string,
    skillPlaybookContext: string,
    appliedSkills: string[],
    signal?: AbortSignal
  ): Promise<string> {
    if (!this.planExecutor) {
      return '\n\n⚠️ Planning could not resume because the plan executor is unavailable.\n';
    }

    this.setLiveStatus('Analyzing requirements');
    this.emitActivity('info', 'Analyzing requirements after clarification…');
    let requirementAnalysisText = '';
    for await (const chunk of this.planExecutor.analyzeRequirementsStream(
      provider,
      displayPack,
      planningRequest,
      taskAnalysis,
      skillPlaybookContext,
      (text) => {
        requirementAnalysisText = text;
        this.onPlan?.({
          goal: cleanPlanGoalForDisplay(planningRequest, planningRequest),
          assumptions: [],
          steps: [],
          status: 'planning',
          requirementAnalysis: text,
          appliedSkills,
        });
      }
    )) {
      if (signal?.aborted) break;
      void chunk;
    }

    if (signal?.aborted) return '';

    this.setLiveStatus('Creating plan');
    this.emitActivity('info', 'Creating plan from clarified requirements…');
    const requirementAnalysis = requirementAnalysisText.trim();
    const plan = await this.planExecutor.generatePlan(
      provider,
      session.mode,
      displayPack,
      planningRequest,
      requirementAnalysis,
      planningDiscovery,
      taskAnalysis,
      session.id,
      {
        workspace: this.deps.workspace,
        useIsolatedPlanning: true,
        skillPlaybookContext,
      }
    );

    if (plan && plan.steps.length >= 1) {
      plan.goal = cleanPlanGoalForDisplay(plan.goal, planningRequest);
      const planView = thunderPlanToView(plan, {
        status: 'ready',
        requirementAnalysis: requirementAnalysis || undefined,
        appliedSkills,
      });
      this.onPlan?.(planView);
      this.deps.planPersistence?.save(session.id, plan);
      this.deps.sessionLog?.append('plan_created', plan.goal, {
        stepCount: plan.steps.length,
        steps: plan.steps.map((s) => ({ id: s.id, title: s.title, risk: s.risk, phase: s.phase })),
        appliedSkills,
        resumedAfterClarification: true,
      });
      this.emitActivity('info', 'Plan ready — switch to Agent mode to execute steps');
      return formatPlanModeChatSummary(planView);
    }

    this.emitActivity('error', 'Planning failed quality gate after clarification');
    return '\n\n⚠️ I could not produce a plan that passed the planning quality gate after the clarification. Please retry with a little more scope detail.\n';
  }

  stop(): void {
    this.abortController?.abort();
  }

  private saveTurn(sessionId: string, role: string, content: string): void {
    if (this.deps.sessionService) {
      this.deps.sessionService.saveTurn(sessionId, role, content);
      return;
    }
    if (!this.db) return;
    const raw = this.db.tryRaw();
    if (!raw) return;
    try {
      raw.prepare(`
        INSERT INTO agent_turns (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), sessionId, role, content, Date.now());
    } catch {
      // Session may not exist in DB yet
    }
  }
}

function describeToolActivity(
  name: string,
  input: Record<string, unknown>,
  phase: 'start' | 'success' | 'error'
): {
  kind: import('../../../vscode/webview/messages').AgentActivityEntry['kind'];
  liveLabel: string;
  message: string;
  detail?: string;
} {
  const path = typeof input.path === 'string' ? input.path : undefined;
  const command = typeof input.command === 'string' ? input.command : undefined;
  const query = typeof input.query === 'string' ? input.query : undefined;
  const paths = Array.isArray(input.paths) ? input.paths.filter((p): p is string => typeof p === 'string') : [];
  const queries = Array.isArray(input.queries) ? input.queries.filter((q): q is string => typeof q === 'string') : [];

  if (phase !== 'start') {
    return {
      kind: name.includes('write') || name.includes('patch') ? 'apply' : 'read',
      liveLabel: phase === 'success' ? 'Completed tool' : 'Tool failed',
      message: `${toolDisplayName(name)} ${phase === 'success' ? 'completed' : 'failed'}`,
    };
  }

  switch (name) {
    case 'read_file':
      return { kind: 'read', liveLabel: 'Reading file', message: `Reading ${path ?? 'a file'}`, detail: path };
    case 'read_files':
      return {
        kind: 'read',
        liveLabel: 'Reading files',
        message: `Reading ${paths.length || 'multiple'} files`,
        detail: paths.slice(0, 6).join('\n'),
      };
    case 'list_files':
      return { kind: 'read', liveLabel: 'Listing files', message: `Listing ${path ?? 'workspace files'}`, detail: path };
    case 'search':
      return { kind: 'read', liveLabel: 'Searching code', message: `Searching for ${query ?? 'matches'}`, detail: query };
    case 'search_batch':
      return {
        kind: 'read',
        liveLabel: 'Searching code',
        message: `Searching ${queries.length || 'multiple'} queries`,
        detail: queries.slice(0, 6).join('\n'),
      };
    case 'run_command':
      return { kind: 'tool', liveLabel: 'Running command', message: `Running ${command ?? 'command'}`, detail: command };
    case 'write_file':
      return { kind: 'apply', liveLabel: 'Writing file', message: `Writing ${path ?? 'file'}`, detail: path };
    case 'apply_patch':
      return { kind: 'apply', liveLabel: 'Applying patch', message: `Patching ${path ?? 'file'}`, detail: path };
    case 'spawn_research_agent':
    case 'spawn_subagent':
      return {
        kind: 'tool',
        liveLabel: 'Starting subagent',
        message: name === 'spawn_subagent' ? `Starting ${String(input.type ?? 'typed')} subagent` : 'Starting research subagent',
        detail: typeof input.task === 'string' ? input.task.slice(0, 180) : undefined,
      };
    case 'retrieve_context':
      return { kind: 'context', liveLabel: 'Retrieving context', message: 'Retrieving relevant context' };
    case 'diagnostics':
      return { kind: 'read', liveLabel: 'Checking diagnostics', message: 'Checking editor diagnostics' };
    case 'git_diff':
      return { kind: 'read', liveLabel: 'Reading changes', message: 'Reading current git diff' };
    default:
      return {
        kind: 'tool',
        liveLabel: toolDisplayName(name),
        message: `Using ${toolDisplayName(name)}`,
        detail: JSON.stringify(input).slice(0, 180),
      };
  }
}

function toolDisplayName(name: string): string {
  return name.replace(/_/g, ' ');
}

export { isSkippedToolOutput } from '../../../features/ce/runtime/toolSkip';

function uniqueContextNames(items: Array<{ relPath?: string; source: string }>): string[] {
  return Array.from(new Set(items.map((item) => item.relPath ?? item.source)));
}

function estimatePromptTokens(messages: Array<{ role: string; content: string }>): number {
  const serialized = messages.map((m) => `${m.role}\n${m.content}`).join('\n\n');
  return Math.ceil(serialized.length / 4);
}

function extractRequirementAnalysis(fullResponse: string): string {
  const marker = '## Requirement analysis';
  const start = fullResponse.indexOf(marker);
  if (start === -1) return '';
  const bodyStart = fullResponse.indexOf('\n', start);
  if (bodyStart === -1) return '';
  const rest = fullResponse.slice(bodyStart + 1);
  const nextHeading = rest.search(/\n## /);
  return (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
}

function formatPlanHeader(plan: import('../../../features/ce/plans/PlanActEngine').ThunderPlan): string {
  return `## Plan\n\n**${plan.goal}**\n\n${plan.steps.length} validated steps to execute.\n\n`;
}

function cleanPlanGoalForDisplay(goal: string, fallback: string): string {
  const trimmed = goal.trim();
  const fallbackGoal = fallback.trim().replace(/\s+/g, ' ').slice(0, 240);
  if (!trimmed) return fallbackGoal;
  if (
    /^#{1,6}\s*(?:act|plan)\s+routing\b/i.test(trimmed) ||
    /\n#{1,6}\s*(?:act|plan)\s+routing\b/i.test(trimmed) ||
    /\bOriginal\s+(?:Act|Plan)\s+request\b/i.test(trimmed)
  ) {
    return fallbackGoal;
  }
  return trimmed.replace(/\s+/g, ' ').slice(0, 240);
}

function formatPlanModeChatSummary(plan: PlanView): string {
  const stepCount = plan.steps.length;
  const skillNote = plan.appliedSkills?.length
    ? `\n\nSkills applied: ${plan.appliedSkills.join(', ')}`
    : '';
  return [
    `## Plan ready`,
    '',
    `**${plan.goal}**`,
    '',
    `${stepCount} step${stepCount === 1 ? '' : 's'} compiled in the **Planner** panel above. It shows the action list, current status, blockers, and verification details.`,
    skillNote,
    '',
    '---',
    '*Switch to **Agent** mode and ask to execute this plan when ready.*',
  ].join('\n');
}

export { filterDirectAgentTools } from '../../../kernel/tools/toolAliases';

export function shouldRunDirectFinalValidation(
  taskKind: ReturnType<typeof analyzeTask>['kind'],
  touchedFiles: string[] = []
): boolean {
  if (taskKind === 'question') return false;
  if (taskKind === 'simple_edit') return touchesDocs(touchedFiles);
  return true;
}

function shouldUsePlanner(
  mode: ThunderSession['mode'],
  taskAnalysis: ReturnType<typeof analyzeTask>,
  orchestrationEnabled: boolean,
  auditMode = false,
  actDepth: import('../../../kernel/config/schema').AgentDepth = 'auto'
): boolean {
  // Plan mode always uses the structured planner when the route requires a plan.
  if (mode === 'plan') return taskAnalysis.shouldPlan;
  if (mode === 'agent') return shouldUsePlannerForAct(taskAnalysis, orchestrationEnabled, auditMode, actDepth);
  return false;
}

export { shouldUsePlanner };

export function shouldRunStructuredPlanner(
  plannerEnabled: boolean,
  hasPlanExecutor: boolean,
  planningDepth: import('../../../features/ce/plans/planningDepth').PlanningDepth,
  mode: ThunderSession['mode']
): boolean {
  return (
    plannerEnabled &&
    hasPlanExecutor &&
    !shouldSkipStructuredPlanner(planningDepth, mode)
  );
}

export function shouldExecuteSavedPlan(
  mode: ThunderSession['mode'],
  userMessage: string,
  hasActivePlan: boolean,
  actDepth: import('../../../kernel/config/schema').AgentDepth = 'auto'
): boolean {
  return (
    mode === 'agent' &&
    shouldResumeSavedPlan(userMessage, hasActivePlan, hasDirectRouteOverride(userMessage), { actDepth })
  );
}

export function getTouchedFilesFromAudit(toolRuntime?: ToolRuntime, startIndex = 0): string[] {
  const audit = (toolRuntime?.getAuditLog() ?? []).slice(Math.max(0, startIndex));
  const files = new Set<string>();
  for (const { toolName, input, result } of audit) {
    if (!result.success) continue;
    if (toolName === 'write_file' || toolName === 'apply_patch') {
      const path = (input as Record<string, unknown>).path;
      if (typeof path === 'string') files.add(path);
    }
    if (toolName === 'run_command') {
      const command = (input as Record<string, unknown>).command;
      if (typeof command === 'string') {
        const effect = classifyCommandEffect(command);
        if (effect === 'workspace_mutation' || effect === 'dependency_mutation') {
          for (const file of inferTouchedFilesFromCommand(command)) files.add(file);
        }
      }
    }
  }
  return [...files];
}

export function hasWorkspaceMutationFromAudit(toolRuntime?: ToolRuntime, startIndex = 0): boolean {
  const audit = (toolRuntime?.getAuditLog() ?? []).slice(Math.max(0, startIndex));
  return audit.some(({ toolName, input, result }) => {
    if (!result.success) return false;
    if (toolName === 'write_file' || toolName === 'apply_patch') return true;
    if (toolName !== 'run_command') return false;
    const command = (input as Record<string, unknown>).command;
    if (typeof command !== 'string') return false;
    const effect = classifyCommandEffect(command);
    return effect === 'workspace_mutation' || effect === 'dependency_mutation';
  });
}

export function calculateRetrievalContextBudget(
  maxInputTokens: number,
  explicitContextTokens: number,
  userPathTokens: number
): { requestedContextBudget: number; retrievalContextBudget: number } {
  const requestedContextBudget = Math.floor(maxInputTokens * 0.65);
  const retrievalContextBudget = Math.max(
    0,
    requestedContextBudget - Math.max(0, explicitContextTokens) - Math.max(0, userPathTokens)
  );
  return { requestedContextBudget, retrievalContextBudget };
}

function shouldRequireAgentWrite(
  mode: ThunderSession['mode'],
  operationClass: PipelineResolution['route']['operationClass']
): boolean {
  return (
    mode === 'agent' &&
    (operationClass === 'workspace_write' || operationClass === 'execute_saved_plan')
  );
}

function toRequiredLoopOperation(
  operationClass: PipelineResolution['route']['operationClass']
): import('../../../features/ce/runtime/AgentLoop').AgentLoopOptions['requiredOperation'] {
  if (
    operationClass === 'workspace_write' ||
    operationClass === 'local_git_write' ||
    operationClass === 'remote_write' ||
    operationClass === 'release' ||
    operationClass === 'execute_saved_plan'
  ) {
    return operationClass;
  }
  return undefined;
}

function touchesDocs(files: string[]): boolean {
  return files.some((file) =>
    /(?:^|\/)(?:apps\/docs|docs)\/.+\.(?:mdx?|tsx?|jsx?)$/i.test(file) ||
    /\.(?:mdx)$/i.test(file)
  );
}

function mergePromptContexts(...blocks: Array<string | undefined>): string | undefined {
  const merged = blocks
    .map((block) => block?.trim())
    .filter((block): block is string => Boolean(block));
  if (merged.length === 0) return undefined;
  return [...new Set(merged)].join('\n\n---\n\n');
}

function attachImagesToLastUser(
  messages: ChatMessage[],
  attachments: ChatMessage['attachments'] | undefined
): ChatMessage[] {
  const images = attachments?.filter((attachment) => attachment.kind === 'image') ?? [];
  if (images.length === 0) return messages;
  const next = [...messages];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index].role !== 'user') continue;
    next[index] = {
      ...next[index],
      attachments: [...(next[index].attachments ?? []), ...images],
    };
    return next;
  }
  return [...next, { role: 'user', content: 'Attached image context.', attachments: images }];
}

function resolveTurnAgenticTier(provider: LlmProvider, agentConfig?: AgentConfig): AgenticTier {
  const override = agentConfig?.agenticTierOverride;
  if (override && override !== 'auto') return override;
  return provider.capabilities.agenticTier ?? 'cloud-standard';
}

function resolveLoopMaxSteps(options: {
  isAskMode: boolean;
  isPlanMode: boolean;
  auditMode: boolean;
  logAuditMode?: boolean;
  askSteps?: number;
  planSteps?: number;
  actSteps?: number;
  tierPolicy: TierPolicy;
}): number {
  // Log audit is a short, tool-first route in any chat mode.
  if (options.logAuditMode) {
    return LOG_AUDIT_AGENT_MAX_STEPS;
  }
  if (options.isAskMode) {
    return scaleTierSteps(options.askSteps ?? 18, options.tierPolicy, 50);
  }
  if (options.isPlanMode) {
    return options.planSteps ?? scaleTierSteps(8, options.tierPolicy, 50);
  }
  if (options.auditMode) {
    return AUDIT_AGENT_MAX_STEPS;
  }
  return options.actSteps ?? scaleTierSteps(15, options.tierPolicy, 100);
}

const MINIMAL_TIER_EXCLUDED_TOOLS = new Set([
  'spawn_research_agent',
  'spawn_subagent',
  'memory_write',
  'save_task_state',
  'use_skill',
  'fetch_web',
]);

function filterToolsForTier<T extends { function: { name: string } }>(tools: T[], policy: TierPolicy): T[] {
  if (policy.toolExposure === 'full') return tools;
  return tools.filter((tool) => {
    const name = tool.function.name;
    if (name.startsWith('mcp__')) return false;
    if (policy.toolExposure === 'minimal' && MINIMAL_TIER_EXCLUDED_TOOLS.has(name)) return false;
    return true;
  });
}

function emptyContextPack(): ContextPack {
  return {
    items: [],
    totalTokens: 0,
    formatted: '',
    retrievedCount: 0,
    budgetLimit: 0,
    dropped: [],
    truncatedCount: 0,
  };
}

export function contextPackToBudgetView(pack: ContextPack): ContextBudgetView {
  const sourceMap = new Map<string, { tokens: number; count: number }>();
  for (const item of pack.items) {
    const entry = sourceMap.get(item.source) ?? { tokens: 0, count: 0 };
    entry.tokens += item.tokenEstimate;
    entry.count += 1;
    sourceMap.set(item.source, entry);
  }

  return {
    retrievedCount: pack.retrievedCount,
    includedCount: pack.items.length,
    budgetLimit: pack.budgetLimit,
    usedTokens: pack.totalTokens,
    truncatedCount: pack.truncatedCount,
    dropped: pack.dropped.map((d) => ({
      source: d.source,
      relPath: d.relPath,
      reason: d.reason,
      tokenEstimate: d.tokenEstimate,
      cause: d.cause,
    })),
    sourceBreakdown: [...sourceMap.entries()]
      .map(([source, stats]) => ({ source, tokens: stats.tokens, count: stats.count }))
      .sort((a, b) => b.tokens - a.tokens),
  };
}

export function contextItemsToViews(items: ContextItem[]): ContextItemView[] {
  return items.map((item) => ({
    id: item.id,
    source: item.source,
    relPath: item.relPath,
    reason: item.reason,
    tokenEstimate: item.tokenEstimate,
    preview: item.content.slice(0, 300),
    truncated: item.reason.includes('truncated'),
  }));
}

function extractManualSkillIds(message: string): string[] {
  return [...message.matchAll(/(?:@skill:|\/skill\s+)([a-z0-9][a-z0-9._-]*)/gi)]
    .map((match) => match[1].toLowerCase());
}
