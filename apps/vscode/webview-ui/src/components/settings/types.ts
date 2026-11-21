import { type AutocompleteSettingsSnapshot, type CheckpointItemView, type ContextToggles, type IndexStatusSnapshot, type McpRuntimeStatus, type McpServerConfig, type McpSettings, type MemoryItemView, type ProviderSettingsSnapshot, type SearchSettingsSnapshot, type SemanticIndexSource, type SettingsTab, type SettingsProfileView, type UiSettingsPatch, type UiSettingsSnapshot, type WorkspaceSnapshotInfo } from '../../protocol';

export interface SettingsPanelProps {
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  workspace: WorkspaceSnapshotInfo;
  overrideDraft: string;
  onOverrideDraftChange: (value: string) => void;
  onClearOverride: () => void;
  onOpenFolder: () => void;
  profiles: SettingsProfileView[];
  activeProfileId: string;
  onActiveProfileChange: (id: string) => void;
  onCreateProfile: (name: string) => void;
  provider: ProviderSettingsSnapshot;
  onProviderChange: (
    next:
      | ProviderSettingsSnapshot
      | ((prev: ProviderSettingsSnapshot) => ProviderSettingsSnapshot),
  ) => void;
  onProviderTypeChange: (type: string) => void;
  autocomplete: AutocompleteSettingsSnapshot;
  onAutocompleteChange: (
    next:
      | AutocompleteSettingsSnapshot
      | ((
          prev: AutocompleteSettingsSnapshot,
        ) => AutocompleteSettingsSnapshot),
  ) => void;
  search: SearchSettingsSnapshot;
  onSearchChange: (
    next:
      | SearchSettingsSnapshot
      | ((prev: SearchSettingsSnapshot) => SearchSettingsSnapshot),
  ) => void;
  onSetApiKey: () => void;
  onClearApiKey: () => void;
  onSetSearchApiKey: () => void;
  onClearSearchApiKey: () => void;
  onTestConnection: () => void;
  testingConnection: boolean;
  connectionMessage: string | null;
  onRefreshModels: () => void;
  refreshingModels: boolean;
  customModel: boolean;
  onCustomModelChange: (value: boolean) => void;
  modelOptions: string[];
  ui: UiSettingsSnapshot;
  onSaveUi: (patch: UiSettingsPatch) => void;
  mcp: McpSettings;
  mcpStore: McpServerConfig[];
  mcpRuntimeStatus: McpRuntimeStatus;
  onMcpChange: (next: McpSettings) => void;
  index: IndexStatusSnapshot;
  onReindex: () => void;
  onRefreshIndex: () => void;
  onMaximumIndexFilesChange: (value: number) => void;
  onEmbeddingSourceChange: (source: SemanticIndexSource) => void;
  memories: MemoryItemView[];
  onAddMemory: (text: string) => void;
  onDeleteMemory: (id: string) => void;
  onClearMemory: () => void;
  checkpoints: CheckpointItemView[];
  onRestoreCheckpoint: (id: string) => void;
  onDeleteCheckpoint: (id: string) => void;
  onClearCheckpoints: () => void;
  onReviewCheckpointChanges?: (id: string) => void;
  onToggleContext: (source: keyof ContextToggles, enabled: boolean) => void;
  onSaveAll: () => void;
  onResetTokenBudget: () => void;
  onResetLoopPolicy: () => void;
  onResetV8LoopPolicy: () => void;
  saving: boolean;
}
