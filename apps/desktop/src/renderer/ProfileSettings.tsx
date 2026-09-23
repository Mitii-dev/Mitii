/**
 * Profiles settings — gallery tiles + guided create + focused edit.
 */

import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';

import {
  PROVIDER_PRESET_OPTIONS,
  normalizeDesktopProviderModel,
  type DesktopSettings,
} from '../shared/settings.js';
import { DEFAULT_DESKTOP_SETTINGS } from '../shared/vscode-settings-defaults.js';
import {
  deriveLiveTokenBudgetPreview,
  isAutoMaximumOutputTokens,
  normalizeMaximumOutputTokens,
  resolvePreviewContextWindow,
} from '../shared/liveTokenBudgetPreview.js';
import { fetchProfiles, fetchProviderModels, getDesktopBridge, postProfiles, testConnection } from './api.js';
import { TokenBudgetAllocation } from './TokenBudgetAllocation.js';

type ProfileRow = {
  id: string;
  name: string;
  provider: {
    model: string;
    preset?: string;
    baseUrl?: string;
    type?: string;
    contextWindow?: number;
    maximumOutputTokens?: number;
  };
  hasSecret?: boolean;
};

type ModeId = 'ask' | 'plan' | 'agent';
type ViewMode = 'gallery' | 'edit' | 'create';
type CreateStep = 1 | 2 | 3 | 4;

function Field(props: {
  id: string;
  label: string;
  hint?: string;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      className={`field${props.full ? ' full' : ''}`}
      htmlFor={props.id}
    >
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint ? <span className="field-help">{props.hint}</span> : null}
    </label>
  );
}

function SettingsSection(props: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <header className="settings-section-header">
        <h3>{props.title}</h3>
        {props.description ? <p>{props.description}</p> : null}
      </header>
      <div className="settings-section-body">{props.children}</div>
    </section>
  );
}

export interface ProfileSettingsProps {
  draft: DesktopSettings;
  patch: (partial: unknown) => void;
  setDraft: Dispatch<SetStateAction<DesktopSettings>>;
  engineBaseUrl?: string;
  authToken?: string;
  hasApiKey: boolean;
  busy: boolean;
  onProfilesChanged?: (activeName: string) => void;
  onPersistSettings: (input: {
    settings: DesktopSettings;
    apiKey?: string;
    clearApiKey?: boolean;
  }) => Promise<void>;
}

export function ProfileSettings(props: ProfileSettingsProps) {
  const [view, setView] = useState<ViewMode>('gallery');
  const [createStep, setCreateStep] = useState<CreateStep>(1);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [activeProfileId, setActiveProfileId] = useState('default');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('Default');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);
  const [connectionOk, setConnectionOk] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [modeTab, setModeTab] = useState<ModeId>('ask');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const presetMeta = useMemo(
    () =>
      PROVIDER_PRESET_OPTIONS.find((p) => p.id === props.draft.provider.preset) ??
      PROVIDER_PRESET_OPTIONS[0]!,
    [props.draft.provider.preset],
  );

  const modeDefault = props.draft.ui.modeDefaults[modeTab];

  const previewContextWindow = resolvePreviewContextWindow({
    stored: props.draft.provider.contextWindow,
    fallback: 32_768,
  });
  const storedMaxOutput = normalizeMaximumOutputTokens(
    props.draft.provider.maximumOutputTokens,
  );
  const autoMaxOutput = isAutoMaximumOutputTokens(storedMaxOutput);
  const tokenBudgetPolicy = useMemo(() => {
    if (!props.draft.tokenBudget?.enabled) return undefined;
    const policy: Record<string, number> = {};
    for (const [key, value] of Object.entries(props.draft.tokenBudget)) {
      if (key === 'enabled') continue;
      if (typeof value === 'number' && Number.isFinite(value)) {
        policy[key] = value;
      }
    }
    return Object.keys(policy).length > 0 ? policy : undefined;
  }, [props.draft.tokenBudget]);
  const livePreview = useMemo(
    () =>
      deriveLiveTokenBudgetPreview({
        contextWindowTokens: previewContextWindow,
        maximumOutputTokens: storedMaxOutput,
        policy: tokenBudgetPolicy,
        runBudget: props.draft.runBudget,
      }),
    [
      previewContextWindow,
      storedMaxOutput,
      tokenBudgetPolicy,
      props.draft.runBudget,
    ],
  );
  const displayMaxOutput = autoMaxOutput
    ? livePreview.maximumOutputTokens
    : storedMaxOutput;

  const refreshProfiles = async () => {
    if (!props.engineBaseUrl) return;
    const file = await fetchProfiles({
      baseUrl: props.engineBaseUrl,
      token: props.authToken,
    });
    setProfiles(file.profiles as ProfileRow[]);
    setActiveProfileId(file.activeProfileId);
    return file;
  };

  useEffect(() => {
    void refreshProfiles().catch(() => undefined);
  }, [props.engineBaseUrl, props.authToken]);

  const onPreset = (presetId: string) => {
    const preset = PROVIDER_PRESET_OPTIONS.find((p) => p.id === presetId);
    if (!preset) return;
    props.setDraft((prev) => ({
      ...prev,
      provider: {
        ...prev.provider,
        preset: preset.id,
        type: preset.type,
        baseUrl: preset.baseUrl,
        ...(preset.model !== undefined
          ? { model: preset.model || prev.provider.model }
          : {}),
      },
    }));
    setConnectionOk(false);
    setTestNote(null);
    setModels([]);
  };

  const loadProfileIntoDraft = (profile: ProfileRow) => {
    setEditingId(profile.id);
    setProfileName(profile.name);
    setApiKey('');
    setClearApiKey(false);
    setTestNote(null);
    setConnectionOk(false);
    setModels([]);
    props.patch({
      provider: {
        ...props.draft.provider,
        ...profile.provider,
        type: (profile.provider.type ??
          props.draft.provider.type) as DesktopSettings['provider']['type'],
        preset: (profile.provider.preset ??
          profile.provider.type ??
          props.draft.provider.preset) as DesktopSettings['provider']['preset'],
        baseUrl: profile.provider.baseUrl ?? props.draft.provider.baseUrl,
        model: profile.provider.model ?? '',
        contextWindow:
          profile.provider.contextWindow ?? props.draft.provider.contextWindow,
        maximumOutputTokens: normalizeMaximumOutputTokens(
          profile.provider.maximumOutputTokens ??
            props.draft.provider.maximumOutputTokens,
        ),
      },
    });
    if (props.engineBaseUrl) {
      void fetchProviderModels({
        baseUrl: props.engineBaseUrl,
        token: props.authToken,
        type: profile.provider.type || 'openai-compatible',
        providerBaseUrl: profile.provider.baseUrl,
      })
        .then((listed) => {
          setModels(listed);
        })
        .catch(() => undefined);
    }
  };

  const startCreate = () => {
    setView('create');
    setCreateStep(1);
    setEditingId(null);
    setProfileName('');
    setApiKey('');
    setClearApiKey(false);
    setTestNote(null);
    setConnectionOk(false);
    setModels([]);
    setNote(null);
    props.patch({
      provider: structuredClone(DEFAULT_DESKTOP_SETTINGS.provider),
    });
  };

  const startEdit = async (profile: ProfileRow) => {
    if (props.engineBaseUrl) {
      try {
        await postProfiles({
          baseUrl: props.engineBaseUrl,
          token: props.authToken,
          body: { action: 'activate', profileId: profile.id },
        });
        setActiveProfileId(profile.id);
        props.onProfilesChanged?.(profile.name);
      } catch {
        /* still open editor */
      }
    }
    loadProfileIntoDraft(profile);
    setView('edit');
    setNote(null);
  };

  const backToGallery = () => {
    setView('gallery');
    setEditingId(null);
    setCreateStep(1);
    setNote(null);
    setTestNote(null);
    void refreshProfiles().catch(() => undefined);
  };

  const runTest = async () => {
    if (!props.engineBaseUrl) return;
    setTesting(true);
    setTestNote(null);
    try {
      const result = await testConnection({
        baseUrl: props.engineBaseUrl,
        token: props.authToken,
        type: props.draft.provider.type,
        providerBaseUrl: props.draft.provider.baseUrl,
        model: props.draft.provider.model,
        apiKey: apiKey.trim() || undefined,
      });
      setTestNote(result.ok ? result.message : `Failed: ${result.message}`);
      setConnectionOk(Boolean(result.ok));
      if (result.models?.length) setModels(result.models);
    } catch (err) {
      setConnectionOk(false);
      setTestNote(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const saveProfile = async () => {
    if (!props.engineBaseUrl) {
      setNote('Engine is not ready yet.');
      return;
    }
    const name = profileName.trim() || 'Untitled profile';
    const baseUrl = props.draft.provider.baseUrl;
    let preset = props.draft.provider.preset;
    if (/ollama\.com/i.test(baseUrl) && preset === 'ollama') {
      preset = 'ollama-cloud';
    }
    const model = normalizeDesktopProviderModel(
      props.draft.provider.model,
      baseUrl,
    );
    const provider = {
      type: props.draft.provider.type,
      preset,
      baseUrl,
      model,
      contextWindow: props.draft.provider.contextWindow,
      maximumOutputTokens: normalizeMaximumOutputTokens(
        props.draft.provider.maximumOutputTokens,
      ),
    };
    const settings = {
      ...props.draft,
      provider: {
        ...props.draft.provider,
        preset,
        model,
        maximumOutputTokens: provider.maximumOutputTokens,
      },
    };
    setSaving(true);
    setNote(null);
    try {
      // Upsert the profile BEFORE saveSettings — saveSettings restarts the
      // engine and rotates the auth token, which would make this call 401.
      await postProfiles({
        baseUrl: props.engineBaseUrl,
        token: props.authToken,
        body: {
          action: 'upsert',
          ...(editingId ? { id: editingId } : {}),
          name,
          provider,
          hasSecret: props.hasApiKey || Boolean(apiKey.trim()),
          apiKey: apiKey.trim() || undefined,
        },
      });

      await props.onPersistSettings({
        settings,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(clearApiKey ? { clearApiKey: true } : {}),
      });

      // Engine may have restarted; refresh with current bridge credentials.
      const bridge = getDesktopBridge();
      const fresh =
        bridge && typeof bridge.getSnapshot === 'function'
          ? await bridge.getSnapshot()
          : null;
      if (fresh?.engineBaseUrl) {
        const file = await fetchProfiles({
          baseUrl: fresh.engineBaseUrl,
          token: fresh.authToken,
        });
        setProfiles(file.profiles as ProfileRow[]);
        setActiveProfileId(file.activeProfileId);
        const saved =
          file.profiles.find((p) => p.name === name) ??
          file.profiles.find((p) => p.id === editingId) ??
          file.profiles.find((p) => p.id === file.activeProfileId);
        if (saved) {
          setActiveProfileId(saved.id);
          setEditingId(saved.id);
          props.onProfilesChanged?.(saved.name);
        }
      } else {
        props.onProfilesChanged?.(name);
      }

      setApiKey('');
      setClearApiKey(false);
      setNote('Profile saved.');
      setView('gallery');
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteProfile = async () => {
    if (!props.engineBaseUrl || !editingId) return;
    if (profiles.length <= 1) {
      setNote('Keep at least one profile.');
      return;
    }
    const ok = window.confirm(`Delete profile “${profileName}”?`);
    if (!ok) return;
    setSaving(true);
    try {
      await postProfiles({
        baseUrl: props.engineBaseUrl,
        token: props.authToken,
        body: { action: 'delete', profileId: editingId },
      });
      await refreshProfiles();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(editingId);
        return next;
      });
      backToGallery();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectAllProfiles = (checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(profiles.map((p) => p.id)));
  };

  const deleteSelectedProfiles = async () => {
    if (!props.engineBaseUrl || selectedIds.size === 0) return;
    if (profiles.length <= 1) {
      setNote('Keep at least one profile.');
      return;
    }
    const deletable = [...selectedIds].filter((id) =>
      profiles.some((p) => p.id === id),
    );
    if (deletable.length === 0) return;
    if (deletable.length >= profiles.length) {
      setNote('Keep at least one profile. Uncheck one, then delete.');
      return;
    }
    const names = deletable
      .map((id) => profiles.find((p) => p.id === id)?.name ?? id)
      .join(', ');
    const ok = window.confirm(
      deletable.length === 1
        ? `Delete profile “${names}”?`
        : `Delete ${deletable.length} profiles?\n${names}`,
    );
    if (!ok) return;
    setSaving(true);
    setNote(null);
    try {
      for (const id of deletable) {
        await postProfiles({
          baseUrl: props.engineBaseUrl,
          token: props.authToken,
          body: { action: 'delete', profileId: id },
        });
      }
      const file = await refreshProfiles();
      setSelectedIds(new Set());
      if (file) {
        const active = file.profiles.find(
          (p) => p.id === file.activeProfileId,
        );
        if (active) props.onProfilesChanged?.(active.name);
      }
      setNote(
        deletable.length === 1
          ? 'Profile deleted.'
          : `${deletable.length} profiles deleted.`,
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
      await refreshProfiles().catch(() => undefined);
    } finally {
      setSaving(false);
    }
  };

  const providerFields = (
    <>
      <div className="field-grid">
        <Field id="preset" label="Provider">
          <select
            id="preset"
            value={props.draft.provider.preset}
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
        {props.draft.provider.type !== 'echo' ? (
          <Field
            id="baseUrl"
            label="Base URL"
            full
            hint={
              props.draft.provider.type === 'anthropic' ||
              props.draft.provider.type === 'gemini'
                ? 'Override only for a proxy or regional endpoint.'
                : 'Local hosts often do not need an API key.'
            }
          >
            <input
              id="baseUrl"
              placeholder={presetMeta.baseUrl || 'https://…'}
              value={props.draft.provider.baseUrl}
              onChange={(e) => {
                setConnectionOk(false);
                props.patch({
                  provider: {
                    ...props.draft.provider,
                    baseUrl: e.target.value,
                  },
                });
              }}
            />
          </Field>
        ) : null}
      </div>
    </>
  );

  const credentialsFields = (
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
          placeholder={props.hasApiKey ? '••••••••  (unchanged)' : 'Optional'}
          value={apiKey}
          disabled={clearApiKey}
          onChange={(e) => {
            setConnectionOk(false);
            setApiKey(e.target.value);
          }}
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
  );

  const modelFields = (
    <>
      <div className="field-grid">
        <Field id="model" label="Model" full>
          <input
            id="model"
            placeholder="qwen3-coder:30b"
            value={props.draft.provider.model}
            onChange={(e) =>
              props.patch({
                provider: { ...props.draft.provider, model: e.target.value },
              })
            }
          />
        </Field>
        {models.length > 0 ? (
          <Field id="discoveredModels" label="Discovered models" full>
            <select
              id="discoveredModels"
              value={
                models.includes(props.draft.provider.model)
                  ? props.draft.provider.model
                  : ''
              }
              onChange={(e) =>
                props.patch({
                  provider: {
                    ...props.draft.provider,
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
      </div>
    </>
  );

  const tokenLimitsSection = (
    <SettingsSection
      title="Token limits"
      description="Set the context window for this machine. Retrieval, compaction, mutation batches, and verification update immediately from that window."
    >
      <div className="field-grid">
        <Field id="ctx" label="Context window">
          <input
            id="ctx"
            type="number"
            min={0}
            step={1}
            value={props.draft.provider.contextWindow}
            onChange={(e) =>
              props.patch({
                provider: {
                  ...props.draft.provider,
                  contextWindow: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                },
              })
            }
          />
        </Field>
        <Field id="maxOut" label="Max output">
          <input
            id="maxOut"
            type="number"
            min={0}
            step={1}
            value={displayMaxOutput}
            onChange={(e) => {
              const next = normalizeMaximumOutputTokens(
                Number(e.target.value) || 0,
              );
              props.patch({
                provider: {
                  ...props.draft.provider,
                  maximumOutputTokens: next,
                },
              });
            }}
          />
        </Field>
      </div>
      <p className="field-help">
        {props.draft.provider.contextWindow === 0
          ? `Context window 0 uses the model preset (preview ${previewContextWindow.toLocaleString()} tokens).`
          : `Context window will save as ${props.draft.provider.contextWindow.toLocaleString()} tokens.`}
      </p>
      <p className="field-help">
        {autoMaxOutput
          ? `Max output auto-scales with the window (${livePreview.maximumOutputTokens.toLocaleString()} tokens). Enter 0 to keep auto, or a positive number to override.`
          : `Max output will save as ${storedMaxOutput.toLocaleString()} tokens (fixed override). Set to 0 to resume auto-scaling.`}
      </p>
      <p className="field-help">
        These values follow the context window as you edit it. Use Developer →
        Token budget if you need sliders for files per mutation or module
        shares.
      </p>
      <TokenBudgetAllocation preview={livePreview} />
      <dl className="token-budget-kv">
        {(
          [
            ['Effective window', livePreview.contextWindowTokens],
            ['Usable input', livePreview.usableInputTokens],
            ['Output reserve', livePreview.maximumOutputTokens],
            ['Model-call cap', livePreview.maxModelCalls],
            ['Files per mutation', livePreview.maxUniqueFilesPerCall],
            ['Verification checks', livePreview.maxVerificationChecks],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="token-budget-kv__row">
            <dt>{label}</dt>
            <dd className="mono">{value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </SettingsSection>
  );

  const modesAndBudget = (
    <>
      <SettingsSection
        title="Mode defaults"
        description="Ask, Plan, and Agent defaults for this profile’s workspace settings."
      >
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
                props.patch({
                  ui: {
                    ...props.draft.ui,
                    modeDefaults: {
                      ...props.draft.ui.modeDefaults,
                      [modeTab]: { ...modeDefault, approvalMode },
                    },
                  },
                  safety: {
                    ...props.draft.safety,
                    approvalMode:
                      modeTab === 'agent'
                        ? approvalMode
                        : props.draft.safety.approvalMode,
                  },
                });
              }}
            >
              <option value="safe">Ask for approval</option>
              <option value="guided">Approve for me</option>
              <option value="pilot">Full access</option>
              <option value="auto">Auto</option>
            </select>
          </Field>
          <Field id="thoroughness" label="Thoroughness">
            <select
              id="thoroughness"
              value={
                modeDefault.thoroughness === 'quick'
                  ? 'low'
                  : modeDefault.thoroughness === 'thorough'
                    ? 'high'
                    : modeDefault.thoroughness === 'low' ||
                        modeDefault.thoroughness === 'medium' ||
                        modeDefault.thoroughness === 'high'
                      ? modeDefault.thoroughness
                      : 'medium'
              }
              onChange={(e) =>
                props.patch({
                  ui: {
                    ...props.draft.ui,
                    modeDefaults: {
                      ...props.draft.ui.modeDefaults,
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
          <Field
            id="modeModel"
            label="Default model"
            full
            hint="Empty keeps the active chat model. Changing Ask/Plan/Agent in the composer switches to this model when set."
          >
            <select
              id="modeModel"
              value={modeDefault.model ?? ''}
              onChange={(e) =>
                props.patch({
                  ui: {
                    ...props.draft.ui,
                    modeDefaults: {
                      ...props.draft.ui.modeDefaults,
                      [modeTab]: {
                        ...modeDefault,
                        model: e.target.value,
                      },
                    },
                  },
                })
              }
            >
              <option value="">Use active model</option>
              {Array.from(
                new Set(
                  [
                    props.draft.provider.model,
                    modeDefault.model,
                    ...models,
                  ]
                    .map((id) => id?.trim())
                    .filter((id): id is string => Boolean(id)),
                ),
              ).map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
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
            checked={props.draft.runBudget.unlimited}
            onChange={(e) =>
              props.patch({
                runBudget: {
                  ...props.draft.runBudget,
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
              disabled={props.draft.runBudget.unlimited}
              value={props.draft.runBudget.maxModelCalls}
              onChange={(e) =>
                props.patch({
                  runBudget: {
                    ...props.draft.runBudget,
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
              disabled={props.draft.runBudget.unlimited}
              value={props.draft.runBudget.maxToolCalls}
              onChange={(e) =>
                props.patch({
                  runBudget: {
                    ...props.draft.runBudget,
                    maxToolCalls: Number(e.target.value) || 1,
                  },
                })
              }
            />
          </Field>
        </div>
      </SettingsSection>
    </>
  );

  if (view === 'gallery') {
    const allSelected =
      profiles.length > 0 && selectedIds.size === profiles.length;
    const canDeleteSelected =
      selectedIds.size > 0 && selectedIds.size < profiles.length;

    return (
      <div className="settings-panel profile-settings">
        <div className="profile-gallery-toolbar">
          <label className="checkbox-row profile-gallery-toolbar__select">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={profiles.length === 0 || saving}
              onChange={(e) => selectAllProfiles(e.target.checked)}
            />
            Select all
          </label>
          <button
            type="button"
            className="btn btn-ghost profile-gallery-toolbar__delete"
            disabled={!canDeleteSelected || saving || !props.engineBaseUrl}
            onClick={() => void deleteSelectedProfiles()}
            title={
              selectedIds.size >= profiles.length
                ? 'Keep at least one profile'
                : selectedIds.size === 0
                  ? 'Select profiles to delete'
                  : `Delete ${selectedIds.size} selected`
            }
          >
            {saving
              ? 'Deleting…'
              : selectedIds.size > 0
                ? `Delete selected (${selectedIds.size})`
                : 'Delete selected'}
          </button>
        </div>

        <div className="profile-gallery">
          {profiles.map((profile) => {
            const active = profile.id === activeProfileId;
            const selected = selectedIds.has(profile.id);
            const initial = (profile.name.trim()[0] || '?').toUpperCase();
            return (
              <div
                key={profile.id}
                className={`profile-tile${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}`}
              >
                <label
                  className="profile-tile__check"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={saving}
                    aria-label={`Select ${profile.name}`}
                    onChange={(e) =>
                      toggleSelected(profile.id, e.target.checked)
                    }
                  />
                </label>
                <button
                  type="button"
                  className="profile-tile__body"
                  onClick={() => void startEdit(profile)}
                >
                  <span className="profile-tile__avatar" aria-hidden>
                    {initial}
                  </span>
                  <span className="profile-tile__name">{profile.name}</span>
                  <span className="profile-tile__meta">
                    {profile.provider.preset ||
                      profile.provider.type ||
                      'provider'}
                    {profile.provider.model
                      ? ` · ${profile.provider.model}`
                      : ''}
                  </span>
                  {active ? (
                    <span className="profile-tile__badge">Active</span>
                  ) : (
                    <span className="profile-tile__badge profile-tile__badge--edit">
                      Edit
                    </span>
                  )}
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="profile-tile profile-tile--add"
            onClick={startCreate}
          >
            <span className="profile-tile__avatar" aria-hidden>
              +
            </span>
            <span className="profile-tile__name">New profile</span>
            <span className="profile-tile__meta">
              Provider → name → test → model
            </span>
          </button>
        </div>
        {note ? <p className="field-help">{note}</p> : null}
      </div>
    );
  }

  if (view === 'create') {
    return (
      <div className="settings-panel profile-settings">
        <div className="profile-wizard">
          <div className="profile-wizard__steps" aria-label="Create steps">
            {(
              [
                [1, 'Provider'],
                [2, 'Name'],
                [3, 'Connect'],
                [4, 'Model'],
              ] as const
            ).map(([step, label]) => (
              <span
                key={step}
                className={`profile-wizard__step${createStep === step ? ' is-active' : ''}${createStep > step ? ' is-done' : ''}`}
              >
                <span className="profile-wizard__step-num">{step}</span>
                {label}
              </span>
            ))}
          </div>

          {createStep === 1 ? (
            <SettingsSection
              title="Choose a provider"
              description="Pick where this profile sends requests."
            >
              {providerFields}
            </SettingsSection>
          ) : null}

          {createStep === 2 ? (
            <SettingsSection
              title="Name this profile"
              description="You’ll switch profiles from the top bar."
            >
              <Field id="newProfileName" label="Profile name" full>
                <input
                  id="newProfileName"
                  autoFocus
                  placeholder="e.g. Work · Ollama"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                />
              </Field>
            </SettingsSection>
          ) : null}

          {createStep === 3 ? (
            <SettingsSection
              title="Connect"
              description="Add credentials if needed, then test before choosing a model."
            >
              {credentialsFields}
              <div className="settings-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={testing || !props.engineBaseUrl || props.busy}
                  onClick={() => void runTest()}
                >
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={testing}
                  onClick={() => {
                    setConnectionOk(true);
                    setTestNote('Skipped — you can still pick a model next.');
                    setCreateStep(4);
                  }}
                >
                  Skip for now
                </button>
                {testNote ? (
                  <p
                    className={`field-help${connectionOk ? '' : ' danger-text'}`}
                  >
                    {testNote}
                  </p>
                ) : null}
              </div>
            </SettingsSection>
          ) : null}

          {createStep === 4 ? (
            <>
              <SettingsSection
                title="Model"
                description="Pick a model from discovery or type one manually."
              >
                {modelFields}
              </SettingsSection>
              {tokenLimitsSection}
              {modesAndBudget}
            </>
          ) : null}

          <div className="profile-editor__footer">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={saving}
              onClick={() => {
                if (createStep === 1) backToGallery();
                else setCreateStep((s) => (s - 1) as CreateStep);
              }}
            >
              {createStep === 1 ? 'Cancel' : 'Back'}
            </button>
            <div className="profile-editor__footer-right">
              {createStep < 4 ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    (createStep === 2 && !profileName.trim()) ||
                    (createStep === 3 &&
                      !connectionOk &&
                      props.draft.provider.type !== 'echo')
                  }
                  onClick={() => {
                    if (createStep === 3 && props.draft.provider.type === 'echo') {
                      setConnectionOk(true);
                    }
                    setCreateStep((s) => (s + 1) as CreateStep);
                  }}
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving || props.busy || !profileName.trim()}
                  onClick={() => void saveProfile()}
                >
                  {saving ? 'Saving…' : 'Create profile'}
                </button>
              )}
            </div>
          </div>
          {createStep === 3 &&
          !connectionOk &&
          props.draft.provider.type !== 'echo' ? (
            <p className="field-help">
              Test connection successfully to continue — or use Echo for a local
              stub.
            </p>
          ) : null}
          {note ? <p className="field-help">{note}</p> : null}
        </div>
      </div>
    );
  }

  // edit
  return (
    <div className="settings-panel profile-settings">
      <div className="profile-editor">
        <div className="profile-editor__toolbar">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={backToGallery}
          >
            ← All profiles
          </button>
          <span className="profile-editor__title">
            Edit · {profileName || 'Profile'}
          </span>
        </div>

        <SettingsSection title="Name">
          <Field id="editProfileName" label="Profile name" full>
            <input
              id="editProfileName"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
            />
          </Field>
        </SettingsSection>

        <SettingsSection
          title="Provider"
          description="Connection details for this profile."
        >
          {providerFields}
        </SettingsSection>

        <SettingsSection title="Credentials">
          {credentialsFields}
          <div className="settings-actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={testing || !props.engineBaseUrl || props.busy}
              onClick={() => void runTest()}
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            {testNote ? <p className="field-help">{testNote}</p> : null}
          </div>
        </SettingsSection>

        <SettingsSection title="Model">{modelFields}</SettingsSection>
        {tokenLimitsSection}
        {modesAndBudget}

        <div className="profile-editor__footer">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={saving || profiles.length <= 1}
            onClick={() => void deleteProfile()}
          >
            Delete
          </button>
          <div className="profile-editor__footer-right">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={saving}
              onClick={backToGallery}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || props.busy || !profileName.trim()}
              onClick={() => void saveProfile()}
            >
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </div>
        {note ? <p className="field-help">{note}</p> : null}
      </div>
    </div>
  );
}
