import { describe, expect, it } from 'vitest';

import {
  MCP_BUILTIN_IDS,
  MCP_CATALOG_META,
  createBuiltinMcpCatalog,
  validateBuiltinSecrets,
} from './builtins.js';

describe('MCP database catalog builtins', () => {
  it('includes canonical and legacy database server ids', () => {
    for (const id of [
      'sqlite',
      'postgres',
      'mongo',
      'sqlite-readonly',
      'postgres-readonly',
      'mongo-readonly',
    ] as const) {
      expect(MCP_BUILTIN_IDS).toContain(id);
      expect(MCP_CATALOG_META[id].category).toBe('database');
    }
  });

  it('catalog entries launch @mitii packages and are disabled by default', () => {
    const catalog = createBuiltinMcpCatalog('/tmp/ws');
    const sqlite = catalog.find((s) => s.id === 'sqlite');
    const postgres = catalog.find((s) => s.id === 'postgres');
    const mongo = catalog.find((s) => s.id === 'mongo');

    for (const entry of [sqlite, postgres, mongo]) {
      expect(entry).toMatchObject({
        enabled: false,
        builtin: true,
        transport: 'stdio',
      });
      expect(entry?.command).toBeTruthy();
      expect(entry?.args?.length).toBeGreaterThan(0);
    }

    const joined = [sqlite, postgres, mongo]
      .map((e) => `${e?.command} ${(e?.args ?? []).join(' ')}`)
      .join('\n');
    expect(joined).toMatch(/mcp-sqlite/);
    expect(joined).toMatch(/mcp-postgres/);
    expect(joined).toMatch(/mcp-mongo/);
  });

  it('requires SQLITE_PATH, DATABASE_URI, and MCP_MONGODB_URI secrets', () => {
    expect(validateBuiltinSecrets('sqlite', {})).toMatch(/SQLite database path/i);
    expect(
      validateBuiltinSecrets('sqlite', { SQLITE_PATH: './data/app.db' }),
    ).toBeNull();

    expect(validateBuiltinSecrets('postgres', {})).toMatch(
      /Postgres connection URI/i,
    );
    expect(
      validateBuiltinSecrets('postgres', {
        DATABASE_URI: 'postgresql://localhost/db',
      }),
    ).toBeNull();

    expect(validateBuiltinSecrets('mongo', {})).toMatch(
      /MongoDB connection URI/i,
    );
    expect(
      validateBuiltinSecrets('mongo', {
        MCP_MONGODB_URI: 'mongodb://localhost:27017/mydb',
      }),
    ).toBeNull();
  });
});
