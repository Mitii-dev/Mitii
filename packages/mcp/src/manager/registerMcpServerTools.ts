import { z } from 'zod';
import {
  defineTool,
  type ModelToolDefinition,
  type RegisteredTool,
  type ToolExecutionContext,
} from '@mitii/v8';

import type { McpClient, McpToolDescriptor } from '../contracts/types.js';
import { mcpToolName } from './toolName.js';
import {
  extractUiResourceUri,
  preferStructuredOutput,
  type McpManagerOptions,
} from './mcpManagerTypes.js';

export interface RegisterMcpServerToolsParams {
  serverId: string;
  serverName: string;
  client: McpClient;
  tools: McpToolDescriptor[];
  requiresWorkspaceWrite: boolean;
  toolDefinitions: ModelToolDefinition[];
  registered: RegisteredTool[];
  toolUiResourceUri: Map<string, string>;
  getOnToolResult: () => McpManagerOptions['onToolResult'];
}

/** Register one server's tools into the manager catalogs. */
export function registerMcpServerTools(
  params: RegisterMcpServerToolsParams,
): void {
  const {
    serverId,
    serverName,
    client,
    tools,
    requiresWorkspaceWrite,
    toolDefinitions,
    registered,
    toolUiResourceUri,
    getOnToolResult,
  } = params;

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
      toolUiResourceUri.set(`${serverId}::${tool.name}`, listedResourceUri);
    }

    toolDefinitions.push({
      name,
      description: `[MCP:${serverName}] ${description}`,
      inputSchema,
      ...(requiresWorkspaceWrite ? { requiresWorkspaceWrite: true } : {}),
    });

    registered.push({
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
          toolUiResourceUri.get(`${serverId}::${tool.name}`);
        try {
          await getOnToolResult()?.({
            serverId,
            serverName,
            toolName: tool.name,
            args: ctx.arguments,
            result,
            ...(resourceUriForTool ? { resourceUri: resourceUriForTool } : {}),
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
            ...(resourceUriForTool ? { resourceUri: resourceUriForTool } : {}),
            ...(result._meta ? { _meta: result._meta } : {}),
          },
          truncated,
          redacted: false,
        };
      },
    });
  }
}
