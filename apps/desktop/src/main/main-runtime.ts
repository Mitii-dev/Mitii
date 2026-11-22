import type { BrowserWindow } from 'electron';

import { defaultDesktopState, type DesktopPersistedState } from './desktop-state.js';
import type { DesktopStoreClient } from './desktop-store-client.js';
import type { SpawnedEngine } from './engine-spawn.js';

/** Mutable process-level state shared by main-process modules. */
export interface MainRuntime {
  readonly distRoot: string;
  mainWindow: BrowserWindow | null;
  engine: SpawnedEngine | null;
  engineToken: string | undefined;
  hostMode: string;
  state: DesktopPersistedState;
  userDataPath: string;
  /** Assigned during boot, before any IPC handler or engine start runs. */
  store: DesktopStoreClient;
}

export function createMainRuntime(distRoot: string): MainRuntime {
  return {
    distRoot,
    mainWindow: null,
    engine: null,
    engineToken: undefined,
    hostMode: '',
    state: defaultDesktopState(''),
    userDataPath: '',
    store: undefined as unknown as DesktopStoreClient,
  };
}
