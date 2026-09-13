import { describe, expect, it } from 'vitest';

import { TOOL_DEFINITIONS, listToolDefinitions, handleToolCall } from './tools.js';

describe('@mitii/mcp-web tools', () => {
  it('exposes web_search and fetch_url by default', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual([
      'web_search',
      'fetch_url',
    ]);
    expect(listToolDefinitions({}).map((t) => t.name)).toEqual([
      'web_search',
      'fetch_url',
    ]);
  });

  it('lists memory_search when MITII_MCP_WEB_MEMORY is enabled', () => {
    expect(
      listToolDefinitions({ MITII_MCP_WEB_MEMORY: '1' }).map((t) => t.name),
    ).toEqual(['web_search', 'fetch_url', 'memory_search']);
  });

  it('rejects empty web_search query', async () => {
    const result = await handleToolCall('web_search', { query: '  ' });
    expect(result.isError).toBe(true);
  });

  it('rejects empty fetch_url', async () => {
    const result = await handleToolCall('fetch_url', {});
    expect(result.isError).toBe(true);
  });
});
