/** State, derived token budget and actions for profile settings. */

import { useState, useMemo, useEffect } from 'react';
import {
  PROVIDER_PRESET_OPTIONS,
  type DesktopSettings,
  normalizeDesktopProviderModel,
} from '../../../shared/settings.js';
import {
  resolvePreviewContextWindow,
  normalizeMaximumOutputTokens,
  isAutoMaximumOutputTokens,
  deriveLiveTokenBudgetPreview,
} from '@mitii/ui-core';
import {
  fetchProfiles,
  fetchProviderModels,
  postProfiles,
  testConnection,
  getDesktopBridge,
} from '../../api.js';
import { DEFAULT_DESKTOP_SETTINGS } from '../../../shared/settings.js';
import { type ViewMode, type CreateStep, type ModeId, type ProfileSettingsProps } from './types.js';
import { type ProfileRow } from '../profileTypes.js';

export function useProfileSettingsModel(props: ProfileSettingsProps) {
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

  return {
    props,
    view,
    onPreset,
    presetMeta,
    setConnectionOk,
    apiKey,
    clearApiKey,
    setApiKey,
    setClearApiKey,
    models,
    displayMaxOutput,
    previewContextWindow,
    autoMaxOutput,
    livePreview,
    storedMaxOutput,
    modeTab,
    setModeTab,
    modeDefault,
    profiles,
    selectedIds,
    saving,
    selectAllProfiles,
    deleteSelectedProfiles,
    activeProfileId,
    toggleSelected,
    startEdit,
    startCreate,
    note,
    createStep,
    profileName,
    setProfileName,
    testing,
    runTest,
    setTestNote,
    setCreateStep,
    testNote,
    connectionOk,
    backToGallery,
    saveProfile,
    deleteProfile,
  };
}

export type ProfileSettingsModel = ReturnType<typeof useProfileSettingsModel>;
