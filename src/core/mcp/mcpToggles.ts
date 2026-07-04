import { BUILTIN_MCP_SERVER_NAMES } from './builtinServers';

export interface McpToggles {
  filesystem: boolean;
  memory: boolean;
  sequentialThinking: boolean;
  puppeteer: boolean;
}

export const defaultMcpToggles = (): McpToggles => ({
  filesystem: true,
  memory: true,
  sequentialThinking: true,
  puppeteer: false,
});

export function mcpToggleKeyToServerName(key: keyof McpToggles): string {
  if (key === 'sequentialThinking') return 'sequential-thinking';
  return key;
}

export function mcpServerNameToToggleKey(name: string): keyof McpToggles | undefined {
  if (name === 'filesystem') return 'filesystem';
  if (name === 'memory') return 'memory';
  if (name === 'sequential-thinking') return 'sequentialThinking';
  if (name === 'puppeteer') return 'puppeteer';
  return undefined;
}

export function isBuiltinMcpServer(serverName: string): boolean {
  return (BUILTIN_MCP_SERVER_NAMES as readonly string[]).includes(serverName);
}

export function applyMcpToggles<T extends { disabled?: boolean }>(
  servers: Record<string, T>,
  toggles: McpToggles
): Record<string, T> {
  const next: Record<string, T> = { ...servers };
  for (const name of BUILTIN_MCP_SERVER_NAMES) {
    if (!next[name]) continue;
    const key = mcpServerNameToToggleKey(name);
    if (!key) continue;
    next[name] = { ...next[name], disabled: !toggles[key] };
  }
  return next;
}
