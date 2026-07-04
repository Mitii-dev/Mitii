import { useState, useEffect } from 'react';
import type { IndexingStatusView, VectorIndexStatusView, WorkspaceNoticeView } from '../../../vscode/webview/messages';

interface WorkspaceSettingsSectionProps {
  workspaceOpen: boolean;
  workspacePath: string;
  workspaceOverride: string;
  usingWorkspaceOverride: boolean;
  indexDbPath: string;
  indexing: IndexingStatusView;
  vectorIndex: VectorIndexStatusView;
  workspaceNotice: WorkspaceNoticeView | null;
  onPickFolder: () => void;
  onSetOverride: (path: string) => void;
  onClearOverride: () => void;
  onIndex: () => void;
}

export function WorkspaceSettingsSection({
  workspaceOpen,
  workspacePath,
  workspaceOverride,
  usingWorkspaceOverride,
  indexDbPath,
  indexing,
  vectorIndex,
  workspaceNotice,
  onPickFolder,
  onSetOverride,
  onClearOverride,
  onIndex,
}: WorkspaceSettingsSectionProps) {
  const [overrideInput, setOverrideInput] = useState(workspaceOverride);
  const runTotal = indexing.runTotal ?? 0;
  const processed = Math.min(indexing.processed ?? 0, runTotal);
  const progressPct = runTotal > 0 ? Math.round((processed / runTotal) * 100) : 0;
  const indexLabel = indexing.running
    ? `${processed}/${runTotal} files`
    : `${indexing.indexed}${indexing.total > 0 ? ` / ${indexing.total}` : ''} indexed`;

  useEffect(() => {
    setOverrideInput(workspaceOverride);
  }, [workspaceOverride]);

  return (
    <section className="settings-section workspace-settings">
      {workspaceNotice && (
        <p className={`workspace-notice workspace-notice--${workspaceNotice.kind}`} role="status">
          {workspaceNotice.message}
        </p>
      )}

      <div className="workspace-stats">
        <div className="workspace-stat">
          <span className="workspace-stat__label">Indexed files</span>
          <strong className="workspace-stat__value">{indexLabel}</strong>
          {indexing.failed > 0 && !indexing.running && (
            <span className="workspace-stat__meta">{indexing.failed} failed</span>
          )}
        </div>
        <div className="workspace-stat">
          <span className="workspace-stat__label">Queued</span>
          <strong className="workspace-stat__value">{indexing.queued}</strong>
        </div>
        <div className="workspace-stat">
          <span className="workspace-stat__label">Embedded chunks</span>
          <strong className="workspace-stat__value">{vectorIndex.embeddedChunks.toLocaleString()}</strong>
        </div>
        <div className="workspace-stat">
          <span className="workspace-stat__label">Source</span>
          <strong className="workspace-stat__value">
            {usingWorkspaceOverride ? 'Override' : 'VS Code folder'}
          </strong>
        </div>
      </div>

      <label className="settings-field workspace-path-field">
        <span className="settings-label">Workspace path</span>
        <input
          type="text"
          className="settings-input settings-input--path"
          value={overrideInput}
          onChange={(e) => setOverrideInput(e.target.value)}
          placeholder={workspaceOpen ? workspacePath : '/absolute/path/to/your/project'}
          aria-label="Workspace path"
        />
        {indexDbPath && (
          <span className="settings-hint settings-path" title={indexDbPath}>
            Index DB: {indexDbPath}
          </span>
        )}
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
          Save &amp; apply
        </button>
        {usingWorkspaceOverride && (
          <button type="button" className="btn btn--secondary btn--small" onClick={onClearOverride}>
            Use VS Code folder
          </button>
        )}
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={onIndex}
          disabled={!workspaceOpen || indexing.running}
        >
          {indexing.running ? 'Indexing…' : 'Reindex'}
        </button>
      </div>

      <div
        className={`settings-index-progress${indexing.running ? ' settings-index-progress--active' : ''}`}
        role={indexing.running ? 'progressbar' : 'status'}
        aria-valuemin={0}
        aria-valuemax={runTotal || 100}
        aria-valuenow={indexing.running ? processed : undefined}
        aria-label="Workspace indexing progress"
      >
        <div className="settings-index-progress__track">
          <div
            className="settings-index-progress__bar"
            style={{ width: `${indexing.running && runTotal > 0 ? progressPct : indexing.indexed > 0 ? 100 : 0}%` }}
          />
        </div>
        <div className="settings-index-progress__meta">
          <span>{indexing.running ? `Indexing ${progressPct}%` : workspaceOpen ? 'Ready' : 'No workspace'}</span>
          <span>{indexLabel}</span>
        </div>
      </div>
    </section>
  );
}
