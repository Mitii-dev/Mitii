import { useState, useEffect } from 'react';

interface WorkspaceSettingsSectionProps {
  workspaceOpen: boolean;
  workspacePath: string;
  vscodeWorkspaceFolders: string[];
  workspaceOverride: string;
  usingWorkspaceOverride: boolean;
  indexDbPath: string;
  indexed: number;
  onPickFolder: () => void;
  onSetOverride: (path: string) => void;
  onClearOverride: () => void;
  onIndex: () => void;
}

export function WorkspaceSettingsSection({
  workspaceOpen,
  workspacePath,
  vscodeWorkspaceFolders,
  workspaceOverride,
  usingWorkspaceOverride,
  indexDbPath,
  indexed,
  onPickFolder,
  onSetOverride,
  onClearOverride,
  onIndex,
}: WorkspaceSettingsSectionProps) {
  const [overrideInput, setOverrideInput] = useState(workspaceOverride);

  useEffect(() => {
    setOverrideInput(workspaceOverride);
  }, [workspaceOverride]);

  return (
    <section className="settings-section">
      <h3>Workspace</h3>

      <p className="settings-row">
        Effective path:{' '}
        <strong>{workspaceOpen ? workspacePath : 'Not set'}</strong>
      </p>
      <p className="settings-row">
        Source:{' '}
        <strong>{usingWorkspaceOverride ? 'Manual override' : 'VS Code open folder'}</strong>
      </p>
      <p className="settings-row">
        Indexed files: <strong>{indexed}</strong>
      </p>
      {indexDbPath && (
        <p className="settings-hint settings-path" title={indexDbPath}>
          Index DB: {indexDbPath}
        </p>
      )}

      <div className="settings-divider" />

      <p className="settings-label">VS Code open folders</p>
      {vscodeWorkspaceFolders.length === 0 ? (
        <p className="settings-placeholder">
          No folder open in this VS Code window. When debugging with F5, pick a launch config that
          opens a folder (see Run Extension configs).
        </p>
      ) : (
        <ul className="settings-folder-list">
          {vscodeWorkspaceFolders.map((folder) => (
            <li key={folder} className="settings-path" title={folder}>
              {folder}
            </li>
          ))}
        </ul>
      )}

      <label className="settings-field">
        <span className="settings-label">Workspace path override</span>
        <input
          type="text"
          className="settings-input"
          value={overrideInput}
          onChange={(e) => setOverrideInput(e.target.value)}
          placeholder="/absolute/path/to/your/project"
          aria-label="Workspace path override"
        />
        <span className="settings-hint">
          Leave empty to use the VS Code open folder. Set an absolute path to index a different
          project (enterprise-style pinned workspace).
        </span>
      </label>

      <div className="settings-button-row">
        <button type="button" className="btn btn--secondary btn--small" onClick={onPickFolder}>
          Browse…
        </button>
        <button
          type="button"
          className="btn btn--primary btn--small"
          onClick={() => onSetOverride(overrideInput)}
          disabled={!overrideInput.trim() && !usingWorkspaceOverride}
        >
          Apply path
        </button>
        {usingWorkspaceOverride && (
          <button type="button" className="btn btn--secondary btn--small" onClick={onClearOverride}>
            Use VS Code folder
          </button>
        )}
      </div>

      <div className="settings-divider" />

      <button type="button" className="btn btn--secondary" onClick={onIndex}>
        Index Workspace
      </button>
    </section>
  );
}
