/**
 * Cold-path code navigation from enriched `symbol_refs` / `symbols` SQLite rows.
 * Used when LSP is cold; sits above pure RepoGraph approximation.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  CODE_NAVIGATION_OPERATIONS,
  type CodeNavigationCapability,
  type CodeNavigationDocumentQuery,
  type CodeNavigationLocation,
  type CodeNavigationPort,
  type CodeNavigationQuery,
  type CodeNavigationWorkspaceQuery,
} from '@mitii/v8';

import { INDEX_DB_FILE } from '../indexing/indexArtifactPaths.js';
import type { OpenHostSqliteDatabase } from '../sqlite/types.js';

export class SymbolRefsCodeNavigationAdapter implements CodeNavigationPort {
  public readonly id = 'symbol-refs-code-navigation';
  public readonly provider = 'repo_graph' as const;

  constructor(
    private readonly options: {
      workspaceRoot: string;
      openDatabase: OpenHostSqliteDatabase;
    },
  ) {}

  public capability(): CodeNavigationCapability {
    return {
      status: 'degraded',
      provider: 'repo_graph',
      reason: 'symbol_refs_index',
      operations: CODE_NAVIGATION_OPERATIONS,
    };
  }

  public async definition(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    const name = resolveSymbolName(input);
    if (!name) return [];
    return this.lookupSymbols(name, 20);
  }

  public async references(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    const name = resolveSymbolName(input);
    if (!name) return [];
    return this.lookupRefs(name, 40);
  }

  public async workspaceSymbols(
    input: CodeNavigationWorkspaceQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    const query = input.query.trim();
    if (!query) return [];
    return this.lookupSymbols(query, 40);
  }

  public async documentSymbols(
    input: CodeNavigationDocumentQuery,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.lookupFileSymbols(input.relativePath, 80);
  }

  private dbPath(): string | undefined {
    const path = join(this.options.workspaceRoot, '.mitii', INDEX_DB_FILE);
    return existsSync(path) ? path : undefined;
  }

  private withDb<T>(
    fn: (db: ReturnType<OpenHostSqliteDatabase>) => T,
  ): T | undefined {
    const path = this.dbPath();
    if (!path) return undefined;
    const db = this.options.openDatabase(path, { readonly: true });
    try {
      return fn(db);
    } finally {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  }

  private lookupSymbols(
    name: string,
    limit: number,
  ): CodeNavigationLocation[] {
    const rows = this.withDb((db) => {
      const stmt = db.prepare(
        `SELECT f.rel_path AS path, s.name AS name, s.start_line AS line, s.kind AS kind
         FROM symbols s
         JOIN files f ON f.id = s.file_id
         WHERE s.name LIKE ?
         ORDER BY CASE WHEN s.name = ? THEN 0 ELSE 1 END, f.rel_path, s.start_line
         LIMIT ?`,
      ) as {
        all: (
          ...args: unknown[]
        ) => Array<{ path: string; name: string; line: number; kind: string }>;
      };
      return stmt.all(`%${name}%`, name, limit);
    });
    return (rows ?? []).map((row) => ({
      relativePath: row.path,
      startLine: Number(row.line) || 1,
      symbolName: row.name,
      ...(row.kind ? { symbolKind: row.kind } : {}),
    }));
  }

  private lookupRefs(
    name: string,
    limit: number,
  ): CodeNavigationLocation[] {
    const rows = this.withDb((db) => {
      const stmt = db.prepare(
        `SELECT f.rel_path AS path, r.symbol_name AS name, r.line AS line
         FROM symbol_refs r
         JOIN files f ON f.id = r.file_id
         WHERE r.symbol_name = ? OR r.target_symbol LIKE ?
         ORDER BY CASE WHEN r.evidence_source = 'scip' THEN 0 ELSE 1 END, f.rel_path, r.line
         LIMIT ?`,
      ) as {
        all: (
          ...args: unknown[]
        ) => Array<{ path: string; name: string; line: number }>;
      };
      return stmt.all(name, `%${name}%`, limit);
    });
    return (rows ?? []).map((row) => ({
      relativePath: row.path,
      startLine: Number(row.line) || 1,
      symbolName: row.name,
    }));
  }

  private lookupFileSymbols(
    relativePath: string,
    limit: number,
  ): CodeNavigationLocation[] {
    const rows = this.withDb((db) => {
      const stmt = db.prepare(
        `SELECT f.rel_path AS path, s.name AS name, s.start_line AS line, s.kind AS kind
         FROM symbols s
         JOIN files f ON f.id = s.file_id
         WHERE f.rel_path = ?
         ORDER BY s.start_line
         LIMIT ?`,
      ) as {
        all: (
          ...args: unknown[]
        ) => Array<{ path: string; name: string; line: number; kind: string }>;
      };
      return stmt.all(relativePath, limit);
    });
    return (rows ?? []).map((row) => ({
      relativePath: row.path,
      startLine: Number(row.line) || 1,
      symbolName: row.name,
      ...(row.kind ? { symbolKind: row.kind } : {}),
    }));
  }
}

function resolveSymbolName(input: CodeNavigationQuery): string | undefined {
  if (input.symbolName?.trim()) return input.symbolName.trim();
  const basename = input.relativePath.split('/').pop() ?? '';
  const stem = basename.replace(/\.[^.]+$/, '');
  return stem || undefined;
}
