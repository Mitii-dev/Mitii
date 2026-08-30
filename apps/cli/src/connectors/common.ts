import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export function parseBooleanFlag(rawArgs: string[], flag: string): boolean {
  return rawArgs.includes(flag);
}

export function parseStringFlag(
  rawArgs: string[],
  shortFlag: string,
  longFlag: string,
): string | undefined {
  for (let index = 0; index < rawArgs.length; index += 1) {
    const value = rawArgs[index];
    const matched =
      value === longFlag || (shortFlag.length > 0 && value === shortFlag);
    if (!matched) {
      continue;
    }
    const next = rawArgs[index + 1]?.trim();
    return next ? next : undefined;
  }
  return undefined;
}

export function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function terminateProcess(pid: number): Promise<boolean> {
  if (!isProcessRunning(pid)) {
    return false;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return false;
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return false;
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isProcessRunning(pid);
}

/** Connector state always lives under `<cwd>/.mitii`. */
export function resolveMitiiDataDir(cwd: string = process.cwd()): string {
  return join(cwd, '.mitii');
}

export function resolveConnectorDir(
  adapterName: string,
  cwd?: string,
): string {
  return join(resolveMitiiDataDir(cwd), 'connectors', sanitizeKey(adapterName));
}

export function sanitizeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export function ensureParentDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export function readJsonFile<T>(path: string): T | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export function writeJsonFile(path: string, value: unknown): void {
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function removeFile(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
}

export function listJsonStatePaths(
  adapterName: string,
  cwd?: string,
): string[] {
  const dir = resolveConnectorDir(adapterName, cwd);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.threads.json'))
    .map((name) => join(dir, name));
}
