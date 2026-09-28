import { describe, expect, it } from 'vitest';

import { resolveDbAccessMode } from './access.js';
import {
  inferDialectFromUri,
  pickConnection,
  resolveConnectionProfiles,
} from './connections.js';
import { wrapSelectWithLimit } from './dialect.js';
import { assertDmlSql, rejectMutationSql } from './sqlGuard.js';
import { listToolDefinitions } from './tools.js';

describe('@mitii/mcp-sql', () => {
  it('infers dialects from URIs', () => {
    expect(inferDialectFromUri('postgresql://localhost/db')).toBe('postgresql');
    expect(inferDialectFromUri('postgres://localhost/db')).toBe('postgresql');
    expect(inferDialectFromUri('mysql://localhost/db')).toBe('mysql');
    expect(inferDialectFromUri('mariadb://localhost/db')).toBe('mariadb');
    expect(inferDialectFromUri('sqlite:/tmp/app.db')).toBe('sqlite');
    expect(inferDialectFromUri('/tmp/app.db')).toBe('sqlite');
  });

  it('resolves single and multi connection profiles', () => {
    const single = resolveConnectionProfiles({
      SQL_MCP_URI: 'postgresql://u:p@localhost:5432/app',
    });
    expect(single).toEqual([
      {
        name: 'default',
        uri: 'postgresql://u:p@localhost:5432/app',
        dialect: 'postgresql',
      },
    ]);

    const multi = resolveConnectionProfiles({
      SQL_MCP_CONNECTIONS: JSON.stringify([
        { name: 'pg', uri: 'postgresql://localhost/a' },
        { name: 'my', uri: 'mysql://localhost/b', dialect: 'mysql' },
      ]),
    });
    expect(multi.map((p) => p.name)).toEqual(['pg', 'my']);
    expect(pickConnection(multi, 'my').dialect).toBe('mysql');
  });

  it('gates write tools behind MCP_DB_ACCESS', () => {
    expect(resolveDbAccessMode({ MCP_DB_ACCESS: 'readonly' })).toBe('readonly');
    expect(resolveDbAccessMode({ MCP_DB_ACCESS: 'readwrite' })).toBe('readwrite');
    const readNames = listToolDefinitions('readonly').map((t) => t.name);
    const writeNames = listToolDefinitions('readwrite').map((t) => t.name);
    expect(readNames).toContain('query');
    expect(readNames).toContain('explain_query');
    expect(readNames).toContain('list_foreign_keys');
    expect(readNames).toContain('sample_rows');
    expect(readNames).not.toContain('execute_write');
    expect(writeNames).toContain('execute_write');
  });

  it('rejects mutating SELECT paths and multi-statements', () => {
    expect(() => rejectMutationSql('DELETE FROM users')).toThrow(/SELECT/);
    expect(() =>
      rejectMutationSql("SELECT * FROM t WHERE x = 'DELETE'"),
    ).not.toThrow();
    expect(() =>
      rejectMutationSql('SELECT 1; SELECT 2'),
    ).toThrow(/Multiple/);
    expect(() => rejectMutationSql('SELECT * FROM t FOR UPDATE')).toThrow(
      /for update/i,
    );
  });

  it('allows DML only for execute_write path', () => {
    expect(() => assertDmlSql('INSERT INTO t VALUES (1)')).not.toThrow();
    expect(() => assertDmlSql('DROP TABLE t')).toThrow(/INSERT/);
    expect(() => assertDmlSql('UPDATE t SET a=1; DELETE FROM t')).toThrow(
      /Multiple/,
    );
  });

  it('wraps selects with a dialect limit subquery', () => {
    expect(wrapSelectWithLimit('postgresql', 'SELECT 1', 5)).toContain(
      'LIMIT 5',
    );
    expect(wrapSelectWithLimit('mysql', 'SELECT id FROM users;', 10)).toMatch(
      /mitii_q LIMIT 10/,
    );
  });
});
