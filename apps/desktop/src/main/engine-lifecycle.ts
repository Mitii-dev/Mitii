import { app } from 'electron';

import type { DesktopShellSnapshot } from '../shared/bridge.js';
import { generateEngineToken } from '../shared/engine-token.js';
import { errorMessage } from '../shared/project-logs.js';
import { settingsToEngineEnv } from '../shared/settings.js';
import { spawnDesktopEngine } from './engine-spawn.js';
import { desktopLogsDir, logDesktop } from './main-log.js';
import type { MainRuntime } from './main-runtime.js';
import {
  hasStoredApiKey,
  hasStoredSearchApiKey,
  readStoredApiKey,
  readStoredSearchApiKey,
} from './secrets.js';

export async function stopEngine(runtime: MainRuntime): Promise<void> {
  if (runtime.engine) {
    await runtime.engine.stop();
    runtime.engine = null;
  }
}

export async function startEngine(runtime: MainRuntime): Promise<void> {
  await stopEngine(runtime);
  runtime.engineToken = generateEngineToken();
  const { state, store, userDataPath } = runtime;
  const apiKey = readStoredApiKey(userDataPath);
  const searchApiKey = readStoredSearchApiKey(userDataPath);
  const forceEcho =
    state.settings.provider.type === 'echo' ||
    process.env.MITII_FORCE_ECHO === '1' ||
    process.argv.includes('--echo');
  const env = settingsToEngineEnv(state.settings, {
    ...(forceEcho ? {} : apiKey ? { apiKey } : {}),
    ...(searchApiKey ? { searchApiKey } : {}),
  });
  if (forceEcho) env.MITII_FORCE_ECHO = '1';
  env.MITII_DESKTOP_STORE_PATH = store.dbPath;

  const logsPath = desktopLogsDir(runtime);
  try {
    runtime.engine = await spawnDesktopEngine({
      cwd: state.workspaceRoot,
      forceEcho,
      token: runtime.engineToken,
      env,
      logsPath,
    });
    runtime.hostMode = forceEcho ? 'echo' : 'host';
    logDesktop(
      runtime,
      'engine',
      `started url=${runtime.engine.url} mode=${runtime.hostMode}`,
      { extra: { cwd: state.workspaceRoot } },
    );
  } catch (error) {
    logDesktop(runtime, 'engine', `start_failed ${errorMessage(error)}`, {
      level: 'error',
      extra: { cwd: state.workspaceRoot, dbPath: store.dbPath },
      mirrorRuns: true,
    });
    throw error;
  }
}

export function snapshot(runtime: MainRuntime): DesktopShellSnapshot {
  if (!runtime.engine) throw new Error('engine_not_ready');
  const { state, userDataPath } = runtime;
  return {
    engineBaseUrl: runtime.engine.url,
    authToken: runtime.engineToken ?? '',
    workspaceRoot: state.workspaceRoot,
    recentWorkspaces: state.recentWorkspaces,
    appVersion: app.getVersion(),
    settings: state.settings,
    hasApiKey: hasStoredApiKey(userDataPath),
    hasSearchApiKey: hasStoredSearchApiKey(userDataPath),
    hostMode: runtime.hostMode,
  };
}
