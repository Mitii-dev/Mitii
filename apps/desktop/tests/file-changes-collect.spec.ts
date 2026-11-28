import { describe, expect, it } from 'vitest';

import {
  capPathsForFileChangesDisplay,
  collectAgentCausedPaths,
  collectMutatedPathsFromEvent,
  extractContinueOffer,
  isEphemeralWorkspacePath,
  isHostInternalChangePath,
  isSuccessfulProcessMutationEvent,
  parsePathsFromToolOutputPreview,
  stripContinueCtaFromAnswer,
} from '../src/shared/fileChanges.js';

describe('collectMutatedPathsFromEvent', () => {
  it('prefers outputPreview paths over truncated summary', () => {
    const paths = collectMutatedPathsFromEvent({
      type: 'tool_completed',
      toolName: 'apply_patch',
      status: 'succeeded',
      summary: 'paths=packages/checks/src/builtins/htt',
      outputPreview: JSON.stringify({
        changedFiles: [
          'packages/checks/src/builtins/http.js',
          'packages/checks/src/builtins/http.test.js',
        ],
      }),
    });
    expect(paths).toEqual([
      'packages/checks/src/builtins/http.js',
      'packages/checks/src/builtins/http.test.js',
    ]);
  });

  it('parsePathsFromToolOutputPreview reads applied[].path', () => {
    expect(
      parsePathsFromToolOutputPreview(
        JSON.stringify({
          applied: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }],
        }),
      ),
    ).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('collectAgentCausedPaths', () => {
  it('unions write paths with newly dirty and mtime-touched files', () => {
    const paths = collectAgentCausedPaths({
      writePaths: ['scripts/data/react-realworld-cases.mjs'],
      beforeDirty: [
        { path: 'cases/js/atomic/frontend/old-case/task.yaml', mtimeMs: 100 },
        {
          path: 'cases/js/atomic/frontend/autosave-draft-react/task.yaml',
          mtimeMs: 100,
        },
      ],
      afterDirty: [
        { path: 'cases/js/atomic/frontend/old-case/task.yaml', mtimeMs: 100 },
        {
          path: 'cases/js/atomic/frontend/autosave-draft-react/task.yaml',
          mtimeMs: 5000,
        },
        {
          path: 'cases/js/atomic/frontend/unsaved-changes-guard-react/task.yaml',
          mtimeMs: 5000,
        },
        { path: 'scripts/data/react-realworld-cases.mjs', mtimeMs: 5000 },
      ],
      sinceMs: 2000,
    });
    expect(paths).toContain('scripts/data/react-realworld-cases.mjs');
    expect(paths).toContain(
      'cases/js/atomic/frontend/autosave-draft-react/task.yaml',
    );
    expect(paths).toContain(
      'cases/js/atomic/frontend/unsaved-changes-guard-react/task.yaml',
    );
    expect(paths).not.toContain(
      'cases/js/atomic/frontend/old-case/task.yaml',
    );
  });

  it('ignores .mitii host internals even when newly dirty', () => {
    const paths = collectAgentCausedPaths({
      writePaths: [],
      beforeDirty: [],
      afterDirty: [
        { path: '.mitii', mtimeMs: 9000 },
        { path: '.mitii/logs/session.jsonl', mtimeMs: 9000 },
        { path: 'packages/checks/src/a.js', mtimeMs: 9000 },
      ],
      sinceMs: 1000,
    });
    expect(paths).toContain('packages/checks/src/a.js');
    expect(paths).not.toContain('.mitii');
    expect(paths.every((path) => !path.startsWith('.mitii'))).toBe(true);
  });

  it('caps display paths and reports truncation', () => {
    const many = Array.from({ length: 50 }, (_, i) => `f${i}.ts`);
    const capped = capPathsForFileChangesDisplay(many, 40);
    expect(capped.displayPaths).toHaveLength(40);
    expect(capped.totalCount).toBe(50);
    expect(capped.truncated).toBe(true);
  });
});

describe('process mutation + continue CTA helpers', () => {
  it('detects successful run_command as process mutation', () => {
    expect(
      isSuccessfulProcessMutationEvent({
        type: 'tool_completed',
        toolName: 'run_command',
        status: 'succeeded',
      }),
    ).toBe(true);
    expect(
      isSuccessfulProcessMutationEvent({
        type: 'tool_completed',
        toolName: 'run_readonly_command',
        status: 'succeeded',
      }),
    ).toBe(false);
  });

  it('strips leftover continue CTA for dedicated bar', () => {
    const text = stripContinueCtaFromAnswer(
      'Done work.\n\nWant me to start the next slice? Say **continue**.',
    );
    expect(text).toBe('Done work.');
    expect(text).not.toMatch(/continue/i);
  });

  it('extracts continue offer from prose CTA without nextAction', () => {
    const answer =
      "What's left\n\nWant me to apply this and run `pnpm case:validate` next? Say **continue**.";
    expect(extractContinueOffer(answer)).toBe(
      'Continue with the next step: Apply this and run `pnpm case:validate`',
    );
    expect(stripContinueCtaFromAnswer(answer)).toBe("What's left");
  });

  it('extracts continue offer when Say continue has a trailing clause', () => {
    const answer =
      'Want me to continue with that broader audit next? Say **continue** and I’ll apply the same cleanup.';
    expect(extractContinueOffer(answer)).toMatch(
      /^Continue with the next step: Continue with that broader audit/,
    );
    expect(stripContinueCtaFromAnswer(answer)).toBe('');
  });

  it('drops test scratch/tmp/debug paths from product file changes', () => {
    expect(isEphemeralWorkspacePath('packages/checks/test/.scratch')).toBe(
      true,
    );
    expect(
      isEphemeralWorkspacePath('packages/checks/test/.tmp-http-session'),
    ).toBe(true);
    expect(
      isHostInternalChangePath('packages/checks/test/.debug-http-session.mjs'),
    ).toBe(true);
    expect(
      isHostInternalChangePath('packages/checks/src/builtins/http.js'),
    ).toBe(false);

    const paths = collectAgentCausedPaths({
      writePaths: [
        'packages/checks/src/builtins/http.js',
        'packages/checks/test/.tmp-http-session',
        'packages/checks/test/.scratch',
      ],
      beforeDirty: [],
      afterDirty: [
        { path: 'packages/checks/test/.tmp-suite-lifecycle', mtimeMs: 9 },
      ],
      sinceMs: 1,
    });
    expect(paths).toEqual(['packages/checks/src/builtins/http.js']);
  });
});
