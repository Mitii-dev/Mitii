/**
 * Prefer fresh FTS for simple literal queries; otherwise ripgrep (+ FS fallback).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type {
  WorkspaceTextSearchPort,
  WorkspaceTextSearchRequest,
  WorkspaceTextSearchResult,
} from '@mitii/sdk';

import { INDEX_DB_FILE } from '../indexing/indexArtifactPaths.js';
import type { OpenHostSqliteDatabase } from '../sqlite/types.js';

export class CompositeWorkspaceTextSearchAdapter
  implements WorkspaceTextSearchPort
{
  constructor(
    private readonly primary: WorkspaceTextSearchPort,
    private readonly options: {
      openDatabase?: OpenHostSqliteDatabase;
    } = {},
  ) {}

  public async search(
    request: WorkspaceTextSearchRequest,
  ): Promise<WorkspaceTextSearchResult> {
    if (request.mode === 'literal' && this.options.openDatabase) {
      const fts = this.tryFts(request);
      if (fts && fts.matches.length > 0) {
        return fts;
      }
    }
    return this.primary.search(request);
  }

  private tryFts(
    request: WorkspaceTextSearchRequest,
  ): WorkspaceTextSearchResult | undefined {
    const dbPath = join(request.workspaceRoot, '.mitii', INDEX_DB_FILE);
    if (!existsSync(dbPath)) return undefined;

    let database: {
      prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] };
      close?: () => void;
    };
    try {
      if (this.options.openDatabase) {
        database = this.options.openDatabase(dbPath, {
          readonly: true,
        }) as typeof database;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Database = require('better-sqlite3') as new (
          path: string,
          options?: { readonly?: boolean; fileMustExist?: boolean },
        ) => typeof database;
        database = new Database(dbPath, {
          readonly: true,
          fileMustExist: true,
        });
      }
    } catch {
      return undefined;
    }

    try {
      const token = sanitizeFtsQuery(request.query);
      if (!token) return undefined;

      const likePrefix = request.searchRootRelative
        .replace(/\\/g, '/')
        .replace(/\*$/, '');
      const rows = database
        .prepare(
          `
          SELECT c.relative_path AS path, c.start_line AS line,
                 substr(c.content, 1, 500) AS text
          FROM text_index_fts f
          JOIN text_index_chunks c
            ON c.workspace = f.workspace AND c.id = f.chunk_id
          WHERE text_index_fts MATCH ?
            AND (? = '' OR c.relative_path = ? OR c.relative_path LIKE ?)
          LIMIT ?
          `,
        )
        .all(
          token,
          likePrefix === '.' ? '' : likePrefix,
          likePrefix,
          `${likePrefix}/%`,
          request.maxMatches,
        ) as Array<{ path: string; line: number; text: string }>;

      const matches = rows
        .filter((row) => isPathWithinGrant(row.path, request.pathScopes))
        .map((row) => ({
          path: row.path,
          line: Number(row.line) || 1,
          text: String(row.text ?? '').split(/\r?\n/)[0] ?? '',
        }));

      if (matches.length === 0) return undefined;
      return {
        matches,
        truncated: matches.length >= request.maxMatches,
        backend: 'fts',
      };
    } catch {
      return undefined;
    } finally {
      try {
        database.close?.();
      } catch {
        /* ignore */
      }
    }
  }
}

function sanitizeFtsQuery(query: string): string | undefined {
  const cleaned = query
    .replace(/["'*:(){}[\]^~]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((part) => `"${part}"`)
    .join(' ');
  return cleaned.length > 0 ? cleaned : undefined;
}

function isPathWithinGrant(
  relativePath: string,
  pathScopes: readonly string[],
): boolean {
  if (pathScopes.includes('.')) return true;
  return pathScopes.some(
    (scope) =>
      relativePath === scope || relativePath.startsWith(`${scope}/`),
  );
}
