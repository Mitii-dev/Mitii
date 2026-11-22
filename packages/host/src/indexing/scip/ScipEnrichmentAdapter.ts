/**
 * Background SCIP enrichment into the existing code-index `symbol_refs` table.
 * Never blocks lexical-first publish — callers schedule this after index.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { OpenHostSqliteDatabase } from '../../sqlite/types.js';
import { INDEX_DB_FILE } from '../indexArtifactPaths.js';
import { ensureScipArtifacts } from './ensureScipArtifacts.js';
import type { ScipEnrichmentResult, ScipOccurrence } from './scipTypes.js';

export type { ScipEnrichmentResult, ScipOccurrence } from './scipTypes.js';

export class ScipEnrichmentAdapter {
  constructor(private readonly openDatabase: OpenHostSqliteDatabase) {}

  /**
   * Generate/ingest SCIP into `symbol_refs` when an index or generator is available.
   */
  public async enrichWorkspace(params: {
    workspaceRoot: string;
    workspaceId?: string;
  }): Promise<ScipEnrichmentResult> {
    const artifacts = await ensureScipArtifacts(params.workspaceRoot);
    if (artifacts.occurrences.length === 0) {
      return {
        written: 0,
        skipped: true,
        reason: 'no_scip_occurrences',
      };
    }
    return this.writeOccurrences({
      workspaceRoot: params.workspaceRoot,
      workspaceId: params.workspaceId ?? 'default',
      occurrences: artifacts.occurrences,
    });
  }

  public writeOccurrences(params: {
    workspaceRoot: string;
    workspaceId: string;
    occurrences: readonly ScipOccurrence[];
  }): ScipEnrichmentResult {
    const dbPath = join(params.workspaceRoot, '.mitii', INDEX_DB_FILE);
    if (!existsSync(dbPath)) {
      return { written: 0, skipped: true, reason: 'index_missing' };
    }

    const database = this.openDatabase(dbPath);
    try {
      ensureScipColumns(database);
      const findFile = database.prepare(
        `SELECT id FROM files WHERE workspace = ? AND rel_path = ? LIMIT 1`,
      ) as { get: (...args: unknown[]) => { id: number } | undefined };
      const insert = database.prepare(
        `INSERT INTO symbol_refs (
           file_id, symbol_name, line, reference_kind, scip_symbol, target_symbol, evidence_source
         ) VALUES (?, ?, ?, ?, ?, ?, 'scip')`,
      ) as { run: (...args: unknown[]) => void };

      let written = 0;
      for (const occ of params.occurrences) {
        const file = findFile.get(params.workspaceId, occ.relativePath);
        if (!file) continue;
        insert.run(
          file.id,
          occ.symbolName,
          occ.line,
          occ.referenceKind ?? 'unknown',
          occ.scipSymbol ?? null,
          occ.targetSymbol ?? null,
        );
        written += 1;
      }
      return { written, skipped: false };
    } catch (error) {
      return {
        written: 0,
        skipped: true,
        reason: error instanceof Error ? error.message : String(error),
      };
    } finally {
      try {
        database.close();
      } catch {
        /* ignore */
      }
    }
  }
}

/** Fire-and-forget enrichment after lexical publish. */
export function scheduleScipEnrichment(params: {
  workspaceRoot: string;
  openDatabase: OpenHostSqliteDatabase;
  workspaceId?: string;
}): void {
  const adapter = new ScipEnrichmentAdapter(params.openDatabase);
  void adapter
    .enrichWorkspace({
      workspaceRoot: params.workspaceRoot,
      workspaceId: params.workspaceId,
    })
    .catch(() => undefined);
}

function ensureScipColumns(database: {
  prepare: (sql: string) => unknown;
  exec: (sql: string) => void;
}): void {
  const alters = [
    `ALTER TABLE symbol_refs ADD COLUMN scip_symbol TEXT`,
    `ALTER TABLE symbol_refs ADD COLUMN target_symbol TEXT`,
    `ALTER TABLE symbol_refs ADD COLUMN evidence_source TEXT NOT NULL DEFAULT 'parser'`,
  ];
  for (const sql of alters) {
    try {
      database.exec(sql);
    } catch {
      /* column may already exist */
    }
  }
}

/** @deprecated Prefer ensureScipArtifacts; kept for unit tests of jsonl shape. */
export function parseScipJsonl(raw: string): ScipOccurrence[] {
  const out: ScipOccurrence[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    try {
      const row = JSON.parse(rawLine) as {
        relative_path?: string;
        path?: string;
        range?: { start?: { line?: number } };
        start_line?: number;
        symbol?: string;
        symbol_name?: string;
        enclosing_symbol?: string;
        target?: string;
        reference_kind?: string;
      };
      const relativePath = (row.relative_path ?? row.path ?? '').replace(
        /\\/g,
        '/',
      );
      const symbolName =
        row.symbol_name ??
        extractLegacySymbolName(row.symbol ?? row.enclosing_symbol ?? '');
      const startLine =
        row.start_line ??
        (typeof row.range?.start?.line === 'number'
          ? row.range.start.line + 1
          : 1);
      if (!relativePath || !symbolName) continue;
      out.push({
        relativePath,
        line: startLine,
        symbolName,
        ...(row.symbol ? { scipSymbol: row.symbol } : {}),
        ...(row.target ? { targetSymbol: row.target } : {}),
        ...(row.reference_kind ? { referenceKind: row.reference_kind } : {}),
      });
    } catch {
      continue;
    }
  }
  return out;
}

function extractLegacySymbolName(scipSymbol: string): string {
  if (!scipSymbol) return '';
  const parts = scipSymbol.split(' ');
  const last = parts[parts.length - 1] ?? '';
  return last.replace(/[().].*$/, '') || last;
}
