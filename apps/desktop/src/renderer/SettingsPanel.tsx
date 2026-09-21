/**
 * Desktop Settings — full VS Code Mitii parity (8 tabs).
 * Persists via Save → mitii-desktop.sqlite (global + per-workspace) + config.json/mcp.json + secrets.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  PROVIDER_PRESET_OPTIONS,
  SETTINGS_TABS,
  catalogEntriesForPrefix,
  getSettingAtPath,
  mergeDesktopSettings,
  setSettingAtPath,
  type DesktopSettings,
  type SettingsTabId,
} from '../shared/settings.js';
import { DEFAULT_DESKTOP_SETTINGS } from '../shared/vscode-settings-defaults.js';
import {
  fetchIndexStatus,
  fetchProfiles,
  postProfiles,
  reindexWorkspace,
  testConnection,
} from './api.js';

interface SettingsPanelProps {
  settings: DesktopSettings;
  workspaceRoot: string;
  hasApiKey: boolean;
  hasSearchApiKey: boolean;
  busy: boolean;
  engineBaseUrl?: string;
  authToken?: string;
  /** Controlled settings category (from activity bar). */
  tab?: SettingsTabId;
  onTabChange?: (tab: SettingsTabId) => void;
  /** Hide the internal text nav when the activity bar owns categories. */
  hideSideNav?: boolean;
  onSave: (input: {
    settings: DesktopSettings;
    apiKey?: string;
    clearApiKey?: boolean;
    searchApiKey?: string;
    clearSearchApiKey?: boolean;
  }) => Promise<void>;
  onPickWorkspace?: () => void;
  onProfilesChanged?: (activeName: string) => void;
  onIndexChanged?: () => void;
}

const PAGE_COPY: Record<SettingsTabId, { title: string; description: string }> =
  {
    model: {
      title: 'Provider',
      description: 'Connect a model first. Everything else depends on this.',
    },
    autocomplete: {
      title: 'Autocomplete',
      description: 'Inline FIM suggestions for editor hosts.',
    },
    workspace: {
      title: 'Workspace',
      description: 'Folder and local index used for context.',
    },
    modes: {
      title: 'Modes',
      description: 'Defaults and run limits for Ask, Plan, and Agent.',
    },
    context: {
      title: 'Context',
      description: 'What Mitii attaches to each turn.',
    },
    features: {
      title: 'Features',
      description: 'Opt-in surfaces. Off by default until you enable them.',
    },
    integrations: {
      title: 'MCP',
      description: 'Optional servers. Off by default.',
    },
    debug: {
      title: 'Developer',
      description:
        'Diagnostics and advanced controls. Leave off unless you need them.',
    },
  };

type ModeId = 'ask' | 'plan' | 'agent';

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
      <header className="settings-section-header">
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </header>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  full,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`field${full ? ' full' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? <p className="field-help">{hint}</p> : null}
    </div>
  );
}

function CatalogNumberFields({
  draft,
  prefix,
  disabled,
  onChange,
}: {
  draft: DesktopSettings;
  prefix: string;
  disabled?: boolean;
  onChange: (next: DesktopSettings) => void;
}) {
  const entries = useMemo(
    () =>
      catalogEntriesForPrefix(prefix).filter((e) => {
        const t = e.entry.type;
        return t === 'number' || (Array.isArray(t) && t.includes('number'));
      }),
    [prefix],
  );
  return (
    <div className="field-grid">
      {entries.map(({ key, shortKey, entry }) => {
        const value = getSettingAtPath(draft, key);
        const n = typeof value === 'number' ? value : Number(entry.default) || 0;
        return (
          <Field key={key} id={key} label={shortKey} hint={entry.description}>
            <input
              id={key}
              type="number"
              disabled={disabled}
              min={entry.minimum}
              max={entry.maximum}
              value={n}
              onChange={(e) =>
                onChange(
                  setSettingAtPath(draft, key, Number(e.target.value) || 0),
                )
              }
            />
          </Field>
        );
      })}
    </div>
  );
}

export function SettingsPanel(props: SettingsPanelProps) {
  const [internalTab, setInternalTab] = useState<SettingsTabId>('model');
  const tab = props.tab ?? internalTab;
  const setTab = (next: SettingsTabId) => {
    if (props.onTabChange) props.onTabChange(next);
    else setInternalTab(next);
  };
  const [draft, setDraft] = useState<DesktopSettings>(() =>
    mergeDesktopSettings(props.settings),
  );
  const [modeTab, setModeTab] = useState<ModeId>('ask');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [searchApiKey, setSearchApiKey] = useState('');
  const [clearSearchApiKey, setClearSearchApiKey] = useState(false);
  const [mcpJson, setMcpJson] = useState(() =>
    JSON.stringify(props.settings.mcp.servers ?? [], null, 2),
  );
  const [mcpJsonError, setMcpJsonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<
    Array<{ id: string; name: string; provider: { model: string; preset?: string } }>
  >([]);
  const [activeProfileId, setActiveProfileId] = useState('default');
  const [profileName, setProfileName] = useState('Default');
  const [indexMessage, setIndexMessage] = useState('…');
  const [reindexing, setReindexing] = useState(false);

  useEffect(() => {
    const next = mergeDesktopSettings(props.settings);
    setDraft(next);
    setMcpJson(JSON.stringify(next.mcp.servers ?? [], null, 2));
    setMcpJsonError(null);
  }, [props.settings]);

  useEffect(() => {
    if (!props.engineBaseUrl) return;
    const opts = {
      baseUrl: props.engineBaseUrl,
      token: props.authToken,
    };
    void fetchProfiles(opts)
      .then((file) => {
        setProfiles(file.profiles);
        setActiveProfileId(file.activeProfileId);
        const active =
          file.profiles.find((p) => p.id === file.activeProfileId) ??
          file.profiles[0];
        if (active) setProfileName(active.name);
      })
      .catch(() => undefined);
    void fetchIndexStatus(opts)
      .then((status) => setIndexMessage(status.message))
      .catch(() => setIndexMessage('Index unavailable'));
  }, [props.engineBaseUrl, props.authToken, props.workspaceRoot]);

  const presetMeta = useMemo(
    () =>
      PROVIDER_PRESET_OPTIONS.find((p) => p.id === draft.provider.preset) ??
      PROVIDER_PRESET_OPTIONS[0]!,
    [draft.provider.preset],
  );

  const page = PAGE_COPY[tab];
  const modeDefault = draft.ui.modeDefaults[modeTab];

  const onPreset = (presetId: string) => {
    const preset = PROVIDER_PRESET_OPTIONS.find((p) => p.id === presetId);
    if (!preset) return;
    setDraft((prev) => ({
      ...prev,
      provider: {
        ...prev.provider,
        preset: preset.id,
        type: preset.type,
      },
    }));
  };

  const patch = (partial: unknown) => {
    setDraft((prev) => mergeDesktopSettings(partial, prev));
  };

  const applyMcpServers = (): DesktopSettings | null => {
    try {
      const parsed = JSON.parse(mcpJson) as unknown;
      if (!Array.isArray(parsed)) {
        setMcpJsonError('MCP servers must be a JSON array');
        return null;
      }
      setMcpJsonError(null);
      return mergeDesktopSettings(
        { mcp: { ...draft.mcp, servers: parsed } },
        draft,
      );
    } catch (err) {
      setMcpJsonError(err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  const save = async () => {
    const withMcp = applyMcpServers();
    if (!withMcp) return;
    setSaving(true);
    setNote(null);
    try {
      await props.onSave({
        settings: withMcp,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(clearApiKey ? { clearApiKey: true } : {}),
        ...(searchApiKey.trim() ? { searchApiKey: searchApiKey.trim() } : {}),
        ...(clearSearchApiKey ? { clearSearchApiKey: true } : {}),
      });
      setApiKey('');
      setClearApiKey(false);
      setSearchApiKey('');
      setClearSearchApiKey(false);
      setNote('Saved. Settings applied.');
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`settings-view${props.hideSideNav ? ' settings-view--rail' : ''}`}
    >
      {props.hideSideNav ? null : (
        <nav className="settings-nav" aria-label="Settings">
          {SETTINGS_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`settings-nav-item${tab === id ? ' is-active' : ''}`}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      <div className="settings-main">
        <header className="settings-page-header">
          <h1>{page.title}</h1>
          <p>{page.description}</p>
        </header>

        {tab === 'model' ? (
          <div className="settings-panel">
            <SettingsSection
              title="Connection"
              description="Choose the provider and model Mitii will call."
            >
              <div className="field-grid">
                <Field id="preset" label="Provider">
                  <select
                    id="preset"
                    value={draft.provider.preset}
                    onChange={(e) => onPreset(e.target.value)}
                  >
                    {PROVIDER_PRESET_OPTIONS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="type" label="Adapter">
                  <input id="type" value={presetMeta.type} readOnly />
                </Field>
                {draft.provider.type !== 'echo' ? (
                  <Field
                    id="baseUrl"
                    label="Base URL"
                    full
                    hint={
                      draft.provider.type === 'anthropic' ||
                      draft.provider.type === 'gemini'
                        ? 'Override only for a proxy or regional endpoint.'
                        : 'Local hosts do not need an API key.'
                    }
                  >
                    <input
                      id="baseUrl"
                      placeholder="http://localhost:11434/v1"
                      value={draft.provider.baseUrl}
                      onChange={(e) =>
                        patch({
                          provider: {
                            ...draft.provider,
                            baseUrl: e.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                ) : null}
                <Field id="model" label="Model" full>
                  <input
                    id="model"
                    placeholder="qwen3-coder:30b"
                    value={draft.provider.model}
                    onChange={(e) =>
                      patch({
                        provider: { ...draft.provider, model: e.target.value },
                      })
                    }
                  />
                </Field>
              </div>
            </SettingsSection>

            <SettingsSection title="Credentials">
              <div className="field-grid">
                <Field
                  id="apiKey"
                  label={`API key${props.hasApiKey ? ' (saved — leave blank to keep)' : ''}`}
                  full
                >
                  <input
                    id="apiKey"
                    type="password"
                    autoComplete="off"
                    placeholder={
                      props.hasApiKey ? '••••••••  (unchanged)' : 'Optional'
                    }
                    value={apiKey}
                    disabled={clearApiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={clearApiKey}
                      onChange={(e) => setClearApiKey(e.target.checked)}
                    />
                    Clear saved API key
                  </label>
                </Field>
              </div>
              <div className="settings-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={testing || !props.engineBaseUrl}
                  onClick={() => {
                    if (!props.engineBaseUrl) return;
                    setTesting(true);
                    setTestNote(null);
                    void testConnection({
                      baseUrl: props.engineBaseUrl,
                      token: props.authToken,
                      type: draft.provider.type,
                      providerBaseUrl: draft.provider.baseUrl,
                      model: draft.provider.model,
                      apiKey: apiKey.trim() || undefined,
                    })
                      .then((result) => {
                        setTestNote(
                          result.ok
                            ? result.message
                            : `Failed: ${result.message}`,
                        );
                        if (result.models?.length) setModels(result.models);
                      })
                      .catch((err: unknown) => {
                        setTestNote(
                          err instanceof Error ? err.message : String(err),
                        );
                      })
                      .finally(() => setTesting(false));
                  }}
                >
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
                {testNote ? <p className="field-help">{testNote}</p> : null}
              </div>
              {models.length > 0 ? (
                <Field id="discoveredModels" label="Discovered models" full>
                  <select
                    id="discoveredModels"
                    value={
                      models.includes(draft.provider.model)
                        ? draft.provider.model
                        : ''
                    }
                    onChange={(e) =>
                      patch({
                        provider: {
                          ...draft.provider,
                          model: e.target.value,
                        },
                      })
                    }
                  >
                    <option value="">Choose a model…</option>
                    {models.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
            </SettingsSection>

            <SettingsSection
              title="Profiles"
              description="Saved globally in Mitii Desktop SQLite (shared across repos)."
            >
              <div className="field-grid">
                <Field id="profileSelect" label="Active profile">
                  <select
                    id="profileSelect"
                    value={activeProfileId}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!props.engineBaseUrl) return;
                      void postProfiles({
                        baseUrl: props.engineBaseUrl,
                        token: props.authToken,
                        body: { action: 'activate', profileId: id },
                      }).then(async (raw) => {
                        const result = raw as {
                          active?: {
                            id: string;
                            name: string;
                            provider: DesktopSettings['provider'];
                          };
                          profiles?: typeof profiles;
                        };
                        if (result.profiles) setProfiles(result.profiles);
                        if (result.active) {
                          setActiveProfileId(result.active.id);
                          setProfileName(result.active.name);
                          patch({
                            provider: {
                              ...draft.provider,
                              ...result.active.provider,
                              type: result.active.provider
                                .type as DesktopSettings['provider']['type'],
                              preset: (result.active.provider.preset ??
                                result.active.provider
                                  .type) as DesktopSettings['provider']['preset'],
                            },
                          });
                          props.onProfilesChanged?.(result.active.name);
                        }
                      });
                    }}
                  >
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.provider.model ? ` · ${p.provider.model}` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="profileName" label="Profile name">
                  <input
                    id="profileName"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                  />
                </Field>
              </div>
              <div className="settings-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!props.engineBaseUrl}
                  onClick={() => {
                    if (!props.engineBaseUrl) return;
                    void postProfiles({
                      baseUrl: props.engineBaseUrl,
                      token: props.authToken,
                      body: {
                        action: 'upsert',
                        id: activeProfileId,
                        name: profileName || 'Default',
                        provider: draft.provider,
                        hasSecret: props.hasApiKey || Boolean(apiKey.trim()),
                        apiKey: apiKey.trim() || undefined,
                      },
                    }).then((raw) => {
                      const result = raw as {
                        profiles?: { profiles: typeof profiles; activeProfileId: string };
                        profile?: { id: string; name: string };
                      };
                      const file = result.profiles;
                      if (file && Array.isArray((file as unknown as { profiles: typeof profiles }).profiles)) {
                        // handled below
                      }
                      void fetchProfiles({
                        baseUrl: props.engineBaseUrl!,
                        token: props.authToken,
                      }).then((f) => {
                        setProfiles(f.profiles);
                        setActiveProfileId(f.activeProfileId);
                        props.onProfilesChanged?.(profileName || 'Default');
                        setNote('Profile saved to Desktop SQLite (global).');
                      });
                    });
                  }}
                >
                  Save as profile
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!props.engineBaseUrl || profiles.length <= 1}
                  onClick={() => {
                    if (!props.engineBaseUrl) return;
                    void postProfiles({
                      baseUrl: props.engineBaseUrl,
                      token: props.authToken,
                      body: {
                        action: 'delete',
                        profileId: activeProfileId,
                      },
                    }).then(() =>
                      fetchProfiles({
                        baseUrl: props.engineBaseUrl!,
                        token: props.authToken,
                      }).then((f) => {
                        setProfiles(f.profiles);
                        setActiveProfileId(f.activeProfileId);
                        const active =
                          f.profiles.find((p) => p.id === f.activeProfileId) ??
                          f.profiles[0];
                        if (active) {
                          setProfileName(active.name);
                          props.onProfilesChanged?.(active.name);
                        }
                      }),
                    );
                  }}
                >
                  Delete profile
                </button>
              </div>
            </SettingsSection>

            <SettingsSection
              title="Web search"
              description="SearXNG preferred; optional Brave key for fallback."
            >
              <div className="field-grid">
                <Field
                  id="searx"
                  label="SearXNG base URL"
                  full
                  hint="Base URL only (no /search). Instance must allow JSON."
                >
                  <input
                    id="searx"
                    placeholder="http://127.0.0.1:8080"
                    value={draft.search.searxngBaseUrl}
                    onChange={(e) =>
                      patch({ search: { searxngBaseUrl: e.target.value } })
                    }
                  />
                </Field>
                <Field
                  id="searchKey"
                  label={`Web search API key${props.hasSearchApiKey ? ' (saved)' : ''}`}
                  full
                >
                  <input
                    id="searchKey"
                    type="password"
                    autoComplete="off"
                    placeholder={
                      props.hasSearchApiKey
                        ? '••••••••  (unchanged)'
                        : 'Optional Brave / search key'
                    }
                    value={searchApiKey}
                    disabled={clearSearchApiKey}
                    onChange={(e) => setSearchApiKey(e.target.value)}
                  />
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={clearSearchApiKey}
                      onChange={(e) => setClearSearchApiKey(e.target.checked)}
                    />
                    Clear saved search API key
                  </label>
                </Field>
              </div>
            </SettingsSection>

            <SettingsSection
              title="Token limits"
              description="Context window drives retrieval, compaction, and verification. 0 = auto."
            >
              <div className="field-grid">
                <Field id="ctx" label="Context window">
                  <input
                    id="ctx"
                    type="number"
                    min={0}
                    value={draft.provider.contextWindow}
                    onChange={(e) =>
                      patch({
                        provider: {
                          ...draft.provider,
                          contextWindow: Number(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </Field>
                <Field id="maxOut" label="Max output tokens">
                  <input
                    id="maxOut"
                    type="number"
                    min={0}
                    value={draft.provider.maximumOutputTokens}
                    onChange={(e) =>
                      patch({
                        provider: {
                          ...draft.provider,
                          maximumOutputTokens: Number(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </Field>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  patch({
                    tokenBudget: structuredClone(
                      DEFAULT_DESKTOP_SETTINGS.tokenBudget,
                    ),
                  })
                }
              >
                Reset token-budget overrides
              </button>
            </SettingsSection>
          </div>
        ) : null}

        {tab === 'autocomplete' ? (
          <div className="settings-panel">
            <SettingsSection
              title="Inline completion"
              description="Separate from Ask/Plan/Agent so you can use a fast FIM model."
            >
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.autocomplete.enabled}
                  onChange={(e) =>
                    patch({
                      autocomplete: {
                        ...draft.autocomplete,
                        enabled: e.target.checked,
                      },
                    })
                  }
                />
                Enable autocomplete
              </label>
              <div className="field-grid">
                <Field id="acProvider" label="Provider">
                  <select
                    id="acProvider"
                    value={draft.autocomplete.provider}
                    onChange={(e) =>
                      patch({
                        autocomplete: {
                          ...draft.autocomplete,
                          provider: e.target.value as 'openai-compatible',
                        },
                      })
                    }
                  >
                    <option value="openai-compatible">openai-compatible</option>
                  </select>
                </Field>
                <Field id="acMode" label="Mode">
                  <input id="acMode" value={draft.autocomplete.mode} readOnly />
                </Field>
                <Field
                  id="acBase"
                  label="Base URL"
                  full
                  hint="Empty inherits Provider base URL"
                >
                  <input
                    id="acBase"
                    value={draft.autocomplete.baseUrl}
                    placeholder={draft.provider.baseUrl || 'inherit'}
                    onChange={(e) =>
                      patch({
                        autocomplete: {
                          ...draft.autocomplete,
                          baseUrl: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field
                  id="acModel"
                  label="Model"
                  hint="Empty inherits Provider model"
                >
                  <input
                    id="acModel"
                    value={draft.autocomplete.model}
                    placeholder={draft.provider.model || 'inherit'}
                    onChange={(e) =>
                      patch({
                        autocomplete: {
                          ...draft.autocomplete,
                          model: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field id="acPath" label="Endpoint path">
                  <input
                    id="acPath"
                    value={draft.autocomplete.endpointPath}
                    onChange={(e) =>
                      patch({
                        autocomplete: {
                          ...draft.autocomplete,
                          endpointPath: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field id="acAuth" label="Auth header">
                  <select
                    id="acAuth"
                    value={draft.autocomplete.authHeader}
                    onChange={(e) =>
                      patch({
                        autocomplete: {
                          ...draft.autocomplete,
                          authHeader: e.target
                            .value as DesktopSettings['autocomplete']['authHeader'],
                        },
                      })
                    }
                  >
                    <option value="authorization">authorization</option>
                    <option value="api-key">api-key</option>
                    <option value="x-api-key">x-api-key</option>
                  </select>
                </Field>
                <Field id="acMax" label="Max tokens">
                  <input
                    id="acMax"
                    type="number"
                    min={1}
                    max={512}
                    value={draft.autocomplete.maxTokens}
                    onChange={(e) =>
                      patch({
                        autocomplete: {
                          ...draft.autocomplete,
                          maxTokens: Number(e.target.value) || 1,
                        },
                      })
                    }
                  />
                </Field>
                <Field id="acDebounce" label="Debounce (ms)">
                  <input
                    id="acDebounce"
                    type="number"
                    min={0}
                    max={2000}
                    value={draft.autocomplete.debounceMs}
                    onChange={(e) =>
                      patch({
                        autocomplete: {
                          ...draft.autocomplete,
                          debounceMs: Number(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </Field>
                <Field id="acTimeout" label="Timeout (ms)">
                  <input
                    id="acTimeout"
                    type="number"
                    min={250}
                    max={30000}
                    value={draft.autocomplete.timeoutMs}
                    onChange={(e) =>
                      patch({
                        autocomplete: {
                          ...draft.autocomplete,
                          timeoutMs: Number(e.target.value) || 250,
                        },
                      })
                    }
                  />
                </Field>
                <Field id="acPrefix" label="Prefix chars">
                  <input
                    id="acPrefix"
                    type="number"
                    min={128}
                    max={60000}
                    value={draft.autocomplete.prefixChars}
                    onChange={(e) =>
                      patch({
                        autocomplete: {
                          ...draft.autocomplete,
                          prefixChars: Number(e.target.value) || 128,
                        },
                      })
                    }
                  />
                </Field>
                <Field id="acSuffix" label="Suffix chars">
                  <input
                    id="acSuffix"
                    type="number"
                    min={0}
                    max={60000}
                    value={draft.autocomplete.suffixChars}
                    onChange={(e) =>
                      patch({
                        autocomplete: {
                          ...draft.autocomplete,
                          suffixChars: Number(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </Field>
                <Field id="acTemp" label="Temperature">
                  <input
                    id="acTemp"
                    type="number"
                    min={0}
                    max={2}
                    step={0.05}
                    value={draft.autocomplete.temperature}
                    onChange={(e) =>
                      patch({
                        autocomplete: {
                          ...draft.autocomplete,
                          temperature: Number(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </Field>
              </div>
            </SettingsSection>
          </div>
        ) : null}

        {tab === 'workspace' ? (
          <div className="settings-panel">
            <SettingsSection title="Folder">
              <div className="field-grid">
                <Field id="wsPath" label="Active workspace" full>
                  <input
                    id="wsPath"
                    value={props.workspaceRoot}
                    readOnly
                    className="mono-input"
                  />
                </Field>
                {props.onPickWorkspace ? (
                  <div className="field full">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={props.onPickWorkspace}
                    >
                      Open folder…
                    </button>
                  </div>
                ) : null}
                <Field
                  id="rootOverride"
                  label="Root path override"
                  full
                  hint="Empty = use active workspace root"
                >
                  <input
                    id="rootOverride"
                    value={draft.workspace.rootPathOverride}
                    onChange={(e) =>
                      patch({
                        workspace: {
                          ...draft.workspace,
                          rootPathOverride: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
              </div>
            </SettingsSection>

            <SettingsSection
              title="Semantic index"
              description="Embeddings power semantic search. Reindex after changing source."
            >
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.semanticIndex.enabled}
                  onChange={(e) =>
                    patch({
                      semanticIndex: {
                        ...draft.semanticIndex,
                        enabled: e.target.checked,
                      },
                    })
                  }
                />
                Enable semantic workspace indexing
              </label>
              <div className="field-grid">
                <Field id="embSource" label="Embedding source">
                  <select
                    id="embSource"
                    value={draft.semanticIndex.source}
                    onChange={(e) =>
                      patch({
                        semanticIndex: {
                          ...draft.semanticIndex,
                          source: e.target
                            .value as DesktopSettings['semanticIndex']['source'],
                        },
                      })
                    }
                  >
                    <option value="bundled">Bundled MiniLM</option>
                    <option value="ollama">Ollama</option>
                    <option value="openai-compatible">OpenAI-compatible</option>
                    <option value="disabled">Disabled (lexical only)</option>
                  </select>
                </Field>
                <Field id="embBackend" label="Backend (legacy alias)">
                  <select
                    id="embBackend"
                    value={draft.semanticIndex.backend}
                    onChange={(e) =>
                      patch({
                        semanticIndex: {
                          ...draft.semanticIndex,
                          backend: e.target
                            .value as DesktopSettings['semanticIndex']['backend'],
                        },
                      })
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="bundled">Bundled</option>
                    <option value="ollama">Ollama</option>
                    <option value="openai-compatible">OpenAI-compatible</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </Field>
                <Field id="embModel" label="Embedding model">
                  <input
                    id="embModel"
                    value={draft.semanticIndex.model}
                    onChange={(e) =>
                      patch({
                        semanticIndex: {
                          ...draft.semanticIndex,
                          model: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field id="embDim" label="Dimensions (0 = model default)">
                  <input
                    id="embDim"
                    type="number"
                    min={0}
                    value={draft.semanticIndex.dimensions}
                    onChange={(e) =>
                      patch({
                        semanticIndex: {
                          ...draft.semanticIndex,
                          dimensions: Number(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </Field>
                <Field id="maxFiles" label="Maximum index files">
                  <input
                    id="maxFiles"
                    type="number"
                    min={0}
                    max={240000}
                    value={draft.workspace.maximumIndexFiles}
                    onChange={(e) =>
                      patch({
                        workspace: {
                          ...draft.workspace,
                          maximumIndexFiles: Number(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </Field>
                <label className="checkbox-row field full">
                  <input
                    type="checkbox"
                    checked={draft.semanticIndex.normalized}
                    onChange={(e) =>
                      patch({
                        semanticIndex: {
                          ...draft.semanticIndex,
                          normalized: e.target.checked,
                        },
                      })
                    }
                  />
                  Normalize embedding vectors
                </label>
              </div>
              <p className="field-help">{indexMessage}</p>
              <div className="settings-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={reindexing || !props.engineBaseUrl}
                  onClick={() => {
                    if (!props.engineBaseUrl) return;
                    setReindexing(true);
                    void reindexWorkspace({
                      baseUrl: props.engineBaseUrl,
                      token: props.authToken,
                      maximumFiles: draft.workspace.maximumIndexFiles || undefined,
                      semanticIndex: {
                        enabled: draft.semanticIndex.enabled,
                        source: draft.semanticIndex.source,
                        model: draft.semanticIndex.model,
                        dimensions: draft.semanticIndex.dimensions,
                        normalized: draft.semanticIndex.normalized,
                        baseUrl: draft.provider.baseUrl,
                      },
                    })
                      .then((result) => {
                        setIndexMessage(result.message);
                        if (result.statusSnapshot) {
                          setIndexMessage(result.statusSnapshot.message);
                        }
                        props.onIndexChanged?.();
                      })
                      .catch((err: unknown) => {
                        setIndexMessage(
                          err instanceof Error ? err.message : String(err),
                        );
                      })
                      .finally(() => setReindexing(false));
                  }}
                >
                  {reindexing ? 'Indexing…' : 'Reindex workspace'}
                </button>
              </div>
            </SettingsSection>

            <SettingsSection title="Skills">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.skills.workspace.enabled}
                  onChange={(e) =>
                    patch({
                      skills: {
                        workspace: { enabled: e.target.checked },
                      },
                    })
                  }
                />
                Load workspace skills from `.mitii/skills`
              </label>
            </SettingsSection>
          </div>
        ) : null}

        {tab === 'modes' ? (
          <div className="settings-panel">
            <SettingsSection title="Mode defaults">
              <div className="mode-settings-tabs" role="tablist">
                {(['ask', 'plan', 'agent'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={modeTab === m}
                    className={`mode-settings-tab${modeTab === m ? ' is-active' : ''}`}
                    onClick={() => setModeTab(m)}
                  >
                    {m[0]!.toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
              <p className="field-help">
                {modeTab === 'ask'
                  ? 'Ask stays lightweight: read, explain, and answer with minimal workspace impact.'
                  : modeTab === 'plan'
                    ? 'Plan focuses on structure: clarify scope, draft phases, and save a handoff-ready plan.'
                    : 'Agent is execution-focused: use tools, edit files, and stop at approval and budget limits.'}
              </p>
              <div className="field-grid">
                <Field id="approval" label="Approval mode">
                  <select
                    id="approval"
                    value={
                      modeDefault.approvalMode === 'builder'
                        ? 'guided'
                        : modeDefault.approvalMode
                    }
                    onChange={(e) => {
                      const approvalMode = e.target
                        .value as DesktopSettings['ui']['modeDefaults']['ask']['approvalMode'];
                      patch({
                        ui: {
                          ...draft.ui,
                          modeDefaults: {
                            ...draft.ui.modeDefaults,
                            [modeTab]: { ...modeDefault, approvalMode },
                          },
                        },
                        safety: {
                          ...draft.safety,
                          approvalMode:
                            modeTab === 'agent'
                              ? approvalMode
                              : draft.safety.approvalMode,
                        },
                      });
                    }}
                  >
                    <option value="safe">Ask for approval</option>
                    <option value="guided">Approve for me</option>
                    <option value="pilot">Full access</option>
                  </select>
                </Field>
                <Field
                  id="modeModel"
                  label="Default model"
                  hint="Empty = use active Provider model"
                >
                  <input
                    id="modeModel"
                    value={modeDefault.model}
                    placeholder={draft.provider.model || 'Use active model'}
                    onChange={(e) =>
                      patch({
                        ui: {
                          ...draft.ui,
                          modeDefaults: {
                            ...draft.ui.modeDefaults,
                            [modeTab]: {
                              ...modeDefault,
                              model: e.target.value,
                            },
                          },
                        },
                      })
                    }
                  />
                </Field>
                <Field id="thoroughness" label="Thoroughness">
                  <select
                    id="thoroughness"
                    value={modeDefault.thoroughness}
                    onChange={(e) =>
                      patch({
                        ui: {
                          ...draft.ui,
                          modeDefaults: {
                            ...draft.ui.modeDefaults,
                            [modeTab]: {
                              ...modeDefault,
                              thoroughness: e.target
                                .value as typeof modeDefault.thoroughness,
                            },
                          },
                        },
                      })
                    }
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </Field>
                <Field id="depthMode" label="Depth">
                  <select
                    id="depthMode"
                    value={modeDefault.depth}
                    onChange={(e) =>
                      patch({
                        ui: {
                          ...draft.ui,
                          modeDefaults: {
                            ...draft.ui.modeDefaults,
                            [modeTab]: {
                              ...modeDefault,
                              depth: e.target
                                .value as typeof modeDefault.depth,
                            },
                          },
                        },
                      })
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="quick">Quick</option>
                    <option value="deep">Deep</option>
                  </select>
                </Field>
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.ui.showReasoning}
                  onChange={(e) =>
                    patch({
                      ui: { ...draft.ui, showReasoning: e.target.checked },
                    })
                  }
                />
                Show reasoning stream
              </label>
              <div className="field-grid">
                <Field id="previewChars" label="Reasoning preview chars">
                  <input
                    id="previewChars"
                    type="number"
                    min={500}
                    max={50000}
                    value={draft.ui.reasoningPreviewMaxChars}
                    onChange={(e) =>
                      patch({
                        ui: {
                          ...draft.ui,
                          reasoningPreviewMaxChars:
                            Number(e.target.value) || 500,
                        },
                      })
                    }
                  />
                </Field>
                <Field id="uiDepth" label="Global depth">
                  <select
                    id="uiDepth"
                    value={draft.ui.depth}
                    onChange={(e) =>
                      patch({
                        ui: {
                          ...draft.ui,
                          depth: e.target
                            .value as DesktopSettings['ui']['depth'],
                        },
                      })
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="quick">Quick</option>
                    <option value="deep">Deep</option>
                  </select>
                </Field>
                <Field id="uiEffort" label="Global effort">
                  <select
                    id="uiEffort"
                    value={draft.ui.effort}
                    onChange={(e) =>
                      patch({
                        ui: {
                          ...draft.ui,
                          effort: e.target
                            .value as DesktopSettings['ui']['effort'],
                        },
                      })
                    }
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </Field>
              </div>
            </SettingsSection>

            <SettingsSection
              title="Run budget"
              description="Optional safety caps for one turn."
            >
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.runBudget.unlimited}
                  onChange={(e) =>
                    patch({
                      runBudget: {
                        ...draft.runBudget,
                        unlimited: e.target.checked,
                      },
                    })
                  }
                />
                Unlimited run budget
              </label>
              <div className="field-grid">
                <Field id="maxModelCalls" label="Model calls">
                  <input
                    id="maxModelCalls"
                    type="number"
                    min={1}
                    disabled={draft.runBudget.unlimited}
                    value={draft.runBudget.maxModelCalls}
                    onChange={(e) =>
                      patch({
                        runBudget: {
                          ...draft.runBudget,
                          maxModelCalls: Number(e.target.value) || 1,
                        },
                      })
                    }
                  />
                </Field>
                <Field id="maxToolCalls" label="Tool calls">
                  <input
                    id="maxToolCalls"
                    type="number"
                    min={1}
                    disabled={draft.runBudget.unlimited}
                    value={draft.runBudget.maxToolCalls}
                    onChange={(e) =>
                      patch({
                        runBudget: {
                          ...draft.runBudget,
                          maxToolCalls: Number(e.target.value) || 1,
                        },
                      })
                    }
                  />
                </Field>
                <Field id="maxLoop" label="Loop iterations">
                  <input
                    id="maxLoop"
                    type="number"
                    min={1}
                    disabled={draft.runBudget.unlimited}
                    value={draft.runBudget.maxLoopIterations}
                    onChange={(e) =>
                      patch({
                        runBudget: {
                          ...draft.runBudget,
                          maxLoopIterations: Number(e.target.value) || 1,
                        },
                      })
                    }
                  />
                </Field>
                <Field id="maxWall" label="Wall time (min)">
                  <input
                    id="maxWall"
                    type="number"
                    min={1}
                    disabled={draft.runBudget.unlimited}
                    value={draft.runBudget.maxWallTimeMinutes}
                    onChange={(e) =>
                      patch({
                        runBudget: {
                          ...draft.runBudget,
                          maxWallTimeMinutes: Number(e.target.value) || 1,
                        },
                      })
                    }
                  />
                </Field>
              </div>
            </SettingsSection>

            <SettingsSection title="Safety & sandbox">
              <div className="field-grid">
                <Field id="safetyApproval" label="Global approval mode">
                  <select
                    id="safetyApproval"
                    value={
                      draft.safety.approvalMode === 'builder'
                        ? 'guided'
                        : draft.safety.approvalMode
                    }
                    onChange={(e) =>
                      patch({
                        safety: {
                          ...draft.safety,
                          approvalMode: e.target
                            .value as DesktopSettings['safety']['approvalMode'],
                        },
                      })
                    }
                  >
                    <option value="safe">Safe</option>
                    <option value="guided">Guided</option>
                    <option value="pilot">Pilot</option>
                  </select>
                </Field>
                <Field id="sandboxBackend" label="Sandbox backend">
                  <select
                    id="sandboxBackend"
                    value={draft.safety.sandbox.backend}
                    onChange={(e) =>
                      patch({
                        safety: {
                          ...draft.safety,
                          sandbox: {
                            ...draft.safety.sandbox,
                            backend: e.target
                              .value as DesktopSettings['safety']['sandbox']['backend'],
                          },
                        },
                      })
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="seatbelt">Seatbelt</option>
                    <option value="bubblewrap">Bubblewrap</option>
                    <option value="docker">Docker</option>
                    <option value="podman">Podman</option>
                  </select>
                </Field>
                <Field id="sandboxEn" label="Sandbox enabled">
                  <select
                    id="sandboxEn"
                    value={
                      draft.safety.sandbox.enabled === null
                        ? ''
                        : draft.safety.sandbox.enabled
                          ? '1'
                          : '0'
                    }
                    onChange={(e) =>
                      patch({
                        safety: {
                          ...draft.safety,
                          sandbox: {
                            ...draft.safety.sandbox,
                            enabled:
                              e.target.value === ''
                                ? null
                                : e.target.value === '1',
                          },
                        },
                      })
                    }
                  >
                    <option value="">Follow approval preset</option>
                    <option value="1">On</option>
                    <option value="0">Off</option>
                  </select>
                </Field>
                <Field id="sandboxNet" label="Sandbox network">
                  <select
                    id="sandboxNet"
                    value={draft.safety.sandbox.network ?? ''}
                    onChange={(e) =>
                      patch({
                        safety: {
                          ...draft.safety,
                          sandbox: {
                            ...draft.safety.sandbox,
                            network:
                              e.target.value === ''
                                ? null
                                : (e.target.value as 'deny' | 'allow'),
                          },
                        },
                      })
                    }
                  >
                    <option value="">Follow approval preset</option>
                    <option value="deny">Deny</option>
                    <option value="allow">Allow</option>
                  </select>
                </Field>
              </div>
            </SettingsSection>
          </div>
        ) : null}

        {tab === 'context' ? (
          <div className="settings-panel">
            <SettingsSection
              title="Sources"
              description="Choose what evidence is attached to each turn."
            >
              {(
                [
                  ['repoMap', 'Repository map'],
                  ['diagnostics', 'Diagnostics'],
                  ['gitDiff', 'Git diff'],
                  ['editor', 'Active editor'],
                  ['openTabs', 'Open tabs'],
                  ['memory', 'Memory'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={draft.ui.contextToggles[key]}
                    onChange={(e) =>
                      patch({
                        ui: {
                          ...draft.ui,
                          contextToggles: {
                            ...draft.ui.contextToggles,
                            [key]: e.target.checked,
                          },
                        },
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </SettingsSection>
          </div>
        ) : null}

        {tab === 'features' ? (
          <div className="settings-panel">
            <SettingsSection
              title="Working-tree review"
              description="Code Review runs an LLM analysis of git changes."
            >
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.ui.features.codeReviewButton}
                  onChange={(e) =>
                    patch({
                      ui: {
                        ...draft.ui,
                        features: { codeReviewButton: e.target.checked },
                      },
                    })
                  }
                />
                Show Code Review button
              </label>
            </SettingsSection>
            <SettingsSection title="Agent & SCM">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.agent.taskListAutoAdvance}
                  onChange={(e) =>
                    patch({
                      agent: { taskListAutoAdvance: e.target.checked },
                    })
                  }
                />
                Task list auto-advance
              </label>
              <div className="field-grid">
                <Field id="commitStyle" label="Commit message style">
                  <select
                    id="commitStyle"
                    value={draft.scm.commitMessageStyle}
                    onChange={(e) =>
                      patch({
                        scm: {
                          commitMessageStyle: e.target
                            .value as DesktopSettings['scm']['commitMessageStyle'],
                        },
                      })
                    }
                  >
                    <option value="conventional">Conventional</option>
                    <option value="plain">Plain</option>
                  </select>
                </Field>
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.tools.applyPatch.fuzzyMatch}
                  onChange={(e) =>
                    patch({
                      tools: {
                        applyPatch: { fuzzyMatch: e.target.checked },
                      },
                    })
                  }
                />
                Fuzzy match for apply_patch
              </label>
            </SettingsSection>
          </div>
        ) : null}

        {tab === 'integrations' ? (
          <div className="settings-panel">
            <SettingsSection
              title="Servers"
              description="JSON array of MCP server installs. Saved to `.mitii/mcp.json`."
            >
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.mcp.enabled}
                  onChange={(e) =>
                    patch({ mcp: { ...draft.mcp, enabled: e.target.checked } })
                  }
                />
                Enable MCP
              </label>
              <Field id="mcpServers" label="Servers JSON" full>
                <textarea
                  id="mcpServers"
                  className="settings-json"
                  rows={12}
                  value={mcpJson}
                  onChange={(e) => setMcpJson(e.target.value)}
                  spellCheck={false}
                />
              </Field>
              {mcpJsonError ? (
                <p className="field-help danger-text">{mcpJsonError}</p>
              ) : null}
            </SettingsSection>
          </div>
        ) : null}

        {tab === 'debug' ? (
          <div className="settings-panel">
            <SettingsSection
              title="Access"
              description="Unlocks logging and local token / loop editors."
            >
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.developer.enabled}
                  onChange={(e) =>
                    patch({
                      developer: {
                        ...draft.developer,
                        enabled: e.target.checked,
                      },
                    })
                  }
                />
                Enable developer settings
              </label>
            </SettingsSection>

            <SettingsSection title="Logging">
              <div
                className={`developer-options${draft.developer.enabled ? '' : ' is-locked'}`}
              >
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    disabled={!draft.developer.enabled}
                    checked={draft.debug}
                    onChange={(e) => patch({ debug: e.target.checked })}
                  />
                  Debug logging
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    disabled={!draft.developer.enabled}
                    checked={draft.developer.modelIo}
                    onChange={(e) =>
                      patch({
                        developer: {
                          ...draft.developer,
                          modelIo: e.target.checked,
                        },
                      })
                    }
                  />
                  Model I/O dumps
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    disabled={!draft.developer.enabled}
                    checked={draft.developer.intensityOverrides}
                    onChange={(e) =>
                      patch({
                        developer: {
                          ...draft.developer,
                          intensityOverrides: e.target.checked,
                        },
                      })
                    }
                  />
                  Intensity overrides (depth / effort separate)
                </label>
                <div className="field-grid">
                  <Field id="logVerbosity" label="Log verbosity">
                    <select
                      id="logVerbosity"
                      disabled={!draft.developer.enabled}
                      value={draft.logVerbosity}
                      onChange={(e) =>
                        patch({
                          logVerbosity: e.target
                            .value as DesktopSettings['logVerbosity'],
                        })
                      }
                    >
                      <option value="minimal">Minimal</option>
                      <option value="standard">Standard</option>
                      <option value="verbose">Verbose</option>
                    </select>
                  </Field>
                </div>
              </div>
            </SettingsSection>

            <SettingsSection
              title="Token budget"
              description="All mitii.tokenBudget.* keys. Requires developer access."
            >
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  disabled={!draft.developer.enabled}
                  checked={draft.tokenBudget.enabled}
                  onChange={(e) =>
                    patch({
                      tokenBudget: {
                        ...draft.tokenBudget,
                        enabled: e.target.checked,
                      },
                    })
                  }
                />
                Enable custom token-budget overrides
              </label>
              <CatalogNumberFields
                draft={draft}
                prefix="tokenBudget"
                disabled={!draft.developer.enabled || !draft.tokenBudget.enabled}
                onChange={setDraft}
              />
            </SettingsSection>

            <SettingsSection
              title="Loop policy"
              description="All mitii.loopPolicy.* keys."
            >
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  disabled={!draft.developer.enabled}
                  checked={draft.loopPolicy.enabled}
                  onChange={(e) =>
                    patch({
                      loopPolicy: {
                        ...draft.loopPolicy,
                        enabled: e.target.checked,
                      },
                    })
                  }
                />
                Enable loop policy overrides
              </label>
              <CatalogNumberFields
                draft={draft}
                prefix="loopPolicy"
                disabled={!draft.developer.enabled || !draft.loopPolicy.enabled}
                onChange={setDraft}
              />
            </SettingsSection>
          </div>
        ) : null}

        <div className="settings-actions sticky-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || props.busy}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save & apply'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={saving}
            onClick={() => {
              const next = mergeDesktopSettings(props.settings);
              setDraft(next);
              setMcpJson(JSON.stringify(next.mcp.servers ?? [], null, 2));
              setApiKey('');
              setClearApiKey(false);
              setSearchApiKey('');
              setClearSearchApiKey(false);
              setMcpJsonError(null);
              setNote(null);
            }}
          >
            Reset draft
          </button>
          {note ? <p className="field-help">{note}</p> : null}
        </div>
      </div>
    </div>
  );
}
