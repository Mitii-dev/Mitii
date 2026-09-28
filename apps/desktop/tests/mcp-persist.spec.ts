import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { mergeDesktopSettings, DEFAULT_DESKTOP_SETTINGS } from '../src/shared/settings.js';
import {
  reconcileMcpSettingsFromDisk,
  writeWorkspaceCompatFiles,
} from '../src/main/workspace-config.js';

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function tempWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'mitii-mcp-persist-'));
  temps.push(root);
  mkdirSync(join(root, '.mitii'), { recursive: true });
  return root;
}

describe('MCP persist across settings save / boot', () => {
  it('does not wipe on-disk MCP install when settings.mcp is empty', () => {
    const root = tempWorkspace();
    const mcpPath = join(root, '.mitii', 'mcp.json');
    writeFileSync(
      mcpPath,
      `${JSON.stringify(
        {
          enabled: true,
          servers: [
            {
              id: 'mongo',
              name: 'MongoDB',
              transport: 'stdio',
              command: 'node',
              args: ['bin.js'],
              env: { MCP_MONGODB_URI: 'mongodb://localhost:27017/app' },
              builtin: true,
              enabled: true,
              disabled: false,
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const emptyMcpSettings = mergeDesktopSettings(DEFAULT_DESKTOP_SETTINGS);
    expect(emptyMcpSettings.mcp.servers).toEqual([]);

    writeWorkspaceCompatFiles(root, emptyMcpSettings);

    const disk = JSON.parse(readFileSync(mcpPath, 'utf8')) as {
      enabled: boolean;
      servers: Array<{ id: string; env?: { MCP_MONGODB_URI?: string } }>;
    };
    expect(disk.enabled).toBe(true);
    expect(disk.servers).toHaveLength(1);
    expect(disk.servers[0]?.id).toBe('mongo');
    expect(disk.servers[0]?.env?.MCP_MONGODB_URI).toBe(
      'mongodb://localhost:27017/app',
    );
  });

  it('reconciles empty settings from on-disk MCP install', () => {
    const root = tempWorkspace();
    writeFileSync(
      join(root, '.mitii', 'mcp.json'),
      `${JSON.stringify({
        enabled: true,
        servers: [{ id: 'sqlite', name: 'SQLite', transport: 'stdio' }],
      })}\n`,
      'utf8',
    );

    const reconciled = reconcileMcpSettingsFromDisk(
      root,
      mergeDesktopSettings(DEFAULT_DESKTOP_SETTINGS),
    );
    expect(reconciled.mcp.enabled).toBe(true);
    expect(reconciled.mcp.servers).toHaveLength(1);
    expect(
      (reconciled.mcp.servers[0] as { id?: string }).id,
    ).toBe('sqlite');
  });

  it('replaceMcp: true allows clearing MCP on workspace cache reset', () => {
    const root = tempWorkspace();
    const mcpPath = join(root, '.mitii', 'mcp.json');
    writeFileSync(
      mcpPath,
      `${JSON.stringify({
        enabled: true,
        servers: [{ id: 'mongo', name: 'MongoDB', transport: 'stdio' }],
      })}\n`,
      'utf8',
    );

    writeWorkspaceCompatFiles(
      root,
      mergeDesktopSettings(DEFAULT_DESKTOP_SETTINGS),
      { replaceMcp: true },
    );

    const disk = JSON.parse(readFileSync(mcpPath, 'utf8')) as {
      servers: unknown[];
    };
    expect(disk.servers).toEqual([]);
  });
});
