import { describe, expect, it } from 'vitest';

import {
  MCP_BUILTIN_IDS,
  MCP_CATALOG_META,
  applyBuiltinSecrets,
  composeDbConnectionUri,
  createBuiltinMcpCatalog,
  getBuiltinCatalogEntry,
  migrateLegacyDatabaseMcpId,
  validateBuiltinSecrets,
} from './builtins.js';

describe('MCP database catalog builtins', () => {
  it('includes only canonical database server ids', () => {
    for (const id of ['sqlite', 'postgres', 'mongo', 'sql'] as const) {
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
    const sql = catalog.find((s) => s.id === 'sql');

    for (const entry of [sqlite, postgres, mongo, sql]) {
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

  it('exposes structured connection fields for network DB catalogs', () => {
    const postgresKeys = MCP_CATALOG_META.postgres.secrets.map((s) => s.key);
    expect(postgresKeys).toEqual(
      expect.arrayContaining([
        'MITII_DB_HOST',
        'MITII_DB_PORT',
        'MITII_DB_USER',
        'MITII_DB_PASSWORD',
        'MITII_DB_NAME',
        'DATABASE_URI',
      ]),
    );
    expect(MCP_CATALOG_META.sql.secrets.map((s) => s.key)).toEqual(
      expect.arrayContaining([
        'SQL_MCP_DIALECT',
        'MITII_DB_HOST',
        'MITII_DB_PATH',
        'SQL_MCP_URI',
      ]),
    );
  });

  it('requires connection secrets for database installs', () => {
    expect(validateBuiltinSecrets('sqlite', {})).toMatch(/SQLite database path/i);
    expect(
      validateBuiltinSecrets('sqlite', { SQLITE_PATH: './data/app.db' }),
    ).toBeNull();

    expect(validateBuiltinSecrets('postgres', {})).toMatch(/Host is required/i);
    expect(
      validateBuiltinSecrets('postgres', {
        MITII_DB_HOST: 'localhost',
        MITII_DB_NAME: 'app',
      }),
    ).toBeNull();
    expect(
      validateBuiltinSecrets('postgres', {
        DATABASE_URI: 'postgresql://localhost/db',
      }),
    ).toBeNull();

    expect(validateBuiltinSecrets('mongo', {})).toMatch(/Host is required/i);
    expect(
      validateBuiltinSecrets('mongo', {
        MCP_MONGODB_URI: 'mongodb://localhost:27017/mydb',
      }),
    ).toBeNull();

    expect(validateBuiltinSecrets('sql', {})).toMatch(/Dialect is required/i);
    expect(
      validateBuiltinSecrets('sql', {
        SQL_MCP_DIALECT: 'sqlite',
      }),
    ).toMatch(/SQLite path/i);
    expect(
      validateBuiltinSecrets('sql', {
        SQL_MCP_DIALECT: 'sqlite',
        MITII_DB_PATH: './app.db',
      }),
    ).toBeNull();
    expect(
      validateBuiltinSecrets('sql', {
        SQL_MCP_URI: 'postgresql://localhost/db',
      }),
    ).toBeNull();
  });

  it('composes URIs and only persists final env keys', () => {
    expect(
      composeDbConnectionUri({
        scheme: 'postgresql',
        host: 'db.example',
        user: 'alice',
        password: 'p@ss:word',
        database: 'app',
      }),
    ).toBe('postgresql://alice:p%40ss%3Aword@db.example:5432/app');

    const postgres = applyBuiltinSecrets(
      getBuiltinCatalogEntry('postgres'),
      {
        MITII_DB_HOST: 'localhost',
        MITII_DB_USER: 'ro',
        MITII_DB_PASSWORD: 'secret',
        MITII_DB_NAME: 'analytics',
      },
    );
    expect(postgres.env).toEqual({
      MCP_DB_ACCESS: 'readonly',
      DATABASE_URI: 'postgresql://ro:secret@localhost:5432/analytics',
    });
    expect(postgres.env?.MITII_DB_HOST).toBeUndefined();

    const mongoOverride = applyBuiltinSecrets(getBuiltinCatalogEntry('mongo'), {
      MITII_DB_HOST: 'ignored',
      MITII_DB_NAME: 'ignored',
      MCP_MONGODB_URI: 'mongodb+srv://u:p@cluster.mongodb.net/prod',
    });
    expect(mongoOverride.env?.MCP_MONGODB_URI).toBe(
      'mongodb+srv://u:p@cluster.mongodb.net/prod',
    );

    const sqlMysql = applyBuiltinSecrets(getBuiltinCatalogEntry('sql'), {
      SQL_MCP_DIALECT: 'mysql',
      MITII_DB_HOST: '127.0.0.1',
      MITII_DB_NAME: 'shop',
      MITII_DB_USER: 'app',
    });
    expect(sqlMysql.env).toEqual({
      MCP_DB_ACCESS: 'readonly',
      SQL_MCP_DIALECT: 'mysql',
      SQL_MCP_URI: 'mysql://app@127.0.0.1:3306/shop',
    });

    const sqlSqlite = applyBuiltinSecrets(getBuiltinCatalogEntry('sql'), {
      SQL_MCP_DIALECT: 'sqlite',
      MITII_DB_PATH: './data/local.db',
    });
    expect(sqlSqlite.env).toEqual({
      MCP_DB_ACCESS: 'readonly',
      SQL_MCP_DIALECT: 'sqlite',
      SQL_MCP_URI: './data/local.db',
    });
  });
});
