import type * as vscode from 'vscode';

import type { MitiiResumeInput } from '@mitii/sdk';

import type { FileChangeRunSnapshot } from '../fileChanges.js';
import type {
  ActivityEventPayload,
  SuspensionPayload,
} from '../protocol.js';
import type { SidebarHostHelpers } from './hostOptions.js';

/**
 * Mutable per-window sidebar state shared by the run controller, message
 * router, and settings service. Owned by `MitiiSidebarProvider`.
 */
export class SidebarSessionState {
  view?: vscode.WebviewView;
  runCancel?: vscode.CancellationTokenSource;
  liveApprovalMode?: string;
  pendingResume?: {
    resolve: (value: MitiiResumeInput | 'stop') => void;
  };
  pendingSuspension?: SuspensionPayload;
  lastSuspensionRunId?: string;
  activeThreadId?: string;
  lastAssistantText = '';
  liveStreamText = '';
  hostHelpers?: SidebarHostHelpers;
  /** MCP App / Excalidraw cards posted during the active run (merged into history). */
  pendingMcpAppEvents: ActivityEventPayload[] = [];
  /** Per-run file mutation snapshots for undo / diff preview. */
  fileChangeSnapshots = new Map<string, FileChangeRunSnapshot>();
  activeFileChangeSnapshot?: FileChangeRunSnapshot;
  /** Finding keys targeted by the in-flight fix-review-findings Agent run. */
  pendingFixFindingKeys: string[] = [];

  isRunActive(): boolean {
    return this.runCancel !== undefined;
  }
}
