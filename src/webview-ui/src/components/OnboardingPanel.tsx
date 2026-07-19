import { useMemo, useState } from 'react';
import type { ProviderSettingsPayload, SettingsView } from '../../../vscode/webview/messages';
import { PROVIDER_PRESETS } from '../../../kernel/llm/providerPresets';
import { validateProviderSettings } from '../../../kernel/config/ui/mappers';

interface OnboardingPanelProps {
  settings: SettingsView;
  workspaceIndexed: boolean;
  onSaveProviderSettings: (settings: ProviderSettingsPayload) => void;
  onSaveApiKey: (key: string) => void;
  onTestConnection: (settings: ProviderSettingsPayload) => void;
  onIndexWorkspace: () => void;
  onComplete: () => void;
}

export function OnboardingPanel({
  settings,
  workspaceIndexed,
  onSaveProviderSettings,
  onSaveApiKey,
  onTestConnection,
  onIndexWorkspace,
  onComplete,
}: OnboardingPanelProps) {
  const [step, setStep] = useState(0);
  const initialProviderType = settings.providerType === 'echo'
    ? 'openai-compatible'
    : settings.providerType as ProviderSettingsPayload['providerType'];
  const [providerType, setProviderType] = useState<ProviderSettingsPayload['providerType']>(
    initialProviderType
  );
  const preset = PROVIDER_PRESETS.find((item) => item.type === providerType);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl || preset?.baseUrl || '');
  const [model, setModel] = useState(settings.model || preset?.model || '');
  const [apiVersion, setApiVersion] = useState(settings.apiVersion || '2024-10-21');
  const [region, setRegion] = useState(settings.region || 'us-east-1');
  const [apiKey, setApiKey] = useState('');

  const payload = useMemo<ProviderSettingsPayload>(() => ({
    providerType,
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    apiVersion: apiVersion.trim(),
    region: region.trim(),
    contextWindow: preset?.contextWindow ?? settings.contextWindow,
  }), [apiVersion, baseUrl, model, preset?.contextWindow, providerType, region, settings.contextWindow]);
  const validation = validateProviderSettings(payload);
  const cloudPresets = PROVIDER_PRESETS.filter((item) => item.type !== 'openai-compatible');
  const connectionStatus = settings.connectionStatus;
  const connectionClass = settings.connectionOk
    ? 'settings-inline-note settings-inline-note--ok'
    : 'settings-inline-note settings-inline-note--error';

  const chooseProvider = (next: ProviderSettingsPayload['providerType']) => {
    setProviderType(next);
    const nextPreset = PROVIDER_PRESETS.find((item) => item.type === next);
    if (nextPreset) {
      setBaseUrl(nextPreset.baseUrl);
      setModel(nextPreset.model);
    }
  };

  return (
    <section className="onboarding" aria-label="First run setup">
      <div className="onboarding__header">
        <div>
          <h2 className="onboarding__title">Set up Mitii</h2>
          <p className="onboarding__subtitle">Connect a provider and index this workspace before the first serious run.</p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onComplete}>Skip</button>
      </div>

      <div className="onboarding__steps" role="tablist" aria-label="Setup steps">
        {['Echo', 'Ollama', 'Cloud', 'Index'].map((label, index) => (
          <button
            key={label}
            type="button"
            className={`onboarding__step ${step === index ? 'onboarding__step--active' : ''}`}
            onClick={() => {
              if (index === 1) chooseProvider('openai-compatible');
              if (index === 2 && (providerType === 'echo' || providerType === 'openai-compatible')) chooseProvider('openai');
              setStep(index);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {step === 0 && (
        <div className="onboarding__body">
          <h3>Echo provider test</h3>
          <p>Echo verifies the sidebar, chat loop, and settings plumbing without sending data to an external model.</p>
          <div className="onboarding__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                const echoPayload: ProviderSettingsPayload = {
                  providerType: 'echo',
                  baseUrl: '',
                  model: 'echo',
                  apiVersion: settings.apiVersion,
                  region: settings.region,
                  contextWindow: settings.contextWindow,
                };
                onSaveProviderSettings(echoPayload);
                onTestConnection(echoPayload);
                setStep(1);
              }}
            >
              Test Echo
            </button>
          </div>
          {connectionStatus && <p className={connectionClass}>{connectionStatus}</p>}
        </div>
      )}

      {step === 1 && (
        <div className="onboarding__body">
          <h3>Local Ollama</h3>
          <p>Use Ollama or another localhost OpenAI-compatible server for local model runs. Mitii uses this same connection shape for LM Studio and compatible gateways.</p>
          <div className="onboarding__preset-grid">
            <button type="button" className="onboarding__preset" onClick={() => {
              chooseProvider('openai-compatible');
              setBaseUrl('http://localhost:11434/v1');
              setModel('qwen3-coder:30b');
            }}>
              <strong>Ollama</strong>
              <span>http://localhost:11434/v1</span>
            </button>
            <button type="button" className="onboarding__preset" onClick={() => {
              chooseProvider('openai-compatible');
              setBaseUrl('http://localhost:1234/v1');
              setModel('local-model');
            }}>
              <strong>LM Studio</strong>
              <span>http://localhost:1234/v1</span>
            </button>
          </div>
          <label className="settings-field">
            <span className="settings-label">API base URL</span>
            <input className="settings-input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </label>
          <label className="settings-field">
            <span className="settings-label">Model</span>
            <input className="settings-input" value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
          {!validation.ok && <p className="settings-inline-note settings-inline-note--error">{validation.errors.join(' ')}</p>}
          {connectionStatus && <p className={connectionClass}>{connectionStatus}</p>}
          <div className="onboarding__actions">
            <button type="button" className="btn btn--ghost" onClick={() => onTestConnection(payload)} disabled={!validation.ok}>
              Test connection
            </button>
            <button type="button" className="btn btn--primary" onClick={() => {
              onSaveProviderSettings(payload);
              setStep(3);
            }} disabled={!validation.ok}>
              Save local provider
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => {
              chooseProvider('openai');
              setStep(2);
            }}>
              Configure cloud
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="onboarding__body">
          <h3>Cloud key</h3>
          <p>Add a managed provider only when you want cloud inference. Mitii stores the key in your editor secret storage and tests the selected model before you continue.</p>
          <label className="settings-field">
            <span className="settings-label">Provider</span>
            <select
              className="settings-input settings-select"
              value={providerType === 'openai-compatible' || providerType === 'echo' ? 'openai' : providerType}
              onChange={(e) => chooseProvider(e.target.value as ProviderSettingsPayload['providerType'])}
            >
              {cloudPresets.map((item) => (
                <option key={item.type} value={item.type}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span className="settings-label">API base URL</span>
            <input className="settings-input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </label>
          <label className="settings-field">
            <span className="settings-label">{providerType === 'azure-openai' ? 'Azure deployment' : 'Model'}</span>
            <input className="settings-input" value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
          {providerType === 'azure-openai' && (
            <label className="settings-field">
              <span className="settings-label">Azure API version</span>
              <input className="settings-input" value={apiVersion} onChange={(e) => setApiVersion(e.target.value)} />
            </label>
          )}
          {providerType === 'bedrock' && (
            <label className="settings-field">
              <span className="settings-label">AWS region</span>
              <input className="settings-input" value={region} onChange={(e) => setRegion(e.target.value)} />
            </label>
          )}
          {preset?.requiresApiKey && (
            <label className="settings-field">
              <span className="settings-label">API key</span>
              <input
                className="settings-input"
                type="password"
                placeholder={settings.hasApiKey ? 'Key saved - enter to replace' : 'Enter API key'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>
          )}
          {!validation.ok && <p className="settings-inline-note settings-inline-note--error">{validation.errors.join(' ')}</p>}
          {connectionStatus && <p className={connectionClass}>{connectionStatus}</p>}
          <div className="onboarding__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => onTestConnection(payload)}
              disabled={!validation.ok}
            >
              Test connection
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                if (apiKey.trim()) onSaveApiKey(apiKey.trim());
                onSaveProviderSettings(payload);
                setStep(2);
              }}
              disabled={!validation.ok}
            >
              Save provider
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="onboarding__body">
          <h3>Safety and index</h3>
          <div className="onboarding__safety">
            <div>
              <strong>Safe</strong>
              <span>Review every edit and shell command before it runs.</span>
            </div>
            <div>
              <strong>Guided</strong>
              <span>Keep approvals for risky actions while allowing low-risk local reads.</span>
            </div>
          </div>
          <p>{workspaceIndexed ? 'This workspace has indexed files.' : 'Build the local index so Ask, Plan, Agent, and Review mode have useful repository context.'}</p>
          <div className="onboarding__actions">
            <button type="button" className="btn btn--ghost" onClick={onIndexWorkspace}>Index workspace</button>
            <button type="button" className="btn btn--primary" onClick={onComplete}>Finish setup</button>
          </div>
        </div>
      )}
    </section>
  );
}
