import { describe, expect, it } from 'vitest';

import {
  MCP_BUILTIN_IDS,
  MCP_CATALOG_META,
  createBuiltinMcpCatalog,
  validateBuiltinSecrets,
} from './builtins.js';

describe('MCP database catalog builtins', () => {
  it('includes first-party sqlite, postgres, and mongo readonly servers', () => {
    expect(MCP_BUILTIN_IDS).toContain('sqlite-readonly');
    expect(MCP_BUILTIN_IDS).toContain('postgres-readonly');
    expect(MCP_BUILTIN_IDS).toContain('mongo-readonly');
    expect(MCP_CATALOG_META['sqlite-readonly'].category).toBe('database');
    expect(MCP_CATALOG_META['postgres-readonly'].category).toBe('database');
    expect(MCP_CATALOG_META['mongo-readonly'].category).toBe('database');
  });

  it('catalog entries launch @mitii packages and are disabled by default', () => {
    const catalog = createBuiltinMcpCatalog('/tmp/ws');
    const sqlite = catalog.find((s) => s.id === 'sqlite-readonly');
    const postgres = catalog.find((s) => s.id === 'postgres-readonly');
    const mongo = catalog.find((s) => s.id === 'mongo-readonly');

    for (const entry of [sqlite, postgres, mongo]) {
      expect(entry).toMatchObject({
        enabled: false,
        builtin: true,
        transport: 'stdio',
      });
      expect(entry?.command).toBeTruthy();
      expect(entry?.args?.length).toBeGreaterThan(0);
    }

    // Prefer workspace bin; fall back to npx -y @mitii/…
    const joined = [sqlite, postgres, mongo]
      .map((e) => `${e?.command} ${(e?.args ?? []).join(' ')}`)
      .join('\n');
    expect(joined).toMatch(/mcp-sqlite-readonly/);
    expect(joined).toMatch(/mcp-postgres-readonly/);
    expect(joined).toMatch(/mcp-mongo-readonly/);
  });

  it('requires SQLITE_PATH, DATABASE_URI, and MCP_MONGODB_URI secrets', () => {
    expect(validateBuiltinSecrets('sqlite-readonly', {})).toMatch(
      /SQLite database path/i,
    );
    expect(
      validateBuiltinSecrets('sqlite-readonly', {
        SQLITE_PATH: './data/app.db',
      }),
    ).toBeNull();

    expect(validateBuiltinSecrets('postgres-readonly', {})).toMatch(
      /Postgres connection URI/i,
    );
    expect(
      validateBuiltinSecrets('postgres-readonly', {
        DATABASE_URI: 'postgresql://localhost/db',
      }),
    ).toBeNull();

    expect(validateBuiltinSecrets('mongo-readonly', {})).toMatch(
      /MongoDB connection URI/i,
    );
    expect(
      validateBuiltinSecrets('mongo-readonly', {
        MCP_MONGODB_URI: 'mongodb://localhost:27017/mydb',
      }),
    ).toBeNull();
  });
});
