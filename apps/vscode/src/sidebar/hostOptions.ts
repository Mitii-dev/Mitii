import type * as vscode from 'vscode';

import type { InlineDiffManager } from '../diff/inlineDiffManager.js';
import type { ReviewFindingsPresenter } from '../review/reviewFindingsPresenter.js';

/** Extension-owned collaborators the sidebar host needs at construction. */
export interface SidebarHostOptions {
  extensionMode: vscode.ExtensionMode;
  workspaceState: vscode.Memento;
  inlineDiff: InlineDiffManager;
  onInlineDiffPending: (pending: boolean) => void;
  reviewFindings: ReviewFindingsPresenter;
}

/** Optional editor helpers attached by `activate()` after construction. */
export interface SidebarHostHelpers {
  showWriteDiffPreview: (relPath: string, content: string) => Promise<void>;
}
