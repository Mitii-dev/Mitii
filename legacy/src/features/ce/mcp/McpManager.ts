import { resolve } from 'path';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool as McpSdkTool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolRuntime } from '../../../kernel/tools/ToolRuntime';
import type { Tool, ToolResult } from '../../../kernel/tools/types';
import type { McpConfig, McpServerConfig } from '../../../kernel/config/schema';
import { buildBuiltinMcpServers, isBuiltinMcpServerName } from './builtinServers';
import { applyMcpToggles, type McpToggles } from './mcpToggles';
import { loadWorkspaceMcpServers } from './mcpWorkspaceConfig';
import { resolveMcpAuthProvider } from './McpOAuthProvider';
import { createLogger } from '../../../kernel/telemetry/Logger';
import { debugTrace } from '../../../kernel/telemetry/AsyncDebugTrace';

const log = createLogger('McpManager');
const MCP_TOOL_PREFIX = 'mcp__';

export interface McpServerStatus {
  name: string;
  connected: boolean;
  toolCount: number;
  builtin?: boolean;
  transport?: string;
  error?: string;
}

type ConnectedServer = {
  name: string;
  client: Client;
  transport: Transport;
  tools: McpSdkTool[];
};

export class McpManager {
  private servers = new Map<string, ConnectedServer>();
  private statuses = new Map<string, McpServerStatus>();

  getStatuses(): McpServerStatus[] {
    return Array.from(this.statuses.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  getConnectedToolCount(): number {
    return Array.from(this.servers.values()).reduce((sum, server) => sum + server.tools.length, 0);
  }

  async reload(
    config: McpConfig,
    workspace: string,
    toolRuntime: ToolRuntime,
    builtinToggles?: McpToggles
  ): Promise<void> {
    toolRuntime.unregisterByPrefix(MCP_TOOL_PREFIX);
    await this.closeAll();
    this.statuses.clear();

    if (!config.enabled) return;

    const servers = resolveMcpServers(config, workspace, builtinToggles);

    await runWithConcurrency(Object.entries(servers), config.maxConcurrentStartup, async ([name, serverConfig]) => {
      const builtin = config.preloadBuiltin && isBuiltinMcpServerName(name);

      if (serverConfig.disabled) {
        this.statuses.set(name, { name, connected: false, toolCount: 0, builtin, error: 'Disabled' });
        return;
      }

      const transportType = serverConfig.type ?? 'stdio';
      if (transportType === 'stdio' && !serverConfig.command.trim()) {
        this.statuses.set(name, { name, connected: false, toolCount: 0, builtin, error: 'Missing command' });
        return;
      }
      if ((transportType === 'sse' || transportType === 'streamable-http') && !serverConfig.url.trim()) {
        this.statuses.set(name, { name, connected: false, toolCount: 0, builtin, error: 'Missing URL' });
        return;
      }

      try {
        const startedAt = Date.now();
        debugTrace.trace('mcp', 'connect_send', {
          server: name,
          transport: transportType,
          timeoutMs: serverConfig.timeoutMs,
        });
        const connected = await this.connectServer(name, serverConfig, workspace);
        debugTrace.trace('mcp', 'connect_receive', {
          server: name,
          transport: transportType,
          durationMs: Date.now() - startedAt,
          toolCount: connected.tools.length,
        });
        this.servers.set(name, connected);
        this.statuses.set(name, {
          name,
          connected: true,
          toolCount: connected.tools.length,
          builtin,
          transport: transportType,
        });
        for (const tool of connected.tools) {
          toolRuntime.register(this.createThunderTool(name, tool));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        debugTrace.trace('mcp', 'connect_error', {
          server: name,
          transport: transportType,
          error: message,
        });
        this.statuses.set(name, { name, connected: false, toolCount: 0, builtin, transport: transportType, error: message });
        log.warn('MCP server failed', { server: name, error: message });
      }
    });
  }

  async closeAll(): Promise<void> {
    const closing = Array.from(this.servers.values()).map(async (server) => {
      const startedAt = Date.now();
      debugTrace.trace('mcp', 'close_send', { server: server.name });
      try {
        await server.client.close();
        debugTrace.trace('mcp', 'close_receive', {
          server: server.name,
          durationMs: Date.now() - startedAt,
        });
      } catch {
        try {
          await server.transport.close();
          debugTrace.trace('mcp', 'close_receive', {
            server: server.name,
            durationMs: Date.now() - startedAt,
            fallbackTransportClose: true,
          });
        } catch {
          // Best effort shutdown.
          debugTrace.trace('mcp', 'close_error', { server: server.name });
        }
      }
    });
    await Promise.all(closing);
    this.servers.clear();
  }

  private async connectServer(
    name: string,
    config: McpServerConfig,
    workspace: string
  ): Promise<ConnectedServer> {
    const transport = this.createTransport(config, workspace);
    const client = new Client(
      { name: 'mitii-ai-agent', version: '0.1.0' },
      { capabilities: {} }
    );

    await client.connect(transport, { timeout: config.timeoutMs });
    const listStartedAt = Date.now();
    debugTrace.trace('mcp', 'list_tools_send', { server: name, timeoutMs: config.timeoutMs });
    const listed = await client.listTools(undefined, { timeout: config.timeoutMs });
    debugTrace.trace('mcp', 'list_tools_receive', {
      server: name,
      durationMs: Date.now() - listStartedAt,
      toolCount: listed.tools.length,
    }, listed.tools);
    return { name, client, transport, tools: listed.tools };
  }

  private createTransport(config: McpServerConfig, workspace: string): Transport {
    const type = config.type ?? 'stdio';
    const headers = { ...config.headers };
    const authProvider = resolveMcpAuthProvider(headers, config.oauth);

    if (type === 'sse') {
      const url = new URL(config.url);
      return new SSEClientTransport(url, {
        requestInit: { headers },
        authProvider,
      });
    }

    if (type === 'streamable-http') {
      const url = new URL(config.url);
      return new StreamableHTTPClientTransport(url, {
        requestInit: { headers },
        authProvider,
      });
    }

    const cwd = config.cwd
      ? resolve(workspace || process.cwd(), config.cwd)
      : (workspace || process.cwd());
    const env = sanitizeEnv({ ...getDefaultEnvironment(), ...config.env });
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd,
      env,
      stderr: 'pipe',
    });
  }

  private createThunderTool(serverName: string, mcpTool: McpSdkTool): Tool<Record<string, unknown>> {
    const safeName = makeToolName(serverName, mcpTool.name);
    return {
      name: safeName,
      description: `MCP ${serverName}.${mcpTool.name}: ${mcpTool.description ?? 'External MCP tool'}`,
      risk: mcpTool.annotations?.readOnlyHint ? 'low' : 'medium',
      inputSchema: z.record(z.unknown()),
      parametersJsonSchema: normalizeToolSchema(mcpTool.inputSchema),
      execute: async (input): Promise<ToolResult> => {
        const callId = `${serverName}:${mcpTool.name}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        const startedAt = Date.now();
        const server = this.servers.get(serverName);
        if (!server) {
          debugTrace.trace('mcp', 'tool_call_error', {
            callId,
            server: serverName,
            tool: mcpTool.name,
            error: 'server_not_connected',
          });
          return { success: false, output: '', error: `MCP server not connected: ${serverName}` };
        }
        debugTrace.trace('mcp', 'tool_call_send', {
          callId,
          server: serverName,
          tool: mcpTool.name,
        }, input);
        try {
          const result = await server.client.callTool({
            name: mcpTool.name,
            arguments: input,
          });
          const output = formatMcpResult(result);
          const success = !('isError' in result && result.isError);
          debugTrace.trace('mcp', 'tool_call_receive', {
            callId,
            server: serverName,
            tool: mcpTool.name,
            durationMs: Date.now() - startedAt,
            success,
            outputChars: output.length,
          }, result);
          return {
            success,
            output,
            error: success ? undefined : output,
          };
        } catch (error) {
          debugTrace.trace('mcp', 'tool_call_error', {
            callId,
            server: serverName,
            tool: mcpTool.name,
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    };
  }
}

export function makeToolName(serverName: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${sanitizeName(serverName)}__${sanitizeName(toolName)}`.slice(0, 128);
}

function sanitizeName(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_');
  return normalized.replace(/^_+|_+$/g, '') || 'tool';
}

function normalizeToolSchema(schema: McpSdkTool['inputSchema']): Record<string, unknown> {
  return {
    type: 'object',
    properties: schema.properties ?? {},
    required: schema.required ?? [],
  };
}

function sanitizeEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

export function resolveMcpServers(
  config: McpConfig,
  workspace: string,
  builtinToggles?: McpToggles
): Record<string, McpServerConfig> {
  const builtin = config.preloadBuiltin ? buildBuiltinMcpServers(workspace) : {};
  const merged = {
    ...builtin,
    ...config.servers,
    ...loadWorkspaceMcpServers(workspace),
  };
  return builtinToggles ? applyMcpToggles(merged, builtinToggles) : merged;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;

  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  });

  await Promise.all(workers);
}

function formatMcpResult(result: Awaited<ReturnType<Client['callTool']>>): string {
  if ('toolResult' in result) {
    return stringify(result.toolResult);
  }

  const parts = result.content.map((item) => {
    if (item.type === 'text') return item.text;
    if (item.type === 'resource') {
      if ('text' in item.resource) return `Resource ${item.resource.uri}\n${item.resource.text}`;
      return `Resource ${item.resource.uri} (${item.resource.mimeType ?? 'binary'})`;
    }
    if (item.type === 'resource_link') return `Resource link: ${item.uri}`;
    return `[${item.type} content: ${'mimeType' in item ? item.mimeType : 'unknown'}]`;
  });

  if (result.structuredContent) {
    parts.push(`Structured content:\n${stringify(result.structuredContent)}`);
  }
  return parts.join('\n\n') || '(empty MCP result)';
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}
