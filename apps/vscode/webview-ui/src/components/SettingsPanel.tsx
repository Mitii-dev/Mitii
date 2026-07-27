import { useMemo } from 'react';

import { getProviderPreset, PROVIDER_OPTIONS } from '../providerOptions';
import type {
  CheckpointItemView,
  ContextToggles,
  IndexStatusSnapshot,
  McpRuntimeStatus,
  McpSettings,
  MemoryItemView,
  ProviderSettingsSnapshot,
  SettingsTab,
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
  onSaveUi: (patch: Partial<UiSettingsSnapshot>) => void;
  mcp: McpSettings;
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
    onToggleContext,
  } = props;

  const options = useMemo(
    () => mergeModelOptions(modelOptions, provider.model),
    [modelOptions, provider.model],
  );

  return (
    <div className="settings-view">
      <div className="settings-tabs">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`settings-tab ${tab === id ? 'active' : ''}`}
            onClick={() => onTabChange(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'workspace' ? (
        <div className="settings-panel">
          <div className="stat">
            <div className="stat-label">Active workspace</div>
            <div className="mono" style={{ marginTop: 8 }}>
              {workspace.displayRoot ?? 'No folder open'}
            </div>
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
            <button type="button" className="btn ghost" onClick={onClearOverride}>
              Clear
            </button>
            <button type="button" className="btn ghost" onClick={onOpenFolder}>
              Open folder
            </button>
          </div>
          <div className="stat-grid">
            <div className="stat">
              <div className="stat-value">{index.fileCount}</div>
              <div className="stat-label">Indexed items</div>
            </div>
            <div className="stat">
              <div className="stat-value" style={{ fontSize: 16 }}>
                {index.readiness ?? '—'}
              </div>
              <div className="stat-label">Readiness</div>
            </div>
          </div>
          <p className="mono" style={{ color: 'var(--mitii-muted)', margin: 0 }}>
            {index.message ?? 'No index yet'}
            {index.truncated ? ' · truncated' : ''}
          </p>
          <div className="row">
            <button type="button" className="btn" onClick={onReindex}>
              Reindex
            </button>
            <button type="button" className="btn ghost" onClick={onRefreshIndex}>
              Refresh
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'model' ? (
        <div className="settings-panel">
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
          <div className="row">
            <span className="mono">
              API key: {provider.hasApiKey ? 'configured' : 'not set'}
            </span>
            <button type="button" className="btn ghost" onClick={onSetApiKey}>
              Set key
            </button>
            <button type="button" className="btn ghost" onClick={onClearApiKey}>
              Clear key
            </button>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn ghost"
              onClick={onTestConnection}
              disabled={testingConnection}
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
        </div>
      ) : null}

      {tab === 'modes' ? (
        <div className="settings-panel">
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
              value={ui.approvalMode}
              onChange={(e) => onSaveUi({ approvalMode: e.target.value })}
            >
              <option value="safe">Safe</option>
              <option value="guided">Guided</option>
              <option value="builder">Builder</option>
              <option value="pilot">Pilot</option>
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
        </div>
      ) : null}

      {tab === 'context' ? (
        <div className="settings-panel">
          <h3 className="panel-title">Context sources</h3>
          <ContextTogglesPanel
            toggles={ui.contextToggles}
            onToggle={onToggleContext}
          />
          <MemoryPanel
            memories={memories}
            onDelete={onDeleteMemory}
            onClear={onClearMemory}
          />
          <CheckpointPanel
            checkpoints={checkpoints}
            onRestore={onRestoreCheckpoint}
          />
        </div>
      ) : null}

      {tab === 'integrations' ? (
        <div className="settings-panel">
          <McpServersEditor
            mcp={mcp}
            runtimeStatus={mcpRuntimeStatus}
            onChange={onMcpChange}
            onSave={onSaveMcp}
          />
        </div>
      ) : null}

      {tab === 'debug' ? (
        <div className="settings-panel">
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
          <p className="field-hint">
            Preset helper: {getProviderPreset(provider.type)?.label ?? provider.type}
          </p>
        </div>
      ) : null}
    </div>
  );
}
