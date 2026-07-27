import { z } from 'zod';
import {
  defineTool,
  ToolRegistry,
  createBuiltinToolRegistry,
  type ModelToolDefinition,
  type RegisteredTool,
  type ToolExecutionContext,
} from '@mitii/v8';

import { activeMcpServers } from '../mcpConfig.js';
import type { McpServerConfig, McpSettings } from '../protocol.js';
import { McpStdioClient, type McpToolDescriptor } from './stdioClient.js';

export type McpServerRuntimeStatus =
  | 'disabled'
  | 'connecting'
  | 'ready'
  | 'error';

export interface McpServerStatus {
  id: string;
  name: string;
  status: McpServerRuntimeStatus;
  toolCount: number;
  error?: string;
}

export interface McpManagerSnapshot {
  enabled: boolean;
  servers: McpServerStatus[];
  toolDefinitions: ModelToolDefinition[];
  /** Approximate tokens for MCP tool schemas in the prompt. */
  toolsCatalogTokens: number;
}

function mcpToolName(serverId: string, toolName: string): string {
  const safeServer = serverId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `mcp__${safeServer}__${safeTool}`;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function formatToolResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text: unknown }).text);
        }
        return JSON.stringify(part);
      })
      .join('\n');
  }
  return JSON.stringify(content, null, 2);
}

/**
 * Connects enabled MCP servers and exposes their tools to Tool Runtime.
 */
export class McpManager {
  private clients = new Map<string, McpStdioClient>();
  private statuses: McpServerStatus[] = [];
  private registered: RegisteredTool[] = [];
  private toolDefinitions: ModelToolDefinition[] = [];
  private enabled = false;

  async sync(
    mcp: McpSettings,
    workspaceRoot?: string,
  ): Promise<McpManagerSnapshot> {
    this.dispose();
    this.enabled = mcp.enabled;
    const active = activeMcpServers(mcp);

    if (!mcp.enabled || active.length === 0) {
      this.statuses = mcp.servers.map((s) => ({
        id: s.id ?? s.name,
        name: s.name,
        status: 'disabled' as const,
        toolCount: 0,
      }));
      return this.snapshot();
    }

    for (const server of active) {
      const id = server.id ?? server.name;
      this.statuses.push({
        id,
        name: server.name,
        status: 'connecting',
        toolCount: 0,
      });
      try {
        if (server.transport !== 'stdio') {
          throw new Error(
            `Transport "${server.transport}" is not supported yet (stdio only).`,
          );
        }
        if (!server.command?.trim()) {
          throw new Error('stdio server requires a command');
        }
        const client = new McpStdioClient({
          command: server.command,
          args: resolveArgs(server, workspaceRoot),
          cwd: server.cwd ?? workspaceRoot,
          env: server.env,
          serverLabel: server.name,
        });
        await client.initialize();
        const tools = await client.listTools();
        this.clients.set(id, client);
        this.registerServerTools(id, server.name, client, tools);
        const status = this.statuses.find((s) => s.id === id);
        if (status) {
          status.status = 'ready';
          status.toolCount = tools.length;
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        const status = this.statuses.find((s) => s.id === id);
        if (status) {
          status.status = 'error';
          status.error = message.slice(0, 240);
        }
      }
    }

    // Mark non-active configured servers as disabled in status list.
    for (const server of mcp.servers) {
      const id = server.id ?? server.name;
      if (this.statuses.some((s) => s.id === id)) continue;
      this.statuses.push({
        id,
        name: server.name,
        status: 'disabled',
        toolCount: 0,
      });
    }

    return this.snapshot();
  }

  createRegistry(): ToolRegistry {
    return createBuiltinToolRegistry().registerAll(this.registered);
  }

  getToolDefinitions(): ModelToolDefinition[] {
    return this.toolDefinitions;
  }

  snapshot(): McpManagerSnapshot {
    const catalogText = JSON.stringify(this.toolDefinitions);
    return {
      enabled: this.enabled,
      servers: this.statuses.slice(),
      toolDefinitions: this.toolDefinitions.slice(),
      toolsCatalogTokens: this.toolDefinitions.length
        ? estimateTokens(catalogText)
        : 0,
    };
  }

  dispose(): void {
    for (const client of this.clients.values()) {
      client.dispose();
    }
    this.clients.clear();
    this.statuses = [];
    this.registered = [];
    this.toolDefinitions = [];
    this.enabled = false;
  }

  private registerServerTools(
    serverId: string,
    serverName: string,
    client: McpStdioClient,
    tools: McpToolDescriptor[],
  ): void {
    for (const tool of tools) {
      const name = mcpToolName(serverId, tool.name);
      const description =
        tool.description?.trim() ||
        `MCP tool ${tool.name} from ${serverName}`;
      const inputSchema =
        tool.inputSchema && typeof tool.inputSchema === 'object'
          ? tool.inputSchema
          : { type: 'object', properties: {} };

      this.toolDefinitions.push({
        name,
        description: `[MCP:${serverName}] ${description}`,
        inputSchema,
      });

      this.registered.push({
        definition: defineTool({
          name,
          // Default to write-capable (opaque MCP). Known read-only servers
          // stay on workspace_read so ask/plan grants can still reject writes
          // while execute grants require approval for write-tagged MCP tools.
          effects: readOnlyMcpServer(serverId)
            ? (['workspace_read'] as const)
            : (['workspace_read', 'workspace_write'] as const),
          backend: 'mcp',
          description: `[MCP:${serverName}] ${description}`,
          inputSchema: z.unknown(),
          outputSchema: z.unknown(),
          executeSupported: true,
        }),
        async execute(ctx: ToolExecutionContext) {
          const result = await client.callTool(tool.name, ctx.arguments);
          const text = formatToolResult(result.content);
          const truncated =
            Buffer.byteLength(text, 'utf8') > ctx.maxOutputBytes;
          const output = truncated
            ? text.slice(0, Math.max(0, ctx.maxOutputBytes - 20)) +
              '\n…(truncated)'
            : text;
          return {
            output: {
              serverId,
              server: serverName,
              tool: tool.name,
              isError: Boolean(result.isError),
              content: output,
            },
            truncated,
            redacted: false,
          };
        },
      });
    }
  }
}

function resolveArgs(
  server: McpServerConfig,
  workspaceRoot?: string,
): string[] | undefined {
  if (server.id === 'filesystem' && workspaceRoot) {
    return ['-y', '@modelcontextprotocol/server-filesystem', workspaceRoot];
  }
  return server.args;
}

/** Servers known to be side-effect free (no workspace mutation). */
function readOnlyMcpServer(serverId: string): boolean {
  return (
    serverId === 'sequential-thinking' ||
    serverId === 'sequential_thinking' ||
    serverId.includes('thinking')
  );
}

/** Shared singleton used by the VS Code host between client recreations. */
let sharedManager: McpManager | undefined;

export function getSharedMcpManager(): McpManager {
  if (!sharedManager) sharedManager = new McpManager();
  return sharedManager;
}
