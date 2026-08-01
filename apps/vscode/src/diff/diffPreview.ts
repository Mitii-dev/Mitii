import { access } from 'node:fs/promises';

import { FileDiffPreviewStore } from '@mitii/host';
import type * as vscode from 'vscode';

/** Side-by-side preview for a proposed write (current file ↔ proposed). */
export async function showWriteDiffPreview(
  vs: typeof vscode,
  workspace: string,
  relPath: string,
  newContent: string,
): Promise<void> {
  const store = new FileDiffPreviewStore(workspace);
  const preview = await store.writeProposedFile(relPath, newContent);

  const title = await exists(preview.originalPath)
    ? `${preview.relPath} (current ↔ proposed)`
    : `${preview.relPath} (new file)`;

  await vs.commands.executeCommand(
    'vscode.diff',
    vs.Uri.file(preview.originalPath),
    vs.Uri.file(preview.previewPath),
    title,
  );
}

/** Side-by-side preview for an explicit old/new patch pair. */
export async function showPatchDiffPreview(
  vs: typeof vscode,
  workspace: string,
  relPath: string,
  oldText: string,
  newText: string,
): Promise<void> {
  const store = new FileDiffPreviewStore(workspace);
  const preview = await store.writePatchPair(relPath, oldText, newText);

  await vs.commands.executeCommand(
    'vscode.diff',
    vs.Uri.file(preview.oldPath),
    vs.Uri.file(preview.newPath),
    `${preview.relPath} (patch preview)`,
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
