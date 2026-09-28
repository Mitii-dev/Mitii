import { describe, expect, it } from 'vitest';

import { resolveDbAccessMode } from './access.js';
import {
  TOOL_DEFINITIONS,
  handleToolCall,
  listToolDefinitions,
  rejectForbiddenPipeline,
  resolveMongoUri,
} from './tools.js';

describe('@mitii/mcp-mongo tools', () => {
  it('lists only read tools in readonly access', () => {
    expect(listToolDefinitions('readonly').map((t) => t.name)).toEqual([
      'list_collections',
      'describe_collection',
      'query',
      'aggregate',
      'count',
      'server_info',
    ]);
  });

  it('lists write tools when access is readwrite', () => {
    const names = listToolDefinitions('readwrite').map((t) => t.name);
    expect(names).toContain('insert');
    expect(names).toContain('update');
    expect(names).toContain('delete');
    expect(names).toContain('create_index');
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual(names);
  });

  it('resolveDbAccessMode parses aliases', () => {
    expect(resolveDbAccessMode({})).toBe('readonly');
    expect(resolveDbAccessMode({ MCP_DB_ACCESS: 'readwrite' })).toBe(
      'readwrite',
    );
    expect(resolveDbAccessMode({ MCP_DB_ACCESS: 'rw' })).toBe('readwrite');
  });

  it('resolveMongoUri requires mongodb URI', () => {
    expect(() => resolveMongoUri({})).toThrow(/MCP_MONGODB_URI/);
    expect(() =>
      resolveMongoUri({ MCP_MONGODB_URI: 'http://localhost' }),
    ).toThrow(/mongodb:\/\//);
    expect(
      resolveMongoUri({ MCP_MONGODB_URI: 'mongodb://localhost:27017/app' }),
    ).toBe('mongodb://localhost:27017/app');
  });

  it('rejectForbiddenPipeline blocks write and server-js stages', () => {
    expect(() =>
      rejectForbiddenPipeline([{ $out: 'dump' }]),
    ).toThrow(/\$out/);
    expect(() =>
      rejectForbiddenPipeline([{ $match: { a: 1 } }, { $group: { _id: '$a' } }]),
    ).not.toThrow();
  });

  it('rejects write tools when access is readonly', async () => {
    const result = await handleToolCall(
      'insert',
      { collection: 'users', documents: [{ a: 1 }] },
      { MCP_DB_ACCESS: 'readonly', MCP_MONGODB_URI: 'mongodb://localhost/x' },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/readwrite/);
  });
});
