import type * as vscode from 'vscode';

export interface WorkspaceTrustSnapshot {
  isTrusted: boolean;
  notice: string | null;
}

export function getWorkspaceTrustSnapshot(
  vs: typeof vscode,
): WorkspaceTrustSnapshot {
  const isTrusted = vs.workspace.isTrusted;
  return {
    isTrusted,
    notice: isTrusted
      ? null
      : 'This workspace is not trusted. Indexing and mutating tools are restricted until you trust the folder.',
  };
}

/** Subscribe to trust grant and invoke callback. */
export function onWorkspaceTrustChanged(
  vs: typeof vscode,
  listener: (snapshot: WorkspaceTrustSnapshot) => void,
): vscode.Disposable {
  return vs.workspace.onDidGrantWorkspaceTrust(() => {
    listener(getWorkspaceTrustSnapshot(vs));
  });
}
