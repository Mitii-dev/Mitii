interface WorkspaceBannerProps {
  workspaceOpen: boolean;
  workspacePath: string;
  vscodeWorkspaceFolders: string[];
  usingWorkspaceOverride: boolean;
  indexed: number;
}

export function WorkspaceBanner({
  workspaceOpen,
  workspacePath,
  vscodeWorkspaceFolders,
  usingWorkspaceOverride,
  indexed,
}: WorkspaceBannerProps) {
  if (!workspaceOpen) {
    return (
      <div className="workspace-banner workspace-banner--warn" role="alert">
        <strong>No Thunder workspace configured.</strong> Open a folder via{' '}
        <strong>File → Open Folder</strong>, or set a path in <strong>Settings → Workspace</strong>.
        {vscodeWorkspaceFolders.length === 0 && (
          <span>
            {' '}
            F5 debug: use launch config <em>Run Extension (parent monorepo)</em> to auto-open a
            folder.
          </span>
        )}
      </div>
    );
  }

  if (indexed === 0) {
    return (
      <div className="workspace-banner workspace-banner--info" role="status">
        <strong>Workspace:</strong> <code title={workspacePath}>{shortPath(workspacePath)}</code>
        {usingWorkspaceOverride && <span> (manual override)</span>} — not indexed yet. Settings →
        Index Workspace.
      </div>
    );
  }

  return (
    <div className="workspace-banner workspace-banner--ok" role="status">
      <strong>Workspace:</strong> <code title={workspacePath}>{shortPath(workspacePath)}</code>
      {usingWorkspaceOverride && <span> (override)</span>} · {indexed} files indexed
    </div>
  );
}

function shortPath(path: string): string {
  const parts = path.split(/[/\\]/);
  if (parts.length <= 4) return path;
  return `…/${parts.slice(-3).join('/')}`;
}
