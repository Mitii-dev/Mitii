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

  it('migrates legacy mongo-readonly to mongo and refreshes launcher', () => {
    const settings = parseMcp({
      enabled: true,
      servers: [
        {
          id: 'mongo-readonly',
          name: 'MongoDB (read-only)',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@mitii/mcp-mongo-readonly'],
          enabled: true,
          builtin: true,
          env: { MCP_MONGODB_URI: 'mongodb://localhost:27017/test' },
        },
      ],
    });
    const server = settings.servers[0]!;
    expect(server.id).toBe('mongo');
    expect(server.name).toBe('MongoDB');
    expect(server.env?.MCP_MONGODB_URI).toBe('mongodb://localhost:27017/test');
    const joined = `${server.command} ${(server.args ?? []).join(' ')}`;
    expect(joined).toMatch(/mcp-mongo/);
    expect(joined).not.toMatch(/mongo-readonly/);
  });
});
