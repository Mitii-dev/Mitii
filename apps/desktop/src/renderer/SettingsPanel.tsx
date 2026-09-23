/**
 * Desktop Settings — full VS Code Mitii parity (8 tabs).
 * Persists via Save → mitii-desktop.sqlite (global + per-workspace) + config.json/mcp.json + secrets.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  SETTINGS_TABS,
  catalogEntriesForPrefix,
  getSettingAtPath,
  mergeDesktopSettings,
  setSettingAtPath,
  type DesktopSettings,
  type SettingsTabId,
} from '../shared/settings.js';
import {
  fetchIndexStatus,
  fetchProfiles,
  fetchProviderModels,
  getDesktopBridge,
  pullOllamaEmbeddingModel,
  reindexWorkspace,
} from './api.js';
import type { DesktopStorageInfo } from '../shared/bridge.js';
import { ProfileSettings } from './ProfileSettings.js';

const NOMIC_EMBED_MODEL = 'nomic-embed-text';
const DEFAULT_OLLAMA_V1 = 'http://127.0.0.1:11434/v1';
const OLLAMA_INSTALL_URL = 'https://ollama.com/download';

type NomicInstallStatus =
  | 'checking'
  | 'ready'
  | 'missing'
  | 'downloading'
  | 'unreachable';

function resolveOllamaEmbeddingBaseUrl(providerBaseUrl?: string): string {
  const trimmed = providerBaseUrl?.trim();
  if (trimmed && /ollama|11434/i.test(trimmed)) {
    return trimmed;
  }
  return DEFAULT_OLLAMA_V1;
}

function isNomicEmbedInstalled(models: readonly string[]): boolean {
  const target = NOMIC_EMBED_MODEL;
  return models.some((id) => {
    const normalized = id.trim().toLowerCase().replace(/:latest$/, '');
    return (
      normalized === target ||
      normalized.startsWith(`${target}:`) ||
      target.startsWith(`${normalized}:`)
    );
  });
}

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
  onIndexStarted?: () => void;
  /** After Delete Cache/Logs — parent should reload snapshot/settings. */
  onWorkspaceCacheCleared?: () => void;
}

const PAGE_COPY: Record<SettingsTabId, { title: string; description: string }> =
  {
    storage: {
      title: 'Storage',
      description:
        'Root storage for all projects. Each project lives under projects/<name>--<id>/.',
    },
    workspaces: {
      title: 'Workspaces',
      description: 'Connected repositories and per-workspace index settings.',
    },
    profiles: {
      title: 'Profiles',
      description:
        'Provider, modes, and run budget. Open a tile to edit, or create a new profile.',
    },
    context: {
      title: 'Context',
      description: 'What Mitii attaches to each turn.',
    },
    features: {
      title: 'Features',
      description:
        'Autocomplete, code review, commit messages, web search, and semantic index.',
    },
    debug: {
      title: 'Developer',
      description:
        'Diagnostics and advanced controls. Applies to all profiles.',
    },
  };

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
  const [internalTab, setInternalTab] = useState<SettingsTabId>('profiles');
  const tab = props.tab ?? internalTab;
  const setTab = (next: SettingsTabId) => {
    if (props.onTabChange) props.onTabChange(next);
    else setInternalTab(next);
  };
  const [draft, setDraft] = useState<DesktopSettings>(() =>
    mergeDesktopSettings(props.settings),
  );
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [searchApiKey, setSearchApiKey] = useState('');
  const [clearSearchApiKey, setClearSearchApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<
    Array<{
      id: string;
      name: string;
      provider: { model: string; preset?: string; baseUrl?: string };
    }>
  >([]);
  const [activeProfileId, setActiveProfileId] = useState('default');
  const [indexMessage, setIndexMessage] = useState('…');
  const [reindexing, setReindexing] = useState(false);
  const [nomicStatus, setNomicStatus] = useState<NomicInstallStatus>('checking');
  const [nomicProgress, setNomicProgress] = useState<number | undefined>();
  const [nomicNote, setNomicNote] = useState<string | null>(null);
  const [storage, setStorage] = useState<DesktopStorageInfo | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  const [featureTab, setFeatureTab] = useState<
    'autocomplete' | 'review' | 'agent' | 'search' | 'index'
  >('autocomplete');

  const featureTabs = [
    { id: 'autocomplete' as const, label: 'Inline completion' },
    { id: 'review' as const, label: 'Working-tree review' },
    { id: 'agent' as const, label: 'Commit & agent' },
    { id: 'search' as const, label: 'Web search' },
    { id: 'index' as const, label: 'Semantic index' },
  ];

  const refreshStorage = async () => {
    const bridge = getDesktopBridge();
    if (!bridge?.getStorageInfo) return;
    try {
      setStorage(await bridge.getStorageInfo());
    } catch (err) {
      setStorageNote(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void refreshStorage();
  }, [props.workspaceRoot]);

  useEffect(() => {
    const next = mergeDesktopSettings(props.settings);
    setDraft(next);
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
        /* profiles list kept for Features autocomplete */
      })
      .catch(() => undefined);
    void fetchIndexStatus(opts)
      .then((status) => setIndexMessage(status.message))
      .catch(() => setIndexMessage('Index unavailable'));
  }, [props.engineBaseUrl, props.authToken, props.workspaceRoot]);

  const patch = (partial: unknown) => {
    setDraft((prev) => mergeDesktopSettings(partial, prev));
  };

  const ollamaEmbeddingBaseUrl = resolveOllamaEmbeddingBaseUrl(
    draft.provider.baseUrl,
  );

  const refreshNomicStatus = async () => {
    if (!props.engineBaseUrl || nomicStatus === 'downloading') return;
    setNomicStatus('checking');
    try {
      const models = await fetchProviderModels({
        baseUrl: props.engineBaseUrl,
        token: props.authToken,
        type: 'openai-compatible',
        providerBaseUrl: ollamaEmbeddingBaseUrl,
      });
      if (isNomicEmbedInstalled(models)) {
        setNomicStatus('ready');
        setNomicNote(null);
        return;
      }
      // Empty catalog usually means Ollama is down; still offer download.
      setNomicStatus(models.length === 0 ? 'unreachable' : 'missing');
      setNomicNote(
        models.length === 0
          ? 'Ollama is not reachable. Install and start Ollama to download Nomic.'
          : null,
      );
    } catch {
      setNomicStatus('unreachable');
      setNomicNote(
        'Ollama is not reachable. Install and start Ollama to download Nomic.',
      );
    }
  };

  useEffect(() => {
    if (!draft.semanticIndex.enabled || !props.engineBaseUrl) return;
    if (featureTab !== 'index') return;
    void refreshNomicStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when index tab / engine / ollama URL change
  }, [
    draft.semanticIndex.enabled,
    featureTab,
    props.engineBaseUrl,
    props.authToken,
    ollamaEmbeddingBaseUrl,
  ]);

  const downloadNomic = async () => {
    if (!props.engineBaseUrl || nomicStatus === 'downloading') return;
    setNomicStatus('downloading');
    setNomicProgress(undefined);
    setNomicNote('Downloading Nomic Embed Text via Ollama…');
    patch({
      semanticIndex: {
        ...draft.semanticIndex,
        enabled: true,
        source: 'ollama' as const,
        backend: 'ollama' as const,
        model: NOMIC_EMBED_MODEL,
        dimensions: 0,
        normalized: true,
      },
    });
    try {
      const result = await pullOllamaEmbeddingModel({
        baseUrl: props.engineBaseUrl,
        token: props.authToken,
        model: NOMIC_EMBED_MODEL,
        providerBaseUrl: ollamaEmbeddingBaseUrl,
        onProgress: (progress) => {
          if (progress.percent !== undefined) {
            setNomicProgress(progress.percent);
          }
          setNomicNote(
            progress.percent !== undefined
              ? `Downloading Nomic… ${progress.percent}%`
              : `Downloading Nomic… ${progress.status}`,
          );
        },
      });
      if (!result.ok) {
        const unreachable = /ollama|reach|ECONNREFUSED|install/i.test(
          result.error,
        );
        setNomicStatus(unreachable ? 'unreachable' : 'missing');
        setNomicProgress(undefined);
        setNomicNote(result.error);
        return;
      }
      setNomicStatus('ready');
      setNomicProgress(100);
      setNomicNote(
        'Nomic Embed Text is ready. Save settings, then reindex this workspace.',
      );
    } catch (err) {
      setNomicStatus('unreachable');
      setNomicProgress(undefined);
      setNomicNote(err instanceof Error ? err.message : String(err));
    }
  };

  const useNomicNow = () => {
    patch({
      semanticIndex: {
        ...draft.semanticIndex,
        enabled: true,
        source: 'ollama' as const,
        backend: 'ollama' as const,
        model: NOMIC_EMBED_MODEL,
        dimensions: 0,
        normalized: true,
      },
    });
    setNomicNote(
      'Using Nomic Embed Text. Save settings, then reindex this workspace.',
    );
  };

  const page = PAGE_COPY[tab];

  const save = async () => {
    setSaving(true);
    setNote(null);
    try {
      await props.onSave({
        settings: draft,
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

        <div className="settings-main__body">

        {tab === 'profiles' ? (
          <ProfileSettings
            draft={draft}
            patch={patch}
            setDraft={setDraft}
            engineBaseUrl={props.engineBaseUrl}
            authToken={props.authToken}
            hasApiKey={props.hasApiKey}
            busy={props.busy || saving}
            onProfilesChanged={props.onProfilesChanged}
            onPersistSettings={async (input) => {
              await props.onSave(input);
            }}
          />
        ) : null}

        {tab === 'features' ? (
          <div className="settings-panel">
            <nav className="features-tabs" aria-label="Features">
              {featureTabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`features-tab${featureTab === item.id ? ' is-active' : ''}`}
                  aria-current={featureTab === item.id ? 'page' : undefined}
                  onClick={() => setFeatureTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="features-tab-panel">
              {featureTab === 'autocomplete' ? (
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
                    <Field
                      id="acProfile"
                      label="Profile"
                      hint="Copies that profile’s model into autocomplete"
                    >
                      <select
                        id="acProfile"
                        value={
                          profiles.some((p) => p.id === activeProfileId)
                            ? activeProfileId
                            : ''
                        }
                        onChange={(e) => {
                          const id = e.target.value;
                          const profile = profiles.find((p) => p.id === id);
                          if (!profile) return;
                          patch({
                            autocomplete: {
                              ...draft.autocomplete,
                              model:
                                profile.provider.model ||
                                draft.autocomplete.model,
                              baseUrl:
                                profile.provider.baseUrl ||
                                draft.autocomplete.baseUrl,
                            },
                          });
                        }}
                      >
                        <option value="">Use active profile…</option>
                        {profiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.provider.model ? ` · ${p.provider.model}` : ''}
                          </option>
                        ))}
                      </select>
                    </Field>
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
                        <option value="openai-compatible">
                          openai-compatible
                        </option>
                      </select>
                    </Field>
                    <Field id="acMode" label="Mode">
                      <input
                        id="acMode"
                        value={draft.autocomplete.mode}
                        readOnly
                      />
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
              ) : null}

              {featureTab === 'review' ? (
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
              ) : null}

              {featureTab === 'agent' ? (
                <SettingsSection title="Commit messages & agent">
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
                      checked={draft.agent.taskListAutoAdvance}
                      onChange={(e) =>
                        patch({
                          agent: { taskListAutoAdvance: e.target.checked },
                        })
                      }
                    />
                    Task list auto-advance
                  </label>
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
              ) : null}

              {featureTab === 'search' ? (
                <SettingsSection
                  title="Web search"
                  description="SearXNG preferred; optional Brave key for fallback."
                >
                  <div className="field-grid">
                    <Field
                      id="featSearx"
                      label="SearXNG base URL"
                      full
                      hint="Base URL only (no /search). Instance must allow JSON."
                    >
                      <input
                        id="featSearx"
                        placeholder="http://127.0.0.1:8080"
                        value={draft.search.searxngBaseUrl}
                        onChange={(e) =>
                          patch({ search: { searxngBaseUrl: e.target.value } })
                        }
                      />
                    </Field>
                    <Field
                      id="featSearchKey"
                      label={`Web search API key${props.hasSearchApiKey ? ' (saved)' : ''}`}
                      full
                    >
                      <input
                        id="featSearchKey"
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
                          onChange={(e) =>
                            setClearSearchApiKey(e.target.checked)
                          }
                        />
                        Clear saved search API key
                      </label>
                    </Field>
                  </div>
                </SettingsSection>
              ) : null}

              {featureTab === 'index' ? (
                <SettingsSection
                  title="Semantic index"
                  description="Status is per repository. Embedding options below are shared across all repos — only relevant fields show for your source."
                >
                  <p className="field-help">{indexMessage}</p>

                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={draft.semanticIndex.enabled}
                      onChange={(e) =>
                        patch({
                          semanticIndex: {
                            ...draft.semanticIndex,
                            enabled: e.target.checked,
                            ...(e.target.checked
                              ? draft.semanticIndex.source === 'disabled'
                                ? {
                                    source: 'bundled' as const,
                                    backend: 'bundled' as const,
                                  }
                                : {}
                              : {
                                  source: 'disabled' as const,
                                  backend: 'disabled' as const,
                                }),
                          },
                        })
                      }
                    />
                    Enable semantic workspace indexing
                  </label>

                  {draft.semanticIndex.enabled ? (
                    <div className="field-grid">
                      <Field
                        id="embSource"
                        label="Embedding source"
                        full
                        hint="Bundled MiniLM runs on-device. HTTP sources need a reachable embeddings API."
                      >
                        <select
                          id="embSource"
                          value={
                            draft.semanticIndex.source === 'disabled'
                              ? 'bundled'
                              : draft.semanticIndex.source
                          }
                          onChange={(e) => {
                            const source = e.target
                              .value as DesktopSettings['semanticIndex']['source'];
                            patch({
                              semanticIndex: {
                                ...draft.semanticIndex,
                                source,
                                backend:
                                  source === 'bundled'
                                    ? 'bundled'
                                    : source === 'ollama'
                                      ? 'ollama'
                                      : source === 'openai-compatible'
                                        ? 'openai-compatible'
                                        : 'auto',
                              },
                            });
                          }}
                        >
                          <option value="bundled">Bundled MiniLM</option>
                          <option value="ollama">Ollama</option>
                          <option value="openai-compatible">
                            OpenAI-compatible
                          </option>
                        </select>
                      </Field>

                      {draft.semanticIndex.source === 'bundled' ? (
                        <p className="field-help field full">
                          Uses on-device MiniLM. Model URL and dimensions are not
                          required.
                        </p>
                      ) : null}

                      <div className="embedding-upgrade field full">
                        <div className="embedding-upgrade__copy">
                          <p className="embedding-upgrade__title">
                            Better accuracy (optional)
                          </p>
                          <p className="embedding-upgrade__body">
                            Download Nomic Embed Text for stronger semantic
                            search. ~274 MB via Ollama — not shipped with Mitii.
                            Bundled MiniLM still works without this.
                          </p>
                          {nomicNote ? (
                            <p className="field-help">{nomicNote}</p>
                          ) : null}
                          {nomicStatus === 'downloading' &&
                          nomicProgress !== undefined ? (
                            <div
                              className="embedding-upgrade__bar"
                              role="progressbar"
                              aria-valuenow={nomicProgress}
                              aria-valuemin={0}
                              aria-valuemax={100}
                            >
                              <span style={{ width: `${nomicProgress}%` }} />
                            </div>
                          ) : null}
                        </div>
                        <div className="embedding-upgrade__actions">
                          {nomicStatus === 'ready' ? (
                            <>
                              <span className="embedding-upgrade__badge">
                                Ready
                              </span>
                              {draft.semanticIndex.source !== 'ollama' ||
                              draft.semanticIndex.model.trim() !==
                                NOMIC_EMBED_MODEL ? (
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  onClick={useNomicNow}
                                >
                                  Use Nomic
                                </button>
                              ) : null}
                            </>
                          ) : null}
                          {nomicStatus === 'checking' ? (
                            <span className="embedding-upgrade__badge">
                              Checking…
                            </span>
                          ) : null}
                          {nomicStatus === 'downloading' ? (
                            <span className="embedding-upgrade__badge">
                              {nomicProgress !== undefined
                                ? `${nomicProgress}%`
                                : 'Downloading…'}
                            </span>
                          ) : null}
                          {nomicStatus === 'missing' ||
                          nomicStatus === 'unreachable' ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-primary"
                                disabled={
                                  !props.engineBaseUrl ||
                                  nomicStatus === 'downloading'
                                }
                                onClick={() => void downloadNomic()}
                              >
                                Download
                              </button>
                              {nomicStatus === 'unreachable' ? (
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  onClick={() => {
                                    void getDesktopBridge()?.openExternal(
                                      OLLAMA_INSTALL_URL,
                                    );
                                  }}
                                >
                                  Install Ollama
                                </button>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </div>

                      {draft.semanticIndex.source === 'ollama' ||
                      draft.semanticIndex.source === 'openai-compatible' ? (
                        <>
                          <Field
                            id="embModel"
                            label="Embedding model"
                            full
                            hint={
                              draft.semanticIndex.source === 'ollama'
                                ? 'Empty defaults to nomic-embed-text'
                                : 'Required for most OpenAI-compatible hosts'
                            }
                          >
                            <input
                              id="embModel"
                              value={draft.semanticIndex.model}
                              placeholder={
                                draft.semanticIndex.source === 'ollama'
                                  ? 'nomic-embed-text'
                                  : 'text-embedding-3-small'
                              }
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
                          <Field
                            id="embDim"
                            label="Dimensions"
                            hint="0 = model / probe default"
                          >
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
                        </>
                      ) : null}

                      <Field
                        id="maxFiles"
                        label="Maximum index files"
                        hint="0 = use default. Applies when reindexing this repo."
                      >
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
                    </div>
                  ) : (
                    <div className="field-grid">
                      <p className="field-help field full">
                        Semantic search is off. You can still build a lexical
                        index for this repo.
                      </p>
                      <Field
                        id="maxFilesOff"
                        label="Maximum index files"
                        hint="0 = use default"
                      >
                        <input
                          id="maxFilesOff"
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
                    </div>
                  )}

                  <div className="settings-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={reindexing || !props.engineBaseUrl}
                      onClick={() => {
                        if (!props.engineBaseUrl) return;
                        setReindexing(true);
                        setIndexMessage('Indexing…');
                        props.onIndexStarted?.();
                        void reindexWorkspace({
                          baseUrl: props.engineBaseUrl,
                          token: props.authToken,
                          maximumFiles:
                            draft.workspace.maximumIndexFiles || undefined,
                          semanticIndex: {
                            enabled: draft.semanticIndex.enabled,
                            source: draft.semanticIndex.source,
                            model:
                              draft.semanticIndex.model.trim() ||
                              (draft.semanticIndex.source === 'ollama'
                                ? NOMIC_EMBED_MODEL
                                : ''),
                            dimensions: draft.semanticIndex.dimensions,
                            normalized: draft.semanticIndex.normalized,
                            baseUrl:
                              draft.semanticIndex.source === 'ollama'
                                ? ollamaEmbeddingBaseUrl
                                : draft.provider.baseUrl,
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
                            props.onIndexChanged?.();
                          })
                          .finally(() => setReindexing(false));
                      }}
                    >
                      {reindexing ? 'Indexing…' : 'Reindex workspace'}
                    </button>
                  </div>
                </SettingsSection>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === 'workspaces' ? (
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
              title="Delete cache & logs"
              description="Clears rebuildable project data: logs, memory, index, checkpoints, plans, and resets workspace settings to defaults. Chat history, profiles, skills, and rules stay. .mitii is not removed."
            >
              <div className="field-grid">
                <div className="field full">
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={storageBusy || !props.workspaceRoot}
                    onClick={() => {
                      const bridge = getDesktopBridge();
                      if (!bridge?.clearWorkspaceCache) return;
                      const ok = window.confirm(
                        'Delete cache, logs, memory, and index for this workspace?\n\nChat history and profiles are kept. Settings reset to defaults.',
                      );
                      if (!ok) return;
                      setStorageBusy(true);
                      setStorageNote(null);
                      void bridge
                        .clearWorkspaceCache()
                        .then(async (result) => {
                          if (!result.ok) {
                            setStorageNote(result.reason ?? 'clear_failed');
                            return;
                          }
                          const count = result.removed?.length ?? 0;
                          setStorageNote(
                            count > 0
                              ? `Cleared ${count} cache item${count === 1 ? '' : 's'}.`
                              : 'Nothing cached to clear.',
                          );
                          await refreshStorage();
                          props.onWorkspaceCacheCleared?.();
                        })
                        .finally(() => setStorageBusy(false));
                    }}
                  >
                    Delete cache & logs…
                  </button>
                  {storageNote && tab === 'workspaces' ? (
                    <p className="field-help storage-note">{storageNote}</p>
                  ) : null}
                </div>
              </div>
            </SettingsSection>
          </div>
        ) : null}

        {tab === 'storage' ? (
          <div className="settings-panel">
            <SettingsSection
              title="Storage"
              description="Set a root folder once. Each project stores index, memory, skills, and chat history under Root/projects/<name>--<id>/, and the repo’s .mitii becomes a link."
            >
              <div className="storage-paths">
                <div className="storage-path-row">
                  <div className="storage-path-row__meta">
                    <strong>Root storage</strong>
                    <span className="field-help">
                      Parent for all projects
                      {storage?.rootStorageCustom
                        ? ' · active'
                        : ' · not set (data stays inside each repo’s .mitii)'}
                    </span>
                    <code className="storage-path-row__path">
                      {storage?.rootStoragePath ||
                        storage?.rootStorageDefaultPath ||
                        '…'}
                    </code>
                    {storage?.rootStorageCustom ? (
                      <span className="field-help">
                        Layout:{' '}
                        <code>
                          {`${storage.rootStoragePath || 'Root'}/projects/<project>--<id>/`}
                        </code>
                      </span>
                    ) : null}
                  </div>
                  <div className="storage-path-row__actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={!storage || storageBusy}
                      onClick={() => {
                        const bridge = getDesktopBridge();
                        if (!storage || !bridge?.revealInFolder) return;
                        const p =
                          storage.rootStoragePath ||
                          storage.rootStorageDefaultPath;
                        void bridge.revealInFolder(p);
                      }}
                    >
                      Reveal
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={storageBusy}
                      onClick={() => {
                        const bridge = getDesktopBridge();
                        if (!bridge?.pickDirectory || !bridge.setRootStorageLocation)
                          return;
                        setStorageBusy(true);
                        setStorageNote(null);
                        void bridge
                          .pickDirectory()
                          .then(async (picked) => {
                            if (!picked.ok || !picked.path) return;
                            const result = await bridge.setRootStorageLocation(
                              picked.path,
                            );
                            if (!result.ok) {
                              setStorageNote(result.reason ?? 'failed');
                              return;
                            }
                            setStorageNote(
                              'Root storage set. Projects live under projects/<name>--<id>/.',
                            );
                            await refreshStorage();
                          })
                          .finally(() => setStorageBusy(false));
                      }}
                    >
                      Choose…
                    </button>
                    {!storage?.rootStorageCustom ? (
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={storageBusy || !storage}
                        onClick={() => {
                          const bridge = getDesktopBridge();
                          if (!bridge?.setRootStorageLocation || !storage)
                            return;
                          setStorageBusy(true);
                          setStorageNote(null);
                          void bridge
                            .setRootStorageLocation(
                              storage.rootStorageDefaultPath,
                            )
                            .then(async (result) => {
                              if (!result.ok) {
                                setStorageNote(result.reason ?? 'failed');
                                return;
                              }
                              setStorageNote(
                                'Using recommended root. Active project linked under projects/.',
                              );
                              await refreshStorage();
                            })
                            .finally(() => setStorageBusy(false));
                        }}
                      >
                        Use recommended
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={storageBusy}
                        onClick={() => {
                          const bridge = getDesktopBridge();
                          if (!bridge?.setRootStorageLocation) return;
                          setStorageBusy(true);
                          void bridge
                            .setRootStorageLocation(null)
                            .then(async (result) => {
                              if (!result.ok) {
                                setStorageNote(result.reason ?? 'failed');
                                return;
                              }
                              setStorageNote(
                                'Root storage cleared (legacy in-repo mode).',
                              );
                              await refreshStorage();
                            })
                            .finally(() => setStorageBusy(false));
                        }}
                      >
                        Clear root
                      </button>
                    )}
                  </div>
                </div>

                <div className="storage-path-row">
                  <div className="storage-path-row__meta">
                    <strong>App data</strong>
                    <span className="field-help">
                      Settings database, secrets
                      {storage?.appDataCustom ? ' · custom' : ' · default'}
                    </span>
                    <code className="storage-path-row__path">
                      {storage?.appDataPath ?? '…'}
                    </code>
                  </div>
                  <div className="storage-path-row__actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={!storage || storageBusy}
                      onClick={() => {
                        const bridge = getDesktopBridge();
                        if (!storage || !bridge?.revealInFolder) return;
                        void bridge.revealInFolder(storage.appDataPath);
                      }}
                    >
                      Reveal
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={storageBusy}
                      onClick={() => {
                        const bridge = getDesktopBridge();
                        if (!bridge?.pickDirectory || !bridge.setAppDataLocation)
                          return;
                        setStorageBusy(true);
                        setStorageNote(null);
                        void bridge
                          .pickDirectory()
                          .then(async (picked) => {
                            if (!picked.ok || !picked.path) return;
                            const result = await bridge.setAppDataLocation(
                              picked.path,
                            );
                            if (!result.ok) {
                              setStorageNote(result.reason ?? 'failed');
                              return;
                            }
                            setStorageNote(
                              'App data location saved. Restart Mitii Desktop to apply.',
                            );
                            await refreshStorage();
                          })
                          .finally(() => setStorageBusy(false));
                      }}
                    >
                      Choose…
                    </button>
                    {storage?.appDataCustom ? (
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={storageBusy}
                        onClick={() => {
                          const bridge = getDesktopBridge();
                          if (!bridge?.setAppDataLocation) return;
                          setStorageBusy(true);
                          void bridge
                            .setAppDataLocation(null)
                            .then(async (result) => {
                              if (!result.ok) {
                                setStorageNote(result.reason ?? 'failed');
                                return;
                              }
                              setStorageNote(
                                'Reset to default app data. Restart Mitii Desktop to apply.',
                              );
                              await refreshStorage();
                            })
                            .finally(() => setStorageBusy(false));
                        }}
                      >
                        Use default
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="storage-path-row">
                  <div className="storage-path-row__meta">
                    <strong>
                      {storage?.usesRootStorage
                        ? `Project · ${storage.projectSlug || 'current'}`
                        : 'Workspace data (.mitii)'}
                    </strong>
                    <span className="field-help">
                      Index, memory, skills, chat history
                      {storage?.usesRootStorage
                        ? ` · under Root/projects/${storage.projectFolderName || '…'}`
                        : storage?.workspaceDataIsLink
                          ? ' · custom link'
                          : ' · in-repo (set Root storage to move out)'}
                    </span>
                    <code className="storage-path-row__path">
                      {storage?.workspaceDataTarget ?? '…'}
                    </code>
                    {storage?.usesRootStorage ? (
                      <span className="field-help">
                        Repo link: <code>{storage.workspaceDataPath}</code>
                      </span>
                    ) : null}
                  </div>
                  <div className="storage-path-row__actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={!storage || storageBusy}
                      onClick={() => {
                        const bridge = getDesktopBridge();
                        if (!storage || !bridge?.revealInFolder) return;
                        void bridge.revealInFolder(storage.workspaceDataTarget);
                      }}
                    >
                      Reveal
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={storageBusy || !props.workspaceRoot}
                      onClick={() => {
                        const bridge = getDesktopBridge();
                        if (
                          !bridge?.pickDirectory ||
                          !bridge.setWorkspaceDataLocation
                        )
                          return;
                        const ok = window.confirm(
                          'Override this project’s data folder?\n\nExisting files are moved and .mitii becomes a link to the new location.',
                        );
                        if (!ok) return;
                        setStorageBusy(true);
                        setStorageNote(null);
                        void bridge
                          .pickDirectory()
                          .then(async (picked) => {
                            if (!picked.ok || !picked.path) return;
                            const result =
                              await bridge.setWorkspaceDataLocation(
                                picked.path,
                              );
                            if (!result.ok) {
                              setStorageNote(result.reason ?? 'failed');
                              return;
                            }
                            setStorageNote(
                              `Project data now at ${result.target ?? picked.path}`,
                            );
                            await refreshStorage();
                          })
                          .finally(() => setStorageBusy(false));
                      }}
                    >
                      Choose…
                    </button>
                    {storage?.workspaceDataIsLink ? (
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={storageBusy}
                        onClick={() => {
                          const bridge = getDesktopBridge();
                          if (!bridge?.setWorkspaceDataLocation) return;
                          setStorageBusy(true);
                          void bridge
                            .setWorkspaceDataLocation(null)
                            .then(async (result) => {
                              if (!result.ok) {
                                setStorageNote(result.reason ?? 'failed');
                                return;
                              }
                              setStorageNote(
                                storage?.usesRootStorage
                                  ? 'Restored link to Root/projects/<name>/.'
                                  : 'Workspace data restored under <repo>/.mitii',
                              );
                              await refreshStorage();
                            })
                            .finally(() => setStorageBusy(false));
                        }}
                      >
                        Reset link
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="storage-path-row">
                  <div className="storage-path-row__meta">
                    <strong>Logs</strong>
                    <span className="field-help">
                      Chat session JSONL (same as VS Code):{' '}
                      <code>MM-DD-YYYY-HH-MM-thread_….jsonl</code>. Also{' '}
                      <code>engine.log</code> / <code>runs.log</code>.
                    </span>
                    <code className="storage-path-row__path">
                      {storage?.logsPath ?? '…'}
                    </code>
                  </div>
                  <div className="storage-path-row__actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={!storage || storageBusy}
                      onClick={() => {
                        const bridge = getDesktopBridge();
                        if (!storage || !bridge?.revealInFolder) return;
                        void bridge.revealInFolder(storage.logsPath);
                      }}
                    >
                      Reveal
                    </button>
                  </div>
                </div>
              </div>
              {storageNote ? (
                <p className="field-help storage-note">{storageNote}</p>
              ) : null}
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

        </div>

        {tab !== 'profiles' ? (
          <div className="settings-footer">
            <div className="settings-footer__actions">
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
                  setApiKey('');
                  setClearApiKey(false);
                  setSearchApiKey('');
                  setClearSearchApiKey(false);
                  setNote(null);
                }}
              >
                Reset draft
              </button>
            </div>
            {note ? (
              <p className="field-help settings-footer__note">{note}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
