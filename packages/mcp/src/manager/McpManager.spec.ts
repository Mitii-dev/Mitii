import { describe, expect, it } from 'vitest';

import { McpManager } from '../manager/McpManager.js';
import {
  getSharedMcpManager,
  resetSharedMcpManager,
} from '../manager/sharedMcpManager.js';
import {
  mcpServerRequiresWorkspaceWrite,
  readOnlyMcpServer,
} from '../manager/mcpServerEffects.js';
import { mcpToolName } from '../manager/toolName.js';
import { registerMcpServerTools } from '../manager/registerMcpServerTools.js';
import type { McpClient, McpToolDescriptor } from '../contracts/types.js';
import type { ModelToolDefinition, RegisteredTool } from '@mitii/v8';

function fakeClient(tools: McpToolDescriptor[]): McpClient {
  return {
    async initialize() {},
    async listTools() {
      return tools;
    },
    async callTool(name, args) {
      return {
        content: JSON.stringify({ name, args }),
        isError: false,
        _meta: { ui: { resourceUri: 'ui://excalidraw/app' } },
      };
    },
    dispose() {},
  };
}

describe('mcpServerEffects', () => {
  it('marks http/sse and excalidraw as non-write', () => {
    expect(
      mcpServerRequiresWorkspaceWrite({
        name: 'Excalidraw',
        id: 'excalidraw',
        transport: 'streamable-http',
        url: 'https://mcp.excalidraw.com',
        enabled: true,
      }),
    ).toBe(false);
    expect(readOnlyMcpServer('excalidraw')).toBe(true);
  });

  it('marks stdio filesystem as write', () => {
    expect(
      mcpServerRequiresWorkspaceWrite({
        name: 'Filesystem',
        id: 'filesystem',
        transport: 'stdio',
        command: 'npx',
        enabled: true,
      }),
    ).toBe(true);
  });
});

describe('McpManager', () => {
  it('registers mcp__ tools from a ready fake client', async () => {
    const client = fakeClient([
      {
        name: 'create_view',
        description: 'draw',
        inputSchema: { type: 'object', properties: {} },
      },
    ]);
    const manager = new McpManager({
      clientInfoName: 'test',
      createClient: () => client,
    });

    const snapshot = await manager.sync({
      enabled: true,
      servers: [
        {
          id: 'excalidraw',
          name: 'Excalidraw',
          transport: 'streamable-http',
          url: 'https://example.test',
          enabled: true,
        },
      ],
    });

    expect(snapshot.enabled).toBe(true);
    expect(snapshot.servers[0]?.status).toBe('ready');
    expect(snapshot.toolDefinitions.map((t) => t.name)).toEqual([
      mcpToolName('excalidraw', 'create_view'),
    ]);
    expect(snapshot.toolDefinitions[0]?.requiresWorkspaceWrite).toBeUndefined();
    expect(manager.createRegistry().get(mcpToolName('excalidraw', 'create_view'))).toBeTruthy();
    manager.dispose();
  });

  it('records error status when initialize fails', async () => {
    const manager = new McpManager({
      createClient: () => ({
        async initialize() {
          throw new Error('boom');
        },
        async listTools() {
          return [];
        },
        async callTool() {
          return { content: '', isError: true };
        },
        dispose() {},
      }),
    });

    const snapshot = await manager.sync({
      enabled: true,
      servers: [
        {
          id: 'bad',
          name: 'Bad',
          transport: 'sse',
          url: 'https://example.test',
          enabled: true,
        },
      ],
    });
    expect(snapshot.servers[0]?.status).toBe('error');
    expect(snapshot.toolDefinitions).toEqual([]);
    manager.dispose();
  });

  it('fires tool result listener with resource uri', async () => {
    const events: string[] = [];
    const client = fakeClient([
      {
        name: 'create_view',
        inputSchema: { type: 'object' },
        _meta: { ui: { resourceUri: 'ui://excalidraw/app' } },
      },
    ]);
    const toolDefinitions: ModelToolDefinition[] = [];
    const registered: RegisteredTool[] = [];
    const toolUiResourceUri = new Map<string, string>();
    registerMcpServerTools({
      serverId: 'excalidraw',
      serverName: 'Excalidraw',
      client,
      tools: [
        {
          name: 'create_view',
          inputSchema: { type: 'object' },
          _meta: { ui: { resourceUri: 'ui://excalidraw/app' } },
        },
      ],
      requiresWorkspaceWrite: false,
      toolDefinitions,
      registered,
      toolUiResourceUri,
      getOnToolResult: () => async (event) => {
        events.push(`${event.toolName}:${event.resourceUri ?? ''}`);
      },
    });
    await registered[0]!.execute({
      arguments: { elements: [] },
      grant: {
        maximumWorkspaceEffect: 'read',
        allowedTools: ['read_file'],
        allowedEffects: ['workspace_read'],
        pathScopes: ['.'],
        approvalMode: 'never',
        limits: {
          maxToolCalls: 10,
          maxWallTimeMs: 1000,
          maxOutputBytes: 1000,
        },
      },
      maxOutputBytes: 4000,
      workspaceRoot: '/tmp',
      runId: 'run',
      callId: 'c1',
    } as never);
    expect(events).toEqual(['create_view:ui://excalidraw/app']);
  });

  it('resets shared singleton', () => {
    resetSharedMcpManager();
    const a = getSharedMcpManager({ clientInfoName: 'a' });
    const b = getSharedMcpManager();
    expect(a).toBe(b);
    resetSharedMcpManager();
    const c = getSharedMcpManager({ clientInfoName: 'c' });
    expect(c).not.toBe(a);
    resetSharedMcpManager();
  });
});
