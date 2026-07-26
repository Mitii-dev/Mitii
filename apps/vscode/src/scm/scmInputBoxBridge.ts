import type * as vscode from 'vscode';

interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: { value: string };
}

interface GitApi {
  repositories: GitRepository[];
}

/** Set the built-in Git extension commit message input box. */
export async function setGitCommitInputBox(
  vs: typeof vscode,
  workspaceRoot: string,
  message: string,
): Promise<boolean> {
  const api = await getGitApi(vs);
  const repo =
    api?.repositories.find(
      (candidate) => candidate.rootUri.fsPath === workspaceRoot,
    ) ?? api?.repositories[0];
  if (!repo) return false;
  repo.inputBox.value = message;
  return true;
}

async function getGitApi(vs: typeof vscode): Promise<GitApi | undefined> {
  const extension = vs.extensions.getExtension('vscode.git');
  if (!extension) return undefined;
  const exports = extension.isActive
    ? extension.exports
    : await extension.activate();
  if (!exports || typeof exports.getAPI !== 'function') return undefined;
  return exports.getAPI(1) as GitApi;
}
