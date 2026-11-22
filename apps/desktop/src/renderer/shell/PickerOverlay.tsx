/** Workspace / profile identity picker overlay. */

import { IdentityPicker } from './IdentityPicker.js';
import { workspaceLabel, shortPath } from '../api.js';
import type { AppModel } from '../app/useAppModel.js';

export function PickerOverlay({ m }: { m: AppModel }) {
  const {
    picker,
    setPicker,
    profiles,
    activeProfileId,
    onSelectProfile,
    setSettingsTab,
    setView,
    snapshot,
    onSwitchWorkspace,
    onPickWorkspace,
    onForgetWorkspace,
  } = m;

  return picker ? (
    <div
      className="identity-picker-overlay"
      role="dialog"
      aria-modal="true"
      onClick={() => setPicker(null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setPicker(null);
      }}
    >
      <div
        className="identity-picker-shell"
        onClick={(e) => e.stopPropagation()}
      >
        {picker === 'profile' ? (
          <IdentityPicker
            title="Who's coding?"
            subtitle="Profiles own provider, modes, and budget."
            cards={profiles.map((profile) => ({
              id: profile.id,
              title: profile.name,
              subtitle: profile.provider.model || profile.provider.preset,
              active: profile.id === activeProfileId,
            }))}
            onSelect={(id) => void onSelectProfile(id)}
            onAdd={() => {
              setPicker(null);
              setSettingsTab('profiles');
              setView('settings');
            }}
            addLabel="Manage profiles"
            footer={
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPicker(null)}
              >
                Cancel
              </button>
            }
          />
        ) : (
          <IdentityPicker
            title="Choose a workspace"
            subtitle="Only the selected workspace is active. Remove hides it from Mitii — .mitii data stays on disk."
            cards={(snapshot?.recentWorkspaces ?? []).map((path) => ({
              id: path,
              title: workspaceLabel(path),
              subtitle: shortPath(path),
              active: path === snapshot?.workspaceRoot,
            }))}
            onSelect={(id) => void onSwitchWorkspace(id)}
            onAdd={() => void onPickWorkspace()}
            addLabel="New workspace"
            onRemove={(id) => void onForgetWorkspace(id)}
            removeLabel="Remove"
            footer={
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPicker(null)}
              >
                Cancel
              </button>
            }
          />
        )}
      </div>
    </div>
  ) : null;
}
