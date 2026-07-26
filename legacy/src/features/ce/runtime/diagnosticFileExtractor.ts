/**
 * Deterministically parses failing build/typecheck/lint output for the exact files the
 * tool named, instead of leaving "which files does this error implicate" to model
 * judgment. bug1.md documented a run where the agent misdiagnosed a `manual-resume-service.ts`
 * TS2339 error as "duplicate interface declarations" across unrelated files — grounding the
 * next step's file scope in the compiler's own output prevents that class of misdiagnosis.
 */

export interface ExtractedDiagnostic {
  file: string;
  line?: number;
  column?: number;
  code?: string;
  message: string;
}

// `tsc --pretty` (default on a TTY, and what most agent shells report): file:line:col - error TSxxxx: message
const TS_PRETTY_RE = /^(\S.*?):(\d+):(\d+)\s*-\s*error\s+(TS\d+):\s*(.+)$/gm;
// `tsc` non-pretty / redirected output: file(line,col): error TSxxxx: message
const TS_COMPACT_RE = /^(\S.*?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/gm;
// ESLint stylish: a bare path line followed by "  line:col  error  message  rule"
const ESLINT_ENTRY_RE = /^\s+(\d+):(\d+)\s+error\s+(.+?)(?:\s{2,}(\S+))?$/gm;
const ESLINT_PATH_RE = /^(\/[^\s]+|[.\w][^\s:]*\.[jt]sx?)$/;

const KNOWN_SOURCE_EXTENSIONS =
  'tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|swift|rb|php|cs|cpp|cc|c|h|hpp|vue|svelte';
// Generic fallback for build tools that don't match the shapes above: "path/to/file.ext:12[:34]".
const GENERIC_FILE_LINE_RE = new RegExp(
  String.raw`([^\s'"()]+\.(?:${KNOWN_SOURCE_EXTENSIONS})):(\d+)(?::(\d+))?`,
  'g'
);

/** Parses failing verification output into the diagnostics it named, deduped by file+line+code. */
export function extractDiagnostics(output: string): ExtractedDiagnostic[] {
  if (!output) return [];
  const results: ExtractedDiagnostic[] = [];
  const seen = new Set<string>();

  const push = (d: ExtractedDiagnostic) => {
    const key = `${d.file}:${d.line ?? ''}:${d.column ?? ''}:${d.code ?? ''}:${d.message.slice(0, 80)}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(d);
  };

  for (const match of output.matchAll(TS_PRETTY_RE)) {
    push({
      file: normalizePath(match[1]),
      line: Number(match[2]),
      column: Number(match[3]),
      code: match[4],
      message: match[5].trim(),
    });
  }
  for (const match of output.matchAll(TS_COMPACT_RE)) {
    push({
      file: normalizePath(match[1]),
      line: Number(match[2]),
      column: Number(match[3]),
      code: match[4],
      message: match[5].trim(),
    });
  }

  if (results.length === 0) {
    extractEslintStylish(output, push);
  }

  if (results.length === 0) {
    for (const match of output.matchAll(GENERIC_FILE_LINE_RE)) {
      push({
        file: normalizePath(match[1]),
        line: Number(match[2]),
        column: match[3] ? Number(match[3]) : undefined,
        message: lineContaining(output, match.index ?? 0),
      });
    }
  }

  return results;
}

function extractEslintStylish(output: string, push: (d: ExtractedDiagnostic) => void): void {
  const lines = output.split('\n');
  let currentPath: string | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!line.startsWith(' ') && !line.startsWith('\t') && ESLINT_PATH_RE.test(trimmed) && trimmed.includes('.')) {
      currentPath = trimmed;
      continue;
    }
    const entry = ESLINT_ENTRY_RE.exec(line);
    ESLINT_ENTRY_RE.lastIndex = 0;
    if (entry && currentPath) {
      push({
        file: normalizePath(currentPath),
        line: Number(entry[1]),
        column: Number(entry[2]),
        code: entry[4],
        message: entry[3].trim(),
      });
    }
  }
}

function lineContaining(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? undefined : end).trim().slice(0, 200);
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Unique, order-preserving file list implicated by a failing command's output. */
export function extractDiagnosticFiles(output: string): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const diagnostic of extractDiagnostics(output)) {
    if (seen.has(diagnostic.file)) continue;
    seen.add(diagnostic.file);
    files.push(diagnostic.file);
  }
  return files;
}
