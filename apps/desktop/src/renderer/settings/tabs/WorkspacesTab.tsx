/** Workspaces tab. */

import { getDesktopBridge } from '../../api.js';
import type { SettingsModel } from '../useSettingsPanelModel.js';
import { SettingsSection, Field } from '../fields.js';

export function WorkspacesTab({ m }: { m: SettingsModel }) {
  const {
    tab,
    props,
    draft,
    patch,
    storageBusy,
    setStorageBusy,
    setStorageNote,
    refreshStorage,
    storageNote,
  } = m;

  return tab === 'workspaces' ? (
    <div className="settings-panel">
      <SettingsSection title="Folder">
        <div className="field-grid">
          <Field id="wsPath" label="Active workspace" full>
            <input
              id="wsPath"
              value={props.workspaceRoot}
              readOnly
              className="mono-input"
            />
          </Field>
          {props.onPickWorkspace ? (
            <div className="settings-inline-actions">
              <button
                type="button"
                className="btn btn-primary btn--compact"
                onClick={props.onPickWorkspace}
              >
                Open folder…
              </button>
            </div>
          ) : null}
          <Field
            id="rootOverride"
            label="Root path override"
            full
            hint="Empty = use active workspace root"
          >
            <input
              id="rootOverride"
              value={draft.workspace.rootPathOverride}
              onChange={(e) =>
                patch({
                  workspace: {
                    ...draft.workspace,
                    rootPathOverride: e.target.value,
                  },
                })
              }
            />
          </Field>
        </div>
      </SettingsSection>
  
      <SettingsSection
        title="Delete cache & logs"
        description="Clears rebuildable project data: logs, memory, index, checkpoints, plans, and resets workspace settings to defaults. Chat history, profiles, skills, and rules stay. .mitii is not removed."
      >
        <div className="settings-inline-actions">
            <button
              type="button"
              className="btn btn-danger btn--compact"
              disabled={storageBusy || !props.workspaceRoot}
              onClick={() => {
                const bridge = getDesktopBridge();
                if (!bridge?.clearWorkspaceCache) return;
                const ok = window.confirm(
                  'Delete cache, logs, memory, and index for this workspace?\n\nChat history and profiles are kept. Settings reset to defaults.',
                );
                if (!ok) return;
                setStorageBusy(true);
                setStorageNote(null);
                void bridge
                  .clearWorkspaceCache()
                  .then(async (result) => {
                    if (!result.ok) {
                      setStorageNote(result.reason ?? 'clear_failed');
                      return;
                    }
                    const count = result.removed?.length ?? 0;
                    setStorageNote(
                      count > 0
                        ? `Cleared ${count} cache item${count === 1 ? '' : 's'}.`
                        : 'Nothing cached to clear.',
                    );
                    await refreshStorage();
                    props.onWorkspaceCacheCleared?.();
                  })
                  .finally(() => setStorageBusy(false));
              }}
            >
              Delete cache & logs…
            </button>
            {storageNote && tab === 'workspaces' ? (
              <p className="field-help storage-note">{storageNote}</p>
            ) : null}
        </div>
      </SettingsSection>
    </div>
  ) : null;
}
