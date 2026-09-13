import {
  ToolRegistry,
  createBuiltinToolRegistry,
  type ModelToolDefinition,
  type RegisteredTool,
} from '@mitii/v8';

import { activeMcpServers } from '../config/settings.js';
import type {
  McpClient,
  McpResourceContents,
  McpServerConfig,
  McpSettings,
} from '../contracts/types.js';
import { createMcpClient } from './createMcpClient.js';
import { mcpServerRequiresWorkspaceWrite } from './mcpServerEffects.js';
import {
  estimateTokens,
  type McpManagerOptions,
  type McpManagerSnapshot,
} from './mcpManagerTypes.js';
import { registerMcpServerTools } from './registerMcpServerTools.js';

export type {
  McpManagerOptions,
  McpManagerSnapshot,
  McpToolResultEvent,
} from './mcpManagerTypes.js';

type CreateClientFn = (params: {
  server: McpServerConfig;
  workspaceRoot?: string;
  clientInfoName: string;
  fetchImpl?: typeof fetch;
}) => McpClient;

/**
 * Connects enabled MCP servers and exposes their tools to Tool Runtime.
 * Never widens Decision Policy grants — registration only.
 */
export class McpManager {
  private clients = new Map<string, McpClient>();
  private statuses: McpManagerSnapshot['servers'] = [];
  private registered: RegisteredTool[] = [];
  private toolDefinitions: ModelToolDefinition[] = [];
  private enabled = false;
  private readonly clientInfoName: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly createClient: CreateClientFn;
  private onToolResult?: McpManagerOptions['onToolResult'];
  private toolUiResourceUri = new Map<string, string>();

  constructor(
    options: McpManagerOptions & { createClient?: CreateClientFn } = {},
  ) {
    this.clientInfoName = options.clientInfoName ?? 'mitii-mcp';
    this.fetchImpl = options.fetchImpl;
    this.onToolResult = options.onToolResult;
    this.createClient = options.createClient ?? createMcpClient;
  }

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
  ): Promise<{ contents: McpResourceContents[] }> {
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
        const client = this.createClient({
          server,
          workspaceRoot,
          clientInfoName: this.clientInfoName,
          fetchImpl: this.fetchImpl,
        });
        await client.initialize();
        const tools = await client.listTools();
        this.clients.set(id, client);
        registerMcpServerTools({
          serverId: id,
          serverName: server.name,
          client,
          tools,
          requiresWorkspaceWrite: mcpServerRequiresWorkspaceWrite(server),
          toolDefinitions: this.toolDefinitions,
          registered: this.registered,
          toolUiResourceUri: this.toolUiResourceUri,
          getOnToolResult: () => this.onToolResult,
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
}
