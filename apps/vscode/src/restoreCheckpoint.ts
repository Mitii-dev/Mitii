import type * as vscode from 'vscode';
import type { RestorePointSummary } from '@mitii/sdk';

/**
 * Thin host command: restore workspace files to a RestorePoint.
 * Business logic stays in V8/SDK via createVscodeClient.
 */
export async function restoreCheckpointCommand(
  vs: typeof vscode,
  secrets: vscode.SecretStorage,
): Promise<void> {
  const folder = vs.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vs.window.showErrorMessage('Mitii restore requires an open workspace.');
    return;
  }
  const workspaceRoot = folder.uri.fsPath;

  const runId = await vs.window.showInputBox({
    title: 'Mitii restore',
    prompt: 'Run id',
    placeHolder: 'run_…',
  });
  if (!runId?.trim()) {
    return;
  }

  const { createVscodeClient } = await import('./ports.js');
  const { client } = await createVscodeClient(vs, secrets, workspaceRoot);

  const points: RestorePointSummary[] = await client.listRestorePoints(
    runId.trim(),
  );
  if (points.length === 0) {
    void vs.window.showInformationMessage(
      `No restore points for run ${runId.trim()}.`,
    );
    return;
  }

  type PickItem = vscode.QuickPickItem & { point: RestorePointSummary };
  const items: PickItem[] = points.map((point: RestorePointSummary) => ({
    label: point.restorePointId,
    description: point.createdAt,
    detail: `${point.changedFileCount} file(s) · ${point.mutationCheckpointId}`,
    point,
  }));

  const picked = await vs.window.showQuickPick(items, {
    title: 'Select RestorePoint to undo to',
  });
  if (!picked) {
    return;
  }

  const result = await client.restore({
    schemaVersion: 1,
    runId: runId.trim(),
    restorePointId: picked.point.restorePointId,
    workspaceRoot,
  });

  void vs.window.showInformationMessage(
    `Mitii restored ${result.restoredFiles.length} path(s) (mode=${result.interactionMode}).`,
  );
}
