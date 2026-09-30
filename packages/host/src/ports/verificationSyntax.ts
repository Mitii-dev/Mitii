import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  TreeSitterRuntimePort,
  VerificationSyntaxFinding,
  VerificationSyntaxPort,
} from '@mitii/v8';

import { createDefaultTreeSitterRuntime } from '../indexing/treeSitter/createDefaultTreeSitterRuntime.js';

const MAX_FILES = 40;
const MAX_FINDINGS = 80;

/** Extension → tree-sitter WASM grammar key (must match WebTreeSitterRuntime). */
const EXTENSION_TO_GRAMMAR: Readonly<Record<string, string>> = {
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.dart': 'dart',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.go': 'go',
  '.hs': 'haskell',
  '.java': 'java',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.lua': 'lua',
  '.php': 'php',
  '.py': 'python',
  '.pyi': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.scala': 'scala',
  '.sc': 'scala',
  '.sh': 'shell',
  '.bash': 'shell',
  '.sol': 'solidity',
  '.sql': 'sql',
  '.swift': 'swift',
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.zig': 'zig',
};

/**
 * Host VerificationSyntaxPort backed by TreeSitterRuntimePort.
 * Reads workspace files and reports ERROR / missing-node findings.
 */
export function createTreeSitterVerificationSyntaxPort(options: {
  runtime: TreeSitterRuntimePort;
}): VerificationSyntaxPort {
  return {
    async checkFiles(params) {
      const warnings: string[] = [];
      const findings: VerificationSyntaxFinding[] = [];
      const paths = params.paths
        .map(normalizeRelative)
        .filter((path) => path.length > 0 && !path.endsWith('/'))
        .slice(0, MAX_FILES);

      for (const relativePath of paths) {
        if (params.signal?.aborted) {
          break;
        }
        if (findings.length >= MAX_FINDINGS) {
          warnings.push(`Syntax check capped at ${MAX_FINDINGS} findings.`);
          break;
        }

        const language = grammarForPath(relativePath);
        if (!language || !options.runtime.supports(language)) {
          continue;
        }

        let content: string;
        try {
          content = await readFile(
            join(params.workspaceRoot, relativePath),
            'utf8',
          );
        } catch {
          warnings.push(`Could not read "${relativePath}" for syntax check.`);
          continue;
        }

        try {
          const parsed = await options.runtime.parse({
            language,
            relativePath,
            content,
            maximumSymbols: 0,
            maximumImports: 0,
            maximumReferences: 0,
            abortSignal: params.signal,
          });
          for (const error of parsed.syntaxErrors ?? []) {
            if (findings.length >= MAX_FINDINGS) {
              break;
            }
            findings.push({
              path: relativePath,
              startLine: error.startLine,
              startColumn: error.startColumn,
              endLine: error.endLine,
              endColumn: error.endColumn,
              message: error.message,
            });
          }
          for (const warning of parsed.warnings ?? []) {
            warnings.push(`${relativePath}: ${warning}`);
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          warnings.push(
            `Syntax parse failed for "${relativePath}": ${message}`,
          );
        }
      }

      return { findings, warnings };
    },
  };
}

/** Resolve default tree-sitter runtime into an optional VerificationSyntaxPort. */
export async function createOptionalVerificationSyntaxPort(): Promise<
  VerificationSyntaxPort | undefined
> {
  const runtime = await createDefaultTreeSitterRuntime();
  if (!runtime) {
    return undefined;
  }
  return createTreeSitterVerificationSyntaxPort({ runtime });
}

function normalizeRelative(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function grammarForPath(relativePath: string): string | undefined {
  const basename = relativePath.split('/').pop()?.toLowerCase() ?? '';
  const dot = basename.lastIndexOf('.');
  if (dot < 0) {
    return undefined;
  }
  return EXTENSION_TO_GRAMMAR[basename.slice(dot)];
}
