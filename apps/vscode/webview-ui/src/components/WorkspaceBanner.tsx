import type { WorkspaceNoticeView, WorkspaceSnapshotInfo } from '../protocol';

interface WorkspaceBannerProps {
  notice: WorkspaceNoticeView | null;
  workspace: WorkspaceSnapshotInfo;
}

export function WorkspaceBanner({ notice, workspace }: WorkspaceBannerProps) {
  if (notice && !notice.isTrusted) {
    return (
      <div className="workspace-banner workspace-banner--warn" role="alert">
        <strong>Restricted mode.</strong>{' '}
        {notice.notice ??
          'This workspace is not trusted — Mitii runs read-only tools only.'}
      </div>
    );
  }

  if (notice?.notice) {
    return (
      <div className="workspace-banner workspace-banner--info" role="status">
        {notice.notice}
      </div>
    );
  }

  if (!workspace.displayRoot && !workspace.root) {
    return (
      <div className="workspace-banner workspace-banner--warn" role="alert">
        <strong>No workspace.</strong> Open a folder or set a path in Settings.
      </div>
    );
  }

  return null;
}
