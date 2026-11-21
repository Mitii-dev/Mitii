import { type AppApi } from '../app/appApi';
import { hydrateAutocompleteSnapshot, hydrateSearchSnapshot, hydrateUiSnapshot } from '../app/hydrate';
import { modeDefaultsFromUi } from '../app/modeSettings';
import { mergeModelOptions } from '../app/modelOptions';
import { toChatTurn } from '../app/turnHelpers';
import { postToHost } from '../bridge';
import { normalizeApproval } from '../components/ComposerControls';
import { type HostToWebviewMessage } from '../protocol';
import { modelsForProvider } from '../providerOptions';
import { resolveRunIntensity } from '@mitii/ui-core';

export function applyBootstrap(msg: HostToWebviewMessage, api: AppApi): void {
  const {
    activeAssistantId,
    applyIndexStatus,
    applyTokenUsage,
    hydratedModeDefaults,
    modeRef,
    providerDraftDirtyRef,
    providerRef,
    savedProviderModelRef,
    setActiveProfileId,
    setActiveThreadId,
    setApprovalMode,
    setCheckpoints,
    setConnectionMessage,
    setCustomModel,
    setDepth,
    setEffort,
    setHistory,
    setMcp,
    setMcpRuntimeStatus,
    setMcpStore,
    setMemories,
    setMode,
    setNotice,
    setOnboardingRequired,
    setOverrideDraft,
    setPendingPlan,
    setPlan,
    setProfiles,
    setSettingsSaving,
    setThoroughness,
    setTurns,
    setUi,
    setWorkspace,
    settingsSavingRef,
    uiRef,
    updateAutocomplete,
    updateProvider,
    updateSearch,
  } = api;

  if (msg.type === 'bootstrap' || msg.type === 'settings') {
    setWorkspace(msg.workspace);
    const draft = providerRef.current;
    const preserveDraft =
      providerDraftDirtyRef.current && !settingsSavingRef.current;
    const nextContextWindow = Number.isFinite(msg.provider.contextWindow)
      ? Math.max(0, Math.floor(msg.provider.contextWindow))
      : 0;
    const nextEffectiveContextWindow = Number.isFinite(
      msg.provider.effectiveContextWindow,
    )
      ? Math.max(1, Math.floor(msg.provider.effectiveContextWindow ?? 0))
      : undefined;
    const nextMaximumOutputTokens = Number.isFinite(
      msg.provider.maximumOutputTokens,
    )
      ? Math.max(0, Math.floor(msg.provider.maximumOutputTokens))
      : 0;
    const normalizedMaximumOutputTokens =
      nextMaximumOutputTokens === 5_000 ? 0 : nextMaximumOutputTokens;
    const nextModel = preserveDraft
      ? draft.model
      : (msg.provider.model ?? '');
    updateProvider({
      type: preserveDraft ? draft.type : msg.provider.type,
      preset: preserveDraft ? draft.preset : msg.provider.preset,
      baseUrl: preserveDraft ? draft.baseUrl : msg.provider.baseUrl,
      model: nextModel,
      hasApiKey: msg.provider.hasApiKey,
      availableModels: mergeModelOptions(
        [
          ...(msg.provider.availableModels ?? []),
          ...(preserveDraft ? (draft.availableModels ?? []) : []),
        ],
        nextModel,
      ),
      contextWindow: preserveDraft ? draft.contextWindow : nextContextWindow,
      effectiveContextWindow: nextEffectiveContextWindow,
      maximumOutputTokens: preserveDraft
        ? draft.maximumOutputTokens === 5_000
          ? 0
          : draft.maximumOutputTokens
        : normalizedMaximumOutputTokens,
      connectionOk: msg.provider.connectionOk,
      connectionStatus: msg.provider.connectionStatus,
    });
    updateAutocomplete(hydrateAutocompleteSnapshot(msg.autocomplete));
    updateSearch(hydrateSearchSnapshot(msg.search));
    if (!preserveDraft) {
      providerDraftDirtyRef.current = false;
      savedProviderModelRef.current = msg.provider.model ?? '';
    }
    setProfiles(msg.profiles ?? []);
    setActiveProfileId(msg.activeProfileId ?? 'default');
    setMcp(msg.mcp);
    setMcpStore(msg.mcpStore ?? []);
    setMcpRuntimeStatus(msg.mcpRuntimeStatus);
    const nextUi = hydrateUiSnapshot(msg.ui);
    const previousUi = uiRef.current;
    uiRef.current = nextUi;
    setUi(nextUi);
    const modeDefaultsChanged =
      JSON.stringify(previousUi.modeDefaults) !==
        JSON.stringify(nextUi.modeDefaults) ||
      previousUi.depth !== nextUi.depth ||
      previousUi.approvalMode !== nextUi.approvalMode;
    if (!hydratedModeDefaults.current || modeDefaultsChanged) {
      hydratedModeDefaults.current = true;
      const currentDefaults = modeDefaultsFromUi(nextUi, modeRef.current);
      const intensity = resolveRunIntensity({
        intensityOverrides: nextUi.intensityOverrides === true,
        thoroughness: currentDefaults.thoroughness,
        depth: currentDefaults.depth,
        effort: nextUi.effort,
      });
      setThoroughness(intensity.thoroughness);
      setDepth(intensity.depth);
      setEffort(intensity.effort);
      setApprovalMode(normalizeApproval(currentDefaults.approvalMode));
    } else {
      setEffort(nextUi.effort ?? 'medium');
    }
    setOverrideDraft(msg.workspace.rootOverride ?? '');
    applyTokenUsage(msg.tokenUsage);
    setNotice(msg.notice);
    setCustomModel((wasCustom) => {
      const catalog = new Set([
        ...(preserveDraft
          ? (draft.availableModels ?? [])
          : (msg.provider.availableModels ?? [])),
        ...(msg.provider.availableModels ?? []),
        ...modelsForProvider(
          (preserveDraft ? draft.preset : msg.provider.preset) ??
            (preserveDraft ? draft.type : msg.provider.type),
        ),
      ]);
      return Boolean(nextModel.trim()) && (wasCustom || !catalog.has(nextModel));
    });
    if (msg.provider.connectionStatus) {
      setConnectionMessage(msg.provider.connectionStatus);
    }
    settingsSavingRef.current = false;
    setSettingsSaving(false);
    if (msg.type === 'bootstrap') {
      applyIndexStatus(msg.index);
      setOnboardingRequired(msg.onboardingRequired);
      setHistory(msg.history);
      setActiveThreadId(msg.activeThreadId);
      if (!activeAssistantId.current) {
        setTurns(
          (msg.activeThreadMessages ?? []).map((m) => toChatTurn(m)),
        );
      }
      const bootstrapPlan = msg.pendingPlan ?? null;
      setPendingPlan(bootstrapPlan);
      if (bootstrapPlan) setPlan(bootstrapPlan);
      setMemories(msg.memories);
      setCheckpoints(msg.checkpoints);
      postToHost({ type: 'refreshReviewDiff' });
      if (modeRef.current === 'review') setMode('ask');
    }
  }
}
