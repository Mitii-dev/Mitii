import { spawn } from 'node:child_process';
import { relative, resolve } from 'node:path';

import type { DiagnosticItem, DiagnosticsPort } from '@mitii/v8';

const JS_MODULE_RE = /\.(js|mjs|cjs)$/i;
const MAX_PATHS = 16;
const LOAD_TIMEOUT_MS = 8_000;

/**
 * Lightweight CLI diagnostics for plain Node JS/CJS/MJS files when no
 * TypeScript language service is available.
 *
 * Instantiates each module via `node --import` (with MITII_NO_LISTEN=1) and
 * maps instantiate/runtime failures to error diagnostics. Does not replace a
 * real language server for TypeScript.
 */
export function createNodeJsDiagnosticsPort(options: {
  workspaceRoot: string;
}): DiagnosticsPort {
  const workspaceRoot = resolve(options.workspaceRoot);

  return {
    async readDiagnostics(params: {
      workspaceRoot: string;
      paths?: readonly string[];
    }): Promise<DiagnosticItem[]> {
      const root = resolve(params.workspaceRoot || workspaceRoot);
      const paths = (params.paths ?? [])
        .map((p) => normalizeWorkspacePath(root, p))
        .filter((p) => JS_MODULE_RE.test(p))
        .slice(0, MAX_PATHS);
      if (paths.length === 0) {
        return [];
      }

      const findings: DiagnosticItem[] = [];
      for (const path of paths) {
        const error = await loadModuleError(root, path);
        if (!error) continue;
        findings.push({
          path,
          severity: 'error',
          message: error.message,
          startLine: error.line,
          startColumn: error.column,
          source: 'node-module-load',
          code: error.code,
        });
      }
      return findings;
    },
  };
}

function normalizeWorkspacePath(workspaceRoot: string, path: string): string {
  const absolute = resolve(workspaceRoot, path);
  const rel = relative(workspaceRoot, absolute).replace(/\\/g, '/');
  return rel.startsWith('..') ? path.replace(/\\/g, '/') : rel;
}

async function loadModuleError(
  workspaceRoot: string,
  relativePath: string,
): Promise<{ message: string; line?: number; column?: number; code?: string } | undefined> {
  const result = await runNodeImport(workspaceRoot, relativePath);
  if (result.exitCode === 0) {
    return undefined;
  }
  const text = `${result.stderr}\n${result.stdout}`.trim();
  if (!text) {
    return {
      message: `Module failed to load (exit ${result.exitCode ?? 'unknown'}).`,
      code: 'module_load_failed',
    };
  }
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const errorLine =
    lines.find((l) =>
      /^(SyntaxError|TypeError|ReferenceError|Error)\b/.test(l),
    ) ??
    lines.find((l) => /Duplicate export|Cannot find module|ERR_/.test(l)) ??
    lines.find((l) => !l.startsWith('node:internal/') && !l.startsWith('at ')) ??
    lines[0] ??
    text;
  const fileLineMatch = text.match(/:(\d+)(?::\d+)?\n/);
  const line = fileLineMatch ? Number(fileLineMatch[1]) : undefined;
  const codeMatch = errorLine.match(
    /^(SyntaxError|TypeError|ReferenceError|Error)\b/,
  );
  return {
    message: errorLine.slice(0, 500),
    line: Number.isFinite(line) ? line : undefined,
    column: 1,
    code: codeMatch?.[1] ?? 'module_load_failed',
  };
}

function runNodeImport(
  workspaceRoot: string,
  relativePath: string,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const importSpec =
      relativePath.startsWith('./') ||
      relativePath.startsWith('../') ||
      relativePath.startsWith('/')
        ? relativePath
        : `./${relativePath}`;
    const child = spawn(
      process.execPath,
      ['--import', importSpec, '-e', 'void 0'],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          MITII_NO_LISTEN: process.env.MITII_NO_LISTEN?.trim() || '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, LOAD_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk);
      if (stdout.length > 8_000) stdout = stdout.slice(0, 8_000);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk);
      if (stderr.length > 8_000) stderr = stderr.slice(0, 8_000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: 1,
        stdout,
        stderr: err.message,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: code,
        stdout,
        stderr,
      });
    });
  });
}
