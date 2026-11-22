/**
 * Ensure `.mitii/scip/index.scip` (+ jsonl) exist by generating when possible.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import {
  hasTsOrJsProject,
  resolveScipTypescriptBinary,
  scipIndexPaths,
} from '../../ports/resolveHostToolBinaries.js';
import {
  extractScipSymbolName,
  parseScipIndexBinary,
} from './parseScipIndexBinary.js';
import type { ScipOccurrence } from './scipTypes.js';

export interface EnsureScipArtifactsResult {
  occurrences: ScipOccurrence[];
  source: 'jsonl' | 'scip_binary' | 'generated' | 'none';
  scipPath?: string;
  jsonlPath?: string;
}

/**
 * Load SCIP occurrences for a workspace, generating an index when missing.
 */
export async function ensureScipArtifacts(
  workspaceRoot: string,
): Promise<EnsureScipArtifactsResult> {
  const paths = scipIndexPaths(workspaceRoot);

  if (existsSync(paths.jsonl)) {
    const occurrences = parseScipJsonlFile(paths.jsonl);
    if (occurrences.length > 0) {
      return {
        occurrences,
        source: 'jsonl',
        jsonlPath: paths.jsonl,
        ...(existsSync(paths.scip) ? { scipPath: paths.scip } : {}),
      };
    }
  }

  for (const scipPath of [paths.scip, paths.workspaceScip]) {
    if (!existsSync(scipPath)) continue;
    let occurrences = await decodeScipFile(scipPath);
    if (occurrences.length === 0) {
      occurrences = await decodeScipViaCli(scipPath, workspaceRoot);
    }
    if (occurrences.length > 0) {
      writeJsonl(paths, occurrences);
      return {
        occurrences,
        source: 'scip_binary',
        scipPath,
        jsonlPath: paths.jsonl,
      };
    }
  }

  if (!hasTsOrJsProject(workspaceRoot)) {
    return { occurrences: [], source: 'none' };
  }

  const generated = await generateScipIndex(workspaceRoot, paths.scip);
  if (!generated) {
    return { occurrences: [], source: 'none' };
  }

  let occurrences = await decodeScipFile(paths.scip);
  if (occurrences.length === 0) {
    occurrences = await decodeScipViaCli(paths.scip, workspaceRoot);
  }
  if (occurrences.length === 0) {
    return {
      occurrences: [],
      source: 'generated',
      scipPath: paths.scip,
    };
  }
  writeJsonl(paths, occurrences);
  return {
    occurrences,
    source: 'generated',
    scipPath: paths.scip,
    jsonlPath: paths.jsonl,
  };
}

async function generateScipIndex(
  workspaceRoot: string,
  outputPath: string,
): Promise<boolean> {
  const candidates = [
    resolveScipTypescriptBinary(),
    'scip-typescript',
  ].filter((value): value is string => Boolean(value));
  if (candidates.length === 0) return false;

  mkdirSync(join(workspaceRoot, '.mitii', 'scip'), { recursive: true });

  const hasTsconfig =
    existsSync(join(workspaceRoot, 'tsconfig.json')) ||
    existsSync(join(workspaceRoot, 'jsconfig.json'));

  const args = ['index', '--cwd', workspaceRoot, '--output', outputPath];
  if (!hasTsconfig) {
    args.push('--infer-tsconfig');
  }
  if (existsSync(join(workspaceRoot, 'pnpm-workspace.yaml'))) {
    args.push('--pnpm-workspaces');
  }

  for (const binary of candidates) {
    try {
      await runCommand(binary, args, workspaceRoot, 10 * 60_000);
      if (existsSync(outputPath)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function decodeScipFile(scipPath: string): Promise<ScipOccurrence[]> {
  try {
    const bytes = new Uint8Array(readFileSync(scipPath));
    const fromBinary = await parseScipIndexBinary(bytes);
    if (fromBinary.length > 0) return fromBinary;
  } catch {
    /* fall through */
  }
  return [];
}

/** Best-effort: PATH `scip print --json` when protobuf decode is unavailable. */
export async function decodeScipViaCli(
  scipPath: string,
  cwd: string,
): Promise<ScipOccurrence[]> {
  try {
    const raw = await runCommand(
      'scip',
      ['print', '--json', scipPath],
      cwd,
      120_000,
    );
    return parseScipJsonlFileContent(raw);
  } catch {
    return [];
  }
}

function parseScipJsonlFile(jsonlPath: string): ScipOccurrence[] {
  return parseScipJsonlFileContent(readFileSync(jsonlPath, 'utf8'));
}

function parseScipJsonlFileContent(raw: string): ScipOccurrence[] {
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
        extractScipSymbolName(row.symbol ?? row.enclosing_symbol ?? '');
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

function writeJsonl(
  paths: ReturnType<typeof scipIndexPaths>,
  occurrences: readonly ScipOccurrence[],
): void {
  try {
    mkdirSync(paths.dir, { recursive: true });
    const lines = occurrences.map((occ) =>
      JSON.stringify({
        relative_path: occ.relativePath,
        start_line: occ.line,
        symbol_name: occ.symbolName,
        ...(occ.scipSymbol ? { symbol: occ.scipSymbol } : {}),
        ...(occ.targetSymbol ? { target: occ.targetSymbol } : {}),
        ...(occ.referenceKind ? { reference_kind: occ.referenceKind } : {}),
      }),
    );
    writeFileSync(paths.jsonl, `${lines.join('\n')}\n`, 'utf8');
  } catch {
    /* best-effort cache */
  }
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: undefined },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${command} exited ${code}`));
    });
  });
}
