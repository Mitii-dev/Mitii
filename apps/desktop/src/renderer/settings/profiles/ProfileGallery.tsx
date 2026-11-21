/** Profile gallery with multi-select delete. */

import type { ProfileSettingsModel } from './useProfileSettingsModel.js';

export function ProfileGallery({ m }: { m: ProfileSettingsModel }) {
  const {
    profiles,
    selectedIds,
    saving,
    selectAllProfiles,
    props,
    deleteSelectedProfiles,
    activeProfileId,
    toggleSelected,
    startEdit,
    startCreate,
    note,
  } = m;

  const allSelected =
    profiles.length > 0 && selectedIds.size === profiles.length;
  const canDeleteSelected =
    selectedIds.size > 0 && selectedIds.size < profiles.length;

  return (
    <div className="settings-panel profile-settings">
      <div className="profile-gallery-toolbar">
        <label className="checkbox-row profile-gallery-toolbar__select">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={profiles.length === 0 || saving}
            onChange={(e) => selectAllProfiles(e.target.checked)}
          />
          Select all
        </label>
        <button
          type="button"
          className="btn btn-ghost profile-gallery-toolbar__delete"
          disabled={!canDeleteSelected || saving || !props.engineBaseUrl}
          onClick={() => void deleteSelectedProfiles()}
          title={
            selectedIds.size >= profiles.length
              ? 'Keep at least one profile'
              : selectedIds.size === 0
                ? 'Select profiles to delete'
                : `Delete ${selectedIds.size} selected`
          }
        >
          {saving
            ? 'Deleting…'
            : selectedIds.size > 0
              ? `Delete selected (${selectedIds.size})`
              : 'Delete selected'}
        </button>
      </div>

      <div className="profile-gallery">
        {profiles.map((profile) => {
          const active = profile.id === activeProfileId;
          const selected = selectedIds.has(profile.id);
          const initial = (profile.name.trim()[0] || '?').toUpperCase();
          return (
            <div
              key={profile.id}
              className={`profile-tile${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}`}
            >
              <label
                className="profile-tile__check"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={saving}
                  aria-label={`Select ${profile.name}`}
                  onChange={(e) =>
                    toggleSelected(profile.id, e.target.checked)
                  }
                />
              </label>
              <button
                type="button"
                className="profile-tile__body"
                onClick={() => void startEdit(profile)}
              >
                <span className="profile-tile__avatar" aria-hidden>
                  {initial}
                </span>
                <span className="profile-tile__name">{profile.name}</span>
                <span className="profile-tile__meta">
                  {profile.provider.preset ||
                    profile.provider.type ||
                    'provider'}
                  {profile.provider.model
                    ? ` · ${profile.provider.model}`
                    : ''}
                </span>
                {active ? (
                  <span className="profile-tile__badge">Active</span>
                ) : (
                  <span className="profile-tile__badge profile-tile__badge--edit">
                    Edit
                  </span>
                )}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="profile-tile profile-tile--add"
          onClick={startCreate}
        >
          <span className="profile-tile__avatar" aria-hidden>
            +
          </span>
          <span className="profile-tile__name">New profile</span>
          <span className="profile-tile__meta">
            Provider → name → test → model
          </span>
        </button>
      </div>
      {note ? <p className="field-help">{note}</p> : null}
    </div>
  );
}
