/** Settings save, onboarding, model and profile selection. */

import {
  type DesktopSettings,
  settingsRequireEngineRestart,
  mergeDesktopSettings,
  normalizeDesktopProviderModel,
  type DesktopProviderPreset,
  PROVIDER_PRESET_OPTIONS,
} from '../../../shared/settings.js';
import { getDesktopBridge, fetchProviderModels, postProfiles, fetchProfiles } from '../../api.js';
import { useCallback } from 'react';
import type { useEngineSnapshot } from '../../shell/hooks/useEngineSnapshot.js';
import type { useChatThreadState } from '../../chat/hooks/useChatThreadState.js';
import type { useEngineLifecycle } from '../../shell/hooks/useEngineLifecycle.js';
import type { useProviderState } from './useProviderState.js';
import type { useShellUiState } from '../../shell/hooks/useShellUiState.js';
import { type ProfileRow } from '../profileTypes.js';

export function useSettingsActions(deps: Pick<
    ReturnType<typeof useEngineSnapshot>,
    'settings' | 'setSettingsBusy' | 'setError' | 'setSnapshot' | 'snapshot' | 'engine'
  > &
  Pick<
    ReturnType<typeof useChatThreadState>,
    'runActiveRef' | 'setBusy'
  > &
  Pick<
    ReturnType<typeof useEngineLifecycle>,
    'refresh' | 'waitForEngineHealth' | 'engineRestartChainRef'
  > &
  Pick<
    ReturnType<typeof useProviderState>,
    'setKnownModels' | 'profiles' | 'activeProfileId' | 'modelsProfileRef'
    | 'setModelsLoading' | 'setProfiles' | 'setActiveProfileId'
  > &
  Pick<
    ReturnType<typeof useShellUiState>,
    'setPicker'
  >) {
  const {
    settings,
    setSettingsBusy,
    setError,
    setSnapshot,
    snapshot,
    engine,
    runActiveRef,
    setBusy,
    refresh,
    waitForEngineHealth,
    engineRestartChainRef,
    setKnownModels,
    profiles,
    activeProfileId,
    modelsProfileRef,
    setModelsLoading,
    setProfiles,
    setActiveProfileId,
    setPicker,
  } = deps;

  const onSaveSettings = async (inputSave: {
    settings: DesktopSettings;
    apiKey?: string;
    clearApiKey?: boolean;
    searchApiKey?: string;
    clearSearchApiKey?: boolean;
  }) => {
    const bridge = getDesktopBridge();
    if (!bridge) throw new Error('bridge_missing');

    const willRestart = settingsRequireEngineRestart(settings, inputSave.settings, {
      apiKeyChanged: Boolean(
        inputSave.clearApiKey || inputSave.apiKey?.trim(),
      ),
      searchApiKeyChanged: Boolean(
        inputSave.clearSearchApiKey || inputSave.searchApiKey?.trim(),
      ),
    });
    if (runActiveRef.current && willRestart) {
      const ok = window.confirm(
        'An agent run is in progress. Saving these settings restarts the engine and will stop the run. Continue?',
      );
      if (!ok) return;
    }

    // Do not clear the run's busy flag if a stream is still in flight.
    setSettingsBusy(true);
    try {
      const result = await bridge.saveSettings(inputSave);
      if (!result.ok) throw new Error(result.reason ?? 'save_failed');
      if (result.restarted && runActiveRef.current) {
        runActiveRef.current = false;
        setBusy(false);
        setError(
          'Settings saved — engine restarted, so the previous agent run was interrupted.',
        );
      }
      await refresh();
      if (result.restarted) {
        // Serialize behind chat prompts so the next message does not hit a
        // dead port while the new engine is binding.
        const wait = (async () => {
          const next = await bridge.getSnapshot();
          setSnapshot(next);
          await waitForEngineHealth(next, 20_000);
        })();
        engineRestartChainRef.current = engineRestartChainRef.current
          .then(() => wait)
          .then(
            () => undefined,
            () => undefined,
          );
        await wait;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(`Settings save failed: ${message}`);
    } finally {
      setSettingsBusy(false);
    }
  };

  const completeOnboarding = async () => {
    const next = mergeDesktopSettings({
      ...settings,
      onboarding: { ...settings.onboarding, completed: true },
    });
    await onSaveSettings({ settings: next });
  };

  const onSelectModel = async (model: string) => {
    if (!snapshot || !model.trim()) return;
    const normalized = normalizeDesktopProviderModel(
      model,
      settings.provider.baseUrl,
    );
    const next = mergeDesktopSettings({
      ...settings,
      provider: { ...settings.provider, model: normalized },
    });
    await onSaveSettings({ settings: next });
    setKnownModels((prev) => {
      if (prev.includes(normalized)) return prev;
      return [normalized, ...prev];
    });
  };

  const refreshModelsForActiveProfile = useCallback(
    async (profile?: ProfileRow | null, engineOpts?: typeof engine) => {
      const target =
        profile ??
        profiles.find((p) => p.id === activeProfileId) ??
        profiles[0] ??
        null;
      const opts = engineOpts ?? engine;
      if (!target || !opts) return;
      const requestId = target.id;
      modelsProfileRef.current = requestId;
      setModelsLoading(true);
      // Clear other profiles' models immediately — no mix-match.
      setKnownModels(
        target.provider.model?.trim() ? [target.provider.model.trim()] : [],
      );
      try {
        const listed = await fetchProviderModels({
          ...opts,
          type: target.provider.type || 'openai-compatible',
          providerBaseUrl: target.provider.baseUrl,
        });
        if (modelsProfileRef.current !== requestId) return;
        const selected = normalizeDesktopProviderModel(
          target.provider.model ?? '',
          target.provider.baseUrl,
        );
        const next = Array.from(
          new Set([
            ...(selected ? [selected] : []),
            ...listed
              .map((id) =>
                normalizeDesktopProviderModel(id.trim(), target.provider.baseUrl),
              )
              .filter(Boolean),
          ]),
        );
        setKnownModels(next);
      } catch {
        if (modelsProfileRef.current === requestId) {
          setKnownModels(
            target.provider.model?.trim()
              ? [target.provider.model.trim()]
              : [],
          );
        }
      } finally {
        if (modelsProfileRef.current === requestId) {
          setModelsLoading(false);
        }
      }
    },
    [activeProfileId, engine, profiles],
  );

  const onSelectProfile = async (id: string) => {
    if (!engine) return;
    setPicker(null);
    setBusy(true);
    setModelsLoading(true);
    setKnownModels([]);
    modelsProfileRef.current = id;
    try {
      await postProfiles({
        ...engine,
        body: { action: 'activate', profileId: id },
      });
      const store = await fetchProfiles(engine);
      setProfiles(store.profiles as ProfileRow[]);
      setActiveProfileId(store.activeProfileId);
      const profile =
        store.profiles.find((p) => p.id === store.activeProfileId) ??
        store.profiles.find((p) => p.id === id);
      if (!profile) {
        setKnownModels([]);
        return;
      }

      // Apply this profile's full provider (no leftover from the previous one).
      const baseUrl = profile.provider.baseUrl ?? '';
      const rawPreset = (profile.provider.preset ||
        profile.provider.type ||
        settings.provider.preset) as DesktopSettings['provider']['preset'];
      const preset =
        /ollama\.com/i.test(baseUrl) && rawPreset === 'ollama'
          ? 'ollama-cloud'
          : rawPreset;
      const model = normalizeDesktopProviderModel(
        profile.provider.model ?? '',
        baseUrl,
      );
      const next = mergeDesktopSettings({
        ...settings,
        provider: {
          ...settings.provider,
          type: (profile.provider.type ||
            settings.provider.type) as DesktopSettings['provider']['type'],
          preset,
          baseUrl,
          model,
          contextWindow: profile.provider.contextWindow ?? 0,
          maximumOutputTokens: profile.provider.maximumOutputTokens ?? 0,
        },
      });
      await onSaveSettings({ settings: next });

      // Engine may have restarted — use fresh credentials for model list.
      const bridge = getDesktopBridge();
      const fresh = bridge ? await bridge.getSnapshot() : null;
      const listEngine = fresh
        ? { baseUrl: fresh.engineBaseUrl, token: fresh.authToken }
        : engine;
      await refreshModelsForActiveProfile(profile as ProfileRow, listEngine);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setModelsLoading(false);
    } finally {
      setBusy(false);
    }
  };

  const onCreateProfileFromPreset = async (presetId: DesktopProviderPreset) => {
    if (!engine) return;
    const preset = PROVIDER_PRESET_OPTIONS.find((p) => p.id === presetId);
    if (!preset) return;
    setBusy(true);
    try {
      const name =
        preset.label.replace(/\s*\(.*\)\s*$/, '').trim() || preset.label;
      await postProfiles({
        ...engine,
        body: {
          action: 'upsert',
          name,
          provider: {
            type: preset.type,
            preset: preset.id,
            baseUrl: preset.baseUrl,
            model: preset.model ?? '',
            contextWindow: 0,
            maximumOutputTokens: 0,
          },
          hasSecret: false,
        },
      });
      const store = await fetchProfiles(engine);
      setProfiles(store.profiles as ProfileRow[]);
      const created =
        store.profiles.find((p) => p.name === name) ??
        store.profiles.find((p) => p.id === store.activeProfileId);
      if (created) {
        await onSelectProfile(created.id);
        return;
      }
      setActiveProfileId(store.activeProfileId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return {
    onSelectModel,
    refreshModelsForActiveProfile,
    onSaveSettings,
    onSelectProfile,
    onCreateProfileFromPreset,
    completeOnboarding,
  };
}
