import { type SettingsPanelProps } from './types';
import { type SettingsPanelView } from './useSettingsPanelState';

export function SettingsFooter({ props, view }: { props: SettingsPanelProps; view: SettingsPanelView }) {
  const {
    activeProfileId,
    onActiveProfileChange,
    onSaveAll,
    profiles,
    saving,
  } = props;

  const {
    activeProfile,
    setNewProfileName,
    setNewProfileOpen,
  } = view;

  return (
    <div className="settings-footer">
      <div className="settings-footer__profiles">
        <select
          aria-label="Switch profile"
          value={activeProfile?.id ?? activeProfileId}
          onChange={(e) => onActiveProfileChange(e.target.value)}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setNewProfileName('');
            setNewProfileOpen(true);
          }}
        >
          New
        </button>
      </div>
      <button
        type="button"
        className="btn settings-save-btn"
        onClick={onSaveAll}
        disabled={saving}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
