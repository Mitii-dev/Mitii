import type { ModelToolDefinition } from '@mitii/v8';

import type { McpServerStatus, McpToolCallResult } from '../contracts/types.js';

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
  result: McpToolCallResult;
  resourceUri?: string;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function formatToolResult(content: unknown): string {
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

export function preferStructuredOutput(params: {
  content: unknown;
  structuredContent?: unknown;
}): unknown {
  if (params.structuredContent !== undefined) {
    return params.structuredContent;
  }
  return formatToolResult(params.content);
}

export function extractUiResourceUri(
  meta: Record<string, unknown> | undefined,
): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const ui = meta.ui;
  if (!ui || typeof ui !== 'object') return undefined;
  const uri = (ui as { resourceUri?: unknown }).resourceUri;
  return typeof uri === 'string' && uri.trim() ? uri.trim() : undefined;
}
