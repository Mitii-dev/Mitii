import { useState, useEffect } from 'react';
import type { ProviderSettingsPayload, SettingsView } from '../../../vscode/webview/messages';
import { WorkspaceSettingsSection } from './WorkspaceSettingsSection';

interface SettingsPanelProps {
  settings: SettingsView;
  workspaceOpen: boolean;
  workspacePath: string;
  vscodeWorkspaceFolders: string[];
  workspaceOverride: string;
  usingWorkspaceOverride: boolean;
  indexDbPath: string;
  indexed: number;
  onSaveApiKey: (key: string) => void;
  onSaveProviderSettings: (settings: ProviderSettingsPayload) => void;
  onTestConnection: () => void;
  onPickWorkspaceFolder: () => void;
  onSetWorkspaceOverride: (path: string) => void;
  onClearWorkspaceOverride: () => void;
  onIndex: () => void;
}

export function SettingsPanel({
  settings,
  workspaceOpen,
  workspacePath,
  vscodeWorkspaceFolders,
  workspaceOverride,
  usingWorkspaceOverride,
  indexDbPath,
  indexed,
  onSaveApiKey,
  onSaveProviderSettings,
  onTestConnection,
  onPickWorkspaceFolder,
  onSetWorkspaceOverride,
  onClearWorkspaceOverride,
  onIndex,
}: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState('');
  const [providerType, setProviderType] = useState<'echo' | 'openai-compatible'>(
    settings.providerType as 'echo' | 'openai-compatible'
  );
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [contextWindow, setContextWindow] = useState(String(settings.contextWindow));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setProviderType(settings.providerType as 'echo' | 'openai-compatible');
    setBaseUrl(settings.baseUrl);
    setModel(settings.model);
    setContextWindow(String(settings.contextWindow));
  }, [settings]);

  const handleSaveKey = () => {
    if (apiKey.trim()) {
      onSaveApiKey(apiKey.trim());
      setApiKey('');
    }
  };

  const handleSaveProvider = () => {
    const parsedContext = parseInt(contextWindow, 10);
    if (!baseUrl.trim() || !model.trim() || isNaN(parsedContext) || parsedContext < 1024) {
      return;
    }
    onSaveProviderSettings({
      providerType,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      contextWindow: parsedContext,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const isLocalProvider = providerType === 'openai-compatible';

  return (
    <div className="settings-panel">
      <h2 className="settings-title">Settings</h2>

      <WorkspaceSettingsSection
        workspaceOpen={workspaceOpen}
        workspacePath={workspacePath}
        vscodeWorkspaceFolders={vscodeWorkspaceFolders}
        workspaceOverride={workspaceOverride}
        usingWorkspaceOverride={usingWorkspaceOverride}
        indexDbPath={indexDbPath}
        indexed={indexed}
        onPickFolder={onPickWorkspaceFolder}
        onSetOverride={onSetWorkspaceOverride}
        onClearOverride={onClearWorkspaceOverride}
        onIndex={onIndex}
      />

      <section className="settings-section">
        <h3>Provider</h3>

        <label className="settings-field">
          <span className="settings-label">Provider type</span>
          <select
            className="settings-input"
            value={providerType}
            onChange={(e) => setProviderType(e.target.value as 'echo' | 'openai-compatible')}
          >
            <option value="echo">Echo (test / no LLM)</option>
            <option value="openai-compatible">OpenAI-compatible (Ollama, LM Studio, etc.)</option>
          </select>
        </label>

        {isLocalProvider && (
          <>
            <label className="settings-field">
              <span className="settings-label">Local API URL</span>
              <input
                type="url"
                className="settings-input"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://localhost:11434/v1"
                aria-label="Local API URL"
              />
              <span className="settings-hint">Ollama default: http://localhost:11434/v1</span>
            </label>

            <label className="settings-field">
              <span className="settings-label">Model</span>
              <input
                type="text"
                className="settings-input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="qwen3-coder:30b"
                aria-label="Model name"
              />
              <span className="settings-hint">Must match a model available at your endpoint</span>
            </label>

            <label className="settings-field">
              <span className="settings-label">Context window (tokens)</span>
              <input
                type="number"
                className="settings-input"
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                min={1024}
                max={1000000}
                step={1024}
                aria-label="Context window tokens"
              />
              <span className="settings-hint">Max tokens for context budget (min 1024)</span>
            </label>

            <button
              type="button"
              className="btn btn--primary"
              onClick={handleSaveProvider}
              disabled={!baseUrl.trim() || !model.trim()}
            >
              {saved ? 'Saved!' : 'Save provider settings'}
            </button>

            <button
              type="button"
              className="btn btn--secondary"
              onClick={onTestConnection}
              style={{ marginTop: '8px' }}
            >
              Test connection
            </button>

            {settings.connectionStatus && (
              <p
                className={`settings-hint ${settings.connectionOk ? 'connection-ok' : 'connection-fail'}`}
                role="status"
              >
                {settings.connectionStatus}
              </p>
            )}
          </>
        )}

        {providerType === 'echo' && (
          <>
            <p className="settings-placeholder">
              Echo mode echoes your message — no URL or model needed. Switch to OpenAI-compatible for a local LLM.
            </p>
            <button type="button" className="btn btn--primary" onClick={handleSaveProvider}>
              {saved ? 'Saved!' : 'Save provider settings'}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onTestConnection}
              style={{ marginTop: '8px' }}
            >
              Test echo mode
            </button>
            {settings.connectionStatus && (
              <p className="settings-hint connection-ok" role="status">
                {settings.connectionStatus}
              </p>
            )}
          </>
        )}

        <div className="settings-divider" />

        <p className="settings-row">
          API key: <strong>{settings.hasApiKey ? 'Saved' : 'Not set'}</strong>
        </p>
        <div className="api-key-row">
          <input
            type="password"
            className="api-key-input"
            placeholder="Enter API key (if required)…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            aria-label="API key"
          />
          <button
            type="button"
            className="btn btn--primary btn--small"
            onClick={handleSaveKey}
            disabled={!apiKey.trim()}
          >
            Save key
          </button>
        </div>
        <p className="settings-hint">Leave empty for local Ollama. Keys are stored in VS Code SecretStorage.</p>
      </section>

      <section className="settings-section">
        <h3>Indexing</h3>
        <p className="settings-row">Enabled: <strong>{settings.indexingEnabled ? 'Yes' : 'No'}</strong></p>
        <p className="settings-hint">Use the Workspace section above to index the effective path.</p>
      </section>

      <section className="settings-section">
        <h3>Safety</h3>
        <p className="settings-row">Approve writes: <strong>{settings.requireApprovalWrites ? 'Yes' : 'No'}</strong></p>
        <p className="settings-row">Approve shell: <strong>{settings.requireApprovalShell ? 'Yes' : 'No'}</strong></p>
      </section>

      <section className="settings-section">
        <h3>Memory</h3>
        <p className="settings-row">Enabled: <strong>{settings.memoryEnabled ? 'Yes' : 'No'}</strong></p>
      </section>
    </div>
  );
}
