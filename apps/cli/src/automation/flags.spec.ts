import { describe, expect, it } from 'vitest';

import {
  parseEventIngestFlags,
  parseScheduleFlags,
  peelJsonFlag,
  takeFlagValue,
} from './flags.js';

describe('automation flag helpers', () => {
  it('peels --json from args', () => {
    expect(peelJsonFlag(['list', '--json'])).toEqual({
      args: ['list'],
      json: true,
    });
    expect(peelJsonFlag(['list'])).toEqual({ args: ['list'], json: false });
  });

  it('takes a flag value or undefined', () => {
    expect(takeFlagValue(['--out', 'a.json'], '--out')).toBe('a.json');
    expect(takeFlagValue(['x'], '--out')).toBeUndefined();
  });

  it('parses schedule flags with positional name', () => {
    expect(
      parseScheduleFlags([
        'nightly',
        'build',
        '--cron',
        '0 9 * * *',
        '--prompt',
        'go',
        '--mode',
        'agent',
        '--autonomy',
        'apply',
        '--timeout',
        '30',
        '--max-parallel',
        '2',
      ]),
    ).toEqual({
      name: 'nightly build',
      cron: '0 9 * * *',
      prompt: 'go',
      mode: 'agent',
      autonomy: 'apply',
      timeout: 30,
      maxParallel: 2,
    });
  });

  it('ignores invalid mode and autonomy values', () => {
    const flags = parseScheduleFlags(['--mode', 'bogus', '--autonomy', 'nope']);
    expect(flags.mode).toBeUndefined();
    expect(flags.autonomy).toBeUndefined();
  });

  it('parses event ingest flags and attributes', () => {
    const flags = parseEventIngestFlags([
      '--type',
      'pr.opened',
      '--source',
      'github',
      '--attr',
      'k=v',
      '--attr',
      'bad',
    ]);
    expect(flags.type).toBe('pr.opened');
    expect(flags.source).toBe('github');
    expect(flags.attributes).toEqual({ k: 'v' });
  });
});
