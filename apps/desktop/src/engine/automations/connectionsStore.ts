/**
 * Persist which integrations are activated for the local runner.
 * Secrets live in `.mitii/connections.secrets.json`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ConnectionId } from '../../shared/automations/modules.js';

export interface ConnectionRecord {
  id: ConnectionId;
  activated: boolean;
  activatedAt: string | null;
  /** Non-secret display hints (channel id, url host, …). */
  meta?: Record<string, string>;
}

export interface ConnectionsState {
  connections: ConnectionRecord[];
}

function connectionsPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'connections.json');
}

function connectionSecretsPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'connections.secrets.json');
}

export function readConnectionsState(workspaceRoot: string): ConnectionsState {
  const path = connectionsPath(workspaceRoot);
  if (!existsSync(path)) {
    return { connections: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as ConnectionsState;
    return {
      connections: Array.isArray(raw.connections) ? raw.connections : [],
    };
  } catch {
    return { connections: [] };
  }
}

export function isConnectionActivated(
  workspaceRoot: string,
  id: ConnectionId,
): boolean {
  return readConnectionsState(workspaceRoot).connections.some(
    (c) => c.id === id && c.activated,
  );
}

export function activateConnection(input: {
  workspaceRoot: string;
  id: ConnectionId;
  secrets?: Record<string, string>;
  meta?: Record<string, string>;
}): ConnectionsState {
  const mitii = join(input.workspaceRoot, '.mitii');
  mkdirSync(mitii, { recursive: true });
  const state = readConnectionsState(input.workspaceRoot);
  const next: ConnectionRecord = {
    id: input.id,
    activated: true,
    activatedAt: new Date().toISOString(),
    meta: input.meta,
  };
  const connections = [
    ...state.connections.filter((c) => c.id !== input.id),
    next,
  ];
  writeFileSync(
    connectionsPath(input.workspaceRoot),
    `${JSON.stringify({ connections }, null, 2)}\n`,
  );
  if (input.secrets && Object.keys(input.secrets).length > 0) {
    let all: Record<string, Record<string, string>> = {};
    const sp = connectionSecretsPath(input.workspaceRoot);
    if (existsSync(sp)) {
      try {
        all = JSON.parse(readFileSync(sp, 'utf8')) as typeof all;
      } catch {
        all = {};
      }
    }
    all[input.id] = {
      ...(all[input.id] ?? {}),
      ...Object.fromEntries(
        Object.entries(input.secrets).filter(([, v]) => Boolean(v?.trim())),
      ),
    };
    writeFileSync(sp, `${JSON.stringify(all, null, 2)}\n`);
  }
  return { connections };
}

export function deactivateConnection(input: {
  workspaceRoot: string;
  id: ConnectionId;
}): ConnectionsState {
  const state = readConnectionsState(input.workspaceRoot);
  const connections = state.connections.map((c) =>
    c.id === input.id
      ? { ...c, activated: false, activatedAt: null }
      : c,
  );
  mkdirSync(join(input.workspaceRoot, '.mitii'), { recursive: true });
  writeFileSync(
    connectionsPath(input.workspaceRoot),
    `${JSON.stringify({ connections }, null, 2)}\n`,
  );
  return { connections };
}

export function readConnectionSecrets(
  workspaceRoot: string,
  id: ConnectionId,
): Record<string, string> {
  const sp = connectionSecretsPath(workspaceRoot);
  if (!existsSync(sp)) return {};
  try {
    const all = JSON.parse(readFileSync(sp, 'utf8')) as Record<
      string,
      Record<string, string>
    >;
    return all[id] ?? {};
  } catch {
    return {};
  }
}
