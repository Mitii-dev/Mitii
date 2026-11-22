import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cumulativeChangedPathsSince } from '../../diff/cumulativeCheckpointDiff.js';
import { loadCheckpoints } from '../../chatHistory.js';
import {
  showPatchDiffPreview,
  showWriteDiffPreview,
} from '../../diff/diffPreview.js';
import { undoRunFileChanges } from '../../fileChanges.js';
import type { WebviewToHostMessage } from '../../protocol.js';
import type { SidebarContext } from '../context.js';

export async function openWorkspaceFile(
  ctx: SidebarContext,
  relPath: string,
  line?: number,
  column?: number,
): Promise<void> {
  const root = ctx.effectiveRoot();
  if (!root) {
    ctx.post({ type: 'error', message: 'No workspace folder open.' });
    return;
  }
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const abs = join(root, normalized);
  if (!existsSync(abs)) {
    ctx.post({
      type: 'error',
      message: `File not found: ${normalized}`,
    });
    return;
  }
  const uri = ctx.vs.Uri.file(abs);
  const doc = await ctx.vs.workspace.openTextDocument(uri);
  const editor = await ctx.vs.window.showTextDocument(doc, {
    preview: true,
  });
  if (line && line > 0) {
    const pos = new ctx.vs.Position(
      Math.max(0, line - 1),
      Math.max(0, (column ?? 1) - 1),
    );
    editor.selection = new ctx.vs.Selection(pos, pos);
    editor.revealRange(
      new ctx.vs.Range(pos, pos),
      ctx.vs.TextEditorRevealType.InCenter,
    );
  }
}

export async function handleUndoFileChanges(ctx: SidebarContext, runId: string): Promise<void> {
  const root = ctx.effectiveRoot();
  const snapshot = ctx.session.fileChangeSnapshots.get(runId);
  if (!root || !snapshot) {
    ctx.post({
      type: 'error',
      message: 'Nothing to undo for this run.',
    });
    return;
  }
  const result = undoRunFileChanges({ workspaceRoot: root, snapshot });
  ctx.channel.appendLine(
    `[file-changes] undo run=${runId} restored=${result.restored.length} failed=${result.failed.length}`,
  );
  if (result.failed.length === 0) {
    ctx.session.fileChangeSnapshots.delete(runId);
  }
  ctx.post({
    type: 'fileChanges.undone',
    runId,
    restored: result.restored,
  });
  if (result.failed.length) {
    ctx.post({
      type: 'error',
      message: `Undo partially failed: ${result.failed
        .map((f) => f.path)
        .join(', ')}`,
    });
  } else {
    void ctx.vs.window.showInformationMessage(
      `Mitii: Reverted ${result.restored.length} file${
        result.restored.length === 1 ? '' : 's'
      } from this run.`,
    );
  }
}

export async function handleReviewFileChange(
  ctx: SidebarContext,
  runId: string,
  path: string,
): Promise<void> {
  const root = ctx.effectiveRoot();
  const snapshot = ctx.session.fileChangeSnapshots.get(runId);
  if (!root || !snapshot) return;
  const normalized = path.replace(/\\/g, '/');
  const before = snapshot.beforeContents.has(normalized)
    ? (snapshot.beforeContents.get(normalized) ?? null)
    : null;
  const abs = join(root, normalized);
  let after = '';
  try {
    after = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
  } catch {
    after = '';
  }
  await showPatchDiffPreview(
    ctx.vs,
    root,
    normalized,
    before ?? '',
    after,
  );
}

export async function handleReviewWorkspaceFile(ctx: SidebarContext, path: string): Promise<void> {
  const root = ctx.effectiveRoot();
  if (!root) return;
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const currentPath = normalized.includes(' -> ')
    ? normalized.split(' -> ').pop()!.trim()
    : normalized;
  const abs = join(root, currentPath);
  let before = '';
  let after = '';
  try {
    before = execFileSync('git', ['show', `HEAD:${currentPath}`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    before = '';
  }
  try {
    after = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
  } catch {
    after = '';
  }
  await showPatchDiffPreview(ctx.vs, root, currentPath, before, after);
}

export async function handleReviewCheckpointChanges(
  ctx: SidebarContext,
  checkpointId: string,
): Promise<void> {
  const root = ctx.effectiveRoot();
  if (!root) return;
  const checkpoints = loadCheckpoints(ctx.host.workspaceState);
  const { paths } = cumulativeChangedPathsSince(checkpoints, checkpointId);
  if (paths.length === 0) {
    void ctx.vs.window.showInformationMessage(
      'Mitii: No changed paths recorded for this checkpoint range.',
    );
    return;
  }
  const pick =
    paths.length === 1
      ? paths[0]
      : await ctx.vs.window.showQuickPick(paths, {
          title: `Cumulative changes (${paths.length} files)`,
          placeHolder: 'Select a file to review vs HEAD',
        });
  if (!pick) return;
  await handleReviewWorkspaceFile(ctx, pick);
}

export async function showInlineDiffForApproval(ctx: SidebarContext, approvalId: string): Promise<void> {
  const pending = ctx.host.inlineDiff.getPending();
  if (pending && pending.approvalId === approvalId) {
    const root = ctx.effectiveRoot();
    if (!root) return;
    await ctx.host.inlineDiff.showForApproval(
      root,
      pending.approvalId,
      pending.relPath,
      pending.toolName,
      pending.proposedText,
      pending.originalText,
    );
    ctx.host.onInlineDiffPending(true);
    return;
  }
  void ctx.vs.window.showInformationMessage(
    'No pending inline diff for that approval. Approve from the card, or wait for a file mutation approval.',
  );
}

export async function handleOpenDiffPreview(
  ctx: SidebarContext,
  message: Extract<WebviewToHostMessage, { type: 'openDiffPreview' }>,
): Promise<void> {
  const root = ctx.effectiveRoot();
  if (!root) return;
  if (message.oldText !== undefined && message.proposedText !== undefined) {
    await showPatchDiffPreview(
      ctx.vs,
      root,
      message.path,
      message.oldText,
      message.proposedText,
    );
  } else if (message.proposedText !== undefined) {
    await (ctx.session.hostHelpers?.showWriteDiffPreview(
      message.path,
      message.proposedText,
    ) ??
      showWriteDiffPreview(
        ctx.vs,
        root,
        message.path,
        message.proposedText,
      ));
  }
}
