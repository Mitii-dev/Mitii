import { resolve } from 'path';
import type { McpServerConfig } from '../config/schema';
import { npxMcpServer } from './npxCommand';

/** Official MCP servers that need no API keys and run via npx. */
export const BUILTIN_MCP_SERVER_NAMES = [
  'filesystem',
  'memory',
  'sequential-thinking',
  'puppeteer',
  'agentmemory',
] as const;

export type BuiltinMcpServerName = (typeof BUILTIN_MCP_SERVER_NAMES)[number];

const DEFAULT_SERVER_FIELDS: Omit<McpServerConfig, 'command' | 'args'> = {
  disabled: false,
  type: 'stdio',
  env: {},
  url: '',
  headers: {},
  timeoutMs: 60_000,
};

/**
 * Built-in MCP servers preloaded on extension startup (Cline marketplace-style defaults).
 * Workspace and user settings override entries with the same name.
 */
export function buildBuiltinMcpServers(workspace: string): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {};

  if (workspace.trim()) {
    const root = resolve(workspace);
    const filesystem = npxMcpServer('@modelcontextprotocol/server-filesystem', root);
    servers.filesystem = { ...DEFAULT_SERVER_FIELDS, ...filesystem };
  }

  const memory = npxMcpServer('@modelcontextprotocol/server-memory');
  servers.memory = { ...DEFAULT_SERVER_FIELDS, ...memory };

  const sequentialThinking = npxMcpServer('@modelcontextprotocol/server-sequential-thinking');
  servers['sequential-thinking'] = { ...DEFAULT_SERVER_FIELDS, ...sequentialThinking };

  const puppeteer = npxMcpServer('@modelcontextprotocol/server-puppeteer');
  servers.puppeteer = {
    ...DEFAULT_SERVER_FIELDS,
    ...puppeteer,
    env: {
      PUPPETEER_LAUNCH_OPTIONS: JSON.stringify({ headless: true, args: ['--no-sandbox'] }),
    },
  };

  servers.agentmemory = {
    ...DEFAULT_SERVER_FIELDS,
    command: '',
    args: [],
    type: 'streamable-http',
    url: 'http://localhost:3111/mcp',
    timeoutMs: 30_000,
  };

  return servers;
}

export function isBuiltinMcpServerName(name: string): name is BuiltinMcpServerName {
  return (BUILTIN_MCP_SERVER_NAMES as readonly string[]).includes(name);
}

export async function checkAgentMemoryHealth(url = 'http://localhost:3111/agentmemory/livez'): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}
