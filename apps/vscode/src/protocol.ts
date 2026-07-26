/**
 * Host ↔ webview message protocol (apps/vscode only).
 * Keep free of vscode / React imports so the webview can mirror these types.
 */

export type AgentUiMode = 'ask' | 'plan' | 'agent';
export type AgentUiDepth = 'auto' | 'quick' | 'deep';
export type UiNav = 'chat' | 'settings';
export type SettingsTab = 'workspace' | 'index' | 'settings' | 'mcp';

export type McpTransport = 'stdio' | 'sse' | 'streamable-http';

export interface McpServerConfig {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
}

export interface McpSettings {
  enabled: boolean;
  servers: McpServerConfig[];
}

export interface ProviderSettingsSnapshot {
  type: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  /** Discovered + preset model ids for the dropdown. */
  availableModels: string[];
  connectionOk?: boolean;
  connectionStatus?: string;
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
}

export interface IndexStatusSnapshot {
  fileCount: number;
  truncated: boolean;
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

export interface SuspensionPayload {
  runId: string;
  kind: 'clarification_required' | 'approval_required';
  rationale?: string;
  clarificationPrompt?: string;
  approval?: {
    approvalId: string;
    toolName: string;
    paths?: string[];
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

/** Webview → host */
export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'navigate'; nav: UiNav; settingsTab?: SettingsTab }
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
    }
  | { type: 'settings.get' }
  | {
      type: 'settings.set';
      provider?: Partial<
        Pick<ProviderSettingsSnapshot, 'type' | 'baseUrl' | 'model'>
      >;
      ui?: Partial<UiSettingsSnapshot>;
      workspaceRootOverride?: string | null;
      mcp?: McpSettings;
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
      ui: UiSettingsSnapshot;
      tokenUsage: TokenUsageSnapshot;
    }
  | {
      type: 'settings';
      provider: ProviderSettingsSnapshot;
      ui: UiSettingsSnapshot;
      workspace: WorkspaceSnapshotInfo;
      mcp: McpSettings;
      tokenUsage: TokenUsageSnapshot;
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
  | {
      type: 'run.result';
      status: string;
      answer?: string;
      route?: string | null;
      error?: string;
      usage?: RunUsagePayload;
    }
  | { type: 'run.cancelled' }
  | { type: 'error'; message: string }
  | { type: 'paths.results'; requestId: string; suggestions: PathSuggestion[] }
  | { type: 'openSettings'; tab?: SettingsTab };
