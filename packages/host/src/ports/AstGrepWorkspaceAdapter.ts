/**
 * Host AstGrepPort — shells `sg` / `ast-grep` when available.
 */

import { spawn } from 'node:child_process';
import { relative } from 'node:path';

import type {
  AstGrepPort,
  AstGrepSearchRequest,
  AstGrepSearchResult,
} from '@mitii/sdk';

import { resolveAstGrepBinary } from './resolveHostToolBinaries.js';

export class AstGrepWorkspaceAdapter implements AstGrepPort {
  private binary: string | null | undefined;

  constructor(private readonly options: { sgBinary?: string } = {}) {}

  public async search(
    request: AstGrepSearchRequest,
  ): Promise<AstGrepSearchResult> {
    const binary = await this.resolveBinary();
    if (!binary) {
      return {
        matches: [],
        truncated: false,
        available: false,
        warning:
          'ast-grep binary not found (install @ast-grep/cli or put sg on PATH)',
      };
    }

    const args = [
      'run',
      request.pattern,
      request.searchRoot,
      '--json=stream',
      '--globs=!.git/**',
      '--globs=!node_modules/**',
      '--globs=!.mitii/**',
    ];
    if (request.language) {
      args.push('-l', request.language);
    }

    try {
      const stdout = await run(binary, args, request);
      const matches: AstGrepSearchResult['matches'] = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line) as {
            file?: string;
            range?: { start?: { line?: number } };
            text?: string;
            lines?: string;
          };
          const abs = row.file;
          if (!abs) continue;
          const rel = relative(request.workspaceRoot, abs).replace(/\\/g, '/');
          const lineNo =
            typeof row.range?.start?.line === 'number'
              ? row.range.start.line + 1
              : 1;
          matches.push({
            path: rel,
            line: lineNo,
            text: (row.text ?? row.lines ?? '').split(/\r?\n/)[0] ?? '',
          });
          if (matches.length >= request.maxMatches) break;
        } catch {
          continue;
        }
      }
      return {
        matches,
        truncated: matches.length >= request.maxMatches,
        available: true,
      };
    } catch (error) {
      return {
        matches: [],
        truncated: false,
        available: false,
        warning: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async resolveBinary(): Promise<string | null> {
    if (this.binary !== undefined) return this.binary;

    const bundled = resolveAstGrepBinary(this.options.sgBinary);
    if (bundled) {
      try {
        await run(bundled, ['--version'], { workspaceRoot: process.cwd() });
        this.binary = bundled;
        return bundled;
      } catch {
        /* try PATH */
      }
    }

    for (const candidate of ['ast-grep', 'sg']) {
      try {
        await run(candidate, ['--version'], {
          workspaceRoot: process.cwd(),
        });
        this.binary = candidate;
        return candidate;
      } catch {
        continue;
      }
    }
    this.binary = null;
    return null;
  }
}

function run(
  command: string,
  args: string[],
  request: Pick<AstGrepSearchRequest, 'workspaceRoot' | 'signal'>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: request.workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    const onAbort = () => child.kill('SIGTERM');
    request.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (error) => {
      request.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code) => {
      request.signal?.removeEventListener('abort', onAbort);
      if (code === 0 || code === 1) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} exited ${code}`));
    });
  });
}
