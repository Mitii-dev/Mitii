import { ContextTogglesPanel } from '../ContextTogglesPanel';
import { SettingsSection } from './shared';
import { type SettingsPanelProps } from './types';
import { type SettingsPanelView } from './useSettingsPanelState';
import { CheckpointPanel, MemoryPanel } from '@mitii/ui-react';

export function ContextTab({ props, view }: { props: SettingsPanelProps; view: SettingsPanelView }) {
  const {
    checkpoints,
    memories,
    onAddMemory,
    onClearCheckpoints,
    onClearMemory,
    onDeleteCheckpoint,
    onDeleteMemory,
    onRestoreCheckpoint,
    onReviewCheckpointChanges,
    onToggleContext,
    ui,
  } = props;

  return (
    <div className="settings-panel">
      <SettingsSection
        title="Sources"
        description="Choose what evidence is attached to each turn."
      >
        <ContextTogglesPanel
          toggles={ui.contextToggles}
          onToggle={onToggleContext}
        />
      </SettingsSection>
      <MemoryPanel
        memories={memories}
        onAdd={onAddMemory}
        onDelete={onDeleteMemory}
        onClear={onClearMemory}
      />
      <CheckpointPanel
        checkpoints={checkpoints}
        onRestore={onRestoreCheckpoint}
        onDelete={onDeleteCheckpoint}
        onClear={onClearCheckpoints}
        onReviewChanges={onReviewCheckpointChanges}
      />
    </div>
  );
}
