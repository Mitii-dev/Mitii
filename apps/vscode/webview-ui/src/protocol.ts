/**
 * Host ↔ webview message protocol (apps/vscode only).
 * Keep free of vscode / React imports so the webview can mirror these types.
 */

export type AgentUiMode = 'ask' | 'plan' | 'agent' | 'review';
export type AgentUiDepth = 'auto' | 'quick' | 'deep';
export type AgentUiEffort = 'low' | 'medium' | 'high';
/** Clubbed customer control → maps to depth + effort unless intensity overrides. */
export type AgentUiThoroughness = 'low' | 'medium' | 'high';
export type UiNav = 'chat' | 'history' | 'settings' | 'skills' | 'automations';
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

/**
 * Hierarchical window-budget node for the chat token meter.
 * Parents mirror WindowPolicy / PromptBudget; children are host sources.
 */
export interface ContextUsageNode {
  id: string;
  label: string;
  /** Tokens packed or reserved for this node. */
  usedTokens: number;
  /** Budget ceiling when known. */
  allocatedTokens?: number;
  omittedTokens?: number;
  truncatedTokens?: number;
  kind:
    | 'output'
    | 'tools'
    | 'usable'
    | 'section'
    | 'source'
    | 'free';
  active: boolean;
  children?: ContextUsageNode[];
}

export interface ContextUsageBreakdown {
  /** Flat host-source list (backward compatible). */
  slices: ContextUsageSlice[];
  /**
   * Window tree: Output → Tools → Usable → sections → host sources.
   * Prefer this in the UI when present.
   */
  tree?: ContextUsageNode[];
  totalTokens: number;
  contextWindow: number;
  /** Share of window used by packed input (0–1). */
  fillRatio: number;
  estimated: boolean;
  /** How the tree was produced. */
  source?: 'host_estimate' | 'prompt_budget';
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
  /** Preset id (ollama, openai, openrouter, …). */
  preset?: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  /** Discovered + preset model ids for the dropdown. */
  availableModels: string[];
  /** Stored context window. 0 means use the model preset. */
  contextWindow: number;
  /** Resolved window used at runtime when contextWindow is 0. */
  effectiveContextWindow?: number;
  /** Max tokens the model may generate per call. */
  maximumOutputTokens: number;
  connectionOk?: boolean;
  connectionStatus?: string;
}

export interface SettingsProfileView {
  id: string;
  name: string;
  provider: Pick<
    ProviderSettingsSnapshot,
    | 'type'
    | 'preset'
    | 'baseUrl'
    | 'model'
    | 'contextWindow'
    | 'maximumOutputTokens'
  >;
  hasSecret: boolean;
  ui?: UiSettingsSnapshot;
  /** SHA-256 fingerprint only. Raw secrets stay out of settings and profiles. */
  secretHash?: string;
  updatedAt?: string;
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
  /** Last prompt context breakdown (window tree + host sources). */
  contextBreakdown?: ContextUsageBreakdown;
}

export type SemanticIndexSource =
  | 'bundled'
  | 'ollama'
  | 'openai-compatible'
  | 'disabled';

export interface IndexStatusSnapshot {
  fileCount: number;
  truncated: boolean;
  maximumIndexFiles?: number;
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
  embeddingSource?: SemanticIndexSource;
  embeddingModel?: string;
  embeddingEnabled?: boolean;
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
  /** Working-set overlay: loop/mutation/repair caps. Default medium. */
  effort: AgentUiEffort;
  modeDefaults: Record<'ask' | 'plan' | 'agent', ModeDefaultSettingsSnapshot>;
  contextToggles: ContextToggles;
  approvalMode: string;
  runBudget: RunBudgetSettingsSnapshot;
  /** Master gate for Settings → Developer options. */
  developerEnabled: boolean;
  /**
   * When true, Modes/composer thoroughness is ignored and depth + effort are
   * edited separately under Developer → Intensity.
   */
  intensityOverrides: boolean;
  /** Maps to mitii.debug (verbose Output channel / stacks). */
  debugLogging: boolean;
  /**
   * Maps to mitii.developer.modelIo — sanitized request/response JSONL under
   * .mitii/logs/. Requires developerEnabled. (Not under mitii.debug — that
   * key is a boolean leaf in VS Code settings.)
   */
  modelIoLogging: boolean;
  /** Window-proportional token budget tunables (Debug → developer). */
  tokenBudget: TokenBudgetSettingsSnapshot;
  /** Agent Engine loop/stall threshold tunables (Debug → developer). */
  loopPolicy: LoopPolicySettingsSnapshot;
  /** Policy Admin — edits shipped V8 band tables (Save writes source). */
  policyLab: PolicyLabSettingsSnapshot;
}

export interface ModeDefaultSettingsSnapshot {
  /** Customer-facing Low / Medium / High for this mode. */
  thoroughness: AgentUiThoroughness;
  depth: AgentUiDepth;
  approvalMode: string;
  model?: string;
}

export interface RunBudgetSettingsSnapshot {
  unlimited: boolean;
  maxModelCalls: number;
  maxToolCalls: number;
  maxLoopIterations: number;
  maxWallTimeMinutes: number;
}

export interface TokenBudgetFieldDescriptor {
  key: string;
  group: string;
  label: string;
  description: string;
  docsHref?: string;
  kind: 'ratio' | 'int' | 'number';
  min: number;
  max?: number;
  step: number;
  defaultValue?: number;
  /** High-level Developer controls vs core ratio/clamp fields. */
  tier?: 'simple' | 'advanced';
  /** Hide fields owned by Modes → Run budget. */
  hiddenFromDebug?: boolean;
}

export interface TokenBudgetPreview {
  contextWindowTokens: number;
  maximumOutputTokens: number;
  toolSchemaTokens: number;
  usableInputTokens: number;
  loopInputBudgetTokens: number;
  repositoryTokens: number;
  conversationTokens: number;
  planTokens: number;
  skillsTokens: number;
  systemTokens: number;
  compactionWarnTokens: number;
  compactionAutoTokens: number;
  compactionHardTokens: number;
  keepRecentToolResults: number;
  compactedToolResultChars: number;
  compactedToolArgumentChars: number;
  toolResultContentChars: number;
  droppedTurnSummaryChars: number;
  establishedFactChars: number;
  maxEstablishedFacts: number;
  establishedFactReinjectChars: number;
  memoryReinjectChars: number;
  maxPatchesPerCall: number;
  maxModelCalls: number;
  maxToolCalls: number;
  maxUniqueFilesPerCall: number;
  maxPatchPayloadCharacters: number;
  requireBatchedExecution: boolean;
  maxDiagnosticSteps: number;
  maxTasks: number;
  maxSkills: number;
  maxVerificationChecks: number;
  visiblePlanAffordable: boolean;
  changeImpactAffordable: boolean;
  runBudgetUnlimited: boolean;
  runBudgetMaxModelCalls: number;
  runBudgetMaxToolCalls: number;
}

export interface TokenBudgetSettingsSnapshot {
  enabled: boolean;
  policy: Record<string, number>;
  fields: TokenBudgetFieldDescriptor[];
  preview: TokenBudgetPreview;
}

export interface LoopPolicyBandSnapshot {
  id: 'compact' | 'standard' | 'wide';
  label: string;
  rangeLabel: string;
  contextWindowTokens: number;
}

export interface LoopPolicySettingsSnapshot {
  enabled: boolean;
  /** Effective thresholds (band + optional lab overrides). */
  thresholds: Record<string, number>;
  /** Band-only shipped standards for the current context window. */
  bandThresholds: Record<string, number>;
  band: LoopPolicyBandSnapshot;
  fields: TokenBudgetFieldDescriptor[];
}

export interface PolicyLabBandOption {
  id: 'compact' | 'standard' | 'wide';
  label: string;
  rangeLabel: string;
}

export interface PolicyLabSettingsSnapshot {
  /** Unused at runtime — kept for patch compatibility. Always false. */
  enabled: boolean;
  /** Human path hint for ship sources. */
  filePath: string;
  exists: boolean;
  previewContextWindowTokens: number;
  activeBand: LoopPolicyBandSnapshot;
  editBand: 'compact' | 'standard' | 'wide';
  bands: PolicyLabBandOption[];
  /** Full draft maps for all bands (Save writes these into V8 source). */
  loopByBand: Record<'compact' | 'standard' | 'wide', Record<string, number>>;
  windowByBand: Record<'compact' | 'standard' | 'wide', Record<string, number>>;
  /** Convenience aliases for the currently edited band. */
  loopOverrides: Record<string, number>;
  windowOverrides: Record<string, number>;
  loopThresholds: Record<string, number>;
  loopBandThresholds: Record<string, number>;
  windowPolicy: Record<string, number>;
  windowBandPolicy: Record<string, number>;
  loopFields: TokenBudgetFieldDescriptor[];
  windowFields: TokenBudgetFieldDescriptor[];
  loopBandHint: string;
  shipPreviewNote: string;
}

export type UiSettingsPatch = Partial<
  Omit<
    UiSettingsSnapshot,
    | 'contextToggles'
    | 'runBudget'
    | 'modeDefaults'
    | 'tokenBudget'
    | 'loopPolicy'
    | 'policyLab'
  > & {
    contextToggles?: Partial<ContextToggles>;
    runBudget?: Partial<RunBudgetSettingsSnapshot>;
    modeDefaults?: Partial<
      Record<'ask' | 'plan' | 'agent', Partial<ModeDefaultSettingsSnapshot>>
    >;
    tokenBudget?: {
      enabled?: boolean;
      policy?: Record<string, number>;
    };
    loopPolicy?: {
      enabled?: boolean;
      thresholds?: Record<string, number>;
      bandThresholds?: Record<string, number>;
      band?: LoopPolicyBandSnapshot;
    };
    policyLab?: Partial<PolicyLabSettingsSnapshot>;
  }
>;

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
  /** Plain-text plan/answer shown while a plan approval is suspended. */
  planText?: string;
  approval?: {
    approvalId: string;
    toolName: string;
    paths?: string[];
    proposedText?: string;
    arguments?: unknown;
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
  /** Compact activity timeline for restore after reload (assistant turns). */
  activity?: ActivityEventPayload[];
  /** File mutations from this turn, restored with the message. */
  fileChanges?: RunFileChangesView;
  status?: string;
  route?: string | null;
}

export interface PlanStepView {
  id: string;
  title: string;
  status: 'pending' | 'active' | 'done' | 'skipped';
  detail?: string;
  riskLevel?: string;
  targetRefs?: string[];
  expectedOutcome?: string;
  verification?: string;
}

export interface PlanPhaseView {
  id: string;
  name: string;
  purpose?: string;
  steps: PlanStepView[];
}

export interface PlanRiskView {
  id: string;
  summary: string;
  severity?: string;
  mitigation?: string;
}

export interface PlanDimensionsView {
  scope: string;
  risk: string;
  clarity: string;
  complexity: string;
}

export interface PlanView {
  title: string;
  /** Flat steps kept for back-compat with older UI/history. */
  steps: PlanStepView[];
  objective?: string;
  dimensions?: PlanDimensionsView;
  phases?: PlanPhaseView[];
  risks?: PlanRiskView[];
  openQuestions?: string[];
  verificationSummary?: string;
  /** Workspace-relative path to the saved markdown plan under `.mitii/plans/`. */
  savedPlanPath?: string;
}


export interface ReviewDiffView {
  summary: string;
  files: Array<{ path: string; status: string }>;
  patchPreview?: string;
}

/** Per-file stats for an agent run's mutations. */
export interface FileChangeEntryView {
  path: string;
  additions: number;
  deletions: number;
  status: 'A' | 'M' | 'D' | '?';
  /** Truncated unified-diff style preview. */
  patchPreview?: string;
  /** True when the path was already dirty before the run started. */
  wasPreDirty?: boolean;
}

/** Summary of files this agent run changed. */
export interface RunFileChangesView {
  runId: string;
  files: FileChangeEntryView[];
  totalAdditions: number;
  totalDeletions: number;
  /** Count of pre-existing dirty files left untouched. */
  leftUntouchedPreDirty?: number;
}

export type ContextPinSource = 'auto' | 'user';

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

export interface AutomationSpecView {
  specId: string;
  title: string;
  enabled: boolean;
  triggerKind: string;
  scheduleExpr?: string | null;
  eventType?: string | null;
  nextRunAt?: string | null;
  autonomyPreset?: string | null;
}

export interface AutomationRunView {
  runId: string;
  specId: string;
  status: string;
  createdAt: string;
  error?: string | null;
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
      effort?: AgentUiEffort;
      approvalMode?: string;
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
  | { type: 'addMemory'; text: string }
  | { type: 'deleteMemory'; id: string }
  | { type: 'clearMemory' }
  | {
      type: 'requestSkillCatalog';
      requestId: string;
      query?: string;
    }
  | { type: 'requestAutomations'; requestId: string }
  | { type: 'automation.trigger'; specId: string }
  | { type: 'automation.pause'; specId: string }
  | { type: 'automation.resume'; specId: string }
  | { type: 'pickContextPath' }
  | { type: 'copyLastResponse' }
  | { type: 'approveAllPending' }
  | { type: 'settings.get' }
  | {
      type: 'settings.set';
      provider?: Partial<
        Pick<
          ProviderSettingsSnapshot,
          | 'type'
          | 'preset'
          | 'baseUrl'
          | 'model'
          | 'contextWindow'
          | 'maximumOutputTokens'
        >
      >;
      ui?: UiSettingsPatch;
      workspaceRootOverride?: string | null;
      mcp?: McpSettings;
      approvalMode?: string;
      workspaceMaximumIndexFiles?: number;
      profile?: SettingsProfileView;
      semanticIndex?: {
        source?: SemanticIndexSource;
      };
    }
  | { type: 'settings.setApiKey' }
  | { type: 'settings.clearApiKey' }
  | { type: 'settings.resetTokenBudget' }
  | { type: 'settings.resetLoopPolicy' }
  | {
      type: 'settings.savePolicyLab';
      policyLab: PolicyLabSettingsSnapshot;
    }
  | {
      type: 'settings.setPolicyLabEditBand';
      band: 'compact' | 'standard' | 'wide';
      /** Carry draft maps so switching bands does not lose unsaved edits. */
      policyLab?: PolicyLabSettingsSnapshot;
    }
  | { type: 'profile.switch'; id: string }
  | {
      type: 'provider.testConnection';
      provider: { type: string; baseUrl: string; model: string };
    }
  | {
      type: 'provider.listModels';
      provider: { type: string; baseUrl: string };
    }
  | { type: 'index.refresh' }
  | { type: 'index.reindex' }
  | { type: 'paths.search'; query: string; requestId: string }
  | { type: 'openFolder' }
  | { type: 'openFile'; path: string; line?: number; column?: number }
  | { type: 'undoFileChanges'; runId: string }
  | { type: 'reviewFileChange'; runId: string; path: string }
  | { type: 'reviewWorkspaceFile'; path: string }
  | { type: 'dismissFileChanges'; runId: string }
  /** Drop the active thread's pending plan without starting a run. */
  | { type: 'clearPendingPlan' };

/** Host → webview */
export type HostToWebviewMessage =
  | {
      type: 'bootstrap';
      workspace: WorkspaceSnapshotInfo;
      provider: ProviderSettingsSnapshot;
      profiles: SettingsProfileView[];
      activeProfileId: string;
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
      activeThreadMessages?: ChatMessageView[];
      /** Pending plan awaiting Agent-mode handoff for the active thread. */
      pendingPlan?: PlanView | null;
      memories: MemoryItemView[];
      checkpoints: CheckpointItemView[];
    }
  | {
      type: 'settings';
      provider: ProviderSettingsSnapshot;
      profiles: SettingsProfileView[];
      activeProfileId: string;
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
  | { type: 'provider.models'; models: string[] }
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
      /** Explicit pending-plan handoff state for the active thread. */
      pendingPlan?: PlanView | null;
    }
  | { type: 'run.cancelled' }
  | { type: 'error'; message: string }
  | { type: 'paths.results'; requestId: string; suggestions: PathSuggestion[] }
  | { type: 'openSettings'; tab?: SettingsTab }
  | { type: 'setTab'; tab: UiNav }
  | { type: 'editorPin'; path: string; source?: ContextPinSource }
  | { type: 'editorUnpin'; path: string }
  | { type: 'syncAutoPins'; paths: string[] }
  | { type: 'run.fileChanges'; changes: RunFileChangesView }
  | { type: 'fileChanges.undone'; runId: string; restored: string[] }
  | { type: 'workspaceNotice'; notice: WorkspaceNoticeView }
  | { type: 'history'; threads: ChatThreadSummary[]; activeThreadId?: string }
  | {
      type: 'thread.loaded';
      threadId: string;
      messages: ChatMessageView[];
      /** Pending plan awaiting Agent-mode handoff for this thread. */
      pendingPlan?: PlanView | null;
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
  | {
      type: 'automationsResult';
      requestId: string;
      specs: AutomationSpecView[];
      runs: AutomationRunView[];
      error?: string;
    }
  | { type: 'onboarding'; required: boolean };
