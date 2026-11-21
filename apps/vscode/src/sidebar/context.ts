import type * as vscode from 'vscode';

import type { MitiiClient } from '@mitii/sdk';

import type {
  HostToWebviewMessage,
  IndexStatusSnapshot,
} from '../protocol.js';
import type { SidebarHostOptions } from './hostOptions.js';
import type { SidebarSessionState } from './session.js';
import type { TokenUsageTracker } from './tokenUsage.js';

/**
 * Narrow host surface passed to sidebar services and handlers. Implemented by
 * `MitiiSidebarProvider`; services always call through it so seams stay
 * overridable (tests, future hosts).
 */
export interface SidebarContext {
  readonly vs: typeof vscode;
  readonly extensionUri: vscode.Uri;
  readonly channel: vscode.OutputChannel;
  readonly secrets: vscode.SecretStorage;
  readonly host: SidebarHostOptions;
  readonly session: SidebarSessionState;
  readonly tokens: TokenUsageTracker;
  readonly ensureClient: () => Promise<MitiiClient>;
  readonly getWorkspaceRoot: () => string | undefined;
  readonly getWorkspaceId: () => string;
  readonly invalidateClient: () => void;
  readonly onIndexWorkspace: () => Promise<IndexStatusSnapshot>;
  post(message: HostToWebviewMessage): void;
  /** Workspace root honouring `mitii.workspace.rootPathOverride`. */
  effectiveRoot(): string | undefined;
  sendBootstrap(): Promise<void>;
  refreshDiscoveredModels(options: {
    notify: boolean;
    type?: string;
    baseUrl?: string;
  }): Promise<void>;
}
