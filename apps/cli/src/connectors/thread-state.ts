import { join } from 'node:path';

import type { AgentMode, MitiiConversationMessage, TaskList } from '@mitii/sdk';

import {
  readJsonFile,
  resolveConnectorDir,
  sanitizeKey,
  writeJsonFile,
} from './common.js';

export type ThreadCarryState = {
  conversation: MitiiConversationMessage[];
  taskList?: TaskList;
  mode?: AgentMode;
  updatedAt: string;
};

type ThreadStoreFile = {
  threads: Record<string, ThreadCarryState>;
};

function storePath(adapterName: string, instanceKey: string, cwd?: string): string {
  return join(
    resolveConnectorDir(adapterName, cwd),
    `${sanitizeKey(instanceKey)}.threads.json`,
  );
}

export function loadThreadCarry(
  adapterName: string,
  instanceKey: string,
  threadId: string,
  cwd?: string,
): ThreadCarryState | undefined {
  const store = readJsonFile<ThreadStoreFile>(
    storePath(adapterName, instanceKey, cwd),
  );
  return store?.threads?.[threadId];
}

export function saveThreadCarry(
  adapterName: string,
  instanceKey: string,
  threadId: string,
  state: ThreadCarryState,
  cwd?: string,
): void {
  const path = storePath(adapterName, instanceKey, cwd);
  const existing = readJsonFile<ThreadStoreFile>(path) ?? { threads: {} };
  existing.threads[threadId] = state;
  writeJsonFile(path, existing);
}

export function clearThreadCarry(
  adapterName: string,
  instanceKey: string,
  threadId: string,
  cwd?: string,
): void {
  const path = storePath(adapterName, instanceKey, cwd);
  const existing = readJsonFile<ThreadStoreFile>(path);
  if (!existing?.threads?.[threadId]) {
    return;
  }
  delete existing.threads[threadId];
  writeJsonFile(path, existing);
}
