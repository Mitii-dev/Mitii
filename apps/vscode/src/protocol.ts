/**
 * Host ↔ webview message protocol (apps/vscode only).
 * Keep free of vscode / React imports so the webview can mirror these types.
 */

export type AgentUiMode = 'ask' | 'plan' | 'agent' | 'review';
export type AgentUiDepth = 'auto' | 'quick' | 'deep';
export type UiNav = 'chat' | 'history' | 'settings' | 'skills';
export type SettingsTab =
  | 'workspace'
  | 'model'
  | 'modes'
  | 'context'
  | 'integrations'
  | 'debug';

export type McpTransport = 'stdio' | 'sse' | 'streamable-http';
export type McpRuntimeStatus =
  | 'disabled'
  | 'configured'
  | 'ready'
  | 'partial'
  | 'error'
  | 'prompt_injected'
  | 'unsupported_runtime';

export interface McpServerConfig {
  /** Stable id (builtins: filesystem, sequential-thinking, memory, puppeteer). */
  id?: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Prefers `enabled`; `disabled` kept for backwards compatibility. */
  enabled?: boolean;
  disabled?: boolean;
  /** True for Mitii-shipped preload servers. */
  builtin?: boolean;
}

export interface McpSettings {
  enabled: boolean;
  servers: McpServerConfig[];
}

/** Per-source estimated tokens for the last composed prompt / context window. */
export interface ContextUsageSlice {
  id: string;
  label: string;
  tokens: number;
  /** Whether this source contributed to the last run. */
  active: boolean;
}

export interface ContextUsageBreakdown {
  /** Estimated tokens by source (chars/4). */
  slices: ContextUsageSlice[];
  totalTokens: number;
  contextWindow: number;
  /** Share of window used by the last prompt composition (0–1). */
  fillRatio: number;
  estimated: boolean;
  updatedAt?: string;
}

export interface ContextToggles {
  repoMap: boolean;
  diagnostics: boolean;
  gitDiff: boolean;
  editor: boolean;
  openTabs: boolean;
  memory: boolean;
}

export interface ProviderSettingsSnapshot {
  type: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  /** Discovered + preset model ids for the dropdown. */
  availableModels: string[];
  /** Model context window in tokens (prompt budgeting + meter). */
  contextWindow: number;
  /** Max tokens the model may generate per call. */
  maximumOutputTokens: number;
  connectionOk?: boolean;
  connectionStatus?: string;
}

export interface TokenUsageTurn {
  turnIndex: number;
  at: string;
  inputTokens: number;
  outputTokens: number;
  finishReason?: string;
  truncated?: boolean;
  estimated?: boolean;
}

export interface TokenUsageSnapshot {
  sessionTotal: number;
  inputTokensTotal: number;
  outputTokensTotal: number;
  currentTurnTotal: number;
  currentTurnInputTokens: number;
  currentTurnOutputTokens: number;
  aiCallCount: number;
  modelCalls: number;
  toolCalls: number;
  loopIterations: number;
  lastPromptTokens: number;
  lastResponseTokens: number;
  turnCount: number;
  contextWindow: number;
  estimated: boolean;
  durationMs?: number;
  /** Per model-call I/O within the session (live during a run). */
  turns: TokenUsageTurn[];
  live?: boolean;
  /** Last prompt context breakdown (Conversation, MCP, Prompt, Repomap, …). */
  contextBreakdown?: ContextUsageBreakdown;
}

export interface IndexStatusSnapshot {
  fileCount: number;
  truncated: boolean;
  scanCompleteness?: string;
  cleanupAllowed?: boolean;
  rootCount?: number;
  indexMode?: 'full' | 'host_snapshot';
  capabilities?: Array<{
    capability: string;
    status: string;
    reasonCode?: string;
    rootId?: string;
    revision?: string;
    profile?: string;
  }>;
  readiness?: string;
  stateTokenPreview?: string;
  lastIndexedAt?: string;
  message?: string;
}

export interface WorkspaceSnapshotInfo {
  root?: string;
  rootOverride?: string;
  displayRoot?: string;
}

export interface UiSettingsSnapshot {
  showReasoning: boolean;
  reasoningPreviewMaxChars: number;
  depth: AgentUiDepth;
  contextToggles: ContextToggles;
  approvalMode: string;
}

export interface PathSuggestion {
  path: string;
  kind: 'file' | 'folder';
}

export interface ActivityEventPayload {
  id: string;
  at: number;
  kind:
    | 'thinking'
    | 'delta'
    | 'context'
    | 'tool'
    | 'decision'
    | 'warning'
    | 'suspended'
    | 'terminal'
    | 'info';
  title: string;
  detail?: string;
  status?: string;
}

export interface ClarificationOptionView {
  id: string;
  label: string;
  description?: string;
}

export interface SuspensionPayload {
  runId: string;
  kind:
    | 'clarification_required'
    | 'approval_required'
    | 'plan_approval_required';
  rationale?: string;
  clarificationPrompt?: string;
  clarificationOptions?: ClarificationOptionView[];
  /** Structured plan awaiting approval (plan_approval_required). */
  plan?: PlanView | null;
  approval?: {
    approvalId: string;
    toolName: string;
    paths?: string[];
    proposedText?: string;
  };
}

export interface RunUsagePayload {
  modelCalls: number;
  toolCalls: number;
  loopIterations: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
}

export interface ChatThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  mode?: AgentUiMode;
}

export interface PlanStepView {
  id: string;
  title: string;
  status: 'pending' | 'active' | 'done' | 'skipped';
  detail?: string;
}

export interface PlanView {
  title: string;
  steps: PlanStepView[];
}

export interface ReviewDiffView {
  summary: string;
  files: Array<{ path: string; status: string }>;
  patchPreview?: string;
}

export interface MemoryItemView {
  id: string;
  text: string;
  createdAt: string;
}

export interface CheckpointItemView {
  id: string;
  label: string;
  createdAt: string;
}

export interface SkillCatalogItem {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
}

export interface WorkspaceNoticeView {
  isTrusted: boolean;
  notice: string | null;
}

/** Webview → host */
export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'navigate'; nav: UiNav; settingsTab?: SettingsTab }
  | { type: 'setTab'; tab: UiNav }
  | {
      type: 'ask';
      prompt: string;
      mode: AgentUiMode;
      depth?: AgentUiDepth;
      pinnedPaths?: string[];
    }
  | { type: 'cancel' }
  | {
      type: 'resume';
      runId: string;
      clarificationAnswer?: string;
      approval?: { approvalId: string; decision: 'approved' | 'denied' };
      planDecision?: {
        decision: 'approved' | 'rejected' | 'edited';
      };
    }
  | { type: 'newChat' }
  | { type: 'openChatThread'; id: string }
  | { type: 'deleteChatThread'; id: string }
  | { type: 'clearChatHistory' }
  | { type: 'completeOnboarding' }
  | { type: 'showInlineDiff'; approvalId: string }
  | {
      type: 'openDiffPreview';
      path: string;
      proposedText?: string;
      oldText?: string;
    }
  | {
      type: 'toggleContextSource';
      source: keyof ContextToggles;
      enabled: boolean;
    }
  | { type: 'refreshReviewDiff' }
  | { type: 'restoreCheckpoint'; id: string }
  | { type: 'deleteCheckpoint'; id: string }
  | { type: 'clearCheckpoints' }
  | { type: 'deleteMemory'; id: string }
  | { type: 'clearMemory' }
  | {
      type: 'requestSkillCatalog';
      requestId: string;
      query?: string;
    }
  | { type: 'pickContextPath' }
  | { type: 'copyLastResponse' }
  | { type: 'approveAllPending' }
  | { type: 'settings.get' }
  | {
      type: 'settings.set';
      provider?: Partial<
        Pick<
          ProviderSettingsSnapshot,
          'type' | 'baseUrl' | 'model' | 'contextWindow' | 'maximumOutputTokens'
        >
      >;
      ui?: Partial<
        Omit<UiSettingsSnapshot, 'contextToggles'> & {
          contextToggles?: Partial<ContextToggles>;
        }
      >;
      workspaceRootOverride?: string | null;
      mcp?: McpSettings;
      approvalMode?: string;
    }
  | { type: 'settings.setApiKey' }
  | { type: 'settings.clearApiKey' }
  | {
      type: 'provider.testConnection';
      provider: { type: string; baseUrl: string; model: string };
    }
  | { type: 'index.refresh' }
  | { type: 'index.reindex' }
  | { type: 'paths.search'; query: string; requestId: string }
  | { type: 'openFolder' };

/** Host → webview */
export type HostToWebviewMessage =
  | {
      type: 'bootstrap';
      workspace: WorkspaceSnapshotInfo;
      provider: ProviderSettingsSnapshot;
      index: IndexStatusSnapshot;
      mcp: McpSettings;
      mcpRuntimeStatus: McpRuntimeStatus;
      /** Built-in MCP catalog available to install (not auto-installed). */
      mcpStore: McpServerConfig[];
      ui: UiSettingsSnapshot;
      tokenUsage: TokenUsageSnapshot;
      notice: WorkspaceNoticeView;
      onboardingRequired: boolean;
      flags: { skillManagement: boolean };
      history: ChatThreadSummary[];
      activeThreadId?: string;
      memories: MemoryItemView[];
      checkpoints: CheckpointItemView[];
    }
  | {
      type: 'settings';
      provider: ProviderSettingsSnapshot;
      ui: UiSettingsSnapshot;
      workspace: WorkspaceSnapshotInfo;
      mcp: McpSettings;
      mcpRuntimeStatus: McpRuntimeStatus;
      mcpStore: McpServerConfig[];
      tokenUsage: TokenUsageSnapshot;
      notice: WorkspaceNoticeView;
    }
  | { type: 'index.status'; index: IndexStatusSnapshot }
  | {
      type: 'provider.connectionResult';
      ok: boolean;
      message: string;
      models?: string[];
      testing?: boolean;
    }
  | { type: 'tokenUsage'; usage: TokenUsageSnapshot }
  | { type: 'run.started'; mode: AgentUiMode; prompt: string }
  | { type: 'run.event'; event: ActivityEventPayload }
  | { type: 'run.delta'; text: string }
  | { type: 'run.suspended'; suspension: SuspensionPayload }
  | { type: 'run.resumed'; runId: string }
  | {
      type: 'run.result';
      status: string;
      answer?: string;
      route?: string | null;
      error?: string;
      usage?: RunUsagePayload;
      plan?: PlanView | null;
    }
  | { type: 'run.cancelled' }
  | { type: 'error'; message: string }
  | { type: 'paths.results'; requestId: string; suggestions: PathSuggestion[] }
  | { type: 'openSettings'; tab?: SettingsTab }
  | { type: 'setTab'; tab: UiNav }
  | { type: 'editorPin'; path: string }
  | { type: 'workspaceNotice'; notice: WorkspaceNoticeView }
  | { type: 'history'; threads: ChatThreadSummary[]; activeThreadId?: string }
  | {
      type: 'thread.loaded';
      threadId: string;
      messages: ChatMessageView[];
    }
  | { type: 'setPlan'; plan: PlanView | null }
  | { type: 'setReviewDiff'; review: ReviewDiffView | null }
  | { type: 'setMemories'; memories: MemoryItemView[] }
  | { type: 'setCheckpoints'; checkpoints: CheckpointItemView[] }
  | {
      type: 'skillCatalogResult';
      requestId: string;
      items: SkillCatalogItem[];
      error?: string;
    }
  | { type: 'onboarding'; required: boolean };
