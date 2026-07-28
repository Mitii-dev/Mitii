import { useMemo, type ReactNode } from 'react';

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
  UiSettingsPatch,
  UiSettingsSnapshot,
  WorkspaceSnapshotInfo,
} from '../protocol';
import { CheckpointPanel } from './CheckpointPanel';
import { ContextTogglesPanel } from './ContextTogglesPanel';
import { McpServersEditor } from './McpServersEditor';
import { MemoryPanel } from './MemoryPanel';

interface SettingsPanelProps {
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  workspace: WorkspaceSnapshotInfo;
  overrideDraft: string;
  onOverrideDraftChange: (value: string) => void;
  onSaveOverride: () => void;
  onClearOverride: () => void;
  onOpenFolder: () => void;
  provider: ProviderSettingsSnapshot;
  onProviderChange: (next: ProviderSettingsSnapshot) => void;
  onProviderTypeChange: (type: string) => void;
  onSaveProvider: () => void;
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
  onSaveMcp: (next: McpSettings) => void;
  index: IndexStatusSnapshot;
  onReindex: () => void;
  onRefreshIndex: () => void;
  memories: MemoryItemView[];
  onDeleteMemory: (id: string) => void;
  onClearMemory: () => void;
  checkpoints: CheckpointItemView[];
  onRestoreCheckpoint: (id: string) => void;
  onDeleteCheckpoint: (id: string) => void;
  onClearCheckpoints: () => void;
  onToggleContext: (source: keyof ContextToggles, enabled: boolean) => void;
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'model', label: 'Model' },
  { id: 'modes', label: 'Modes' },
  { id: 'context', label: 'Context' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'debug', label: 'Debug' },
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
  if (
    capability.capability === 'vectorIndex' &&
    capability.status === 'unavailable'
  ) {
    return { className: 'optional', label: 'not configured' };
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
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <header className="settings-section__header">
        <h3 className="settings-section__title">{title}</h3>
        {description ? (
          <p className="settings-section__desc">{description}</p>
        ) : null}
      </header>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    tab,
    onTabChange,
    workspace,
    overrideDraft,
    onOverrideDraftChange,
    onSaveOverride,
    onClearOverride,
    onOpenFolder,
    provider,
    onProviderChange,
    onProviderTypeChange,
    onSaveProvider,
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
    onSaveMcp,
    index,
    onReindex,
    onRefreshIndex,
    memories,
    onDeleteMemory,
    onClearMemory,
    checkpoints,
    onRestoreCheckpoint,
    onDeleteCheckpoint,
    onClearCheckpoints,
    onToggleContext,
  } = props;

  const options = useMemo(
    () => mergeModelOptions(modelOptions, provider.model),
    [modelOptions, provider.model],
  );

  return (
    <div className="settings-view">
      <div className="settings-tabs" role="tablist" aria-label="Settings">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`settings-tab ${tab === id ? 'active' : ''}`}
            onClick={() => onTabChange(id)}
            title={label}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="settings-body">
        {tab === 'workspace' ? (
          <div className="settings-panel">
            <SettingsSection
              title="Workspace root"
              description="Active folder used for indexing, context, and agent runs."
            >
              <div className="settings-path mono">
                {workspace.displayRoot ?? 'No folder open'}
              </div>
              <div className="field">
                <label htmlFor="override">Root path override</label>
                <input
                  id="override"
                  value={overrideDraft}
                  placeholder={workspace.root ?? '/path/to/repo'}
                  onChange={(e) => onOverrideDraftChange(e.target.value)}
                />
              </div>
              <div className="row">
                <button type="button" className="btn" onClick={onSaveOverride}>
                  Save override
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={onClearOverride}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={onOpenFolder}
                >
                  Open folder
                </button>
              </div>
            </SettingsSection>

            <SettingsSection
              title="Repository index"
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
              </p>
              <div className="row">
                <button type="button" className="btn" onClick={onReindex}>
                  Reindex
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
          </div>
        ) : null}

        {tab === 'model' ? (
          <div className="settings-panel">
            <SettingsSection
              title="Provider"
              description="Connect a local or cloud OpenAI-compatible endpoint."
            >
              <div className="field">
                <label htmlFor="ptype">Provider</label>
                <select
                  id="ptype"
                  value={provider.type}
                  onChange={(e) => onProviderTypeChange(e.target.value)}
                >
                  {PROVIDER_OPTIONS.map((option) => (
                    <option key={option.type} value={option.type}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {provider.type === 'openai-compatible' ? (
                <div className="field">
                  <label htmlFor="base">Base URL</label>
                  <input
                    id="base"
                    value={provider.baseUrl}
                    placeholder="http://localhost:11434/v1"
                    onChange={(e) =>
                      onProviderChange({ ...provider, baseUrl: e.target.value })
                    }
                  />
                  <p className="field-hint">
                    Local hosts (localhost, LAN, Docker) do not need an API key.
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
              description="Tune context window and max output for budgeting and testing."
            >
              <div className="settings-field-grid">
                <div className="field">
                  <label htmlFor="contextWindow">Context window (tokens)</label>
                  <input
                    id="contextWindow"
                    type="number"
                    min={1024}
                    step={1024}
                    value={provider.contextWindow || 32768}
                    onChange={(e) =>
                      onProviderChange({
                        ...provider,
                        contextWindow: Number(e.target.value) || 32768,
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="maxOutput">Max output (tokens)</label>
                  <input
                    id="maxOutput"
                    type="number"
                    min={256}
                    step={256}
                    value={provider.maximumOutputTokens || 16384}
                    onChange={(e) =>
                      onProviderChange({
                        ...provider,
                        maximumOutputTokens: Number(e.target.value) || 16384,
                      })
                    }
                  />
                </div>
              </div>
              <p className="field-hint">
                Applied on Save provider. Context window drives the token meter
                and prompt reserve.
              </p>
            </SettingsSection>

            <SettingsSection title="Credentials & connection">
              <div className="row">
                <span className="mono">
                  API key: {provider.hasApiKey ? 'configured' : 'not set'}
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
              <div className="row">
                <button type="button" className="btn" onClick={onSaveProvider}>
                  Save provider
                </button>
              </div>
            </SettingsSection>
          </div>
        ) : null}

        {tab === 'modes' ? (
          <div className="settings-panel">
            <SettingsSection
              title="Defaults"
              description="Applied to new turns unless overridden in the composer."
            >
              <div className="field">
                <label htmlFor="depth">Default depth</label>
                <select
                  id="depth"
                  value={ui.depth}
                  onChange={(e) =>
                    onSaveUi({
                      depth: e.target.value as UiSettingsSnapshot['depth'],
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
                    ui.approvalMode === 'builder' ? 'guided' : ui.approvalMode
                  }
                  onChange={(e) => onSaveUi({ approvalMode: e.target.value })}
                >
                  <option value="safe">Ask for approval</option>
                  <option value="guided">Approve for me</option>
                  <option value="pilot">Full access</option>
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
              <div className="field">
                <label htmlFor="preview">Reasoning preview chars</label>
                <input
                  id="preview"
                  type="number"
                  min={500}
                  max={50000}
                  value={ui.reasoningPreviewMaxChars}
                  onChange={(e) =>
                    onSaveUi({
                      reasoningPreviewMaxChars: Number(e.target.value) || 8000,
                    })
                  }
                />
              </div>
            </SettingsSection>
            <SettingsSection
              title="Run budget"
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
                <div className="field">
                  <label htmlFor="maxModelCalls">Model calls</label>
                  <input
                    id="maxModelCalls"
                    type="number"
                    min={1}
                    disabled={ui.runBudget.unlimited}
                    value={ui.runBudget.maxModelCalls}
                    onChange={(e) =>
                      onSaveUi({
                        runBudget: {
                          maxModelCalls: Number(e.target.value) || 64,
                        },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="maxToolCalls">Tool calls</label>
                  <input
                    id="maxToolCalls"
                    type="number"
                    min={1}
                    disabled={ui.runBudget.unlimited}
                    value={ui.runBudget.maxToolCalls}
                    onChange={(e) =>
                      onSaveUi({
                        runBudget: {
                          maxToolCalls: Number(e.target.value) || 128,
                        },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="maxLoopIterations">Loop iterations</label>
                  <input
                    id="maxLoopIterations"
                    type="number"
                    min={1}
                    disabled={ui.runBudget.unlimited}
                    value={ui.runBudget.maxLoopIterations}
                    onChange={(e) =>
                      onSaveUi({
                        runBudget: {
                          maxLoopIterations: Number(e.target.value) || 96,
                        },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="maxWallTimeMinutes">Wall time (min)</label>
                  <input
                    id="maxWallTimeMinutes"
                    type="number"
                    min={1}
                    disabled={ui.runBudget.unlimited}
                    value={ui.runBudget.maxWallTimeMinutes}
                    onChange={(e) =>
                      onSaveUi({
                        runBudget: {
                          maxWallTimeMinutes: Number(e.target.value) || 30,
                        },
                      })
                    }
                  />
                </div>
              </div>
            </SettingsSection>
          </div>
        ) : null}

        {tab === 'context' ? (
          <div className="settings-panel">
            <SettingsSection
              title="Context sources"
              description="Choose what evidence is attached to each turn."
            >
              <ContextTogglesPanel
                toggles={ui.contextToggles}
                onToggle={onToggleContext}
              />
            </SettingsSection>
            <MemoryPanel
              memories={memories}
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

        {tab === 'integrations' ? (
          <div className="settings-panel">
            <SettingsSection
              title="MCP servers"
              description="Optional store. Off by default — install what you need, delete anytime."
            >
              <McpServersEditor
                mcp={mcp}
                storeCatalog={mcpStore}
                runtimeStatus={mcpRuntimeStatus}
                onChange={onMcpChange}
                onSave={onSaveMcp}
              />
            </SettingsSection>
          </div>
        ) : null}

        {tab === 'debug' ? (
          <div className="settings-panel">
            <SettingsSection
              title="Runtime diagnostics"
              description="Use View → Output → Mitii for activation and run logs. Enable mitii.debug for verbose stacks."
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
                {getProviderPreset(provider.type)?.label ?? provider.type}
              </p>
              <p className="field-hint">
                Startup logs appear in the Mitii Output channel on activate.
                Toggle <span className="mono">mitii.debug</span> in VS Code
                settings to auto-show the channel and print stack traces.
              </p>
            </SettingsSection>
          </div>
        ) : null}
      </div>
    </div>
  );
}
