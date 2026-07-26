import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type * as vscode from 'vscode';

import type { McpServerConfig, McpSettings } from './protocol.js';

const MCP_FILE = 'mcp.json';

function defaultMcp(): McpSettings {
  return { enabled: false, servers: [] };
}

function parseMcp(raw: unknown): McpSettings {
  if (!raw || typeof raw !== 'object') return defaultMcp();
  const obj = raw as Record<string, unknown>;
  const enabled = Boolean(obj.enabled);
  const serversRaw = Array.isArray(obj.servers) ? obj.servers : [];
  const servers: McpServerConfig[] = [];
  for (const entry of serversRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const s = entry as Record<string, unknown>;
    const name = String(s.name ?? '').trim();
    if (!name) continue;
    const transport = (String(s.transport ?? 'stdio') as McpServerConfig['transport']);
    servers.push({
      name,
      transport:
        transport === 'sse' || transport === 'streamable-http' || transport === 'stdio'
          ? transport
          : 'stdio',
      command: typeof s.command === 'string' ? s.command : undefined,
      args: Array.isArray(s.args) ? s.args.map(String) : undefined,
      cwd: typeof s.cwd === 'string' ? s.cwd : undefined,
      env:
        s.env && typeof s.env === 'object'
          ? Object.fromEntries(
              Object.entries(s.env as Record<string, unknown>).map(([k, v]) => [
                k,
                String(v),
              ]),
            )
          : undefined,
      url: typeof s.url === 'string' ? s.url : undefined,
      headers:
        s.headers && typeof s.headers === 'object'
          ? Object.fromEntries(
              Object.entries(s.headers as Record<string, unknown>).map(([k, v]) => [
                k,
                String(v),
              ]),
            )
          : undefined,
      disabled: Boolean(s.disabled),
    });
  }
  return { enabled, servers };
}

export function readMcpSettings(
  vs: typeof vscode,
  workspaceRoot: string | undefined,
): McpSettings {
  const cfg = vs.workspace.getConfiguration('mitii');
  const fromSettings = cfg.get<McpSettings>('mcp');
  if (fromSettings && typeof fromSettings === 'object') {
    return parseMcp(fromSettings);
  }
  if (workspaceRoot) {
    const path = join(workspaceRoot, '.mitii', MCP_FILE);
    if (existsSync(path)) {
      try {
        return parseMcp(JSON.parse(readFileSync(path, 'utf8')));
      } catch {
        return defaultMcp();
      }
    }
  }
  return defaultMcp();
}

export async function writeMcpSettings(
  vs: typeof vscode,
  workspaceRoot: string | undefined,
  mcp: McpSettings,
): Promise<void> {
  const normalized = parseMcp(mcp);
  await vs.workspace
    .getConfiguration('mitii')
    .update('mcp', normalized, vs.ConfigurationTarget.Workspace);
  if (workspaceRoot) {
    const dir = join(workspaceRoot, '.mitii');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, MCP_FILE),
      `${JSON.stringify(normalized, null, 2)}\n`,
      'utf8',
    );
  }
}
