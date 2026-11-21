import * as vscode from 'vscode';

import { MitiiInlineCompletionProvider } from '../autocomplete/inlineCompletionProvider.js';
import { captureEditorContext } from '../context/editorContext.js';
import { resolveContextToggles } from '../contextToggles.js';
import type { MitiiSidebarProvider } from '../sidebar.js';
import {
  getWorkspaceTrustSnapshot,
  onWorkspaceTrustChanged,
} from '../workspace/trust.js';
import type { ActivationRuntime } from './runtime.js';

/**
 * Keeps the sidebar in sync with editor focus, workspace trust, and
 * configuration changes; also registers inline completions.
 */
export function registerEditorSync(
  rt: ActivationRuntime,
  sidebar: MitiiSidebarProvider,
): vscode.Disposable[] {
  const { context, channel } = rt;
  const workspaceRoot = (): string | undefined => rt.workspaceRoot();
  const { debugEnabled, debugLog } = rt;
  const invalidateClient = (): void => rt.invalidateClient();
  const scheduleEnsureIndexed = (): void => rt.scheduleEnsureIndexed();

  /** Soft pins follow Context toggles — never force-attach when Editor/Open tabs are off. */
  const postEditorAutoPins = (): void => {
    const root = workspaceRoot();
    const toggles = resolveContextToggles(
      vscode.workspace.getConfiguration('mitii'),
    );
    const snap = captureEditorContext(vscode, root, {
      includeOpenTabs: toggles.openTabs,
    });
    if (toggles.editor && snap.activeRelPath) {
      sidebar.post({
        type: 'editorPin',
        path: snap.activeRelPath,
        source: 'auto',
      });
    }
    let paths: string[] = [];
    if (toggles.openTabs) {
      paths = snap.openTabRelPaths.length
        ? snap.openTabRelPaths
        : snap.activeRelPath
          ? [snap.activeRelPath]
          : [];
    } else if (toggles.editor && snap.activeRelPath) {
      paths = [snap.activeRelPath];
    }
    sidebar.post({ type: 'syncAutoPins', paths });
  };

  return [
    vscode.languages.registerInlineCompletionItemProvider(
      { scheme: 'file' },
      new MitiiInlineCompletionProvider(
        vscode,
        context.secrets,
        workspaceRoot,
        channel,
      ),
    ),
    vscode.window.onDidChangeActiveTextEditor(() => {
      postEditorAutoPins();
      sidebar.postTrustAndNotices(getWorkspaceTrustSnapshot(vscode));
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme !== 'file') return;
      postEditorAutoPins();
      const toggles = resolveContextToggles(
        vscode.workspace.getConfiguration('mitii'),
      );
      if (toggles.openTabs || toggles.editor) {
        debugLog('[mitii] document closed -> syncAutoPins');
      }
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => {
      postEditorAutoPins();
    }),
    onWorkspaceTrustChanged(vscode, (snap) => {
      sidebar.postTrustAndNotices(snap);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('mitii.ui.contextToggles.editor') ||
        event.affectsConfiguration('mitii.ui.contextToggles.openTabs')
      ) {
        postEditorAutoPins();
      }
      if (event.affectsConfiguration('mitii.debug')) {
        channel.appendLine(
          `[mitii] debug logging ${debugEnabled() ? 'enabled' : 'disabled'}`,
        );
        if (debugEnabled()) channel.show(true);
      }
      if (
        event.affectsConfiguration('mitii.provider') ||
        event.affectsConfiguration('mitii.workspace') ||
        event.affectsConfiguration('mitii.mcp') ||
        event.affectsConfiguration('mitii.search') ||
        event.affectsConfiguration('mitii.ui') ||
        event.affectsConfiguration('mitii.safety') ||
        event.affectsConfiguration('mitii.agent') ||
        event.affectsConfiguration('mitii.onboarding') ||
        event.affectsConfiguration('mitii.autocomplete') ||
        event.affectsConfiguration('mitii.debug') ||
        event.affectsConfiguration('mitii.developer')
      ) {
        if (
          event.affectsConfiguration('mitii.provider') ||
          event.affectsConfiguration('mitii.mcp') ||
          event.affectsConfiguration('mitii.search') ||
          event.affectsConfiguration('mitii.ui.contextToggles.memory') ||
          event.affectsConfiguration('mitii.agent.taskListAutoAdvance') ||
          event.affectsConfiguration('mitii.developer.modelIo') ||
          event.affectsConfiguration('mitii.developer.enabled')
        ) {
          invalidateClient();
          channel.appendLine(
            '[mitii] provider/mcp/search/memory/agent/debug settings changed; client will recompose',
          );
        }
        scheduleEnsureIndexed();
      }
    }),
  ];
}
