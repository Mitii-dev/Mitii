import { describe, expect, it } from 'vitest';

import {
  MCP_BUILTIN_IDS,
  MCP_CATALOG_META,
  createBuiltinMcpCatalog,
  migrateLegacyDatabaseMcpId,
  validateBuiltinSecrets,
} from './builtins.js';

describe('MCP database catalog builtins', () => {
  it('includes only canonical database server ids', () => {
    for (const id of ['sqlite', 'postgres', 'mongo'] as const) {
      expect(MCP_BUILTIN_IDS).toContain(id);
      expect(MCP_CATALOG_META[id].category).toBe('database');
    }
    for (const id of [
      'sqlite-readonly',
      'postgres-readonly',
      'mongo-readonly',
    ]) {
      expect(MCP_BUILTIN_IDS).not.toContain(id);
    }
  });

  it('migrates legacy *-readonly ids to canonical', () => {
    expect(migrateLegacyDatabaseMcpId('mongo-readonly')).toBe('mongo');
    expect(migrateLegacyDatabaseMcpId('sqlite-readonly')).toBe('sqlite');
    expect(migrateLegacyDatabaseMcpId('postgres-readonly')).toBe('postgres');
    expect(migrateLegacyDatabaseMcpId('mongo')).toBe('mongo');
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

    expect(catalog.some((s) => s.id.endsWith('-readonly'))).toBe(false);
  });

  it('requires connection secrets for database installs', () => {
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

    expect(validateBuiltinSecrets('mongo', {})).toMatch(/MongoDB/i);
    expect(
      validateBuiltinSecrets('mongo', {
        MCP_MONGODB_URI: 'mongodb://localhost:27017/mydb',
      }),
    ).toBeNull();
  });
});
