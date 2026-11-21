import { SettingsSection } from './shared';
import { CustomerWindowBudgetSummary } from './tokenBudgetViews';
import { type SettingsPanelProps } from './types';
import { type SettingsPanelView } from './useSettingsPanelState';
import { PROVIDER_OPTIONS } from '../../providerOptions';
import { normalizeMaximumOutputTokens } from '@mitii/ui-core';
import { NumberField } from '@mitii/ui-react';

export function ModelTab({ props, view }: { props: SettingsPanelProps; view: SettingsPanelView }) {
  const {
    connectionMessage,
    customModel,
    onClearApiKey,
    onClearSearchApiKey,
    onCustomModelChange,
    onProviderChange,
    onProviderTypeChange,
    onRefreshModels,
    onResetTokenBudget,
    onSearchChange,
    onSetApiKey,
    onSetSearchApiKey,
    onTestConnection,
    provider,
    refreshingModels,
    search,
    testingConnection,
    ui,
  } = props;

  const {
    autoMaxOutput,
    displayMaxOutput,
    keyRequired,
    livePreview,
    options,
    previewMaxOutput,
    setDraftContextWindow,
    setDraftMaxOutput,
  } = view;

  return (
    <div className="settings-panel">
      <SettingsSection
        title="Connection"
        description="Choose the provider and model Mitii will call."
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
                onProviderChange((prev) => ({
                  ...prev,
                  baseUrl: e.target.value,
                }))
              }
            />
            <p className="field-hint">
              {provider.type === 'anthropic' ||
              provider.type === 'gemini'
                ? 'Override only for a proxy or regional endpoint.'
                : provider.preset === 'ollama-cloud' ||
                    /ollama\.com/i.test(provider.baseUrl)
                  ? 'Ollama Cloud requires an API key.'
                  : 'Local hosts do not need an API key.'}
            </p>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="model">Model</label>
          <select
            id="model"
            value={
              customModel || (Boolean(provider.model.trim()) && !options.includes(provider.model))
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
              onProviderChange((prev) => ({ ...prev, model: next }));
            }}
          >
            <option value="">Choose a model after testing connection…</option>
            {options.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
            <option value="__custom__">Custom…</option>
          </select>
          {customModel || (Boolean(provider.model.trim()) && !options.includes(provider.model)) ? (
            <input
              className="settings-follow-input"
              value={provider.model}
              placeholder="custom model id"
              aria-label="Custom model ID"
              onChange={(e) =>
                onProviderChange((prev) => ({
                  ...prev,
                  model: e.target.value,
                }))
              }
            />
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection title="Credentials">
        <div className="row">
          <span className="mono">
            API key: {provider.hasApiKey ? 'configured' : 'not set'}
            {keyRequired ? ' (required)' : ''}
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
            Clear
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
          <button
            type="button"
            className="btn ghost"
            onClick={onRefreshModels}
            disabled={refreshingModels || provider.type === 'echo'}
            title="Refresh the model list from the provider"
          >
            {refreshingModels ? 'Refreshing…' : 'Refresh models'}
          </button>
          {connectionMessage || provider.connectionStatus ? (
            <span
              className={`settings-status-pill${
                provider.connectionOk
                  ? ' settings-status-pill--ok'
                  : provider.connectionOk === false
                    ? ' settings-status-pill--err'
                    : ''
              }`}
            >
              {connectionMessage ?? provider.connectionStatus}
            </span>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Token limits"
        description="Set the context window for this machine. Retrieval, compaction, mutation batches, and verification update immediately from that window."
      >
        <div className="settings-field-grid">
          <NumberField
            id="contextWindow"
            label="Context window"
            min={0}
            step={1}
            value={provider.contextWindow}
            onDraftChange={setDraftContextWindow}
            onCommit={(value) => {
              setDraftContextWindow(undefined);
              onProviderChange((prev) => ({
                ...prev,
                contextWindow: value,
              }));
            }}
          />
          <NumberField
            id="maxOutput"
            label="Max output"
            min={0}
            step={1}
            value={displayMaxOutput}
            onDraftChange={setDraftMaxOutput}
            onCommit={(value) => {
              setDraftMaxOutput(undefined);
              const next = normalizeMaximumOutputTokens(value);
              onProviderChange((prev) => ({
                ...prev,
                maximumOutputTokens: next,
              }));
            }}
          />
        </div>
        <p className="field-hint">
          {provider.contextWindow === 0
            ? `Context window 0 uses the model preset${
                provider.effectiveContextWindow
                  ? ` (currently ${provider.effectiveContextWindow.toLocaleString()} tokens)`
                  : ''
              }.`
            : `Context window will save as ${provider.contextWindow.toLocaleString()} tokens.`}
        </p>
        <p className="field-hint">
          {autoMaxOutput
            ? `Max output auto-scales with the window (${livePreview.maximumOutputTokens.toLocaleString()} tokens). Enter 0 to keep auto, or a positive number to override.`
            : `Max output will save as ${previewMaxOutput.toLocaleString()} tokens (fixed override). Set to 0 to resume auto-scaling.`}
        </p>
        {ui.tokenBudget.enabled ? (
          <p className="field-hint">
            Custom token-budget overrides are on. Use Reset budgets to
            defaults if you only want the context window to drive these
            numbers.
          </p>
        ) : null}
        <CustomerWindowBudgetSummary preview={livePreview} />
        <div className="row">
          <button
            type="button"
            className="btn ghost"
            onClick={onResetTokenBudget}
            title="Clear custom token-budget overrides and use built-in defaults for this window"
          >
            Reset budgets to defaults
          </button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Web search"
        description="Free SearXNG URL preferred. Optional Brave key for paid search. External/product asks grant web_search when a provider is configured."
      >
        <div className="field">
          <label htmlFor="searxng-base-url">SearXNG base URL</label>
          <input
            id="searxng-base-url"
            value={search.searxngBaseUrl}
            placeholder="http://127.0.0.1:8080"
            onChange={(event) =>
              onSearchChange((prev) => ({
                ...prev,
                searxngBaseUrl: event.target.value,
              }))
            }
          />
          <p className="field-hint">
            Overrides SEARXNG_BASE_URL / MITII_SEARXNG_URL. Example:{' '}
            http://192.168.0.91:8888
          </p>
        </div>
        <div className="row">
          <span className="settings-status-pill">
            Brave key:{' '}
            {search.hasApiKey ? 'configured' : 'not set'}
          </span>
          <button
            type="button"
            className="btn ghost"
            onClick={onSetSearchApiKey}
            title="Set Brave Search API key"
          >
            Set Brave key
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={onClearSearchApiKey}
            title="Clear Brave Search API key"
          >
            Clear
          </button>
        </div>
      </SettingsSection>
    </div>
  );
}
