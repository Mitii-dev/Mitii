import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { McpServerConfig } from '../../../kernel/config/schema';
import { ensureThunderDir } from '../../../features/ce/indexing/paths';
import { createLogger } from '../../../kernel/telemetry/Logger';
import { isBuiltinMcpServer } from './mcpToggles';

const log = createLogger('mcpWorkspaceConfig');

type FileMcpConfig = {
  mcpServers?: Record<string, Partial<McpServerConfig>>;
};

export type McpCustomServerEntry = {
  name: string;
  type?: 'stdio' | 'sse' | 'streamable-http';
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  disabled: boolean;
  source: 'workspace' | 'settings';
};

export function listCustomMcpServers(
  settingsServers: Record<string, McpServerConfig>,
  workspace: string
): McpCustomServerEntry[] {
  const merged = new Map<string, McpCustomServerEntry>();

  for (const [name, config] of Object.entries(settingsServers)) {
    if (isBuiltinMcpServer(name)) continue;
    merged.set(name, toCustomEntry(name, config, 'settings'));
  }

  for (const [name, config] of Object.entries(loadWorkspaceMcpServers(workspace))) {
    if (isBuiltinMcpServer(name)) continue;
    merged.set(name, toCustomEntry(name, config, 'workspace'));
  }

  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function saveCustomMcpServers(
  workspace: string,
  servers: McpCustomServerEntry[],
  target: 'workspace' | 'settings'
): Record<string, McpServerConfig> {
  const payload = servers.reduce<Record<string, McpServerConfig>>((acc, server) => {
    if (isBuiltinMcpServer(server.name)) return acc;
    acc[server.name] = {
      disabled: server.disabled,
      type: server.type ?? 'stdio',
      command: server.command.trim(),
      args: server.args,
      env: server.env,
      cwd: server.cwd?.trim() || undefined,
      url: server.url?.trim() || '',
      headers: server.headers ?? {},
      timeoutMs: 60_000,
    };
    return acc;
  }, {});

  if (target === 'workspace') {
    if (!workspace.trim()) {
      throw new Error('Open a workspace folder to save MCP servers to .mitii/mcp.json.');
    }
    writeWorkspaceMcpServers(workspace, payload);
    return payload;
  }

  return payload;
}

export function connectAgentMemoryMcp(workspace: string): Record<string, McpServerConfig> {
  const servers = loadWorkspaceMcpServers(workspace);
  const next: Record<string, McpServerConfig> = {
    ...servers,
    agentmemory: {
      disabled: false,
      type: 'streamable-http',
      command: '',
      args: [],
      env: {},
      url: 'http://localhost:3111/mcp',
      headers: {},
      timeoutMs: 30_000,
    },
  };
  writeWorkspaceMcpServers(workspace, next);
  return next;
}

export function loadWorkspaceMcpServers(workspace: string): Record<string, McpServerConfig> {
  if (!workspace.trim()) return {};
  const merged: Record<string, McpServerConfig> = {};

  const rootFile = join(workspace, '.mcp.json');
  if (existsSync(rootFile)) {
    Object.assign(merged, readMcpConfigFile(rootFile));
  }

  const mitiiFile = join(ensureThunderDir(workspace), 'mcp.json');
  if (existsSync(mitiiFile)) {
    Object.assign(merged, readMcpConfigFile(mitiiFile));
  }

  return merged;
}

function writeWorkspaceMcpServers(workspace: string, servers: Record<string, McpServerConfig>): void {
  const dir = ensureThunderDir(workspace);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'mcp.json');
  const payload: FileMcpConfig = {
    mcpServers: Object.fromEntries(
      Object.entries(servers).map(([name, config]) => [
        name,
        {
          disabled: config.disabled,
          type: config.type,
          command: config.command,
          args: config.args,
          env: config.env,
          ...(config.cwd ? { cwd: config.cwd } : {}),
          ...(config.url ? { url: config.url } : {}),
          ...(Object.keys(config.headers ?? {}).length > 0 ? { headers: config.headers } : {}),
          ...(config.timeoutMs !== 60_000 ? { timeoutMs: config.timeoutMs } : {}),
        },
      ])
    ),
  };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function toCustomEntry(
  name: string,
  config: McpServerConfig,
  source: 'workspace' | 'settings'
): McpCustomServerEntry {
  return {
    name,
    type: config.type,
    command: config.command,
    args: config.args,
    env: config.env,
    cwd: config.cwd,
    url: config.url || undefined,
    headers: config.headers,
    disabled: config.disabled,
    source,
  };
}

function readMcpConfigFile(file: string): Record<string, McpServerConfig> {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as FileMcpConfig;
    const merged: Record<string, McpServerConfig> = {};
    for (const [name, value] of Object.entries(raw.mcpServers ?? {})) {
      merged[name] = normalizeMcpServerConfig(value);
    }
    return merged;
  } catch (error) {
    log.warn('Could not read workspace MCP config', {
      file,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

function normalizeMcpServerConfig(value: Partial<McpServerConfig>): McpServerConfig {
  return {
    disabled: value.disabled ?? false,
    type: value.type ?? 'stdio',
    command: value.command ?? '',
    args: value.args ?? [],
    env: value.env ?? {},
    cwd: value.cwd,
    url: value.url ?? '',
    headers: value.headers ?? {},
    timeoutMs: value.timeoutMs ?? 60_000,
  };
}
