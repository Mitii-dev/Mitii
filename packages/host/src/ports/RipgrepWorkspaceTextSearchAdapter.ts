/**
 * Ripgrep-backed WorkspaceTextSearchPort with filesystem fallback.
 */

import { spawn } from 'node:child_process';
import { relative } from 'node:path';

import {
  FileSystemWorkspaceTextSearchAdapter,
  type WorkspaceFileSystemPort,
  type WorkspaceTextSearchPort,
  type WorkspaceTextSearchRequest,
  type WorkspaceTextSearchResult,
} from '@mitii/sdk';

import { resolveRipgrepBinary } from './resolveHostToolBinaries.js';

export class RipgrepWorkspaceTextSearchAdapter
  implements WorkspaceTextSearchPort
{
  private readonly filesystemFallback: FileSystemWorkspaceTextSearchAdapter;
  private rgAvailable: boolean | undefined;
  private resolvedBinary: string | undefined;

  constructor(
    fileSystem: WorkspaceFileSystemPort,
    private readonly options: { rgBinary?: string } = {},
  ) {
    this.filesystemFallback = new FileSystemWorkspaceTextSearchAdapter(
      fileSystem,
    );
  }

  public async search(
    request: WorkspaceTextSearchRequest,
  ): Promise<WorkspaceTextSearchResult> {
    if (this.rgAvailable === false) {
      return this.filesystemFallback.search(request);
    }

    try {
      const result = await this.runRipgrep(request);
      this.rgAvailable = true;
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/ENOENT|not found|spawn/i.test(message) || this.rgAvailable !== true) {
        this.rgAvailable = false;
      }
      const fallback = await this.filesystemFallback.search(request);
      return {
        ...fallback,
        warning:
          fallback.warning ??
          'ripgrep unavailable; used filesystem search fallback.',
      };
    }
  }

  private runRipgrep(
    request: WorkspaceTextSearchRequest,
  ): Promise<WorkspaceTextSearchResult> {
    const binary =
      this.resolvedBinary ??
      (this.resolvedBinary = resolveRipgrepBinary(this.options.rgBinary));
    const args = [
      '--json',
      '--line-number',
      '--no-heading',
      '--color',
      'never',
      '--max-count',
      String(request.maxMatches),
      '--glob',
      '!.git/**',
      '--glob',
      '!node_modules/**',
      '--glob',
      '!.mitii/**',
    ];
    if (!request.caseSensitive) args.push('-i');
    if (request.mode === 'literal') args.push('-F');
    args.push('--', request.query, request.searchRoot);

    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, {
        cwd: request.workspaceRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      const onAbort = () => {
        child.kill('SIGTERM');
      };
      request.signal?.addEventListener('abort', onAbort, { once: true });

      child.on('error', (error) => {
        request.signal?.removeEventListener('abort', onAbort);
        reject(error);
      });
      child.on('close', (code) => {
        request.signal?.removeEventListener('abort', onAbort);
        // rg exits 1 when no matches; 2 on error.
        if (code !== 0 && code !== 1) {
          reject(new Error(stderr.trim() || `rg exited ${code}`));
          return;
        }
        const matches: WorkspaceTextSearchResult['matches'] = [];
        for (const line of stdout.split(/\r?\n/)) {
          if (!line) continue;
          let parsed: {
            type?: string;
            data?: {
              path?: { text?: string };
              line_number?: number;
              lines?: { text?: string };
            };
          };
          try {
            parsed = JSON.parse(line) as typeof parsed;
          } catch {
            continue;
          }
          if (parsed.type !== 'match' || !parsed.data) continue;
          const absPath = parsed.data.path?.text;
          const lineNumber = parsed.data.line_number;
          const text = parsed.data.lines?.text?.replace(/\r?\n$/, '') ?? '';
          if (!absPath || lineNumber === undefined) continue;
          const rel = relative(request.workspaceRoot, absPath).replace(
            /\\/g,
            '/',
          );
          if (!isPathWithinGrant(rel, request.pathScopes)) continue;
          matches.push({ path: rel, line: lineNumber, text });
          if (matches.length >= request.maxMatches) break;
        }
        resolve({
          matches,
          truncated: matches.length >= request.maxMatches,
          backend: 'ripgrep',
        });
      });
    });
  }
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
