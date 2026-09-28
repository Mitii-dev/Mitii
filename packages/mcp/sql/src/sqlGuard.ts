/**
 * SQL safety guards (Mitii style — same spirit as @mitii/mcp-postgres).
 */

export function stripSqlStrings(sql: string): string {
  return sql
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""')
    .replace(/`(?:``|[^`])*`/g, '``');
}

export function rejectMutationSql(sql: string): void {
  const normalized = sql.trim().toLowerCase();
  if (!normalized.startsWith('select') && !normalized.startsWith('with')) {
    throw new Error('Only SELECT (or WITH … SELECT) queries are allowed');
  }
  const withoutStrings = stripSqlStrings(normalized);
  if (withoutStrings.includes(';')) {
    const parts = withoutStrings
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      throw new Error('Multiple SQL statements are not allowed');
    }
  }
  for (const banned of [
    'insert ',
    'update ',
    'delete ',
    'drop ',
    'alter ',
    'create ',
    'truncate ',
    'grant ',
    'revoke ',
    'copy ',
    'call ',
    'do ',
    'replace ',
    'load ',
    'into outfile',
    'into dumpfile',
    'for update',
    'for share',
    'lock in share mode',
    'vacuum',
    'reindex',
  ]) {
    if (withoutStrings.includes(banned)) {
      throw new Error(`Disallowed SQL keyword near: ${banned.trim()}`);
    }
  }
}

export function assertDmlSql(sql: string): void {
  const normalized = sql.trim().toLowerCase();
  if (
    !normalized.startsWith('insert') &&
    !normalized.startsWith('update') &&
    !normalized.startsWith('delete') &&
    !normalized.startsWith('replace')
  ) {
    throw new Error('Only INSERT, UPDATE, DELETE, or REPLACE are allowed');
  }
  const withoutStrings = stripSqlStrings(normalized);
  if (withoutStrings.includes(';')) {
    const parts = withoutStrings
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      throw new Error('Multiple SQL statements are not allowed');
    }
  }
  for (const banned of [
    'drop ',
    'alter ',
    'create ',
    'truncate ',
    'grant ',
    'revoke ',
    'copy ',
    'call ',
    'do ',
    'vacuum',
    'reindex',
  ]) {
    if (withoutStrings.includes(banned)) {
      throw new Error(`Disallowed SQL keyword near: ${banned.trim()}`);
    }
  }
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateIdent(name: string, label: string): string {
  if (!IDENT_RE.test(name)) {
    throw new Error(`Invalid ${label}`);
  }
  return name;
}
