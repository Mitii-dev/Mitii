import { writeFileSync } from 'node:fs';

import { ReviewPipeline, FileReviewRecordStore } from '@mitii/sdk';
import { createWorkspaceReviewStore } from '@mitii/host';

import { listGitChangedFiles, ReviewGitError } from './reviewGit.js';
import { createDefaultSessionIo, type SessionIo } from './session.js';

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
  io?: SessionIo;
}

/**
 * Deterministic `mitii review` — selection/prep (and optional empty finalize).
 * Full LLM review still runs via `mitii ask` with review intent; this command
 * exposes preview/prepare/SARIF for CI and host agents.
 *
 * Exit codes: 0 success (including "nothing changed"), 1 git/output failure.
 */
export async function runReviewCommand(
  options: RunReviewCliOptions,
): Promise<{ exitCode: number; payload: unknown }> {
  const io = options.io ?? createDefaultSessionIo();
  const mode = options.mode ?? 'workspace';

  let files;
  try {
    files = await listGitChangedFiles({
      cwd: options.cwd,
      mode,
      fromRef: options.fromRef,
      toRef: options.toRef,
      commit: options.commit,
      paths: options.paths,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.writeStderr(`mitii review: ${message}\n`);
    return {
      exitCode: 1,
      payload: {
        error: {
          code:
            error instanceof ReviewGitError ? error.code : 'review_failed',
          message,
        },
      },
    };
  }

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
    return emit(options, io, pipeline.preview(input));
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
    return emit(options, io, pipeline.toSarif(result));
  }
  return emit(options, io, { prep, result });
}

function emit(
  options: RunReviewCliOptions,
  io: SessionIo,
  payload: unknown,
): { exitCode: number; payload: unknown } {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (options.output) {
    try {
      writeFileSync(options.output, text, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      io.writeStderr(`mitii review: cannot write ${options.output}: ${message}\n`);
      return { exitCode: 1, payload };
    }
  } else {
    io.writeStdout(text);
  }
  return { exitCode: 0, payload };
}
