import { ipcMain } from 'electron';

import { stateFromStoreSnapshot } from './desktop-state.js';
import { stopEngine } from './engine-lifecycle.js';
import type { MainRuntime } from './main-runtime.js';
import { applyWorkspace } from './workspace-apply.js';

export function registerWorkspaceIpc(runtime: MainRuntime): void {
  ipcMain.handle('mitii:set-workspace', async (_event, workspaceRoot: unknown) => {
    if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) {
      return { ok: false, reason: 'invalid_workspace' };
    }
    return applyWorkspace(runtime, workspaceRoot.trim());
  });

  ipcMain.handle(
    'mitii:forget-workspace',
    async (_event, workspaceRoot: unknown) => {
      if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) {
        return { ok: false, reason: 'invalid_workspace' };
      }
      try {
        const path = workspaceRoot.trim();
        const { nextActive, snapshot: nextSnap } =
          runtime.store.forgetWorkspace(path);
        if (nextActive) {
          const applied = await applyWorkspace(runtime, nextActive);
          if (!applied.ok) {
            return { ok: false, reason: applied.reason, nextActive };
          }
          return { ok: true, nextActive };
        }
        await stopEngine(runtime);
        runtime.state = stateFromStoreSnapshot(nextSnap, '');
        return { ok: true, nextActive: '' };
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
}
