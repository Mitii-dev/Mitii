import type { AgentMode } from '@mitii/sdk';

import {
  isProcessRunning,
  listJsonStatePaths,
  parseBooleanFlag,
  parseStringFlag,
  readJsonFile,
  removeFile,
  terminateProcess,
} from './common.js';
import type { ConnectIo } from './types.js';

export type SharedConnectOptions = {
  cwd: string;
  mode: AgentMode;
  forceEcho: boolean;
  autoApprove: boolean;
  allowedUserIds: string[];
};

export function parseAllowedUserIds(rawArgs: string[]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    if (rawArgs[i] !== '--allowed-user-id') continue;
    const next = rawArgs[i + 1]?.trim();
    if (!next || next.startsWith('-')) {
      throw new Error('connect --allowed-user-id requires a value');
    }
    ids.push(next);
    i += 1;
  }
  return ids;
}

export function parseMode(raw: string | undefined): AgentMode {
  if (!raw || raw === 'ask' || raw === 'plan' || raw === 'agent') {
    return raw ?? 'ask';
  }
  throw new Error(
    `connect --mode must be ask, plan, or agent (got "${raw}")`,
  );
}

export function parseSharedConnectOptions(
  rawArgs: string[],
): SharedConnectOptions {
  if (parseBooleanFlag(rawArgs, '-h') || parseBooleanFlag(rawArgs, '--help')) {
    throw new Error('__SHOW_HELP__');
  }
  const deny = parseBooleanFlag(rawArgs, '--deny');
  return {
    cwd: parseStringFlag(rawArgs, '', '--cwd') ?? process.cwd(),
    mode: parseMode(parseStringFlag(rawArgs, '', '--mode')),
    forceEcho: parseBooleanFlag(rawArgs, '--echo'),
    autoApprove: !deny,
    allowedUserIds: parseAllowedUserIds(rawArgs),
  };
}

export function normalizeSlashCommand(text: string): string {
  const command = text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return command.replace(/@[\w._-]+$/i, '');
}

export function isAuthorizedUser(
  allowedUserIds: string[],
  userId: string | undefined,
): boolean {
  if (allowedUserIds.length === 0) return true;
  if (!userId) return false;
  return allowedUserIds.includes(userId);
}

export function chunkMessageText(text: string, max = 1900): string[] {
  const trimmed = text.trim() || ' ';
  if (trimmed.length <= max) return [trimmed];
  const chunks: string[] = [];
  let remaining = trimmed;
  while (remaining.length > max) {
    let split = remaining.lastIndexOf('\n', max);
    if (split < max * 0.5) split = max;
    chunks.push(remaining.slice(0, split));
    remaining = remaining.slice(split).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

type PidState = {
  pid?: number;
  [key: string]: unknown;
};

export async function stopConnectorInstances(input: {
  adapterName: string;
  cwd?: string;
  io: ConnectIo;
  match?: (state: PidState) => boolean;
  label?: string;
}): Promise<number> {
  const paths = listJsonStatePaths(input.adapterName, input.cwd);
  let stopped = 0;
  for (const path of paths) {
    const state = readJsonFile<PidState>(path);
    if (!state) continue;
    if (input.match && !input.match(state)) continue;
    if (state.pid && (await terminateProcess(state.pid))) {
      stopped += 1;
      input.io.writeln(
        `[${input.label ?? input.adapterName}] stopped pid=${state.pid}`,
      );
    }
    removeFile(path);
  }
  if (stopped === 0) {
    input.io.writeln(
      `[${input.label ?? input.adapterName}] no running connector found`,
    );
  }
  return stopped;
}

export async function stopAllAdapterProcesses(
  adapterName: string,
  io: ConnectIo,
): Promise<number> {
  const paths = listJsonStatePaths(adapterName);
  let stoppedProcesses = 0;
  for (const path of paths) {
    const state = readJsonFile<PidState>(path);
    if (state?.pid && (await terminateProcess(state.pid))) {
      stoppedProcesses += 1;
      io.writeln(`[${adapterName}] stopped pid=${state.pid}`);
    }
    removeFile(path);
  }
  return stoppedProcesses;
}

export function assertNotAlreadyRunning(
  statePath: string,
  io: ConnectIo,
  label: string,
): boolean {
  const existing = readJsonFile<PidState>(statePath);
  if (
    existing?.pid &&
    existing.pid !== process.pid &&
    isProcessRunning(existing.pid)
  ) {
    io.writeErr(
      `[${label}] already running pid=${existing.pid}`,
    );
    return false;
  }
  return true;
}
