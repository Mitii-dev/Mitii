import { type SettingsPanelProps } from './types';
import { type SettingsPanelView } from './useSettingsPanelState';

export function NewProfileModal({ props, view }: { props: SettingsPanelProps; view: SettingsPanelView }) {
  const {
    onCreateProfile,
  } = props;

  const {
    newProfileName,
    newProfileOpen,
    setNewProfileName,
    setNewProfileOpen,
  } = view;

  if (!newProfileOpen) return null;

  return (
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onMouseDown={() => setNewProfileOpen(false)}
    >
      <form
        className="settings-modal"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onCreateProfile(newProfileName);
          setNewProfileOpen(false);
        }}
      >
        <h3>New profile</h3>
        <div className="field">
          <label htmlFor="newProfileName">Profile name</label>
          <input
            id="newProfileName"
            autoFocus
            value={newProfileName}
            placeholder="Local Ollama"
            onChange={(e) => setNewProfileName(e.target.value)}
          />
        </div>
        <div className="row settings-modal__actions">
          <button
            type="button"
            className="btn ghost"
            onClick={() => setNewProfileOpen(false)}
          >
            Cancel
          </button>
          <button type="submit" className="btn">
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
