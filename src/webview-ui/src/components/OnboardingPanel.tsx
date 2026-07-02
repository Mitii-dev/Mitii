import { useMemo, useState } from 'react';
import type { ProviderSettingsPayload, SettingsView } from '../../../vscode/webview/messages';
import { PROVIDER_PRESETS } from '../../../core/llm/providerPresets';
import { validateProviderSettings } from '../../../core/config/ui/mappers';

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
  const [providerType, setProviderType] = useState<ProviderSettingsPayload['providerType']>(
    settings.providerType as ProviderSettingsPayload['providerType']
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
        {['Echo test', 'Provider', 'Index'].map((label, index) => (
          <button
            key={label}
            type="button"
            className={`onboarding__step ${step === index ? 'onboarding__step--active' : ''}`}
            onClick={() => setStep(index)}
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
                  baseUrl: settings.baseUrl || 'http://localhost:11434/v1',
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
        </div>
      )}

      {step === 1 && (
        <div className="onboarding__body">
          <h3>Provider connection</h3>
          <label className="settings-field">
            <span className="settings-label">Provider</span>
            <select
              className="settings-input settings-select"
              value={providerType}
              onChange={(e) => chooseProvider(e.target.value as ProviderSettingsPayload['providerType'])}
            >
              <option value="openai-compatible">OpenAI-compatible / Ollama</option>
              {PROVIDER_PRESETS.filter((item) => item.type !== 'openai-compatible').map((item) => (
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

      {step === 2 && (
        <div className="onboarding__body">
          <h3>Workspace index</h3>
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
