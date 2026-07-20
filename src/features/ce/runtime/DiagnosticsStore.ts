/**
 * Session-scoped, timestamped record of failing verification output — persisted so the
 * exact files/errors a build reported are recoverable evidence instead of re-derived from
 * memory or narration. Keyed by session id (never a fixed filename) with `recordedAt` on
 * every entry and a per-session `latest.json` pointer, so a reader always resolves the
 * newest record for a session instead of risking a stale one from an earlier run.
 *
 * bug1.md documented two related failures this fixes: (1) a `.mitii-state.json`-style
 * diagnostic dump was blocked from being read back by the stale-artifact scope policy with
 * no way to distinguish it from a genuinely stale leftover file, and (2) without a
 * timestamped, session-keyed store there was no way to tell "the diagnostics from the build
 * I just ran" apart from an older one.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../../kernel/telemetry/Logger';
import { extractDiagnostics, type ExtractedDiagnostic } from './diagnosticFileExtractor';

const log = createLogger('DiagnosticsStore');

export interface DiagnosticsRecord {
  sessionId: string;
  recordedAt: number;
  command: string;
  capability?: string;
  exitCode?: number;
  files: string[];
  entries: ExtractedDiagnostic[];
}

export class DiagnosticsStore {
  constructor(
    private readonly workspace: string,
    private readonly sessionId: string
  ) {}

  private sessionDir(): string {
    return join(this.workspace, '.mitii', 'diagnostics', this.sessionId);
  }

  private latestPointerPath(): string {
    return join(this.sessionDir(), 'latest.json');
  }

  /** Extracts files/entries from failing command output and persists a timestamped record. */
  record(input: { command: string; output: string; capability?: string; exitCode?: number }): DiagnosticsRecord | null {
    const entries = extractDiagnostics(input.output);
    if (entries.length === 0) return null;

    const record: DiagnosticsRecord = {
      sessionId: this.sessionId,
      recordedAt: Date.now(),
      command: input.command,
      capability: input.capability,
      exitCode: input.exitCode,
      files: dedupeOrdered(entries.map((e) => e.file)),
      entries,
    };

    try {
      mkdirSync(this.sessionDir(), { recursive: true });
      const fileName = `${record.recordedAt}-${randomSuffix()}.json`;
      writeFileSync(join(this.sessionDir(), fileName), JSON.stringify(record, null, 2), 'utf-8');
      // The pointer file itself is small and rewritten on every record, so "latest" is a
      // single deterministic read instead of a directory scan + timestamp sort at read time.
      writeFileSync(this.latestPointerPath(), JSON.stringify({ file: fileName, recordedAt: record.recordedAt }), 'utf-8');
      log.info('Diagnostics recorded', { sessionId: this.sessionId, files: record.files.length, entries: entries.length });
    } catch (error) {
      log.warn('Failed to persist diagnostics record', { error: String(error) });
    }

    return record;
  }

  /** Most recent diagnostics record for this session, or null if none exists yet. */
  latest(): DiagnosticsRecord | null {
    const pointerPath = this.latestPointerPath();
    if (!existsSync(pointerPath)) return null;
    try {
      const pointer = JSON.parse(readFileSync(pointerPath, 'utf-8')) as { file: string };
      const recordPath = join(this.sessionDir(), pointer.file);
      if (!existsSync(recordPath)) return null;
      return JSON.parse(readFileSync(recordPath, 'utf-8')) as DiagnosticsRecord;
    } catch {
      return null;
    }
  }

  /** Most recent diagnostics record across all sessions in this workspace. */
  static latestAcrossSessions(workspace: string): DiagnosticsRecord | null {
    const root = join(workspace, '.mitii', 'diagnostics');
    if (!existsSync(root)) return null;

    let newest: { record: DiagnosticsRecord; recordedAt: number } | null = null;
    for (const sessionId of safeReaddir(root)) {
      const store = new DiagnosticsStore(workspace, sessionId);
      const record = store.latest();
      if (record && (!newest || record.recordedAt > newest.recordedAt)) {
        newest = { record, recordedAt: record.recordedAt };
      }
    }
    return newest?.record ?? null;
  }
}

function dedupeOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => {
      try {
        return statSync(join(dir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}
