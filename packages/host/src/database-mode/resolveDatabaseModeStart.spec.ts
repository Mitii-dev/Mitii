import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  listInstalledDatabaseMcpServers,
  isMcpMasterEnabled,
} from './listInstalledDatabaseMcpServers.js';
import {
  isDatabaseUiMode,
  mapUiModeToAgentMode,
  resolveDatabaseModeStart,
} from './resolveDatabaseModeStart.js';
import { NL_SQL_ANALYST_SKILL_ID } from './constants.js';

describe('database-mode', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function workspaceWithMcp(mcp: unknown): string {
    const root = mkdtempSync(join(tmpdir(), 'mitii-db-mode-'));
    roots.push(root);
    mkdirSync(join(root, '.mitii'), { recursive: true });
    writeFileSync(
      join(root, '.mitii', 'mcp.json'),
      `${JSON.stringify(mcp, null, 2)}\n`,
      'utf8',
    );
    return root;
  }

  it('isDatabaseUiMode / mapUiModeToAgentMode', () => {
    expect(isDatabaseUiMode('database')).toBe(true);
    expect(isDatabaseUiMode('ask')).toBe(false);
    expect(mapUiModeToAgentMode('database')).toBe('ask');
    expect(mapUiModeToAgentMode('plan')).toBe('plan');
    expect(mapUiModeToAgentMode('agent')).toBe('agent');
  });

  it('reports mcp_disabled when master switch is off', () => {
    const root = workspaceWithMcp({ enabled: false, servers: [] });
    expect(isMcpMasterEnabled(root)).toBe(false);
    const result = resolveDatabaseModeStart({ workspaceRoot: root });
    expect(result.connectionStatus).toBe('mcp_disabled');
    expect(result.startFields.mode).toBe('ask');
    expect(result.startFields.requiredSkillIds).toEqual([NL_SQL_ANALYST_SKILL_ID]);
    expect(result.startFields.requiredMcpServerIds).toEqual([]);
    expect(result.connectGuidance).toMatch(/MCP enabled/i);
  });

  it('reports disconnected when MCP on but no DB servers', () => {
    const root = workspaceWithMcp({
      enabled: true,
      servers: [
        {
          id: 'filesystem',
          name: 'Filesystem',
          transport: 'stdio',
          enabled: true,
          builtin: true,
        },
      ],
    });
    const result = resolveDatabaseModeStart({ workspaceRoot: root });
    expect(result.connectionStatus).toBe('disconnected');
    expect(result.startFields.requiredMcpServerIds).toEqual([]);
    expect(listInstalledDatabaseMcpServers(root)).toEqual([]);
  });

  it('pins installed sqlite when connected; readwrite maps to agent', () => {
    const root = workspaceWithMcp({
      enabled: true,
      servers: [
        {
          id: 'sqlite',
          name: 'SQLite',
          transport: 'stdio',
          enabled: true,
          builtin: true,
        },
      ],
    });
    const result = resolveDatabaseModeStart({
      workspaceRoot: root,
      dbAccess: 'readwrite',
    });
    expect(result.connectionStatus).toBe('connected');
    expect(result.dbAccess).toBe('readwrite');
    expect(result.startFields.mode).toBe('agent');
    expect(result.startFields.requiredMcpServerIds).toEqual(['sqlite']);
    expect(result.startFields.approvalMode).toBe('never');
    expect(result.startFields.userSafetyRules.retainWriteEffect).toBe(true);
  });

  it('pins sqlite when connected (readonly → ask)', () => {
    const root = workspaceWithMcp({
      enabled: true,
      servers: [
        {
          id: 'sqlite',
          name: 'SQLite',
          transport: 'stdio',
          enabled: true,
          builtin: true,
          env: { SQLITE_PATH: './app.db' },
        },
      ],
    });
    const result = resolveDatabaseModeStart({ workspaceRoot: root });
    expect(result.connectionStatus).toBe('connected');
    expect(result.startFields.mode).toBe('ask');
    expect(result.startFields.requiredMcpServerIds).toEqual(['sqlite']);
    expect(result.startFields.projectRules.some((r) => r.id.startsWith('mode-'))).toBe(
      true,
    );
    expect(result.startFields.userSafetyRules.enabled).toBe(true);
    expect(result.startFields.userSafetyRules.retainWriteEffect).not.toBe(true);
  });

  it('migrates legacy preferredServerIds and pins canonical ids', () => {
    const root = workspaceWithMcp({
      enabled: true,
      servers: [
        {
          id: 'sqlite',
          name: 'SQLite',
          transport: 'stdio',
          enabled: true,
          builtin: true,
        },
        {
          id: 'postgres',
          name: 'Postgres',
          transport: 'stdio',
          enabled: true,
          builtin: true,
        },
      ],
    });
    const result = resolveDatabaseModeStart({
      workspaceRoot: root,
      preferredServerIds: ['postgres-readonly'],
    });
    expect(result.startFields.requiredMcpServerIds).toEqual(['postgres']);
  });

  it('detects custom mongo-named servers', () => {
    const root = workspaceWithMcp({
      enabled: true,
      servers: [
        {
          id: 'my-mongo',
          name: 'MongoDB Prod',
          transport: 'stdio',
          enabled: true,
        },
      ],
    });
    const servers = listInstalledDatabaseMcpServers(root);
    expect(servers.map((s) => s.id)).toEqual(['my-mongo']);
  });

  it('pins catalog mongo as builtin database MCP', () => {
    const root = workspaceWithMcp({
      enabled: true,
      servers: [
        {
          id: 'mongo',
          name: 'MongoDB',
          transport: 'stdio',
          enabled: true,
          builtin: true,
          env: { MCP_MONGODB_URI: 'mongodb://localhost:27017/app' },
        },
      ],
    });
    const result = resolveDatabaseModeStart({ workspaceRoot: root });
    expect(result.connectionStatus).toBe('connected');
    expect(result.startFields.requiredMcpServerIds).toEqual(['mongo']);
    expect(result.installedDatabaseServers[0]?.builtin).toBe(true);
  });

  it('migrates legacy mongo-readonly on disk to mongo when listing', () => {
    const root = workspaceWithMcp({
      enabled: true,
      servers: [
        {
          id: 'mongo-readonly',
          name: 'MongoDB (read-only)',
          transport: 'stdio',
          enabled: true,
          builtin: true,
          env: { MCP_MONGODB_URI: 'mongodb://localhost:27017/app' },
        },
      ],
    });
    const servers = listInstalledDatabaseMcpServers(root);
    expect(servers.map((s) => s.id)).toEqual(['mongo']);
    expect(servers[0]?.builtin).toBe(true);
  });
});
