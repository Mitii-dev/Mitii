import { z } from 'zod';
import {
  defineTool,
  ToolRegistry,
  createBuiltinToolRegistry,
  type ModelToolDefinition,
  type RegisteredTool,
  type ToolExecutionContext,
} from '@mitii/v8';

import { activeMcpServers } from '../config/settings.js';
import type {
  McpClient,
  McpServerConfig,
  McpServerStatus,
  McpSettings,
  McpToolDescriptor,
} from '../contracts/types.js';
import {
  McpSseClient,
  McpStdioClient,
  McpStreamableHttpClient,
  workspaceRootsFromPath,
} from '../transports/index.js';
import { mcpToolName } from './toolName.js';

export interface McpManagerSnapshot {
  enabled: boolean;
  servers: McpServerStatus[];
  toolDefinitions: ModelToolDefinition[];
  /** Approximate tokens for MCP tool schemas in the prompt. */
  toolsCatalogTokens: number;
}

export interface McpManagerOptions {
  /** Value sent as clientInfo.name during initialize. */
  clientInfoName?: string;
  fetchImpl?: typeof fetch;
  /** Fired after each successful MCP tools/call (including isError results). */
  onToolResult?: (event: McpToolResultEvent) => void | Promise<void>;
}

export interface McpToolResultEvent {
  serverId: string;
  serverName: string;
  toolName: string;
  args: unknown;
  result: import('../contracts/types.js').McpToolCallResult;
  resourceUri?: string;
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

function preferStructuredOutput(params: {
  content: unknown;
  structuredContent?: unknown;
}): unknown {
  if (params.structuredContent !== undefined) {
    return params.structuredContent;
  }
  return formatToolResult(params.content);
}

/**
 * Connects enabled MCP servers and exposes their tools to Tool Runtime.
 * Never widens Decision Policy grants — registration only.
 */
export class McpManager {
  private clients = new Map<string, McpClient>();
  private statuses: McpServerStatus[] = [];
  private registered: RegisteredTool[] = [];
  private toolDefinitions: ModelToolDefinition[] = [];
  private enabled = false;
  private readonly clientInfoName: string;
  private readonly fetchImpl?: typeof fetch;
  private onToolResult?: McpManagerOptions['onToolResult'];
  /** toolName (raw) → ui resource URI from listTools `_meta.ui.resourceUri`. */
  private toolUiResourceUri = new Map<string, string>();

  constructor(options: McpManagerOptions = {}) {
    this.clientInfoName = options.clientInfoName ?? 'mitii-mcp';
    this.fetchImpl = options.fetchImpl;
    this.onToolResult = options.onToolResult;
  }

  /** Allow hosts to attach a listener after the shared singleton was created. */
  setToolResultListener(
    listener: McpManagerOptions['onToolResult'] | undefined,
  ): void {
    this.onToolResult = listener;
  }

  getClient(serverId: string): McpClient | undefined {
    return this.clients.get(serverId);
  }

  async readResource(
    serverId: string,
    uri: string,
  ): Promise<{ contents: import('../contracts/types.js').McpResourceContents[] }> {
    const client = this.clients.get(serverId);
    if (!client?.readResource) {
      throw new Error(
        `MCP server "${serverId}" does not support resources/read`,
      );
    }
    return client.readResource(uri);
  }

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
        const client = this.createClient(server, workspaceRoot);
        await client.initialize();
        const tools = await client.listTools();
        this.clients.set(id, client);
        this.registerServerTools(id, server.name, client, tools, {
          requiresWorkspaceWrite: mcpServerRequiresWorkspaceWrite(server),
        });
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
    this.toolUiResourceUri.clear();
    this.enabled = false;
  }

  private createClient(
    server: McpServerConfig,
    workspaceRoot?: string,
  ): McpClient {
    if (server.transport === 'stdio') {
      if (!server.command?.trim()) {
        throw new Error('stdio server requires a command');
      }
      return new McpStdioClient({
        command: server.command,
        args: resolveArgs(server, workspaceRoot),
        cwd: server.cwd ?? workspaceRoot,
        env: server.env,
        serverLabel: server.name,
        clientInfoName: this.clientInfoName,
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
        clientInfoName: this.clientInfoName,
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      });
    }

    if (server.transport === 'streamable-http') {
      return new McpStreamableHttpClient({
        url: server.url,
        headers: server.headers,
        serverLabel: server.name,
        clientInfoName: this.clientInfoName,
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      });
    }

    throw new Error(`Unknown MCP transport: ${String(server.transport)}`);
  }

  private registerServerTools(
    serverId: string,
    serverName: string,
    client: McpClient,
    tools: McpToolDescriptor[],
    options: { requiresWorkspaceWrite: boolean },
  ): void {
    const requiresWorkspaceWrite = options.requiresWorkspaceWrite;
    const manager = this;
    for (const tool of tools) {
      const name = mcpToolName(serverId, tool.name);
      const description =
        tool.description?.trim() ||
        `MCP tool ${tool.name} from ${serverName}`;
      const inputSchema =
        tool.inputSchema && typeof tool.inputSchema === 'object'
          ? tool.inputSchema
          : { type: 'object', properties: {} };
      const listedResourceUri = extractUiResourceUri(tool._meta);
      if (listedResourceUri) {
        manager.toolUiResourceUri.set(
          `${serverId}::${tool.name}`,
          listedResourceUri,
        );
      }

      this.toolDefinitions.push({
        name,
        description: `[MCP:${serverName}] ${description}`,
        inputSchema,
        ...(requiresWorkspaceWrite ? { requiresWorkspaceWrite: true } : {}),
      });

      this.registered.push({
        definition: defineTool({
          name,
          effects: requiresWorkspaceWrite
            ? (['workspace_read', 'workspace_write'] as const)
            : (['workspace_read'] as const),
          backend: 'mcp',
          description: `[MCP:${serverName}] ${description}`,
          inputSchema: z.unknown(),
          outputSchema: z.unknown(),
          modelInputSchema: inputSchema as Readonly<Record<string, unknown>>,
          executeSupported: true,
        }),
        async execute(ctx: ToolExecutionContext) {
          const result = await client.callTool(tool.name, ctx.arguments);
          const resourceUriForTool =
            extractUiResourceUri(result._meta) ??
            manager.toolUiResourceUri.get(`${serverId}::${tool.name}`);
          try {
            await manager.onToolResult?.({
              serverId,
              serverName,
              toolName: tool.name,
              args: ctx.arguments,
              result,
              ...(resourceUriForTool
                ? { resourceUri: resourceUriForTool }
                : {}),
            });
          } catch {
            // Host persistence / UI hooks must not fail the tool call.
          }
          const preferred = preferStructuredOutput({
            content: result.content,
            structuredContent: result.structuredContent,
          });
          const text =
            typeof preferred === 'string'
              ? preferred
              : JSON.stringify(preferred);
          const truncated =
            Buffer.byteLength(text, 'utf8') > ctx.maxOutputBytes;
          const clipped = truncated
            ? text.slice(0, Math.max(0, ctx.maxOutputBytes - 20)) +
              '\n…(truncated)'
            : text;
          let contentOut: unknown = clipped;
          if (typeof preferred !== 'string' && !truncated) {
            contentOut = preferred;
          }
          return {
            output: {
              serverId,
              server: serverName,
              tool: tool.name,
              isError: Boolean(result.isError),
              content: contentOut,
              ...(result.structuredContent !== undefined
                ? { structuredContent: result.structuredContent }
                : {}),
              ...(resourceUriForTool
                ? { resourceUri: resourceUriForTool }
                : {}),
              ...(result._meta ? { _meta: result._meta } : {}),
            },
            truncated,
            redacted: false,
          };
        },
      });
    }
  }
}

function extractUiResourceUri(
  meta: Record<string, unknown> | undefined,
): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const ui = meta.ui;
  if (!ui || typeof ui !== 'object') return undefined;
  const uri = (ui as { resourceUri?: unknown }).resourceUri;
  return typeof uri === 'string' && uri.trim() ? uri.trim() : undefined;
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

/** Servers / transports that do not mutate the workspace. */
function mcpServerRequiresWorkspaceWrite(server: McpServerConfig): boolean {
  if (
    server.transport === 'streamable-http' ||
    server.transport === 'sse'
  ) {
    return false;
  }
  const id = (server.id ?? server.name).toLowerCase();
  return !readOnlyMcpServer(id);
}

/** Servers known to be side-effect free (no workspace mutation). */
function readOnlyMcpServer(serverId: string): boolean {
  return (
    serverId === 'sequential-thinking' ||
    serverId === 'sequential_thinking' ||
    serverId.includes('thinking') ||
    serverId === 'excalidraw'
  );
}

/** Shared singleton used by hosts between client recreations. */
let sharedManager: McpManager | undefined;

export function getSharedMcpManager(
  options?: McpManagerOptions,
): McpManager {
  if (!sharedManager) {
    sharedManager = new McpManager(options ?? { clientInfoName: 'mitii' });
  }
  return sharedManager;
}

/** Test helper — reset singleton between suites. */
export function resetSharedMcpManager(): void {
  sharedManager?.dispose();
  sharedManager = undefined;
}
