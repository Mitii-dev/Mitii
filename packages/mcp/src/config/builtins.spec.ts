import { describe, expect, it } from 'vitest';

import {
  MCP_BUILTIN_IDS,
  MCP_CATALOG_META,
  createBuiltinMcpCatalog,
  validateBuiltinSecrets,
} from './builtins.js';

describe('MCP database catalog builtins', () => {
  it('includes sqlite-readonly and postgres-readonly', () => {
    expect(MCP_BUILTIN_IDS).toContain('sqlite-readonly');
    expect(MCP_BUILTIN_IDS).toContain('postgres-readonly');
    expect(MCP_CATALOG_META['sqlite-readonly'].category).toBe('database');
    expect(MCP_CATALOG_META['postgres-readonly'].category).toBe('database');
  });

  it('catalog entries are disabled by default with expected launchers', () => {
    const catalog = createBuiltinMcpCatalog('/tmp/ws');
    const sqlite = catalog.find((s) => s.id === 'sqlite-readonly');
    const postgres = catalog.find((s) => s.id === 'postgres-readonly');

    expect(sqlite).toMatchObject({
      enabled: false,
      builtin: true,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@mitii/mcp-sqlite-readonly'],
    });
    expect(postgres).toMatchObject({
      enabled: false,
      builtin: true,
      transport: 'stdio',
      command: 'uvx',
      args: ['postgres-mcp', '--access-mode=restricted'],
    });
  });

  it('requires SQLITE_PATH and DATABASE_URI secrets', () => {
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
  });
});
