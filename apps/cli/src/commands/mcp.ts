import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  MCP_FILE,
  getSharedMcpManager,
  readMcpSettingsFromDisk,
} from '@mitii/mcp';
import type { SessionIo } from '../session.js';

/**
 * `mitii mcp list|tools [serverId] [--json]`
 * Connects enabled servers from `.mitii/mcp.json` and reports status/tools.
 */
export async function runMcpCommand(options: {
  cwd: string;
  args: string[];
  json?: boolean;
  io: SessionIo;
}): Promise<number> {
  const { cwd, json, io } = options;
  const [sub = 'list', serverFilter] = options.args.filter(
    (a) => !a.startsWith('-'),
  );
  const settingsPath = join(cwd, '.mitii', MCP_FILE);
  const settings = readMcpSettingsFromDisk(cwd);
  const manager = getSharedMcpManager({ clientInfoName: 'mitii-cli' });
  const snapshot = await manager.sync(settings, cwd);

  if (sub === 'list' || sub === 'ls' || sub === 'status') {
    const payload = {
      configPath: settingsPath,
      configPresent: existsSync(settingsPath),
      enabled: snapshot.enabled,
      servers: snapshot.servers.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        toolCount: s.toolCount,
        ...(s.error ? { error: s.error } : {}),
      })),
      toolsCatalogTokens: snapshot.toolsCatalogTokens,
    };
    if (json) {
      io.writeStdout(`${JSON.stringify(payload, null, 2)}\n`);
      return 0;
    }
    io.writeStdout(`MCP config: ${settingsPath}  [${payload.configPresent ? 'present' : 'missing'}]\n`);
    io.writeStdout(
      `Top-level enabled: ${snapshot.enabled ? 'yes' : 'no'}${
        snapshot.enabled ? '' : '  (set "enabled": true in mcp.json)'
      }\n\n`,
    );
    if (snapshot.servers.length === 0) {
      io.writeStdout(
        'No servers configured. Add servers under .mitii/mcp.json — see docs: Using Mitii → CLI → MCP.\n',
      );
      return 0;
    }
    for (const s of snapshot.servers) {
      const err = s.error ? `  error=${s.error}` : '';
      io.writeStdout(
        `${s.status.padEnd(10)}  ${s.id.padEnd(20)}  tools=${s.toolCount}  ${s.name}${err}\n`,
      );
    }
    if (snapshot.toolsCatalogTokens > 0) {
      io.writeStdout(
        `\nCatalog tokens (approx): ${snapshot.toolsCatalogTokens}\n`,
      );
    }
    return snapshot.servers.some((s) => s.status === 'error') ? 1 : 0;
  }

  if (sub === 'tools') {
    const defs = snapshot.toolDefinitions.filter((t) => {
      if (!serverFilter) return true;
      const name = t.name ?? '';
      return (
        name === serverFilter ||
        name.startsWith(`mcp__${serverFilter}__`) ||
        name.startsWith(`${serverFilter}__`)
      );
    });
    if (json) {
      io.writeStdout(
        `${JSON.stringify(
          {
            enabled: snapshot.enabled,
            count: defs.length,
            tools: defs.map((t) => ({
              name: t.name,
              description: t.description,
            })),
          },
          null,
          2,
        )}\n`,
      );
      return 0;
    }
    if (!snapshot.enabled) {
      io.writeStdout(
        'MCP disabled (mcp.json "enabled": false). No tools registered.\n',
      );
      return 0;
    }
    if (defs.length === 0) {
      io.writeStdout(
        serverFilter
          ? `No tools for server filter "${serverFilter}".\n`
          : 'No MCP tools registered (servers empty or failed).\n',
      );
      return 0;
    }
    for (const t of defs) {
      const desc = t.description ? ` — ${t.description.slice(0, 80)}` : '';
      io.writeStdout(`${t.name}${desc}\n`);
    }
    return 0;
  }

  if (sub === 'path') {
    io.writeStdout(`${settingsPath}\n`);
    return 0;
  }

  io.writeStderr(
    'Usage: mitii mcp list|tools [serverId]|path [--json]\n',
  );
  return 2;
}
