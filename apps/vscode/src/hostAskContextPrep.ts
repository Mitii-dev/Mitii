import type { MitiiConversationMessage } from '@mitii/sdk';
import { deriveLiveTokenBudgetPreview } from '@mitii/ui-core';
import type * as vscode from 'vscode';

import { formatDiagnosticsPromptBlock } from './context/diagnosticsContext.js';
import { captureEditorContext } from './context/editorContext.js';
import {
  readContextToggles,
  resolveIntentLiteContextToggles,
} from './contextToggles.js';
import { buildContextUsageBreakdown } from './contextUsage.js';
import { nextActivityEventId } from './hostAskEvents.js';
import {
  composePrompt,
  readPinnedFileContents,
  type HostAskHandlers,
} from './hostAskSuspension.js';
import { getSharedMcpManager } from './mcp/manager.js';
import { estimateMemoryPromptBlock } from './memoryStore.js';
import { buildReviewDiff } from './reviewDiff.js';
import {
  normalizeMaximumOutputTokens,
  resolveEffectiveContextWindow,
} from './settingsFields.js';
import { readTokenBudgetPolicyOverrides } from './tokenBudgetSettings.js';
import { buildWorkspaceSnapshot } from './workspaceSnapshot.js';

export interface HostAskContextPrepOptions {
  vs: typeof vscode;
  workspaceRoot?: string;
  channel: vscode.OutputChannel;
  prompt: string;
  depth?: string;
  pinnedPaths?: string[];
  workspaceId?: string;
  workspaceState?: vscode.Memento;
  conversationText?: string;
  conversation?: MitiiConversationMessage[];
  handlers?: HostAskHandlers;
}

/** Assembled host-side context for one ask, ready for `prepareStartInput`. */
export interface HostAskContextPrep {
  cfg: vscode.WorkspaceConfiguration;
  toggles: ReturnType<typeof resolveIntentLiteContextToggles>;
  pinnedPaths: string[];
  /** Prompt with pins/editor/diagnostics/repo map/git diff composed in. */
  prompt: string;
  contextWindow: number;
  maximumOutputTokens: number;
  windowBudgetPolicy: ReturnType<typeof readTokenBudgetPolicyOverrides>;
  budgetPreview: ReturnType<typeof deriveLiveTokenBudgetPreview>;
  contextBreakdown: ReturnType<typeof buildContextUsageBreakdown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Collect editor, diagnostics, repo map, git diff, pinned contents, and memory
 * estimates; build the composed prompt and context breakdown; and announce
 * attached context to the output channel and activity timeline.
 */
export async function prepareHostAskContext(
  options: HostAskContextPrepOptions,
): Promise<HostAskContextPrep> {
  const { vs, workspaceRoot, channel, handlers } = options;
  const cfg = vs.workspace.getConfiguration('mitii');
  const storedContextWindow = cfg.get<number>('provider.contextWindow');
  const contextWindow = resolveEffectiveContextWindow(
    typeof storedContextWindow === 'number' &&
      Number.isFinite(storedContextWindow)
      ? Math.floor(storedContextWindow)
      : 0,
    cfg.get<string>('provider.model') ?? '',
    cfg.get<string>('provider.type') ?? '',
  );
  const windowBudgetPolicy = readTokenBudgetPolicyOverrides(cfg);
  const maximumOutputTokens = normalizeMaximumOutputTokens(
    cfg.get<number>('provider.maximumOutputTokens'),
  );
  const budgetPreview = deriveLiveTokenBudgetPreview({
    contextWindowTokens: contextWindow,
    maximumOutputTokens,
    policy: windowBudgetPolicy,
  });
  const toggles = resolveIntentLiteContextToggles({
    toggles: readContextToggles(vs),
    depth: options.depth,
    prompt: options.prompt,
  });
  const editor = toggles.editor
    ? captureEditorContext(vs, workspaceRoot, {
        includeOpenTabs: toggles.openTabs,
        maxSelectionChars: budgetPreview.injectionSelectionChars,
      })
    : undefined;
  const diagnosticsBlock = toggles.diagnostics
    ? formatDiagnosticsPromptBlock(vs, workspaceRoot)
    : '';
  // Explicit user pins only — do not auto-promote the active editor into pinned.
  const pinnedPaths = [...(options.pinnedPaths ?? [])];
  const hasPinnedContext = pinnedPaths.length > 0;

  let repoMapBlock: string | undefined;
  // Pinned files take priority. Only attach a workspace outline when there are
  // no pins, or when the user explicitly asked for deep context.
  const includeRepoMap =
    toggles.repoMap &&
    workspaceRoot &&
    (!hasPinnedContext || options.depth === 'deep');
  if (includeRepoMap) {
    try {
      const maxFiles = hasPinnedContext ? 60 : 200;
      const snap = await buildWorkspaceSnapshot({
        workspaceRoot,
        workspaceId: options.workspaceId ?? 'vscode_workspace',
        maxFiles,
      });
      const listed = snap.relativePaths.slice(0, maxFiles);
      repoMapBlock = `Workspace file map (${snap.fileCount} files${
        snap.truncated ? ', truncated' : ''
      }${hasPinnedContext ? '; supplementary — pinned files take priority' : ''}):\n${listed
        .map((p) => `- ${p}`)
        .join('\n')}`;
    } catch (error) {
      channel.appendLine(`[context] repo map failed: ${errorMessage(error)}`);
    }
  }

  let gitDiffBlock: string | undefined;
  if (toggles.gitDiff && workspaceRoot) {
    try {
      const review = await buildReviewDiff(workspaceRoot, {
        maxFileChars: budgetPreview.injectionReviewDiffFileChars,
        maxTotalChars: budgetPreview.injectionReviewDiffTotalChars,
        maxPatchPreviewChars: Math.min(
          4_000,
          budgetPreview.injectionReviewDiffFileChars,
        ),
      });
      const fileLines = review.files
        .slice(0, 40)
        .map((f) => `- ${f.status} ${f.path}`)
        .join('\n');
      gitDiffBlock = [
        `Git status: ${review.summary}`,
        fileLines ? `Changed files:\n${fileLines}` : undefined,
        review.patchPreview ? `Diff stat:\n${review.patchPreview}` : undefined,
      ]
        .filter(Boolean)
        .join('\n\n');
    } catch (error) {
      channel.appendLine(`[context] git diff failed: ${errorMessage(error)}`);
    }
  }

  const pinnedContents =
    workspaceRoot && pinnedPaths.length
      ? readPinnedFileContents(workspaceRoot, pinnedPaths)
      : undefined;

  const prompt = composePrompt({
    prompt: options.prompt,
    pinnedPaths,
    pinnedContents: pinnedContents || undefined,
    editorBlock: editor?.promptBlock,
    diagnosticsBlock: diagnosticsBlock || undefined,
    repoMapBlock,
    gitDiffBlock,
  });

  const mcpCatalogTokens = getSharedMcpManager().snapshot().toolsCatalogTokens;
  const memoryBlock =
    toggles.memory && options.workspaceState && options.workspaceId
      ? await estimateMemoryPromptBlock(
          options.workspaceState,
          options.workspaceId,
        )
      : undefined;
  const contextBreakdown = buildContextUsageBreakdown({
    prompt: options.prompt,
    conversationText: options.conversationText,
    pinnedContents: pinnedContents || undefined,
    memoryBlock,
    editorBlock: editor?.promptBlock,
    diagnosticsBlock: diagnosticsBlock || undefined,
    gitDiffBlock,
    repoMapBlock,
    mcpToolsCatalogTokens: mcpCatalogTokens,
    depthHint: options.depth,
    contextWindow,
    preview: budgetPreview,
  });
  handlers?.onContextBreakdown?.(contextBreakdown);

  channel.show(true);
  channel.appendLine(`> ${options.prompt}`);
  if (options.conversation && options.conversation.length > 0) {
    channel.appendLine(
      `[context] conversation carry: ${options.conversation.length} prior turn(s)`,
    );
  } else {
    channel.appendLine('[context] conversation carry: none (first turn or empty history)');
  }

  const emitHostNote = (line: string, title: string, detail?: string) => {
    channel.appendLine(line);
    handlers?.onEvent?.(undefined, {
      id: nextActivityEventId(),
      at: Date.now(),
      kind: 'context',
      title,
      detail,
    });
  };

  if (editor?.activeRelPath) {
    emitHostNote(
      `[context] activeEditor=@${editor.activeRelPath}`,
      'Attached active editor',
      `@${editor.activeRelPath}`,
    );
  }
  if (diagnosticsBlock) {
    emitHostNote(
      '[context] diagnostics attached',
      'Attached diagnostics',
      'workspace problems',
    );
  }
  if (repoMapBlock) {
    const fileCountMatch = /Workspace file map \((\d+) files/.exec(repoMapBlock);
    const fileCount = fileCountMatch?.[1];
    emitHostNote(
      '[context] repo map attached',
      'Attached workspace map',
      fileCount ? `${fileCount} file paths` : 'file path list',
    );
  }
  if (gitDiffBlock) {
    emitHostNote(
      '[context] git diff attached',
      'Attached git status',
      'changed files + diff summary',
    );
  }
  if (pinnedContents) {
    emitHostNote(
      `[context] pinned file contents (${pinnedPaths.length})`,
      pinnedPaths.length === 1 ? 'Read pinned file' : 'Read pinned files',
      pinnedPaths.map((p) => `@${p}`).join(', '),
    );
  }

  return {
    cfg,
    toggles,
    pinnedPaths,
    prompt,
    contextWindow,
    maximumOutputTokens,
    windowBudgetPolicy,
    budgetPreview,
    contextBreakdown,
  };
}
