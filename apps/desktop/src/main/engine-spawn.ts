/**
 * Spawn / supervise the desktop engine process.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { isAllowedEngineBaseUrl } from '../shared/window-url-policy.js';
import {
  appendEngineLog,
  appendProjectLog,
  resolveLogsDir,
} from '../shared/project-logs.js';

export interface SpawnEngineOptions {
  cwd: string;
  forceEcho?: boolean;
  token?: string;
  host?: string;
  /** Absolute path to engine entry (default: packaged dist/engine/main.js). */
  entryPath?: string;
  env?: Record<string, string | undefined>;
  readinessTimeoutMs?: number;
  /** Project logs directory (Root/projects/…/logs). */
  logsPath?: string;
}

export interface SpawnedEngine {
  url: string;
  port: number;
  mode: string;
  process: ChildProcess;
  stop: () => Promise<void>;
}

function defaultEntryPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'engine', 'main.js');
}

/**
 * Engine is a Node HTTP process with native addons (better-sqlite3).
 * Under Electron, process.execPath is the Electron binary (wrong NODE_MODULE_VERSION).
 * Prefer system Node so native modules match the workspace install ABI.
 */
export function resolveEngineNodeBinary(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!process.versions.electron) {
    return process.execPath;
  }
  const override = env.MITII_NODE_PATH?.trim();
  if (override) return override;
  const npmNode = env.npm_node_execpath?.trim();
  if (npmNode) return npmNode;
  return 'node';
}

export async function spawnDesktopEngine(
  options: SpawnEngineOptions,
): Promise<SpawnedEngine> {
  const entry = options.entryPath ?? defaultEntryPath();
  const args = [
    entry,
    '--cwd',
    options.cwd,
    '--host',
    options.host ?? '127.0.0.1',
  ];
  if (options.forceEcho) args.push('--echo');
  if (options.token) args.push('--token', options.token);

  const logsPath = resolveLogsDir(options.logsPath, {
    ...process.env,
    ...options.env,
  });
  const mergedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    MITII_DESKTOP_CLIENT: 'desktop',
    ...(logsPath ? { MITII_LOGS_PATH: logsPath } : {}),
  };
  delete mergedEnv.ELECTRON_RUN_AS_NODE;
  const nodeBinary = resolveEngineNodeBinary(mergedEnv);

  appendProjectLog(
    logsPath,
    'engine.log',
    `spawning engine node=${nodeBinary} cwd=${options.cwd} model=${mergedEnv.MITII_MODEL ?? ''} baseUrl=${mergedEnv.MITII_BASE_URL ?? ''}`,
  );

  const child = spawn(nodeBinary, args, {
    cwd: options.cwd,
    env: mergedEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const timeoutMs = options.readinessTimeoutMs ?? 30_000;
  const url = await waitForListening(child, timeoutMs, logsPath);

  return {
    url,
    port: new URL(url).port ? Number(new URL(url).port) : 80,
    mode: 'unknown',
    process: child,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
          }
        }, 3_000).unref();
      }),
  };
}

function waitForListening(
  child: ChildProcess,
  timeoutMs: number,
  logsPath?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      appendProjectLog(logsPath, 'engine.log', `ready_failed ${error.message}`);
      reject(error);
    };
    const ok = (url: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      appendProjectLog(logsPath, 'engine.log', `listening ${url}`);
      resolve(url);
    };

    const timer = setTimeout(() => {
      fail(new Error(`engine_ready_timeout_${timeoutMs}ms`));
    }, timeoutMs);

    const onExit = (code: number | null) => {
      fail(new Error(`engine_exited_before_ready:${code}`));
    };
    child.once('exit', onExit);
    child.once('error', (err) => fail(err));

    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout) {
      fail(new Error('engine_missing_stdout'));
      return;
    }

    const rl = createInterface({ input: stdout });
    rl.on('line', (line) => {
      appendEngineLog(logsPath, 'stdout', line);
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) return;
      try {
        const msg = JSON.parse(trimmed) as { op?: string; url?: string };
        if (msg.op === 'listening' && typeof msg.url === 'string') {
          if (!isAllowedEngineBaseUrl(msg.url)) {
            fail(new Error(`engine_url_not_allowed:${msg.url}`));
            return;
          }
          ok(msg.url);
        }
      } catch {
        // ignore non-JSON stdout
      }
    });

    stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      appendEngineLog(logsPath, 'stderr', text);
      process.stderr.write(`[mitii-desktop-engine] ${text}`);
    });

    // Keep teeing after readiness so engine runtime errors land in engine.log.
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) appendEngineLog(logsPath, 'stdout', chunk.toString('utf8'));
    });

    function cleanup(): void {
      clearTimeout(timer);
      child.off('exit', onExit);
      rl.close();
    }
  });
}
