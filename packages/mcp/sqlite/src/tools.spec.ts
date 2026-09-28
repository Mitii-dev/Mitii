import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  TOOL_DEFINITIONS,
  handleToolCall,
  rejectMutationSql,
} from './tools.js';

describe('@mitii/mcp-sqlite tools', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function createDb(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'mitii-sqlite-'));
    tempDirs.push(dir);
    const path = join(dir, 'app.db');
    const db = new Database(path);
    db.exec(
      'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users (name) VALUES (\'a\'), (\'b\');',
    );
    db.close();
    return path;
  }

  it('exposes read tools plus execute_write', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual([
      'list_tables',
      'describe_table',
      'query',
      'execute_write',
    ]);
  });

  it('rejectMutationSql blocks writes and stacked statements', () => {
    expect(() => rejectMutationSql('DELETE FROM users')).toThrow(/Only SELECT/);
    expect(() => rejectMutationSql('SELECT 1; DROP TABLE users')).toThrow(
      /Multiple SQL/,
    );
    expect(() => rejectMutationSql('SELECT * FROM users')).not.toThrow();
  });

  it('lists tables and queries rows', async () => {
    const path = await createDb();
    const env = { SQLITE_PATH: path, SQLITE_MAX_ROWS: '10' };

    const tables = await handleToolCall('list_tables', {}, env);
    expect(tables.isError).toBeUndefined();
    expect(tables.content[0]?.text).toContain('users');

    const describe = await handleToolCall(
      'describe_table',
      { table_name: 'users' },
      env,
    );
    expect(describe.isError).toBeUndefined();
    expect(describe.content[0]?.text).toContain('name');

    const query = await handleToolCall(
      'query',
      { sql: 'SELECT id, name FROM users ORDER BY id', limit: 5 },
      env,
    );
    expect(query.isError).toBeUndefined();
    const parsed = JSON.parse(query.content[0]!.text) as {
      rows: Array<{ name: string }>;
    };
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.name).toBe('a');
  });

  it('rejects mutation via query tool', async () => {
    const path = await createDb();
    const result = await handleToolCall(
      'query',
      { sql: 'DELETE FROM users' },
      { SQLITE_PATH: path },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Only SELECT/i);
  });

  it('rejects execute_write when access is readonly', async () => {
    const path = await createDb();
    const result = await handleToolCall(
      'execute_write',
      { sql: "INSERT INTO users (name) VALUES ('c')" },
      { SQLITE_PATH: path, MCP_DB_ACCESS: 'readonly' },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/readwrite/);
  });

  it('execute_write inserts when access is readwrite', async () => {
    const path = await createDb();
    const result = await handleToolCall(
      'execute_write',
      { sql: "INSERT INTO users (name) VALUES ('c')" },
      { SQLITE_PATH: path, MCP_DB_ACCESS: 'readwrite' },
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toMatch(/"changes":\s*1/);
  });

  it('requires SQLITE_PATH', async () => {
    const result = await handleToolCall('list_tables', {}, {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/SQLITE_PATH/);
  });
});
