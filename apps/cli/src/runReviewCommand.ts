import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';

import {
  ReviewPipeline,
  FileReviewRecordStore,
  type ReviewChangedFile,
} from '@mitii/sdk';
import { createWorkspaceReviewStore } from '@mitii/host';

const execFileAsync = promisify(execFile);

export interface RunReviewCliOptions {
  cwd: string;
  mode?: 'workspace' | 'range' | 'commit' | 'scan';
  fromRef?: string;
  toRef?: string;
  commit?: string;
  preview?: boolean;
  format?: 'json' | 'sarif';
  output?: string;
  effort?: 'low' | 'medium' | 'high';
  paths?: string[];
  background?: string;
}

/**
 * Deterministic `mitii review` — selection/prep (and optional empty finalize).
 * Full LLM review still runs via `mitii ask` with review intent; this command
 * exposes preview/prepare/SARIF for CI and host agents.
 */
export async function runReviewCommand(
  options: RunReviewCliOptions,
): Promise<{ exitCode: number; payload: unknown }> {
  const mode = options.mode ?? 'workspace';
  const files = await listGitChangedFiles({
    cwd: options.cwd,
    mode,
    fromRef: options.fromRef,
    toRef: options.toRef,
    commit: options.commit,
    paths: options.paths,
  });

  const store = createWorkspaceReviewStore(options.cwd) as FileReviewRecordStore;
  const pipeline = new ReviewPipeline({
    records: store,
    idGenerator: () => `cli_${Date.now().toString(36)}`,
  });

  const input = {
    schemaVersion: 1 as const,
    workspaceId: options.cwd,
    workspaceRoot: options.cwd,
    mode,
    fromRef: options.fromRef,
    toRef: options.toRef,
    commit: options.commit,
    effort: options.effort ?? 'medium',
    files,
    background: options.background,
  };

  if (options.preview) {
    const preview = pipeline.preview(input);
    return emit(options, preview, 0);
  }

  const prep = pipeline.prepare(input);
  // Without an LLM loop, finalize with zero findings yields a durable prep record.
  const result = await pipeline.finalize({
    input,
    prep,
    findings: [],
    persist: true,
  });

  if (options.format === 'sarif') {
    return emit(options, pipeline.toSarif(result), result.selectedCount === 0 ? 0 : 0);
  }

  return emit(
    options,
    {
      prep,
      result,
    },
    0,
  );
}

function emit(
  options: RunReviewCliOptions,
  payload: unknown,
  exitCode: number,
): { exitCode: number; payload: unknown } {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (options.output) {
    writeFileSync(options.output, text, 'utf8');
  } else {
    process.stdout.write(text);
  }
  return { exitCode, payload };
}

async function listGitChangedFiles(params: {
  cwd: string;
  mode: 'workspace' | 'range' | 'commit' | 'scan';
  fromRef?: string;
  toRef?: string;
  commit?: string;
  paths?: string[];
}): Promise<ReviewChangedFile[]> {
  if (params.mode === 'scan') {
    // Scan mode expects hosts to pass paths; empty means nothing to review.
    return (params.paths ?? []).map((path) => ({
      path,
      diff: '',
      content: undefined,
      insertions: 0,
      deletions: 0,
      isBinary: false,
      isDeleted: false,
      status: 'unknown' as const,
    }));
  }

  try {
    let args: string[];
    if (params.mode === 'commit' && params.commit) {
      args = ['show', '--name-status', '--format=', params.commit];
    } else if (params.mode === 'range' && params.fromRef && params.toRef) {
      args = ['diff', '--name-status', `${params.fromRef}...${params.toRef}`];
    } else {
      args = ['status', '--porcelain', '-uall'];
    }

    const { stdout: nameStatus } = await execFileAsync('git', args, {
      cwd: params.cwd,
      maxBuffer: 8 * 1024 * 1024,
    });

    const paths = parseNameStatus(nameStatus, params.mode);
    const filtered = params.paths?.length
      ? paths.filter((p) => params.paths!.includes(p.path))
      : paths;

    const files: ReviewChangedFile[] = [];
    for (const entry of filtered) {
      let diff = '';
      try {
        if (params.mode === 'commit' && params.commit) {
          const r = await execFileAsync(
            'git',
            ['show', params.commit, '--', entry.path],
            { cwd: params.cwd, maxBuffer: 8 * 1024 * 1024 },
          );
          diff = r.stdout;
        } else if (params.mode === 'range' && params.fromRef && params.toRef) {
          const r = await execFileAsync(
            'git',
            ['diff', `${params.fromRef}...${params.toRef}`, '--', entry.path],
            { cwd: params.cwd, maxBuffer: 8 * 1024 * 1024 },
          );
          diff = r.stdout;
        } else {
          const r = await execFileAsync(
            'git',
            ['diff', 'HEAD', '--', entry.path],
            { cwd: params.cwd, maxBuffer: 8 * 1024 * 1024 },
          );
          diff = r.stdout;
          if (!diff) {
            // Untracked: empty diff — treat whole file as added when readable later
            diff = '';
          }
        }
      } catch {
        diff = '';
      }
      const insertions = (diff.match(/^\+[^+]/gm) ?? []).length;
      const deletions = (diff.match(/^-[^-]/gm) ?? []).length;
      files.push({
        path: entry.path,
        diff,
        insertions,
        deletions,
        isBinary: false,
        isDeleted: entry.status === 'deleted',
        status: entry.status,
      });
    }
    return files;
  } catch {
    return [];
  }
}

function parseNameStatus(
  text: string,
  mode: string,
): Array<{ path: string; status: ReviewChangedFile['status'] }> {
  const lines = text.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const out: Array<{ path: string; status: ReviewChangedFile['status'] }> = [];
  for (const line of lines) {
    if (mode === 'workspace' || line.match(/^[ MADRCU?!]/)) {
      // porcelain: XY PATH or XY ORIG -> PATH
      if (/^[ MADRCU?!]{1,2}\s/.test(line) || line.startsWith('?')) {
        const path = line.replace(/^..\s+/, '').replace(/^.* -> /, '').trim();
        if (!path) continue;
        const code = line.slice(0, 2);
        out.push({
          path,
          status: code.includes('D')
            ? 'deleted'
            : code.includes('A') || code.includes('?')
              ? 'added'
              : 'modified',
        });
        continue;
      }
    }
    const parts = line.split(/\t+/);
    if (parts.length >= 2) {
      const code = parts[0]!;
      const path = parts[parts.length - 1]!;
      out.push({
        path,
        status:
          code.startsWith('D')
            ? 'deleted'
            : code.startsWith('A')
              ? 'added'
              : code.startsWith('R')
                ? 'renamed'
                : 'modified',
      });
    }
  }
  return out;
}
