import { describe, expect, it } from 'vitest';

import { mcpToolName, parseMcp, defaultMcpSettings } from '../index.js';

describe('@mitii/mcp', () => {
  it('builds stable mcp tool names', () => {
    expect(mcpToolName('my-server', 'list_issues')).toBe(
      'mcp__my-server__list_issues',
    );
  });

  it('parses empty settings', () => {
    expect(parseMcp(null)).toEqual(defaultMcpSettings());
  });

  it('parses sse transport', () => {
    const settings = parseMcp({
      enabled: true,
      servers: [
        {
          id: 'remote',
          name: 'Remote',
          transport: 'sse',
          url: 'https://example.com/sse',
          enabled: true,
        },
      ],
    });
    expect(settings.servers[0]?.transport).toBe('sse');
    expect(settings.servers[0]?.url).toBe('https://example.com/sse');
  });
});
