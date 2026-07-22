/**
 * Session-scoped, timestamped record of failing verification output — persisted so the
 * exact files/errors a build reported are recoverable evidence instead of re-derived from
 * memory or narration. Keyed by session id (never a fixed filename) with `recordedAt` on
 * every entry and a per-session `latest.json` pointer, so a reader always resolves the
 * newest record for a session instead of risking a stale one from an earlier run.
 */

import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, renameSync } from 'fs';
import { join, relative, resolve } from 'path';
import { createLogger } from '../../../kernel/telemetry/Logger';
import {
  assertSafeIdentifier,
  DIAGNOSTICS_RECORD_FILE_RE,
  safeWorkspaceChild,
} from '../../../kernel/util/safePaths';
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
  private readonly safeSessionId: string;

  constructor(
    private readonly workspace: string,
    sessionId: string
  ) {
    this.safeSessionId = assertSafeIdentifier(sessionId, 'sessionId');
  }

  private sessionDir(): string {
    return safeWorkspaceChild(
      this.workspace,
      join('.mitii', 'diagnostics', this.safeSessionId)
    );
  }

  private latestPointerPath(): string {
    return join(this.sessionDir(), 'latest.json');
  }

  /** Extracts files/entries from failing command output and persists a timestamped record. */
  record(input: { command: string; output: string; capability?: string; exitCode?: number }): DiagnosticsRecord | null {
    const entries = extractDiagnostics(input.output);
    if (entries.length === 0) return null;

    const record: DiagnosticsRecord = {
      sessionId: this.safeSessionId,
      recordedAt: Date.now(),
      command: input.command,
      capability: input.capability,
      exitCode: input.exitCode,
      files: dedupeOrdered(entries.map((e) => e.file)),
      entries,
    };

    try {
      const sessionDir = this.sessionDir();
      mkdirSync(sessionDir, { recursive: true });
      const fileName = `${record.recordedAt}-${randomUUID().replace(/-/g, '').slice(0, 6)}.json`;
      if (!DIAGNOSTICS_RECORD_FILE_RE.test(fileName)) {
        throw new Error(`Invalid diagnostics record filename: ${fileName}`);
      }
      const recordPath = join(sessionDir, fileName);
      writeFileAtomic(recordPath, JSON.stringify(record, null, 2));
      writeFileAtomic(
        this.latestPointerPath(),
        JSON.stringify({ file: fileName, recordedAt: record.recordedAt })
      );
      log.info('Diagnostics recorded', { sessionId: this.safeSessionId, files: record.files.length, entries: entries.length });
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
      const pointer = JSON.parse(readFileSync(pointerPath, 'utf-8')) as { file?: string };
      const fileName = pointer.file?.trim() ?? '';
      if (!DIAGNOSTICS_RECORD_FILE_RE.test(fileName)) return null;
      const recordPath = join(this.sessionDir(), fileName);
      if (!isPathInsideDirectory(recordPath, this.sessionDir())) return null;
      if (!existsSync(recordPath)) return null;
      return JSON.parse(readFileSync(recordPath, 'utf-8')) as DiagnosticsRecord;
    } catch {
      return null;
    }
  }

  /** Most recent diagnostics record across all sessions in this workspace. */
  static latestAcrossSessions(workspace: string): DiagnosticsRecord | null {
    const root = safeWorkspaceChild(workspace, join('.mitii', 'diagnostics'));
    if (!existsSync(root)) return null;

    let newest: { record: DiagnosticsRecord; recordedAt: number } | null = null;
    for (const sessionId of safeReaddir(root)) {
      try {
        assertSafeIdentifier(sessionId, 'sessionId');
      } catch {
        continue;
      }
      const store = new DiagnosticsStore(workspace, sessionId);
      const record = store.latest();
      if (record && (!newest || record.recordedAt > newest.recordedAt)) {
        newest = { record, recordedAt: record.recordedAt };
      }
    }
    return newest?.record ?? null;
  }
}

function writeFileAtomic(path: string, content: string): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content, 'utf-8');
  renameSync(temporary, path);
}

function isPathInsideDirectory(candidate: string, directory: string): boolean {
  const rel = relative(resolve(directory), resolve(candidate)).replace(/\\/g, '/');
  return Boolean(rel && !rel.startsWith('..'));
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
