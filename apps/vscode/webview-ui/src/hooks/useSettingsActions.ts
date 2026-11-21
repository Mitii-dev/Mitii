import { hydrateUiSnapshot } from '../app/hydrate';
import { settingsModeFor, modeDefaultsFromUi, mergeUiPatch, clearStaleModeModelDefaultsAfterProviderModelChange } from '../app/modeSettings';
import { approvalModeUiPatch } from '../approvalPresets';
import { postToHost } from '../bridge';
import { normalizeApproval, type ApprovalUiMode } from '../components/ComposerControls';
import { type AgentUiMode, type AgentUiThoroughness, type ProviderSettingsSnapshot, type SettingsProfileView, type UiSettingsPatch } from '../protocol';
import { getProviderPreset } from '../providerOptions';
import { resolveRunIntensity, thoroughnessUiPatch } from '@mitii/ui-core';
import type { ShellNavApi } from './useShellNav';
import type { IntensityApi } from './useIntensity';
import type { IndexStatusApi } from './useIndexStatus';
import type { SettingsStateApi } from './useSettingsState';
import type { RunStreamApi } from './useRunStream';

export function useSettingsActions(deps: ShellNavApi & IntensityApi & IndexStatusApi & SettingsStateApi & RunStreamApi) {
  const {
    activeProfile,
    activeProfileId,
    approvalMode,
    autocompleteRef,
    embeddingSourceDraftRef,
    indexRef,
    listModelsTimerRef,
    mcp,
    mode,
    modeRef,
    overrideDraft,
    profiles,
    provider,
    providerDraftDirtyRef,
    providerRef,
    savedProviderModelRef,
    searchRef,
    setActiveProfileId,
    setApprovalMode,
    setConnectionMessage,
    setCustomModel,
    setDepth,
    setEffort,
    setError,
    setMode,
    setProfiles,
    setRefreshingModels,
    setSettingsSaving,
    setSettingsTab,
    setTestingConnection,
    setThoroughness,
    setTokenUsage,
    setUi,
    settingsSavingRef,
    ui,
    uiRef,
    updateProvider,
  } = deps;

  const testConnection = () => {
    setTestingConnection(true);
    setConnectionMessage('Testing…');
    const current = providerRef.current;
    postToHost({
      type: 'provider.testConnection',
      provider: {
        type: current.type,
        baseUrl: current.baseUrl,
        model: current.model,
      },
    });
  };

  const requestListedModels = (
    type: string,
    baseUrl: string,
    immediate = false,
  ) => {
    if (listModelsTimerRef.current) {
      clearTimeout(listModelsTimerRef.current);
      listModelsTimerRef.current = null;
    }
    const send = () => {
      if (type === 'echo') return;
      setRefreshingModels(true);
      postToHost({
        type: 'provider.listModels',
        provider: { type, baseUrl },
      });
    };
    if (immediate) {
      send();
      return;
    }
    listModelsTimerRef.current = setTimeout(send, 400);
  };

  const refreshModels = () => {
    const current = providerRef.current;
    requestListedModels(current.type, current.baseUrl, true);
  };

  const handleProviderChange = (
    next:
      | ProviderSettingsSnapshot
      | ((prev: ProviderSettingsSnapshot) => ProviderSettingsSnapshot),
  ) => {
    const before = providerRef.current;
    updateProvider(next);
    const after = providerRef.current;
    if (
      after.type !== before.type ||
      after.preset !== before.preset ||
      after.baseUrl !== before.baseUrl ||
      after.model !== before.model ||
      after.contextWindow !== before.contextWindow ||
      after.maximumOutputTokens !== before.maximumOutputTokens
    ) {
      providerDraftDirtyRef.current = true;
    }
    if (after.model.trim() !== before.model.trim()) {
      const nextUi = clearStaleModeModelDefaultsAfterProviderModelChange({
        ui: uiRef.current,
        previousProviderModel: before.model,
        nextProviderModel: after.model,
      });
      if (nextUi !== uiRef.current) {
        uiRef.current = nextUi;
        setUi(nextUi);
      }
    }
    if (after.type !== before.type) {
      requestListedModels(after.type, after.baseUrl, true);
    } else if (after.baseUrl !== before.baseUrl) {
      requestListedModels(after.type, after.baseUrl);
    }
  };

  const onProviderTypeChange = (presetId: string) => {
    const preset = getProviderPreset(presetId);
    const type = preset?.type ?? presetId;
    providerDraftDirtyRef.current = true;
    updateProvider((p) => ({
      ...p,
      type,
      preset: preset?.preset ?? presetId,
      baseUrl: preset?.baseUrl ?? p.baseUrl,
      model: preset?.model ?? p.model,
      availableModels: [],
      connectionOk: undefined,
      connectionStatus: undefined,
    }));
    setConnectionMessage(null);
    setCustomModel(false);
    const current = providerRef.current;
    requestListedModels(current.type, current.baseUrl, true);
  };

  const saveModel = (
    model: string,
    options: { clearStaleModeDefaults?: boolean } = {},
  ) => {
    const previousModel = savedProviderModelRef.current;
    updateProvider((p) => ({ ...p, model }));
    let uiPatch: UiSettingsPatch | undefined;
    if (options.clearStaleModeDefaults !== false) {
      const nextUi = clearStaleModeModelDefaultsAfterProviderModelChange({
        ui: uiRef.current,
        previousProviderModel: previousModel,
        nextProviderModel: model,
      });
      if (nextUi !== uiRef.current) {
        uiRef.current = nextUi;
        setUi(nextUi);
        uiPatch = { modeDefaults: nextUi.modeDefaults };
      }
    }
    postToHost({
      type: 'settings.set',
      provider: { model },
      ui: uiPatch,
    });
  };

  const changeApprovalMode = (next: ApprovalUiMode) => {
    const patch = approvalModeUiPatch({ mode, approvalMode: next });
    updateUiDraft(patch);
    postToHost({
      type: 'settings.set',
      ui: patch,
      approvalMode: patch.approvalMode,
    });
    setApprovalMode(patch.approvalMode);
  };

  const changeMode = (next: AgentUiMode) => {
    const uiMode = next === 'review' ? 'ask' : next;
    setMode(uiMode);
    const defaults = modeDefaultsFromUi(ui, uiMode);
    const intensity = resolveRunIntensity({
      intensityOverrides: ui.intensityOverrides === true,
      thoroughness: defaults.thoroughness,
      depth: defaults.depth,
      effort: ui.effort,
    });
    setThoroughness(intensity.thoroughness);
    setDepth(intensity.depth);
    setEffort(intensity.effort);
    setApprovalMode(normalizeApproval(defaults.approvalMode));
    const nextModel = defaults.model?.trim();
    if (nextModel) saveModel(nextModel, { clearStaleModeDefaults: false });
  };

  const changeThoroughness = (next: AgentUiThoroughness) => {
    const settingsMode = settingsModeFor(mode);
    const patch = thoroughnessUiPatch({
      mode: settingsMode,
      thoroughness: next,
    });
    updateUiDraft(patch);
    postToHost({ type: 'settings.set', ui: patch });
    setThoroughness(next);
    setDepth(patch.modeDefaults[settingsMode]!.depth);
    setEffort(patch.effort);
  };

  const updateUiDraft = (patch: UiSettingsPatch) => {
    const next = mergeUiPatch(uiRef.current, patch);
    uiRef.current = next;
    setUi(next);
    if (patch.depth) setDepth(patch.depth);
    if (patch.effort) setEffort(patch.effort);
    const activeModePatch = patch.modeDefaults?.[settingsModeFor(mode)];
    const activeModeDepth = activeModePatch?.depth;
    if (activeModeDepth) setDepth(activeModeDepth);
    if (activeModePatch?.thoroughness) {
      setThoroughness(activeModePatch.thoroughness);
    }
    if (activeModePatch?.approvalMode) {
      setApprovalMode(normalizeApproval(activeModePatch.approvalMode));
    }
    const activeModeModel = activeModePatch?.model?.trim();
    if (activeModeModel) {
      updateProvider((prev) => ({
        ...prev,
        model: activeModeModel,
      }));
    }
  };

  const snapshotProvider = () => {
    const current = providerRef.current;
    const maximumOutputTokens =
      current.maximumOutputTokens === 5_000 ? 0 : current.maximumOutputTokens;
    return {
      type: current.type,
      preset: current.preset,
      baseUrl: current.baseUrl,
      model: current.model,
      contextWindow: current.contextWindow,
      maximumOutputTokens,
    };
  };

  const applyProfileLocally = (profile: SettingsProfileView) => {
    setActiveProfileId(profile.id);
    savedProviderModelRef.current = profile.provider.model ?? '';
    updateProvider({
      ...profile.provider,
      hasApiKey: profile.hasSecret,
      availableModels: [],
      connectionOk: undefined,
      connectionStatus: undefined,
    });
    setConnectionMessage(null);
    if (profile.provider.type && profile.provider.type !== 'echo') {
      requestListedModels(
        profile.provider.type,
        profile.provider.baseUrl ?? '',
        true,
      );
    }
    if (profile.ui) {
      const nextUi = hydrateUiSnapshot(profile.ui);
      uiRef.current = nextUi;
      setUi(nextUi);
      const defaults = modeDefaultsFromUi(nextUi, modeRef.current);
      const intensity = resolveRunIntensity({
        intensityOverrides: nextUi.intensityOverrides === true,
        thoroughness: defaults.thoroughness,
        depth: defaults.depth,
        effort: nextUi.effort,
      });
      setThoroughness(intensity.thoroughness);
      setDepth(intensity.depth);
      setEffort(intensity.effort);
      setApprovalMode(normalizeApproval(defaults.approvalMode));
    }
  };

  const switchProfile = (id: string) => {
    const profile = profiles.find((entry) => entry.id === id);
    if (!profile || profile.id === activeProfileId) return;
    providerDraftDirtyRef.current = false;
    applyProfileLocally(profile);
    postToHost({ type: 'profile.switch', id: profile.id });
  };

  const createProfile = (name: string) => {
    const id = `profile-${Date.now().toString(36)}`;
    const trimmed = name.trim() || 'New profile';
    const nextProfile: SettingsProfileView = {
      id,
      name: trimmed,
      provider: snapshotProvider(),
      hasSecret: provider.hasApiKey,
      ui: uiRef.current,
    };
    setProfiles((prev) => [...prev, nextProfile]);
    providerDraftDirtyRef.current = false;
    applyProfileLocally(nextProfile);
    settingsSavingRef.current = true;
    setSettingsSaving(true);
    postToHost({
      type: 'settings.set',
      provider: snapshotProvider(),
      autocomplete: autocompleteRef.current,
      search: { searxngBaseUrl: searchRef.current.searxngBaseUrl },
      profile: nextProfile,
    });
  };

  const saveAllSettings = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    const latestProvider = snapshotProvider();
    if (latestProvider.type !== 'echo' && !latestProvider.model.trim()) {
      setError('Choose a model before saving provider settings. Test connection to discover available models.');
      setSettingsTab('model');
      return;
    }
    setError(null);
    const latestUi = clearStaleModeModelDefaultsAfterProviderModelChange({
      ui: mergeUiPatch(
        uiRef.current,
        approvalModeUiPatch({ mode, approvalMode }),
      ),
      previousProviderModel: savedProviderModelRef.current,
      nextProviderModel: latestProvider.model,
    });
    uiRef.current = latestUi;
    setUi(latestUi);
    const profile = activeProfile ?? {
      id: activeProfileId || 'default',
      name: 'Default',
      provider: latestProvider,
      hasSecret: provider.hasApiKey,
    };
    settingsSavingRef.current = true;
    setSettingsSaving(true);
    postToHost({
      type: 'settings.set',
      provider: latestProvider,
      autocomplete: autocompleteRef.current,
      search: { searxngBaseUrl: searchRef.current.searxngBaseUrl },
      ui: latestUi,
      workspaceRootOverride: overrideDraft.trim() || null,
      workspaceMaximumIndexFiles: indexRef.current.maximumIndexFiles ?? 0,
      ...(embeddingSourceDraftRef.current
        ? { semanticIndex: { source: embeddingSourceDraftRef.current } }
        : {}),
      mcp,
      approvalMode,
      profile: {
        ...profile,
        provider: latestProvider,
      },
    });
    setTokenUsage((prev) => ({
      ...prev,
      contextWindow:
        providerRef.current.effectiveContextWindow ||
        providerRef.current.contextWindow ||
        prev.contextWindow,
    }));
  };

  return {
    testConnection,
    requestListedModels,
    refreshModels,
    handleProviderChange,
    onProviderTypeChange,
    saveModel,
    changeApprovalMode,
    changeMode,
    changeThoroughness,
    updateUiDraft,
    snapshotProvider,
    applyProfileLocally,
    switchProfile,
    createProfile,
    saveAllSettings,
  };
}

export type SettingsActionsApi = ReturnType<typeof useSettingsActions>;
