import { describe, expect, it } from 'vitest';

import {
  TOOL_DEFINITIONS,
  rejectMutationSql,
  resolveDatabaseUri,
} from './tools.js';

describe('@mitii/mcp-postgres-readonly tools', () => {
  it('exposes list_tables, describe_table, query', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual([
      'list_tables',
      'describe_table',
      'query',
    ]);
  });

  it('rejectMutationSql blocks writes', () => {
    expect(() => rejectMutationSql('DELETE FROM users')).toThrow(/Only SELECT/);
    expect(() => rejectMutationSql('SELECT 1; DROP TABLE users')).toThrow(
      /Multiple SQL/,
    );
    expect(() => rejectMutationSql('SELECT * FROM users')).not.toThrow();
  });

  it('resolveDatabaseUri validates URI', () => {
    expect(() => resolveDatabaseUri({})).toThrow(/DATABASE_URI/);
    expect(() =>
      resolveDatabaseUri({ DATABASE_URI: 'mysql://x' }),
    ).toThrow(/postgres/);
    expect(
      resolveDatabaseUri({
        DATABASE_URI: 'postgresql://localhost/db',
      }),
    ).toBe('postgresql://localhost/db');
  });
});
