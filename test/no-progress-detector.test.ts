import { describe, it, expect } from 'vitest';
import { fingerprintToolCall, evaluateNoProgress } from '../src/features/ce/pipeline/loop/noProgressDetector';

describe('fingerprintToolCall', () => {
  it('collapses different package-manager wrappers around the same tsc invocation', () => {
    const variants = [
      'npx tsc --noEmit',
      'npx tsc --noEmit | head',
      'npx tsc --noEmit; echo $?',
      'pnpm exec tsc --noEmit',
      'yarn tsc --noEmit',
      'tsc --noEmit',
    ];
    const fingerprints = variants.map((command) => fingerprintToolCall('run_command', { command }));
    expect(new Set(fingerprints).size).toBe(1);
  });

  it('does not collapse an unrelated build command into the tsc fingerprint', () => {
    const tscFp = fingerprintToolCall('run_command', { command: 'npx tsc --noEmit' });
    const buildFp = fingerprintToolCall('run_command', { command: 'pnpm run build' });
    expect(tscFp).not.toBe(buildFp);
  });

  it('fingerprints identically regardless of object key insertion order', () => {
    const a = fingerprintToolCall('write_file', { path: 'src/a.ts', content: 'x' });
    const b = fingerprintToolCall('write_file', { content: 'x', path: 'src/a.ts' });
    expect(a).toBe(b);
  });

  it('still distinguishes genuinely different argument values', () => {
    const a = fingerprintToolCall('write_file', { path: 'src/a.ts', content: 'x' });
    const b = fingerprintToolCall('write_file', { path: 'src/b.ts', content: 'x' });
    expect(a).not.toBe(b);
  });
});

describe('evaluateNoProgress', () => {
  it('flags repeated tsc failures issued through different package-manager wrappers', () => {
    const commands = ['npx tsc --noEmit', 'pnpm exec tsc --noEmit'];
    const recent = commands.map((command) => ({
      toolName: 'run_command',
      fingerprint: fingerprintToolCall('run_command', { command }, 'exit code 2'),
      success: false,
      error: 'exit code 2',
    }));
    const verdict = evaluateNoProgress(recent, { maxIdenticalFailures: 2 });
    expect(verdict.stuck).toBe(true);
    expect(verdict.forceSynthesis).toBe(true);
  });
});
