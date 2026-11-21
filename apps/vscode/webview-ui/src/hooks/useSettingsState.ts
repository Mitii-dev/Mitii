import { useEffect, useMemo, useRef, useState } from 'react';
import { mergeModelOptions } from '../app/modelOptions';
import { DEFAULT_UI, DEFAULT_AUTOCOMPLETE, DEFAULT_SEARCH } from '../app/uiDefaults';
import { type AutocompleteSettingsSnapshot, type McpRuntimeStatus, type McpServerConfig, type McpSettings, type ProviderSettingsSnapshot, type SearchSettingsSnapshot, type SettingsProfileView, type UiSettingsSnapshot, type WorkspaceNoticeView, type WorkspaceSnapshotInfo } from '../protocol';
import { modelsForProvider } from '../providerOptions';
import { type ModelCostRates } from '@mitii/ui-core';

export function useSettingsState() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshotInfo>({});
  const [provider, setProvider] = useState<ProviderSettingsSnapshot>({
    type: 'echo',
    baseUrl: '',
    model: '',
    hasApiKey: false,
    availableModels: [],
    contextWindow: 0,
    effectiveContextWindow: 32768,
    maximumOutputTokens: 0,
  });
  const [autocomplete, setAutocomplete] =
    useState<AutocompleteSettingsSnapshot>(DEFAULT_AUTOCOMPLETE);
  const [search, setSearch] = useState<SearchSettingsSnapshot>(DEFAULT_SEARCH);
  const [profiles, setProfiles] = useState<SettingsProfileView[]>([]);
  const [activeProfileId, setActiveProfileId] = useState('default');
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [costRates, setCostRates] = useState<ModelCostRates | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null,
  );

  const [customModel, setCustomModel] = useState(false);

  const [mcp, setMcp] = useState<McpSettings>({ enabled: false, servers: [] });
  const [mcpStore, setMcpStore] = useState<McpServerConfig[]>([]);
  const [mcpRuntimeStatus, setMcpRuntimeStatus] =
    useState<McpRuntimeStatus>('disabled');
  const [ui, setUi] = useState<UiSettingsSnapshot>(DEFAULT_UI);

  const [overrideDraft, setOverrideDraft] = useState('');
  const [notice, setNotice] = useState<WorkspaceNoticeView | null>(null);

  const uiRef = useRef<UiSettingsSnapshot>(ui);
  const providerRef = useRef<ProviderSettingsSnapshot>(provider);
  const autocompleteRef =
    useRef<AutocompleteSettingsSnapshot>(autocomplete);
  const searchRef = useRef<SearchSettingsSnapshot>(search);

  const savedProviderModelRef = useRef(provider.model);
  const listModelsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const providerDraftDirtyRef = useRef(false);
  const settingsSavingRef = useRef(false);

  const updateProvider = (
    next:
      | ProviderSettingsSnapshot
      | ((prev: ProviderSettingsSnapshot) => ProviderSettingsSnapshot),
  ) => {
    const resolved =
      typeof next === 'function' ? next(providerRef.current) : next;
    providerRef.current = resolved;
    setProvider(resolved);
  };

  const updateAutocomplete = (
    next:
      | AutocompleteSettingsSnapshot
      | ((
          prev: AutocompleteSettingsSnapshot,
        ) => AutocompleteSettingsSnapshot),
  ) => {
    const resolved =
      typeof next === 'function' ? next(autocompleteRef.current) : next;
    autocompleteRef.current = resolved;
    setAutocomplete(resolved);
  };

  const updateSearch = (
    next:
      | SearchSettingsSnapshot
      | ((prev: SearchSettingsSnapshot) => SearchSettingsSnapshot),
  ) => {
    const resolved =
      typeof next === 'function' ? next(searchRef.current) : next;
    searchRef.current = resolved;
    setSearch(resolved);
  };

  useEffect(() => {
    if (!settingsSaving) return;
    // Last-resort unlock if the host never acks (should be rare after settings.saved).
    const timer = window.setTimeout(() => {
      if (!settingsSavingRef.current) return;
      settingsSavingRef.current = false;
      setSettingsSaving(false);
    }, 45_000);
    return () => window.clearTimeout(timer);
  }, [settingsSaving]);

  useEffect(() => {
    if (!refreshingModels) return;
    const timer = window.setTimeout(() => {
      setRefreshingModels(false);
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [refreshingModels]);

  useEffect(() => {
    uiRef.current = ui;
  }, [ui]);

  const modelOptions = useMemo(
    () =>
      mergeModelOptions(
        [
          ...modelsForProvider(provider.preset ?? provider.type),
          ...(provider.availableModels ?? []),
        ],
        provider.model,
      ),
    [provider.availableModels, provider.model, provider.preset, provider.type],
  );
  const selectedModelIsCustom =
    customModel || !modelOptions.includes(provider.model);
  const selectedModelLabel = selectedModelIsCustom
    ? provider.model.trim() || 'Custom model'
    : provider.model || 'Select model';

  const activeProfile = useMemo(
    () =>
      profiles.find((profile) => profile.id === activeProfileId) ??
      profiles[0],
    [activeProfileId, profiles],
  );
  const selectedProfileLabel = activeProfile?.name ?? 'Default';

  return {
    workspace,
    setWorkspace,
    provider,
    setProvider,
    autocomplete,
    setAutocomplete,
    search,
    setSearch,
    profiles,
    setProfiles,
    activeProfileId,
    setActiveProfileId,
    settingsSaving,
    setSettingsSaving,
    costRates,
    setCostRates,
    testingConnection,
    setTestingConnection,
    refreshingModels,
    setRefreshingModels,
    connectionMessage,
    setConnectionMessage,
    customModel,
    setCustomModel,
    mcp,
    setMcp,
    mcpStore,
    setMcpStore,
    mcpRuntimeStatus,
    setMcpRuntimeStatus,
    ui,
    setUi,
    overrideDraft,
    setOverrideDraft,
    notice,
    setNotice,
    uiRef,
    providerRef,
    autocompleteRef,
    searchRef,
    savedProviderModelRef,
    listModelsTimerRef,
    providerDraftDirtyRef,
    settingsSavingRef,
    updateProvider,
    updateAutocomplete,
    updateSearch,
    modelOptions,
    selectedModelIsCustom,
    selectedModelLabel,
    activeProfile,
    selectedProfileLabel,
  };
}

export type SettingsStateApi = ReturnType<typeof useSettingsState>;
