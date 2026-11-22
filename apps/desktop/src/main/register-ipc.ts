import { registerChatHistoryIpc } from './ipc-chat-history.js';
import { registerDialogsIpc } from './ipc-dialogs.js';
import { registerSettingsIpc } from './ipc-settings.js';
import { registerShellIpc } from './ipc-shell.js';
import { registerStorageIpc } from './ipc-storage.js';
import { registerWorkspaceIpc } from './ipc-workspace.js';
import type { MainRuntime } from './main-runtime.js';

export function registerIpc(runtime: MainRuntime): void {
  registerShellIpc(runtime);
  registerDialogsIpc(runtime);
  registerStorageIpc(runtime);
  registerChatHistoryIpc();
  registerWorkspaceIpc(runtime);
  registerSettingsIpc(runtime);
}
