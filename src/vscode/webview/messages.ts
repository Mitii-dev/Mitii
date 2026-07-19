import type { ThunderMode } from '../../features/ce/session/ThunderSession';
import type { SkillManifest } from '../../interfaces/skills/SkillManifest';
import type { SkillCandidateReport, SkillEngineResolution } from '../../features/ce/skills/SkillEngine';
import type { SkillUsageMetric } from '../../features/ce/skills/SkillTelemetry';
import type { SkillTestRunResult } from '../../features/ce/skills/SkillTestRunner';
import type { SkillDraftAnalysis, SkillCatalogItem } from '../../features/ce/skills/SkillManagementService';
import type {
  AgentSettingsPayload,
  AgentDepthView,
  ApprovalMode,
  McpCustomServerView,
  McpSettingsPayload,
  McpToggles,
  ProviderSettingsPayload,
  ProviderTypeView,
  SafetySettingsPayload,
  ThunderSettingsPayload,
} from '../../kernel/config/ui/payloads';
export type {
  AgentSettingsPayload,
  AgentDepthView,
  ApprovalMode,
  IndexingSettingsPayload,
  MemorySettingsPayload,
  McpCustomServerView,
  McpSettingsPayload,
  McpToggles,
  ProviderSettingsPayload,
  ProviderTypeView,
  SafetySettingsPayload,
  TelemetrySettingsPayload,
  ThunderSettingsPayload,
} from '../../kernel/config/ui/payloads';

export type WebviewTab = 'chat' | 'history' | 'settings' | 'skills';

export interface InternalFeaturesView {
  skillManagement: boolean;
}

export interface SkillDocumentView {
  manifest: SkillManifest;
  content: string;
  revision: string;
  source: 'builtin' | 'internal' | 'repository' | 'installed';
}

export interface SkillAnalyzerRequest {
  request: string;
  mode: 'ask' | 'plan' | 'agent';
  intent?: string;
  taskKind?: string;
  taskSubtype?: string;
  availableTools?: string[];
  availableCapabilities?: string[];
}

export interface SkillAnalyzerResultView {
  resolution: SkillEngineResolution;
  repositoryProfile: {
    version: string;
    repositoryId?: string;
    languages: string[];
    frameworks: string[];
    packageManagers: string[];
    paths: string[];
  };
  selectedReports: SkillCandidateReport[];
  finalContext: string;
  injectionChars: number;
  injectionTokens: number;
}

export type {
  SkillCatalogItem,
  SkillDraftAnalysis,
  SkillUsageMetric,
  SkillTestRunResult,
};

export interface ChatImageAttachment {
  kind: 'image';
  mimeType: string;
  data: string;
  name?: string;
  size?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: ChatImageAttachment[];
  reasoningContent?: string;
  timestamp: number;
  streaming?: boolean;
}

export interface ApprovalRequestView {
  id: string;
  toolName: string;
  inputPreview: string;
  files: string[];
  risk: 'low' | 'medium' | 'high';
  reason: string;
  contentLength?: number;
  kind?: 'approval' | 'question';
  question?: string;
  options?: string[];
}

export interface TokenUsageView {
  sessionTotal: number;
  inputTokensTotal: number;
  outputTokensTotal: number;
  currentTurnTotal: number;
  currentTurnInputTokens: number;
  currentTurnOutputTokens: number;
  aiCallCount: number;
  currentTurnAiCallCount: number;
  lastCallInputTokens: number;
  lastCallOutputTokens: number;
  lastCallTotalTokens: number;
  lastPromptTokens: number;
  lastContextTokens: number;
  lastResponseTokens: number;
  turnCount: number;
  contextWindow: number;
  estimated: boolean;
  breakdown: TokenUsageBreakdownItem[];
}

export interface TokenUsageBreakdownItem {
  label: string;
  tokens: number;
  color: string;
}

export interface ChatThreadSummary {
  id: string;
  title: string;
  lastMessage: string;
  messageCount: number;
  updatedAt: number;
  tokenTotal: number;
  turnCount: number;
}

export interface PinnedContextView {
  path: string;
  kind: 'file' | 'folder';
  auto?: boolean;
}

export interface ContextPathSuggestion {
  path: string;
  kind: 'file' | 'folder';
  label: string;
}

export interface ContextItemView {
  id: string;
  source: string;
  relPath?: string;
  reason: string;
  tokenEstimate: number;
  preview: string;
  truncated?: boolean;
}

export interface ContextDropView {
  source: string;
  relPath?: string;
  reason: string;
  tokenEstimate: number;
  cause: string;
}

export interface SourceTokenSplit {
  source: string;
  tokens: number;
  count: number;
}

export interface ContextBudgetView {
  retrievedCount: number;
  includedCount: number;
  budgetLimit: number;
  usedTokens: number;
  truncatedCount: number;
  dropped: ContextDropView[];
  sourceBreakdown: SourceTokenSplit[];
}

export interface AgentLiveStatusView {
  label: string;
  detail?: string;
  stepCurrent?: number;
  stepTotal?: number;
}

export interface SubagentStatusView {
  id: string;
  type?: string;
  task: string;
  focus?: string;
  scope?: string;
  progress?: number;
  status: 'queued' | 'running' | 'done' | 'error';
  startedAt: number;
  finishedAt?: number;
  summary?: string;
  error?: string;
}

export interface VectorIndexStatusView {
  enabled: boolean;
  embeddedChunks: number;
  provider: string;
  backend?: string;
  /** True when the embedder or vector backend silently degraded at runtime (e.g. MiniLM
   * model failed to load, or LanceDB's native table failed to open) — distinct from `provider`/
   * `backend`, which only describe config + package availability, not live health. */
  degraded?: boolean;
  degradedDetail?: string;
}

export interface AgentActivityEntry {
  id: string;
  kind: 'context' | 'read' | 'budget' | 'apply' | 'info' | 'approval' | 'error' | 'tool' | 'success' | 'skipped';
  message: string;
  detail?: string;
  timestamp: number;
}

export interface PlanStepView {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'done' | 'blocked' | 'failed' | 'blocked_by_dependency';
  risk: 'low' | 'medium' | 'high';
  files?: string[];
  phase?: 'diagnostics' | 'review' | 'execute' | 'verify';
  objective?: string;
  tools?: string[];
  successCriteria?: string[];
  dependsOn?: string[];
}

export interface PlanPhaseView {
  id: string;
  title: string;
  phase: 'diagnostics' | 'review' | 'execute' | 'verify';
  steps: PlanStepView[];
}

export interface PlanView {
  goal: string;
  assumptions: string[];
  requiredApprovals?: string[];
  steps: PlanStepView[];
  phases?: PlanPhaseView[];
  requirementAnalysis?: string;
  status?: 'planning' | 'ready' | 'running' | 'completed';
  appliedSkills?: string[];
}

export interface IndexingStatusView {
  indexed: number;
  queued: number;
  running: boolean;
  failed: number;
  total: number;
  activeWorkers?: number;
  processed?: number;
  runTotal?: number;
  phase?: 'idle' | 'scanning' | 'indexing' | 'complete' | 'cancelled';
  partial?: boolean;
  degraded?: boolean;
  detail?: string;
  startedAt?: number;
  updatedAt?: number;
}

export interface MemoryItemView {
  id: number;
  type: string;
  text: string;
  createdAt: number;
}

export interface CheckpointView {
  id: string;
  kind: string;
  files: string[];
  createdAt: number;
  strategy?: string;
}

export interface ReviewDiffFileView {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  diff: string;
}

export interface ReviewDiffView {
  branch: string | null;
  files: ReviewDiffFileView[];
  summary: {
    fileCount: number;
    additions: number;
    deletions: number;
  };
  truncated: boolean;
  updatedAt: number;
}

export interface OnboardingView {
  shouldShow: boolean;
  completed: boolean;
  providerConfigured: boolean;
  workspaceIndexed: boolean;
}

export interface SettingsView {
  appVersion: string;
  providerType: string;
  baseUrl: string;
  model: string;
  apiVersion: string;
  region: string;
  contextWindow: number;
  indexingEnabled: boolean;
  approvalMode: ApprovalMode;
  requireApprovalWrites: boolean;
  requireApprovalShell: boolean;
  memoryEnabled: boolean;
  summarizeAfterTask: boolean;
  autoMemoryEnabled: boolean;
  autoMemoryScope: 'user' | 'workspace' | 'both';
  subagentsEnabled: boolean;
  agentMaxSteps: number;
  askDepth: AgentDepthView;
  planDepth: AgentDepthView;
  actDepth: AgentDepthView;
  askMaxSteps: number;
  askAutoContinue: boolean;
  askMaxAutoContinues: number;
  agentAutoContinue: boolean;
  agentMaxAutoContinues: number;
  researchAgentMaxSteps: number;
  showDiffPreview: boolean;
  hasApiKey: boolean;
  hasGithubToken: boolean;
  connectionStatus?: string;
  connectionOk?: boolean;
  mcpEnabled: boolean;
  mcpServers: number;
  mcpTools: number;
  mcpServerStatuses: McpServerStatusView[];
  customMcpServers: McpCustomServerView[];
  projectRules: number;
  sessionLogging: boolean;
  debugMetrics: boolean;
  traceEnabled: boolean;
  traceIncludePayloads: boolean;
  traceLlm: boolean;
  traceMcp: boolean;
  traceWebview: boolean;
  traceDaemon: boolean;
  traceWebhook: boolean;
  traceMaxPayloadChars: number;
  localDebugAvailable: boolean;
  vectorsEnabled: boolean;
  embeddingProvider: 'minilm' | 'hash';
  vectorBackend: 'sqlite' | 'lancedb';
  hybridMemorySearch: boolean;
  minilmAvailable: boolean;
  lancedbAvailable: boolean;
  autonomyPreset: 'safe' | 'guided' | 'builder' | 'pilot' | 'enterprise';
  askModel: string;
  askBaseUrl: string;
  planModel: string;
  planBaseUrl: string;
  actModel: string;
  actBaseUrl: string;
  checkpointStrategy: 'file-copy' | 'git-stash' | 'shadow-git';
  showReasoning: boolean;
  reasoningPreviewMaxChars: number;
  providerProfiles: ProviderProfileView[];
  activeProviderProfileId: string | null;
}

export interface ProviderProfileView {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  model: string;
  apiVersion: string;
  region: string;
  contextWindow: number;
  hasApiKey: boolean;
}

export type ModelOptionCategory = 'recent' | 'local' | 'cloud' | 'custom';

export interface SessionProviderOverrideView {
  providerType: ProviderTypeView;
  model: string;
  baseUrl: string;
  profile: string | null;
  profileId?: string;
  apiVersion?: string;
  region?: string;
  contextWindow?: number;
}

export interface ModelOptionView extends SessionProviderOverrideView {
  id: string;
  label: string;
  description: string;
  category: ModelOptionCategory;
}

export interface McpServerStatusView {
  name: string;
  connected: boolean;
  toolCount: number;
  builtin?: boolean;
  error?: string;
}

export interface ContextToggles {
  repoMap: boolean;
  fts: boolean;
  gitDiff: boolean;
  diagnostics: boolean;
  memory: boolean;
  vectors: boolean;
  callGraph: boolean;
}

export interface WebviewState {
  tab: WebviewTab;
  internalFeatures: InternalFeaturesView;
  messages: ChatMessage[];
  currentSessionId: string;
  chatHistory: ChatThreadSummary[];
  mode: ThunderMode;
  loading: boolean;
  error: string | null;
  approvals: ApprovalRequestView[];
  pinnedContext: PinnedContextView[];
  contextPreview: ContextItemView[];
  contextTokenEstimate: number;
  contextBudget: ContextBudgetView | null;
  agentActivity: AgentActivityEntry[];
  agentLiveStatus: AgentLiveStatusView | null;
  subagents: SubagentStatusView[];
  vectorIndex: VectorIndexStatusView;
  plan: PlanView | null;
  indexing: IndexingStatusView;
  memories: MemoryItemView[];
  checkpoints: CheckpointView[];
  reviewDiff: ReviewDiffView | null;
  onboarding: OnboardingView;
  settings: SettingsView;
  contextToggles: ContextToggles;
  mcpToggles: McpToggles;
  logoUri: string;
  showContextPreview: boolean;
  providerLabel: string;
  modelOptions: ModelOptionView[];
  sessionProviderOverride: SessionProviderOverrideView | null;
  workspaceOpen: boolean;
  workspacePath: string;
  vscodeWorkspaceFolders: string[];
  workspaceOverride: string;
  usingWorkspaceOverride: boolean;
  indexDbPath: string;
  workspaceNotice: WorkspaceNoticeView | null;
  tokenUsage: TokenUsageView;
  workspaceTrusted: boolean;
  settingsSaving: boolean;
  testingConnection: boolean;
}

export type WorkspaceNoticeView = {
  kind: 'ok' | 'error' | 'warn';
  message: string;
};

// Extension -> Webview messages
export type ExtensionToWebviewMessage =
  | { type: 'state'; payload: WebviewState }
  | { type: 'appendMessage'; payload: ChatMessage }
  | { type: 'updateLastAssistant'; payload: { content: string; reasoningContent?: string; streaming: boolean } }
  | { type: 'setError'; payload: string | null }
  | { type: 'setLoading'; payload: boolean }
  | { type: 'setMode'; payload: ThunderMode }
  | { type: 'setTab'; payload: WebviewTab }
  | { type: 'setIndexing'; payload: IndexingStatusView }
  | { type: 'setApprovals'; payload: ApprovalRequestView[] }
  | { type: 'setContextPreview'; payload: { items: ContextItemView[]; totalTokens: number; budget?: ContextBudgetView | null } }
  | { type: 'setPlan'; payload: PlanView | null }
  | { type: 'setAgentActivity'; payload: AgentActivityEntry[] }
  | { type: 'setAgentLiveStatus'; payload: AgentLiveStatusView | null }
  | { type: 'setSubagents'; payload: SubagentStatusView[] }
  | { type: 'setTokenUsage'; payload: TokenUsageView }
  | { type: 'setReviewDiff'; payload: ReviewDiffView | null }
  | { type: 'setContextPaths'; payload: { requestId: string; paths: ContextPathSuggestion[] } }
  | { type: 'skillCatalogResult'; payload: { requestId: string; items: SkillCatalogItem[]; total: number; error?: string } }
  | { type: 'skillDocumentResult'; payload: { requestId: string; document?: SkillDocumentView; error?: string } }
  | { type: 'skillMutationResult'; payload: { requestId: string; document?: SkillDocumentView; deletedId?: string; error?: string } }
  | { type: 'skillDraftAnalysisResult'; payload: { requestId: string; analysis?: SkillDraftAnalysis; error?: string } }
  | { type: 'skillAnalyzerResult'; payload: { requestId: string; result?: SkillAnalyzerResultView; error?: string } }
  | { type: 'skillTestResult'; payload: { requestId: string; result?: SkillTestRunResult; error?: string } }
  | { type: 'skillAnalyticsResult'; payload: { requestId: string; metrics: SkillUsageMetric[]; error?: string } };

// Webview -> Extension messages
export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'sendMessage'; payload: { content: string; pinnedContext?: PinnedContextView[]; attachments?: ChatImageAttachment[] } }
  | { type: 'retryLastMessage' }
  | { type: 'newChat' }
  | { type: 'openChatThread'; payload: { id: string } }
  | { type: 'deleteChatThread'; payload: { id: string } }
  | { type: 'clearChatHistory' }
  | { type: 'setMode'; payload: ThunderMode }
  | { type: 'setTab'; payload: WebviewTab }
  | { type: 'stopGeneration' }
  | { type: 'clearError' }
  | { type: 'resolveApproval'; payload: { id: string; decision: 'approved' | 'denied'; selectedOption?: string; scope?: 'single' | 'task' } }
  | { type: 'approveAllPending' }
  | { type: 'saveApiKey'; payload: { key: string } }
  | { type: 'saveGitHubToken'; payload: { token: string } }
  | { type: 'saveProviderSettings'; payload: ProviderSettingsPayload }
  | { type: 'selectSessionModel'; payload: SessionProviderOverrideView | null }
  | { type: 'saveSessionModelAsDefault' }
  | { type: 'saveAgentSettings'; payload: AgentSettingsPayload }
  | { type: 'saveSafetySettings'; payload: SafetySettingsPayload }
  | { type: 'saveMcpSettings'; payload: McpSettingsPayload }
  | { type: 'saveAllSettings'; payload: ThunderSettingsPayload }
  | { type: 'testProviderConnection'; payload?: ProviderSettingsPayload }
  | { type: 'saveProviderProfile'; payload: { id?: string; name?: string; settings: ProviderSettingsPayload; apiKey?: string } }
  | { type: 'selectProviderProfile'; payload: { id: string } }
  | { type: 'deleteProviderProfile'; payload: { id: string } }
  | { type: 'pickWorkspaceFolder' }
  | { type: 'setWorkspaceOverride'; payload: { path: string } }
  | { type: 'clearWorkspaceOverride' }
  | { type: 'indexWorkspace' }
  | { type: 'cancelIndexing' }
  | { type: 'restoreCheckpoint'; payload: { id: string } }
  | { type: 'deleteMemory'; payload: { id: number } }
  | { type: 'clearMemory' }
  | { type: 'showInlineDiff'; payload: { approvalId: string } }
  | { type: 'toggleContextSource'; payload: { source: keyof ContextToggles; enabled: boolean } }
  | { type: 'toggleMcpServer'; payload: { server: keyof McpToggles; enabled: boolean } }
  | { type: 'saveCustomMcpServers'; payload: { servers: McpCustomServerView[] } }
  | { type: 'toggleContextPreview' }
  | { type: 'copyLastResponse' }
  | { type: 'copyChatHistoryMarkdown' }
  | { type: 'addPinnedContext'; payload: { path: string; kind: 'file' | 'folder' } }
  | { type: 'removePinnedContext'; payload: { path: string } }
  | { type: 'clearPinnedContext' }
  | { type: 'searchContextPaths'; payload: { query: string; requestId: string } }
  | { type: 'pickContextPath' }
  | { type: 'refreshReviewDiff' }
  | { type: 'completeOnboarding' }
  | { type: 'refreshPanels' }
  | { type: 'requestSkillCatalog'; payload: { requestId: string; query?: string; enabled?: boolean; mode?: string; sort?: 'name' | 'priority' | 'updated'; limit?: number; offset?: number } }
  | { type: 'openSkill'; payload: { requestId: string; id: string } }
  | { type: 'saveSkill'; payload: { requestId: string; document: Omit<SkillDocumentView, 'revision'>; expectedRevision?: string } }
  | { type: 'deleteSkill'; payload: { requestId: string; id: string; expectedRevision?: string } }
  | { type: 'analyzeSkillDraft'; payload: { requestId: string; manifest: unknown; content: string } }
  | { type: 'analyzeSkillRouting'; payload: { requestId: string; input: SkillAnalyzerRequest } }
  | { type: 'runSkillTests'; payload: { requestId: string; skillId: string } }
  | { type: 'requestSkillAnalytics'; payload: { requestId: string } };

export const defaultMcpToggles = (): McpToggles => ({
  filesystem: true,
  memory: true,
  sequentialThinking: true,
  puppeteer: false,
  agentmemory: false,
});

export const defaultContextToggles = (): ContextToggles => ({
  repoMap: true,
  fts: true,
  gitDiff: true,
  diagnostics: false,
  memory: true,
  vectors: true,
  callGraph: true,
});

export const defaultSettingsView = (): SettingsView => ({
  appVersion: '',
  providerType: 'echo',
  baseUrl: 'http://localhost:11434/v1',
  model: 'qwen3-coder:30b',
  apiVersion: '2024-10-21',
  region: 'us-east-1',
  contextWindow: 8192,
  indexingEnabled: true,
  approvalMode: 'review_all',
  requireApprovalWrites: true,
  requireApprovalShell: true,
  memoryEnabled: true,
  summarizeAfterTask: true,
  autoMemoryEnabled: true,
  autoMemoryScope: 'user',
  subagentsEnabled: true,
  agentMaxSteps: 15,
  askDepth: 'auto',
  planDepth: 'auto',
  actDepth: 'auto',
  askMaxSteps: 18,
  askAutoContinue: true,
  askMaxAutoContinues: 1,
  agentAutoContinue: true,
  agentMaxAutoContinues: 2,
  researchAgentMaxSteps: 6,
  showDiffPreview: false,
  hasApiKey: false,
  hasGithubToken: false,
  mcpEnabled: true,
  mcpServers: 0,
  mcpTools: 0,
  mcpServerStatuses: [],
  customMcpServers: [],
  projectRules: 0,
  sessionLogging: true,
  debugMetrics: false,
  traceEnabled: false,
  traceIncludePayloads: false,
  traceLlm: true,
  traceMcp: true,
  traceWebview: true,
  traceDaemon: true,
  traceWebhook: true,
  traceMaxPayloadChars: 16000,
  localDebugAvailable: false,
  vectorsEnabled: true,
  embeddingProvider: 'minilm',
  vectorBackend: 'lancedb',
  hybridMemorySearch: true,
  minilmAvailable: false,
  lancedbAvailable: false,
  autonomyPreset: 'guided',
  askModel: '',
  askBaseUrl: '',
  planModel: '',
  planBaseUrl: '',
  actModel: '',
  actBaseUrl: '',
  checkpointStrategy: 'git-stash',
  showReasoning: true,
  reasoningPreviewMaxChars: 8000,
  providerProfiles: [],
  activeProviderProfileId: null,
});

export const initialWebviewState = (): WebviewState => ({
  tab: 'chat',
  internalFeatures: { skillManagement: false },
  messages: [],
  currentSessionId: '',
  chatHistory: [],
  mode: 'plan',
  loading: false,
  error: null,
  approvals: [],
  pinnedContext: [],
  contextPreview: [],
  contextTokenEstimate: 0,
  contextBudget: null,
  agentActivity: [],
  agentLiveStatus: null,
  subagents: [],
  vectorIndex: { enabled: false, embeddedChunks: 0, provider: 'none', backend: 'none', degraded: false },
  plan: null,
  indexing: { indexed: 0, queued: 0, running: false, failed: 0, total: 0, activeWorkers: 0, processed: 0, runTotal: 0, phase: 'idle' },
  memories: [],
  checkpoints: [],
  reviewDiff: null,
  onboarding: {
    shouldShow: false,
    completed: false,
    providerConfigured: false,
    workspaceIndexed: false,
  },
  settings: defaultSettingsView(),
  contextToggles: defaultContextToggles(),
  mcpToggles: defaultMcpToggles(),
  logoUri: '',
  showContextPreview: false,
  providerLabel: 'echo',
  modelOptions: [],
  sessionProviderOverride: null,
  workspaceOpen: false,
  workspacePath: '',
  vscodeWorkspaceFolders: [],
  workspaceOverride: '',
  usingWorkspaceOverride: false,
  indexDbPath: '',
  workspaceNotice: null,
  tokenUsage: {
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
    contextWindow: 8192,
    estimated: true,
    breakdown: [],
  },
  workspaceTrusted: true,
  settingsSaving: false,
  testingConnection: false,
});
