import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type * as vscode from 'vscode';

/** Side-by-side preview for a proposed write (current file ↔ proposed). */
export async function showWriteDiffPreview(
  vs: typeof vscode,
  workspace: string,
  relPath: string,
  newContent: string,
): Promise<void> {
  const originalPath = join(workspace, relPath);
  const previewDir = join(workspace, '.mitii', 'diff-preview');
  mkdirSync(previewDir, { recursive: true });
  const previewPath = join(previewDir, relPath.replace(/\//g, '__'));
  mkdirSync(dirname(previewPath), { recursive: true });
  writeFileSync(previewPath, newContent, 'utf-8');

  const title = existsSync(originalPath)
    ? `${relPath} (current ↔ proposed)`
    : `${relPath} (new file)`;

  await vs.commands.executeCommand(
    'vscode.diff',
    vs.Uri.file(originalPath),
    vs.Uri.file(previewPath),
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
  const previewDir = join(workspace, '.mitii', 'diff-preview');
  mkdirSync(previewDir, { recursive: true });
  const oldPath = join(previewDir, `old__${relPath.replace(/\//g, '__')}`);
  const newPath = join(previewDir, `new__${relPath.replace(/\//g, '__')}`);
  mkdirSync(dirname(oldPath), { recursive: true });
  writeFileSync(oldPath, oldText, 'utf-8');
  writeFileSync(newPath, newText, 'utf-8');

  await vs.commands.executeCommand(
    'vscode.diff',
    vs.Uri.file(oldPath),
    vs.Uri.file(newPath),
    `${relPath} (patch preview)`,
  );
}
