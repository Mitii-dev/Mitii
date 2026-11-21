import { type AppApi } from '../app/appApi';
import { postToHost } from '../bridge';
import { SettingsErrorBoundary } from '../components/SettingsErrorBoundary';
import { SettingsPanel } from '../components/SettingsPanel';
import { type SemanticIndexSource } from '../protocol';

export function SettingsView({ api }: { api: AppApi }) {
  const {
    activeProfileId,
    autocomplete,
    checkpoints,
    connectionMessage,
    createProfile,
    customModel,
    embeddingSourceDraftRef,
    handleProviderChange,
    index,
    indexRef,
    maximumIndexFilesDraftRef,
    mcp,
    mcpRuntimeStatus,
    mcpStore,
    memories,
    modelOptions,
    navigate,
    onProviderTypeChange,
    overrideDraft,
    profiles,
    provider,
    refreshModels,
    refreshingModels,
    saveAllSettings,
    search,
    setCustomModel,
    setIndex,
    setMcp,
    setOverrideDraft,
    setSettingsTab,
    settingsSaving,
    settingsTab,
    switchProfile,
    testConnection,
    testingConnection,
    ui,
    updateAutocomplete,
    updateSearch,
    updateUiDraft,
    workspace,
  } = api;

  return (
    <SettingsErrorBoundary
      onReset={() => {
        setSettingsTab('model');
        navigate('settings', 'model');
      }}
    >
    <SettingsPanel
      tab={settingsTab}
      onTabChange={(tab) => {
        setSettingsTab(tab);
        navigate('settings', tab);
      }}
      workspace={workspace}
      overrideDraft={overrideDraft}
      onOverrideDraftChange={setOverrideDraft}
      onClearOverride={() => {
        setOverrideDraft('');
      }}
      onOpenFolder={() => postToHost({ type: 'openFolder' })}
      profiles={profiles}
      activeProfileId={activeProfileId}
      onActiveProfileChange={switchProfile}
      onCreateProfile={createProfile}
      provider={provider}
      onProviderChange={handleProviderChange}
      onProviderTypeChange={onProviderTypeChange}
      autocomplete={autocomplete}
      onAutocompleteChange={updateAutocomplete}
      search={search}
      onSearchChange={updateSearch}
      onSetApiKey={() => postToHost({ type: 'settings.setApiKey' })}
      onClearApiKey={() => postToHost({ type: 'settings.clearApiKey' })}
      onSetSearchApiKey={() =>
        postToHost({ type: 'settings.setSearchApiKey' })
      }
      onClearSearchApiKey={() =>
        postToHost({ type: 'settings.clearSearchApiKey' })
      }
      onTestConnection={testConnection}
      testingConnection={testingConnection}
      connectionMessage={connectionMessage}
      onRefreshModels={refreshModels}
      refreshingModels={refreshingModels}
      customModel={customModel}
      onCustomModelChange={setCustomModel}
      modelOptions={modelOptions}
      ui={ui}
      onSaveUi={updateUiDraft}
      mcp={mcp}
      mcpStore={mcpStore}
      mcpRuntimeStatus={mcpRuntimeStatus}
      onMcpChange={setMcp}
      index={index}
      onReindex={() => postToHost({ type: 'index.reindex' })}
      onRefreshIndex={() => postToHost({ type: 'index.refresh' })}
      onMaximumIndexFilesChange={(value) => {
        const maximumIndexFiles = Math.max(
          0,
          Math.min(240000, Math.floor(value)),
        );
        maximumIndexFilesDraftRef.current = maximumIndexFiles;
        indexRef.current = {
          ...indexRef.current,
          maximumIndexFiles,
        };
        setIndex((current) => ({
          ...current,
          maximumIndexFiles,
        }));
      }}
      onEmbeddingSourceChange={(source: SemanticIndexSource) => {
        embeddingSourceDraftRef.current = source;
        indexRef.current = {
          ...indexRef.current,
          embeddingSource: source,
          embeddingEnabled: source !== 'disabled',
        };
        setIndex((current) => ({
          ...current,
          embeddingSource: source,
          embeddingEnabled: source !== 'disabled',
        }));
      }}
      memories={memories}
      onAddMemory={(text) => postToHost({ type: 'addMemory', text })}
      onDeleteMemory={(id) => postToHost({ type: 'deleteMemory', id })}
      onClearMemory={() => postToHost({ type: 'clearMemory' })}
      checkpoints={checkpoints}
      onRestoreCheckpoint={(id) =>
        postToHost({ type: 'restoreCheckpoint', id })
      }
      onDeleteCheckpoint={(id) =>
        postToHost({ type: 'deleteCheckpoint', id })
      }
      onClearCheckpoints={() =>
        postToHost({ type: 'clearCheckpoints' })
      }
      onReviewCheckpointChanges={(id) =>
        postToHost({ type: 'reviewCheckpointChanges', id })
      }
      onToggleContext={(source, enabled) => {
        updateUiDraft({ contextToggles: { [source]: enabled } });
      }}
      onSaveAll={saveAllSettings}
      onResetTokenBudget={() =>
        postToHost({ type: 'settings.resetTokenBudget' })
      }
      onResetLoopPolicy={() =>
        postToHost({ type: 'settings.resetLoopPolicy' })
      }
      onResetV8LoopPolicy={() =>
        postToHost({ type: 'settings.resetV8LoopPolicy' })
      }
      saving={settingsSaving}
    />
    </SettingsErrorBoundary>
  );
}
