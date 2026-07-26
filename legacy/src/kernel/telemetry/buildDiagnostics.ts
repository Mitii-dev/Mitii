/**
 * Reads `.mitii/diagnostics/current-build-errors.json`, written by
 * `scripts/write-build-diagnostics.sh` via `execute_workspace_script`, so the headless/CLI
 * host can give the agent the same post-edit build-error feedback the VS Code host gets
 * for free from the language service.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface BuildErrorEntry {
  file: string;
  line: number;
  message: string;
}

interface BuildDiagnosticsFile {
  savedAt: string;
  root?: string;
  command?: string;
  exitCode?: number;
  output: string;
}

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

/** Parses TypeScript's default diagnostic format: `path/file.ts(12,5): error TS2307: message`. */
export function parseTscDiagnostics(output: string): BuildErrorEntry[] {
  const entries: BuildErrorEntry[] = [];
  const pattern = /^(.+?)\((\d+),\d+\):\s*(?:error|warning)\s+TS\d+:\s*(.+)$/gm;
  for (const match of output.matchAll(pattern)) {
    entries.push({
      file: match[1].trim().replace(/\\/g, '/'),
      line: Number(match[2]),
      message: match[3].trim(),
    });
  }
  return entries;
}

function normalizeRelPath(path: string): string {
  return path.trim().toLowerCase().replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Returns parsed build errors touching `relPath`, or `[]` if the diagnostics dump is
 * missing, unparseable, or older than `maxAgeMs` — a stale dump from a previous run or
 * task must never be trusted as current evidence for this edit.
 */
export function readBuildErrorsForFile(
  workspace: string,
  relPath: string,
  maxAgeMs = DEFAULT_MAX_AGE_MS
): BuildErrorEntry[] {
  if (!workspace || !relPath) return [];
  const filePath = join(workspace, '.mitii', 'diagnostics', 'current-build-errors.json');
  if (!existsSync(filePath)) return [];

  let parsed: BuildDiagnosticsFile;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }

  const savedAt = Date.parse(parsed.savedAt ?? '');
  if (!Number.isFinite(savedAt) || Date.now() - savedAt > maxAgeMs) return [];

  const target = normalizeRelPath(relPath);
  return parseTscDiagnostics(parsed.output ?? '').filter((entry) => {
    const entryPath = normalizeRelPath(entry.file);
    return entryPath === target || entryPath.endsWith(`/${target}`) || target.endsWith(`/${entryPath}`);
  });
}
