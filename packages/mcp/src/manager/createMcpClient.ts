import {
  McpSseClient,
  McpStdioClient,
  McpStreamableHttpClient,
  workspaceRootsFromPath,
} from '../transports/index.js';
import type { McpClient, McpServerConfig } from '../contracts/types.js';
import { resolveStdioArgs } from './mcpServerEffects.js';

export function createMcpClient(params: {
  server: McpServerConfig;
  workspaceRoot?: string;
  clientInfoName: string;
  fetchImpl?: typeof fetch;
}): McpClient {
  const { server, workspaceRoot, clientInfoName, fetchImpl } = params;

  if (server.transport === 'stdio') {
    if (!server.command?.trim()) {
      throw new Error('stdio server requires a command');
    }
    return new McpStdioClient({
      command: server.command,
      args: resolveStdioArgs(server, workspaceRoot),
      cwd: server.cwd ?? workspaceRoot,
      env: server.env,
      serverLabel: server.name,
      clientInfoName,
      ...(workspaceRoot
        ? { roots: workspaceRootsFromPath(workspaceRoot) }
        : {}),
    });
  }

  if (!server.url?.trim()) {
    throw new Error(`Transport "${server.transport}" requires a url`);
  }

  if (server.transport === 'sse') {
    return new McpSseClient({
      url: server.url,
      headers: server.headers,
      serverLabel: server.name,
      clientInfoName,
      ...(fetchImpl ? { fetchImpl } : {}),
    });
  }

  if (server.transport === 'streamable-http') {
    return new McpStreamableHttpClient({
      url: server.url,
      headers: server.headers,
      serverLabel: server.name,
      clientInfoName,
      ...(fetchImpl ? { fetchImpl } : {}),
    });
  }

  throw new Error(`Unknown MCP transport: ${String(server.transport)}`);
}
