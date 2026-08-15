import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { getProviderPreset, PROVIDER_OPTIONS } from '../providerOptions';
import type {
  CheckpointItemView,
  ContextToggles,
  IndexStatusSnapshot,
  McpRuntimeStatus,
  McpServerConfig,
  McpSettings,
  MemoryItemView,
  ProviderSettingsSnapshot,
  SettingsTab,
  SettingsProfileView,
  UiSettingsPatch,
  UiSettingsSnapshot,
  WorkspaceSnapshotInfo,
} from '../protocol';
import { CheckpointPanel } from './CheckpointPanel';
import { ContextTogglesPanel } from './ContextTogglesPanel';
import { McpServersEditor } from './McpServersEditor';
import { MemoryPanel } from './MemoryPanel';
import {
  IconAgent,
  IconAsk,
  IconCheck,
  IconHistory,
  IconIndex,
  IconModel,
  IconPlan,
  IconSettings,
} from './Icons';

interface SettingsPanelProps {
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  workspace: WorkspaceSnapshotInfo;
  overrideDraft: string;
  onOverrideDraftChange: (value: string) => void;
  onClearOverride: () => void;
  onOpenFolder: () => void;
  profiles: SettingsProfileView[];
  activeProfileId: string;
  onActiveProfileChange: (id: string) => void;
  onCreateProfile: (name: string) => void;
  provider: ProviderSettingsSnapshot;
  onProviderChange: (next: ProviderSettingsSnapshot) => void;
  onProviderTypeChange: (type: string) => void;
  onSetApiKey: () => void;
  onClearApiKey: () => void;
  onTestConnection: () => void;
  testingConnection: boolean;
  connectionMessage: string | null;
  customModel: boolean;
  onCustomModelChange: (value: boolean) => void;
  modelOptions: string[];
  ui: UiSettingsSnapshot;
  onSaveUi: (patch: UiSettingsPatch) => void;
  mcp: McpSettings;
  mcpStore: McpServerConfig[];
  mcpRuntimeStatus: McpRuntimeStatus;
  onMcpChange: (next: McpSettings) => void;
  index: IndexStatusSnapshot;
  onReindex: () => void;
  onRefreshIndex: () => void;
  memories: MemoryItemView[];
  onAddMemory: (text: string) => void;
  onDeleteMemory: (id: string) => void;
  onClearMemory: () => void;
  checkpoints: CheckpointItemView[];
  onRestoreCheckpoint: (id: string) => void;
  onDeleteCheckpoint: (id: string) => void;
  onClearCheckpoints: () => void;
  onToggleContext: (source: keyof ContextToggles, enabled: boolean) => void;
  onSaveAll: () => void;
  saving: boolean;
}

const TABS: { id: SettingsTab; label: string; icon: ReactNode }[] = [
  { id: 'model', label: 'Workspace', icon: <IconModel /> },
  { id: 'modes', label: 'Modes', icon: <IconPlan /> },
  { id: 'context', label: 'Context', icon: <IconIndex /> },
  { id: 'integrations', label: 'MCP', icon: <IconSettings /> },
  { id: 'debug', label: 'Debug', icon: <IconHistory /> },
];

function mergeModelOptions(
  available: string[] | undefined,
  current: string,
): string[] {
  const set = new Set<string>();
  if (current.trim()) set.add(current.trim());
  for (const id of available ?? []) {
    if (id.trim()) set.add(id.trim());
  }
  return [...set];
}

const INDEX_CAPABILITY_LABELS: Record<string, string> = {
  catalog: 'Catalog',
  codeIndex: 'Code index',
  textIndex: 'Text index',
  vectorIndex: 'Embeddings',
  graph: 'Graph',
  map: 'Repo map',
};

function displayCapabilityStatus(capability: {
  capability: string;
  status: string;
  reasonCode?: string;
}): { className: string; label: string } {
  if (capability.capability === 'vectorIndex') {
    if (capability.status === 'unavailable') {
      return { className: 'optional', label: 'not configured' };
    }
    if (capability.status === 'degraded') {
      return { className: 'degraded', label: 'degraded — reindex' };
    }
  }
  return { className: capability.status, label: capability.status };
}

function formatIndexMode(mode: IndexStatusSnapshot['indexMode']): string {
  if (mode === 'full') return 'Full code/text index';
  if (mode === 'host_snapshot') return 'Host snapshot fallback';
  return 'Unknown';
}

function capabilityDetails(index: IndexStatusSnapshot) {
  return [...(index.capabilities ?? [])].sort((a, b) => {
    const left = `${a.rootId ?? ''}:${a.capability}`;
    const right = `${b.rootId ?? ''}:${b.capability}`;
    return left.localeCompare(right);
  });
}

function SettingsSection({
  title,
  icon,
  description,
  children,
}: {
  title: string;
  icon?: ReactNode;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <header className="settings-section__header">
        <h3 className="settings-section__title">
          {icon ? <span className="settings-section__icon">{icon}</span> : null}
          <span>{title}</span>
        </h3>
        {description ? (
          <p className="settings-section__desc">{description}</p>
        ) : null}
      </header>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  disabled,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (nextDraft: string) => {
    if (!nextDraft.trim()) {
      setDraft(String(value));
      return;
    }
    const parsed = Number(nextDraft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const bounded = Math.max(
      min ?? Number.NEGATIVE_INFINITY,
      Math.min(max ?? Number.POSITIVE_INFINITY, Math.floor(parsed)),
    );
    setDraft(String(bounded));
    if (bounded !== value) onCommit(bounded);
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
          }
        }}
      />
    </div>
  );
}

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    tab,
    onTabChange,
    workspace,
    overrideDraft,
    onOverrideDraftChange,
    onClearOverride,
    onOpenFolder,
    profiles,
    activeProfileId,
    onActiveProfileChange,
    onCreateProfile,
    provider,
    onProviderChange,
    onProviderTypeChange,
    onSetApiKey,
    onClearApiKey,
    onTestConnection,
    testingConnection,
    connectionMessage,
    customModel,
    onCustomModelChange,
    modelOptions,
    ui,
    onSaveUi,
    mcp,
    mcpStore,
    mcpRuntimeStatus,
    onMcpChange,
    index,
    onReindex,
    onRefreshIndex,
    memories,
    onAddMemory,
    onDeleteMemory,
    onClearMemory,
    checkpoints,
    onRestoreCheckpoint,
    onDeleteCheckpoint,
    onClearCheckpoints,
    onToggleContext,
    onSaveAll,
    saving,
  } = props;
  const [modeSettingsTab, setModeSettingsTab] =
    useState<'ask' | 'plan' | 'agent'>('ask');
  const [newProfileOpen, setNewProfileOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');

  const options = useMemo(
    () =>
      mergeModelOptions(
        [
          ...modelOptions,
          ...Object.values(ui.modeDefaults ?? {})
            .map((entry) => entry.model ?? '')
            .filter(Boolean),
        ],
        provider.model,
      ),
    [modelOptions, provider.model, ui.modeDefaults],
  );

  const effectiveTab = tab === 'workspace' ? 'model' : tab;
  const activeProfile =
    profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  const modeDefault =
    ui.modeDefaults?.[modeSettingsTab] ?? {
      depth: ui.depth,
      approvalMode: ui.approvalMode,
      model: provider.model,
    };

  return (
    <div className="settings-view">
      <div className="settings-toolbar">
        <div className="settings-tabs" role="tablist" aria-label="Settings">
          {TABS.map(({ id, label, icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={effectiveTab === id}
              className={`settings-tab ${effectiveTab === id ? 'active' : ''}`}
              onClick={() => onTabChange(id)}
              title={label}
            >
              <span className="settings-tab__icon">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-body">
        {effectiveTab === 'model' ? (
          <div className="settings-panel">
            <SettingsSection
              title="Workspace root"
              icon={<IconIndex />}
              description="Active folder used for indexing, context, and agent runs."
            >
              <div className="settings-path mono">
                {workspace.displayRoot ?? 'No folder open'}
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={onOpenFolder}
                >
                  Open folder
                </button>
              </div>
              <details className="settings-advanced">
                <summary>Advanced workspace</summary>
                <div className="field">
                  <label htmlFor="override">Root path override</label>
                  <input
                    id="override"
                    value={overrideDraft}
                    placeholder={workspace.root ?? '/path/to/repo'}
                    onChange={(e) => onOverrideDraftChange(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={onClearOverride}
                >
                  Clear override
                </button>
              </details>
            </SettingsSection>

            <SettingsSection
              title="Repository index"
              icon={<IconIndex />}
              description="Local file map used by Ask, Plan, Agent, and Review."
            >
              <div className="stat-grid">
                <div className="stat">
                  <div className="stat-value">{index.fileCount}</div>
                  <div className="stat-label">Indexed items</div>
                </div>
                <div className="stat">
                  <div className="stat-value" style={{ fontSize: 15 }}>
                    {index.readiness ?? '—'}
                  </div>
                  <div className="stat-label">Readiness</div>
                </div>
                <div className="stat">
                  <div className="stat-value" style={{ fontSize: 15 }}>
                    {index.scanCompleteness ?? '—'}
                  </div>
                  <div className="stat-label">Scan</div>
                </div>
                <div className="stat">
                  <div className="stat-value" style={{ fontSize: 15 }}>
                    {formatIndexMode(index.indexMode)}
                  </div>
                  <div className="stat-label">Mode</div>
                </div>
              </div>
              {capabilityDetails(index).length > 0 ? (
                <div
                  className="index-capability-list"
                  aria-label="Repository index capability status"
                >
                  {capabilityDetails(index).map((capability) => {
                    const label =
                      INDEX_CAPABILITY_LABELS[capability.capability] ??
                      capability.capability;
                    const displayStatus = displayCapabilityStatus(capability);
                    return (
                      <div
                        key={`${capability.rootId ?? 'root'}:${capability.capability}`}
                        className={`index-capability index-capability--${displayStatus.className}`}
                        title={[
                          capability.rootId
                            ? `Root: ${capability.rootId}`
                            : undefined,
                          capability.revision
                            ? `Revision: ${capability.revision}`
                            : undefined,
                          capability.profile
                            ? `Profile: ${capability.profile}`
                            : undefined,
                          capability.reasonCode
                            ? `Reason: ${capability.reasonCode}`
                            : undefined,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      >
                        <span className="index-capability__name">{label}</span>
                        <span className="index-capability__status">
                          {displayStatus.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <p className="field-hint">
                {index.message ?? 'No index yet'}
                {index.truncated ? ' · truncated' : ''}
                {index.capabilities?.some(
                  (capability) =>
                    capability.capability === 'vectorIndex' &&
                    capability.status === 'degraded',
                )
                  ? ' · Semantic search is degraded. Reindex to rebuild embeddings.'
                  : ''}
              </p>
              <div className="row">
                <button type="button" className="btn" onClick={onReindex}>
                  {index.capabilities?.some(
                    (capability) =>
                      capability.capability === 'vectorIndex' &&
                      capability.status === 'degraded',
                  )
                    ? 'Reindex embeddings'
                    : 'Reindex'}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={onRefreshIndex}
                >
                  Refresh
                </button>
              </div>
            </SettingsSection>

            <SettingsSection
              title="Provider"
              icon={<IconModel />}
              description="Connect Anthropic, Gemini, DeepSeek, OpenAI, OpenRouter, or any OpenAI-compatible /v1 API."
            >
              <div className="field">
                <label htmlFor="ptype">Provider</label>
                <select
                  id="ptype"
                  value={provider.preset ?? provider.type}
                  onChange={(e) => onProviderTypeChange(e.target.value)}
                >
                  {PROVIDER_OPTIONS.map((option) => (
                    <option key={option.preset} value={option.preset}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {provider.type !== 'echo' ? (
                <div className="field">
                  <label htmlFor="base">Base URL</label>
                  <input
                    id="base"
                    value={provider.baseUrl}
                    placeholder={
                      provider.type === 'anthropic'
                        ? 'https://api.anthropic.com'
                        : provider.type === 'gemini'
                          ? 'https://generativelanguage.googleapis.com'
                          : 'http://localhost:11434/v1'
                    }
                    onChange={(e) =>
                      onProviderChange({ ...provider, baseUrl: e.target.value })
                    }
                  />
                  <p className="field-hint">
                    {provider.type === 'anthropic' || provider.type === 'gemini'
                      ? 'Override only if you use a corporate proxy or regional endpoint.'
                      : 'Local hosts (localhost, LAN, Docker) do not need an API key.'}
                  </p>
                </div>
              ) : null}
              <div className="field">
                <label htmlFor="model">Model</label>
                <select
                  id="model"
                  value={
                    customModel || !options.includes(provider.model)
                      ? '__custom__'
                      : provider.model
                  }
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === '__custom__') {
                      onCustomModelChange(true);
                      return;
                    }
                    onCustomModelChange(false);
                    onProviderChange({ ...provider, model: next });
                  }}
                >
                  {options.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                  <option value="__custom__">Custom…</option>
                </select>
                {customModel || !options.includes(provider.model) ? (
                  <input
                    style={{ marginTop: 8 }}
                    value={provider.model}
                    placeholder="custom model id"
                    onChange={(e) =>
                      onProviderChange({ ...provider, model: e.target.value })
                    }
                  />
                ) : null}
              </div>
            </SettingsSection>

            <SettingsSection
              title="Token limits"
              icon={<IconIndex />}
              description="Tune context window and max output for budgeting and testing."
            >
              <div className="settings-field-grid">
                <NumberField
                  id="contextWindow"
                  label="Context window (tokens)"
                  min={1024}
                  step={1024}
                  value={provider.contextWindow || 32768}
                  onCommit={(value) =>
                    onProviderChange({
                      ...provider,
                      contextWindow: value,
                    })
                  }
                />
                <NumberField
                  id="maxOutput"
                  label="Max output (tokens)"
                  min={256}
                  step={256}
                  value={provider.maximumOutputTokens || 16384}
                  onCommit={(value) =>
                    onProviderChange({
                      ...provider,
                      maximumOutputTokens: value,
                    })
                  }
                />
              </div>
              <p className="field-hint">
                Applied on Save. Context window drives the token meter and prompt reserve.
              </p>
            </SettingsSection>

            <SettingsSection title="Credentials & connection" icon={<IconCheck />}>
              <div className="row">
                <span className="mono">
                  API key: {provider.hasApiKey ? 'configured' : 'not set'}
                  {provider.type === 'anthropic' || provider.type === 'gemini'
                    ? ' (required)'
                    : ''}
                </span>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={onSetApiKey}
                  title="Set API key"
                >
                  Set key
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={onClearApiKey}
                  title="Clear API key"
                >
                  Clear key
                </button>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={onTestConnection}
                  disabled={testingConnection}
                  title="Test provider connection"
                >
                  {testingConnection ? 'Testing…' : 'Test connection'}
                </button>
                {connectionMessage || provider.connectionStatus ? (
                  <span
                    className={`settings-status-pill ${
                      provider.connectionOk
                        ? 'settings-status-pill--ok'
                        : provider.connectionOk === false
                          ? 'settings-status-pill--err'
                          : ''
                    }`}
                  >
                    {connectionMessage ?? provider.connectionStatus}
                  </span>
                ) : null}
              </div>
            </SettingsSection>
          </div>
        ) : null}

        {effectiveTab === 'modes' ? (
          <div className="settings-panel">
            <SettingsSection
              title="Mode defaults"
              icon={<IconPlan />}
              description="Compact defaults for each work mode."
            >
              <div className="mode-settings-tabs" role="tablist" aria-label="Mode settings">
                {[
                  { id: 'ask' as const, label: 'ASK', icon: <IconAsk /> },
                  { id: 'plan' as const, label: 'PLAN', icon: <IconPlan /> },
                  { id: 'agent' as const, label: 'AGENT', icon: <IconAgent /> },
                ].map((modeTab) => (
                  <button
                    key={modeTab.id}
                    type="button"
                    role="tab"
                    aria-selected={modeSettingsTab === modeTab.id}
                    className={`mode-settings-tab ${
                      modeSettingsTab === modeTab.id ? 'active' : ''
                    }`}
                    onClick={() => setModeSettingsTab(modeTab.id)}
                  >
                    <span>{modeTab.icon}</span>
                    <span>{modeTab.label}</span>
                  </button>
                ))}
              </div>
              <div className="mode-settings-summary">
                {modeSettingsTab === 'ask'
                  ? 'Ask stays lightweight: read, explain, compare, and answer with minimal workspace impact.'
                  : modeSettingsTab === 'plan'
                    ? 'Plan focuses on structure: clarify scope, draft phases, and save handoff-ready plans.'
                    : 'Agent is execution-focused: use tools, edit files, and stop at configured approval and budget limits.'}
              </div>
              <div className="field">
                <label htmlFor="depth">Default depth</label>
                <select
                  id="depth"
                  value={modeDefault.depth}
                  onChange={(e) =>
                    onSaveUi({
                      modeDefaults: {
                        [modeSettingsTab]: {
                          depth: e.target.value as UiSettingsSnapshot['depth'],
                        },
                      },
                    })
                  }
                >
                  <option value="auto">Auto</option>
                  <option value="quick">Quick</option>
                  <option value="deep">Deep</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="approval">Approval mode</label>
                <select
                  id="approval"
                  value={
                    modeDefault.approvalMode === 'builder'
                      ? 'guided'
                      : modeDefault.approvalMode
                  }
                  onChange={(e) =>
                    onSaveUi({
                      modeDefaults: {
                        [modeSettingsTab]: { approvalMode: e.target.value },
                      },
                    })
                  }
                >
                  <option value="safe">Ask for approval</option>
                  <option value="guided">Approve for me</option>
                  <option value="pilot">Full access</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="modeModel">Default model</label>
                <select
                  id="modeModel"
                  value={modeDefault.model ?? ''}
                  onChange={(e) =>
                    onSaveUi({
                      modeDefaults: {
                        [modeSettingsTab]: { model: e.target.value },
                      },
                    })
                  }
                >
                  <option value="">Use active model</option>
                  {options.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={ui.showReasoning}
                  onChange={(e) => onSaveUi({ showReasoning: e.target.checked })}
                />
                Show reasoning stream
              </label>
              <NumberField
                id="preview"
                label="Reasoning preview chars"
                min={500}
                max={50000}
                value={ui.reasoningPreviewMaxChars}
                onCommit={(value) =>
                  onSaveUi({
                    reasoningPreviewMaxChars: value,
                  })
                }
              />
            </SettingsSection>
            <SettingsSection
              title="Run budget"
              icon={<IconCheck />}
              description="Caps for a single Mitii turn before it stops."
            >
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={ui.runBudget.unlimited}
                  onChange={(e) =>
                    onSaveUi({
                      runBudget: { unlimited: e.target.checked },
                    })
                  }
                />
                Unlimited run budget
              </label>
              <div className="settings-field-grid">
                <NumberField
                  id="maxModelCalls"
                  label="Model calls"
                  min={1}
                  disabled={ui.runBudget.unlimited}
                  value={ui.runBudget.maxModelCalls}
                  onCommit={(value) =>
                    onSaveUi({
                      runBudget: { maxModelCalls: value },
                    })
                  }
                />
                <NumberField
                  id="maxToolCalls"
                  label="Tool calls"
                  min={1}
                  disabled={ui.runBudget.unlimited}
                  value={ui.runBudget.maxToolCalls}
                  onCommit={(value) =>
                    onSaveUi({
                      runBudget: { maxToolCalls: value },
                    })
                  }
                />
                <NumberField
                  id="maxLoopIterations"
                  label="Loop iterations"
                  min={1}
                  disabled={ui.runBudget.unlimited}
                  value={ui.runBudget.maxLoopIterations}
                  onCommit={(value) =>
                    onSaveUi({
                      runBudget: { maxLoopIterations: value },
                    })
                  }
                />
                <NumberField
                  id="maxWallTimeMinutes"
                  label="Wall time (min)"
                  min={1}
                  disabled={ui.runBudget.unlimited}
                  value={ui.runBudget.maxWallTimeMinutes}
                  onCommit={(value) =>
                    onSaveUi({
                      runBudget: { maxWallTimeMinutes: value },
                    })
                  }
                />
              </div>
            </SettingsSection>
          </div>
        ) : null}

        {effectiveTab === 'context' ? (
          <div className="settings-panel">
            <SettingsSection
              title="Context sources"
              icon={<IconIndex />}
              description="Choose what evidence is attached to each turn."
            >
              <ContextTogglesPanel
                toggles={ui.contextToggles}
                onToggle={onToggleContext}
              />
            </SettingsSection>
            <MemoryPanel
              memories={memories}
              onAdd={onAddMemory}
              onDelete={onDeleteMemory}
              onClear={onClearMemory}
            />
            <CheckpointPanel
              checkpoints={checkpoints}
              onRestore={onRestoreCheckpoint}
              onDelete={onDeleteCheckpoint}
              onClear={onClearCheckpoints}
            />
          </div>
        ) : null}

        {effectiveTab === 'integrations' ? (
          <div className="settings-panel">
            <SettingsSection
              title="MCP integrations"
              icon={<IconSettings />}
              description="Optional store. Off by default — install what you need, delete anytime."
            >
              <McpServersEditor
                mcp={mcp}
                storeCatalog={mcpStore}
                runtimeStatus={mcpRuntimeStatus}
                onChange={onMcpChange}
              />
            </SettingsSection>
          </div>
        ) : null}

        {effectiveTab === 'debug' ? (
          <div className="settings-panel">
            <SettingsSection
              title="Developer"
              icon={<IconSettings />}
              description="Unlock developer options first. Nested debug switches appear after this is enabled — more will be added here later."
            >
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={ui.developerEnabled}
                  onChange={(e) =>
                    onSaveUi({ developerEnabled: e.target.checked })
                  }
                />
                Enable developer settings
              </label>
              <div
                className={`developer-options${
                  ui.developerEnabled ? '' : ' developer-options--locked'
                }`}
              >
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={ui.debugLogging}
                    disabled={!ui.developerEnabled}
                    onChange={(e) =>
                      onSaveUi({ debugLogging: e.target.checked })
                    }
                  />
                  Debug logging
                </label>
                <p className="field-hint">
                  When on, Mitii auto-shows the Output channel and prints
                  verbose stacks on failures (
                  <span className="mono">mitii.debug</span>).
                </p>
              </div>
            </SettingsSection>
            <SettingsSection
              title="Runtime diagnostics"
              icon={<IconSettings />}
              description="Use View → Output → Mitii for activation and run logs."
            >
              <div className="stat">
                <div className="stat-label">Provider connection</div>
                <div className="mono" style={{ marginTop: 8 }}>
                  {provider.connectionStatus ??
                    (provider.connectionOk === true
                      ? 'OK'
                      : provider.connectionOk === false
                        ? 'Failed'
                        : 'Not tested')}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">MCP runtime</div>
                <div className="mono" style={{ marginTop: 8 }}>
                  {mcpRuntimeStatus}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Index state token</div>
                <div className="mono" style={{ marginTop: 8 }}>
                  {index.stateTokenPreview ?? '—'}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Index mode</div>
                <div className="mono" style={{ marginTop: 8 }}>
                  {formatIndexMode(index.indexMode)} · files={index.fileCount}
                </div>
              </div>
              <p className="field-hint">
                Preset helper:{' '}
                {getProviderPreset(provider.preset ?? provider.type)?.label ??
                  provider.type}
              </p>
              <p className="field-hint">
                Startup logs appear in the Mitii Output channel on activate.
              </p>
            </SettingsSection>
          </div>
        ) : null}
      </div>
      <div className="settings-footer">
        <div className="settings-footer__profiles">
          <select
            aria-label="Switch profile"
            value={activeProfile?.id ?? activeProfileId}
            onChange={(e) => onActiveProfileChange(e.target.value)}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setNewProfileName('');
              setNewProfileOpen(true);
            }}
          >
            New Profile
          </button>
        </div>
        <button
          type="button"
          className="btn settings-save-btn"
          onClick={onSaveAll}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
      {newProfileOpen ? (
        <div
          className="settings-modal-backdrop"
          role="presentation"
          onMouseDown={() => setNewProfileOpen(false)}
        >
          <form
            className="settings-modal"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              onCreateProfile(newProfileName);
              setNewProfileOpen(false);
            }}
          >
            <h3>New profile</h3>
            <div className="field">
              <label htmlFor="newProfileName">Profile name</label>
              <input
                id="newProfileName"
                autoFocus
                value={newProfileName}
                placeholder="Local Ollama"
                onChange={(e) => setNewProfileName(e.target.value)}
              />
            </div>
            <div className="row settings-modal__actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setNewProfileOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn">
                Create
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
