import { useState, useEffect, useCallback } from 'react';
import { AGENT_NAME } from '../../../shared/brand';
import type {
  ApprovalMode,
  ContextToggles,
  McpToggles,
  ProviderSettingsPayload,
  SafetySettingsPayload,
  SettingsView,
  IndexingStatusView,
  ThunderSettingsPayload,
  VectorIndexStatusView,
  WorkspaceNoticeView,
} from '../../../vscode/webview/messages';
import { McpServersEditor } from './McpServersEditor';
import { WorkspaceSettingsSection } from './WorkspaceSettingsSection';
import { SettingsCard } from './SettingsCard';
import { SettingSwitch } from './SettingSwitch';
import { SettingStepper } from './SettingStepper';
import {
  APPROVAL_MODE_OPTIONS,
  approvalModeDescription,
  deriveSafetySettings,
} from '../utils/approvalMode';

type SettingsTab = 'workspace' | 'model' | 'agent' | 'context' | 'integrations' | 'safety' | 'debug';

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'model', label: 'Model' },
  { id: 'agent', label: 'Agent' },
  { id: 'context', label: 'Context' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'safety', label: 'Safety' },
  { id: 'debug', label: 'Debug' },
];

const CONTEXT_TOGGLES: Array<{
  key: keyof ContextToggles;
  label: string;
  description: string;
}> = [
  {
    key: 'repoMap',
    label: 'Repository map',
    description: 'Symbol outline so the model knows what files and exports exist.',
  },
  {
    key: 'fts',
    label: 'Full-text search',
    description: 'Keyword search over indexed files for symbols, imports, and strings.',
  },
  {
    key: 'gitDiff',
    label: 'Git diff',
    description: 'Uncommitted changes so the agent sees what you are already editing.',
  },
  {
    key: 'diagnostics',
    label: 'Diagnostics',
    description: 'Linter and TypeScript errors. Enable when fixing bugs.',
  },
  {
    key: 'memory',
    label: 'Session memory',
    description: 'Notes from past tasks injected into new chats.',
  },
  {
    key: 'vectors',
    label: 'Semantic vectors',
    description: 'Conceptual code search — finds related files even when wording differs.',
  },
];

const MCP_BUILTIN_TOGGLES: Array<{
  key: keyof McpToggles;
  label: string;
  description: string;
}> = [
  {
    key: 'filesystem',
    label: 'Filesystem',
    description: 'Scoped file access via @modelcontextprotocol/server-filesystem.',
  },
  {
    key: 'memory',
    label: 'MCP memory',
    description: 'Knowledge-graph memory server. Thunder also has built-in session memory.',
  },
  {
    key: 'sequentialThinking',
    label: 'Sequential thinking',
    description: 'Structured reasoning helper for multi-step problems.',
  },
];

const LOCAL_MODEL_PRESETS: Array<{
  model: string;
  label: string;
  contextWindow?: number;
}> = [
  { model: 'devstral-small-2:24b', label: 'Devstral Small 2 24B' },
  { model: 'codestral:22b', label: 'Codestral 22B' },
  { model: 'deepseek-coder:33b-instruct-q4_0', label: 'DeepSeek Coder 33B Instruct Q4_0' },
  { model: 'qwen3-coder:30b', label: 'Qwen3 Coder 30B' },
  { model: 'qwen3.6:27b', label: 'Qwen3.6 27B' },
  { model: 'qwen3.5:latest', label: 'Qwen3.5 latest - 6.6GB - 256K - Text/Image', contextWindow: 256_000 },
  { model: 'qwen3.5:0.8b', label: 'Qwen3.5 0.8B - 1.0GB - 256K - Text/Image', contextWindow: 256_000 },
  { model: 'qwen3.5:2b', label: 'Qwen3.5 2B - 2.7GB - 256K - Text/Image', contextWindow: 256_000 },
  { model: 'qwen3.5:4b', label: 'Qwen3.5 4B - 3.4GB - 256K - Text/Image', contextWindow: 256_000 },
  { model: 'qwen3.5:9b', label: 'Qwen3.5 9B - 6.6GB - 256K - Text/Image', contextWindow: 256_000 },
  { model: 'gemma4:latest', label: 'Gemma4 latest - 9.6GB - 128K - Text/Image', contextWindow: 128_000 },
  { model: 'gemma4:e2b', label: 'Gemma4 E2B - 7.2GB - 128K - Text/Image', contextWindow: 128_000 },
  { model: 'gemma4:e4b', label: 'Gemma4 E4B - 9.6GB - 128K - Text/Image', contextWindow: 128_000 },
  { model: 'gemma4:12b', label: 'Gemma4 12B - 7.6GB - 256K - Text/Image', contextWindow: 256_000 },
  { model: 'gemma4:26b', label: 'Gemma4 26B - 18GB - 256K - Text/Image', contextWindow: 256_000 },
  { model: 'gemma4:31b', label: 'Gemma4 31B - 20GB - 256K - Text/Image', contextWindow: 256_000 },
];

interface SettingsPanelProps {
  settings: SettingsView;
  workspaceOpen: boolean;
  workspacePath: string;
  vscodeWorkspaceFolders: string[];
  workspaceOverride: string;
  usingWorkspaceOverride: boolean;
  indexDbPath: string;
  indexing: IndexingStatusView;
  workspaceNotice: WorkspaceNoticeView | null;
  contextToggles: ContextToggles;
  mcpToggles: McpToggles;
  vectorIndex: VectorIndexStatusView;
  onSaveApiKey: (key: string) => void;
  onSaveAllSettings: (settings: ThunderSettingsPayload) => void;
  onTestConnection: (settings: ProviderSettingsPayload) => void;
  onPickWorkspaceFolder: () => void;
  onSetWorkspaceOverride: (path: string) => void;
  onClearWorkspaceOverride: () => void;
  onIndex: () => void;
  onToggleContext: (source: keyof ContextToggles, enabled: boolean) => void;
  onToggleMcp: (server: keyof McpToggles, enabled: boolean) => void;
  onSaveCustomMcpServers: (servers: import('../../../vscode/webview/messages').McpCustomServerView[]) => void;
  onSaveProviderSettings: (settings: ProviderSettingsPayload) => void;
}

export function SettingsPanel({
  settings,
  workspaceOpen,
  workspacePath,
  vscodeWorkspaceFolders,
  workspaceOverride,
  usingWorkspaceOverride,
  indexDbPath,
  indexing,
  workspaceNotice,
  contextToggles,
  mcpToggles,
  vectorIndex,
  onSaveApiKey,
  onSaveAllSettings,
  onTestConnection,
  onPickWorkspaceFolder,
  onSetWorkspaceOverride,
  onClearWorkspaceOverride,
  onIndex,
  onToggleContext,
  onToggleMcp,
  onSaveCustomMcpServers,
  onSaveProviderSettings,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('workspace');
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [providerType, setProviderType] = useState<'echo' | 'openai-compatible'>(
    settings.providerType as 'echo' | 'openai-compatible'
  );
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [contextWindow, setContextWindow] = useState(settings.contextWindow);

  const [subagentsEnabled, setSubagentsEnabled] = useState(settings.subagentsEnabled);
  const [agentMaxSteps, setAgentMaxSteps] = useState(settings.agentMaxSteps);
  const [agentAutoContinue, setAgentAutoContinue] = useState(settings.agentAutoContinue);
  const [agentMaxAutoContinues, setAgentMaxAutoContinues] = useState(settings.agentMaxAutoContinues);
  const [researchAgentMaxSteps, setResearchAgentMaxSteps] = useState(settings.researchAgentMaxSteps);
  const [showDiffPreview, setShowDiffPreview] = useState(settings.showDiffPreview);

  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(settings.approvalMode);
  const [mcpEnabled, setMcpEnabled] = useState(settings.mcpEnabled);
  const [sessionLogging, setSessionLogging] = useState(settings.sessionLogging);
  const [debugMetrics, setDebugMetrics] = useState(settings.debugMetrics);
  const [vectorsEnabled, setVectorsEnabled] = useState(settings.vectorsEnabled);
  const [embeddingProvider, setEmbeddingProvider] = useState<'minilm' | 'hash'>(settings.embeddingProvider);
  const [vectorBackend, setVectorBackend] = useState<'sqlite' | 'lancedb'>(settings.vectorBackend);
  const [hybridMemorySearch, setHybridMemorySearch] = useState(settings.hybridMemorySearch);

  useEffect(() => {
    setProviderType(settings.providerType as 'echo' | 'openai-compatible');
    setBaseUrl(settings.baseUrl);
    setModel(settings.model);
    setContextWindow(settings.contextWindow);
    setSubagentsEnabled(settings.subagentsEnabled);
    setAgentMaxSteps(settings.agentMaxSteps);
    setAgentAutoContinue(settings.agentAutoContinue);
    setAgentMaxAutoContinues(settings.agentMaxAutoContinues);
    setResearchAgentMaxSteps(settings.researchAgentMaxSteps);
    setShowDiffPreview(settings.showDiffPreview);
    setApprovalMode(settings.approvalMode);
    setMcpEnabled(settings.mcpEnabled);
    setSessionLogging(settings.sessionLogging);
    setDebugMetrics(settings.debugMetrics);
    setVectorsEnabled(settings.vectorsEnabled);
    setEmbeddingProvider(settings.embeddingProvider);
    setVectorBackend(settings.vectorBackend);
    setHybridMemorySearch(settings.hybridMemorySearch);
    setDirty(false);
  }, [settings]);

  const markDirty = useCallback(() => setDirty(true), []);

  const clampContextWindow = (value: number) =>
    Math.max(1024, Math.min(Number.isFinite(value) ? Math.floor(value) : 1024, 1_000_000));

  const applyModelPreset = (value: string) => {
    const preset = LOCAL_MODEL_PRESETS.find((item) => item.model === value.trim());
    if (preset?.contextWindow) {
      setContextWindow(preset.contextWindow);
    }
  };

  const buildPayload = (): ThunderSettingsPayload | null => {
    if (!baseUrl.trim() || !model.trim() || contextWindow < 1024) {
      return null;
    }
    return {
      provider: {
        providerType,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        contextWindow,
      },
      agent: {
        subagentsEnabled,
        maxSteps: agentMaxSteps,
        autoContinue: agentAutoContinue,
        maxAutoContinues: agentMaxAutoContinues,
        researchAgentMaxSteps,
        showDiffPreview,
      },
      safety: deriveSafetySettings(approvalMode),
      mcp: { enabled: mcpEnabled, builtinServers: mcpToggles },
      indexing: {
        vectorsEnabled,
        embeddingProvider,
        vectorBackend,
        hybridMemorySearch,
      },
      telemetry: {
        sessionLogging,
        debugMetrics: settings.localDebugAvailable && sessionLogging ? debugMetrics : false,
      },
    };
  };

  const handleSaveAll = () => {
    const payload = buildPayload();
    if (!payload) return;
    onSaveAllSettings(payload);
    if (apiKey.trim()) {
      onSaveApiKey(apiKey.trim());
      setApiKey('');
    }
    setSaved(true);
    setDirty(false);
    setTimeout(() => setSaved(false), 2500);
  };

  const currentProviderSettings = (): ProviderSettingsPayload => ({
    providerType,
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    contextWindow,
  });

  const persistContextWindow = (value: number) => {
    const next = clampContextWindow(value);
    setContextWindow(next);
    onSaveProviderSettings({
      ...currentProviderSettings(),
      contextWindow: next,
    });
  };

  const contextWindowField = (
    <label className="settings-field">
      <span className="settings-label">Context window (tokens)</span>
      <input
        type="number"
        className="settings-input"
        min={1024}
        max={1_000_000}
        step={1}
        value={contextWindow}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed)) {
            setContextWindow(parsed);
            markDirty();
          }
        }}
        onBlur={(e) => persistContextWindow(Number(e.target.value))}
      />
      <span className="settings-hint">
        Hard cap per model request. Prompts trim automatically when over budget (min 1024).
      </span>
    </label>
  );

  const isLocalProvider = providerType === 'openai-compatible';
  const showSaveBar = activeTab !== 'workspace' && activeTab !== 'context';
  const visibleTabs = settings.localDebugAvailable
    ? TABS
    : TABS.filter((tab) => tab.id !== 'debug');

  return (
    <div className="settings-shell">
      <header className="settings-shell__header">
        <div>
          <h2 className="settings-shell__title">Settings</h2>
          <p className="settings-shell__subtitle">
            Configure {AGENT_NAME} for your workspace and model. Changes apply on save.
          </p>
        </div>
      </header>

      <nav className="settings-nav" aria-label="Settings sections">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`settings-nav__item ${activeTab === tab.id ? 'settings-nav__item--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="settings-shell__content">
        {activeTab === 'workspace' && (
          <WorkspaceSettingsSection
            workspaceOpen={workspaceOpen}
            workspacePath={workspacePath}
            vscodeWorkspaceFolders={vscodeWorkspaceFolders}
            workspaceOverride={workspaceOverride}
            usingWorkspaceOverride={usingWorkspaceOverride}
            indexDbPath={indexDbPath}
            indexing={indexing}
            workspaceNotice={workspaceNotice}
            onPickFolder={onPickWorkspaceFolder}
            onSetOverride={onSetWorkspaceOverride}
            onClearOverride={onClearWorkspaceOverride}
            onIndex={onIndex}
          />
        )}

        {activeTab === 'model' && (
          <>
            <SettingsCard
              title="Provider"
              description={`Endpoint ${AGENT_NAME} calls for chat completions and tool loops.`}
            >
              <label className="settings-field">
                <span className="settings-label">Provider type</span>
                <select
                  className="settings-input settings-select"
                  value={providerType}
                  onChange={(e) => {
                    setProviderType(e.target.value as 'echo' | 'openai-compatible');
                    markDirty();
                  }}
                >
                  <option value="echo">Echo (test / no LLM)</option>
                  <option value="openai-compatible">OpenAI-compatible (Ollama, LM Studio, cloud)</option>
                </select>
              </label>

              {isLocalProvider && (
                <>
                  <label className="settings-field">
                    <span className="settings-label">API base URL</span>
                    <input
                      type="url"
                      className="settings-input"
                      value={baseUrl}
                      onChange={(e) => {
                        setBaseUrl(e.target.value);
                        markDirty();
                      }}
                      placeholder="http://localhost:11434/v1"
                    />
                  </label>

                  <label className="settings-field">
                    <span className="settings-label">Model</span>
                    <input
                      type="text"
                      className="settings-input"
                      list="local-model-presets"
                      value={model}
                      onChange={(e) => {
                        const value = e.target.value;
                        setModel(value);
                        applyModelPreset(value);
                        markDirty();
                      }}
                      placeholder="qwen3-coder:30b"
                    />
                    <datalist id="local-model-presets">
                      {LOCAL_MODEL_PRESETS.map((preset) => (
                        <option key={preset.model} value={preset.model} label={preset.label} />
                      ))}
                    </datalist>
                    <span className="settings-hint">
                      Pick a local Ollama model or type any OpenAI-compatible model name.
                    </span>
                  </label>

                  {contextWindowField}
                </>
              )}

              {providerType === 'echo' && (
                <>
                  <p className="settings-inline-note">
                    Echo mode repeats your message — useful to verify workspace, indexing, and UI without a model.
                  </p>
                  {contextWindowField}
                </>
              )}

              <div className="settings-inline-actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => onTestConnection(currentProviderSettings())}
                >
                  Test connection
                </button>
                {settings.connectionStatus && (
                  <span
                    className={`settings-status-pill ${settings.connectionOk ? 'settings-status-pill--ok' : 'settings-status-pill--err'}`}
                    role="status"
                  >
                    {settings.connectionStatus}
                  </span>
                )}
              </div>
            </SettingsCard>

            <SettingsCard title="API key" description="Optional for local Ollama. Stored in VS Code SecretStorage.">
              <div className="settings-key-row">
                <input
                  type="password"
                  className="settings-input"
                  placeholder={settings.hasApiKey ? 'Key saved — enter to replace' : 'Enter API key…'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
              <p className="settings-inline-note">
                Status: <strong>{settings.hasApiKey ? 'Saved' : 'Not set'}</strong>
              </p>
            </SettingsCard>
          </>
        )}

        {activeTab === 'agent' && (
          <SettingsCard
            title="Agent behavior"
            description="Control tool rounds, subagents, and editor integration."
          >
            <SettingSwitch
              label="Research subagents"
              description="Parallel read-only investigation via spawn_research_agent."
              checked={subagentsEnabled}
              onChange={(v) => {
                setSubagentsEnabled(v);
                markDirty();
              }}
            />
            <SettingSwitch
              label="Auto-continue rounds"
              description="Keep working after the main step budget is spent."
              checked={agentAutoContinue}
              onChange={(v) => {
                setAgentAutoContinue(v);
                markDirty();
              }}
            />
            <SettingSwitch
              label="Diff previews"
              description="Open VS Code diff tabs before file edits."
              checked={showDiffPreview}
              onChange={(v) => {
                setShowDiffPreview(v);
                markDirty();
              }}
            />

            <div className="settings-divider" />

            <SettingStepper
              label="Main agent max steps"
              value={agentMaxSteps}
              min={1}
              max={100}
              onChange={(v) => {
                setAgentMaxSteps(v);
                markDirty();
              }}
            />
            <SettingStepper
              label="Max auto-continues"
              value={agentMaxAutoContinues}
              min={0}
              max={10}
              disabled={!agentAutoContinue}
              onChange={(v) => {
                setAgentMaxAutoContinues(v);
                markDirty();
              }}
            />
            <SettingStepper
              label="Research subagent max steps"
              value={researchAgentMaxSteps}
              min={1}
              max={50}
              disabled={!subagentsEnabled}
              onChange={(v) => {
                setResearchAgentMaxSteps(v);
                markDirty();
              }}
            />
          </SettingsCard>
        )}

        {activeTab === 'context' && (
          <>
            <SettingsCard
              title="Context window"
              description="Set your model's context limit. Thunder trims prompts to stay within this budget."
            >
              {contextWindowField}
            </SettingsCard>

            <SettingsCard
              title="Semantic vector search"
              description="Local embeddings for conceptual code search, smarter reranking, and hybrid memory recall."
            >
              <SettingSwitch
                label="Enable vector indexing"
                description="Embed code chunks during indexing. Uses MiniLM locally when available, hash fallback otherwise."
                checked={vectorsEnabled}
                onChange={(v) => {
                  setVectorsEnabled(v);
                  markDirty();
                }}
              />

              <label className="settings-field">
                <span className="settings-label">Embedding provider</span>
                <select
                  className="settings-input settings-select"
                  value={embeddingProvider}
                  disabled={!vectorsEnabled}
                  onChange={(e) => {
                    setEmbeddingProvider(e.target.value as 'minilm' | 'hash');
                    markDirty();
                  }}
                >
                  <option value="minilm">
                    MiniLM (Xenova/all-MiniLM-L6-v2){settings.minilmAvailable ? '' : ' — not installed'}
                  </option>
                  <option value="hash">Hash fallback (lightweight, lower quality)</option>
                </select>
                <span className="settings-hint">
                  {settings.minilmAvailable
                    ? 'MiniLM runs fully on your machine via @xenova/transformers.'
                    : 'Install @xenova/transformers for better semantic search, or use hash fallback.'}
                </span>
              </label>

              <label className="settings-field">
                <span className="settings-label">Vector storage backend</span>
                <select
                  className="settings-input settings-select"
                  value={vectorBackend}
                  disabled={!vectorsEnabled}
                  onChange={(e) => {
                    setVectorBackend(e.target.value as 'sqlite' | 'lancedb');
                    markDirty();
                  }}
                >
                  <option value="sqlite">SQLite (.mitii/mitii.sqlite)</option>
                  <option value="lancedb">
                    LanceDB (.mitii/lance/){settings.lancedbAvailable ? '' : ' — not installed'}
                  </option>
                </select>
                <span className="settings-hint">
                  LanceDB scales better on large repos; SQLite is simpler and always available.
                </span>
              </label>

              <SettingSwitch
                label="Hybrid memory search"
                description="Combine keyword + vector search when recalling saved observations."
                checked={hybridMemorySearch}
                disabled={!vectorsEnabled}
                onChange={(v) => {
                  setHybridMemorySearch(v);
                  markDirty();
                }}
              />

              <div className="settings-stats-row">
                <div className="settings-stat">
                  <span className="settings-stat__value">{vectorIndex.embeddedChunks.toLocaleString()}</span>
                  <span className="settings-stat__label">Embedded chunks</span>
                </div>
                <div className="settings-stat">
                  <span className="settings-stat__value">{vectorIndex.provider}</span>
                  <span className="settings-stat__label">Provider active</span>
                </div>
                <div className="settings-stat">
                  <span className="settings-stat__value">{vectorIndex.backend}</span>
                  <span className="settings-stat__label">Backend</span>
                </div>
              </div>

              <p className="settings-inline-note">
                Save settings after changing vector options, then run <strong>Reindex workspace</strong> to rebuild embeddings.
              </p>
            </SettingsCard>

            <SettingsCard
              title="Context sources"
              description="Mixed into the prompt before the model runs. Toggles apply immediately."
            >
            {CONTEXT_TOGGLES.map(({ key, label, description }) => (
              <SettingSwitch
                key={key}
                label={label}
                description={description}
                checked={contextToggles[key]}
                disabled={key === 'vectors' && !vectorsEnabled}
                onChange={(enabled) => onToggleContext(key, enabled)}
              />
            ))}
            </SettingsCard>
          </>
        )}

        {activeTab === 'integrations' && (
          <>
            <SettingsCard
              title="Model Context Protocol (MCP)"
              description="Enable built-in servers per task and add custom MCP servers without editing JSON."
            >
              <SettingSwitch
                label="Enable MCP"
                description="Load MCP tools for this session. Built-in servers can be toggled below."
                checked={mcpEnabled}
                onChange={(v) => {
                  setMcpEnabled(v);
                  markDirty();
                }}
              />

              <div className="settings-subsection">
                <h4 className="settings-subsection__title">Built-in servers</h4>
                <p className="settings-inline-note">Toggles apply immediately for this session. Save settings to remember defaults.</p>
                {MCP_BUILTIN_TOGGLES.map(({ key, label, description }) => (
                  <SettingSwitch
                    key={key}
                    label={label}
                    description={description}
                    checked={mcpToggles[key]}
                    disabled={!mcpEnabled}
                    onChange={(enabled) => onToggleMcp(key, enabled)}
                  />
                ))}
              </div>

              <div className="settings-stats-row">
                <div className="settings-stat">
                  <span className="settings-stat__value">{settings.mcpServers}</span>
                  <span className="settings-stat__label">Servers</span>
                </div>
                <div className="settings-stat">
                  <span className="settings-stat__value">{settings.mcpTools}</span>
                  <span className="settings-stat__label">Tools</span>
                </div>
                <div className="settings-stat">
                  <span className="settings-stat__value">{settings.projectRules}</span>
                  <span className="settings-stat__label">Rules</span>
                </div>
              </div>

              {settings.mcpServerStatuses.length > 0 ? (
                <ul className="settings-mcp-list">
                  {settings.mcpServerStatuses.map((server) => (
                    <li key={server.name} className="settings-mcp-item">
                      <span className={`settings-mcp-dot ${server.connected ? 'settings-mcp-dot--ok' : 'settings-mcp-dot--err'}`} />
                      <span className="settings-mcp-name">
                        {server.name}
                        {server.builtin ? <span className="settings-mcp-badge">built-in</span> : null}
                      </span>
                      <span className="settings-mcp-meta">
                        {server.connected
                          ? `${server.toolCount} tool${server.toolCount === 1 ? '' : 's'}`
                          : server.error ?? 'Disconnected'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="settings-inline-note">
                  No MCP servers connected yet. Built-in servers start when a workspace folder is open and MCP is enabled.
                </p>
              )}
            </SettingsCard>

            <SettingsCard
              title="Custom MCP servers"
              description="Add stdio MCP servers from the UI instead of hand-editing mcp.json."
            >
              <McpServersEditor
                servers={settings.customMcpServers}
                workspaceOpen={workspaceOpen}
                onSave={onSaveCustomMcpServers}
              />
            </SettingsCard>

            <SettingsCard title="Project rules" description="Automatically loaded from your workspace.">
              <p className="settings-inline-note">
                {AGENT_NAME} reads <code>AGENTS.md</code>, <code>CLAUDE.md</code>, <code>.mitii/rules</code>,{' '}
                <code>.clinerules</code>, and Continue/Cursor rule folders into context.
              </p>
              <p className="settings-inline-note">
                Active rule files: <strong>{settings.projectRules}</strong>
              </p>
            </SettingsCard>
          </>
        )}

        {activeTab === 'safety' && (
          <SettingsCard
            title="Approval policy"
            description={`When ${AGENT_NAME} pauses for review before edits or shell commands.`}
          >
            <label className="settings-field">
              <span className="settings-label">Approval mode</span>
              <select
                className="settings-input settings-select"
                value={approvalMode}
                onChange={(e) => {
                  setApprovalMode(e.target.value as ApprovalMode);
                  markDirty();
                }}
              >
                {APPROVAL_MODE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="settings-hint">{approvalModeDescription(approvalMode)}</span>
            </label>

            <div className="settings-policy-summary">
              <span>{settings.requireApprovalWrites ? 'Edits: ask' : 'Edits: auto'}</span>
              <span>{settings.requireApprovalShell ? 'Commands: ask' : 'Commands: auto'}</span>
            </div>
          </SettingsCard>
        )}

        {activeTab === 'debug' && settings.localDebugAvailable && (
          <>
            <SettingsCard
              title="Local debug"
              description="Development-only diagnostics for inspecting agent prompts, context, tool calls, and UI traces."
            >
              <SettingSwitch
                label="JSONL session log"
                description="Write canonical session events to .mitii/logs, including every tool start/end."
                checked={sessionLogging}
                onChange={(v) => {
                  setSessionLogging(v);
                  if (!v) setDebugMetrics(false);
                  markDirty();
                }}
              />
              <SettingSwitch
                label="Verbose debug traces"
                description="Include full sanitized inputs, context queries, LLM step metadata, and UI update traces."
                checked={debugMetrics && sessionLogging}
                disabled={!sessionLogging}
                onChange={(v) => {
                  setDebugMetrics(v);
                  markDirty();
                }}
              />
              <p className="settings-inline-note">
                This panel only appears in the Extension Development Host. Logs are local files under{' '}
                <code>.mitii/logs</code>.
              </p>
            </SettingsCard>
          </>
        )}
      </div>

      {showSaveBar && (
        <footer className="settings-save-bar">
          <span className="settings-save-bar__hint">
            {dirty ? 'Unsaved changes' : saved ? 'All changes saved' : 'No pending changes'}
          </span>
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleSaveAll}
            disabled={!dirty && !apiKey.trim()}
          >
            {saved ? 'Saved' : 'Save changes'}
          </button>
        </footer>
      )}
    </div>
  );
}
