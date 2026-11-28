import { describe, expect, it } from 'vitest';

import {
  appendActivity,
  runEventToActivity,
} from '../src/shared/activity.js';

describe('runEventToActivity', () => {
  it('maps tool and context events', () => {
    const tool = runEventToActivity({
      type: 'tool_started',
      toolName: 'read_file',
      summary: 'path=README.md',
      at: new Date().toISOString(),
    });
    expect(tool?.kind).toBe('tool');
    expect(tool?.title).toContain('read_file');
    expect(tool?.title).toContain('path=README.md');
    expect(tool?.detail).toBe('path=README.md');

    const failed = runEventToActivity({
      type: 'tool_completed',
      toolName: 'glob_files',
      summary: 'pattern=**/*.ts',
      status: 'failed',
      reasonCode: 'path_not_found',
      at: new Date().toISOString(),
    });
    expect(failed?.title).toMatch(/^Failed glob_files/);
    expect(failed?.detail).toContain('pattern=**/*.ts');
    expect(failed?.detail).toContain('path_not_found');

    const ctx = runEventToActivity({
      type: 'context_ready',
      blockCount: 3,
      selectedItems: 2,
      at: new Date().toISOString(),
    });
    expect(ctx?.kind).toBe('context');
  });

  it('skips content model_delta (answer stream)', () => {
    expect(
      runEventToActivity({
        type: 'model_delta',
        kind: 'content',
        preview: 'hello',
        at: new Date().toISOString(),
      }),
    ).toBeNull();
  });

  it('merges consecutive thinking rows by concatenating detail', () => {
    const a = runEventToActivity({
      type: 'model_delta',
      kind: 'reasoning',
      preview: 'one',
      at: new Date().toISOString(),
    })!;
    const b = runEventToActivity({
      type: 'model_delta',
      kind: 'reasoning',
      preview: 'two',
      at: new Date().toISOString(),
    })!;
    const merged = appendActivity(appendActivity([], a), b);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.detail).toBe('onetwo');
  });
});
