import { describe, expect, it } from 'vitest';

import {
  TOOL_DEFINITIONS,
  rejectForbiddenPipeline,
  resolveMongoUri,
} from './tools.js';

describe('@mitii/mcp-mongo-readonly tools', () => {
  it('exposes read-only discovery and query tools', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual([
      'list_collections',
      'describe_collection',
      'query',
      'aggregate',
      'count',
    ]);
  });

  it('resolveMongoUri requires mongodb URI', () => {
    expect(() => resolveMongoUri({})).toThrow(/MCP_MONGODB_URI/);
    expect(() =>
      resolveMongoUri({ MCP_MONGODB_URI: 'http://localhost' }),
    ).toThrow(/mongodb:\/\//);
    expect(
      resolveMongoUri({ MCP_MONGODB_URI: 'mongodb://localhost:27017/app' }),
    ).toBe('mongodb://localhost:27017/app');
    expect(
      resolveMongoUri({ MONGODB_URI: 'mongodb+srv://cluster/app' }),
    ).toBe('mongodb+srv://cluster/app');
  });

  it('rejectForbiddenPipeline blocks write and server-js stages', () => {
    expect(() =>
      rejectForbiddenPipeline([{ $out: 'dump' }]),
    ).toThrow(/\$out/);
    expect(() =>
      rejectForbiddenPipeline([{ $merge: { into: 'x' } }]),
    ).toThrow(/\$merge/);
    expect(() =>
      rejectForbiddenPipeline([{ $match: { a: 1 } }, { $group: { _id: '$a' } }]),
    ).not.toThrow();
  });
});
