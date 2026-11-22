import { ipcMain } from 'electron';

import { deleteThread, loadHistory, saveHistory } from '../engine/history.js';

export function registerChatHistoryIpc(): void {
  ipcMain.handle(
    'mitii:list-workspace-chat-summaries',
    (_event, workspaceRoots: unknown) => {
      if (!Array.isArray(workspaceRoots)) return [];
      return workspaceRoots
        .filter((root): root is string => typeof root === 'string' && Boolean(root.trim()))
        .map((workspaceRoot) => {
          const store = loadHistory(workspaceRoot.trim());
          return {
            workspaceRoot: workspaceRoot.trim(),
            threads: store.threads.map((t) => ({
              id: t.id,
              title: t.title,
              updatedAt: t.updatedAt,
            })),
          };
        });
    },
  );

  ipcMain.handle(
    'mitii:delete-workspace-chat',
    (_event, workspaceRoot: unknown, threadId: unknown) => {
      if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) {
        return { ok: false, reason: 'invalid_workspace' };
      }
      if (typeof threadId !== 'string' || !threadId.trim()) {
        return { ok: false, reason: 'invalid_thread' };
      }
      try {
        const root = workspaceRoot.trim();
        const next = deleteThread(loadHistory(root), threadId.trim());
        saveHistory(root, next);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
}
